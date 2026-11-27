import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildTemplateMapping,
  getDefaultTemplateLayout,
  requiredTemplateColumns,
} from '../src/lib/templateMapping.ts';
import type { TipoPlanilha } from '../src/types/solicitacao.ts';

// Colunas dos modelos oficiais, copiadas dos mapeamentos de app/core/seeds.py:
// o layout sugerido pela tela de modelos precisa reproduzi-las.
const PARCIAL = {
  item_index: 'A', data_entrada: 'B', data_emissao: 'C', numero_nota: 'D', v_total: 'E',
  base_calculo: 'F', ipi_despesas: 'G', a_dst: 'H', a_ori: 'I',
};
const TRIBUTARIA = {
  item_index: 'A', data_entrada: 'B', data_emissao: 'C', numero_nota: 'D', v_total: 'E',
  base_calculo: 'F', ipi_despesas: 'G', mva: 'H', reducao: 'I', a_dst: 'J', a_ori: 'K', red: 'L', valor_pago: 'S',
};
const DIFAL = {
  item_index: 'A', data_entrada: 'B', data_emissao: 'C', numero_nota: 'D', v_total: 'E',
  ipi_despesas: 'F', aliq_simples: 'G', a_dst: 'I', a_ori: 'J',
};

const MODELOS_OFICIAIS: Array<[TipoPlanilha, Record<string, string>]> = [
  ['antecipacao_parcial', PARCIAL],
  ['antecipacao_parcial_antecipado', PARCIAL],
  ['antecipacao_parcial_simples', PARCIAL],
  ['antecipacao_parcial_antecipado_simples', PARCIAL],
  ['antecipacao_tributaria', TRIBUTARIA],
  ['antecipacao_tributaria_antecipado', TRIBUTARIA],
  ['difal', DIFAL],
  ['difal_antecipado', DIFAL],
];

for (const [tipo, colunas] of MODELOS_OFICIAIS) {
  test(`layout sugerido de ${tipo} reproduz as colunas do modelo oficial`, () => {
    const mapping = buildTemplateMapping(tipo, getDefaultTemplateLayout(tipo));
    assert.deepEqual(mapping.columns, colunas);
    assert.equal(mapping.start_row, 4);
    assert.equal(mapping.header_cell, 'A2');
    assert.deepEqual(mapping.extra_options, { header_cell: 'A2', aliquota_format: 'percent_number' });
  });
}

test('capacidade sugerida e controle sem numeração presumida', () => {
  assert.equal(getDefaultTemplateLayout('antecipacao_tributaria_antecipado').capacidade_linhas, 35);
  assert.equal(getDefaultTemplateLayout('antecipacao_parcial').capacidade_linhas, 100);
  const controle = buildTemplateMapping('controle_imposto_pago_entrada', getDefaultTemplateLayout('controle_imposto_pago_entrada'));
  assert.equal(controle.columns.item_index, undefined);
  assert.equal(controle.columns.base_calculo, 'F');
});

test('mapeamento: letras em maiúsculas, campos vazios omitidos e cabeçalho padrão A2', () => {
  const mapping = buildTemplateMapping('difal', {
    ...getDefaultTemplateLayout('difal'),
    col_numero_nota: 'd',
    col_item_index: ' ',
    col_data_entrada: '',
    col_aliq_simples: 'g',
    header_cell: '',
  });
  assert.deepEqual(mapping.columns, { numero_nota: 'D', data_emissao: 'C', v_total: 'E', a_dst: 'I', a_ori: 'J', ipi_despesas: 'F', aliq_simples: 'G' });
  assert.equal(mapping.header_cell, 'A2');
});

test('RED. e Alíq. Simples só entram nos modelos do próprio tipo', () => {
  const parcial = buildTemplateMapping('antecipacao_parcial', {
    ...getDefaultTemplateLayout('antecipacao_parcial'),
    col_red: 'L',
    col_aliq_simples: 'G',
  });
  assert.equal(parcial.columns.red, undefined);
  assert.equal(parcial.columns.aliq_simples, undefined);
  assert.equal(parcial.columns.ipi_despesas, 'G');
});

test('Tributária sempre leva redução e valor pago (coluna S)', () => {
  const mapping = buildTemplateMapping('antecipacao_tributaria', {
    ...getDefaultTemplateLayout('antecipacao_tributaria'),
    col_reducao: '',
  });
  assert.equal(mapping.columns.reducao, 'I');
  assert.equal(mapping.columns.valor_pago, 'S');
  assert.deepEqual(requiredTemplateColumns('antecipacao_tributaria'), ['numero_nota', 'data_emissao', 'v_total', 'a_dst', 'a_ori', 'mva', 'reducao']);
  assert.deepEqual(requiredTemplateColumns('difal'), ['numero_nota', 'data_emissao', 'v_total', 'a_dst', 'a_ori']);
});
