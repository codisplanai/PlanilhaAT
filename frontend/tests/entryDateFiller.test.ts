import assert from 'node:assert/strict';
import test from 'node:test';

import { installDomParserPolyfill } from './domPolyfill.ts';
installDomParserPolyfill();

import {
  buildEntryDateIndexFromBuffers,
  fillAndReorderEntryDatesInXlsx,
} from '../src/lib/localProcessing/entryDateFiller.ts';
import {
  XML_NS,
  columnLetters,
  excelSerialToIso,
  getCellValue,
  getSharedStrings,
  isoToExcelSerial,
  parseXml,
} from '../src/lib/localProcessing/xlsx.ts';
import { readZip, writeZip } from '../src/lib/localProcessing/zip.ts';

const REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

function createPagoAntecipadamenteXlsx(): ArrayBuffer {
  const wbXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="${XML_NS}" xmlns:r="${REL_NS}">
  <bookViews><workbookView activeTab="0"/></bookViews>
  <sheets><sheet name="01-2026" sheetId="1" r:id="rId1"/></sheets>
</workbook>`;

  const relsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`;

  const sharedStringsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="${XML_NS}" count="2" uniqueCount="2">
  <si><t>TOTAL</t></si>
  <si><t>Pago via DAE</t></si>
</sst>`;

  const serialEmissao1 = isoToExcelSerial('2026-01-10');
  const serialEmissao2 = isoToExcelSerial('2026-01-15');
  const serialEmissao3 = isoToExcelSerial('2026-01-20');
  const serialEmissao4 = isoToExcelSerial('2026-01-25');
  const serialEntradaJaPreenchida = isoToExcelSerial('2026-02-01');

  // Linha 4: NF 101 - ja tinha data preenchida (2026-02-01) e VR.PAGO manual em O4 = 150
  // Linha 5: NF 102 - sem data, vai ser preenchida pelo SPED (2026-02-10)
  // Linha 6: NF 102* - subitem sem data, vai ser preenchida pelo SPED (2026-02-10) com obs sharedString in P6
  // Linha 7: NF 103 - sem data em nenhuma fonte, deve subir para o topo (linha 4) preservando O7 = 999
  // Linha 8: linha vazia do modelo com formulas
  // Linha 9: TOTALIZADOR
  const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="${XML_NS}">
  <sheetData>
    <row r="2"><c r="A2" t="inlineStr"><is><t>Empresa Teste</t></is></c></row>
    <row r="3">
      <c r="A3" t="inlineStr"><is><t>ITEM</t></is></c>
      <c r="B3" t="inlineStr"><is><t>DATA ENTRADA</t></is></c>
      <c r="C3" t="inlineStr"><is><t>DATA EMISSÃO</t></is></c>
      <c r="D3" t="inlineStr"><is><t>N. FISCAL</t></is></c>
      <c r="E3" t="inlineStr"><is><t>V. TOTAL</t></is></c>
      <c r="J3" t="inlineStr"><is><t>DÉBITO</t></is></c>
      <c r="O3" t="inlineStr"><is><t>VR. PAGO</t></is></c>
    </row>
    <row r="4">
      <c r="A4" t="n"><v>1</v></c>
      <c r="B4" s="15" t="n"><v>${serialEntradaJaPreenchida}</v></c>
      <c r="C4" s="15" t="n"><v>${serialEmissao1}</v></c>
      <c r="D4" t="inlineStr"><is><t>101</t></is></c>
      <c r="E4" t="n"><v>1000</v></c>
      <c r="J4"><f>E4*0.205</f><v>205</v></c>
      <c r="O4" t="n"><v>150</v></c>
    </row>
    <row r="5">
      <c r="A5" t="n"><v>2</v></c>
      <c r="B5" s="15"/>
      <c r="C5" s="15" t="n"><v>${serialEmissao2}</v></c>
      <c r="D5" t="inlineStr"><is><t>102</t></is></c>
      <c r="E5" t="n"><v>2000</v></c>
      <c r="J5"><f>E5*0.205</f><v>410</v></c>
    </row>
    <row r="6">
      <c r="A6" t="n"><v>3</v></c>
      <c r="B6" s="15"/>
      <c r="C6" s="15" t="n"><v>${serialEmissao3}</v></c>
      <c r="D6" t="inlineStr"><is><t>102*</t></is></c>
      <c r="E6" t="n"><v>500</v></c>
      <c r="J6"><f>E6*0.205</f><v>102.5</v></c>
      <c r="P6" t="s"><v>1</v></c>
    </row>
    <row r="7">
      <c r="A7" t="n"><v>4</v></c>
      <c r="B7" s="15"/>
      <c r="C7" s="15" t="n"><v>${serialEmissao4}</v></c>
      <c r="D7" t="inlineStr"><is><t>103</t></is></c>
      <c r="E7" t="n"><v>3000</v></c>
      <c r="J7"><f>E7*0.205</f><v>615</v></c>
      <c r="O7" t="n"><v>999</v></c>
    </row>
    <row r="8">
      <c r="B8" s="15"/>
      <c r="J8"><f>E8*0.205</f></c>
    </row>
    <row r="9">
      <c r="D9" t="s"><v>0</v></c>
      <c r="E9"><f>SUM(E4:E8)</f></c>
      <c r="J9"><f>SUM(J4:J8)</f></c>
    </row>
  </sheetData>
</worksheet>`;

  const encoder = new TextEncoder();
  const entries = new Map<string, Uint8Array>([
    ['xl/workbook.xml', encoder.encode(wbXml)],
    ['xl/_rels/workbook.xml.rels', encoder.encode(relsXml)],
    ['xl/sharedStrings.xml', encoder.encode(sharedStringsXml)],
    ['xl/worksheets/sheet1.xml', encoder.encode(sheetXml)],
  ]);
  return writeZip(entries);
}

