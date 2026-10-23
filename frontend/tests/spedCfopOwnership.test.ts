import test from 'node:test';
import assert from 'node:assert/strict';
import { installDomParserPolyfill } from './domPolyfill.ts';
import { parseSped } from '../src/lib/localProcessing/sped.ts';
import { parseNfeXml } from '../src/lib/localProcessing/xml.ts';
import { enrichSpedWithXml, assertSpedBelongsToCompany } from '../src/lib/localProcessing/sources.ts';

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
