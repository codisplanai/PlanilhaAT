import { decodeUtf8OrWindows1252 } from './domain.ts';
import { parseSped } from './sped.ts';
import {
  XML_NS,
  cellRef,
  clearCellValue,
  columnLetters,
  createSpreadsheetElement,
  enableWorkbookAutoRecalc,
  ensureCell,
  ensureRow,
  excelSerialToIso,
  getCellValue,
  getSharedStrings,
  isoToExcelSerial,
  parseDateString,
  parseEntrySheet,
  parseXml,
  serializeXml,
  workbookSheets,
  type SheetDescriptor,
} from './xlsx.ts';
import { readZip, writeZip } from './zip.ts';

export interface EntryDateCandidate {
  numeroNormalizado: string;
  dataEntrada: string;
  dataEmissao?: string | null;
  vTotal?: number | null;
  sourceName: string;
}

export type EntryDateRowStatus = 'preenchida_agora' | 'ja_preenchida' | 'pendente';

export interface EntryDateRowReport {
  novaOrdem: number;
  linhaExcel: number;
  numeroNota: string;
  dataEmissao: string | null;
  dataEntrada: string | null;
  status: EntryDateRowStatus;
  motivo?: string;
}

export interface EntryDateFillSummary {
  totalRows: number;
  filledNow: number;
  alreadyFilled: number;
  stillPending: number;
}

export interface EntryDateFillFileResult {
  originalFilename: string;
  outputFilename: string;
  sheetName: string;
  bytes: ArrayBuffer;
  rowsReport: EntryDateRowReport[];
  summary: EntryDateFillSummary;
  warnings: string[];
}

interface CellSnapshot {
  tAttr: string | null;
  rawV: string | null;
  inlineText: string | null;
  style: string | null;
}

interface CollectedRow {
  originalIndex: number;
  sourceRowNum: number;
  numeroNota: string;
  numeroNumeric: number;
  dataEmissao: string | null;
  dataEntrada: string | null;
  status: EntryDateRowStatus;
  motivo?: string;
  cells: Map<string, CellSnapshot>;
}

interface DetectedColumns {
  startRow: number;
  colIndex: string | null;
  colDataEntrada: string;
  colDataEmissao: string | null;
  colNumeroNota: string;
  colVTotal: string | null;
}

const HEADER_ALIASES: Record<'data_entrada' | 'numero_nota' | 'data_emissao' | 'v_total' | 'item_index', string[]> = {
  data_entrada: [
    'data entrada',
    'data de entrada',
    'dt entrada',
    'dt. entrada',
    'dt.entrada',
    'data entrada/saida',
    'dt entrada/saida',
  ],
  numero_nota: [
    'n. fiscal',
    'n fiscal',
    'nf',
    'nfe',
    'nf-e',
    'numero nota',
    'nº nota',
    'no nota',
    'nr. nota',
    'nr nota',
    'nota fiscal',
    'nota',
    'numero da nota',
    'nº da nota',
    'num nota',
  ],
  data_emissao: [
    'data emissao',
    'data de emissao',
    'dt emissao',
    'dt. emissao',
    'dt.emissao',
    'emissao',
  ],
  v_total: [
    'v. total',
    'v total',
    'valor total',
    'v. contabil',
    'v contabil',
    'valor contabil',
    'vr. total',
    'vr total',
  ],
  item_index: ['item', 'ord', 'ordem', 'seq', 'sequencial', 'nº', 'no'],
};

const FOOTER_TEXT_MARKERS = new Set(['total', 'total:', 'totalizador', 'totalizador:', 'subtotal', 'subtotal:']);

function normalizeHeaderText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

