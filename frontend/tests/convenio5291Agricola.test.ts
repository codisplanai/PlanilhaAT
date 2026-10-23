import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ANEXO_II_ITEMS, classifyAnexoII, isAnexoIINcm, resolveAnexoIIApplication,
} from '../src/lib/localProcessing/convenio5291Agricola.ts';
import type { Convenio5291Config } from '../src/types/perfil.ts';
import type { ExtractedItem, ExtractedNote } from '../src/lib/localProcessing/domain.ts';

const config: Convenio5291Config = {
  enabled: true, aplicar_automaticamente_seguros: true,
  solicitar_confirmacao_duvidosos: true, considerar_cst20_como_indicio: true, ajustes: [],
};
function product(patch: Partial<ExtractedItem> = {}): ExtractedItem {
  return {
    itemNumero: 1, ncm: '84244100', cest: '', cfop: '6102',
    descricao: 'PULVERIZADOR MANUAL AGRICOLA', descricaoConfiavel: true,
    vItem: 1000, vTotal: 1100, baseCalculo: 585.7,
    baseCalculoXml: 585.7, baseSemIpi: 1000, ipiDespesas: 100, vIpi: 100,
    aOri: 0.07, vIcms: 41, origemMercadoria: '0', cstIcms: '20',
    pRedBC: 41.43, ...patch,
  };
}
function invoice(patch: Partial<ExtractedNote> = {}): ExtractedNote {
  return {
    filename: 'comapel-exemplo.xml', chaveAcesso: '29260600000000000000550010000000011000000000',
    numeroNota: '12', serie: '1', cnpjEmitente: '00000000000100',
    ufEmitente: 'SP', cnpjDestinatario: '11111111000111',
    ufDestinatario: 'BA', dataEmissao: '2026-08-20T12:00:00',
    dataEntrada: null, vTotalNota: 1100, vBcNota: 585.7, vIcmsNota: 41,
    origemExtracao: 'xml', rawMetadata: {}, itens: [], ...patch,
  };
}
test('catálogo consolida itens do Anexo II, inclusive pulverizadores, irrigação, tratores e ordenha', () => {
  assert.ok(ANEXO_II_ITEMS.length >= 80);
  for (const ncm of ['84244100','84248229','84678100','84678900','84341000','87019100','84329000']) {
    assert.equal(isAnexoIINcm(ncm), true, ncm);
  }
  assert.equal(isAnexoIINcm('84679100'), false, 'peças de motosserra não entram por aproximação de NCM');
});
test('não classifica automaticamente pulverizador agrícola só por NCM e CST 20', () => {
  const r = classifyAnexoII(config, invoice(), product(), 'BA');
  assert.equal(r.status, 'revisar');
  assert.equal(r.itemLegal, '10.1');
  assert.equal(r.sugestaoAplicar, false);
});
test('após confirmação aplica carga origem 4,10%, interna 5,60% e base sem IPI', () => {
  const n = invoice();
  const p = product();
  const r = resolveAnexoIIApplication(config,n,p,'BA',{
    [`${n.chaveAcesso}|${p.itemNumero}`]: true,
  });
  assert.equal(r.applied,true);
  assert.equal(r.aOri,0.041);
  assert.equal(r.aDst,0.056);
  assert.equal(r.baseSemIpi,1000);
  assert.equal(r.origemAliquota,'anexo_ii_carga_4_10');
});
test('demais origens usam 7%, inclusive ES, mantendo carga interna 5,60%', () => {
  const n=invoice({ ufEmitente:'ES' });
  const p=product();
  const r=resolveAnexoIIApplication(config,n,p,'BA',{[`${n.chaveAcesso}|${p.itemNumero}`]:true});
  assert.equal(r.aOri,0.07);
  assert.equal(r.aDst,0.056);
});
test('4% de origem não pode virar 4,1% por engano', () => {
  const n=invoice(), p=product({ aOri:0.04,origemMercadoria:'1',pRedBC:0,cstIcms:'00' });
  const pending=classifyAnexoII(config,n,p,'BA');
  assert.equal(pending.status,'revisar');
  const r=resolveAnexoIIApplication(config,n,p,'BA',{[`${n.chaveAcesso}|${p.itemNumero}`]:true});
  assert.equal(r.aOri,0.04);
});
test('motosserra exige potência mínima e IBAMA; roçadeira exige potência mínima', () => {
  const motosserra=classifyAnexoII(config,invoice(),product({ ncm:'84678100',descricao:'MOTOSSERRA STIHL MS 170' }),'BA');
  assert.equal(motosserra.itemLegal,'17');
  assert.equal(motosserra.status,'revisar');
  const rocadeira=classifyAnexoII(config,invoice(),product({ncm:'84678900',descricao:'ROCADEIRA STIHL FS 160'}),'BA');
  assert.equal(rocadeira.status,'revisar');
  assert.match(String(rocadeira.descricaoLegal),/0,5/);
});
test('NCM sem contexto agrícola ou descrição incompatível não concede redução', () => {
  const esp=classifyAnexoII(config,invoice(),product({ ncm:'84672999',descricao:'ESMERILHADEIRA 900W'}),'BA');
  assert.equal(esp.status,'nao_aplicar');
  assert.equal(classifyAnexoII(config,invoice(),product({ncm:'84679100'}),'BA').status,'fora_catalogo');
});
test('um item seguro pode ser automático, mas ajuste nunca afasta condição técnica', () => {
  const stable=classifyAnexoII(config,invoice(),product({ncm:'84321000',descricao:'ARADO DE DISCO'}),'BA');
  assert.equal(stable.status,'automatico');
  const adjusted:Convenio5291Config={...config,ajustes:[{id:'x',ncm:'84678100',acao:'automatico',termos_descricao:[]}]};
  assert.equal(classifyAnexoII(adjusted,invoice(),product({ncm:'84678100',descricao:'MOTOSSERRA'}),'BA').status,'revisar');
});
test('controle de perfil, UF, data final e vigência histórica bloqueiam automação indevida', () => {
  assert.equal(classifyAnexoII({...config,enabled:false},invoice(),product(),'BA').status,'fora_catalogo');
  assert.equal(classifyAnexoII(config,invoice(),product(),'SP').status,'fora_catalogo');
  assert.equal(classifyAnexoII(config,invoice({dataEmissao:'2027-01-02'}),product(),'BA').status,'nao_aplicar');
  assert.equal(classifyAnexoII(config,invoice({dataEmissao:'2019-02-01'}),product({ncm:'84321000',descricao:'ARADO DE DISCO'}),'BA').status,'revisar');
});
test('ajuste por perfil pode excluir sem apagar catálogo legal', () => {
  const customized:Convenio5291Config={
    ...config, ajustes:[{id:'no',ncm:'84244100',acao:'nao_aplicar',termos_descricao:['PULVERIZADOR'],vigencia_inicio:'2026-06-01',motivo:'Produto não enquadrado'}],
  };
  const result=classifyAnexoII(customized,invoice(),product(),'BA');
  assert.equal(result.status,'nao_aplicar');
  assert.equal(result.ajusteId,'no');
});

test('pás e enxadas genéricas exigem revisão do uso agrícola, não aplicação automática', () => {
  const pa = classifyAnexoII(config, invoice(), product({ncm:'82011000',descricao:'PA DE BICO EM ACO'}),'BA');
  const enxada = classifyAnexoII(config, invoice(), product({ncm:'82013000',descricao:'ENXADA FORJADA'}),'BA');
  assert.equal(pa.status, 'revisar');
  assert.equal(enxada.status, 'revisar');
});
