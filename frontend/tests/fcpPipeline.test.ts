import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { installDomParserPolyfill } from './domPolyfill.ts';

installDomParserPolyfill();

import { groupKey, processFiscalLocally } from '../src/lib/localProcessing/processor.ts';
import {
  XML_NS,
  getCellValue,
  getSharedStrings,
  parseXml,
  workbookSheets,
} from '../src/lib/localProcessing/xlsx.ts';
import { readZip } from '../src/lib/localProcessing/zip.ts';
import type { LocalProcessingContext, LocalTemplateDescriptor } from '../src/types/localProcessing.ts';
import type { RegraFcp } from '../src/types/regraFcp.ts';
import type { TipoPlanilha } from '../src/types/solicitacao.ts';
import { EMPRESA_CNPJ, chave as chaveNfe } from './localFixtures.ts';

const FORNECEDOR_CNPJ = '98765432000180';
const TRANSPORTADORA_CNPJ = '11222333000181';

function chaveCte(aamm: string, numero: number): string {
  return `35${aamm}${TRANSPORTADORA_CNPJ}57001${String(numero).padStart(9, '0')}1${String(numero).padStart(8, '0')}0`;
}

const TEMPLATE_FILES: Partial<Record<TipoPlanilha, string>> = {
  antecipacao_parcial: 'modelo_padrao_antecipacao_parcial.xlsx',
  antecipacao_parcial_antecipado: 'modelo_padrao_antecipacao_parcial_antecipado.xlsx',
  antecipacao_parcial_simples: 'modelo_padrao_antecipacao_parcial_simples.xlsx',
  antecipacao_parcial_antecipado_simples: 'modelo_padrao_antecipacao_parcial_antecipado_simples.xlsx',
  antecipacao_tributaria: 'modelo_padrao_antecipacao_tributaria.xlsx',
  antecipacao_tributaria_antecipado: 'modelo_padrao_antecipacao_tributaria_antecipado.xlsx',
  difal: 'modelo_padrao_difal.xlsx',
  difal_antecipado: 'modelo_padrao_difal.xlsx',
};

const PARCIAL_COLUMNS = {
  item_index: 'A',
  data_entrada: 'B',
  data_emissao: 'C',
  numero_nota: 'D',
  v_total: 'E',
  base_calculo: 'F',
  ipi_despesas: 'G',
  a_dst: 'H',
  a_ori: 'I',
};

const TRIBUTARIA_COLUMNS = {
  item_index: 'A',
  data_entrada: 'B',
  data_emissao: 'C',
  numero_nota: 'D',
  v_total: 'E',
  base_calculo: 'F',
  ipi_despesas: 'G',
  mva: 'H',
  reducao: 'I',
  a_dst: 'J',
  a_ori: 'K',
  red: 'L',
  valor_pago: 'S',
};

const DIFAL_COLUMNS = {
  item_index: 'A',
  data_entrada: 'B',
  data_emissao: 'C',
  numero_nota: 'D',
  v_total: 'E',
  ipi_despesas: 'F',
  aliq_simples: 'G',
  a_dst: 'I',
  a_ori: 'J',
};

function templateDescriptors(): LocalTemplateDescriptor[] {
  return (Object.keys(TEMPLATE_FILES) as TipoPlanilha[]).map((tipo, index) => ({
    id: index + 1,
    tipo,
    versao: 1,
    capacidade_linhas: 100,
    arquivo_hash: '',
    mapeamento_campos: {
      start_row: 4,
      header_cell: 'A2',
      aliquota_format: 'percent_number',
      sheet_name: tipo === 'antecipacao_tributaria_antecipado' ? '4' : null,
      columns: tipo.startsWith('difal')
        ? DIFAL_COLUMNS
        : tipo.startsWith('antecipacao_tributaria')
          ? TRIBUTARIA_COLUMNS
          : PARCIAL_COLUMNS,
    },
  }));
}

