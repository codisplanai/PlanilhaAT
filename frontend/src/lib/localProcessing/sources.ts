import type { LocalFiscalInput } from '../../types/localProcessing';
import type { NotaIgnorada } from '../../types/solicitacao';
import type { EntrySheetRecord, ExtractedNote, ParsedFiscalSources } from './domain';
import { parseNfeXml } from './xml';
import { parseSped } from './sped';
import { parseEntrySheet } from './xlsx';
import { readZip } from './zip';
import { crossingKeys, matchEntryCfop, matchEntryDate, matchEntryRecords } from './entryMatching';

// Reexportado para preservar os pontos de importação já existentes.
export { crossingKeys, matchEntryCfop, matchEntryDate, matchEntryRecords };

const USO_CONSUMO_CFOPS = new Set(['2556', '2407', '2551', '1556', '1407', '1551']);
const USO_CONSUMO_SUFFIXES = new Set(['556', '407', '551']);

export function isUsoConsumoAtivo(cfop?: string | null): boolean {
  const clean = String(cfop ?? '').replace(/\D/g, '');
  return USO_CONSUMO_CFOPS.has(clean) || (clean.length >= 3 && USO_CONSUMO_SUFFIXES.has(clean.slice(-3)));
}

function cloneNote(note: ExtractedNote): ExtractedNote {
  return {
    ...note,
    rawMetadata: { ...note.rawMetadata },
    itens: note.itens.map((item) => ({ ...item })),
  };
}

export function enrichSpedWithXml(sped: ExtractedNote, xml: ExtractedNote): void {
  if (!sped.chaveAcesso && xml.chaveAcesso) sped.chaveAcesso = xml.chaveAcesso;
  if (xml.rawMetadata.crt) sped.rawMetadata.crt = xml.rawMetadata.crt;
  if (!sped.rawMetadata.emit_nome && xml.rawMetadata.emit_nome) {
    sped.rawMetadata.emit_nome = xml.rawMetadata.emit_nome;
  }

  if (
    xml.vBcNota > 0
    && (sped.vBcNota === 0 || sped.vBcNota === sped.vTotalNota)
    && xml.vBcNota < xml.vTotalNota
  ) {
    sped.vBcNota = xml.vBcNota;
  }

  if (xml.itens.length === 0) return;

  const spedCfopByItem = new Map(
    sped.itens
      .filter((item) => item.cfop && isUsoConsumoAtivo(item.cfop))
      .map((item) => [item.itemNumero, item.cfop]),
  );
  const spedCfops = sped.itens.map((item) => item.cfop).filter(Boolean);
  const allUsage = spedCfops.length > 0 && spedCfops.every((cfop) => isUsoConsumoAtivo(cfop));
  const predominant = spedCfops[0] || '2556';

  sped.itens = xml.itens.map((item) => ({
    ...item,
    cfop: allUsage ? predominant : (spedCfopByItem.get(item.itemNumero) || item.cfop),
  }));
  if (xml.vTotalNota > 0) sped.vTotalNota = xml.vTotalNota;
  if (xml.vBcNota > 0) sped.vBcNota = xml.vBcNota;
  if (xml.vIcmsNota > 0) sped.vIcmsNota = xml.vIcmsNota;
}

function decodeText(bytes: ArrayBuffer | Uint8Array): string {
  const raw = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(raw);
  } catch {
    return new TextDecoder('windows-1252').decode(raw);
  }
}

function parseSpedPeriod(text: string): { start: string | null; end: string | null } {
  const parse = (raw: string): string | null => {
    const clean = raw.replace(/\D/g, '');
    if (clean.length !== 8) return null;
    return `${clean.slice(4, 8)}-${clean.slice(2, 4)}-${clean.slice(0, 2)}`;
  };
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim().startsWith('|')) continue;
    const fields = line.trim().split('|');
    if ((fields[1] ?? '').toUpperCase() === '0000') {
      return { start: parse(fields[4] ?? ''), end: parse(fields[5] ?? '') };
    }
  }
  return { start: null, end: null };
}

async function xmlSources(files: File[]): Promise<Array<{ filename: string; text: string }>> {
  const result: Array<{ filename: string; text: string }> = [];
  for (const file of files) {
    if (file.name.toLowerCase().endsWith('.zip')) {
      const entries = await readZip(await file.arrayBuffer());
      for (const [name, bytes] of entries) {
        if (name.toLowerCase().endsWith('.xml')) result.push({ filename: name, text: decodeText(bytes) });
      }
    } else if (file.name.toLowerCase().endsWith('.xml')) {
      result.push({ filename: file.name, text: decodeText(await file.arrayBuffer()) });
    }
  }
  return result;
}

export async function loadLocalFiscalSources(
  input: LocalFiscalInput,
  periodoInicio: string,
  periodoFim: string,
): Promise<ParsedFiscalSources & { ignoredNotes: NotaIgnorada[] }> {
  const entryRecords: EntrySheetRecord[] = input.entrySheet
    ? await parseEntrySheet(await input.entrySheet.arrayBuffer())
    : [];

  let spedNotes: ExtractedNote[] = [];
  let spedCompanyInfo: ParsedFiscalSources['spedCompanyInfo'] = {};
  let spedText: string | null = null;
  if (input.spedFile) {
    spedText = decodeText(await input.spedFile.arrayBuffer());
    const period = parseSpedPeriod(spedText);
    if (period.start && period.end && (period.end < periodoInicio || period.start > periodoFim)) {
      throw new Error(
        `O SPED refere-se ao período ${period.start} a ${period.end}, fora da solicitação ${periodoInicio} a ${periodoFim}.`,
      );
    }
    const parsed = parseSped(spedText, input.spedFile.name);
    spedNotes = parsed.notes.map(cloneNote);
    spedCompanyInfo = {
      cnpj: parsed.companyInfo.cnpj,
      uf: parsed.companyInfo.uf,
      ie: parsed.companyInfo.ie,
      nome: parsed.companyInfo.nome,
    };
  }

  const notes: ExtractedNote[] = [...spedNotes];
  const ignoredNotes: NotaIgnorada[] = [];
  const spedByKey = new Map<string, ExtractedNote>();
  for (const note of spedNotes) {
    for (const key of crossingKeys(note)) spedByKey.set(key, note);
  }

  for (const source of await xmlSources(input.xmlFiles)) {
    let xmlNote: ExtractedNote;
    try {
      xmlNote = parseNfeXml(source.text, source.filename);
    } catch (error) {
      ignoredNotes.push({
        numero_nota: 'Não identificado',
        serie: null,
        chave_acesso: null,
        data_emissao: null,
        motivo: error instanceof Error ? error.message : 'XML inválido.',
        arquivo: source.filename,
      });
      continue;
    }

    const match = crossingKeys(xmlNote).map((key) => spedByKey.get(key)).find(Boolean);
    if (match) enrichSpedWithXml(match, xmlNote);
    else notes.push(xmlNote);
  }

  const unique: ExtractedNote[] = [];
  const seen = new Set<string>();
  for (const note of notes) {
    const keys = crossingKeys(note);
    const identity = keys.length > 0
      ? keys.join('||')
      : `${note.numeroNota}|${note.serie}|${note.cnpjEmitente}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    unique.push(note);
  }

  if (unique.length === 0) {
    throw new Error('Nenhum XML de NF-e ou SPED Fiscal válido foi encontrado para processamento.');
  }

  return {
    notes: unique,
    entryRecords,
    spedCompanyInfo,
    ignoredNotes,
  };
}
