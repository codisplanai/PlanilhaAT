import test from 'node:test';
import assert from 'node:assert/strict';
import { installDomParserPolyfill } from './domPolyfill.ts';
import { buildContext, chave, processar, spedJaneiro, EMPRESA_CNPJ } from './localFixtures.ts';
import { parseNfeXml, extractCreditRateFromInfCpl } from '../src/lib/localProcessing/xml.ts';

installDomParserPolyfill();

const INF_CPL_COM_CREDITO =
  'Inf. Contribuinte: - DOC. EMIT. POR OPTANTE SIMPLES NACIONAL(aliquota Simples Nacional '
  + 'aproximadamente 10,71 % - aliquota para credito de ICMS aproximadamente 3,59 %)'
  + '-NAO GERA DIREITO A CREDITO DE ICMS, IPI E ISS - Pedido Aprovado por Wilson';
const INF_CPL_SEM_CREDITO =
  'DOCUMENTO EMITIDO POR ME OU EPP OPTANTE PELO SIMPLES NACIONAL. NAO GERA DIREITO A CREDITO FISCAL DE IPI.';

const CHAVE = chave('2601', 901);
const NOTA = { numero: '901', chave: CHAVE, dtDoc: '10012026', dtEntrada: '20012026', itens: [['2556', '1000,00']] as Array<[string, string]> };

function xmlSimples(infCpl: string | null, pIcms = ''): string {
  const info = infCpl === null ? '' : `<infAdic><infCpl>${infCpl}</infCpl></infAdic>`;
  const icms = pIcms
    ? `<ICMSSN101><orig>0</orig><CSOSN>101</CSOSN><pICMS>${pIcms}</pICMS></ICMSSN101>`
    : '<ICMSSN102><orig>0</orig><CSOSN>102</CSOSN></ICMSSN102>';
  return `<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe"><NFe>
  <infNFe Id="NFe${CHAVE}">
    <ide><nNF>901</nNF><serie>1</serie><dhEmi>2026-01-10T10:00:00-03:00</dhEmi></ide>
    <emit><CNPJ>98765432000180</CNPJ><CRT>1</CRT><enderEmit><UF>SP</UF></enderEmit></emit>
    <dest><CNPJ>${EMPRESA_CNPJ}</CNPJ><enderDest><UF>BA</UF></enderDest></dest>
    <total><ICMSTot><vProd>1000.00</vProd><vBC>0.00</vBC><vNF>1000.00</vNF></ICMSTot></total>
    <det nItem="1"><prod><cProd>P1</cProd><xProd>PRODUTO</xProd><NCM>21069090</NCM><CFOP>6556</CFOP><vProd>1000.00</vProd></prod>
    <imposto><ICMS>${icms}</ICMS></imposto></det>
    ${info}
  </infNFe></NFe></nfeProc>`;
}

test('extractCreditRateFromInfCpl lê a alíquota de crédito e ignora o resto', () => {
  assert.equal(extractCreditRateFromInfCpl(INF_CPL_COM_CREDITO), 0.0359);
  assert.equal(extractCreditRateFromInfCpl('ALIQUOTA PARA CRÉDITO DE ICMS APROXIMADAMENTE 2,5%'), 0.025);
  assert.equal(extractCreditRateFromInfCpl(INF_CPL_SEM_CREDITO), null);
  assert.equal(extractCreditRateFromInfCpl('aliquota Simples Nacional aproximadamente 10,71 %'), null);
  assert.equal(extractCreditRateFromInfCpl(''), null);
});

test('parseNfeXml expõe a alíquota de crédito do infCpl', () => {
  assert.equal(parseNfeXml(xmlSimples(INF_CPL_COM_CREDITO), 'a.xml').aliqCreditoIcmsInfCompl, 0.0359);
  assert.equal(parseNfeXml(xmlSimples(null), 'b.xml').aliqCreditoIcmsInfCompl ?? null, null);
});

test('DIFAL do Simples usa o crédito autorizado em Informações Complementares', async () => {
  const result = await processar(buildContext(), {
    sped: spedJaneiro([NOTA]),
    xmls: [['901.xml', xmlSimples(INF_CPL_COM_CREDITO)]],
  });
  const row = result.rowsByDestination.difal?.[0];
  assert.ok(row, 'esperava linha de DIFAL');
  assert.equal(row.a_ori, 0.0359);
  const nota = result.notasProcessadas[0];
  assert.equal(nota.metadados_extras.a_ori_destacada, true);
  assert.equal(nota.metadados_extras.a_ori_inf_compl, true);
  assert.ok(result.avisosAvaliacao.some((a) => a.aviso.includes('Informações Complementares')));
});

test('DIFAL do Simples sem a frase de crédito mantém A.ORI vazia', async () => {
  const result = await processar(buildContext(), {
    sped: spedJaneiro([NOTA]),
    xmls: [['901.xml', xmlSimples(INF_CPL_SEM_CREDITO)]],
  });
  const row = result.rowsByDestination.difal?.[0];
  assert.ok(row, 'esperava linha de DIFAL');
  assert.equal(row.a_ori, null);
  assert.equal(result.notasProcessadas[0].metadados_extras.a_ori_inf_compl, false);
});

test('pICMS destacado prevalece sobre o crédito do infCpl', async () => {
  const result = await processar(buildContext(), {
    sped: spedJaneiro([NOTA]),
    xmls: [['901.xml', xmlSimples(INF_CPL_COM_CREDITO, '12.00')]],
  });
  const row = result.rowsByDestination.difal?.[0];
  assert.equal(row?.a_ori, 0.12);
  assert.equal(result.notasProcessadas[0].metadados_extras.a_ori_inf_compl, false);
});
