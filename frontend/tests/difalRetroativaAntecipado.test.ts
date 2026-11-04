import test from 'node:test';
import assert from 'node:assert/strict';
import { installDomParserPolyfill } from './domPolyfill.ts';
import { buildContext, chave, processar, spedJaneiro, xmlNfe } from './localFixtures.ts';
import { routePaidEarlyDestination } from '../src/lib/localProcessing/rules.ts';

installDomParserPolyfill();

const CHAVE_901 = chave('2601', 901);
const CHAVE_950 = chave('2512', 950);
const CHAVE_960 = chave('2601', 960);
const CHAVE_970 = chave('2512', 970);
const AVISO_RETROATIVA =
  'Nota emitida antes do período (15/12/2025) com entrada no SPED do período: '
  + 'apenas itens de DIFAL (uso/consumo e ativo) foram considerados.';

const nota901 = { numero: '901', chave: CHAVE_901, dtDoc: '10012026', dtEntrada: '20012026', itens: [['2556', '100,00']] as Array<[string, string]> };

function retroativa(itens: Array<[string, string]>) {
  return { numero: '950', chave: CHAVE_950, dtDoc: '15122025', dtEntrada: '05012026', itens };
}

test('routePaidEarlyDestination: DIFAL sem entrada vai para DIFAL Antecipado só no Simples', () => {
  assert.equal(routePaidEarlyDestination('difal', true, true), 'difal_antecipado');
  assert.equal(routePaidEarlyDestination('difal', true, false), 'difal');
  assert.equal(routePaidEarlyDestination('difal', false, true), 'difal');
});

test('Regime Normal aceita uso/consumo retroativo', async () => {
  const result = await processar(buildContext(), {
    sped: spedJaneiro([retroativa([['2556', '800,00']])]),
    xmls: [['950.xml', xmlNfe('950', CHAVE_950, '800.00', '2025-12-15', '6102')]],
  });
  assert.equal(result.rowsByDestination.difal?.length, 1);
  assert.equal(result.rowsByDestination.difal?.[0].data_entrada, '2026-01-05');
  assert.ok(!result.notasIgnoradas.some((nota) => nota.numero_nota === '950'));
});

test('retroativa mista mantém apenas DIFAL', async () => {
  const result = await processar(buildContext(), {
    sped: spedJaneiro([retroativa([['2556', '500,00'], ['2102', '300,00']])]),
  });
  assert.deepEqual(Object.keys(result.rowsByDestination), ['difal']);
  assert.equal(result.rowsByDestination.difal?.[0].v_total, 500);
  assert.deepEqual(result.cfopsSemRegra, {});
  assert.ok(result.avisosAvaliacao.some((aviso) => aviso.aviso === AVISO_RETROATIVA));
});

test('retroativa sem DIFAL continua ignorada', async () => {
  const result = await processar(buildContext(), {
    sped: spedJaneiro([retroativa([['2102', '300,00']]), nota901]),
  });
  const ignorada = result.notasIgnoradas.find((nota) => nota.numero_nota === '950');
  assert.ok(ignorada?.motivo.includes('fora do período informado'));
  assert.ok(!result.notasProcessadas.some((nota) => nota.numero_nota === '950'));
});

test('Simples não aceita DIFAL retroativa', async () => {
  const result = await processar(buildContext({ simples: true }), {
    sped: spedJaneiro([retroativa([['2556', '800,00']]), nota901]),
  });
  assert.ok(result.notasIgnoradas.some((nota) => nota.numero_nota === '950'));
  assert.ok(!result.notasProcessadas.some((nota) => nota.numero_nota === '950'));
});

test('Simples: bonificação sem entrada vai para DIFAL Antecipado', async () => {
  const result = await processar(
    buildContext({ simples: true }),
    {
      sped: spedJaneiro([nota901]),
      xmls: [['960.xml', xmlNfe('960', CHAVE_960, '400.00', '2026-01-25', '6911')]],
    },
    { [CHAVE_960]: false },
  );
  assert.equal(result.rowsByDestination.difal_antecipado?.length, 1);
  assert.equal(result.rowsByDestination.difal_antecipado?.[0].data_entrada, null);
  assert.ok(result.artifacts.some((artifact) => artifact.tipo === 'difal_antecipado'));
});

test('Regime Normal: bonificação sem entrada continua DIFAL', async () => {
  const result = await processar(
    buildContext(),
    {
      sped: spedJaneiro([nota901]),
      xmls: [['960.xml', xmlNfe('960', CHAVE_960, '400.00', '2026-01-25', '6911')]],
    },
    { [CHAVE_960]: false },
  );
  const nota = result.notasProcessadas.find((item) => item.numero_nota === '960');
  assert.equal(nota?.destino_planilha, 'difal');
  assert.equal(result.rowsByDestination.difal_antecipado, undefined);
});

const bonificacaoRetroativa = { numero: '970', chave: CHAVE_970, dtDoc: '20122025', dtEntrada: '06012026', itens: [['2911', '250,00']] as Array<[string, string]> };

test('pré-análise lista bonificação retroativa no Regime Normal', async () => {
  const result = await processar(buildContext(), { sped: spedJaneiro([bonificacaoRetroativa]) });
  assert.equal(result.preAnalysis.requer_decisao, true);
  assert.ok(result.preAnalysis.notas_bonificacao.some((nota) => nota.chave_acesso === CHAVE_970));
});

test('pré-análise do Simples não lista bonificação retroativa', async () => {
  const result = await processar(buildContext({ simples: true }), {
    sped: spedJaneiro([bonificacaoRetroativa, nota901]),
  });
  assert.ok(!result.preAnalysis.notas_bonificacao.some((nota) => nota.chave_acesso === CHAVE_970));
});
