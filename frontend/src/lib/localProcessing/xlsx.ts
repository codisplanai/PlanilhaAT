import type { EntrySheetRecord } from './domain';
import type { LocalOutputRow, LocalTemplateDescriptor } from '../../types/localProcessing';
import { readZip, writeZip } from './zip.ts';

const XML_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

function decode(bytes: Uint8Array): string {
  return new TextDecoder('utf-8').decode(bytes);
}

function encode(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function parseXml(bytes: Uint8Array, label: string): XMLDocument {
  const doc = new DOMParser().parseFromString(decode(bytes), 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error(`XLSX inválido: ${label} não pôde ser lido.`);
  return doc;
}

function serializeXml(doc: XMLDocument): Uint8Array {
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

function parseDateString(value: string): string | null {
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

function excelSerialToIso(value: number): string | null {
  if (!Number.isFinite(value) || value <= 0) return null;
  const epoch = Date.UTC(1899, 11, 30);
  const date = new Date(epoch + Math.round(value) * 86400000);
  return date.toISOString().slice(0, 10);
}

function isoToExcelSerial(value: string): number {
  const datePart = value.slice(0, 10);
  const time = Date.parse(`${datePart}T00:00:00Z`);
  return (time - Date.UTC(1899, 11, 30)) / 86400000;
}

function columnLetters(ref: string): string {
  return (ref.match(/^[A-Z]+/i)?.[0] ?? '').toUpperCase();
}

function columnNumber(letters: string): number {
  let result = 0;
  for (const char of letters.toUpperCase()) result = result * 26 + char.charCodeAt(0) - 64;
  return result;
}

function cellRef(column: string, row: number): string {
  return `${column.toUpperCase()}${row}`;
}

function getSharedStrings(entries: Map<string, Uint8Array>): string[] {
  const raw = entries.get('xl/sharedStrings.xml');
  if (!raw) return [];
  const doc = parseXml(raw, 'sharedStrings.xml');
  return Array.from(doc.getElementsByTagNameNS(XML_NS, 'si')).map((si) =>
    Array.from(si.getElementsByTagNameNS(XML_NS, 't')).map((node) => node.textContent ?? '').join(''),
  );
}

function getCellValue(cell: Element, sharedStrings: string[]): string {
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

function workbookSheets(entries: Map<string, Uint8Array>): Array<{ name: string; path: string }> {
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

  return Array.from(workbook.getElementsByTagNameNS(XML_NS, 'sheet')).map((sheet) => {
    const id = sheet.getAttributeNS(REL_NS, 'id') || sheet.getAttribute('r:id') || '';
    return { name: sheet.getAttribute('name') ?? '', path: relMap.get(id) ?? '' };
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

function decodeTextBuffer(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

function parseDelimitedEntrySheet(text: string): EntrySheetRecord[] {
  const lines = text.split(/\r?\n/);
  let delimiter = '\t';
  for (const line of lines.slice(0, 16)) {
    if (line.includes('\t')) {
      delimiter = '\t';
      break;
    }
    if (line.includes(';')) {
      delimiter = ';';
      break;
    }
  }

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
    const text = decodeTextBuffer(bytes);
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

function worksheetForTemplate(
  entries: Map<string, Uint8Array>,
  mapping: LocalTemplateDescriptor['mapeamento_campos'],
  competencia: { month: number; year: number },
): { name: string; path: string } {
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
  ].map((value) => value.toUpperCase());

  return (
    sheets.find((sheet) => candidates.includes(sheet.name.trim().toUpperCase()))
    ?? sheets.find((sheet) => sheet.name.trim().toUpperCase().startsWith(`${String(competencia.month).padStart(2, '0')}-${competencia.year}`))
    ?? sheets[0]
  );
}

const SINGLE_PERIOD_SHEET_TYPES = new Set<LocalTemplateDescriptor['tipo']>([
  'antecipacao_parcial',
  'antecipacao_parcial_antecipado',
  'antecipacao_parcial_simples',
  'antecipacao_parcial_antecipado_simples',
  'antecipacao_tributaria',
  'antecipacao_tributaria_antecipado',
  'difal',
]);

function keepOnlyPeriodSheetVisible(
  entries: Map<string, Uint8Array>,
  selected: { name: string; path: string },
): void {
  const workbookRaw = entries.get('xl/workbook.xml');
  if (!workbookRaw) throw new Error('XLSX inválido: workbook.xml ausente.');

  const workbook = parseXml(workbookRaw, 'workbook.xml');
  const sheets = Array.from(workbook.getElementsByTagNameNS(XML_NS, 'sheet'));
  const selectedIndex = sheets.findIndex((sheet) => (sheet.getAttribute('name') ?? '') === selected.name);
  if (selectedIndex < 0) throw new Error(`A aba selecionada "${selected.name}" não existe no workbook.`);

  sheets.forEach((sheet, index) => {
    if (index === selectedIndex) {
      sheet.removeAttribute('state');
      return;
    }
    if (sheet.getAttribute('state') !== 'veryHidden') sheet.setAttribute('state', 'hidden');
  });

  for (const view of Array.from(workbook.getElementsByTagNameNS(XML_NS, 'workbookView'))) {
    view.setAttribute('activeTab', String(selectedIndex));
    view.setAttribute('firstSheet', String(selectedIndex));
  }

  entries.set('xl/workbook.xml', serializeXml(workbook));
}

function createElement(doc: XMLDocument, name: string): Element {
  return doc.createElementNS(XML_NS, name);
}

function ensureRow(doc: XMLDocument, sheetData: Element, rowIndex: number): Element {
  const existing = Array.from(sheetData.getElementsByTagNameNS(XML_NS, 'row'))
    .find((row) => Number(row.getAttribute('r')) === rowIndex);
  if (existing) return existing;

  const row = createElement(doc, 'row');
  row.setAttribute('r', String(rowIndex));
  const next = Array.from(sheetData.children).find((candidate) => Number(candidate.getAttribute('r')) > rowIndex);
  if (next) sheetData.insertBefore(row, next);
  else sheetData.appendChild(row);
  return row;
}

function ensureCell(doc: XMLDocument, row: Element, ref: string): Element {
  const existing = Array.from(row.getElementsByTagNameNS(XML_NS, 'c')).find((cell) => cell.getAttribute('r') === ref);
  if (existing) return existing;

  const cell = createElement(doc, 'c');
  cell.setAttribute('r', ref);
  const targetColumn = columnNumber(columnLetters(ref));
  const next = Array.from(row.getElementsByTagNameNS(XML_NS, 'c')).find(
    (candidate) => columnNumber(columnLetters(candidate.getAttribute('r') ?? '')) > targetColumn,
  );
  if (next) row.insertBefore(cell, next);
  else row.appendChild(cell);
  return cell;
}

function clearCellValue(cell: Element): void {
  for (const childNode of Array.from(cell.children)) {
    if (['v', 'is', 'f'].includes(childNode.localName)) cell.removeChild(childNode);
  }
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
    normalized *= 100;
  }

  if ((field === 'data_emissao' || field === 'data_entrada') && typeof normalized === 'string' && normalized) {
    cell.setAttribute('t', 'n');
    const v = createElement(doc, 'v');
    v.textContent = String(isoToExcelSerial(normalized));
    cell.appendChild(v);
    return;
  }

  if (typeof normalized === 'number') {
    cell.setAttribute('t', 'n');
    const v = createElement(doc, 'v');
    v.textContent = Number.isFinite(normalized) ? String(normalized) : '0';
    cell.appendChild(v);
    return;
  }

  cell.setAttribute('t', 'inlineStr');
  const is = createElement(doc, 'is');
  const t = createElement(doc, 't');
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

export async function fillTemplateLocally(
  templateBytes: ArrayBuffer,
  template: LocalTemplateDescriptor,
  rows: LocalOutputRow[],
  header: TemplateHeaderInfo,
): Promise<ArrayBuffer> {
  const entries = await readZip(templateBytes);
  const selected = worksheetForTemplate(entries, template.mapeamento_campos, {
    month: header.month,
    year: header.year,
  });
  const raw = entries.get(selected.path);
  if (!raw) throw new Error(`Aba de template não encontrada: ${selected.name}.`);

  const doc = parseXml(raw, selected.path);
  const sheetData = doc.getElementsByTagNameNS(XML_NS, 'sheetData')[0];
  if (!sheetData) throw new Error('Template sem área de dados.');

  const headerCell = template.mapeamento_campos.header_cell
    || String(template.mapeamento_campos.extra_options?.header_cell ?? '')
    || 'A2';
  const headerRowIndex = Number.parseInt(headerCell.replace(/^[A-Z]+/i, ''), 10);
  const headerRow = ensureRow(doc, sheetData, headerRowIndex);
  writeCell(doc, ensureCell(doc, headerRow, headerCell.toUpperCase()), 'header', headerText(header), 'decimal');

  const startRow = template.mapeamento_campos.start_row || 4;
  const percentageFormat = template.mapeamento_campos.aliquota_format
    || String(template.mapeamento_campos.extra_options?.aliquota_format ?? 'decimal');

  rows.forEach((source, index) => {
    const rowIndex = startRow + index;
    const row = ensureRow(doc, sheetData, rowIndex);
    const sourceRecord = source as unknown as Record<string, unknown>;
    for (const [field, column] of Object.entries(template.mapeamento_campos.columns)) {
      const value = sourceRecord[field] ?? (field === 'item_index' ? index + 1 : undefined);
      if (value == null) continue;
      writeCell(doc, ensureCell(doc, row, cellRef(column, rowIndex)), field, value, percentageFormat);
    }
  });

  entries.set(selected.path, serializeXml(doc));

  if (SINGLE_PERIOD_SHEET_TYPES.has(template.tipo)) {
    keepOnlyPeriodSheetVisible(entries, selected);
  }

  const calcRaw = entries.get('xl/workbook.xml');
  if (calcRaw) {
    const workbook = parseXml(calcRaw, 'workbook.xml');
    let calcPr = workbook.getElementsByTagNameNS(XML_NS, 'calcPr')[0];
    if (!calcPr) {
      calcPr = createElement(workbook, 'calcPr');
      workbook.documentElement.appendChild(calcPr);
    }
    calcPr.setAttribute('fullCalcOnLoad', '1');
    calcPr.setAttribute('forceFullCalc', '1');
    calcPr.setAttribute('calcMode', 'auto');
    entries.set('xl/workbook.xml', serializeXml(workbook));
  }

  return writeZip(entries);
}
