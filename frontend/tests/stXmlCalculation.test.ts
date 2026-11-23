import test from 'node:test';
import assert from 'node:assert/strict';
import { totalSemStXml, stIntegralmenteCobertoPorItem } from '../src/lib/localProcessing/stXmlCalculation.ts';
import type { ExtractedItem, ExtractedNote } from '../src/lib/localProcessing/domain.ts';
const item = {baseSemIpi:100,baseCalculoXml:100,aOri:.12,vIcms:12,ipiDespesas:0,vIcmsSt:26.98,
  stXml:{cfop:'6403',modalidade:'4',mva:90.15,aliquota:20.5,base:190.15,valor:26.98}
} as ExtractedItem;
test('não reaplica MVA ao ICMS-ST incluído no total da nota',()=>{
  const note={vTotalNota:126.98,vStNota:26.98,rawMetadata:{icms_st_xml:26.98},itens:[{...item,vIpi:0}]} as ExtractedNote;
  assert.equal(totalSemStXml(note),100);
  assert.equal(totalSemStXml({...note,rawMetadata:{}}),126.98);
  assert.equal(totalSemStXml({...note,vTotalNota:100}),100);
});
test('só reconhece cobertura integral quando base, alíquotas e ST por item coincidem',()=>{
  const check=(i:ExtractedItem)=>stIntegralmenteCobertoPorItem([i],90.15,.12,.205,null,null,100,100,i.vIcmsSt??0);
  assert.deepEqual(check(item),{debito:38.98,credito:12});
  assert.equal(check({...item,stXml:undefined}),null);
  assert.equal(check({...item,vIcmsSt:26.97,stXml:{...item.stXml!,valor:26.97}}),null);
  assert.equal(check({...item,stXml:{...item.stXml!,base:190.14}}),null);
  assert.equal(check({...item,ipiDespesas:1}),null);
});
