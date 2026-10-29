import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveDestinationRate } from '../src/lib/localProcessing/rules.ts';
import type { ExtractedItem } from '../src/lib/localProcessing/domain.ts';
import type { LocalProcessingContext } from '../src/types/localProcessing.ts';

function createDifalContext(): LocalProcessingContext {
  return {
    empresa: {
      id: 1,
      razao_social: 'Empresa Teste DIFAL LTDA',
      cnpj: '12345678000195',
      inscricao_estadual: null,
      uf: 'BA',
      perfil_regras_id: 1,
      optante_simples_nacional: false,
      a_ori_fixa_parcial: null,
      termo_acordo: {
        id: 77,
        empresa_id: 1,
        aliquota: 0.1206,
        descricao: 'Termo de Acordo Especial 12.06%',
      },
    },
    perfil: {
      id: 1,
      nome: 'Perfil Teste',
      configuracoes_extras: {},
    },
    regras_aliquotas: [
      {
        id: 10,
        perfil_regras_id: 1,
        uf: 'BA',
        ncm: null,
        aliquota: 0.205,
      },
      {
        id: 11,
        perfil_regras_id: 1,
        uf: 'BA',
        ncm: '72142000',
        aliquota: 0.18,
      },
    ],
    regras_cfop: [],
    regras_reducao: [
      {
        id: 5,
        perfil_regras_id: 1,
        ncm: '72142000',
        termos_inclusao: ['VERGALHAO'],
        termos_exclusao: [],
        aliquota: 0.12,
        descricao: 'Redução Vergalhão 12%',
      },
    ],
    regras_reclassificacao: [],
    regras_exclusao_parcial: [],
    margens_seguranca_templates: {},
    templates_ativos: [],
    mva_anexo: [],
  };
}

function createItem(): ExtractedItem {
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

test('DIFAL: ignora termo de acordo, redução por produto e NCM, usando a alíquota padrão da UF (20.5%)', () => {
  const ctx = createDifalContext();
  const item = createItem();

  const resDifal = resolveDestinationRate(ctx, item, 'difal');
  assert.equal(resDifal.aliquota, 0.205);
  assert.equal(resDifal.origem, 'padrao_uf:10');
});

test('Não-DIFAL: usa regras de redução por produto normalmente na Parcial e Tributária', () => {
  const ctx = createDifalContext();
  const item = createItem();

  const resParcial = resolveDestinationRate(ctx, item, 'antecipacao_parcial');
  assert.equal(resParcial.aliquota, 0.12);
  assert.equal(resParcial.origem, 'reducao_produto:5');

  const resTributaria = resolveDestinationRate(ctx, item, 'antecipacao_tributaria');
  assert.equal(resTributaria.aliquota, 0.12);
  assert.equal(resTributaria.origem, 'reducao_produto:5');
});

test('Antecipação Tributária (normal e antecipado): ignora termo de acordo e usa NCM ou padrão UF', () => {
  const ctx = createDifalContext();
  const itemGenerico: ExtractedItem = {
    ...createItem(),
    ncm: '39269090',
    descricao: 'PECA PLASTICA',
  };

  // Na Parcial sem redução de produto: usa termo de acordo (12.06%)
  const resParcial = resolveDestinationRate(ctx, itemGenerico, 'antecipacao_parcial');
  assert.equal(resParcial.aliquota, 0.1206);
  assert.equal(resParcial.origem, 'termo_acordo:77');

  // Na Tributária normal: ignora termo de acordo e cai na alíquota padrão da UF (20.5%)
  const resTributaria = resolveDestinationRate(ctx, itemGenerico, 'antecipacao_tributaria');
  assert.equal(resTributaria.aliquota, 0.205);
  assert.equal(resTributaria.origem, 'padrao_uf:10');

  // Na Tributária Paga Antecipadamente: também ignora termo de acordo e cai no padrão da UF (20.5%)
  const resTributariaAntecipado = resolveDestinationRate(ctx, itemGenerico, 'antecipacao_tributaria_antecipado');
  assert.equal(resTributariaAntecipado.aliquota, 0.205);
  assert.equal(resTributariaAntecipado.origem, 'padrao_uf:10');
});
