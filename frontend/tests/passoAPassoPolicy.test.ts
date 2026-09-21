import assert from 'node:assert/strict';
import test from 'node:test';

import {
  classifyRevendaMva,
  getRevendaAntecipacaoConfig,
  redirectRevendaToAntecipacaoTributaria,
  routePaidEarlyDestination,
  resolveRevendaMva,
} from '../src/lib/localProcessing/rules.ts';
import type { ExtractedItem } from '../src/lib/localProcessing/domain.ts';
import type { LocalProcessingContext } from '../src/types/localProcessing.ts';
import type { MvaAntecipacaoTributariaConfig } from '../src/types/perfil.ts';

const config: MvaAntecipacaoTributariaConfig = {
  enabled: true,
  empresa_cnpj: '33906322000153',
  special_ncms: ['64039990'],
  description_fallback_ncms: ['62171000'],
  special_keywords: ['CINTO', 'CINTOS'],
  exclusion_keywords: ['MOCHILA', 'PALMILHA'],
  mvas: {
    especial: { '4': '61.81', '7': '56.75', '12': '48.33', original: '34.00' },
    demais: { '4': '69.06', '7': '63.77', '12': '54.97', original: '40.00' },
  },
};

function context(cnpj = '33906322000153'): LocalProcessingContext {
  return {
    empresa: {
      id: 1,
      razao_social: 'Passo a Passo Calçados',
      cnpj,
      inscricao_estadual: '26058360',
      uf: 'BA',
      perfil_regras_id: 1,
      optante_simples_nacional: false,
    },
    perfil: {
      id: 1,
      nome: 'Passo a Passo Calçados',
      configuracoes_extras: { mva_revenda_antecipacao_tributaria: config },
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

const shoe: ExtractedItem = {
  itemNumero: 1,
  ncm: '64039990',
  cest: '',
  cfop: '6102',
  descricao: 'CALÇADO FEMININO',
  descricaoConfiavel: true,
  vItem: 1000,
  vTotal: 1000,
  baseCalculo: 1000,
  ipiDespesas: 0,
  aOri: 0.07,
  vIcms: 70,
};

test('ativa a política somente para o CNPJ configurado', () => {
  assert.equal(getRevendaAntecipacaoConfig(context())?.empresa_cnpj, config.empresa_cnpj);
  assert.equal(getRevendaAntecipacaoConfig(context('12345678000195')), null);
});

test('redireciona toda revenda da Passo a Passo para Antecipação Tributária', () => {
  const active = getRevendaAntecipacaoConfig(context());
  assert.equal(
    redirectRevendaToAntecipacaoTributaria(active, 'antecipacao_parcial'),
    'antecipacao_tributaria',
  );
  assert.equal(redirectRevendaToAntecipacaoTributaria(active, 'difal'), 'difal');
});

test('separa a antecipação tributária paga antecipadamente', () => {
  assert.equal(
    routePaidEarlyDestination('antecipacao_tributaria', true),
    'antecipacao_tributaria_antecipado',
  );
  assert.equal(
    routePaidEarlyDestination('antecipacao_tributaria', false),
    'antecipacao_tributaria',
  );
  assert.equal(routePaidEarlyDestination('difal', true), 'difal');
});

test('classifica o produto e usa as MVAs exclusivas inclusive para fornecedor Simples', () => {
  const classification = classifyRevendaMva(config, shoe);
  assert.deepEqual(classification, { grupo: 'especial', fonte: 'ncm_exato' });
  assert.equal(resolveRevendaMva(config, classification.grupo, 0.07, false), 56.75);
  assert.equal(resolveRevendaMva(config, classification.grupo, 0.07, true), 34);
});
