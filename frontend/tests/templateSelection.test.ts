import assert from 'node:assert/strict';
import test from 'node:test';

import { selectTemplateForRows } from '../src/lib/localProcessing/templateSelection.ts';
import type { LocalTemplateDescriptor } from '../src/types/localProcessing.ts';

function template(
  id: number,
  capacidade: number | null,
  versao = 1,
): LocalTemplateDescriptor {
  return {
    id,
    tipo: 'difal',
    versao,
    capacidade_linhas: capacidade,
    arquivo_hash: `hash-${id}`,
    mapeamento_campos: {
      start_row: 4,
      columns: { numero_nota: 'A' },
    },
  };
}

test('seleciona a menor capacidade que comporta as linhas', () => {
  const templates = [
    template(1, 100),
    template(2, 300),
    template(3, 1000),
  ];

  assert.equal(selectTemplateForRows(templates, 'difal', 1)?.id, 1);
  assert.equal(selectTemplateForRows(templates, 'difal', 100)?.id, 1);
  assert.equal(selectTemplateForRows(templates, 'difal', 101)?.id, 2);
  assert.equal(selectTemplateForRows(templates, 'difal', 300)?.id, 2);
  assert.equal(selectTemplateForRows(templates, 'difal', 301)?.id, 3);
});

test('bloqueia quando a demanda supera a maior capacidade oficial', () => {
  assert.throws(
    () => selectTemplateForRows([template(1, 100), template(2, 300)], 'difal', 301),
    /necessita de 301 linhas.*suporta 300 linhas/,
  );
});

test('usa modelo legado apenas quando não existem capacidades cadastradas', () => {
  const legacyV1 = template(1, null, 1);
  const legacyV2 = template(2, null, 2);
  assert.equal(
    selectTemplateForRows([legacyV1, legacyV2], 'difal', 5000)?.id,
    legacyV2.id,
  );
});

test('capacidades cadastradas prevalecem sobre modelo legado', () => {
  assert.throws(
    () => selectTemplateForRows(
      [template(1, null, 9), template(2, 100, 1)],
      'difal',
      101,
    ),
    /maior modelo oficial cadastrado suporta 100 linhas/,
  );
});

test('aplica margem opcional antes de selecionar a capacidade', () => {
  const templates = [
    template(1, 100),
    template(2, 300),
    template(3, 1000),
  ];

  assert.equal(selectTemplateForRows(templates, 'difal', 95, 5)?.id, 1);
  assert.equal(selectTemplateForRows(templates, 'difal', 96, 5)?.id, 2);
  assert.equal(selectTemplateForRows(templates, 'difal', 100, 0)?.id, 1);
});

test('informa linhas reais, margem e capacidade necessária quando não cabe', () => {
  assert.throws(
    () => selectTemplateForRows(
      [template(1, 100), template(2, 300)],
      'difal',
      296,
      5,
    ),
    /296 linhas \+ 5 linhas de segurança = 301.*suporta 300 linhas/,
  );
});

