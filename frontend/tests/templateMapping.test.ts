import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildTemplateMapping,
  getDefaultTemplateLayout,
  requiredTemplateColumns,
} from '../src/lib/templateMapping.ts';

// Os valores abaixo são os que a tela de modelos montava antes de a lógica sair
// dela para ser compartilhada com o conector da IA.

test('layout padrão por tipo de planilha', () => {
  const parcial = getDefaultTemplateLayout('antecipacao_parcial');
  assert.equal(parcial.capacidade_linhas, 100);
  assert.equal(parcial.col_base_calculo, 'F');
  assert.equal(parcial.col_ipi_despesas, 'G');
  assert.equal(parcial.col_a_dst, 'H');
  assert.equal(parcial.col_a_ori, 'I');

  const difal = getDefaultTemplateLayout('difal');
  assert.equal(difal.col_base_calculo, '');
  assert.equal(difal.col_ipi_despesas, 'F');
  assert.equal(difal.col_a_dst, 'I');
  assert.equal(difal.col_a_ori, 'J');

  const tributariaAntecipado = getDefaultTemplateLayout('antecipacao_tributaria_antecipado');
  assert.equal(tributariaAntecipado.capacidade_linhas, 35);
  assert.equal(tributariaAntecipado.col_mva, 'H');
  assert.equal(tributariaAntecipado.col_reducao, 'I');
  assert.equal(tributariaAntecipado.col_a_dst, 'J');
  assert.equal(tributariaAntecipado.col_a_ori, 'K');

  assert.equal(getDefaultTemplateLayout('controle_imposto_pago_entrada').col_base_calculo, 'F');
});

test('mapeamento enviado ao backend: colunas em maiúsculas, vazias omitidas e cabeçalho em A2', () => {
  const mapping = buildTemplateMapping('difal', {
    ...getDefaultTemplateLayout('difal'),
    col_numero_nota: 'd',
    col_data_entrada: '',
    header_cell: '',
  });
  assert.deepEqual(mapping, {
    start_row: 4,
    columns: { numero_nota: 'D', data_emissao: 'C', v_total: 'E', a_dst: 'I', a_ori: 'J', ipi_despesas: 'F' },
    header_cell: 'A2',
    extra_options: { header_cell: 'A2', aliquota_format: 'percent_number' },
  });
});

test('Tributária sempre leva redução e valor pago (coluna S)', () => {
  const mapping = buildTemplateMapping('antecipacao_tributaria', {
    ...getDefaultTemplateLayout('antecipacao_tributaria'),
    col_reducao: '',
  });
  assert.equal(mapping.columns.reducao, 'I');
  assert.equal(mapping.columns.valor_pago, 'S');
  assert.equal(mapping.columns.mva, 'H');
  assert.deepEqual(requiredTemplateColumns('antecipacao_tributaria'), ['numero_nota', 'data_emissao', 'v_total', 'a_dst', 'a_ori', 'mva', 'reducao']);
  assert.deepEqual(requiredTemplateColumns('difal'), ['numero_nota', 'data_emissao', 'v_total', 'a_dst', 'a_ori']);
});
