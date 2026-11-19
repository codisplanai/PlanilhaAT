import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { installDomParserPolyfill } from './domPolyfill.ts';

installDomParserPolyfill();

import {
  resolveFcp,
  resolveStandardDestinationRate,
} from '../src/lib/localProcessing/rules.ts';
import {
  XML_NS,
  fillTemplateLocally,
  getCellValue,
  getSharedStrings,
  parseXml,
  workbookSheets,
} from '../src/lib/localProcessing/xlsx.ts';
import { readZip } from '../src/lib/localProcessing/zip.ts';
import type { ExtractedItem } from '../src/lib/localProcessing/domain.ts';
import type { LocalOutputRow, LocalTemplateDescriptor } from '../src/types/localProcessing.ts';
import type { RegraFcp } from '../src/types/regraFcp.ts';
import { buildContext } from './localFixtures.ts';

function makeItem(overrides: Partial<ExtractedItem> = {}): ExtractedItem {
  return {
    itemNumero: 1,
    ncm: '22030000',
    cest: '',
    cfop: '6403',
    descricao: 'CERVEJA PILSEN LATA 350ML',
    descricaoConfiavel: true,
    vItem: 1000,
    vTotal: 1000,
    baseCalculo: 1000,
    ipiDespesas: 0,
    aOri: 0.07,
    vIcms: 70,
    ...overrides,
  };
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
    descricao: null,
    excecoes: [],
    ...extra,
  };
}

