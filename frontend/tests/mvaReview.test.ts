import test from 'node:test';
import assert from 'node:assert/strict';
import { validMvaDecision, manualMvaEngineValue, mvaReviewKey } from '../src/lib/localProcessing/mvaReview.ts';
import type { ExtractedItem, ExtractedNote } from '../src/lib/localProcessing/domain.ts';

test('MVA manual exige justificativa, número finito e não negativo',()=>{
  assert.equal(validMvaDecision({mva:90.15,justificativa:'Anexo 1, caso geral'}),true);
  assert.equal(validMvaDecision({mva:null,justificativa:'Base PMPF'}),true);
  for(const mva of [-1,NaN,Infinity,10001]) assert.equal(validMvaDecision({mva,justificativa:'Anexo 1'}),false);
  assert.equal(validMvaDecision({mva:90.15,justificativa:''}),false);
  assert.equal(manualMvaEngineValue(0.5),.005);
  assert.equal(manualMvaEngineValue(90.15),90.15);
});
test('decisão isolada por chave e item',()=>{
  const note={chaveAcesso:'1'.repeat(44)} as ExtractedNote;
  const item={itemNumero:1} as ExtractedItem;
  assert.notEqual(mvaReviewKey(note,item),mvaReviewKey(note,{...item,itemNumero:2}));
  assert.notEqual(mvaReviewKey(note,item),mvaReviewKey({...note,chaveAcesso:'2'.repeat(44)},item));
});
