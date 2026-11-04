import test from 'node:test';
import assert from 'node:assert/strict';
import { installDomParserPolyfill } from './domPolyfill.ts';
import { EMPRESA_CNPJ, buildContext, chave, processar, spedJaneiro, xmlNfe } from './localFixtures.ts';

installDomParserPolyfill();

const CHAVE_901 = chave('2601', 901);
const CHAVE_960 = chave('2601', 960);
const MOTIVO_INDUSTRIA =
  'Empresa industrial: não recolhe Antecipação Parcial nem Tributária '
  + '(apenas DIFAL de uso/consumo e ativo imobilizado).';
const MENSAGEM_SEM_PLANILHA =
  'Nenhuma planilha gerada: empresa industrial sem itens de uso/consumo ou ativo imobilizado (DIFAL)';

function sped(itens: Array<[string, string]>): string {
  return spedJaneiro([{ numero: '901', chave: CHAVE_901, dtDoc: '10012026', dtEntrada: '20012026', itens }]);
}

const industria = () => buildContext({ atividade: 'industria' });
const xml960 = (): [string, string] => ['960.xml', xmlNfe('960', CHAVE_960, '400.00', '2026-01-25', '6911')];

test('indústria: revenda vai para excluídos', async () => {
  const result = await processar(industria(), { sped: sped([['2102', '1000,00']]) });
  assert.equal(result.notasProcessadas.length, 0);
  assert.equal(result.artifacts.length, 0);
  assert.equal(result.itensExcluidos.length, 1);
  assert.equal(result.itensExcluidos[0].tipo_exclusao, 'industria_sem_antecipacao');
  assert.equal(result.itensExcluidos[0].motivo, MOTIVO_INDUSTRIA);
  assert.equal(result.mensagem, MENSAGEM_SEM_PLANILHA);
});

test('indústria: nota mista gera DIFAL e exclui revenda', async () => {
  const result = await processar(industria(), { sped: sped([['2556', '500,00'], ['2102', '300,00']]) });
  assert.deepEqual(Object.keys(result.rowsByDestination), ['difal']);
  assert.equal(result.rowsByDestination.difal?.[0].v_total, 500);
  assert.deepEqual(result.itensExcluidos.map((item) => item.tipo_exclusao), ['industria_sem_antecipacao']);
});

test('indústria: tributária vai para excluídos', async () => {
  const result = await processar(industria(), { sped: sped([['2556', '500,00'], ['2403', '300,00']]) });
  assert.deepEqual(Object.keys(result.rowsByDestination), ['difal']);
  assert.deepEqual(result.itensExcluidos.map((item) => item.tipo_exclusao), ['industria_sem_antecipacao']);
});

test('indústria: bonificação confirmada vai para DIFAL', async () => {
  const result = await processar(industria(), { xmls: [xml960()] }, { [CHAVE_960]: false });
  assert.deepEqual(result.notasProcessadas.map((nota) => nota.destino_planilha), ['difal']);
});

test('indústria: bonificação negada vai para excluídos', async () => {
  const result = await processar(industria(), { xmls: [xml960()] }, { [CHAVE_960]: true });
  assert.equal(result.notasProcessadas.length, 0);
  assert.equal(result.itensExcluidos[0].tipo_exclusao, 'industria_sem_antecipacao');
  assert.equal(
    result.itensExcluidos[0].motivo,
    'Bonificação/amostra/outras entradas (CFOP 6911) não confirmada como uso/consumo pelo usuário (empresa industrial).',
  );
});

test('indústria: política passo a passo não gera Tributária', async () => {
  const context = industria();
  context.perfil.configuracoes_extras = {
    mva_revenda_antecipacao_tributaria: {
      enabled: true,
      empresa_cnpj: EMPRESA_CNPJ,
      special_ncms: [],
      description_fallback_ncms: [],
      special_keywords: [],
      exclusion_keywords: [],
      mvas: {
        especial: { '4': '61.81', '7': '56.75', '12': '48.33', original: '34.00' },
        demais: { '4': '69.06', '7': '63.77', '12': '54.97', original: '40.00' },
      },
    },
  };
  const result = await processar(context, { sped: sped([['2556', '500,00'], ['2102', '300,00']]) });
  assert.deepEqual(Object.keys(result.rowsByDestination), ['difal']);
  assert.deepEqual(result.itensExcluidos.map((item) => item.tipo_exclusao), ['industria_sem_antecipacao']);
});

test('comércio inalterado', async () => {
  const result = await processar(buildContext(), { sped: sped([['2102', '1000,00']]) });
  assert.deepEqual(Object.keys(result.rowsByDestination), ['antecipacao_parcial']);
  assert.equal(result.itensExcluidos.length, 0);
});
