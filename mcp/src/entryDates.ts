import fs from 'node:fs/promises';
import path from 'node:path';

import { fillAndReorderEntryDatesInXlsx, loadEntryDateIndex } from './engine.ts';
import {
  type FolderPolicy,
  type FoundFile,
  MAX_SHEET_FILE_BYTES,
  MAX_SPED_FILE_BYTES,
  expandPaths,
  formatBytes,
  looksLikeSped,
  toWebFile,
  writeUniqueFile,
} from './files.ts';
import { GeracaoError } from './generation.ts';

const ENTRY_SHEET_EXTENSIONS = ['.xls', '.xlsx', '.csv', '.txt', '.tsv'];
const MAX_PENDING_LISTED = 40;

export interface PreencherDatasInput {
  planilhas: string[];
  speds: string[];
  planilhasEntrada: string[];
  pastaSaida: string | null;
}

async function expandFiltered(
  policy: FolderPolicy,
  inputs: string[],
  accept: (file: FoundFile) => Promise<boolean> | boolean,
  reject: (file: FoundFile) => string,
): Promise<FoundFile[]> {
  const result: FoundFile[] = [];
  for (const raw of inputs) {
    const real = await policy.resolveExisting(raw);
    const explicit = (await fs.stat(real)).isFile();
    for (const file of await expandPaths(policy, [real])) {
      if (await accept(file)) result.push(file);
      else if (explicit) throw new GeracaoError(reject(file));
    }
  }
  return result;
}

/**
 * Mesmo fluxo da tela "Preencher Datas de Entrada": completa a coluna de data
 * de entrada de planilhas já geradas a partir do SPED e/ou da planilha
 * contábil, reordena as linhas e grava uma cópia — o arquivo original não é
 * alterado.
 */
export async function preencherDatasEntrada(
  policy: FolderPolicy,
  input: PreencherDatasInput,
): Promise<Record<string, unknown>> {
  if (input.planilhas.length === 0) throw new GeracaoError('Informe as planilhas .xlsx geradas pelo Planaut.');
  if (input.speds.length === 0 && input.planilhasEntrada.length === 0) {
    throw new GeracaoError('Informe ao menos um SPED Fiscal ou uma planilha de entradas como fonte das datas.');
  }

  const targets = await expandFiltered(
    policy,
    input.planilhas,
    (file) => file.name.toLowerCase().endsWith('.xlsx'),
    (file) => `Só planilhas .xlsx podem ser atualizadas: ${file.name}.`,
  );
  if (targets.length === 0) throw new GeracaoError('Nenhuma planilha .xlsx foi encontrada nos caminhos informados.');
  const speds = await expandFiltered(
    policy,
    input.speds,
    async (file) => file.name.toLowerCase().endsWith('.txt') && file.size > 0 && (await looksLikeSped(file.path)),
    (file) => `O arquivo ${file.name} não é um SPED Fiscal (.txt iniciado por |0000|).`,
  );
  const entrySheets = await expandFiltered(
    policy,
    input.planilhasEntrada,
    (file) => ENTRY_SHEET_EXTENSIONS.some((ext) => file.name.toLowerCase().endsWith(ext)) && file.size > 0,
    (file) => `Planilha de entradas deve ser .xls, .xlsx, .csv, .txt ou .tsv: ${file.name}.`,
  );
  for (const file of [...targets, ...entrySheets]) {
    if (file.size > MAX_SHEET_FILE_BYTES) {
      throw new GeracaoError(`${file.name} tem ${formatBytes(file.size)}; o limite é ${formatBytes(MAX_SHEET_FILE_BYTES)}.`);
    }
  }
  for (const file of speds) {
    if (file.size > MAX_SPED_FILE_BYTES) {
      throw new GeracaoError(`${file.name} tem ${formatBytes(file.size)}; o limite é ${formatBytes(MAX_SPED_FILE_BYTES)}.`);
    }
  }

  const entryIndex = await loadEntryDateIndex({
    spedFiles: await Promise.all(speds.map(toWebFile)),
    entrySheetFiles: await Promise.all(entrySheets.map(toWebFile)),
  });
  if (entryIndex.size === 0) {
    throw new GeracaoError('Nenhuma data de entrada válida foi encontrada nos arquivos SPED ou planilhas de entrada informados.');
  }

  const fixedOutput = input.pastaSaida ? await policy.resolveOutputDir(input.pastaSaida) : null;
  const arquivos: Array<Record<string, unknown>> = [];
  for (const target of targets) {
    const buffer = await fs.readFile(target.path);
    const result = await fillAndReorderEntryDatesInXlsx(
      buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer,
      target.name,
      entryIndex,
    );
    const outputDir = fixedOutput ?? (await policy.resolveOutputDir(path.dirname(target.path)));
    const written = await writeUniqueFile(outputDir, result.outputFilename, result.bytes);
    const pendentes = result.rowsReport.filter((row) => row.status === 'pendente');
    arquivos.push({
      original: target.path,
      gerado: written,
      aba: result.sheetName,
      linhas: result.summary.totalRows,
      preenchidas_agora: result.summary.filledNow,
      ja_preenchidas: result.summary.alreadyFilled,
      ainda_pendentes: result.summary.stillPending,
      notas_pendentes: pendentes.slice(0, MAX_PENDING_LISTED).map((row) => ({
        nota: row.numeroNota,
        linha_excel: row.linhaExcel,
        motivo: row.motivo ?? null,
      })),
      avisos: result.warnings,
    });
  }

  return {
    status: 'concluido',
    fontes: { sped: speds.map((file) => file.name), planilhas_entrada: entrySheets.map((file) => file.name) },
    notas_com_data_nas_fontes: entryIndex.size,
    arquivos,
    observacao: 'As planilhas originais não foram alteradas; cada resultado foi gravado como uma cópia.',
  };
}
