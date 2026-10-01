import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveOriginRate, shouldExcludeEqualRates } from '../src/lib/localProcessing/rules.ts';
import type { ExtractedItem } from '../src/lib/localProcessing/domain.ts';
import type { LocalProcessingContext } from '../src/types/localProcessing.ts';

const PARCIAL = [
  'antecipacao_parcial',
  'antecipacao_parcial_antecipado',
  'antecipacao_parcial_simples',
  'antecipacao_parcial_antecipado_simples',
] as const;

function context(options: {
  aOriFixaParcial?: number | null;
  limitarAOriReducoes?: boolean;
  aliquotasIguaisBA?: boolean;
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
      configuracoes_extras: {
        limitar_a_ori_reducoes: options.limitarAOriReducoes ?? false,
        politica_aliquotas_iguais_parcial: { BA: options.aliquotasIguaisBA ?? false },
      },
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

function item(): ExtractedItem {
  return {
    itemNumero: 1,
    ncm: '72142000',
    cest: '',
    cfop: '6102',
    descricao: 'VERGALHAO CA-50',
    descricaoConfiavel: true,
    vItem: 1000,
    vTotal: 1000,
    baseCalculo: 1000,
    ipiDespesas: 0,
    aOri: 0.12,
    vIcms: 120,
  };
}

test('limita a A.ORI a 10% quando o A.DST vem de redução, exceção ou termo de acordo', () => {
  for (const rateOrigin of ['reducao_produto:3', 'excecao:9', 'termo_acordo:7']) {
    assert.deepEqual(
      resolveOriginRate(context({ limitarAOriReducoes: true }), 'antecipacao_parcial', 0.12, 0.18, rateOrigin),
      { aOri: 0.10, limited: true, fixed: false, limitWaived: false },
      rateOrigin,
    );
  }
});

test('o limite de 10% também vale fora da Antecipação Parcial', () => {
  assert.deepEqual(
    resolveOriginRate(context({ limitarAOriReducoes: true }), 'antecipacao_tributaria', 0.12, 0.18, 'termo_acordo:7'),
    { aOri: 0.10, limited: true, fixed: false, limitWaived: false },
  );
});

test('não limita a A.ORI quando o A.DST vem da regra padrão da UF', () => {
  assert.deepEqual(
    resolveOriginRate(context({ limitarAOriReducoes: true }), 'antecipacao_parcial', 0.12, 0.205, 'padrao_uf:1'),
    { aOri: 0.12, limited: false, fixed: false, limitWaived: false },
  );
});

test('não altera A.ORI de até 10% no limite de reduções', () => {
  assert.deepEqual(
    resolveOriginRate(context({ limitarAOriReducoes: true }), 'antecipacao_parcial', 0.07, 0.18, 'termo_acordo:7'),
    { aOri: 0.07, limited: false, fixed: false, limitWaived: false },
  );
});

test('não limita a A.ORI com o limite desligado no perfil', () => {
  assert.deepEqual(
    resolveOriginRate(context({ limitarAOriReducoes: false }), 'antecipacao_parcial', 0.12, 0.18, 'termo_acordo:7'),
    { aOri: 0.12, limited: false, fixed: false, limitWaived: false },
  );
});

test('aplica a A.ORI fixa da empresa em todas as variantes da Antecipação Parcial', () => {
  for (const destination of PARCIAL) {
    assert.deepEqual(
      resolveOriginRate(context({ aOriFixaParcial: 0.12 }), destination, 0.04, 0.205, 'padrao_uf:1'),
      { aOri: 0.12, limited: false, fixed: true, limitWaived: false },
      destination,
    );
  }
});

test('mantém a A.ORI do XML fora da Antecipação Parcial', () => {
  for (const destination of ['antecipacao_tributaria', 'antecipacao_tributaria_antecipado', 'difal'] as const) {
    assert.deepEqual(
      resolveOriginRate(context({ aOriFixaParcial: 0.12 }), destination, 0.04, 0.205, 'padrao_uf:1'),
      { aOri: 0.04, limited: false, fixed: false, limitWaived: false },
      destination,
    );
  }
});

test('mantém a A.ORI do XML quando a empresa não tem A.ORI fixa', () => {
  for (const aOriFixaParcial of [undefined, null]) {
    assert.deepEqual(
      resolveOriginRate(context({ aOriFixaParcial }), 'antecipacao_parcial', 0.07, 0.205, 'padrao_uf:1'),
      { aOri: 0.07, limited: false, fixed: false, limitWaived: false },
      String(aOriFixaParcial),
    );
  }
});

test('aplica a A.ORI fixa mesmo quando o XML não destaca ICMS', () => {
  assert.deepEqual(
    resolveOriginRate(context({ aOriFixaParcial: 0.12 }), 'antecipacao_parcial', 0, 0.205, 'padrao_uf:1'),
    { aOri: 0.12, limited: false, fixed: true, limitWaived: false },
  );
});

test('aplica uma A.ORI fixa de 0%', () => {
  assert.deepEqual(
    resolveOriginRate(context({ aOriFixaParcial: 0 }), 'antecipacao_parcial', 0.12, 0.205, 'padrao_uf:1'),
    { aOri: 0, limited: false, fixed: true, limitWaived: false },
  );
});

test('a A.ORI fixa prevalece sobre o limite de 10% de reduções e termo de acordo', () => {
  assert.deepEqual(
    resolveOriginRate(
      context({ aOriFixaParcial: 0.12, limitarAOriReducoes: true }),
      'antecipacao_parcial',
      0.12,
      0.1206,
      'termo_acordo:7',
    ),
    { aOri: 0.12, limited: false, fixed: true, limitWaived: false },
  );
});

test('o Convênio 52/91 prevalece sobre a A.ORI fixa', () => {
  assert.deepEqual(
    resolveOriginRate(context({ aOriFixaParcial: 0.12 }), 'antecipacao_parcial', 0.0514, 0.088, 'convenio_52_91'),
    { aOri: 0.0514, limited: false, fixed: false, limitWaived: false },
  );
});

test('dispensa o limite de 10% na Parcial quando a A.ORI do XML é igual à A.DST', () => {
  for (const destination of PARCIAL) {
    for (const rateOrigin of ['reducao_produto:3', 'excecao:9', 'termo_acordo:7']) {
      assert.deepEqual(
        resolveOriginRate(context({ limitarAOriReducoes: true }), destination, 0.12, 0.12, rateOrigin),
        { aOri: 0.12, limited: false, fixed: false, limitWaived: true },
        `${destination} ${rateOrigin}`,
      );
    }
  }
});

test('mantém o limite de 10% com alíquotas iguais fora da Parcial', () => {
  for (const destination of ['antecipacao_tributaria', 'antecipacao_tributaria_antecipado', 'difal'] as const) {
    assert.deepEqual(
      resolveOriginRate(context({ limitarAOriReducoes: true }), destination, 0.12, 0.12, 'reducao_produto:3'),
      { aOri: 0.10, limited: true, fixed: false, limitWaived: false },
      destination,
    );
  }
});

test('mantém o limite de 10% quando a A.DST é diferente da A.ORI do XML', () => {
  for (const aDst of [0.1206, 0.18, 0.10]) {
    assert.deepEqual(
      resolveOriginRate(context({ limitarAOriReducoes: true }), 'antecipacao_parcial', 0.12, aDst, 'reducao_produto:3'),
      { aOri: 0.10, limited: true, fixed: false, limitWaived: false },
      String(aDst),
    );
  }
});

test('só dispensa o limite quando ele está ligado no perfil', () => {
  assert.deepEqual(
    resolveOriginRate(context({ limitarAOriReducoes: false }), 'antecipacao_parcial', 0.12, 0.12, 'reducao_produto:3'),
    { aOri: 0.12, limited: false, fixed: false, limitWaived: false },
  );
});

test('considera iguais as alíquotas que diferem só por arredondamento', () => {
  assert.deepEqual(
    resolveOriginRate(context({ limitarAOriReducoes: true }), 'antecipacao_parcial', 0.12, 0.1 + 0.02, 'reducao_produto:3'),
    { aOri: 0.12, limited: false, fixed: false, limitWaived: true },
  );
});

test('exclui da Parcial o item com redução a 12% e XML a 12%', () => {
  const ctx = context({ limitarAOriReducoes: true, aliquotasIguaisBA: true });
  const { aOri } = resolveOriginRate(ctx, 'antecipacao_parcial', 0.12, 0.12, 'reducao_produto:3');
  assert.deepEqual(
    shouldExcludeEqualRates(ctx, 'antecipacao_parcial', item(), aOri, 0.12),
    { excluded: true, debito: 120, credito: 120, valorDevido: 0 },
  );
});

test('a exclusão por alíquotas iguais usa a mesma tolerância de arredondamento', () => {
  const ctx = context({ aliquotasIguaisBA: true });
  assert.equal(shouldExcludeEqualRates(ctx, 'antecipacao_parcial', item(), 0.12, 0.1 + 0.02).excluded, true);
  assert.equal(shouldExcludeEqualRates(ctx, 'antecipacao_parcial', item(), 0.10, 0.1206).excluded, false);
});
