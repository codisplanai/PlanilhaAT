import type { EntrySheetRecord, ExtractedNote } from './domain';

/**
 * Cruzamento entre as notas lidas e as linhas da planilha de entrada do
 * sistema contábil.
 *
 * Vive em um módulo próprio, sem dependências de leitura de arquivo, para
 * poder ser exercitado por testes sem carregar os parsers de XML/SPED/XLSX.
 */

function cleanValue(value: string): string {
  return value.replace(/^['"]+|['"]+$/g, '').trim();
}

function normalizeCnpj(value: string): string {
  return cleanValue(value).replace(/\D/g, '');
}

function normalizeNumber(value: string): string {
  const clean = cleanValue(value).replace(/\D/g, '');
  return clean.replace(/^0+(?=\d)/, '');
}

function normalizeSeries(value: string): string {
  return cleanValue(value);
}

export function crossingKeys(note: ExtractedNote): string[] {
  const keys: string[] = [];
  const access = note.chaveAcesso.replace(/\D/g, '');
  if (access) keys.push(`chave:${access}`);

  const cnpj = normalizeCnpj(note.cnpjEmitente);
  const number = normalizeNumber(note.numeroNota);
  const series = normalizeSeries(note.serie).replace(/^0+/, '');
  if (cnpj && number) keys.push(`tupla:${cnpj}|${series}|${number}`);
  return keys;
}

interface EntryRecordIndex {
  byAccess: Map<string, EntrySheetRecord[]>;
  byEmitterAndNumber: Map<string, EntrySheetRecord[]>;
}

/**
 * Índice das linhas da planilha de entrada, reaproveitado entre as notas.
 *
 * O cruzamento varria a planilha inteira duas vezes por nota (data e CFOP).
 * Com milhares de notas e milhares de linhas isso é trabalho quadrático na
 * thread principal e congelava a interface durante a apuração. As chaves aqui
 * são exatamente as comparações de igualdade do filtro original, então o
 * conjunto e a ordem dos registros retornados não mudam.
 */
const entryIndexCache = new WeakMap<EntrySheetRecord[], EntryRecordIndex>();

function emitterAndNumberKey(cnpj: string, numero: string): string {
  return `${cnpj}|${numero}`;
}

function pushToBucket(
  buckets: Map<string, EntrySheetRecord[]>,
  key: string,
  record: EntrySheetRecord,
): void {
  const bucket = buckets.get(key);
  if (bucket) bucket.push(record);
  else buckets.set(key, [record]);
}

function getEntryRecordIndex(records: EntrySheetRecord[]): EntryRecordIndex {
  const cached = entryIndexCache.get(records);
  if (cached) return cached;

  const index: EntryRecordIndex = { byAccess: new Map(), byEmitterAndNumber: new Map() };
  for (const record of records) {
    if (record.chaveAcessoNormalizada) {
      pushToBucket(index.byAccess, record.chaveAcessoNormalizada, record);
    }
    if (record.cnpjEmitenteNormalizado && record.numeroNormalizado) {
      pushToBucket(
        index.byEmitterAndNumber,
        emitterAndNumberKey(record.cnpjEmitenteNormalizado, record.numeroNormalizado),
        record,
      );
    }
  }

  entryIndexCache.set(records, index);
  return index;
}

export function matchEntryRecords(
  note: ExtractedNote,
  records: EntrySheetRecord[],
): EntrySheetRecord[] {
  if (records.length === 0) return [];
  const index = getEntryRecordIndex(records);

  const access = note.chaveAcesso.replace(/\D/g, '');
  if (access.length === 44) {
    const byAccess = index.byAccess.get(access);
    if (byAccess && byAccess.length > 0) return byAccess;
  }

  const cnpj = normalizeCnpj(note.cnpjEmitente);
  const number = normalizeNumber(note.numeroNota);
  const series = normalizeSeries(note.serie);
  if (!cnpj || !number) return [];

  const candidates = index.byEmitterAndNumber.get(emitterAndNumberKey(cnpj, number));
  if (!candidates) return [];

  return candidates.filter((record) => {
    const recordSeries = record.serieNormalizada;
    return recordSeries === series
      || recordSeries.replace(/^0+/, '') === series.replace(/^0+/, '')
      || !recordSeries
      || !series;
  });
}

/** A data só é adotada quando a planilha é unânime sobre ela. */
export function matchEntryDate(note: ExtractedNote, records: EntrySheetRecord[]): string | null {
  const dates = new Set(
    matchEntryRecords(note, records).map((record) => record.dataEntrada).filter(Boolean),
  );
  return dates.size === 1 ? [...dates][0] ?? null : null;
}

/** O CFOP auxiliar só é adotado quando a planilha é unânime sobre ele. */
export function matchEntryCfop(note: ExtractedNote, records: EntrySheetRecord[]): string | null {
  const cfops = new Set(
    matchEntryRecords(note, records).map((record) => record.cfopNormalizado).filter(Boolean),
  );
  return cfops.size === 1 ? [...cfops][0] ?? null : null;
}
