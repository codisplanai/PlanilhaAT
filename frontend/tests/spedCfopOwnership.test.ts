import test from 'node:test';
import assert from 'node:assert/strict';
import { installDomParserPolyfill } from './domPolyfill.ts';
import { parseSped } from '../src/lib/localProcessing/sped.ts';
import { parseNfeXml } from '../src/lib/localProcessing/xml.ts';
import { enrichSpedWithXml, assertSpedBelongsToCompany, loadLocalFiscalSources } from '../src/lib/localProcessing/sources.ts';

installDomParserPolyfill();

// Arquivos de teste sintéticos e anonimizados. A amostragem COMAPEL real
// identificou em setembro de 2026 236 itens C170 1.905 / XML 5.905.
const key = '35260911111111000191550010000012341000012345';
function spedText(cfop = '1102', ncm = '84244100'): string {
  return [
    '|0000|020|0|01092026|30092026|EMPRESA EXEMPLO|12345678000195||BA|00000000|0000000|||A|1|',
    '|0150|FORN|FORNECEDOR EXEMPLO|1058|11111111000191||00000000|3550308||LOGRADOURO||',
    `|0200|P1|PULVERIZADOR MANUAL|||UN|00|${ncm}||||||`,
    `|C100|0|1|FORN|55|00|1|1234|${key}|01092026|01092026|1000,00|0|0|0|1000,00|0|0|0|0|0|585,70|41,00|0|0|0||`,
    `|C170|1|P1||1,000|UN|1000,00|0,00|0|020|${cfop}||585,70|7,00|41,00|0|0|0|0|0||||0|0|||`,
    `|C190|020|${cfop}|7,00|1000,00|585,70|41,00|0|0|0|0|0||`,
  ].join('\r\n');
}
function xmlText(ncm = '84244100', cfop = '6102'): string {
  return `<NFe xmlns="http://www.portalfiscal.inf.br/nfe">
  <infNFe Id="NFe${key}">
    <ide><nNF>1234</nNF><serie>1</serie><dhEmi>2026-09-01T10:00:00-03:00</dhEmi></ide>
    <emit><CNPJ>11111111000191</CNPJ><CRT>3</CRT><enderEmit><UF>SP</UF></enderEmit></emit>
    <dest><CNPJ>12345678000195</CNPJ><enderDest><UF>BA</UF></enderDest></dest>
    <total><ICMSTot><vProd>1000.00</vProd><vBC>585.70</vBC><vICMS>41.00</vICMS><vNF>1000.00</vNF></ICMSTot></total>
    <det nItem="1"><prod><cProd>P1</cProd><xProd>PULVERIZADOR MANUAL AGRICOLA</xProd><NCM>${ncm}</NCM><CFOP>${cfop}</CFOP><vProd>1000.00</vProd></prod>
    <imposto><ICMS><ICMS20><orig>0</orig><CST>20</CST><pRedBC>41.43</pRedBC><vBC>585.70</vBC><pICMS>7.00</pICMS><vICMS>41.00</vICMS></ICMS20></ICMS></imposto></det>
  </infNFe></NFe>`;
}

test('SPED C170 de entrada prevalece sobre CFOP de emissão do XML e preserva dados fiscais XML', () => {
  const parsed = parseSped(spedText(), 'sped09.txt');
  assert.equal(parsed.companyInfo.cnpj, '12345678000195');
  const spedNote = parsed.notes[0];
  assert.equal(spedNote.itens[0].cfop, '1102');
  const xmlNote = parseNfeXml(xmlText(), 'anon.xml');
  assert.equal(xmlNote.itens[0].cfop, '6102');
  enrichSpedWithXml(spedNote, xmlNote);
  assert.equal(spedNote.itens[0].cfop, '1102');
  assert.equal(spedNote.itens[0].ncm, '84244100');
  assert.equal(spedNote.itens[0].pRedBC, 41.43);
  assert.equal(spedNote.itens[0].vIcms, 41);
  assert.equal(spedNote.rawMetadata.cfop_origem, 'sped_c170_por_item');
});

test('caso COMAPEL filial: SPED 1.905 prevalece sobre XML de transferência 5.905', () => {
  const parsed = parseSped(spedText('1905','39251000'), 'sped09.txt');
  const spedNote = parsed.notes[0];
  const xmlNote = parseNfeXml(xmlText('39251000', '5905'), 'anon.xml');
  enrichSpedWithXml(spedNote, xmlNote);
  assert.equal(spedNote.itens[0].cfop, '1905');
  assert.equal(spedNote.itens[0].ncm, '39251000');
});

test('SPED com CFOPs divergentes e item sem correspondência: não associa CFOP por posição errada', () => {
  const parsed = parseSped(spedText(), 'sped09.txt');
  const spedNote = parsed.notes[0];
  const second = { ...spedNote.itens[0], itemNumero: 2, cfop: '2556', ncm: '84341000' };
  spedNote.itens = [spedNote.itens[0], second];
  const xmlNote = parseNfeXml(xmlText('84244100','6102'), 'anon.xml');
  enrichSpedWithXml(spedNote, xmlNote);
  assert.equal(spedNote.itens[0].cfop, '6102');
  assert.equal(spedNote.rawMetadata.cfop_origem,'xml_sem_correspondencia_segura');
});

test('SPED com um único CFOP uniforme fornece roteiro seguro mesmo quando não há C170 equivalente', () => {
  const parsed = parseSped(spedText('1905'), 'sped09.txt');
  const spedNote = parsed.notes[0];
  spedNote.itens[0].ncm = '00000000';
  const xmlNote = parseNfeXml(xmlText('84244100', '5905'), 'anon.xml');
  enrichSpedWithXml(spedNote, xmlNote);
  assert.equal(spedNote.itens[0].cfop, '1905');
});

