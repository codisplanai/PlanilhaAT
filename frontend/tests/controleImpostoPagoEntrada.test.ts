import test from 'node:test';
import assert from 'node:assert/strict';
import { installDomParserPolyfill } from './domPolyfill.ts';
import { buildContext, chave, processar, spedJaneiro } from './localFixtures.ts';
import { buildSpreadsheetFilename, buildZipFilenameFromArtifacts } from '../src/lib/localProcessing/filename.ts';

installDomParserPolyfill();

const CONTROLE = 'controle_imposto_pago_entrada';

function sped() {
  return spedJaneiro([
    { numero: '901', chave: chave('2601', 901), dtDoc: '10012026', dtEntrada: '20012026', itens: [['2102', '1000,00']] },
  ]);
}

function comRegra(motivo: 'isencao' | 'imposto_pago_entrada') {
  const context = buildContext();
  context.regras_exclusao_parcial = [
    {
      id: 1, perfil_regras_id: 1, uf: 'BA', ncm: '21069090', descricao: 'Produto',
      termos_obrigatorios: ['PRODUTO'], motivo, ativo: true,
    } as never,
  ];
  return context;
}

test('imposto pago na entrada: item sai da apuração e vai para a planilha de controle', async () => {
  const result = await processar(comRegra('imposto_pago_entrada'), { sped: sped() });

  assert.equal(result.notasProcessadas.length, 0);
  assert.equal(result.itensExcluidos.length, 1);
  assert.deepEqual(Object.keys(result.rowsByDestination), [CONTROLE]);

  const row = result.rowsByDestination[CONTROLE]![0];
  assert.equal(row.v_total, 1000);
  assert.equal(row.valor_devido, 0);
  assert.equal(row.a_dst, 0.205); // A.DST resolvida normalmente (alíquota padrão da UF)
  assert.equal(row.data_entrada, '2026-01-20');

  // Só o controle é gerado, e a mensagem de "nada a recolher" continua.
  assert.deepEqual(result.artifacts.map((a) => a.tipo), [CONTROLE]);
  assert.equal(result.artifacts[0].totalValorDevido, 0);
  assert.equal(result.mensagem, 'Nenhum item a recolher na Parcial');
});

test('isenção não entra na planilha de controle', async () => {
  const result = await processar(comRegra('isencao'), { sped: sped() });

  assert.equal(result.itensExcluidos.length, 1);
  assert.deepEqual(Object.keys(result.rowsByDestination), []);
  assert.equal(result.artifacts.length, 0);
});

test('sem template de controle ativo, o processamento não falha', async () => {
  const context = comRegra('imposto_pago_entrada');
  context.templates_ativos = context.templates_ativos.filter((t) => t.tipo !== CONTROLE);
  const result = await processar(context, { sped: sped() });

  assert.equal(result.itensExcluidos.length, 1);
  assert.equal(result.artifacts.length, 0);
  assert.equal(result.mensagem, 'Nenhum item a recolher na Parcial');
});

test('nome do arquivo e do zip da planilha de controle', () => {
  const nome = buildSpreadsheetFilename({ razaoSocial: 'Cliente BA', tipo: CONTROLE, month: 1, year: 2026 });
  assert.equal(nome, 'Controle_ClienteBa_Imposto-Pago-Entrada_01-2026.xlsx');
  // O zip usa a empresa do primeiro arquivo; o modelo "Controle" não pode virar empresa.
  assert.equal(buildZipFilenameFromArtifacts([{ filename: nome }], 'abc'), 'ClienteBa_Planilhas_01-2026.zip');
});

test('controle soma os itens da mesma nota com as mesmas alíquotas (sem desdobramento)', async () => {
  const result = await processar(comRegra('imposto_pago_entrada'), {
    sped: spedJaneiro([
      { numero: '901', chave: chave('2601', 901), dtDoc: '10012026', dtEntrada: '20012026', itens: [['2102', '600,00'], ['2102', '400,00'], ['2102', '250,00']] },
    ]),
  });

  const rows = result.rowsByDestination[CONTROLE]!;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].v_total, 1250);
  assert.equal(rows[0].base_calculo, 1250);
  assert.equal(rows[0].numero_nota, '901');
});

test('controle desdobra a nota somente quando a A.ORI difere', async () => {
  const det = (n: number, valor: string, pIcms: string) => `<det nItem="${n}"><prod><cProd>P1</cProd><xProd>PRODUTO</xProd><NCM>21069090</NCM><CFOP>6102</CFOP><vProd>${valor}</vProd></prod>
    <imposto><ICMS><ICMS00><orig>0</orig><CST>00</CST><vBC>${valor}</vBC><pICMS>${pIcms}</pICMS></ICMS00></ICMS></imposto></det>`;
  const xml = `<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe"><NFe>
  <infNFe Id="NFe${chave('2601', 901)}">
    <ide><nNF>901</nNF><serie>1</serie><dhEmi>2026-01-10T10:00:00-03:00</dhEmi></ide>
    <emit><CNPJ>98765432000180</CNPJ><CRT>3</CRT><enderEmit><UF>SP</UF></enderEmit></emit>
    <dest><CNPJ>12345678000195</CNPJ><enderDest><UF>BA</UF></enderDest></dest>
    <total><ICMSTot><vProd>1000.00</vProd><vBC>1000.00</vBC><vNF>1000.00</vNF></ICMSTot></total>
    ${det(1, '600.00', '12.00')}${det(2, '300.00', '12.00')}${det(3, '100.00', '7.00')}
  </infNFe></NFe></nfeProc>`;
  const result = await processar(comRegra('imposto_pago_entrada'), {
    sped: spedJaneiro([
      { numero: '901', chave: chave('2601', 901), dtDoc: '10012026', dtEntrada: '20012026', itens: [['2102', '600,00'], ['2102', '300,00'], ['2102', '100,00']] },
    ]),
    xmls: [['901.xml', xml]],
  });

  const rows = result.rowsByDestination[CONTROLE]!;
  assert.equal(rows.length, 2);
  assert.equal(rows[0].v_total, 900);
  assert.equal(rows[0].a_ori, 0.12);
  assert.equal(rows[0].numero_nota, '901');
  assert.equal(rows[1].v_total, 100);
  assert.equal(rows[1].a_ori, 0.07);
  assert.equal(rows[1].numero_nota, '901*');
});
