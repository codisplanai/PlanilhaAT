import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveOriginRate } from '../src/lib/localProcessing/rules.ts';
import type { LocalProcessingContext } from '../src/types/localProcessing.ts';

function context(options: {
  aOriFixaParcial?: number | null;
  limitarAOriReducoes?: boolean;
} = {}): LocalProcessingContext {
  return {
    empresa: {
      id: 1,
      razao_social: 'Cliente BA LTDA',
      cnpj: '12345678000195',
      inscricao_estadual: null,
      uf: 'BA',
      perfil_regras_id: 1,
      optante_simples_nacional: false,
      a_ori_fixa_parcial: options.aOriFixaParcial,
    },
    perfil: {
      id: 1,
      nome: 'Padrão Geral',
      configuracoes_extras: { limitar_a_ori_reducoes: options.limitarAOriReducoes ?? false },
    },
    regras_aliquotas: [],
    regras_cfop: [],
    regras_reducao: [],
    regras_reclassificacao: [],
    regras_exclusao_parcial: [],
    margens_seguranca_templates: {},
    templates_ativos: [],
    mva_anexo: [],
  };
}

test('limita a A.ORI a 10% quando o A.DST vem de redução, exceção ou termo de acordo', () => {
  for (const rateOrigin of ['reducao_produto:3', 'excecao:9', 'termo_acordo:7']) {
    assert.deepEqual(
      resolveOriginRate(context({ limitarAOriReducoes: true }), 'antecipacao_parcial', 0.12, rateOrigin),
      { aOri: 0.10, limited: true, fixed: false },
      rateOrigin,
    );
  }
});

test('o limite de 10% também vale fora da Antecipação Parcial', () => {
  assert.deepEqual(
    resolveOriginRate(context({ limitarAOriReducoes: true }), 'antecipacao_tributaria', 0.12, 'termo_acordo:7'),
    { aOri: 0.10, limited: true, fixed: false },
  );
});

test('não limita a A.ORI quando o A.DST vem da regra padrão da UF', () => {
  assert.deepEqual(
    resolveOriginRate(context({ limitarAOriReducoes: true }), 'antecipacao_parcial', 0.12, 'padrao_uf:1'),
    { aOri: 0.12, limited: false, fixed: false },
  );
});

test('não altera A.ORI de até 10% no limite de reduções', () => {
  assert.deepEqual(
    resolveOriginRate(context({ limitarAOriReducoes: true }), 'antecipacao_parcial', 0.07, 'termo_acordo:7'),
    { aOri: 0.07, limited: false, fixed: false },
  );
});

test('não limita a A.ORI com o limite desligado no perfil', () => {
  assert.deepEqual(
    resolveOriginRate(context({ limitarAOriReducoes: false }), 'antecipacao_parcial', 0.12, 'termo_acordo:7'),
    { aOri: 0.12, limited: false, fixed: false },
  );
});

test('aplica a A.ORI fixa da empresa em todas as variantes da Antecipação Parcial', () => {
  for (const destination of [
    'antecipacao_parcial',
    'antecipacao_parcial_antecipado',
    'antecipacao_parcial_simples',
    'antecipacao_parcial_antecipado_simples',
  ] as const) {
    assert.deepEqual(
      resolveOriginRate(context({ aOriFixaParcial: 0.12 }), destination, 0.04, 'padrao_uf:1'),
      { aOri: 0.12, limited: false, fixed: true },
      destination,
    );
  }
});

test('mantém a A.ORI do XML fora da Antecipação Parcial', () => {
  for (const destination of ['antecipacao_tributaria', 'antecipacao_tributaria_antecipado', 'difal'] as const) {
    assert.deepEqual(
      resolveOriginRate(context({ aOriFixaParcial: 0.12 }), destination, 0.04, 'padrao_uf:1'),
      { aOri: 0.04, limited: false, fixed: false },
      destination,
    );
  }
});

test('mantém a A.ORI do XML quando a empresa não tem A.ORI fixa', () => {
  for (const aOriFixaParcial of [undefined, null]) {
    assert.deepEqual(
      resolveOriginRate(context({ aOriFixaParcial }), 'antecipacao_parcial', 0.07, 'padrao_uf:1'),
      { aOri: 0.07, limited: false, fixed: false },
      String(aOriFixaParcial),
    );
  }
});

test('aplica a A.ORI fixa mesmo quando o XML não destaca ICMS', () => {
  assert.deepEqual(
    resolveOriginRate(context({ aOriFixaParcial: 0.12 }), 'antecipacao_parcial', 0, 'padrao_uf:1'),
    { aOri: 0.12, limited: false, fixed: true },
  );
});

test('aplica uma A.ORI fixa de 0%', () => {
  assert.deepEqual(
    resolveOriginRate(context({ aOriFixaParcial: 0 }), 'antecipacao_parcial', 0.12, 'padrao_uf:1'),
    { aOri: 0, limited: false, fixed: true },
  );
});

test('a A.ORI fixa prevalece sobre o limite de 10% de reduções e termo de acordo', () => {
  assert.deepEqual(
    resolveOriginRate(
      context({ aOriFixaParcial: 0.12, limitarAOriReducoes: true }),
      'antecipacao_parcial',
      0.12,
      'termo_acordo:7',
    ),
    { aOri: 0.12, limited: false, fixed: true },
  );
});

test('o Convênio 52/91 prevalece sobre a A.ORI fixa', () => {
  assert.deepEqual(
    resolveOriginRate(context({ aOriFixaParcial: 0.12 }), 'antecipacao_parcial', 0.0514, 'convenio_52_91'),
    { aOri: 0.0514, limited: false, fixed: false },
  );
});
