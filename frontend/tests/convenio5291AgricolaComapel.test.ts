/**
 * Casos numéricos anonimizados e redimensionados a partir das NF-e COMAPEL
 * junho-setembro/2026. Não armazenar XMLs, chaves ou CNPJs reais no repositório.
 * Os testes cobrem XML -> classificação -> confirmação -> antecipação parcial.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { installDomParserPolyfill } from './domPolyfill.ts';
import { classifyAnexoII } from '../src/lib/localProcessing/convenio5291Agricola.ts';
import type { Convenio5291Config } from '../src/types/perfil.ts';
import type { ExtractedItem, ExtractedNote } from '../src/lib/localProcessing/domain.ts';

installDomParserPolyfill();
const { parseNfeXml } = await import('../src/lib/localProcessing/xml.ts');
const { processFiscalLocally } = await import('../src/lib/localProcessing/processor.ts');

const profile: Convenio5291Config = {
  enabled: true, aplicar_automaticamente_seguros: true,
  solicitar_confirmacao_duvidosos: true, considerar_cst20_como_indicio: true,
  ajustes: [],
};

interface Example {
  uf: string; ncm: string; descricao: string; cfop?: string;
  vProd: number; vIpi?: number; vBc: number;
  pIcms: number; pRedBc: number; vIcms: number; orig?: string;
}
function xmlFor(e: Example): string {
  const { uf, ncm, descricao, vProd, vBc, pIcms, pRedBc, vIcms } = e;
  const ipi = e.vIpi ?? 0;
  const total = vProd + ipi;
  const cst = pRedBc > 0 ? '20' : '00';
  const tag = pRedBc > 0 ? 'ICMS20' : 'ICMS00';
  return `<NFe xmlns="http://www.portalfiscal.inf.br/nfe">
  <infNFe Id="NFe35260900000000000000550010000012341000012345">
    <ide><nNF>1234</nNF><serie>1</serie><dhEmi>2026-09-28T10:00:00-03:00</dhEmi></ide>
    <emit><CNPJ>11111111000191</CNPJ><CRT>3</CRT><enderEmit><UF>${uf}</UF></enderEmit></emit>
    <dest><CNPJ>12345678000195</CNPJ><enderDest><UF>BA</UF></enderDest></dest>
    <total><ICMSTot><vBC>${vBc.toFixed(2)}</vBC><vICMS>${vIcms.toFixed(2)}</vICMS><vProd>${vProd.toFixed(2)}</vProd><vIPI>${ipi.toFixed(2)}</vIPI><vNF>${total.toFixed(2)}</vNF></ICMSTot></total>
    <det nItem="1"><prod><cProd>1</cProd><xProd>${descricao}</xProd><NCM>${ncm}</NCM><CFOP>${e.cfop ?? '6101'}</CFOP><vProd>${vProd.toFixed(2)}</vProd></prod>
    <imposto><ICMS><${tag}><orig>${e.orig ?? '0'}</orig><CST>${cst}</CST><vBC>${vBc.toFixed(2)}</vBC><pRedBC>${pRedBc}</pRedBC><pICMS>${pIcms}</pICMS><vICMS>${vIcms.toFixed(2)}</vICMS></${tag}></ICMS>
    <IPI><IPITrib><vIPI>${ipi.toFixed(2)}</vIPI></IPITrib></IPI></imposto></det>
  </infNFe></NFe>`;
}

const context: any = {
  empresa: {
    id: 1, razao_social: 'Empresa Exemplo BA', cnpj: '12345678000195',
    inscricao_estadual: null, uf: 'BA', perfil_regras_id: 1,
    optante_simples_nacional: false, a_ori_fixa_parcial: null,
  },
  perfil: {
    id: 1, nome: 'Perfil Exemplo', configuracoes_extras: {
      convenio_icms_52_91_anexo_ii: profile,
    },
  },
  regras_aliquotas: [{
    id: 1, perfil_regras_id: 1, uf: 'BA', ncm: null,
    aliquota: 0.205, parametros_extras: {}, criado_em: '', atualizado_em: '',
  }],
  regras_cfop: [{
    id: 1, perfil_regras_id: null, cfop_sufixo: '101',
    destino: 'antecipacao_parcial', criado_em: '', atualizado_em: '',
  }],
  regras_reducao: [], regras_reclassificacao: [], regras_exclusao_parcial: [],
  margens_seguranca_templates: {},
  templates_ativos: [{
    id: 1, tipo: 'antecipacao_parcial', versao: 1, capacidade_linhas: 100,
    arquivo_hash: 'teste', mapeamento_campos: {
      start_row: 4, columns: { v_total: 'E', base_calculo: 'F' },
    },
  }],
  mva_anexo: [],
};
const filepath = existsSync('storage/templates/modelo_padrao_antecipacao_parcial.xlsx')
  ? resolve('storage/templates/modelo_padrao_antecipacao_parcial.xlsx')
  : resolve('../storage/templates/modelo_padrao_antecipacao_parcial.xlsx');
const buffer = readFileSync(filepath);
const templates = new Map<number, ArrayBuffer>([
  [1, buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)],
]);
async function run(e: Example, confirm: boolean) {
  const xml = xmlFor(e);
  const filename = 'teste-anonimizado.xml';
  const note = parseNfeXml(xml, filename);
  const decisions = confirm ? { [`${note.chaveAcesso}|1`]: true } : undefined;
  const result = await processFiscalLocally({
    solicitacaoId: 'comapel-anonimizado',
    periodoInicio: '2026-09-01', periodoFim: '2026-09-30',
    context, input: { xmlFiles: [new File([xml], filename)] },
    convenio5291Decisions: decisions,
  }, templates);
  return { note, result };
}

test('amostra SP 7% e redução 41,43%: decompõe 4,10% em crédito real e 5,60% em débito', async () => {
  const fixture = {
    uf: 'SP', ncm: '84244100', descricao: 'PULVERIZADOR MANUAL AGRICOLA',
    vProd: 1000, vBc: 585.70, pIcms: 7, pRedBc: 41.43, vIcms: 41,
  };
  const { note, result: pre } = await run(fixture, false);
  assert.equal(note.itens[0].aOri, 0.07);
  assert.equal(note.itens[0].pRedBC, 41.43);
  assert.equal(note.itens[0].vIcms, 41);
  assert.equal(pre.preAnalysis.requer_decisao, true);
  assert.equal(pre.preAnalysis.itens_convenio_52_91.length, 1);
  const entry = pre.preAnalysis.itens_convenio_52_91[0];
  assert.equal(entry.anexo, 'II');
  assert.ok(Math.abs((entry.carga_efetiva_xml ?? 0) - 0.041) < 1e-7);
  assert.equal(entry.carga_origem_convenio, 0.041);
  assert.equal(entry.carga_interna_convenio, 0.056);
  const { result } = await run(fixture, true);
  assert.equal(result.notasProcessadas.length, 1);
  const output = result.notasProcessadas[0];
  assert.equal(output.a_ori, 0.041);
  assert.equal(output.a_dst_resolvida, 0.056);
  assert.equal(output.debito, 56);
  assert.equal(output.credito, 41);
  assert.equal(output.valor_devido, 15);
  assert.equal(output.metadados_extras?.convenio_52_91_anexo, 'II');
});

test('amostra RS importada a 4% com IPI: mantém 4%, sem multiplicar indevidamente pela redução', async () => {
  const { result } = await run({
    uf: 'RS', ncm: '84678100', descricao: 'MOTOSSERRA PORTATIL 1,5 KW',
    vProd: 1000, vIpi: 100, vBc: 1000,
    pIcms: 4, pRedBc: 0, vIcms: 40, orig: '1',
  }, true);
  assert.equal(result.notasProcessadas.length, 1);
  const row = result.notasProcessadas[0];
  assert.equal(row.v_total, 1100);
  assert.equal(row.base_calculo, 1000);
  assert.equal(row.a_ori, 0.04);
  assert.equal(row.a_dst_resolvida, 0.056);
  assert.equal(row.debito, 61.6);
  assert.equal(row.credito, 40);
  assert.equal(row.valor_devido, 21.6);
});

test('amostra de carga interestadual 7% versus interna 5,60%: não gera antecipação negativa', async () => {
  const { result } = await run({
    uf: 'ES', ncm: '84244100', descricao: 'PULVERIZADOR AGRICOLA MANUAL',
    vProd: 1000, vBc: 1000, pIcms: 7, pRedBc: 0, vIcms: 70,
  }, true);
  assert.equal(result.notasProcessadas.length, 0);
  assert.equal(result.itensExcluidos.length, 1);
  assert.match(result.itensExcluidos[0].motivo,/sem diferença positiva/);
});

test('amostras que não se enquadram: esmerilhadeira, tubo PEBD, abraçadeira e peças de motosserra', () => {
  const cases = [
    ['84672999', 'ESMERILHADEIRA ANGULAR 920', 'nao_aplicar'],
    ['39173290', 'TUBO PEBD PRETO 100M', 'nao_aplicar'],
    ['73269090', 'ABRACADEIRA ACO 12MM', 'nao_aplicar'],
    ['84679100', 'SABRE R 40CM PARA MOTOSSERRA', 'fora_catalogo'],
    ['84138100', 'BOMBA ANAUGER SAPPO 900 EXTREME 127V', 'revisar'],
    ['84248229', 'UNIAO INTERNA 1 POL PARA SISTEMA IRRIGACAO', 'revisar'],
  ] as const;
  for (const [ncm, descricao, status] of cases) {
    const template = parseNfeXml(xmlFor({
      uf: 'SP', ncm, descricao, vProd: 100, vBc: 58.57,
      pIcms: 7, pRedBc: 41.43, vIcms: 4.10,
    }), 'anon.xml');
    const candidate = template.itens[0] as ExtractedItem;
    assert.equal(classifyAnexoII(profile, template as ExtractedNote, candidate, 'BA').status, status, ncm);
  }
});


test('competência pela emissão: NF-e de agosto no SPED de setembro fica fora da Parcial de setembro', async () => {
  const xml = xmlFor({
    uf: 'SP', ncm: '84244100', descricao: 'PULVERIZADOR MANUAL AGRICOLA',
    vProd: 1000, vBc: 585.70, pIcms: 7, pRedBc: 41.43, vIcms: 41,
  }).replace('2026-09-28T10:00:00-03:00', '2026-08-28T10:00:00-03:00');
  const note = parseNfeXml(xml, 'emitido-agosto.xml');
  const sped = [
    '|0000|020|0|01092026|30092026|EMPRESA EXEMPLO|12345678000195||BA|00000000|0000000|||A|1|',
    '|0150|FORN|FORNECEDOR EXEMPLO|1058|11111111000191||00000000|3550308||SP|',
    '|0200|P1|PULVERIZADOR AGRICOLA|||UN|00|84244100||||||',
    `|C100|0|1|FORN|55|00|1|1234|${note.chaveAcesso}|28082026|14092026|1000,00|0|0|0|1000,00|0|0|0|0|0|585,70|41,00|0|0|0||`,
    '|C170|1|P1||1,000|UN|1000,00|0,00|0|020|2102||585,70|7,00|41,00|0|0|0|0|0||||0|0|||',
    '|C190|020|2102|7,00|1000,00|585,70|41,00|0|0|0|0|0||',
  ].join('\r\n');
  const localContext = {
    ...context, regras_cfop: [{
      id: 2, perfil_regras_id: null, cfop_sufixo: '102',
      destino: 'antecipacao_parcial', criado_em: '', atualizado_em: '',
    }],
  };
  await assert.rejects(() => processFiscalLocally({
    solicitacaoId: 'comapel-entrada-setembro',
    periodoInicio: '2026-09-01', periodoFim: '2026-09-30',
    context: localContext,
    input: {
      xmlFiles: [new File([xml], 'emitido-agosto.xml')],
      spedFile: new File([sped], 'sped09.txt'),
    },
    convenio5291Decisions: { [`${note.chaveAcesso}|1`]: true },
  }, templates), /Nenhuma NF-e válida para apuração interestadual foi encontrada no período informado/);
});