test('preenche datas em branco via SPED/planilha, preserva ja preenchidas e move pendentes para o topo sem quebrar formulas', async () => {
  const spedText = [
    '|0000|019|0|01022026|28022026|Cliente Teste|12345678000195||BA|123|2927408|||A|1|',
    '|0150|F1|FORNECEDOR|1058|98765432000180||SP|3550308||R|1||C|',
    // NF 101 vem no SPED com data diferente (2026-02-20), mas NAO deve sobrescrever a data ja preenchida (2026-02-01)
    '|C100|0|1|F1|55|00|1|101|35260198765432000180550010000001011000000101|10012026|20022026|1000,00|0|0,00|0,00|1000,00|0|0,00|0,00|0,00|1000,00|120,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|',
    // NF 102 recebe 2026-02-10
    '|C100|0|1|F1|55|00|1|102|35260198765432000180550010000001021000000102|15012026|10022026|2000,00|0|0,00|0,00|2000,00|0|0,00|0,00|0,00|2000,00|240,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|',
    '|9999|5|',
  ].join('\n');

  const encoder = new TextEncoder();
  const index = await buildEntryDateIndexFromBuffers({
    spedBuffers: [{ name: 'sped_fev.txt', buffer: encoder.encode(spedText).buffer }],
  });

  const inputXlsx = createPagoAntecipadamenteXlsx();
  const result = await fillAndReorderEntryDatesInXlsx(
    inputXlsx,
    'RP-155_Cliente_Parcial-Antecipado_01-2026.xlsx',
    index,
  );

  assert.equal(result.outputFilename, 'RP-155_Cliente_Parcial-Antecipado_01-2026_atualizada.xlsx');
  assert.deepEqual(result.summary, {
    totalRows: 4,
    filledNow: 2,
    alreadyFilled: 1,
    stillPending: 1,
  });

  // Ordem esperada:
  // Linha 4 (topo): NF 103 (pendente, sem data)
  // Linha 5: NF 101 (ja preenchida: 2026-02-01)
  // Linha 6: NF 102 (preenchida agora: 2026-02-10)
  // Linha 7: NF 102* (preenchida agora: 2026-02-10)
  assert.deepEqual(
    result.rowsReport.map((r) => ({
      linha: r.linhaExcel,
      nota: r.numeroNota,
      entrada: r.dataEntrada,
      status: r.status,
    })),
    [
      { linha: 4, nota: '103', entrada: null, status: 'pendente' },
      { linha: 5, nota: '101', entrada: '2026-02-01', status: 'ja_preenchida' },
      { linha: 6, nota: '102', entrada: '2026-02-10', status: 'preenchida_agora' },
      { linha: 7, nota: '102*', entrada: '2026-02-10', status: 'preenchida_agora' },
    ],
  );

  // Inspecionar XML gerado diretamente
  const outEntries = await readZip(result.bytes);
  const shared = getSharedStrings(outEntries);
  const outDoc = parseXml(outEntries.get('xl/worksheets/sheet1.xml')!, 'sheet1.xml');
  const rowsByNum = new Map<number, Element>();
  for (const row of Array.from(outDoc.getElementsByTagNameNS(XML_NS, 'row'))) {
    rowsByNum.set(Number(row.getAttribute('r')), row);
  }

  const cellMap = (rowNum: number) => {
    const map = new Map<string, Element>();
    for (const c of Array.from(rowsByNum.get(rowNum)!.getElementsByTagNameNS(XML_NS, 'c'))) {
      map.set(columnLetters(c.getAttribute('r') ?? ''), c);
    }
    return map;
  };

  const r4 = cellMap(4);
  assert.equal(getCellValue(r4.get('A')!, shared), '1');
  assert.equal(getCellValue(r4.get('B')!, shared), '');
  assert.equal(r4.get('B')!.getAttribute('s'), '15');
  assert.equal(getCellValue(r4.get('D')!, shared), '103');
  assert.equal(getCellValue(r4.get('O')!, shared), '999'); // Edicao manual acompanhou a NF 103
  assert.equal(r4.get('J')!.getElementsByTagNameNS(XML_NS, 'f')[0]?.textContent, 'E4*0.205');

  const r5 = cellMap(5);
  assert.equal(getCellValue(r5.get('A')!, shared), '2');
  assert.equal(excelSerialToIso(Number(getCellValue(r5.get('B')!, shared))), '2026-02-01');
  assert.equal(getCellValue(r5.get('D')!, shared), '101');
  assert.equal(getCellValue(r5.get('O')!, shared), '150'); // Edicao manual acompanhou a NF 101
  assert.equal(r5.get('J')!.getElementsByTagNameNS(XML_NS, 'f')[0]?.textContent, 'E5*0.205');

  const r6 = cellMap(6);
  assert.equal(getCellValue(r6.get('A')!, shared), '3');
  assert.equal(excelSerialToIso(Number(getCellValue(r6.get('B')!, shared))), '2026-02-10');
  assert.equal(getCellValue(r6.get('D')!, shared), '102');
  assert.equal(r6.get('O'), undefined); // Nao herdou VR.PAGO antigo da linha 6
  assert.equal(r6.get('J')!.getElementsByTagNameNS(XML_NS, 'f')[0]?.textContent, 'E6*0.205');

  const r7 = cellMap(7);
  assert.equal(getCellValue(r7.get('A')!, shared), '4');
  assert.equal(excelSerialToIso(Number(getCellValue(r7.get('B')!, shared))), '2026-02-10');
  assert.equal(getCellValue(r7.get('D')!, shared), '102*');
  assert.equal(getCellValue(r7.get('P')!, shared), 'Pago via DAE'); // sharedString acompanhou 102*
  assert.equal(getCellValue(r7.get('O')!, shared), ''); // Valor antigo de O7 foi limpo
  assert.equal(r7.get('J')!.getElementsByTagNameNS(XML_NS, 'f')[0]?.textContent, 'E7*0.205');

  // Linha 9 (TOTALIZADOR) permanece intocada
  const r9 = cellMap(9);
  assert.equal(getCellValue(r9.get('D')!, shared), 'TOTAL');
  assert.equal(r9.get('E')!.getElementsByTagNameNS(XML_NS, 'f')[0]?.textContent, 'SUM(E4:E8)');
});

test('cruza planilha contabil (.tsv/.xls) e mantem pendente quando ha datas conflitantes sem desambiguacao', async () => {
  const tsv = [
    'Número Nota\tDt.Escritur.',
    '000102\t12/02/2026',
    '000103\t14/02/2026',
    '000103\t18/02/2026', // Conflito sem dataEmissao/vTotal na planilha contabil
  ].join('\r\n');

  const encoder = new TextEncoder();
  const index = await buildEntryDateIndexFromBuffers({
    entrySheetBuffers: [{ name: 'entradas.xls', buffer: encoder.encode(tsv).buffer }],
  });

  const result = await fillAndReorderEntryDatesInXlsx(
    createPagoAntecipadamenteXlsx(),
    'planilha.xlsx',
    index,
  );

  assert.deepEqual(result.summary, {
    totalRows: 4,
    filledNow: 2, // 102 e 102*
    alreadyFilled: 1, // 101
    stillPending: 1, // 103 ambigua
  });
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /NF 103/);
  assert.equal(result.rowsReport[0].numeroNota, '103');
  assert.equal(result.rowsReport[0].status, 'pendente');
});
