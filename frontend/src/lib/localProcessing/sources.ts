import type { LocalFiscalInput } from '../../types/localProcessing';
import type { NotaIgnorada } from '../../types/solicitacao';
import type { EntrySheetRecord, ExtractedCTe, ExtractedNote, ParsedFiscalSources } from './domain';
import { decodeUtf8OrWindows1252 } from './domain.ts';
import { isCteXmlDoc, parseCteXmlFromDoc, parseNfeXmlFromDoc, parseXmlDocument } from './xml.ts';
import { NfeEventRegistry, isNfeEventDoc, isNfeInutDoc, parseNfeEventDoc, parseNfeInutDoc, protocolRejectionReason } from './nfeEvents.ts';
import { parseSped } from './sped.ts';
import { parseEntrySheet } from './xlsx.ts';
import { readZip } from './zip.ts';
import { crossingKeys, matchEntryCfop, matchEntryDate, matchEntryRecords } from './entryMatching.ts';

// Reexportado para preservar os pontos de importação já existentes.
export { crossingKeys, matchEntryCfop, matchEntryDate, matchEntryRecords };

const USO_CONSUMO_CFOPS = new Set(['2556', '2407', '2551', '1556', '1407', '1551']);
const USO_CONSUMO_SUFFIXES = new Set(['556', '407', '551']);

/**
 * Impede misturar a EFD Fiscal de um estabelecimento com XMLs de outro.
 * Matriz e filial possuem escrituração própria, ainda que compartilhem raiz CNPJ.
 */
export function assertSpedBelongsToCompany(
  spedCompanyInfo: ParsedFiscalSources['spedCompanyInfo'],
  selectedCnpj: string,
): void {
  const spedCnpj = String(spedCompanyInfo.cnpj ?? '').replace(/\D/g, '');
  const companyCnpj = String(selectedCnpj ?? '').replace(/\D/g, '');
  if (!spedCnpj) {
    throw new Error('O SPED Fiscal não informa um CNPJ de estabelecimento válido no registro 0000.');
  }
  if (spedCnpj !== companyCnpj) {
    throw new Error(
      `O SPED Fiscal pertence ao CNPJ ${spedCnpj}, mas a empresa selecionada tem CNPJ ${companyCnpj}. ` +
      'Selecione o SPED do mesmo estabelecimento (matriz ou filial) dos XMLs. ' +
      'Não é permitido misturar escriturações de CNPJs distintos.',
    );
  }
}

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
  if (Object.prototype.hasOwnProperty.call(xml.rawMetadata, 'icms_st_xml')) {
    sped.rawMetadata.icms_st_xml = xml.rawMetadata.icms_st_xml;
  }
  if (xml.rawMetadata.crt) sped.rawMetadata.crt = xml.rawMetadata.crt;
  if (xml.rawMetadata.fornecedor_simples_nacional === true) sped.rawMetadata.fornecedor_simples_nacional = true;
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

  // O XML contém o CFOP de emissão (5xxx/6xxx); o SPED C170 contém o
  // CFOP efetivamente escriturado pelo destinatário (1xxx/2xxx).
  // Só relacionar CFOPs distintos item a item se quantidade, números dos
  // itens e NCMs conferirem. Caso contrário, usar o CFOP uniforme do SPED
  // quando existir; nunca atribuir arbitrariamente um C170 a outro item.
  const spedByItem = new Map(sped.itens.map((item) => [item.itemNumero, item]));
  const matchingSpedItems = xml.itens.length === sped.itens.length
    && xml.itens.every((item) => {
      const spedItem = spedByItem.get(item.itemNumero);
      return Boolean(spedItem?.cfop)
        && (spedItem?.ncm === '00000000' || spedItem?.ncm === item.ncm);
    });
  const cfops = [...new Set(sped.itens.map((item) => item.cfop).filter(Boolean))];
  const uniformSpedCfop = cfops.length === 1 ? cfops[0] : null;

  sped.itens = xml.itens.map((item) => ({
    ...item,
    cfop: (matchingSpedItems ? spedByItem.get(item.itemNumero)?.cfop : null)
      || uniformSpedCfop
      || item.cfop,
  }));
  sped.rawMetadata.cfop_origem = matchingSpedItems
    ? 'sped_c170_por_item'
    : uniformSpedCfop ? 'sped_cfop_uniforme' : 'xml_sem_correspondencia_segura';
  if (xml.vTotalNota > 0) sped.vTotalNota = xml.vTotalNota;
  if (xml.vBcNota > 0) sped.vBcNota = xml.vBcNota;
  if (xml.vIcmsNota > 0) sped.vIcmsNota = xml.vIcmsNota;
  if ((xml.vDescNota ?? 0) > 0) sped.vDescNota = xml.vDescNota;
  if ((xml.vStNota ?? 0) > 0) sped.vStNota = xml.vStNota;
  if (xml.aliqCreditoIcmsInfCompl != null) sped.aliqCreditoIcmsInfCompl = xml.aliqCreditoIcmsInfCompl;
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
        if (name.toLowerCase().endsWith('.xml')) {
          result.push({ filename: name, text: decodeUtf8OrWindows1252(bytes) });
        }
      }
    } else if (file.name.toLowerCase().endsWith('.xml')) {
      result.push({ filename: file.name, text: decodeUtf8OrWindows1252(await file.arrayBuffer()) });
    }
  }
  return result;
}