export function normalizeInvoiceNumber(value: string): string {
  const clean = value.replace(/\*/g, '').replace(/^['"]+|['"]+$/g, '').trim();
  const digitsOnly = clean.replace(/\.0$/, '').replace(/\D/g, '');
  return digitsOnly.replace(/^0+(?=\d)/, '');
}

function parseNumericCell(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const cleaned = trimmed.replace(/[R$\s]/g, '');
  const normalized = cleaned.includes(',') && cleaned.includes('.')
    ? cleaned.replace(/\./g, '').replace(',', '.')
    : cleaned.includes(',')
      ? cleaned.replace(',', '.')
      : cleaned;
  const val = Number(normalized);
  return Number.isFinite(val) ? val : null;
}

function parseSpreadsheetDateCell(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const parsedStr = parseDateString(trimmed);
  if (parsedStr) return parsedStr;
  const num = Number(trimmed.replace(',', '.'));
  if (Number.isFinite(num) && num > 20000) {
    return excelSerialToIso(Math.floor(num));
  }
  return null;
}

function buildUpdatedFilename(originalFilename: string): string {
  const clean = originalFilename.trim() || 'planilha.xlsx';
  if (/_atualizada\.xlsx$/i.test(clean)) return clean;
  if (/\.xlsx$/i.test(clean)) return clean.replace(/\.xlsx$/i, '_atualizada.xlsx');
  return `${clean}_atualizada.xlsx`;
}

function pickTargetSheet(sheets: SheetDescriptor[]): SheetDescriptor {
  if (sheets.length === 0) throw new Error('A planilha .xlsx não contém abas legíveis.');
  const visible = sheets.filter((sheet) => !sheet.hidden);
  const pool = visible.length > 0 ? visible : sheets;
  return pool.find((sheet) => sheet.active) ?? pool[0];
}

function addCandidate(
  index: Map<string, EntryDateCandidate[]>,
  candidate: EntryDateCandidate,
): void {
  if (!candidate.numeroNormalizado || !candidate.dataEntrada) return;
  const bucket = index.get(candidate.numeroNormalizado);
  if (bucket) bucket.push(candidate);
  else index.set(candidate.numeroNormalizado, [candidate]);
}

export async function buildEntryDateIndexFromBuffers(params: {
  spedBuffers?: Array<{ name: string; buffer: ArrayBuffer }>;
  entrySheetBuffers?: Array<{ name: string; buffer: ArrayBuffer }>;
}): Promise<Map<string, EntryDateCandidate[]>> {
  const index = new Map<string, EntryDateCandidate[]>();

  for (const sped of params.spedBuffers ?? []) {
    const text = decodeUtf8OrWindows1252(sped.buffer);
    const parsed = parseSped(text, sped.name);
    for (const note of parsed.notes) {
      if (!note.dataEntrada) continue;
      addCandidate(index, {
        numeroNormalizado: normalizeInvoiceNumber(note.numeroNota),
        dataEntrada: note.dataEntrada.slice(0, 10),
        dataEmissao: note.dataEmissao ? note.dataEmissao.slice(0, 10) : null,
        vTotal: Number.isFinite(note.vTotalNota) ? note.vTotalNota : null,
        sourceName: sped.name,
      });
    }
  }

  for (const sheet of params.entrySheetBuffers ?? []) {
    const records = await parseEntrySheet(sheet.buffer);
    for (const record of records) {
      if (!record.dataEntrada) continue;
      addCandidate(index, {
        numeroNormalizado: normalizeInvoiceNumber(record.numeroNormalizado),
        dataEntrada: record.dataEntrada.slice(0, 10),
        dataEmissao: null,
        vTotal: null,
        sourceName: sheet.name,
      });
    }
  }

  return index;
}

export async function loadEntryDateIndex(params: {
  spedFiles?: File[];
  entrySheetFiles?: File[];
}): Promise<Map<string, EntryDateCandidate[]>> {
  const spedBuffers = await Promise.all(
    (params.spedFiles ?? []).map(async (file) => ({
      name: file.name,
      buffer: await file.arrayBuffer(),
    })),
  );
  const entrySheetBuffers = await Promise.all(
    (params.entrySheetFiles ?? []).map(async (file) => ({
      name: file.name,
      buffer: await file.arrayBuffer(),
    })),
  );
  return buildEntryDateIndexFromBuffers({ spedBuffers, entrySheetBuffers });
}

export function resolveRowEntryDate(
  numeroNota: string,
  dataEmissaoIso: string | null,
  vTotal: number | null,
  index: Map<string, EntryDateCandidate[]>,
): { dataEntrada: string | null; ambiguous: boolean } {
  const normalized = normalizeInvoiceNumber(numeroNota);
  if (!normalized) return { dataEntrada: null, ambiguous: false };

  const candidates = index.get(normalized) ?? [];
  if (candidates.length === 0) return { dataEntrada: null, ambiguous: false };

  const uniqueDates = new Set(candidates.map((item) => item.dataEntrada));
  if (uniqueDates.size === 1) {
    return { dataEntrada: [...uniqueDates][0] ?? null, ambiguous: false };
  }

  let narrowed = candidates;
  if (dataEmissaoIso) {
    const byEmissao = narrowed.filter((item) => item.dataEmissao === dataEmissaoIso);
    if (byEmissao.length > 0) {
      narrowed = byEmissao;
      const datesAfterEmissao = new Set(narrowed.map((item) => item.dataEntrada));
      if (datesAfterEmissao.size === 1) {
        return { dataEntrada: [...datesAfterEmissao][0] ?? null, ambiguous: false };
      }
    }
  }

  if (vTotal !== null) {
    const byTotal = narrowed.filter(
      (item) => item.vTotal != null && Math.abs(item.vTotal - vTotal) < 0.05,
    );
    if (byTotal.length > 0) {
      const datesAfterTotal = new Set(byTotal.map((item) => item.dataEntrada));
      if (datesAfterTotal.size === 1) {
        return { dataEntrada: [...datesAfterTotal][0] ?? null, ambiguous: false };
      }
    }
  }

  return { dataEntrada: null, ambiguous: true };
}

function detectColumns(
  rowElementsByNum: Map<number, Element>,
  sharedStrings: string[],
): DetectedColumns {
  for (let rowNum = 1; rowNum <= 15; rowNum++) {
    const rowEl = rowElementsByNum.get(rowNum);
    if (!rowEl) continue;

    const matched = new Map<keyof typeof HEADER_ALIASES, string>();
    for (const cell of Array.from(rowEl.getElementsByTagNameNS(XML_NS, 'c'))) {
      const col = columnLetters(cell.getAttribute('r') ?? '');
      if (!col) continue;
      const normalized = normalizeHeaderText(getCellValue(cell, sharedStrings));
      if (!normalized) continue;

      for (const field of Object.keys(HEADER_ALIASES) as Array<keyof typeof HEADER_ALIASES>) {
        if (matched.has(field)) continue;
        if (HEADER_ALIASES[field].includes(normalized)) {
          matched.set(field, col);
        }
      }
    }

    const colDataEntrada = matched.get('data_entrada');
    const colNumeroNota = matched.get('numero_nota');
    if (colDataEntrada && colNumeroNota) {
      const fallbackIndex =
        colDataEntrada === 'B' && colNumeroNota === 'D' ? 'A' : null;
      return {
        startRow: rowNum + 1,
        colIndex: matched.get('item_index') ?? fallbackIndex,
        colDataEntrada,
        colDataEmissao: matched.get('data_emissao') ?? null,
        colNumeroNota,
        colVTotal: matched.get('v_total') ?? null,
      };
    }
  }

  return {
    startRow: 4,
    colIndex: 'A',
    colDataEntrada: 'B',
    colDataEmissao: 'C',
    colNumeroNota: 'D',
    colVTotal: 'E',
  };
}

function isFooterRow(
  rowEl: Element,
  cols: DetectedColumns,
  sharedStrings: string[],
): boolean {
  for (const cell of Array.from(rowEl.getElementsByTagNameNS(XML_NS, 'c'))) {
    const col = columnLetters(cell.getAttribute('r') ?? '');
    const formulaText = cell.getElementsByTagNameNS(XML_NS, 'f')[0]?.textContent ?? '';
    if (
      (col === cols.colVTotal || col === cols.colNumeroNota)
      && /^\s*(SUM|SUBTOTAL)\(/i.test(formulaText)
    ) {
      return true;
    }
    const text = normalizeHeaderText(getCellValue(cell, sharedStrings));
    if (FOOTER_TEXT_MARKERS.has(text) || text.startsWith('total ')) {
      return true;
    }
  }
  return false;
}

function snapshotCell(cell: Element): CellSnapshot | null {
  if (cell.getElementsByTagNameNS(XML_NS, 'f')[0]) return null;
  const style = cell.getAttribute('s');
  const tAttr = cell.getAttribute('t');
  const isEl = cell.getElementsByTagNameNS(XML_NS, 'is')[0];
  if (isEl) {
    const inlineText = Array.from(isEl.getElementsByTagNameNS(XML_NS, 't'))
      .map((node) => node.textContent ?? '')
      .join('');
    return { tAttr: 'inlineStr', rawV: null, inlineText, style };
  }
  const vEl = cell.getElementsByTagNameNS(XML_NS, 'v')[0];
  if (vEl && (vEl.textContent ?? '') !== '') {
    return { tAttr, rawV: vEl.textContent ?? '', inlineText: null, style };
  }
  return null;
}

function applySnapshotToCell(
  doc: XMLDocument,
  cell: Element,
  snap: CellSnapshot,
  fallbackStyle?: string,
): void {
  if (!cell.getAttribute('s')) {
    const styleToUse = snap.style || fallbackStyle;
    if (styleToUse) cell.setAttribute('s', styleToUse);
  }
  if (snap.tAttr === 'inlineStr' && snap.inlineText !== null) {
    cell.setAttribute('t', 'inlineStr');
    const is = createSpreadsheetElement(doc, 'is');
    const t = createSpreadsheetElement(doc, 't');
    t.setAttribute('xml:space', 'preserve');
    t.textContent = snap.inlineText;
    is.appendChild(t);
    cell.appendChild(is);
    return;
  }
  if (snap.rawV !== null) {
    if (snap.tAttr) cell.setAttribute('t', snap.tAttr);
    else cell.removeAttribute('t');
    const v = createSpreadsheetElement(doc, 'v');
    v.textContent = snap.rawV;
    cell.appendChild(v);
  }
}

function clearNonFormulaRowCells(rowEl: Element): Set<string> {
  const formulaCols = new Set<string>();
  for (const cell of Array.from(rowEl.getElementsByTagNameNS(XML_NS, 'c'))) {
    const col = columnLetters(cell.getAttribute('r') ?? '');
    if (cell.getElementsByTagNameNS(XML_NS, 'f')[0]) {
      if (col) formulaCols.add(col);
      for (const child of Array.from(cell.children)) {
        if (child.localName === 'v') cell.removeChild(child);
      }
      continue;
    }
    clearCellValue(cell);
    cell.removeAttribute('t');
  }
  return formulaCols;
}

export async function fillAndReorderEntryDatesInXlsx(
  spreadsheetBuffer: ArrayBuffer,
  originalFilename: string,
  entryIndex: Map<string, EntryDateCandidate[]>,
): Promise<EntryDateFillFileResult> {
  const bytes = new Uint8Array(spreadsheetBuffer);
  const isBiff8 = bytes.length >= 4 && bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0;
  if (isBiff8) {
    throw new Error(
      `O arquivo "${originalFilename}" está no formato legado .xls (BIFF8). `
      + 'Envie a planilha gerada no formato .xlsx.',
    );
  }

  const entries = await readZip(spreadsheetBuffer);
  const sheets = workbookSheets(entries);
  const targetSheet = pickTargetSheet(sheets);
  const sheetRaw = entries.get(targetSheet.path);
  if (!sheetRaw) throw new Error(`Aba "${targetSheet.name}" não encontrada em "${originalFilename}".`);

  const doc = parseXml(sheetRaw, targetSheet.path);
  const sheetData = doc.getElementsByTagNameNS(XML_NS, 'sheetData')[0];
  if (!sheetData) throw new Error(`A planilha "${originalFilename}" não possui área de dados.`);

  const sharedStrings = getSharedStrings(entries);
  const rowElementsByNum = new Map<number, Element>();
  for (const rowEl of Array.from(sheetData.getElementsByTagNameNS(XML_NS, 'row'))) {
    const rowNum = Number.parseInt(rowEl.getAttribute('r') ?? '', 10);
    if (Number.isFinite(rowNum)) rowElementsByNum.set(rowNum, rowEl);
  }

  const cols = detectColumns(rowElementsByNum, sharedStrings);
  const sortedRowNums = [...rowElementsByNum.keys()]
    .filter((num) => num >= cols.startRow)
    .sort((a, b) => a - b);

  const columnStyles = new Map<string, string>();
  const collectedRows: CollectedRow[] = [];
  const warnings: string[] = [];
  let maxCollectedRowNum = cols.startRow - 1;

  for (const rowNum of sortedRowNums) {
    const rowEl = rowElementsByNum.get(rowNum)!;
    if (isFooterRow(rowEl, cols, sharedStrings)) break;

    const cellsByCol = new Map<string, Element>();
    for (const cell of Array.from(rowEl.getElementsByTagNameNS(XML_NS, 'c'))) {
      const col = columnLetters(cell.getAttribute('r') ?? '');
      if (!col) continue;
      cellsByCol.set(col, cell);
      const style = cell.getAttribute('s');
      if (style && !columnStyles.has(col)) columnStyles.set(col, style);
    }

    const numeroCell = cellsByCol.get(cols.colNumeroNota);
    const numeroNota = numeroCell ? getCellValue(numeroCell, sharedStrings).trim() : '';
    if (!numeroNota || !/\d/.test(numeroNota)) continue;

    maxCollectedRowNum = Math.max(maxCollectedRowNum, rowNum);

    const dataEntradaCell = cellsByCol.get(cols.colDataEntrada);
    const existingDateRaw = dataEntradaCell ? getCellValue(dataEntradaCell, sharedStrings) : '';
    const existingDate = parseSpreadsheetDateCell(existingDateRaw);

    const emissaoCell = cols.colDataEmissao ? cellsByCol.get(cols.colDataEmissao) : undefined;
    const dataEmissao = emissaoCell
      ? parseSpreadsheetDateCell(getCellValue(emissaoCell, sharedStrings))
      : null;

    const vTotalCell = cols.colVTotal ? cellsByCol.get(cols.colVTotal) : undefined;
    const vTotal = vTotalCell
      ? parseNumericCell(getCellValue(vTotalCell, sharedStrings))
      : null;

    const snapshotCells = new Map<string, CellSnapshot>();
    for (const [col, cell] of cellsByCol) {
      if (col === cols.colIndex || col === cols.colDataEntrada) continue;
      const snap = snapshotCell(cell);
      if (snap) snapshotCells.set(col, snap);
    }

    let dataEntrada: string | null = existingDate;
    let status: EntryDateRowStatus = 'ja_preenchida';
    let motivo: string | undefined;

    if (!existingDate) {
      const resolution = resolveRowEntryDate(numeroNota, dataEmissao, vTotal, entryIndex);
      if (resolution.dataEntrada) {
        dataEntrada = resolution.dataEntrada;
        status = 'preenchida_agora';
      } else {
        dataEntrada = null;
        status = 'pendente';
        if (resolution.ambiguous) {
          motivo = 'Mais de uma data de entrada encontrada nas fontes para este nº de nota.';
          warnings.push(`NF ${numeroNota}: ${motivo}`);
        }
      }
    }

    const numeroNumeric = Number(normalizeInvoiceNumber(numeroNota)) || 0;
    collectedRows.push({
      originalIndex: collectedRows.length,
      sourceRowNum: rowNum,
      numeroNota,
      numeroNumeric,
      dataEmissao,
      dataEntrada,
      status,
      motivo,
      cells: snapshotCells,
    });
  }

  if (collectedRows.length === 0) {
    throw new Error(
      `Nenhuma nota fiscal foi localizada a partir da linha ${cols.startRow} em "${originalFilename}".`,
    );
  }

  // Linhas sem data de entrada ficam no topo; linhas com data ficam abaixo.
  const sortedRows = [...collectedRows].sort((a, b) => {
    const aMissing = a.dataEntrada === null;
    const bMissing = b.dataEntrada === null;
    if (aMissing !== bMissing) return aMissing ? -1 : 1;
    if (aMissing && bMissing) return a.originalIndex - b.originalIndex;
    const dateCmp = a.dataEntrada!.localeCompare(b.dataEntrada!);
    if (dateCmp !== 0) return dateCmp;
    const numCmp = a.numeroNumeric - b.numeroNumeric;
    if (numCmp !== 0) return numCmp;
    return a.originalIndex - b.originalIndex;
  });

  const rowsReport: EntryDateRowReport[] = [];

  for (let index = 0; index < sortedRows.length; index++) {
    const targetRowNum = cols.startRow + index;
    const item = sortedRows[index];
    const targetRow = ensureRow(doc, sheetData, targetRowNum);
    const formulaCols = clearNonFormulaRowCells(targetRow);

    if (cols.colIndex && !formulaCols.has(cols.colIndex)) {
      const indexCell = ensureCell(doc, targetRow, cellRef(cols.colIndex, targetRowNum));
      const fallbackStyle = columnStyles.get(cols.colIndex);
      if (!indexCell.getAttribute('s') && fallbackStyle) indexCell.setAttribute('s', fallbackStyle);
      indexCell.setAttribute('t', 'n');
      const v = createSpreadsheetElement(doc, 'v');
      v.textContent = String(index + 1);
      indexCell.appendChild(v);
    }

    if (!formulaCols.has(cols.colDataEntrada)) {
      const dateCell = ensureCell(doc, targetRow, cellRef(cols.colDataEntrada, targetRowNum));
      const fallbackStyle = columnStyles.get(cols.colDataEntrada);
      if (!dateCell.getAttribute('s') && fallbackStyle) dateCell.setAttribute('s', fallbackStyle);
      if (item.dataEntrada) {
        dateCell.setAttribute('t', 'n');
        const v = createSpreadsheetElement(doc, 'v');
        v.textContent = String(isoToExcelSerial(item.dataEntrada));
        dateCell.appendChild(v);
      }
    }

    for (const [col, snap] of item.cells) {
      if (formulaCols.has(col)) continue;
      const targetCell = ensureCell(doc, targetRow, cellRef(col, targetRowNum));
      applySnapshotToCell(doc, targetCell, snap, columnStyles.get(col));
    }

    rowsReport.push({
      novaOrdem: index + 1,
      linhaExcel: targetRowNum,
      numeroNota: item.numeroNota,
      dataEmissao: item.dataEmissao,
      dataEntrada: item.dataEntrada,
      status: item.status,
      motivo: item.motivo,
    });
  }

  for (let rowNum = cols.startRow + sortedRows.length; rowNum <= maxCollectedRowNum; rowNum++) {
    const leftoverRow = rowElementsByNum.get(rowNum);
    if (leftoverRow) clearNonFormulaRowCells(leftoverRow);
  }

  entries.set(targetSheet.path, serializeXml(doc));
  enableWorkbookAutoRecalc(entries);
  const outputBytes = await writeZip(entries);

  return {
    originalFilename,
    outputFilename: buildUpdatedFilename(originalFilename),
    sheetName: targetSheet.name,
    bytes: outputBytes,
    rowsReport,
    summary: {
      totalRows: rowsReport.length,
      filledNow: rowsReport.filter((r) => r.status === 'preenchida_agora').length,
      alreadyFilled: rowsReport.filter((r) => r.status === 'ja_preenchida').length,
      stillPending: rowsReport.filter((r) => r.status === 'pendente').length,
    },
    warnings,
  };
}

