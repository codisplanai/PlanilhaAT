import assert from 'node:assert/strict';
import test, { describe, it } from 'node:test';
import type { ExtractedItem, ExtractedNote } from '../src/lib/localProcessing/domain.ts';

test('Tipagem de Desconto no Domínio: permite armazenar vDesc no item e vDescNota na nota', () => {
  const item: ExtractedItem = {
    itemNumero: 1,
    ncm: '84189900',
    cest: '',
    cfop: '6102',
    descricao: 'Item Teste',
    descricaoConfiavel: true,
    vItem: 8268,
    vTotal: 7275.84,
    baseCalculo: 7275.84,
    ipiDespesas: 0,
    aOri: 0.12,
    vIcms: 873.1,
    vDesc: 992.16,
  };
  assert.equal(item.vDesc, 992.16);

  const note: Partial<ExtractedNote> = {
    vTotalNota: 7275.84,
    vDescNota: 992.16,
  };
  assert.equal(note.vDescNota, 992.16);
});
