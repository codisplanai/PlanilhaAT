import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isSimplesSupplier,
  parseSpedTaxCode,
  resolveInterstateRate,
  resolveSimpleOriginReference,
} from '../src/lib/localProcessing/interstateRate.ts';
import { parseSped } from '../src/lib/localProcessing/sped.ts';
import type { ExtractedItem, ExtractedNote } from '../src/lib/localProcessing/domain.ts';

function note(options: {
  crt?: string;
  csosn?: string;
  originUF?: string;
  sourceCode?: string;
  rate?: number;
} = {}): { note: ExtractedNote; item: ExtractedItem } {
  const item = {
    itemNumero: 1, aOri: options.rate ?? 0,
    origemMercadoria: options.sourceCode ?? '0', csosn: options.csosn ?? '',
  } as ExtractedItem;
  const n = {
    ufEmitente: options.originUF ?? 'SP', rawMetadata: { crt: options.crt ?? '' },
    itens: [item],
  } as ExtractedNote;
  return { note: n, item };
}

test('tabela interestadual aplica 4%, 7% e 12% com as UFs corretas', () => {
  assert.equal(resolveInterstateRate('SP', 'BA', '0'), 0.07);
  assert.equal(resolveInterstateRate('RS', 'ES', '0'), 0.07);
  assert.equal(resolveInterstateRate('PE', 'BA', '0'), 0.12);
  assert.equal(resolveInterstateRate('ES', 'BA', '0'), 0.12);
  assert.equal(resolveInterstateRate('MS', 'BA', '0'), 0.12);
  assert.equal(resolveInterstateRate('SP', 'RJ', '0'), 0.12);
  for (const code of ['1', '2', '3', '8']) {
    assert.equal(resolveInterstateRate('SP', 'BA', code), 0.04, code);
  }
  for (const code of ['', '6', '7']) {
    assert.equal(resolveInterstateRate('SP', 'BA', code), 0.07, code);
  }
  assert.throws(() => resolveInterstateRate('BA', 'BA', '0'), /não interestadual/);
  assert.throws(() => resolveInterstateRate('XX', 'BA', '0'), /inválida/);
});

test('lê origem + CSOSN apenas quando ambos vierem codificados no SPED', () => {
  assert.deepEqual(parseSpedTaxCode('1102'), { origemMercadoria: '1', csosn: '102' });
  assert.deepEqual(parseSpedTaxCode('0102'), { origemMercadoria: '0', csosn: '102' });
  assert.deepEqual(parseSpedTaxCode('102'), { origemMercadoria: '', csosn: '102' });
  assert.deepEqual(parseSpedTaxCode('060'), { origemMercadoria: '0', csosn: '' });
  assert.deepEqual(parseSpedTaxCode('2201'), { origemMercadoria: '2', csosn: '201' });
  assert.deepEqual(parseSpedTaxCode(''), { origemMercadoria: '', csosn: '' });
});

test('inferência do Simples só ocorre sem pICMS e em operação interestadual', () => {
  for (const crt of ['1', '2', '4']) {
    const { note: n, item } = note({ crt });
    assert.equal(isSimplesSupplier(n), true);
    assert.deepEqual(resolveSimpleOriginReference(n, item, 'BA', false), { rate: 0.07, inferred: true });
  }
  const withCsosn = note({ csosn: '102' });
  assert.deepEqual(resolveSimpleOriginReference(withCsosn.note, withCsosn.item, 'BA', false), { rate: 0.07, inferred: true });
  const imported = note({ crt: '1', sourceCode: '1' });
  assert.deepEqual(resolveSimpleOriginReference(imported.note, imported.item, 'BA', false), { rate: 0.04, inferred: true });
  const northeast = note({ crt: '1', originUF: 'PE' });
  assert.deepEqual(resolveSimpleOriginReference(northeast.note, northeast.item, 'BA', false), { rate: 0.12, inferred: true });

  for (const options of [{}, { crt: '1', rate: 0.025 }, { crt: '1', originUF: 'BA' }]) {
    const { note: n, item } = note(options);
    assert.deepEqual(resolveSimpleOriginReference(n, item, 'BA', false), { rate: item.aOri, inferred: false });
  }
  const agreement = note({ crt: '1' });
  assert.deepEqual(resolveSimpleOriginReference(agreement.note, agreement.item, 'BA', true), { rate: 0, inferred: false });
});

test('SPED C170 preserva origem importada; C190 propaga identificação do fornecedor', () => {
  const sped = `|0000|019|0|01012026|31012026|Cliente BA|12345678000195||BA|123|2927408|||A|1|
|0150|F1|FORNECEDOR SP|1058|98765432000180||SP|3550308||R|1||C|
|0200|P1|PRODUTO|||UN|01|84713012|||18,00||
|C100|0|1|F1|55|00|1|125|35260198765432000180550010000001251000000125|10012026|20012026|1100,00|0|0,00|0,00|1000,00|0|100,00|0,00|0,00|1100,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|
|C170|1|P1|PRODUTO|1,000|UN|1000,00|0,00|0|1102|6102||1000,00|0,00|0,00|0,00|0,00|0|50|999|0,00|0,00|0,00|
|C100|0|1|F1|55|00|1|126|35260198765432000180550010000001261000000126|11012026|20012026|500,00|0|0,00|0,00|500,00|0|0,00|0,00|0,00|500,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|
|C190|102|6102|0,00|500,00|0,00|0,00|0,00|0,00|0,00|
|9999|8|
`;
  const { notes } = parseSped(sped, 'sped.txt');
  assert.equal(notes.length, 2);
  assert.equal(notes[0].itens[0].origemMercadoria, '1');
  assert.equal(notes[0].itens[0].csosn, '102');
  assert.equal(notes[0].rawMetadata.fornecedor_simples_nacional, true);
  assert.equal(notes[1].itens[0].origemMercadoria, '');
  assert.equal(notes[1].rawMetadata.fornecedor_simples_nacional, true);
  assert.equal(resolveSimpleOriginReference(notes[0], notes[0].itens[0], 'BA', false).rate, 0.04);
  assert.equal(resolveSimpleOriginReference(notes[1], notes[1].itens[0], 'BA', false).rate, 0.07);
});
