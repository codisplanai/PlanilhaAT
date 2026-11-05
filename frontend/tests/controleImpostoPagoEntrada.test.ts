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
