import assert from 'node:assert/strict';
import test from 'node:test';

import { installDomParserPolyfill } from './domPolyfill.ts';
installDomParserPolyfill();

import { worksheetForTemplate, workbookSheets } from '../src/lib/localProcessing/xlsx.ts';

function createMockWorkbook(sheets: Array<{ name: string; state?: string }>, activeTab = 0): Map<string, Uint8Array> {
  const XML_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

  const sheetTags = sheets
    .map((s, i) => {
      const stateAttr = s.state ? ` state="${s.state}"` : '';
      return `<sheet name="${s.name}" sheetId="${i + 1}"${stateAttr} r:id="rId${i + 1}"/>`;
    })
    .join('');

  const relTags = sheets
    .map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`)
    .join('');

  const wbXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="${XML_NS}" xmlns:r="${REL_NS}">
  <bookViews>
    <workbookView activeTab="${activeTab}"/>
  </bookViews>
  <sheets>
    ${sheetTags}
  </sheets>
</workbook>`;

  const relsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${relTags}
</Relationships>`;

  const entries = new Map<string, Uint8Array>();
  const encoder = new TextEncoder();
  entries.set('xl/workbook.xml', encoder.encode(wbXml));
  entries.set('xl/_rels/workbook.xml.rels', encoder.encode(relsXml));

  sheets.forEach((_, i) => {
    const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="${XML_NS}">
  <sheetData/>
</worksheet>`;
    entries.set(`xl/worksheets/sheet${i + 1}.xml`, encoder.encode(sheetXml));
  });

  return entries;
}

test('worksheetForTemplate prioriza aba declarada explicitamente no mapeamento', () => {
  const entries = createMockWorkbook([{ name: '01 (2)', state: 'hidden' }, { name: '4' }]);
  const selected = worksheetForTemplate(
    entries,
    { start_row: 4, columns: { numero_nota: 'A' }, sheet_name: '4' },
    { month: 8, year: 2026 },
  );
  assert.equal(selected.name, '4');
});

test('worksheetForTemplate seleciona aba ativa e ignora aba oculta quando sheet_name é nulo', () => {
  // Simulando exatamente a estrutura do template AT (aba 0 oculta '01 (2)', aba 1 ativa '4')
  const entries = createMockWorkbook([{ name: '01 (2)', state: 'hidden' }, { name: '4' }], 1);
  const selected = worksheetForTemplate(
    entries,
    { start_row: 4, columns: { numero_nota: 'A' } },
    { month: 8, year: 2026 },
  );
  assert.equal(selected.name, '4');
  assert.equal(selected.hidden, false);
  assert.equal(selected.active, true);
});

test('worksheetForTemplate reconhece dígito simples do mês como candidato (ex: aba "4" para mês 4)', () => {
  const entries = createMockWorkbook([{ name: 'outra' }, { name: '4' }], 0);
  const selected = worksheetForTemplate(
    entries,
    { start_row: 4, columns: { numero_nota: 'A' } },
    { month: 4, year: 2026 },
  );
  assert.equal(selected.name, '4');
});

test('workbookSheets detecta abas ocultas e aba ativa pelo workbookView', () => {
  const entries = createMockWorkbook([
    { name: '01 (2)', state: 'hidden' },
    { name: 'JUNHO' },
  ], 1);
  const sheets = workbookSheets(entries);
  assert.equal(sheets.length, 2);
  assert.equal(sheets[0].name, '01 (2)');
  assert.equal(sheets[0].hidden, true);
  assert.equal(sheets[0].active, false);
  assert.equal(sheets[1].name, 'JUNHO');
  assert.equal(sheets[1].hidden, false);
  assert.equal(sheets[1].active, true);
});
