import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSped } from '../src/lib/localProcessing/sped.ts';

test('parseSped não inclui frete na coluna de IPI em C170', () => {
  const sped = `|0000|019|0|01012026|31012026|Cliente BA|12345678000195||BA|123|2927408|||A|1|
|0150|F1|FORNECEDOR SP|1058|98765432000180||SP|3550308||R|1||C|
|0200|P1|PRODUTO|||UN|01|84713012|||18,00||
|C100|0|1|F1|55|00|1|125|35260198765432000180550010000001251000000125|10012026|20012026|1100,00|0|0,00|0,00|1000,00|0|100,00|0,00|0,00|1100,00|132,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|
|C170|1|P1|PRODUTO|1,000|UN|1000,00|0,00|0|000|6102||1100,00|12,00|132,00|0,00|0,00|0,00|0|50|999|0,00|0,00|0,00|
|9999|5|
`;

  const { notes } = parseSped(sped, 'sped.txt');
  assert.equal(notes.length, 1);
  const item = notes[0].itens[0];
  assert.equal(item.ipiDespesas, 0);
});
