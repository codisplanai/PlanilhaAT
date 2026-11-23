import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveAutopecasMvaXml } from '../src/lib/localProcessing/autopecasMva.ts';
import type { ExtractedItem, ExtractedNote } from '../src/lib/localProcessing/domain.ts';
import type { LocalProcessingContext } from '../src/types/localProcessing.ts';

const context = {
  empresa: { uf: 'BA', razao_social: 'Comercio Auto Pecas Teste' },
  mva_anexo: [
    {ncm:'7318',cest:['10.058.00']},
    ...[['8708','0107500'],['8511','0105400'],['85443000','0107300'],['90322000','0112600'],['40169990','0100900'],['','0199900']].map(([ncm,cest])=>({
      ncm,cest:[cest],autopecas:true,vigencia_inicio:'2026-01-01',vigencia_fim:'2026-12-31',
      mva_ajustada:[{caso:'fidelidade',aliquotas:{'12':51.16}},{caso:'demais',aliquotas:{'12':90.15}}],
    })),
  ],
} as LocalProcessingContext;
const note = { ufEmitente: 'SE', dataEmissao: '2026-10-15T10:00:00',
  rawMetadata: { crt: '3', emit_nome: 'Fornecedor Auto Pecas Teste' } } as ExtractedNote;
const item = {
  ncm: '87089990', cest: '0107500', cfop: '6403', cstIcms: '10',
  descricao: 'PECA AUTOMOTIVA', descricaoConfiavel: true,
  stXml: { cfop: '6403', modalidade: '4', mva: 90.15, aliquota: 20.5, base: 190.15, valor: 26.98 },
} as ExtractedItem;
const resolve = (i: ExtractedItem = item, n: ExtractedNote = note, c: LocalProcessingContext = context) =>
  resolveAutopecasMvaXml(c, n, i, 'ajustada', 0.12, 0.12, 0.205);

test('pares de autopeças conferidos: MVA legal 90,15 corroborada por XML', () => {
  for (const [ncm, cest] of [
    ['87089990', '0107500'], ['87085080', '0107500'], ['85111000', '0105400'],
    ['85443000', '0107300'], ['90322000', '0112600'], ['40169990', '0100900'],
    ['73181500', '0199900'],
  ]) assert.equal(resolve({ ...item, ncm, cest, descricao: 'PARAFUSO AUTOMOTIVO' }), 90.15);
});
test('não usa MVA arbitrária, benefício de fidelidade, ST de outro item ou CFOP reclassificado', () => {
  for (const stXml of [
    undefined, { ...item.stXml!, mva: 51.16 }, { ...item.stXml!, mva: 80 },
    { ...item.stXml!, valor: 0 }, { ...item.stXml!, cfop: '6102' },
    { ...item.stXml!, modalidade: '5' }, { ...item.stXml!, aliquota: 19 },
  ]) assert.equal(resolve({ ...item, stXml }), null);
  assert.equal(resolve({ ...item, cfop: '6102' }), null);
  assert.equal(resolve({ ...item, cest: '0105400' }), null);
  assert.equal(resolve({ ...item, ncm: '73181500', cest: '0199900', descricao: 'PARAFUSO' },
    { ...note, rawMetadata: { crt: '3', emit_nome: 'Loja de materiais' } }), null);
  assert.equal(resolve(item, { ...note, ufEmitente: 'SP' }), null);
  assert.equal(resolve(item, { ...note, rawMetadata: { crt: '1' } }), null);
  assert.equal(resolve(item, note, { ...context, mva_anexo: [] }), null);
  assert.equal(resolve(item, note, { ...context, mva_anexo: [{ ncm: '8708', cest: ['01.075.00'] }] }), null);
  assert.equal(resolveAutopecasMvaXml(context, note, item, 'ajustada', .12, .12, .19), null);
});

test('catálogo real: 131 CESTs, item 110 revogado, residual sem NCM, duas hipóteses de MVA',()=>{
  const data=JSON.parse(fs.readFileSync(new URL('../../storage/data/AnexoI.json',import.meta.url),'utf8'));
  const rows=data.filter((row:any)=>row.autopecas===true);
  assert.equal(rows.length,156);
  assert.equal(new Set(rows.flatMap((row:any)=>row.cest)).size,131);
  assert.equal(rows.some((row:any)=>row.cest.includes('01.110.00')),false);
  assert.equal(rows.find((row:any)=>row.cest.includes('01.999.00')).ncm,'');
  for(const row of rows){
    assert.equal(row.mva,null);
    assert.deepEqual(row.mva_ajustada.map((x:any)=>x.aliquotas['12']),[51.16,90.15]);
    assert.deepEqual(row.mva_original.map((x:any)=>x.valor),[36.56,71.78]);
  }
  const actual = {...context,mva_anexo:rows};
  assert.equal(resolve(item,note,actual),90.15);
  assert.equal(resolve({...item,ncm:'73259100',cest:'0102100'},note,actual),null);
  assert.equal(resolve({...item,ncm:'87169090',cest:'0112700'},note,actual),null);
  assert.equal(resolve({...item,ncm:'73181500',cest:'0199900',descricao:'PARAFUSO AUTOMOTIVO'},note,actual),90.15);
  assert.equal(resolve(item,{...note,dataEmissao:'2025-12-01'},actual),null);
});
