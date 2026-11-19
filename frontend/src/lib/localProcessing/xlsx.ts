import type { EntrySheetRecord } from './domain';
import { decodeUtf8OrWindows1252 } from './domain.ts';
import type { LocalOutputRow, LocalTemplateDescriptor } from '../../types/localProcessing';
import { readZip, writeZip } from './zip.ts';

export const XML_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG_REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const CONTENT_TYPES_NS = 'http://schemas.openxmlformats.org/package/2006/content-types';
const WORKSHEET_REL_TYPE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet';
const WORKSHEET_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml';
const TOTAL_ROW_LABELS = new Set(['TOTAL', 'TOTAL:', 'TOTALIZADOR', 'TOTALIZADOR:', 'TOTAIS', 'TOTAIS:']);

function decode(bytes: Uint8Array): string {
  return new TextDecoder('utf-8').decode(bytes);
}

function encode(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

export function parseXml(bytes: Uint8Array, label: string): XMLDocument {
  const doc = new DOMParser().parseFromString(decode(bytes), 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error(`XLSX inválido: ${label} não pôde ser lido.`);
  return doc;
}

export function serializeXml(doc: XMLDocument): Uint8Array {
  return encode(new XMLSerializer().serializeToString(doc));
}

function cleanCellText(value: unknown): string {
  return String(value ?? '').replace(/^['"]+|['"]+$/g, '').trim();
}

function digits(value: unknown): string {
  return cleanCellText(value).replace(/\D/g, '');
}

function normalizeNumber(value: unknown): string {
  const raw = cleanCellText(value);
  if (!raw) return '';
  const digitsOnly = raw.replace(/\.0$/, '').replace(/\D/g, '');
  return digitsOnly.replace(/^0+(?=\d)/, '');
}

function normalizeSeries(value: unknown): string {
  return cleanCellText(value).replace(/\.0$/, '');
}

function normalizeCfop(value: unknown): string {
  return digits(value).slice(-4);
}

export function parseDateString(value: string): string | null {
  const raw = value.trim();
  if (!raw) return null;
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const br = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (br) {
    const year = br[3].length === 2 ? `20${br[3]}` : br[3];
    return `${year}-${br[2].padStart(2, '0')}-${br[1].padStart(2, '0')}`;
  }
  return null;
}

export function excelSerialToIso(value: number): string | null {
  if (!Number.isFinite(value) || value <= 0) return null;
  const epoch = Date.UTC(1899, 11, 30);
  const date = new Date(epoch + Math.round(value) * 86400000);
  return date.toISOString().slice(0, 10);
}

export function isoToExcelSerial(value: string): number {
  const datePart = value.slice(0, 10);
  const time = Date.parse(`${datePart}T00:00:00Z`);
  return (time - Date.UTC(1899, 11, 30)) / 86400000;
}

export function columnLetters(ref: string): string {
  return (ref.match(/^[A-Z]+/i)?.[0] ?? '').toUpperCase();
}

export function columnNumber(letters: string): number {
  let result = 0;
  for (const char of letters.toUpperCase()) result = result * 26 + char.charCodeAt(0) - 64;
  return result;
}

export function cellRef(column: string, row: number): string {
  return `${column.toUpperCase()}${row}`;
}

export function getSharedStrings(entries: Map<string, Uint8Array>): string[] {
  const raw = entries.get('xl/sharedStrings.xml');
  if (!raw) return [];
  const doc = parseXml(raw, 'sharedStrings.xml');
  return Array.from(doc.getElementsByTagNameNS(XML_NS, 'si')).map((si) =>
    Array.from(si.getElementsByTagNameNS(XML_NS, 't')).map((node) => node.textContent ?? '').join(''),
  );
}

export function getCellValue(cell: Element, sharedStrings: string[]): string {
  const type = cell.getAttribute('t');
  if (type === 'inlineStr') {
    return Array.from(cell.getElementsByTagNameNS(XML_NS, 't'))
      .map((node) => node.textContent ?? '')
      .join('');
  }
  const raw = cell.getElementsByTagNameNS(XML_NS, 'v')[0]?.textContent ?? '';
  if (type === 's') {
    const index = Number.parseInt(raw, 10);
    return Number.isFinite(index) ? sharedStrings[index] ?? '' : '';
  }
  if (type === 'b') return raw === '1' ? 'TRUE' : 'FALSE';
  return raw;
}

export interface SheetDescriptor {
  name: string;
  path: string;
  hidden?: boolean;
  active?: boolean;
}

export function workbookSheets(entries: Map<string, Uint8Array>): SheetDescriptor[] {
  const workbookRaw = entries.get('xl/workbook.xml');
  const relsRaw = entries.get('xl/_rels/workbook.xml.rels');
  if (!workbookRaw || !relsRaw) throw new Error('XLSX inválido: workbook ou relacionamentos ausentes.');

  const workbook = parseXml(workbookRaw, 'workbook.xml');
  const rels = parseXml(relsRaw, 'workbook.xml.rels');
  const relMap = new Map<string, string>();
  for (const rel of Array.from(rels.documentElement.children)) {
    const id = rel.getAttribute('Id') ?? '';
    const target = rel.getAttribute('Target') ?? '';
    if (id && target) {
      const normalized = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;
      relMap.set(id, normalized.replace(/\\/g, '/'));
    }
  }

  const workbookView = workbook.getElementsByTagNameNS(XML_NS, 'workbookView')[0];
  const activeTabAttr = workbookView?.getAttribute('activeTab');
  const activeTabIndex = activeTabAttr ? Number.parseInt(activeTabAttr, 10) : 0;

  return Array.from(workbook.getElementsByTagNameNS(XML_NS, 'sheet')).map((sheet, index) => {
    const id = sheet.getAttributeNS(REL_NS, 'id') || sheet.getAttribute('r:id') || '';
    const state = sheet.getAttribute('state') ?? '';
    const isHidden = state === 'hidden' || state === 'veryHidden';
    return {
      name: sheet.getAttribute('name') ?? '',
      path: relMap.get(id) ?? '',
      hidden: isHidden,
      active: index === activeTabIndex,
    };
  }).filter((sheet) => Boolean(sheet.path));
}

function rowsFromWorksheet(entries: Map<string, Uint8Array>, sheetPath: string): Map<number, Map<string, string>> {
  const raw = entries.get(sheetPath);
  if (!raw) throw new Error(`XLSX inválido: aba ausente (${sheetPath}).`);
  const doc = parseXml(raw, sheetPath);
  const shared = getSharedStrings(entries);
  const result = new Map<number, Map<string, string>>();
  for (const row of Array.from(doc.getElementsByTagNameNS(XML_NS, 'row'))) {
    const rowIndex = Number.parseInt(row.getAttribute('r') ?? '', 10);
    if (!Number.isFinite(rowIndex)) continue;
    const values = new Map<string, string>();
    for (const cell of Array.from(row.getElementsByTagNameNS(XML_NS, 'c'))) {
      const ref = cell.getAttribute('r') ?? '';
      const column = columnLetters(ref);
      if (column) values.set(column, getCellValue(cell, shared));
    }
    result.set(rowIndex, values);
  }
  return result;
}

function findHeader(
  rows: Map<number, Map<string, string>>,
): { row: number; columns: Map<string, string> } {
  const aliases: Record<string, string[]> = {
    numero: [
      'número nota', 'numero nota', 'nº nota', 'num nota', 'n. fiscal', 'nota fiscal',
      'nº documento', 'numero documento', 'num documento', 'documento', 'nº doc', 'num doc',
      'nf', 'nfe', 'nf-e', 'nr. nota', 'nr nota', 'nota',
    ],
    data: [
      'dt.escritur.', 'dt.escritur', 'data escrituração', 'data escrituracao',
      'data entrada', 'dt.entrada', 'dt entrada', 'data de entrada',
      'data entrada/saída', 'data entrada/saida', 'dt. entrada/saída', 'dt entrada/saida',
      'data movimento', 'data mov.', 'data mov', 'dt. movimento', 'dt movimento',
      'data da entrada', 'data de lancamento', 'data lancamento', 'dt. lancamento', 'data',
    ],
    serie: ['série', 'serie', 'ser'],
    cnpj: [
      'terceiro', 'cnpj do emitente', 'cnpj emitente', 'cnpj/cpf', 'cpf/cnpj',
      'cnpj', 'cpf', 'emitente', 'fornecedor', 'cnpj/cpf do emitente',
    ],
    chave: [
      'chave da nota fiscal eletrônica', 'chave da nota fiscal eletronica',
      'chave da nfe', 'chave nfe', 'chave de acesso', 'chave eletronica', 'chave eletrônica',
      'chave de acesso nfe', 'chave nfe / cte', 'chave',
    ],
    cfop: ['cfop', 'c.f.o.p.', 'cód. fiscal', 'cod. fiscal', 'código fiscal', 'natureza da operação', 'natureza'],
  };

  const normalize = (value: string) =>
    value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();

  for (const [rowIndex, values] of [...rows.entries()].filter(([index]) => index <= 16)) {
    const columns = new Map<string, string>();
    for (const [column, value] of values) {
      const normalized = normalize(cleanCellText(value));
      for (const [field, names] of Object.entries(aliases)) {
        if (names.map(normalize).some((name) => normalized === name || (field === 'cfop' && normalized.includes('cfop')))) {
          if (!columns.has(field)) columns.set(field, column);
        }
      }
    }
    if (columns.has('numero') && columns.has('data')) return { row: rowIndex, columns };
  }

  throw new Error('A planilha contábil precisa conter as colunas de número da nota e data de entrada/escrituração.');
}

function parseDelimitedEntrySheet(text: string): EntrySheetRecord[] {
  const lines = text.split(/\r?\n/);
  const sample = lines.slice(0, 16);
  let delimiter = '\t';
  if (sample.some((line) => line.includes('\t'))) delimiter = '\t';
  else if (sample.some((line) => line.includes(';'))) delimiter = ';';
  else if (sample.some((line) => line.includes(','))) delimiter = ',';

  const rows = new Map<number, Map<string, string>>();
  lines.slice(0, 16).forEach((line, index) => {
    if (!line.trim()) return;
    const values = new Map<string, string>();
    const cells = line.split(delimiter);
    cells.forEach((val, colIdx) => {
      values.set(String(colIdx), val);
    });
    rows.set(index, values);
  });

  const header = findHeader(rows);
  const records: EntrySheetRecord[] = [];

  for (let i = header.row + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line || !line.trim()) continue;
    const cells = line.split(delimiter);

    const getCol = (field: string): string => {
      const colStr = header.columns.get(field);
      if (!colStr) return '';
      const colIdx = Number.parseInt(colStr, 10);
      return Number.isFinite(colIdx) && colIdx < cells.length ? cleanCellText(cells[colIdx]) : '';
    };

    const numero = getCol('numero');
    if (!numero) continue;
    const rawDate = getCol('data');
    const dataEntrada = parseDateString(rawDate);

    records.push({
      numeroNormalizado: normalizeNumber(numero),
      serieNormalizada: normalizeSeries(getCol('serie')),
      cnpjEmitenteNormalizado: digits(getCol('cnpj')),
      chaveAcessoNormalizada: digits(getCol('chave')),
      dataEntrada,
      cfopNormalizado: normalizeCfop(getCol('cfop')),
    });
  }

  return records;
}

export async function parseEntrySheet(buffer: ArrayBuffer): Promise<EntrySheetRecord[]> {
  const bytes = new Uint8Array(buffer);
  const isZip = bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b;
  const isBiff8 = bytes.length >= 4 && bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0;

  if (isBiff8) {
    throw new Error(
      'A planilha contábil está no formato binário legado do Excel (.xls BIFF8). ' +
      'Por favor, abra-a no Excel e salve como Pasta de Trabalho do Excel (.xlsx), ou exporte em formato de texto (.tsv / .txt).'
    );
  }

  if (!isZip) {
    const text = decodeUtf8OrWindows1252(bytes);
    return parseDelimitedEntrySheet(text);
  }

  const entries = await readZip(buffer);
  const sheets = workbookSheets(entries);
  if (sheets.length === 0) throw new Error('A planilha auxiliar não contém abas legíveis.');

  let header: { row: number; columns: Map<string, string> } | null = null;
  let rows: Map<number, Map<string, string>> | null = null;

  for (const sheet of sheets) {
    try {
      const candidateRows = rowsFromWorksheet(entries, sheet.path);
      const candidateHeader = findHeader(candidateRows);
      if (candidateHeader) {
        header = candidateHeader;
        rows = candidateRows;
        break;
      }
    } catch {
      // Tenta próxima aba se esta não contiver o cabeçalho
    }
  }

  if (!header || !rows) {
    throw new Error('A planilha contábil precisa conter as colunas de número da nota e data de entrada/escrituração.');
  }

  const records: EntrySheetRecord[] = [];

  for (const [rowIndex, values] of rows) {
    if (rowIndex <= header.row) continue;
    const numero = values.get(header.columns.get('numero') ?? '') ?? '';
    if (!cleanCellText(numero)) continue;
    const rawDate = values.get(header.columns.get('data') ?? '') ?? '';
    const numericDate = Number(rawDate);
    const dataEntrada = parseDateString(rawDate) || (Number.isFinite(numericDate) ? excelSerialToIso(numericDate) : null);

    records.push({
      numeroNormalizado: normalizeNumber(numero),
      serieNormalizada: normalizeSeries(values.get(header.columns.get('serie') ?? '') ?? ''),
      cnpjEmitenteNormalizado: digits(values.get(header.columns.get('cnpj') ?? '') ?? ''),
      chaveAcessoNormalizada: digits(values.get(header.columns.get('chave') ?? '') ?? ''),
      dataEntrada,
      cfopNormalizado: normalizeCfop(values.get(header.columns.get('cfop') ?? '') ?? ''),
    });
  }

  return records;
}

export function worksheetForTemplate(
  entries: Map<string, Uint8Array>,
  mapping: LocalTemplateDescriptor['mapeamento_campos'],
  competencia: { month: number; year: number },
): SheetDescriptor {
  const sheets = workbookSheets(entries);
  if (sheets.length === 0) throw new Error('O template não contém abas.');

  if (mapping.sheet_name && mapping.sheet_name.toLowerCase() !== 'auto') {
    const selected = sheets.find((sheet) => sheet.name.trim().toUpperCase() === mapping.sheet_name?.trim().toUpperCase());
    if (!selected) throw new Error(`A aba "${mapping.sheet_name}" declarada no mapeamento não existe no template.`);
    return selected;
  }

  const monthNames = [
    'JANEIRO', 'FEVEREIRO', 'MARÇO', 'ABRIL', 'MAIO', 'JUNHO',
    'JULHO', 'AGOSTO', 'SETEMBRO', 'OUTUBRO', 'NOVEMBRO', 'DEZEMBRO',
  ];
  const candidates = [
    monthNames[competencia.month - 1],
    `${String(competencia.month).padStart(2, '0')}-${competencia.year}`,
    `${String(competencia.month).padStart(2, '0')}/${competencia.year}`,
    `${String(competencia.month).padStart(2, '0')}_${competencia.year}`,
    `${String(competencia.month).padStart(2, '0')}-${competencia.year} FCP`,
    String(competencia.month),
    String(competencia.month).padStart(2, '0'),
  ].map((value) => value.toUpperCase());

  // Prioriza abas visíveis do template; se todas forem ocultas, usa o conjunto total como último recurso
  const visibleSheets = sheets.filter((sheet) => !sheet.hidden);
  const candidatePool = visibleSheets.length > 0 ? visibleSheets : sheets;

  const matched =
    candidatePool.find((sheet) => candidates.includes(sheet.name.trim().toUpperCase()))
    ?? candidatePool.find((sheet) => sheet.name.trim().toUpperCase().startsWith(`${String(competencia.month).padStart(2, '0')}-${competencia.year}`));

  if (matched) return matched;

  // Se nenhuma corresponder ao mês/ano, seleciona a aba ativa no Excel (se visível)
  const activeSheet = candidatePool.find((sheet) => sheet.active);
  if (activeSheet) return activeSheet;

  return candidatePool[0] ?? sheets[0];
}

const SINGLE_PERIOD_SHEET_TYPES = new Set<LocalTemplateDescriptor['tipo']>([
  'antecipacao_parcial',
  'antecipacao_parcial_antecipado',
  'antecipacao_parcial_simples',
  'antecipacao_parcial_antecipado_simples',
  'antecipacao_tributaria',
  'antecipacao_tributaria_antecipado',
  'difal',
  'difal_antecipado',
  'controle_imposto_pago_entrada',
]);

function keepOnlyPeriodSheetsVisible(
  entries: Map<string, Uint8Array>,
  visibleSheetNames: string[],
  activeSheetName: string,
): void {
  const workbookRaw = entries.get('xl/workbook.xml');
  if (!workbookRaw) throw new Error('XLSX inválido: workbook.xml ausente.');

  const workbook = parseXml(workbookRaw, 'workbook.xml');
  const sheets = Array.from(workbook.getElementsByTagNameNS(XML_NS, 'sheet'));
  const visibleSet = new Set(visibleSheetNames);
  const activeIndex = sheets.findIndex((sheet) => (sheet.getAttribute('name') ?? '') === activeSheetName);
  if (activeIndex < 0) throw new Error(`A aba selecionada "${activeSheetName}" não existe no workbook.`);

  for (const sheet of sheets) {
    const name = sheet.getAttribute('name') ?? '';
    if (visibleSet.has(name)) {
      sheet.removeAttribute('state');
    } else if (sheet.getAttribute('state') !== 'veryHidden') {
      sheet.setAttribute('state', 'hidden');
    }
  }

  for (const view of Array.from(workbook.getElementsByTagNameNS(XML_NS, 'workbookView'))) {
    view.setAttribute('activeTab', String(activeIndex));
    view.setAttribute('firstSheet', String(activeIndex));
  }

  entries.set('xl/workbook.xml', serializeXml(workbook));
}

function createXmlElement(doc: XMLDocument, fallbackNs: string, tagName: string): Element {
  const ns = doc.documentElement.namespaceURI || fallbackNs;
  return doc.createElementNS(ns, tagName);
}

function setRelationId(element: Element, rid: string): void {
  if (typeof element.setAttributeNS === 'function') {
    element.setAttributeNS(REL_NS, 'r:id', rid);
  } else {
    element.setAttribute('r:id', rid);
  }
}

function shouldRenameToCompetence(title: string): boolean {
  const stripped = title.trim();
  return (
    /^\d{2}[-_./]\d{4}/.test(stripped) ||
    /^\d{1,2}$/.test(stripped) ||
    ['sheet1', 'planilha1', 'sheet'].includes(stripped.toLowerCase())
  );
}

function formatFcpFallbackTitle(originalTitle: string): string {
  return originalTitle.length > 27 ? `${originalTitle.slice(0, 27)} FCP` : `${originalTitle} FCP`;
}

function uniqueHiddenBackupName(usedLower: Set<string>, originalName: string): string {
  for (let i = 1; i < 1000; i += 1) {
    const suffix = i === 1 ? ' (orig)' : ` (${i})`;
    const candidate = `${originalName.slice(0, Math.max(0, 31 - suffix.length))}${suffix}`;
    if (!usedLower.has(candidate.toLowerCase())) {
      usedLower.add(candidate.toLowerCase());
      return candidate;
    }
  }
  return `orig_${Date.now()}`.slice(0, 31);
}

function nextWorksheetFileName(entries: Map<string, Uint8Array>): string {
  let maxIndex = 0;
  for (const key of entries.keys()) {
    const match = key.match(/^xl\/worksheets\/sheet(\d+)\.xml$/i);
    if (match) {
      maxIndex = Math.max(maxIndex, Number.parseInt(match[1], 10));
    }
  }
  let candidate = maxIndex + 1;
  while (entries.has(`xl/worksheets/sheet${candidate}.xml`)) {
    candidate += 1;
  }
  return `sheet${candidate}.xml`;
}

function registerWorksheetRelationship(entries: Map<string, Uint8Array>, sheetFileName: string): string {
  const relsPath = 'xl/_rels/workbook.xml.rels';
  const relsRaw = entries.get(relsPath);
  if (!relsRaw) throw new Error('XLSX inválido: xl/_rels/workbook.xml.rels ausente.');

  const relsDoc = parseXml(relsRaw, 'workbook.xml.rels');
  const existingIds = new Set<string>();
  let maxRid = 0;
  for (const rel of Array.from(relsDoc.documentElement.children)) {
    const id = rel.getAttribute('Id') ?? '';
    if (id) existingIds.add(id);
    const match = id.match(/^rId(\d+)$/);
    if (match) maxRid = Math.max(maxRid, Number.parseInt(match[1], 10));
  }

  let nextRidNum = maxRid + 1;
  while (existingIds.has(`rId${nextRidNum}`)) nextRidNum += 1;
  const nextRid = `rId${nextRidNum}`;

  const relEl = createXmlElement(relsDoc, PKG_REL_NS, 'Relationship');
  relEl.setAttribute('Id', nextRid);
  relEl.setAttribute('Type', WORKSHEET_REL_TYPE);
  relEl.setAttribute('Target', `worksheets/${sheetFileName}`);
  relsDoc.documentElement.appendChild(relEl);
  entries.set(relsPath, serializeXml(relsDoc));
  return nextRid;
}

function registerWorksheetContentType(entries: Map<string, Uint8Array>, sheetPath: string): void {
  const contentTypesRaw = entries.get('[Content_Types].xml');
  if (!contentTypesRaw) return;
  const doc = parseXml(contentTypesRaw, '[Content_Types].xml');
  const partName = `/${sheetPath}`;
  const alreadyExists = Array.from(doc.documentElement.children).some(
    (child) => child.localName === 'Override' && child.getAttribute('PartName') === partName,
  );
  if (alreadyExists) return;

  const overrideEl = createXmlElement(doc, CONTENT_TYPES_NS, 'Override');
  overrideEl.setAttribute('PartName', partName);
  overrideEl.setAttribute('ContentType', WORKSHEET_CONTENT_TYPE);
  doc.documentElement.appendChild(overrideEl);
  entries.set('[Content_Types].xml', serializeXml(doc));
}

function isTotalsRow(row: Element, sharedStrings: string[]): boolean {
  for (const cell of Array.from(row.getElementsByTagNameNS(XML_NS, 'c'))) {
    const formula = (cell.getElementsByTagNameNS(XML_NS, 'f')[0]?.textContent ?? '').trim().toUpperCase();
    if (formula && (formula.includes('SUM(') || formula.includes('SOMA(') || formula.includes('SUBTOTAL('))) {
      return true;
    }
    const text = getCellValue(cell, sharedStrings).trim().toUpperCase();
    if (TOTAL_ROW_LABELS.has(text)) return true;
    if (text.startsWith('=') && (text.includes('SUM(') || text.includes('SOMA(') || text.includes('SUBTOTAL('))) {
      return true;
    }
  }
  return false;
}

function clearResidualRows(
  sheetData: Element,
  startCleanupRow: number,
  clearableColumns: Set<string>,
  sharedStrings: string[],
): void {
  if (clearableColumns.size === 0) return;
  const residualRows = Array.from(sheetData.getElementsByTagNameNS(XML_NS, 'row'))
    .map((row) => ({ row, rowIndex: Number.parseInt(row.getAttribute('r') ?? '', 10) }))
    .filter((entry) => Number.isFinite(entry.rowIndex) && entry.rowIndex >= startCleanupRow)
    .sort((a, b) => a.rowIndex - b.rowIndex);

  for (const { row } of residualRows) {
    if (isTotalsRow(row, sharedStrings)) break;
    for (const cell of Array.from(row.getElementsByTagNameNS(XML_NS, 'c'))) {
      const col = columnLetters(cell.getAttribute('r') ?? '');
      if (!col || !clearableColumns.has(col)) continue;
      if (cell.getElementsByTagNameNS(XML_NS, 'f')[0]) continue;
      clearCellValue(cell);
      cell.removeAttribute('t');
    }
  }
}

function fillWorksheetDoc(params: {
  doc: XMLDocument;
  sharedStrings: string[];
  rows: LocalOutputRow[];
  headerCell: string;
  header: TemplateHeaderInfo;
  startRow: number;
  columnsMapping: Record<string, string>;
  percentageFormat: string;
}): void {
  const { doc, sharedStrings, rows, headerCell, header, startRow, columnsMapping, percentageFormat } = params;
  const sheetData = doc.getElementsByTagNameNS(XML_NS, 'sheetData')[0];
  if (!sheetData) throw new Error('Template sem área de dados.');

  const headerRowIndex = Number.parseInt(headerCell.replace(/^[A-Z]+/i, ''), 10);
  const headerRow = ensureRow(doc, sheetData, headerRowIndex);
  writeCell(doc, ensureCell(doc, headerRow, headerCell.toUpperCase()), 'header', headerText(header), 'decimal');

  rows.forEach((source, index) => {
    const rowIndex = startRow + index;
    const row = ensureRow(doc, sheetData, rowIndex);
    const sourceRecord = source as unknown as Record<string, unknown>;
    const writtenColumns = new Set<string>();
    for (const [field, rawColumn] of Object.entries(columnsMapping)) {
      const column = rawColumn.toUpperCase();
      const value = sourceRecord[field] ?? (field === 'item_index' ? index + 1 : undefined);
      if (value == null) {
        if (field !== 'item_index' && !writtenColumns.has(column)) {
          const ref = cellRef(column, rowIndex);
          const existingCell = Array.from(row.getElementsByTagNameNS(XML_NS, 'c')).find(
            (candidate) => candidate.getAttribute('r') === ref,
          );
          if (existingCell && !existingCell.getElementsByTagNameNS(XML_NS, 'f')[0]) {
            clearCellValue(existingCell);
            existingCell.removeAttribute('t');
          }
        }
        continue;
      }
      writeCell(doc, ensureCell(doc, row, cellRef(column, rowIndex)), field, value, percentageFormat);
      writtenColumns.add(column);
    }
  });

  const clearableColumns = new Set(
    Object.entries(columnsMapping)
      .filter(([field]) => field !== 'item_index')
      .map(([, column]) => column.toUpperCase()),
  );
  clearResidualRows(sheetData, startRow + rows.length, clearableColumns, sharedStrings);
}

export function createSpreadsheetElement(doc: XMLDocument, name: string): Element {
  return doc.createElementNS(XML_NS, name);
}

export function ensureRow(doc: XMLDocument, sheetData: Element, rowIndex: number): Element {
  const existing = Array.from(sheetData.getElementsByTagNameNS(XML_NS, 'row'))
    .find((row) => Number(row.getAttribute('r')) === rowIndex);
  if (existing) return existing;

  const row = createSpreadsheetElement(doc, 'row');
  row.setAttribute('r', String(rowIndex));
  const next = Array.from(sheetData.children).find((candidate) => Number(candidate.getAttribute('r')) > rowIndex);
  if (next) sheetData.insertBefore(row, next);
  else sheetData.appendChild(row);
  return row;
}

export function ensureCell(doc: XMLDocument, row: Element, ref: string): Element {
  const existing = Array.from(row.getElementsByTagNameNS(XML_NS, 'c')).find((cell) => cell.getAttribute('r') === ref);
  if (existing) return existing;

  const cell = createSpreadsheetElement(doc, 'c');
  cell.setAttribute('r', ref);
  const targetColumn = columnNumber(columnLetters(ref));
  const next = Array.from(row.getElementsByTagNameNS(XML_NS, 'c')).find(
    (candidate) => columnNumber(columnLetters(candidate.getAttribute('r') ?? '')) > targetColumn,
  );
  if (next) row.insertBefore(cell, next);
  else row.appendChild(cell);
  return cell;
}

export function clearCellValue(cell: Element): void {
  for (const childNode of Array.from(cell.children)) {
    if (['v', 'is', 'f'].includes(childNode.localName)) cell.removeChild(childNode);
  }
}

export function enableWorkbookAutoRecalc(entries: Map<string, Uint8Array>): void {
  const calcRaw = entries.get('xl/workbook.xml');
  if (!calcRaw) return;
  const workbook = parseXml(calcRaw, 'workbook.xml');
  let calcPr = workbook.getElementsByTagNameNS(XML_NS, 'calcPr')[0];
  if (!calcPr) {
    calcPr = createSpreadsheetElement(workbook, 'calcPr');
    workbook.documentElement.appendChild(calcPr);
  }
  calcPr.setAttribute('fullCalcOnLoad', '1');
  calcPr.setAttribute('forceFullCalc', '1');
  calcPr.setAttribute('calcMode', 'auto');
  entries.set('xl/workbook.xml', serializeXml(workbook));
}

function writeCell(doc: XMLDocument, cell: Element, field: string, value: unknown, percentageFormat: string): void {
  const formula = cell.getElementsByTagNameNS(XML_NS, 'f')[0];
  if (formula) {
    if (field === 'base_calculo') return;
    throw new Error(`O template contém fórmula em ${cell.getAttribute('r')} e ela não pode ser sobrescrita pelo campo ${field}.`);
  }

  clearCellValue(cell);
  if (value == null) return;

  const percentageFields = new Set(['a_dst', 'a_ori', 'mva', 'reducao']);
  let normalized = value;
  if (percentageFields.has(field) && percentageFormat === 'percent_number' && typeof normalized === 'number' && normalized <= 1) {
    normalized = Math.round((normalized * 100 + Number.EPSILON) * 10000) / 10000;
  }

  if ((field === 'data_emissao' || field === 'data_entrada') && typeof normalized === 'string' && normalized) {
    cell.setAttribute('t', 'n');
    const v = createSpreadsheetElement(doc, 'v');
    v.textContent = String(isoToExcelSerial(normalized));
    cell.appendChild(v);
    return;
  }

  if (typeof normalized === 'number') {
    cell.setAttribute('t', 'n');
    const v = createSpreadsheetElement(doc, 'v');
    v.textContent = Number.isFinite(normalized) ? String(normalized) : '0';
    cell.appendChild(v);
    return;
  }

  cell.setAttribute('t', 'inlineStr');
  const is = createSpreadsheetElement(doc, 'is');
  const t = createSpreadsheetElement(doc, 't');
  t.setAttribute('xml:space', 'preserve');
  const raw = String(normalized);
  t.textContent = /^[=+\-@]/.test(raw) ? `'${raw}` : raw;
  is.appendChild(t);
  cell.appendChild(is);
}

export interface TemplateHeaderInfo {
  razaoSocial: string;
  ie?: string | null;
  competencia: string;
  month: number;
  year: number;
}

function headerText(info: TemplateHeaderInfo): string {
  const ie = String(info.ie ?? '').trim();
  if (ie) {
    return `                  Empresa -${info.razaoSocial}                                       IE: ${ie}                             COMP.  ${info.competencia}`;
  }
  return `                  Empresa -${info.razaoSocial}                                                                    COMP.  ${info.competencia}`;
}

function updateWorkbookSheets(params: {
  entries: Map<string, Uint8Array>;
  originalMainName: string;
  mainSheetName: string;
  fcpSheetName: string | null;
  fcpRid: string | null;
  restrictVisibility: boolean;
}): void {
  const { entries, originalMainName, mainSheetName, fcpSheetName, fcpRid, restrictVisibility } = params;
  const workbookRaw = entries.get('xl/workbook.xml');
  if (!workbookRaw) throw new Error('XLSX inválido: workbook.xml ausente.');

  const workbook = parseXml(workbookRaw, 'workbook.xml');
  const sheetsEl = workbook.getElementsByTagNameNS(XML_NS, 'sheets')[0];
  const sheetElements = Array.from(workbook.getElementsByTagNameNS(XML_NS, 'sheet'));
  const mainSheetEl = sheetElements.find((sheet) => (sheet.getAttribute('name') ?? '') === originalMainName);
  if (!mainSheetEl) throw new Error(`A aba selecionada "${originalMainName}" não existe no workbook.`);

  // Evita colisao quando uma aba legada oculta ja usa o nome alvo (ex.: "12-2025 FCP").
  const reservedLower = new Set([mainSheetName.toLowerCase()]);
  if (fcpSheetName) reservedLower.add(fcpSheetName.toLowerCase());
  const usedLower = new Set(reservedLower);
  for (const sheet of sheetElements) {
    if (sheet === mainSheetEl) continue;
    const currentName = sheet.getAttribute('name') ?? '';
    if (currentName) usedLower.add(currentName.toLowerCase());
  }
  for (const sheet of sheetElements) {
    if (sheet === mainSheetEl) continue;
    const currentName = sheet.getAttribute('name') ?? '';
    if (reservedLower.has(currentName.toLowerCase())) {
      sheet.setAttribute('name', uniqueHiddenBackupName(usedLower, currentName));
    }
  }

  mainSheetEl.setAttribute('name', mainSheetName);

  if (fcpSheetName && fcpRid) {
    if (!sheetsEl) throw new Error('XLSX inválido: elemento <sheets> ausente em workbook.xml.');
    const maxSheetId = sheetElements.reduce(
      (max, sheet) => Math.max(max, Number.parseInt(sheet.getAttribute('sheetId') ?? '0', 10) || 0),
      0,
    );
    const fcpSheetEl = createSpreadsheetElement(workbook, 'sheet');
    fcpSheetEl.setAttribute('name', fcpSheetName);
    fcpSheetEl.setAttribute('sheetId', String(maxSheetId + 1));
    setRelationId(fcpSheetEl, fcpRid);
    sheetsEl.appendChild(fcpSheetEl);
  }

  entries.set('xl/workbook.xml', serializeXml(workbook));

  if (restrictVisibility) {
    keepOnlyPeriodSheetsVisible(
      entries,
      fcpSheetName ? [mainSheetName, fcpSheetName] : [mainSheetName],
      mainSheetName,
    );
  }
}

export async function fillTemplateLocally(
  templateBytes: ArrayBuffer,
  template: LocalTemplateDescriptor,
  rows: LocalOutputRow[],
  header: TemplateHeaderInfo,
  fcpRows?: LocalOutputRow[],
): Promise<ArrayBuffer> {
  const entries = await readZip(templateBytes);
  const selected = worksheetForTemplate(entries, template.mapeamento_campos, {
    month: header.month,
    year: header.year,
  });
  const raw = entries.get(selected.path);
  if (!raw) throw new Error(`Aba de template não encontrada: ${selected.name}.`);

  // Snapshot dos bytes originais antes de preencher a aba principal (domPolyfill nao tem cloneNode).
  const originalSheetBytes = raw.slice();
  const selectedFileName = selected.path.split('/').pop() ?? '';
  const selectedRelsPath = selectedFileName ? `xl/worksheets/_rels/${selectedFileName}.rels` : '';
  const originalRelsBytes = selectedRelsPath ? entries.get(selectedRelsPath)?.slice() : undefined;

  const headerCell = template.mapeamento_campos.header_cell
    || String(template.mapeamento_campos.extra_options?.header_cell ?? '')
    || 'A2';
  const startRow = template.mapeamento_campos.start_row || 4;
  const percentageFormat = template.mapeamento_campos.aliquota_format
    || String(template.mapeamento_campos.extra_options?.aliquota_format ?? 'decimal');

  const columnsMapping: Record<string, string> = { ...template.mapeamento_campos.columns };
  if (
    template.tipo === 'antecipacao_tributaria'
    || template.tipo === 'antecipacao_tributaria_antecipado'
  ) {
    if (!columnsMapping.reducao) columnsMapping.reducao = 'I';
    if (!columnsMapping.valor_pago) columnsMapping.valor_pago = 'S';
  }

  const sharedStrings = getSharedStrings(entries);
  const mainDoc = parseXml(originalSheetBytes, selected.path);
  fillWorksheetDoc({
    doc: mainDoc,
    sharedStrings,
    rows,
    headerCell,
    header,
    startRow,
    columnsMapping,
    percentageFormat,
  });
  entries.set(selected.path, serializeXml(mainDoc));

  const hasFcp = Boolean(fcpRows && fcpRows.length > 0);
  let fcpRid: string | null = null;
  if (hasFcp && fcpRows) {
    const fcpFileName = nextWorksheetFileName(entries);
    const fcpSheetPath = `xl/worksheets/${fcpFileName}`;
    const fcpDoc = parseXml(originalSheetBytes, fcpSheetPath);
    for (const view of Array.from(fcpDoc.getElementsByTagNameNS(XML_NS, 'sheetView'))) {
      view.removeAttribute('tabSelected');
    }
    fcpDoc.getElementsByTagNameNS(XML_NS, 'sheetPr')[0]?.removeAttribute('codeName');

    fillWorksheetDoc({
      doc: fcpDoc,
      sharedStrings,
      rows: fcpRows,
      headerCell,
      header,
      startRow,
      columnsMapping,
      percentageFormat,
    });
    entries.set(fcpSheetPath, serializeXml(fcpDoc));

    if (originalRelsBytes) {
      entries.set(`xl/worksheets/_rels/${fcpFileName}.rels`, originalRelsBytes);
    }
    fcpRid = registerWorksheetRelationship(entries, fcpFileName);
    registerWorksheetContentType(entries, fcpSheetPath);
  }

  const hasValidCompetence =
    Number.isInteger(header.month) && header.month >= 1 && header.month <= 12
    && Number.isInteger(header.year) && header.year > 0;
  const competenceTitle = hasValidCompetence
    ? `${String(header.month).padStart(2, '0')}-${header.year}`
    : null;
  const mainSheetName =
    competenceTitle && shouldRenameToCompetence(selected.name)
      ? competenceTitle
      : selected.name;
  const fcpSheetName = hasFcp
    ? (competenceTitle ? `${competenceTitle} FCP` : formatFcpFallbackTitle(selected.name))
    : null;

  updateWorkbookSheets({
    entries,
    originalMainName: selected.name,
    mainSheetName,
    fcpSheetName,
    fcpRid,
    restrictVisibility: SINGLE_PERIOD_SHEET_TYPES.has(template.tipo),
  });

  enableWorkbookAutoRecalc(entries);

  return writeZip(entries);
}