export function resolveSpedFiles(input: LocalFiscalInput): File[] {
  if (input.spedFiles && input.spedFiles.length > 0) return input.spedFiles;
  return input.spedFile ? [input.spedFile] : [];
}

export async function loadLocalFiscalSources(
  input: LocalFiscalInput,
  periodoInicio: string,
  periodoFim: string,
): Promise<ParsedFiscalSources & { ignoredNotes: NotaIgnorada[] }> {
  const entryRecords: EntrySheetRecord[] = input.entrySheet
    ? await parseEntrySheet(await input.entrySheet.arrayBuffer())
    : [];

  const spedNotes: ExtractedNote[] = [];
  const spedCteRecords: EntrySheetRecord[] = [];
  const spedByKey = new Map<string, ExtractedNote>();
  let spedCompanyInfo: ParsedFiscalSources['spedCompanyInfo'] = {};
  const spedCompanyInfos: NonNullable<ParsedFiscalSources['spedCompanyInfos']> = [];

  const decodedSpeds: Array<{ name: string; text: string }> = [];
  for (const spedFile of resolveSpedFiles(input)) {
    const spedText = decodeUtf8OrWindows1252(await spedFile.arrayBuffer());
    const period = parseSpedPeriod(spedText);
    if (period.start && period.end && (period.end < periodoInicio || period.start > periodoFim)) {
      throw new Error(
        `O SPED refere-se ao período ${period.start} a ${period.end}, fora da solicitação ${periodoInicio} a ${periodoFim} (${spedFile.name}).`,
      );
    }
    decodedSpeds.push({ name: spedFile.name, text: spedText });
  }

  for (const spedFile of decodedSpeds) {
    const parsed = parseSped(spedFile.text, spedFile.name);
    spedCteRecords.push(...parsed.cteEntryRecords);
    const info = {
      cnpj: parsed.companyInfo.cnpj,
      uf: parsed.companyInfo.uf,
      ie: parsed.companyInfo.ie,
      nome: parsed.companyInfo.nome,
    };
    spedCompanyInfos.push(info);
    spedCompanyInfo = {
      cnpj: spedCompanyInfo.cnpj || info.cnpj,
      uf: spedCompanyInfo.uf || info.uf,
      ie: spedCompanyInfo.ie || info.ie,
      nome: spedCompanyInfo.nome || info.nome,
    };
    for (const rawNote of parsed.notes) {
      const note = cloneNote(rawNote);
      const keys = crossingKeys(note);
      if (keys.some((key) => spedByKey.has(key))) continue;
      spedNotes.push(note);
      for (const key of keys) spedByKey.set(key, note);
    }
  }

  const notes: ExtractedNote[] = [...spedNotes];
  const ctes: ExtractedCTe[] = [];
  const ignoredNotes: NotaIgnorada[] = [];
  const events = new NfeEventRegistry();
  const unauthorizedKeys = new Map<string, string>();

  for (const source of await xmlSources(input.xmlFiles)) {
    let doc: XMLDocument;
    try {
      doc = parseXmlDocument(source.text, source.filename);
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

    // Eventos (cancelamento, carta de correção) e inutilizações não são notas: apenas
    // alimentam o registro usado para descartar notas inválidas.
    if (isNfeInutDoc(doc)) {
      const inut = parseNfeInutDoc(doc);
      if (inut) events.addInutilizacao(inut);
      continue;
    }
    if (isNfeEventDoc(doc)) {
      const event = parseNfeEventDoc(doc);
      if (event) events.addEvent(event);
      continue;
    }

    if (isCteXmlDoc(doc)) {
      try {
        ctes.push(parseCteXmlFromDoc(doc, source.filename));
      } catch (error) {
        ignoredNotes.push({
          numero_nota: 'Não identificado',
          serie: null,
          chave_acesso: null,
          data_emissao: null,
          motivo: error instanceof Error ? error.message : 'XML de CT-e inválido.',
          arquivo: source.filename,
        });
      }
      continue;
    }

    let xmlNote: ExtractedNote;
    try {
      xmlNote = parseNfeXmlFromDoc(doc, source.filename);
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

    const protocolReason = protocolRejectionReason(xmlNote.cStatProtocolo);
    if (protocolReason) {
      for (const key of crossingKeys(xmlNote)) {
        if (!unauthorizedKeys.has(key)) unauthorizedKeys.set(key, protocolReason);
      }
    }

    const match = crossingKeys(xmlNote).map((key) => spedByKey.get(key)).find(Boolean);
    if (match) enrichSpedWithXml(match, xmlNote);
    else notes.push(xmlNote);
  }

  // Só notas autorizadas (com ou sem carta de correção) entram na apuração.
  let discardedCount = 0;
  const validNotes: ExtractedNote[] = [];
  for (const note of notes) {
    const reason = crossingKeys(note).map((key) => unauthorizedKeys.get(key)).find(Boolean)
      ?? events.invalidityReason(note);
    if (!reason) {
      validNotes.push(note);
      continue;
    }
    discardedCount += 1;
    ignoredNotes.push({
      numero_nota: note.numeroNota,
      serie: note.serie || null,
      chave_acesso: note.chaveAcesso || null,
      data_emissao: note.dataEmissao ? note.dataEmissao.slice(0, 10) : null,
      motivo: reason,
      arquivo: note.filename,
    });
  }

  const unique: ExtractedNote[] = [];
  const seen = new Set<string>();
  for (const note of validNotes) {
    const keys = crossingKeys(note);
    const identity = keys.length > 0
      ? keys.join('||')
      : `${note.numeroNota}|${note.serie}|${note.cnpjEmitente}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    unique.push(note);
  }

  const uniqueCtes: ExtractedCTe[] = [];
  const seenCtes = new Set<string>();
  for (const cte of ctes) {
    const access = cte.chaveAcesso.replace(/\D/g, '');
    const identity = access.length === 44
      ? `chave:${access}`
      : `${cte.numeroCte}|${cte.serie}|${cte.cnpjEmitente}`;
    if (seenCtes.has(identity)) continue;
    seenCtes.add(identity);
    uniqueCtes.push(cte);
  }

  if (unique.length === 0 && uniqueCtes.length === 0 && discardedCount > 0) {
    throw new Error(
      `Todas as ${discardedCount} NF-e(s) enviada(s) foram desconsideradas por estarem canceladas, inutilizadas ou não autorizadas. `
      + 'Apenas notas autorizadas (com ou sem carta de correção) entram na apuração.',
    );
  }
  if (unique.length === 0 && uniqueCtes.length === 0) {
    throw new Error('Nenhum XML de NF-e, CT-e ou SPED Fiscal válido foi encontrado para processamento.');
  }

  return {
    notes: unique,
    ctes: uniqueCtes,
    entryRecords,
    spedCteRecords,
    spedCompanyInfo,
    spedCompanyInfos,
    ignoredNotes,
  };
}