test('não aceita SPED de filial ao processar matriz, mesmo compartilhando a raiz do CNPJ', () => {
  assert.throws(
    () => assertSpedBelongsToCompany({cnpj:'14.064.976/0002-13'}, '14.064.976/0001-32'),
    /SPED Fiscal pertence ao CNPJ 14064976000213.*empresa selecionada tem CNPJ 14064976000132/,
  );
  assert.doesNotThrow(
    () => assertSpedBelongsToCompany({cnpj:'14.064.976/0002-13'}, '14064976000213'),
  );
  assert.throws(() => assertSpedBelongsToCompany({}, '14064976000213'), /registro 0000/);
});

test('SPED com entrada de emissão própria (IND_EMIT = 0) atribui emitente como a própria empresa', () => {
  const text = [
    '|0000|020|0|01092026|30092026|EMPRESA EXEMPLO|12345678000195||BA|00000000|0000000|||A|1|',
    '|C100|0|0||55|00|1|999|29260912345678000195550010000009991000000999|01092026|01092026|1000,00|0|0|0|1000,00|0|0|0|0|0|585,70|41,00|0|0|0||',
    '|C190|020|1102|7,00|1000,00|585,70|41,00|0|0|0|0|0||',
  ].join('\r\n');
  const parsed = parseSped(text, 'sped.txt');
  assert.equal(parsed.notes.length, 1);
  assert.equal(parsed.notes[0].cnpjEmitente, '12345678000195');
  assert.equal(parsed.notes[0].cnpjDestinatario, '12345678000195');
  assert.equal(parsed.notes[0].rawMetadata.ind_emit, '0');
});

test('múltiplos arquivos SPED fracionados na mesma competência consolidam notas e cruzam com XMLs', async () => {
  const key1 = '35261011111111000191550010000001011000000101';
  const key2 = '35261011111111000191550010000002021000000202';
  const sped1 = [
    '|0000|020|0|01102026|15102026|EMPRESA EXEMPLO|12345678000195||BA|12345678|0000000|||A|1|',
    '|0150|FORN|FORNECEDOR EXEMPLO|1058|11111111000191||00000000|3550308||LOGRADOURO||',
    '|0200|P1|PRODUTO 1|||UN|00|84244100||||||',
    `|C100|0|1|FORN|55|00|1|101|${key1}|05102026|10102026|1000,00|0|0|0|1000,00|0|0|0|0|0|1000,00|120,00|0|0|0||`,
    '|C170|1|P1||1,000|UN|1000,00|0,00|0|000|2102||1000,00|12,00|120,00|0|0|0|0|0||||0|0|||',
  ].join('\r\n');
  const sped2 = [
    '|0000|020|0|16102026|30102026|EMPRESA EXEMPLO|12345678000195||BA|12345678|0000000|||A|1|',
    '|0150|FORN|FORNECEDOR EXEMPLO|1058|11111111000191||00000000|3550308||LOGRADOURO||',
    '|0200|P1|PRODUTO 2|||UN|00|84244100||||||',
    `|C100|0|1|FORN|55|00|1|202|${key2}|20102026|25102026|1500,00|0|0|0|1500,00|0|0|0|0|0|1500,00|180,00|0|0|0||`,
    '|C170|1|P1||1,000|UN|1500,00|0,00|0|000|2556||1500,00|12,00|180,00|0|0|0|0|0||||0|0|||',
  ].join('\r\n');

  const sources = await loadLocalFiscalSources(
    {
      xmlFiles: [],
      spedFiles: [
        new File([sped1], 'sped_01_15_out.txt'),
        new File([sped2], 'sped_16_30_out.txt'),
      ],
      entrySheet: null,
    },
    '2026-10-01',
    '2026-10-31',
  );

  assert.equal(sources.notes.length, 2);
  assert.deepEqual(sources.notes.map((n) => n.numeroNota), ['101', '202']);
  assert.deepEqual(sources.notes.map((n) => n.dataEntrada), ['2026-10-10', '2026-10-25']);
  assert.equal(sources.spedCompanyInfos?.length, 2);
});

test('múltiplos arquivos SPED bloqueiam se um deles estiver fora do período da solicitação', async () => {
  const spedOutubro = [
    '|0000|020|0|01102026|15102026|EMPRESA EXEMPLO|12345678000195||BA|12345678|0000000|||A|1|',
    `|C100|0|1|FORN|55|00|1|101|${key}|05102026|10102026|1000,00|0|0|0|1000,00|0|0|0|0|0|1000,00|120,00|0|0|0||`,
  ].join('\r\n');
  const spedSetembro = [
    '|0000|020|0|01092026|30092026|EMPRESA EXEMPLO|12345678000195||BA|12345678|0000000|||A|1|',
    `|C100|0|1|FORN|55|00|1|102|${key}|05092026|10092026|1000,00|0|0|0|1000,00|0|0|0|0|0|1000,00|120,00|0|0|0||`,
  ].join('\r\n');

  await assert.rejects(
    () => loadLocalFiscalSources(
      {
        xmlFiles: [],
        spedFiles: [
          new File([spedOutubro], 'sped_out_1.txt'),
          new File([spedSetembro], 'sped_set.txt'),
        ],
        entrySheet: null,
      },
      '2026-10-01',
      '2026-10-31',
    ),
    /sped_set\.txt/,
  );
});