function loadAtTemplateBytes(): ArrayBuffer {
  const local = path.resolve('storage/templates/modelo_padrao_antecipacao_tributaria.xlsx');
  const resolved = fs.existsSync(local)
    ? local
    : path.resolve('../storage/templates/modelo_padrao_antecipacao_tributaria.xlsx');
  const buf = fs.readFileSync(resolved);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

function atTemplateDescriptor(): LocalTemplateDescriptor {
  return {
    id: 10,
    tipo: 'antecipacao_tributaria',
    versao: 1,
    capacidade_linhas: 35,
    arquivo_hash: 'hash-at',
    mapeamento_campos: {
      start_row: 4,
      header_cell: 'A2',
      aliquota_format: 'percent_number',
      columns: {
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
      },
    },
  };
}

function sampleMainRow(overrides: Partial<LocalOutputRow> = {}): LocalOutputRow {
  return {
    numero_nota: '1001',
    cnpj_destinatario: '12345678000195',
    data_emissao: '2026-05-05',
    data_entrada: '2026-05-10',
    item_numero: 1,
    ncm: '22030000',
    v_total: 1000,
    base_calculo: 1000,
    ipi_despesas: 0,
    mva: 64.39,
    reducao: null,
    red: '',
    aliq_simples: 'N',
    a_ori: 0.07,
    a_dst: 0.25,
    debito: 410.98,
    credito: 70,
    valor_devido: 340.98,
    valor_pago: 0,
    ...overrides,
  };
}

function sampleFcpRow(overrides: Partial<LocalOutputRow> = {}): LocalOutputRow {
  return {
    ...sampleMainRow(),
    a_dst: 0.02,
    a_ori: 0,
    debito: 32.88,
    credito: 0,
    valor_devido: 32.88,
    valor_pago: 0,
    ...overrides,
  };
}

function readCell(doc: XMLDocument, ref: string, shared: string[]): { value: string; hasFormula: boolean; formulaText: string } {
  const cell = Array.from(doc.getElementsByTagNameNS(XML_NS, 'c')).find((c) => c.getAttribute('r') === ref);
  if (!cell) return { value: '', hasFormula: false, formulaText: '' };
  const formulaEl = cell.getElementsByTagNameNS(XML_NS, 'f')[0];
  return {
    value: getCellValue(cell, shared),
    hasFormula: Boolean(formulaEl),
    formulaText: formulaEl?.textContent ?? '',
  };
}

test('resolveStandardDestinationRate casa prefixo NCM mais especifico', () => {
  const context = buildContext();
  context.regras_aliquotas = [
    { id: 1, perfil_regras_id: 1, uf: 'BA', ncm: null, aliquota: 0.205, parametros_extras: {}, criado_em: '', atualizado_em: '' },
    { id: 2, perfil_regras_id: 1, uf: 'BA', ncm: '2203', aliquota: 0.25, parametros_extras: {}, criado_em: '', atualizado_em: '' },
    { id: 3, perfil_regras_id: 1, uf: 'BA', ncm: '22030000', aliquota: 0.27, parametros_extras: {}, criado_em: '', atualizado_em: '' },
  ];

  const exact = resolveStandardDestinationRate(context, makeItem({ ncm: '22030000' }));
  assert.equal(exact.aliquota, 0.27);
  assert.equal(exact.origem, 'regra_ncm:3');

  const formatted = resolveStandardDestinationRate(context, makeItem({ ncm: '2203.00.00' }));
  assert.equal(formatted.aliquota, 0.27);
  assert.equal(formatted.origem, 'regra_ncm:3');

  const prefix = resolveStandardDestinationRate(context, makeItem({ ncm: '22039900' }));
  assert.equal(prefix.aliquota, 0.25);
  assert.equal(prefix.origem, 'regra_ncm:2');

  const fallback = resolveStandardDestinationRate(context, makeItem({ ncm: '22011000' }));
  assert.equal(fallback.aliquota, 0.205);
  assert.equal(fallback.origem, 'padrao_uf:1');

  const zeroNcm = resolveStandardDestinationRate(context, makeItem({ ncm: '00000000' }));
  assert.equal(zeroNcm.aliquota, 0.205);
  assert.equal(zeroNcm.origem, 'padrao_uf:1');
});

test('resolveFcp aplica excecao exata, termos, exclusao e aplicar_com_termo_acordo', () => {
  const context = buildContext();
  context.regras_fcp = [
    makeFcpRule(10, '22021000', 0.02, {
      termos_inclusao: ['REFRIGERANTE', 'REFRI*'],
      termos_exclusao: ['AGUA'],
      descricao: 'Refrigerantes BA',
      excecoes: [
        { id: 101, descricao_exata: 'REFRIGERANTE DIET ESPECIAL', enquadrado: false },
        { id: 102, descricao_exata: 'GUARANA DO NORTE', enquadrado: true },
      ],
    }),
    makeFcpRule(11, '22021000', 0.02, {
      uf: 'SE',
      descricao: 'Bebidas SE',
    }),
    makeFcpRule(12, '2203', 0.02, {
      aplicar_com_termo_acordo: false,
      descricao: 'Cervejas sem termo acordo',
    }),
    makeFcpRule(13, '22030000', 0.04, {
      termos_inclusao: ['CRAFT'],
      descricao: 'Cerveja artesanal',
    }),
  ];

  // Exceção negativa bloqueia mesmo casando termo de inclusão
  assert.equal(
    resolveFcp(context, makeItem({ ncm: '22021000', descricao: 'Refrigerante Diet Especial' })),
    null,
  );

  // Exceção positiva aplica origem excecao_fcp:<id> mesmo sem termo de inclusão
  const resExcPos = resolveFcp(context, makeItem({ ncm: '22021000', descricao: 'Guaraná do Norte' }));
  assert.ok(resExcPos);
  assert.equal(resExcPos.aliquota, 0.02);
  assert.equal(resExcPos.origem, 'excecao_fcp:102');

  // Termos de inclusão / exclusão
  const resRefri = resolveFcp(context, makeItem({ ncm: '22021000', descricao: 'REFRIGERANTE COLA 2L' }));
  assert.ok(resRefri);
  assert.equal(resRefri.aliquota, 0.02);
  assert.equal(resRefri.origem, 'fcp_produto:10');

  assert.equal(
    resolveFcp(context, makeItem({ ncm: '22021000', descricao: 'REFRIGERANTE COM AGUA MINERAL' })),
    null,
  );

  // Precedência: termos > genérica e respeito ao prefixo mais específico
  const resCraft = resolveFcp(context, makeItem({ ncm: '22030000', descricao: 'CERVEJA CRAFT IPA' }));
  assert.ok(resCraft);
  assert.equal(resCraft.aliquota, 0.04);
  assert.equal(resCraft.origem, 'fcp_produto:13');

  // aplicar_com_termo_acordo=false sem e com termo_acordo
  const resSemAcordo = resolveFcp(context, makeItem({ ncm: '22030000', descricao: 'CERVEJA PILSEN' }));
  assert.ok(resSemAcordo);
  assert.equal(resSemAcordo.aliquota, 0.02);
  assert.equal(resSemAcordo.origem, 'fcp_produto:12');

  context.empresa.termo_acordo = { id: 50, aliquota: 0.12, descricao: 'Acordo Atacado' };
  assert.equal(
    resolveFcp(context, makeItem({ ncm: '22030000', descricao: 'CERVEJA PILSEN' })),
    null,
  );
  // Regra com aplicar_com_termo_acordo=true continua aplicando com termo_acordo
  const resComAcordo = resolveFcp(context, makeItem({ ncm: '22030000', descricao: 'CERVEJA CRAFT IPA' }));
  assert.ok(resComAcordo);
  assert.equal(resComAcordo.aliquota, 0.04);

  // Colisão com mesma alíquota -> aplica e gera aviso
  context.empresa.termo_acordo = null;
  context.regras_fcp = [
    makeFcpRule(21, '22021000', 0.02, { termos_inclusao: ['REFRI*'], descricao: 'Regra A' }),
    makeFcpRule(22, '22021000', 0.02, { termos_inclusao: ['REFRIGERANTE'], descricao: 'Regra B' }),
  ];
  const resColisaoIgual = resolveFcp(context, makeItem({ ncm: '22021000', descricao: 'REFRIGERANTE GUARANA' }));
  assert.ok(resColisaoIgual);
  assert.equal(resColisaoIgual.aliquota, 0.02);
  assert.equal(resColisaoIgual.origem, 'fcp_produto:21');
  assert.ok(resColisaoIgual.aviso);
  assert.match(resColisaoIgual.aviso!, /FCP/);

  // Colisão com alíquotas divergentes -> lança Error
  context.regras_fcp[1].aliquota = 0.04;
  assert.throws(
    () => resolveFcp(context, makeItem({ ncm: '22021000', descricao: 'REFRIGERANTE GUARANA' })),
    (err: Error) => {
      assert.match(err.message, /FCP/);
      assert.match(err.message, /22021000/);
      return true;
    },
  );

  // Filtro de perfil_regras_id e colisão de exceções exatas
  context.regras_fcp = [
    makeFcpRule(29, '22021000', 0.05, { perfil_regras_id: 999 }),
    makeFcpRule(30, '22021000', 0.02, {
      excecoes: [{ id: 201, descricao_exata: 'GUARANA ESPECIAL', enquadrado: true }],
    }),
    makeFcpRule(31, '22021000', 0.02, {
      excecoes: [{ id: 202, descricao_exata: 'GUARANA ESPECIAL', enquadrado: true }],
    }),
  ];
  const resExcColisao = resolveFcp(context, makeItem({ ncm: '22021000', descricao: 'Guaraná Especial' }));
  assert.ok(resExcColisao);
  assert.equal(resExcColisao.origem, 'excecao_fcp:201');
  assert.match(resExcColisao.aviso!, /exceções de FCP/);
});

test('resolveFcp sem descricao confiavel casa regra generica e ignora regra com termos', () => {
  const context = buildContext();
  context.regras_fcp = [
    makeFcpRule(31, '2203', 0.02, { termos_exclusao: ['SEM ALCOOL'], descricao: 'Cervejas' }),
    makeFcpRule(32, '22021000', 0.02, { termos_inclusao: ['REFRIGERANTE'], descricao: 'Refrigerantes' }),
  ];

  // Sem descrição confiável: regra genérica casa (mesmo tendo termos_exclusao)
  const resGen = resolveFcp(
    context,
    makeItem({ ncm: '22030000', descricao: 'CERVEJA SEM ALCOOL 350ML', descricaoConfiavel: false }),
  );
  assert.ok(resGen);
  assert.equal(resGen.aliquota, 0.02);
  assert.equal(resGen.origem, 'fcp_produto:31');

  // Com descrição confiável que casa exclusão da genérica: não casa
  assert.equal(
    resolveFcp(
      context,
      makeItem({ ncm: '22030000', descricao: 'CERVEJA SEM ALCOOL 350ML', descricaoConfiavel: true }),
    ),
    null,
  );

  // Sem descrição confiável: regra com termos_inclusao NÃO casa
  assert.equal(
    resolveFcp(
      context,
      makeItem({ ncm: '22021000', descricao: 'REFRIGERANTE COLA 2L', descricaoConfiavel: false }),
    ),
    null,
  );
});

test('fillTemplateLocally gera segunda aba MM-AAAA FCP preservando workbook, rels, desenhos e formulas', async () => {
  const templateBytes = loadAtTemplateBytes();
  const output = await fillTemplateLocally(
    templateBytes,
    atTemplateDescriptor(),
    [sampleMainRow()],
    { razaoSocial: 'BEBIDAS BAHIA LTDA', ie: '83592715', competencia: '05/2026', month: 5, year: 2026 },
    [sampleFcpRow()],
  );

  const entries = await readZip(output);
  const sheets = workbookSheets(entries);
  const visible = sheets.filter((s) => !s.hidden);

  assert.deepEqual(
    visible.map((s) => s.name),
    ['05-2026', '05-2026 FCP'],
  );
  assert.equal(visible[0].active, true);
  assert.equal(visible[1].active, false);

  const mainPath = visible[0].path;
  const fcpPath = visible[1].path;
  assert.notEqual(mainPath, fcpPath);

  // Override em [Content_Types].xml
  const contentTypesRaw = entries.get('[Content_Types].xml');
  assert.ok(contentTypesRaw);
  const contentTypes = new TextDecoder('utf-8').decode(contentTypesRaw);
  assert.ok(contentTypes.includes(`/${fcpPath}`), 'esperava Override para a aba FCP em [Content_Types].xml');

  // Relacionamentos de desenho clonados para ambas as abas
  const mainFile = mainPath.split('/').pop()!;
  const fcpFile = fcpPath.split('/').pop()!;
  const mainRels = entries.get(`xl/worksheets/_rels/${mainFile}.rels`);
  const fcpRels = entries.get(`xl/worksheets/_rels/${fcpFile}.rels`);
  assert.ok(mainRels, 'esperava .rels da aba principal');
  assert.ok(fcpRels, 'esperava .rels clonado na aba FCP');
  assert.equal(
    new TextDecoder('utf-8').decode(fcpRels),
    new TextDecoder('utf-8').decode(mainRels),
  );

  const shared = getSharedStrings(entries);
  const mainDoc = parseXml(entries.get(mainPath)!, mainPath);
  const fcpDoc = parseXml(entries.get(fcpPath)!, fcpPath);

  // Ambas as abas preservam a tag <drawing>
  assert.equal(mainDoc.getElementsByTagNameNS(XML_NS, 'drawing').length, 1);
  assert.equal(fcpDoc.getElementsByTagNameNS(XML_NS, 'drawing').length, 1);

  // Cabeçalho e valores principais
  assert.match(readCell(mainDoc, 'A2', shared).value, /BEBIDAS BAHIA LTDA/);
  assert.match(readCell(mainDoc, 'A2', shared).value, /05\/2026/);
  assert.equal(readCell(mainDoc, 'J4', shared).value, '25');
  assert.equal(readCell(mainDoc, 'K4', shared).value, '7');

  // Cabeçalho e valores FCP (A.DST=2, A.ORI=0)
  assert.match(readCell(fcpDoc, 'A2', shared).value, /BEBIDAS BAHIA LTDA/);
  assert.match(readCell(fcpDoc, 'A2', shared).value, /05\/2026/);
  assert.equal(readCell(fcpDoc, 'D4', shared).value, '1001');
  assert.equal(readCell(fcpDoc, 'E4', shared).value, '1000');
  assert.equal(readCell(fcpDoc, 'H4', shared).value, '64.39');
  assert.equal(readCell(fcpDoc, 'J4', shared).value, '2');
  assert.equal(readCell(fcpDoc, 'K4', shared).value, '0');
  assert.equal(readCell(fcpDoc, 'S4', shared).value, '0');

  // Fórmulas preservadas em ambas as abas
  for (const [label, doc] of [['05-2026', mainDoc], ['05-2026 FCP', fcpDoc]] as const) {
    assert.equal(readCell(doc, 'N4', shared).hasFormula, true, `${label}!N4 deve manter fórmula`);
    assert.equal(readCell(doc, 'O4', shared).formulaText, 'N4*J4%');
    assert.equal(readCell(doc, 'E39', shared).formulaText, 'SUM(E4:E38)');
    assert.equal(readCell(doc, 'Q39', shared).formulaText, 'SUM(Q4:Q38)');
  }
});

test('fillTemplateLocally limpa linhas residuais na aba principal e na aba FCP', async () => {
  const templateBytes = loadAtTemplateBytes();
  const output = await fillTemplateLocally(
    templateBytes,
    atTemplateDescriptor(),
    [sampleMainRow({ data_entrada: null })],
    { razaoSocial: 'BEBIDAS BAHIA LTDA', ie: '83592715', competencia: '05/2026', month: 5, year: 2026 },
    [sampleFcpRow({ data_entrada: null })],
  );

  const entries = await readZip(output);
  const sheets = workbookSheets(entries);
  const visible = sheets.filter((s) => !s.hidden);
  const shared = getSharedStrings(entries);

  assert.equal(visible.length, 2);

  for (const sheet of visible) {
    const doc = parseXml(entries.get(sheet.path)!, sheet.path);
    // Linha 4 com data_entrada: null limpa resíduo de B4 do template
    assert.equal(readCell(doc, 'B4', shared).value, '', `${sheet.name}!B4 deve ser limpa quando data_entrada é null`);

    // Linhas residuais 5 e 6 do template limpas nas colunas de dados
    for (const ref of ['D5', 'E5', 'F5', 'G5', 'H5', 'I5', 'J5', 'K5', 'S5', 'H6', 'J6', 'S6']) {
      assert.equal(readCell(doc, ref, shared).value, '', `${sheet.name}!${ref} deve ser limpa`);
    }

    // item_index pré-numerado no modelo permanece intacto
    assert.equal(readCell(doc, 'A5', shared).value, '2');
    assert.equal(readCell(doc, 'A6', shared).value, '3');

    // Fórmulas da grade e linha 39 =SUM(...) intactas
    assert.equal(readCell(doc, 'N5', shared).hasFormula, true);
    assert.equal(readCell(doc, 'O5', shared).formulaText, 'N5*J5%');
    assert.equal(readCell(doc, 'Q5', shared).formulaText, 'O5-P5');
    for (const col of ['E', 'F', 'G', 'N', 'O', 'P', 'Q', 'S', 'T']) {
      assert.match(readCell(doc, `${col}39`, shared).formulaText, /^SUM\(/, `${sheet.name}!${col}39 deve manter SUM`);
    }
  }
});

test('fillTemplateLocally sem fcpRows gera aba unica e competencia existente nao duplica nomes', async () => {
  const templateBytes = loadAtTemplateBytes();
  const singleOut = await fillTemplateLocally(
    templateBytes,
    atTemplateDescriptor(),
    [sampleMainRow()],
    { razaoSocial: 'BEBIDAS BAHIA LTDA', ie: '83592715', competencia: '05/2026', month: 5, year: 2026 },
    [],
  );
  const singleSheets = workbookSheets(await readZip(singleOut));
  assert.deepEqual(
    singleSheets.filter((s) => !s.hidden).map((s) => s.name),
    ['05-2026'],
  );

  // Competência 12/2025 já existe no modelo ("12-2025" e "12-2025 FCP"): não duplica nome nem seleciona aba errada
  const decOut = await fillTemplateLocally(
    templateBytes,
    atTemplateDescriptor(),
    [sampleMainRow()],
    { razaoSocial: 'BEBIDAS BAHIA LTDA', ie: '83592715', competencia: '12/2025', month: 12, year: 2025 },
    [sampleFcpRow()],
  );
  const decSheets = workbookSheets(await readZip(decOut));
  const allLowerNames = decSheets.map((s) => s.name.toLowerCase());
  assert.equal(new Set(allLowerNames).size, allLowerNames.length, 'nomes de abas no workbook devem ser únicos');
  assert.deepEqual(
    decSheets.filter((s) => !s.hidden).map((s) => s.name),
    ['12-2025', '12-2025 FCP'],
  );
});