async function loadTemplate(template: LocalTemplateDescriptor): Promise<ArrayBuffer> {
  const file = TEMPLATE_FILES[template.tipo]!;
  const local = path.resolve('storage/templates', file);
  const resolved = fs.existsSync(local) ? local : path.resolve('../storage/templates', file);
  const buf = fs.readFileSync(resolved);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

function makeFcpRule(
  id: number,
  ncm: string,
  aliquota: number,
  extra: Partial<RegraFcp> = {},
): RegraFcp {
  return {
    id,
    perfil_regras_id: 1,
    uf: 'BA',
    ncm,
    termos_inclusao: [],
    termos_exclusao: [],
    aliquota,
    aplicar_com_termo_acordo: true,
    descricao: `FCP ${(aliquota * 100).toFixed(0)}% NCM ${ncm}`,
    excecoes: [],
    ...extra,
  };
}

function presetBebidasFcp(): RegraFcp[] {
  return [
    makeFcpRule(1, '2203', 0.02, { descricao: 'FCP 2% — Cervejas de malte' }),
    makeFcpRule(2, '22021000', 0.02, {
      termos_inclusao: ['refrigerant*', 'refri', 'cola', 'guarana'],
      termos_exclusao: ['agua mineral'],
      descricao: 'FCP 2% — Refrigerantes',
    }),
  ];
}

function buildFcpContext(options: {
  simples?: boolean;
  razaoSocial?: string;
  presetBebidas?: boolean;
  regrasFcp?: RegraFcp[];
  termoAcordo?: { id: number; aliquota: number; descricao?: string | null } | null;
  configuracoesExtras?: Record<string, unknown>;
} = {}): LocalProcessingContext {
  const regrasAliquotas = [
    { id: 1, perfil_regras_id: 1, uf: 'BA', ncm: null, aliquota: 0.205, parametros_extras: {}, criado_em: '', atualizado_em: '' },
  ];
  if (options.presetBebidas) {
    regrasAliquotas.push({
      id: 2,
      perfil_regras_id: 1,
      uf: 'BA',
      ncm: '2203',
      aliquota: 0.25,
      parametros_extras: {},
      criado_em: '',
      atualizado_em: '',
    });
  }

  return {
    empresa: {
      id: 1,
      razao_social: options.razaoSocial ?? 'BEBIDAS BAHIA LTDA',
      cnpj: EMPRESA_CNPJ,
      inscricao_estadual: '83592715',
      uf: 'BA',
      perfil_regras_id: 1,
      optante_simples_nacional: Boolean(options.simples),
      atividade: 'comercio',
      termo_acordo: options.termoAcordo ?? null,
    },
    perfil: {
      id: 1,
      nome: 'Perfil BA FCP',
      configuracoes_extras: (options.configuracoesExtras ?? {}) as LocalProcessingContext['perfil']['configuracoes_extras'],
    },
    regras_aliquotas: regrasAliquotas,
    regras_cfop: [
      { id: 1, perfil_regras_id: 1, cfop_sufixo: '102', destino: 'antecipacao_parcial', reclassificar_para: null, motivo: null },
      { id: 2, perfil_regras_id: 1, cfop_sufixo: '403', destino: 'antecipacao_tributaria', reclassificar_para: null, motivo: null },
      { id: 3, perfil_regras_id: 1, cfop_sufixo: '556', destino: 'difal', reclassificar_para: null, motivo: null },
    ],
    regras_reducao: [],
    regras_reclassificacao: [],
    regras_exclusao_parcial: [],
    regras_fcp: options.regrasFcp ?? (options.presetBebidas ? presetBebidasFcp() : []),
    margens_seguranca_templates: {},
    templates_ativos: templateDescriptors(),
    mva_anexo: [
      {
        ncm: '22030000',
        item: '3.21',
        cest: ['03.021.03'],
        mva_original: [{ caso: null, valor: 140 }],
        mva_ajustada: [{ caso: null, aliquotas: { '4': 215.27, '7': 205.75, '12': 189.32 } }],
      },
      {
        ncm: '22021000',
        item: '3.10',
        cest: ['03.010.01', '03.007.00'],
        mva_original: [{ caso: null, valor: 100 }],
        mva_ajustada: [{ caso: null, aliquotas: { '4': 158.13, '7': 150.33, '12': 136.88 } }],
      },
      {
        ncm: '22011000',
        item: '3.05',
        cest: ['03.005.00'],
        mva_original: [{ caso: null, valor: 100 }],
        mva_ajustada: [{ caso: null, aliquotas: { '4': 158.13, '7': 150.33, '12': 136.88 } }],
      },
      {
        ncm: '73170090',
        item: '8.57',
        cest: ['10.057.00'],
        mva_original: [{ caso: null, valor: 35 }],
        mva_ajustada: [{ caso: null, aliquotas: { '4': 58.18, '7': 53.24, '12': 45 } }],
      },
    ],
  };
}

interface ItemXmlInput {
  ncm: string;
  cest?: string;
  cfop: string;
  xProd: string;
  vProd: string;
  pIcms?: string;
  vIcmsSt?: string;
}

function xmlNfeItens(opts: {
  numero: string;
  chave: string;
  itens: ItemXmlInput[];
  dia?: string;
  mes?: string;
  ano?: string;
  vStNota?: string;
}): string {
  const { numero, chave, itens, dia = '10', mes = '01', ano = '2026', vStNota = '0.00' } = opts;
  const total = itens.reduce((sum, it) => sum + Number(it.vProd), 0).toFixed(2);
  const detXml = itens.map((it, idx) => {
    const pIcms = it.pIcms ?? '12.00';
    const vProd = it.vProd;
    const vIcms = ((Number(vProd) * Number(pIcms)) / 100).toFixed(2);
    const vSt = Number(it.vIcmsSt ?? 0);
    const icmsXml = vSt > 0
      ? `<ICMS10><orig>0</orig><CST>10</CST><vBC>${vProd}</vBC><pICMS>${pIcms}</pICMS><vICMS>${vIcms}</vICMS><vBCST>${vProd}</vBCST><pICMSST>20.50</pICMSST><vICMSST>${vSt.toFixed(2)}</vICMSST></ICMS10>`
      : `<ICMS00><orig>0</orig><CST>00</CST><vBC>${vProd}</vBC><pICMS>${pIcms}</pICMS><vICMS>${vIcms}</vICMS></ICMS00>`;
    const cestXml = it.cest ? `<CEST>${it.cest}</CEST>` : '';
    return `<det nItem="${idx + 1}"><prod><cProd>P${idx + 1}</cProd><NCM>${it.ncm}</NCM>${cestXml}<CFOP>${it.cfop}</CFOP><xProd>${it.xProd}</xProd><vProd>${vProd}</vProd></prod><imposto><ICMS>${icmsXml}</ICMS></imposto></det>`;
  }).join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe"><NFe><infNFe Id="NFe${chave}">
  <ide><nNF>${numero}</nNF><serie>1</serie><dhEmi>${ano}-${mes}-${dia}T10:00:00-03:00</dhEmi></ide>
  <emit><CNPJ>${FORNECEDOR_CNPJ}</CNPJ><CRT>3</CRT><enderEmit><UF>SP</UF></enderEmit></emit>
  <dest><CNPJ>${EMPRESA_CNPJ}</CNPJ><enderDest><UF>BA</UF></enderDest></dest>
  <total><ICMSTot><vProd>${total}</vProd><vBC>${total}</vBC><vNF>${total}</vNF><vST>${vStNota}</vST></ICMSTot></total>
  ${detXml}
</infNFe></NFe></nfeProc>`;
}

function buildCteXml(opts: {
  numero: string;
  chave: string;
  vTPrest: string;
  chavesNfe: string[];
  pIcms?: string;
}): string {
  const pIcms = opts.pIcms ?? '12.00';
  const vIcms = ((Number(opts.vTPrest) * Number(pIcms)) / 100).toFixed(2);
  const nfesXml = opts.chavesNfe.map((chv) => `<infNFe><chave>${chv}</chave></infNFe>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<cteProc xmlns="http://www.portalfiscal.inf.br/cte" versao="4.00"><CTe><infCte Id="CTe${opts.chave}" versao="4.00">
  <ide><cUF>35</cUF><nCT>${opts.numero}</nCT><serie>1</serie><CFOP>6352</CFOP><dhEmi>2026-01-15T10:00:00-03:00</dhEmi><UFIni>SP</UFIni><UFFim>BA</UFFim><toma3><toma>3</toma></toma3></ide>
  <emit><CNPJ>${TRANSPORTADORA_CNPJ}</CNPJ><xNome>TRANSPORTADORA TESTE</xNome><CRT>3</CRT><enderEmit><UF>SP</UF></enderEmit></emit>
  <rem><CNPJ>${FORNECEDOR_CNPJ}</CNPJ></rem>
  <dest><CNPJ>${EMPRESA_CNPJ}</CNPJ></dest>
  <vPrest><vTPrest>${opts.vTPrest}</vTPrest><vRec>${opts.vTPrest}</vRec></vPrest>
  <imp><ICMS><ICMS00><CST>00</CST><vBC>${opts.vTPrest}</vBC><pICMS>${pIcms}</pICMS><vICMS>${vIcms}</vICMS></ICMS00></ICMS></imp>
  <infCTeNorm><infDoc>${nfesXml}</infDoc></infCTeNorm>
</infCte></CTe></cteProc>`;
}

async function readSheetValues(xlsxBytes: ArrayBuffer, sheetName: string): Promise<{
  visibleNames: string[];
  cell: (ref: string) => string;
}> {
  const entries = await readZip(xlsxBytes);
  const sheets = workbookSheets(entries);
  const visibleNames = sheets.filter((s) => !s.hidden).map((s) => s.name);
  const target = sheets.find((s) => s.name === sheetName);
  assert.ok(target, `Aba "${sheetName}" não encontrada (disponíveis: ${visibleNames.join(', ')})`);
  const shared = getSharedStrings(entries);
  const doc = parseXml(entries.get(target.path)!, target.path);
  const cells = new Map<string, Element>();
  for (const c of Array.from(doc.getElementsByTagNameNS(XML_NS, 'c'))) {
    const r = c.getAttribute('r');
    if (r) cells.set(r, c);
  }
  return {
    visibleNames,
    cell: (ref: string) => {
      const c = cells.get(ref);
      return c ? getCellValue(c, shared) : '';
    },
  };
}

test('AT Regime Normal bebidas BA gera segunda aba FCP e mantem total AT separado', async () => {
  const context = buildFcpContext({ simples: false, presetBebidas: true });
  const xml = xmlNfeItens({
    numero: '101',
    chave: chaveNfe('2601', 101),
    itens: [
      { ncm: '22030000', cest: '0302103', cfop: '6403', xProd: 'CERVEJA PILSEN 350ML', vProd: '1000.00' },
      { ncm: '22021000', cest: '0301001', cfop: '6403', xProd: 'REFRIGERANTE COLA 2L', vProd: '500.00' },
      { ncm: '22011000', cest: '0300500', cfop: '6403', xProd: 'AGUA MINERAL 500ML', vProd: '300.00' },
    ],
  });

  const result = await processFiscalLocally(
    {
      solicitacaoId: 'fcp-rn-101',
      periodoInicio: '2026-01-01',
      periodoFim: '2026-01-31',
      context,
      input: { xmlFiles: [new File([xml], '101.xml', { type: 'text/xml' })] },
    },
    new Map(),
    loadTemplate,
  );

  assert.equal(result.notasProcessadas.length, 3);
  const byNcm = new Map(result.notasProcessadas.map((n) => [n.ncm, n]));

  const cerveja = byNcm.get('22030000')!;
  assert.equal(cerveja.a_dst_resolvida, 0.25);
  assert.equal(cerveja.metadados_extras.a_dst_base, '0.2500');
  assert.equal(cerveja.metadados_extras.fcp_aliquota, '0.0200');
  assert.equal(cerveja.metadados_extras.fcp_origem, 'fcp_produto:1');
  assert.equal(cerveja.metadados_extras.fcp_separado, true);
  assert.equal(cerveja.metadados_extras.fcp_base_st, '2893.20');
  assert.equal(cerveja.metadados_extras.fcp_valor_devido, '57.86');

  const refri = byNcm.get('22021000')!;
  assert.equal(refri.a_dst_resolvida, 0.205);
  assert.equal(refri.metadados_extras.a_dst_base, '0.2050');
  assert.equal(refri.metadados_extras.fcp_aliquota, '0.0200');
  assert.equal(refri.metadados_extras.fcp_separado, true);
  assert.equal(refri.metadados_extras.fcp_base_st, '1184.40');
  assert.equal(refri.metadados_extras.fcp_valor_devido, '23.69');

  const agua = byNcm.get('22011000')!;
  assert.equal(agua.a_dst_resolvida, 0.205);
  assert.equal(agua.metadados_extras.fcp_aliquota, null);
  assert.equal(agua.metadados_extras.fcp_separado, false);

  const mainRows = result.rowsByDestination.antecipacao_tributaria!;
  assert.equal(mainRows.length, 3);
  const artifact = result.artifacts.find((a) => a.tipo === 'antecipacao_tributaria')!;
  const expectedAtTotal = result.notasProcessadas.reduce((sum, n) => sum + n.valor_devido, 0);
  assert.equal(Math.round(artifact.totalValorDevido * 100) / 100, Math.round(expectedAtTotal * 100) / 100);

  const fcpRows = result.fcpRowsByDestination?.antecipacao_tributaria ?? [];
  assert.equal(fcpRows.length, 2);
  for (const r of fcpRows) {
    assert.equal(r.a_ori, 0);
    assert.equal(r.credito, 0);
    assert.equal(r.valor_pago, 0);
    assert.equal(r.a_dst, 0.02);
  }

  const sheetMain = await readSheetValues(artifact.bytes, '01-2026');
  assert.deepEqual(sheetMain.visibleNames, ['01-2026', '01-2026 FCP']);
  assert.deepEqual([sheetMain.cell('E4'), sheetMain.cell('E5'), sheetMain.cell('E6')], ['1000', '500', '300']);
  assert.deepEqual([sheetMain.cell('J4'), sheetMain.cell('J5'), sheetMain.cell('J6')], ['25', '20.5', '20.5']);
  assert.equal(sheetMain.cell('D7'), '');

  const sheetFcp = await readSheetValues(artifact.bytes, '01-2026 FCP');
  assert.deepEqual([sheetFcp.cell('E4'), sheetFcp.cell('E5')], ['1000', '500']);
  assert.deepEqual([sheetFcp.cell('J4'), sheetFcp.cell('J5')], ['2', '2']);
  assert.deepEqual([sheetFcp.cell('K4'), sheetFcp.cell('K5')], ['0', '0']);
  assert.deepEqual([sheetFcp.cell('S4'), sheetFcp.cell('S5')], ['0', '0']);
  assert.equal(sheetFcp.cell('D6'), '');
});

test('AT Regime Normal separa grupos de mesma aliquota base quando apenas um item tem FCP', async () => {
  // groupKey mantem default para compatibilidade e distingue fcpSeparado
  assert.equal(
    groupKey('antecipacao_tributaria', 0.12, 0.205, 136.88, false),
    groupKey('antecipacao_tributaria', 0.12, 0.205, 136.88, false, null, null),
  );
  assert.notEqual(
    groupKey('antecipacao_tributaria', 0.12, 0.205, 136.88, false, null, 0.02),
    groupKey('antecipacao_tributaria', 0.12, 0.205, 136.88, false, null, null),
  );

  const context = buildFcpContext({ simples: false, presetBebidas: true });
  const xml = xmlNfeItens({
    numero: '102',
    chave: chaveNfe('2601', 102),
    itens: [
      { ncm: '22021000', cest: '0300700', cfop: '6403', xProd: 'REFRIGERANTE COLA 2L', vProd: '700.00' },
      { ncm: '22011000', cest: '0300500', cfop: '6403', xProd: 'AGUA MINERAL 500ML', vProd: '300.00' },
    ],
  });

  const result = await processFiscalLocally(
    {
      solicitacaoId: 'fcp-rn-102',
      periodoInicio: '2026-01-01',
      periodoFim: '2026-01-31',
      context,
      input: { xmlFiles: [new File([xml], '102.xml', { type: 'text/xml' })] },
    },
    new Map(),
    loadTemplate,
  );

  assert.equal(result.notasProcessadas.length, 2);
  const artifact = result.artifacts.find((a) => a.tipo === 'antecipacao_tributaria')!;
  const sheetMain = await readSheetValues(artifact.bytes, '01-2026');
  assert.deepEqual(sheetMain.visibleNames, ['01-2026', '01-2026 FCP']);
  assert.equal(sheetMain.cell('D4'), '102');
  assert.equal(sheetMain.cell('D5'), '102*');
  assert.equal(sheetMain.cell('J4'), '20.5');
  assert.equal(sheetMain.cell('J5'), '20.5');
  assert.equal(sheetMain.cell('D6'), '');

  const sheetFcp = await readSheetValues(artifact.bytes, '01-2026 FCP');
  assert.equal(sheetFcp.cell('D4'), '102');
  assert.equal(sheetFcp.cell('E4'), '700');
  assert.equal(sheetFcp.cell('J4'), '2');
  assert.equal(sheetFcp.cell('K4'), '0');
  assert.equal(sheetFcp.cell('S4'), '0');
  assert.equal(sheetFcp.cell('D5'), '');
});

test('AT Regime Normal excluida por ST pago nao gera aba FCP', async () => {
  // Caso A: NF 301 com bebida cujo ICMS ST destacado cobre integralmente o imposto, ao lado da NF 303 (agua mineral sem FCP e sem ST)
  const context = buildFcpContext({ simples: false, presetBebidas: true });
  // Base ST cerveja = 1000 * 2.8932 = 2893.20; debito = 723.30; credito = 120; bruto = 603.30; ST = 650.00 -> valorDevido <= 0
  const xmlBebidaSt = xmlNfeItens({
    numero: '301',
    chave: chaveNfe('2601', 301),
    vStNota: '650.00',
    itens: [
      { ncm: '22030000', cest: '0302103', cfop: '6403', xProd: 'CERVEJA PILSEN 350ML', vProd: '1000.00', vIcmsSt: '650.00' },
    ],
  });
  const xmlAgua = xmlNfeItens({
    numero: '303',
    chave: chaveNfe('2601', 303),
    itens: [
      { ncm: '22011000', cest: '0300500', cfop: '6403', xProd: 'AGUA MINERAL 500ML', vProd: '300.00' },
    ],
  });

  const resSt = await processFiscalLocally(
    {
      solicitacaoId: 'fcp-st-coberto',
      periodoInicio: '2026-01-01',
      periodoFim: '2026-01-31',
      context,
      input: {
        xmlFiles: [
          new File([xmlBebidaSt], '301.xml', { type: 'text/xml' }),
          new File([xmlAgua], '303.xml', { type: 'text/xml' }),
        ],
      },
    },
    new Map(),
    loadTemplate,
  );

  assert.equal(resSt.itensExcluidos.length, 1);
  assert.equal(resSt.itensExcluidos[0].ncm, '22030000');
  assert.equal(resSt.notasProcessadas.length, 1);
  assert.equal(resSt.notasProcessadas[0].ncm, '22011000');
  assert.equal(resSt.notasProcessadas[0].metadados_extras.fcp_valor_devido, undefined);
  assert.equal(resSt.fcpRowsByDestination?.antecipacao_tributaria?.length ?? 0, 0);

  const sheetOnly = await readSheetValues(resSt.artifacts[0].bytes, '01-2026');
  assert.deepEqual(sheetOnly.visibleNames, ['01-2026']);

  // Caso B: Empresa com regra especifica de exclusao de ST (CASA VIP) nao gera FCP mesmo com ST pequena
  const ctxCasaVip = buildFcpContext({ simples: false, presetBebidas: true, razaoSocial: 'CASA VIP LTDA' });
  const xmlCasaVip = xmlNfeItens({
    numero: '302',
    chave: chaveNfe('2601', 302),
    vStNota: '50.00',
    itens: [
      { ncm: '22030000', cest: '0302103', cfop: '6403', xProd: 'CERVEJA PILSEN 350ML', vProd: '500.00', vIcmsSt: '50.00' },
    ],
  });
  const resCasaVip = await processFiscalLocally(
    {
      solicitacaoId: 'fcp-st-casavip',
      periodoInicio: '2026-01-01',
      periodoFim: '2026-01-31',
      context: ctxCasaVip,
      input: { xmlFiles: [new File([xmlCasaVip], '302.xml', { type: 'text/xml' })] },
    },
    new Map(),
    loadTemplate,
  );
  assert.equal(resCasaVip.notasProcessadas.length, 0);
  assert.equal(resCasaVip.artifacts.length, 0);
  assert.equal(resCasaVip.itensExcluidos.length, 1);
  assert.equal(resCasaVip.fcpRowsByDestination?.antecipacao_tributaria?.length ?? 0, 0);

  // Caso C: MVA pendente em bebida (dois itens no Anexo com MVAs distintas e NF-e sem CEST) vai para itensExcluidos e nao gera FCP
  const ctxMva = buildFcpContext({ simples: false, presetBebidas: true });
  ctxMva.mva_anexo.push({
    ncm: '22021000',
    item: '3.11',
    cest: ['03.011.00'],
    mva_original: [{ caso: null, valor: 80 }],
    mva_ajustada: [{ caso: null, aliquotas: { '4': 130, '7': 120, '12': 110 } }],
  });
  const xmlMvaPendente = xmlNfeItens({
    numero: '304',
    chave: chaveNfe('2601', 304),
    itens: [
      { ncm: '22021000', cfop: '6403', xProd: 'REFRIGERANTE COLA 2L', vProd: '400.00' },
      { ncm: '22011000', cest: '0300500', cfop: '6403', xProd: 'AGUA MINERAL 500ML', vProd: '300.00' },
    ],
  });
  const resMva = await processFiscalLocally(
    {
      solicitacaoId: 'fcp-mva-pendente',
      periodoInicio: '2026-01-01',
      periodoFim: '2026-01-31',
      context: ctxMva,
      input: { xmlFiles: [new File([xmlMvaPendente], '304.xml', { type: 'text/xml' })] },
    },
    new Map(),
    loadTemplate,
  );
  assert.ok(resMva.itensExcluidos.some((ex) => ex.ncm === '22021000' && ex.tipo_exclusao === 'mva_pendente'));
  assert.equal(resMva.notasProcessadas.length, 1);
  assert.equal(resMva.fcpRowsByDestination?.antecipacao_tributaria?.length ?? 0, 0);
  const sheetMva = await readSheetValues(resMva.artifacts[0].bytes, '01-2026');
  assert.deepEqual(sheetMva.visibleNames, ['01-2026']);
});

test('AT Simples Nacional, Parcial (com Convenio 52/91 e aliquotas iguais) e DIFAL somam FCP na A.DST', async () => {
  // Parte 1: Simples Nacional AT soma FCP direto na A.DST (27% / 22.5%) e nao gera aba FCP
  const ctxSn = buildFcpContext({ simples: true, presetBebidas: true });
  const xmlSn = xmlNfeItens({
    numero: '104',
    chave: chaveNfe('2601', 104),
    itens: [
      { ncm: '22030000', cest: '0302103', cfop: '6403', xProd: 'CERVEJA PILSEN 350ML', vProd: '1000.00' },
      { ncm: '22021000', cest: '0301001', cfop: '6403', xProd: 'REFRIGERANTE COLA 2L', vProd: '500.00' },
      { ncm: '22011000', cest: '0300500', cfop: '6403', xProd: 'AGUA MINERAL 500ML', vProd: '200.00' },
    ],
  });
  const resSn = await processFiscalLocally(
    {
      solicitacaoId: 'fcp-sn',
      periodoInicio: '2026-01-01',
      periodoFim: '2026-01-31',
      context: ctxSn,
      input: { xmlFiles: [new File([xmlSn], '104.xml', { type: 'text/xml' })] },
    },
    new Map(),
    loadTemplate,
  );
  const snByNcm = new Map(resSn.notasProcessadas.map((n) => [n.ncm, n]));
  assert.equal(snByNcm.get('22030000')!.a_dst_resolvida, 0.27);
  assert.equal(snByNcm.get('22030000')!.metadados_extras.a_dst_base, '0.2500');
  assert.equal(snByNcm.get('22030000')!.metadados_extras.fcp_aliquota, '0.0200');
  assert.equal(snByNcm.get('22030000')!.metadados_extras.fcp_separado, false);

  assert.equal(snByNcm.get('22021000')!.a_dst_resolvida, 0.225);
  assert.equal(snByNcm.get('22021000')!.metadados_extras.fcp_separado, false);

  assert.equal(snByNcm.get('22011000')!.a_dst_resolvida, 0.205);
  assert.equal(snByNcm.get('22011000')!.metadados_extras.fcp_aliquota, null);
  assert.equal(resSn.fcpRowsByDestination?.antecipacao_tributaria?.length ?? 0, 0);
  const sheetSn = await readSheetValues(resSn.artifacts[0].bytes, '01-2026');
  assert.deepEqual(sheetSn.visibleNames, ['01-2026']);

  // Parte 2: Parcial (termo acordo 12%, aliquotas iguais, Convenio 52/91 + FCP, redundancia) + DIFAL 22.5%
  const ctxParcial = buildFcpContext({
    simples: false,
    presetBebidas: false,
    termoAcordo: { id: 10, aliquota: 0.12, descricao: 'Termo 12%' },
    configuracoesExtras: {
      politica_aliquotas_iguais_parcial: { BA: true },
      limitar_a_ori_reducoes: true,
      convenio_icms_52_91_anexo_i: {
        enabled: true,
        aplicar_automaticamente_seguros: true,
        solicitar_confirmacao_duvidosos: false,
      },
    },
    regrasFcp: [
      makeFcpRule(10, '22021000', 0.02, { termos_inclusao: ['REFRI*'], aplicar_com_termo_acordo: true }),
      makeFcpRule(11, '22021000', 0.02, { termos_inclusao: ['REFRIGERANTE'], aplicar_com_termo_acordo: true }),
      makeFcpRule(12, '2203', 0.02, { aplicar_com_termo_acordo: false }),
      makeFcpRule(13, '8417', 0.02, { aplicar_com_termo_acordo: true }),
    ],
  });

  const xmlParcial = xmlNfeItens({
    numero: '105',
    chave: chaveNfe('2601', 105),
    itens: [
      // Parcial: A.ORI=12% (limitada a 10% pois termo=12% + FCP=2% = 14% != 12%), nao excluida por aliquotas iguais; emite aviso redundancia FCP
      { ncm: '22021000', cfop: '6102', xProd: 'REFRIGERANTE COLA 2L', vProd: '1000.00' },
      // Parcial: FCP aplicar_com_termo_acordo=false -> ignorada -> 12% == 12% -> excluida por aliquotas iguais
      { ncm: '22030000', cfop: '6102', xProd: 'CERVEJA PILSEN 350ML', vProd: '500.00' },
      // Parcial com Convenio 52/91 Anexo I: A.ORI=5.14%, base A.DST=8.8% + FCP=2% -> 10.8%
      { ncm: '84172000', cfop: '6102', xProd: 'FORNO INDUSTRIAL DE PADARIA', vProd: '1000.00' },
      // DIFAL (6556): ignora termo acordo -> base BA 20.5% + FCP 2% = 22.5%
      { ncm: '22021000', cfop: '6556', xProd: 'REFRIGERANTE CONSUMO', vProd: '400.00' },
    ],
  });

  const resParcial = await processFiscalLocally(
    {
      solicitacaoId: 'fcp-parcial-difal',
      periodoInicio: '2026-01-01',
      periodoFim: '2026-01-31',
      context: ctxParcial,
      input: { xmlFiles: [new File([xmlParcial], '105.xml', { type: 'text/xml' })] },
    },
    new Map(),
    loadTemplate,
  );

  const parcialNotes = resParcial.notasProcessadas.filter((n) => n.destino_planilha === 'antecipacao_parcial');
  assert.equal(parcialNotes.length, 2);

  const parcialRefri = parcialNotes.find((n) => n.ncm === '22021000')!;
  assert.equal(parcialRefri.a_dst_resolvida, 0.14);
  assert.equal(parcialRefri.a_ori, 0.10);
  assert.equal(parcialRefri.metadados_extras.a_dst_base, '0.1200');
  assert.equal(parcialRefri.metadados_extras.fcp_aliquota, '0.0200');
  assert.equal(parcialRefri.metadados_extras.fcp_separado, false);

  const parcialConv = parcialNotes.find((n) => n.ncm === '84172000')!;
  assert.equal(parcialConv.metadados_extras.convenio_52_91_aplicado, true);
  assert.equal(parcialConv.a_ori, 0.0514);
  assert.equal(parcialConv.a_dst_resolvida, 0.108);
  assert.equal(parcialConv.metadados_extras.a_dst_base, '0.0880');
  assert.equal(parcialConv.metadados_extras.fcp_aliquota, '0.0200');
  assert.equal(parcialConv.valor_devido, 56.6);

  // Cerveja excluida por aliquotas iguais
  assert.ok(
    resParcial.itensExcluidos.some((ex) => ex.ncm === '22030000' && ex.tipo_exclusao === 'aliquotas_iguais'),
  );

  // DIFAL 20.5% + 2% = 22.5%
  const difalNote = resParcial.notasProcessadas.find((n) => n.destino_planilha === 'difal')!;
  assert.equal(difalNote.a_dst_resolvida, 0.225);
  assert.equal(difalNote.metadados_extras.a_dst_base, '0.2050');
  assert.equal(difalNote.metadados_extras.fcp_aliquota, '0.0200');
  assert.equal(difalNote.metadados_extras.fcp_separado, false);

  // Aviso de redundancia FCP gerado
  assert.ok(resParcial.avisosAvaliacao.some((a) => a.aviso.includes('FCP')));

  // Nenhuma saida gerou aba FCP
  for (const artifact of resParcial.artifacts) {
    const entries = await readZip(artifact.bytes);
    const visible = workbookSheets(entries).filter((s) => !s.hidden).map((s) => s.name);
    assert.equal(visible.length, 1);
    assert.equal(visible.some((name) => name.toUpperCase().endsWith('FCP')), false);
  }

  // Termo acordo 10% + FCP 2% = 12% igual a A.ORI 12% -> resolveOriginRate dispensa limite de 10% e exclui por aliquotas iguais
  const ctxWaiver = buildFcpContext({
    simples: false,
    presetBebidas: false,
    termoAcordo: { id: 11, aliquota: 0.10, descricao: 'Termo 10%' },
    configuracoesExtras: {
      politica_aliquotas_iguais_parcial: { BA: true },
      limitar_a_ori_reducoes: true,
    },
    regrasFcp: [
      makeFcpRule(14, '22021000', 0.02, { termos_inclusao: ['REFRIGERANTE'], aplicar_com_termo_acordo: true }),
    ],
  });
  const resWaiver = await processFiscalLocally(
    {
      solicitacaoId: 'fcp-waiver',
      periodoInicio: '2026-01-01',
      periodoFim: '2026-01-31',
      context: ctxWaiver,
      input: {
        xmlFiles: [
          new File([xmlNfeItens({
            numero: '106',
            chave: chaveNfe('2601', 106),
            itens: [{ ncm: '22021000', cfop: '6102', xProd: 'REFRIGERANTE COLA 2L', vProd: '500.00' }],
          })], '106.xml', { type: 'text/xml' }),
        ],
      },
    },
    new Map(),
    loadTemplate,
  );
  assert.equal(resWaiver.notasProcessadas.length, 0);
  assert.equal(resWaiver.itensExcluidos.length, 1);
  assert.equal(resWaiver.itensExcluidos[0].tipo_exclusao, 'aliquotas_iguais');
  assert.equal(resWaiver.itensExcluidos[0].a_ori, 0.12);
  assert.equal(resWaiver.itensExcluidos[0].a_dst, 0.12);
});

test('CT-e AT acompanha FCP no Regime Normal e no Simples Nacional', async () => {
  // Parte A: Regime Normal (NF-e mista: 500 cerveja FCP 2% + 500 prego sem FCP)
  const ctxNorm = buildFcpContext({ simples: false, presetBebidas: true });
  const chvNorm = chaveNfe('2601', 201);
  const xmlNorm = xmlNfeItens({
    numero: '201',
    chave: chvNorm,
    itens: [
      { ncm: '22030000', cest: '0302103', cfop: '6403', xProd: 'CERVEJA PILSEN 350ML', vProd: '500.00' },
      { ncm: '73170090', cest: '1005700', cfop: '6403', xProd: 'PREGO ACO', vProd: '500.00' },
    ],
  });
  const cteNormXml = buildCteXml({
    numero: '15420',
    chave: chaveCte('2601', 15420),
    vTPrest: '200.00',
    chavesNfe: [chvNorm],
  });

  const resNorm = await processFiscalLocally(
    {
      solicitacaoId: 'fcp-cte-rn',
      periodoInicio: '2026-01-01',
      periodoFim: '2026-01-31',
      context: ctxNorm,
      input: {
        xmlFiles: [
          new File([xmlNorm], '201.xml', { type: 'text/xml' }),
          new File([cteNormXml], 'cte15420.xml', { type: 'text/xml' }),
        ],
      },
    },
    new Map(),
    loadTemplate,
  );

  const cteProcNorm = resNorm.notasProcessadas.find((n) => n.metadados_extras.tipo_documento === 'cte')!;
  assert.equal(cteProcNorm.v_total, 200);
  assert.equal(cteProcNorm.a_dst_resolvida, 0.205);
  assert.equal(cteProcNorm.metadados_extras.fcp_separado, true);
  assert.equal(cteProcNorm.metadados_extras.fcp_aliquota, '0.0200');
  assert.equal(cteProcNorm.metadados_extras.fcp_cte_v_total, '100.00');
  assert.equal(cteProcNorm.metadados_extras.fcp_cte_mva, '189.32');
  assert.equal(cteProcNorm.metadados_extras.fcp_cte_reducao, null);
  assert.equal(Number(cteProcNorm.metadados_extras.fcp_percentual_rateio), 50);

  const cteFcpRow = resNorm.fcpRowsByDestination?.antecipacao_tributaria?.find((r) => r.numero_nota === '15420');
  assert.ok(cteFcpRow);
  assert.equal(cteFcpRow.v_total, 100);
  assert.equal(cteFcpRow.mva, 189.32);
  assert.equal(cteFcpRow.a_dst, 0.02);
  assert.equal(cteFcpRow.a_ori, 0);
  assert.equal(cteFcpRow.credito, 0);
  assert.equal(cteFcpRow.valor_pago, 0);

  // Parte B: Regime Normal com multiplas aliquotas FCP (2% + 1%) gera fcp_parcelas (11 chaves) e exige capacidade >= 2
  const ctxMulti = buildFcpContext({ simples: false, presetBebidas: true });
  ctxMulti.regras_fcp!.push(makeFcpRule(99, '7317', 0.01, { descricao: 'FCP 1% Ferragens' }));
  ctxMulti.regras_reducao.push({
    id: 50,
    perfil_regras_id: 1,
    ncm: '7317',
    termos_inclusao: [],
    termos_exclusao: [],
    aliquota: 0.41463,
    escopo: 'antecipacao_tributaria',
    descricao: 'Art. 266, II',
    excecoes: [],
    criado_em: '',
    atualizado_em: '',
  });
  // Adiciona template de capacidade 1 para garantir que Math.max(rows.length, fcpRows.length) escolhe o de capacidade 100
  const baseAtTemplate = ctxMulti.templates_ativos.find((t) => t.tipo === 'antecipacao_tributaria')!;
  ctxMulti.templates_ativos.push({
    ...baseAtTemplate,
    id: 999,
    capacidade_linhas: 1,
    versao: 2,
  });

  const chvMulti = chaveNfe('2601', 202);
  // 202 tem entrada diferente (ou NF-e de periodo anterior para nao gerar linha propria na aba AT, apenas o CT-e!)
  const xmlMulti = xmlNfeItens({
    numero: '202',
    chave: chvMulti,
    mes: '12',
    ano: '2025',
    itens: [
      { ncm: '22030000', cest: '0302103', cfop: '6403', xProd: 'CERVEJA PILSEN 350ML', vProd: '600.00' },
      { ncm: '73170090', cest: '1005700', cfop: '6403', xProd: 'PREGO ACO', vProd: '400.00' },
    ],
  });
  const cteMultiXml = buildCteXml({
    numero: '15425',
    chave: chaveCte('2601', 15425),
    vTPrest: '100.00',
    chavesNfe: [chvMulti],
  });
  const resMulti = await processFiscalLocally(
    {
      solicitacaoId: 'fcp-cte-multi',
      periodoInicio: '2026-01-01',
      periodoFim: '2026-01-31',
      context: ctxMulti,
      input: {
        xmlFiles: [
          new File([xmlMulti], '202.xml', { type: 'text/xml' }),
          new File([cteMultiXml], 'cte15425.xml', { type: 'text/xml' }),
        ],
      },
    },
    new Map(),
    loadTemplate,
  );
  // 1 linha principal (so CT-e 15425, pois NF 202 e de dez/2025) vs 2 linhas FCP -> template capacidade 100 escolhido!
  const multiArtifact = resMulti.artifacts.find((a) => a.tipo === 'antecipacao_tributaria')!;
  assert.notEqual(multiArtifact.templateId, 999);
  assert.equal(resMulti.rowsByDestination.antecipacao_tributaria!.length, 1);
  assert.equal(resMulti.fcpRowsByDestination!.antecipacao_tributaria!.length, 2);

  const cteMultiProc = resMulti.notasProcessadas.find((n) => n.metadados_extras.tipo_documento === 'cte')!;
  assert.equal(cteMultiProc.metadados_extras.fcp_separado, true);
  const parcelas = cteMultiProc.metadados_extras.fcp_parcelas as Array<Record<string, unknown>>;
  assert.equal(parcelas.length, 2);
  const expectedKeys = [
    'base_calculo',
    'debito',
    'fcp_aliquota',
    'fcp_base_st',
    'fcp_detalhe',
    'fcp_origem',
    'fcp_valor_devido',
    'mva',
    'percentual_rateio',
    'reducao',
    'v_total',
  ];
  for (const parcela of parcelas) {
    assert.deepEqual(Object.keys(parcela).sort(), expectedKeys);
  }
  const p2 = parcelas.find((p) => p.fcp_aliquota === '0.0200')!;
  const p1 = parcelas.find((p) => p.fcp_aliquota === '0.0100')!;
  assert.equal(p2.v_total, '60.00');
  assert.equal(p1.v_total, '40.00');
  assert.equal(p1.reducao, '0.41463');

  // Parte C: Simples Nacional desdobra proporcionalmente e nao gera aba FCP
  const ctxSn = buildFcpContext({ simples: true, presetBebidas: true });
  const resSn = await processFiscalLocally(
    {
      solicitacaoId: 'fcp-cte-sn',
      periodoInicio: '2026-01-01',
      periodoFim: '2026-01-31',
      context: ctxSn,
      input: {
        xmlFiles: [
          new File([xmlNorm], '201.xml', { type: 'text/xml' }),
          new File([cteNormXml], 'cte15420.xml', { type: 'text/xml' }),
        ],
      },
    },
    new Map(),
    loadTemplate,
  );
  const ctesSn = resSn.notasProcessadas
    .filter((n) => n.metadados_extras.tipo_documento === 'cte')
    .sort((a, b) => a.item_numero - b.item_numero);
  assert.equal(ctesSn.length, 2);
  const byRate = new Map(ctesSn.map((n) => [n.a_dst_resolvida, n]));
  assert.equal(byRate.get(0.205)!.v_total, 100);
  assert.equal(byRate.get(0.205)!.metadados_extras.mva, '45');
  assert.equal(byRate.get(0.205)!.metadados_extras.fcp_aliquota, null);

  assert.equal(byRate.get(0.225)!.v_total, 100);
  assert.equal(byRate.get(0.225)!.metadados_extras.mva, '189.32');
  assert.equal(byRate.get(0.225)!.metadados_extras.fcp_aliquota, '0.0200');
  assert.equal(byRate.get(0.225)!.metadados_extras.fcp_separado, false);

  const snCteNums = resSn.rowsByDestination.antecipacao_tributaria!
    .filter((r) => r.numero_nota.startsWith('15420'))
    .map((r) => r.numero_nota);
  assert.deepEqual(snCteNums, ['15420', '15420*']);
  assert.equal(resSn.fcpRowsByDestination?.antecipacao_tributaria?.length ?? 0, 0);
  const snSheet = await readSheetValues(resSn.artifacts[0].bytes, '01-2026');
  assert.deepEqual(snSheet.visibleNames, ['01-2026']);
});

test('AT Antecipado Regime Normal gera aba FCP sem data de entrada e valida faixa de aliquota FCP', async () => {
  const ctx = buildFcpContext({ simples: false, presetBebidas: true });
  const xml = xmlNfeItens({
    numero: '107',
    chave: chaveNfe('2601', 107),
    itens: [
      { ncm: '22030000', cest: '0302103', cfop: '6403', xProd: 'CERVEJA PILSEN 350ML', vProd: '800.00' },
    ],
  });
  const chvSped = chaveNfe('2601', 990);
  const spedText = [
    `|0000|019|0|01012026|31012026|Bebidas|${EMPRESA_CNPJ}||BA|83592715|2927408|||A|1|`,
    `|0150|F1|FORN|1058|${FORNECEDOR_CNPJ}||SP|3550308||R|1||C|`,
    '|0200|P1|PROD|||UN|01|21069090|||18,00||',
    `|C100|0|1|F1|55|00|1|990|${chvSped}|05012026|12012026|100,00|0|0,00|0,00|100,00|0|0,00|0,00|0,00|100,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|`,
    '|C170|1|P1|PROD|1,000|UN|100,00|0,00|0|000|6102||100,00|12,00|0,00|0,00|0,00|0,00|0|50|999|0,00|0,00|0,00|',
    '|9999|6|',
  ].join('\n');

  const res = await processFiscalLocally(
    {
      solicitacaoId: 'fcp-at-antecipado',
      periodoInicio: '2026-01-01',
      periodoFim: '2026-01-31',
      context: ctx,
      input: {
        xmlFiles: [new File([xml], '107.xml', { type: 'text/xml' })],
        spedFiles: [new File([spedText], 'sped.txt', { type: 'text/plain' })],
      },
    },
    new Map(),
    loadTemplate,
  );

  const noteAt = res.notasProcessadas.find((n) => n.destino_planilha === 'antecipacao_tributaria_antecipado')!;
  assert.ok(noteAt);
  assert.equal(noteAt.data_entrada, null);
  assert.equal(noteAt.metadados_extras.fcp_separado, true);

  const artAt = res.artifacts.find((a) => a.tipo === 'antecipacao_tributaria_antecipado')!;
  const sheetFcp = await readSheetValues(artAt.bytes, '01-2026 FCP');
  assert.deepEqual(sheetFcp.visibleNames, ['01-2026', '01-2026 FCP']);
  assert.equal(sheetFcp.cell('B4'), '');
  assert.equal(sheetFcp.cell('J4'), '2');
  assert.equal(sheetFcp.cell('K4'), '0');
  assert.equal(sheetFcp.cell('S4'), '0');

  // Alíquota FCP fora da faixa [0, 1] dispara validação
  const ctxInvalid = buildFcpContext({
    simples: false,
    regrasFcp: [makeFcpRule(77, '2203', 1.5)],
  });
  await assert.rejects(
    () => processFiscalLocally(
      {
        solicitacaoId: 'fcp-invalido',
        periodoInicio: '2026-01-01',
        periodoFim: '2026-01-31',
        context: ctxInvalid,
        input: { xmlFiles: [new File([xml], '107.xml', { type: 'text/xml' })] },
      },
      new Map(),
      loadTemplate,
    ),
    /valores fiscais fora da faixa válida/,
  );
});
