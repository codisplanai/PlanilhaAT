import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { installDomParserPolyfill } from './domPolyfill.ts';

installDomParserPolyfill();

import { processFiscalLocally } from '../src/lib/localProcessing/processor.ts';
import { extractNfeNumberAndSeriesFromKey, parseCteXml } from '../src/lib/localProcessing/xml.ts';
import { getCellValue, getSharedStrings, parseXml, workbookSheets, XML_NS } from '../src/lib/localProcessing/xlsx.ts';
import { readZip, writeZip } from '../src/lib/localProcessing/zip.ts';
import type { LocalProcessingContext, LocalTemplateDescriptor } from '../src/types/localProcessing.ts';
import type { TipoPlanilha } from '../src/types/solicitacao.ts';
import { EMPRESA_CNPJ, buildContext, chave as chaveNfe } from './localFixtures.ts';

const FORNECEDOR_CNPJ = '98765432000180';
const TRANSPORTADORA_CNPJ = '11222333000181';

function chaveCte(aamm: string, numero: number): string {
  return `35${aamm}${TRANSPORTADORA_CNPJ}57001${String(numero).padStart(9, '0')}1${String(numero).padStart(8, '0')}0`;
}

function buildCteXml(opts: {
  numero: string;
  chave: string;
  vTPrest: string;
  dia?: string;
  mes?: string;
  ano?: string;
  toma?: string;
  cnpjToma4?: string;
  ufEmit?: string;
  ufIni?: string;
  cUf?: string;
  cfop?: string;
  pIcms?: string;
  icmsTag?: string;
  crt?: string;
  chavesNfe?: string[];
}): string {
  const {
    numero,
    chave,
    vTPrest,
    dia = '15',
    mes = '01',
    ano = '2026',
    toma = '3',
    cnpjToma4 = '',
    ufEmit = 'SP',
    ufIni = 'SP',
    cUf = '35',
    cfop = '6352',
    pIcms = '12.00',
    icmsTag = 'ICMS00',
    crt = '3',
    chavesNfe = [],
  } = opts;
  const tomaXml = toma === '4'
    ? `<toma4><toma>4</toma><CNPJ>${cnpjToma4}</CNPJ></toma4>`
    : `<toma3><toma>${toma}</toma></toma3>`;
  const icmsInner = icmsTag === 'ICMSSN'
    ? '<ICMSSN><CST>90</CST><indSN>1</indSN></ICMSSN>'
    : Number(pIcms) > 0
      ? `<${icmsTag}><CST>00</CST><vBC>${vTPrest}</vBC><pICMS>${pIcms}</pICMS><vICMS>${((Number(vTPrest) * Number(pIcms)) / 100).toFixed(2)}</vICMS></${icmsTag}>`
      : `<${icmsTag}><CST>40</CST></${icmsTag}>`;
  const nfesXml = chavesNfe.map((chv) => `<infNFe><chave>${chv}</chave></infNFe>`).join('');
  const enderEmitXml = ufEmit ? `<enderEmit><UF>${ufEmit}</UF></enderEmit>` : '';

  return `<?xml version="1.0" encoding="UTF-8"?>
<cteProc xmlns="http://www.portalfiscal.inf.br/cte" versao="4.00">
  <CTe>
    <infCte Id="CTe${chave}" versao="4.00">
      <ide>
        <cUF>${cUf}</cUF>
        <nCT>${numero}</nCT>
        <serie>1</serie>
        <CFOP>${cfop}</CFOP>
        <dhEmi>${ano}-${mes}-${dia}T10:00:00-03:00</dhEmi>
        <UFIni>${ufIni}</UFIni>
        <UFFim>BA</UFFim>
        ${tomaXml}
      </ide>
      <emit>
        <CNPJ>${TRANSPORTADORA_CNPJ}</CNPJ>
        <xNome>TRANSPORTADORA TESTE</xNome>
        <CRT>${crt}</CRT>
        ${enderEmitXml}
      </emit>
      <rem><CNPJ>${FORNECEDOR_CNPJ}</CNPJ></rem>
      <dest><CNPJ>${EMPRESA_CNPJ}</CNPJ></dest>
      <vPrest><vTPrest>${vTPrest}</vTPrest><vRec>${vTPrest}</vRec></vPrest>
      <imp><ICMS>${icmsInner}</ICMS></imp>
      <infCTeNorm><infDoc>${nfesXml}</infDoc></infCTeNorm>
    </infCte>
  </CTe>
</cteProc>`;
}

function xmlNfeMista(chave: string, numero: string, mes = '01', ano = '2026'): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe">
  <NFe>
    <infNFe Id="NFe${chave}">
      <ide><nNF>${numero}</nNF><serie>1</serie><dhEmi>${ano}-${mes}-10T10:00:00-03:00</dhEmi></ide>
      <emit><CNPJ>${FORNECEDOR_CNPJ}</CNPJ><CRT>3</CRT><enderEmit><UF>SP</UF></enderEmit></emit>
      <dest><CNPJ>${EMPRESA_CNPJ}</CNPJ><enderDest><UF>BA</UF></enderDest></dest>
      <total><ICMSTot><vNF>1000.00</vNF><vBC>950.00</vBC></ICMSTot></total>
      <det nItem="1">
        <prod><NCM>73170090</NCM><CEST>1005700</CEST><CFOP>6403</CFOP><xProd>PREGO</xProd>
          <vProd>500.00</vProd></prod>
        <imposto>
          <ICMS><ICMS00><orig>0</orig><CST>00</CST><vBC>500.00</vBC><pICMS>12.00</pICMS><vICMS>60.00</vICMS></ICMS00></ICMS>
          <IPI><IPITrib><vIPI>50.00</vIPI></IPITrib></IPI>
        </imposto>
      </det>
      <det nItem="2">
        <prod><NCM>39269090</NCM><CFOP>6556</CFOP><xProd>CONSUMO</xProd>
          <vProd>200.00</vProd></prod>
        <imposto><ICMS><ICMS00><orig>0</orig><CST>00</CST><vBC>200.00</vBC><pICMS>12.00</pICMS></ICMS00></ICMS></imposto>
      </det>
      <det nItem="3">
        <prod><NCM>21069090</NCM><CFOP>6102</CFOP><xProd>REVENDA</xProd>
          <vProd>250.00</vProd></prod>
        <imposto><ICMS><ICMS00><orig>0</orig><CST>00</CST><vBC>250.00</vBC><pICMS>12.00</pICMS></ICMS00></ICMS></imposto>
      </det>
    </infNFe>
  </NFe>
</nfeProc>`;
}

const TEMPLATE_FILES: Partial<Record<TipoPlanilha, string>> = {
  antecipacao_parcial: 'modelo_padrao_antecipacao_parcial.xlsx',
  antecipacao_tributaria: 'modelo_padrao_antecipacao_tributaria.xlsx',
  antecipacao_tributaria_antecipado: 'modelo_padrao_antecipacao_tributaria_antecipado.xlsx',
  difal: 'modelo_padrao_difal.xlsx',
  difal_antecipado: 'modelo_padrao_difal.xlsx',
};

async function loadTemplate(template: LocalTemplateDescriptor): Promise<ArrayBuffer> {
  const file = TEMPLATE_FILES[template.tipo]!;
  const local = path.resolve('storage/templates', file);
  const resolved = fs.existsSync(local) ? local : path.resolve('../storage/templates', file);
  const buf = fs.readFileSync(resolved);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

function buildCteContext(): LocalProcessingContext {
  const ctx = buildContext();
  ctx.templates_ativos.push({
    ...ctx.templates_ativos.find((t) => t.tipo === 'antecipacao_tributaria')!,
    id: 99,
    tipo: 'antecipacao_tributaria_antecipado',
    mapeamento_campos: {
      ...ctx.templates_ativos.find((t) => t.tipo === 'antecipacao_tributaria')!.mapeamento_campos,
      sheet_name: '4',
    },
  });
  ctx.mva_anexo = [
    {
      ncm: '7317',
      item: '8.57',
      cest: ['10.057.00'],
      mva_ajustada: [{ caso: null, aliquotas: { '4': 58.18, '7': 53.24, '12': 45 } }],
      mva_original: [{ caso: null, valor: 45 }],
    },
    {
      ncm: '7308901',
      item: '8.41',
      cest: ['10.041.00'],
      mva_ajustada: [{ caso: null, aliquotas: { '4': 63.02, '7': 57.92, '12': 49.43 } }],
      mva_original: [{ caso: null, valor: 35 }],
    },
  ];
  return ctx;
}

async function readSheetCell(xlsxBytes: ArrayBuffer, ref: string): Promise<string | null> {
  const entries = await readZip(xlsxBytes);
  const sheets = workbookSheets(entries);
  const visible = sheets.find((s) => !s.hidden) ?? sheets[0]!;
  const doc = parseXml(entries.get(visible.path)!, visible.path);
  const shared = getSharedStrings(entries);
  const cell = Array.from(doc.getElementsByTagNameNS(XML_NS, 'c')).find((c) => c.getAttribute('r') === ref);
  if (!cell) return null;
  const val = getCellValue(cell, shared);
  return val === '' ? null : val;
}

test('parseCteXml extrai tomador (<toma3>/<toma4>), alíquota e chaves de NF-e', () => {
  const nfChave = chaveNfe('2601', 901);
  const cte = parseCteXml(
    buildCteXml({
      numero: '15420',
      chave: chaveCte('2601', 15420),
      vTPrest: '350.00',
      toma: '3',
      pIcms: '12.00',
      chavesNfe: [nfChave],
    }),
    'cte15420.xml',
  );
  assert.equal(cte.numeroCte, '15420');
  assert.equal(cte.cnpjTomador, EMPRESA_CNPJ);
  assert.equal(cte.vTotalCte, 350);
  assert.equal(cte.aOri, 0.12);
  assert.equal(cte.aOriHighlighted, true);
  assert.deepEqual(cte.chavesNfe, [nfChave]);
  assert.deepEqual(extractNfeNumberAndSeriesFromKey(nfChave), { numeroNota: '901', serie: '1' });
});

test('CT-e com NF-e faltante pausa na pré-análise e processa ao anexar ZIP de outro período', async () => {
  const ctx = buildCteContext();
  const chvNfDez = chaveNfe('2512', 801);
  const cteXml = buildCteXml({
    numero: '15420',
    chave: chaveCte('2601', 15420),
    vTPrest: '300.00',
    toma: '3',
    pIcms: '0.00',
    chavesNfe: [chvNfDez],
  });

  const firstRun = await processFiscalLocally(
    {
      solicitacaoId: 'teste-cte-1',
      periodoInicio: '2026-01-01',
      periodoFim: '2026-01-31',
      context: ctx,
      input: {
        xmlFiles: [new File([cteXml], 'cte15420.xml', { type: 'text/xml' })],
      },
    },
    new Map(),
    loadTemplate,
  );

  assert.equal(firstRun.preAnalysis.requer_decisao, true);
  assert.equal(firstRun.preAnalysis.ctes_sem_nfe?.length, 1);
  assert.equal(firstRun.preAnalysis.ctes_sem_nfe![0].cte_numero, '15420');
  assert.equal(firstRun.preAnalysis.ctes_sem_nfe![0].nfes_faltantes[0].chave_acesso, chvNfDez);
  assert.equal(firstRun.preAnalysis.ctes_sem_nfe![0].nfes_faltantes[0].numero_nota, '801');

  // Usuário fornece um ZIP contendo a NF-e de dezembro/2025 (período anterior)
  const enc = new TextEncoder();
  const zipBytes = writeZip(new Map([['nf801_dez.xml', enc.encode(xmlNfeMista(chvNfDez, '801', '12', '2025'))]]));
  const zipFile = new File([zipBytes], 'notas_dezembro.zip', { type: 'application/zip' });

  const secondRun = await processFiscalLocally(
    {
      solicitacaoId: 'teste-cte-1',
      periodoInicio: '2026-01-01',
      periodoFim: '2026-01-31',
      context: ctx,
      input: {
        xmlFiles: [new File([cteXml], 'cte15420.xml', { type: 'text/xml' }), zipFile],
      },
    },
    new Map(),
    loadTemplate,
  );

  assert.equal(secondRun.preAnalysis.requer_decisao, false);
  // NF-e de dezembro não gera linha própria nem polui notasIgnoradas
  assert.equal(secondRun.notasIgnoradas.length, 0);
  assert.equal(secondRun.notasProcessadas.length, 2); // Tributária (55%) e DIFAL (20%) do CT-e

  const trib = secondRun.rowsByDestination.antecipacao_tributaria!;
  assert.equal(trib.length, 1);
  assert.equal(trib[0].numero_nota, '15420');
  assert.equal(trib[0].v_total, 165);
  assert.equal(trib[0].mva, 45);
  assert.equal(trib[0].a_ori, null);

  const difal = secondRun.rowsByDestination.difal!;
  assert.equal(difal.length, 1);
  assert.equal(difal[0].numero_nota, '15420');
  assert.equal(difal[0].v_total, 60);
  assert.equal(difal[0].a_ori, null);

  // Confere que a célula K4 (A.ORI) da planilha gerada de Tributária ficou em branco
  const tribArtifact = secondRun.artifacts.find((a) => a.tipo === 'antecipacao_tributaria')!;
  assert.equal(await readSheetCell(tribArtifact.bytes, 'D4'), '15420');
  assert.equal(await readSheetCell(tribArtifact.bytes, 'E4'), '165');
  assert.equal(await readSheetCell(tribArtifact.bytes, 'K4'), null);
});

test('CT-e ignora quando tomador não é a empresa e usa SPED D100 / herança da NF-e', async () => {
  const ctx = buildCteContext();
  const chvNf = chaveNfe('2601', 501);
  const nfXml = `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe"><NFe><infNFe Id="NFe${chvNf}">
  <ide><nNF>501</nNF><serie>1</serie><dhEmi>2026-01-10T10:00:00-03:00</dhEmi></ide>
  <emit><CNPJ>${FORNECEDOR_CNPJ}</CNPJ><CRT>3</CRT><enderEmit><UF>SP</UF></enderEmit></emit>
  <dest><CNPJ>${EMPRESA_CNPJ}</CNPJ><enderDest><UF>BA</UF></enderDest></dest>
  <total><ICMSTot><vNF>1000.00</vNF><vBC>1000.00</vBC></ICMSTot></total>
  <det nItem="1"><prod><NCM>73170090</NCM><CEST>1005700</CEST><CFOP>6403</CFOP><xProd>PREGO</xProd><vProd>1000.00</vProd></prod>
    <imposto><ICMS><ICMS00><orig>0</orig><CST>00</CST><vBC>1000.00</vBC><pICMS>12.00</pICMS></ICMS00></ICMS></imposto>
  </det>
</infNFe></NFe></nfeProc>`;

  const cteOutroTomador = buildCteXml({
    numero: '900',
    chave: chaveCte('2601', 900),
    vTPrest: '100.00',
    toma: '0',
    chavesNfe: [chvNf],
  });
  const cteD100 = buildCteXml({
    numero: '2001',
    chave: chaveCte('2601', 2001),
    vTPrest: '200.00',
    toma: '3',
    chavesNfe: [chvNf],
  });
  const cteHerda = buildCteXml({
    numero: '2002',
    chave: chaveCte('2601', 2002),
    vTPrest: '150.00',
    toma: '3',
    chavesNfe: [chvNf],
  });

  const spedText = [
    `|0000|019|0|01012026|31012026|Cliente BA|${EMPRESA_CNPJ}||BA|123|2927408|||A|1|`,
    `|0150|F1|FORNECEDOR SP|1058|${FORNECEDOR_CNPJ}||SP|3550308||R|1||C|`,
    `|0150|T1|TRANSPORTADORA|1058|${TRANSPORTADORA_CNPJ}||SP|3550308||R|1||C|`,
    '|0200|P1|PREGO|||UN|01|73170090|||18,00||',
    `|C100|0|1|F1|55|00|1|501|${chvNf}|10012026|15012026|1000,00|0|0,00|0,00|1000,00|0|0,00|0,00|0,00|1000,00|120,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|`,
    '|C170|1|P1|PREGO|1,000|UN|1000,00|0,00|0|000|6403||1000,00|12,00|120,00|0,00|0,00|0,00|0|50|999|0,00|0,00|0,00|',
    `|D100|0|1|T1|57|00|1||2001|${chaveCte('2601', 2001)}|15012026|18012026|0||200,00|0|0,00|200,00|0,00|200,00|24,00|0,00|||`,
    '|9999|8|',
  ].join('\n');

  const res = await processFiscalLocally(
    {
      solicitacaoId: 'teste-cte-2',
      periodoInicio: '2026-01-01',
      periodoFim: '2026-01-31',
      context: ctx,
      input: {
        xmlFiles: [
          new File([nfXml], '501.xml', { type: 'text/xml' }),
          new File([cteOutroTomador], 'cte900.xml', { type: 'text/xml' }),
          new File([cteD100], 'cte2001.xml', { type: 'text/xml' }),
          new File([cteHerda], 'cte2002.xml', { type: 'text/xml' }),
        ],
        spedFiles: [new File([spedText], 'sped.txt', { type: 'text/plain' })],
      },
    },
    new Map(),
    loadTemplate,
  );

  assert.equal(res.notasIgnoradas.some((n) => n.numero_nota === '900'), true);
  const cteRows = res.rowsByDestination.antecipacao_tributaria!.filter((r) => r.numero_nota !== '501');
  assert.equal(cteRows.length, 2);
  const row2001 = cteRows.find((r) => r.numero_nota === '2001')!;
  const row2002 = cteRows.find((r) => r.numero_nota === '2002')!;
  assert.equal(row2001.data_entrada, '2026-01-18');
  assert.equal(row2002.data_entrada, '2026-01-15');
});

test('CT-e interno (mesma UF do emitente e tomador) é ignorado na pré-análise e no processamento', async () => {
  const ctx = buildCteContext();
  const chvNfSp = chaveNfe('2601', 610);
  const chvNfFaltante = chaveNfe('2601', 611);
  const nfXml = `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe"><NFe><infNFe Id="NFe${chvNfSp}">
  <ide><nNF>610</nNF><serie>1</serie><dhEmi>2026-01-10T10:00:00-03:00</dhEmi></ide>
  <emit><CNPJ>${FORNECEDOR_CNPJ}</CNPJ><CRT>3</CRT><enderEmit><UF>SP</UF></enderEmit></emit>
  <dest><CNPJ>${EMPRESA_CNPJ}</CNPJ><enderDest><UF>BA</UF></enderDest></dest>
  <total><ICMSTot><vNF>1000.00</vNF><vBC>1000.00</vBC></ICMSTot></total>
  <det nItem="1"><prod><NCM>73170090</NCM><CEST>1005700</CEST><CFOP>6403</CFOP><xProd>PREGO</xProd><vProd>1000.00</vProd></prod>
    <imposto><ICMS><ICMS00><orig>0</orig><CST>00</CST><vBC>1000.00</vBC><pICMS>12.00</pICMS></ICMS00></ICMS></imposto>
  </det>
</infNFe></NFe></nfeProc>`;

  const cteInternoFaltante = buildCteXml({
    numero: '4401',
    chave: `292601${TRANSPORTADORA_CNPJ}570010000044011000044010`,
    vTPrest: '200.00',
    toma: '3',
    ufEmit: '',
    ufIni: 'SP',
    cUf: '29',
    cfop: '5352',
    chavesNfe: [chvNfFaltante],
  });
  const cteInternoComNf = buildCteXml({
    numero: '4402',
    chave: `292601${TRANSPORTADORA_CNPJ}570010000044021000044020`,
    vTPrest: '300.00',
    toma: '3',
    ufEmit: 'BA',
    ufIni: 'BA',
    cUf: '29',
    cfop: '5352',
    chavesNfe: [chvNfSp],
  });

  const res = await processFiscalLocally(
    {
      solicitacaoId: 'teste-cte-interno',
      periodoInicio: '2026-01-01',
      periodoFim: '2026-01-31',
      context: ctx,
      input: {
        xmlFiles: [
          new File([nfXml], '610.xml', { type: 'text/xml' }),
          new File([cteInternoFaltante], 'cte4401.xml', { type: 'text/xml' }),
          new File([cteInternoComNf], 'cte4402.xml', { type: 'text/xml' }),
        ],
      },
    },
    new Map(),
    loadTemplate,
  );

  assert.equal(res.preAnalysis.requer_decisao, false);
  assert.equal(res.preAnalysis.ctes_sem_nfe?.length ?? 0, 0);
  assert.equal(res.notasProcessadas.length, 1);
  assert.equal(res.notasProcessadas[0].numero_nota, '610');

  const ignoredByNumber = new Map(res.notasIgnoradas.map((item) => [item.numero_nota, item.motivo]));
  assert.match(ignoredByNumber.get('4401') ?? '', /Operação interna estadual desconsiderada/);
  assert.match(ignoredByNumber.get('4402') ?? '', /Operação interna estadual desconsiderada/);
});

test('CT-e integralmente vinculado a item com ST paga não gera antecipação tributária duplicada', async () => {
  const ctx = buildCteContext();
  ctx.empresa.razao_social = 'Armazém Comércio LTDA';
  const chvNfSt = chaveNfe('2601', 701);
  const nfStXml = `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe"><NFe><infNFe Id="NFe${chvNfSt}">
  <ide><nNF>701</nNF><serie>1</serie><dhEmi>2026-01-10T10:00:00-03:00</dhEmi></ide>
  <emit><CNPJ>${FORNECEDOR_CNPJ}</CNPJ><CRT>3</CRT><enderEmit><UF>SP</UF></enderEmit></emit>
  <dest><CNPJ>${EMPRESA_CNPJ}</CNPJ><enderDest><UF>BA</UF></enderDest></dest>
  <total><ICMSTot><vNF>1000.00</vNF><vBC>1000.00</vBC><vST>50.00</vST></ICMSTot></total>
  <det nItem="1"><prod><NCM>73170090</NCM><CEST>1005700</CEST><CFOP>6403</CFOP><xProd>PREGO</xProd><vProd>1000.00</vProd></prod>
    <imposto><ICMS><ICMS10><orig>0</orig><CST>10</CST><vBC>1000.00</vBC><pICMS>12.00</pICMS><vICMS>120.00</vICMS><vICMSST>50.00</vICMSST></ICMS10></ICMS></imposto>
  </det>
</infNFe></NFe></nfeProc>`;

  const cteXml = buildCteXml({
    numero: '3001',
    chave: chaveCte('2601', 3001),
    vTPrest: '200.00',
    toma: '3',
    chavesNfe: [chvNfSt],
  });

  const res = await processFiscalLocally(
    {
      solicitacaoId: 'teste-cte-nf-st-excluida',
      periodoInicio: '2026-01-01',
      periodoFim: '2026-01-31',
      context: ctx,
      input: {
        xmlFiles: [
          new File([nfStXml], '701.xml', { type: 'text/xml' }),
          new File([cteXml], 'cte3001.xml', { type: 'text/xml' }),
        ],
      },
    },
    new Map(),
    loadTemplate,
  );

  assert.equal(res.itensExcluidos.length, 1);
  assert.equal(res.itensExcluidos[0].numero_nota, '701');
  assert.match(res.itensExcluidos[0].motivo, /ICMS ST já destacado no XML/);

  // Se a única mercadoria vinculada já teve ST retida, o frete deste
  // CT-e não deve gerar nova antecipação tributária.
  assert.equal(res.rowsByDestination.antecipacao_tributaria?.length ?? 0, 0);
  assert.equal(res.notasProcessadas.length, 0);
});

test('CT-e FOB com BC-ST comprovadamente sem frete complementa apenas transporte', async () => {
  const ctx = buildCteContext();
  ctx.empresa.razao_social = 'Armazém Comércio LTDA';
  const chvNfSt = chaveNfe('2601', 701);
  const nfStXml = `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe"><NFe><infNFe Id="NFe${chvNfSt}">
  <ide><nNF>701</nNF><serie>1</serie><dhEmi>2026-01-10T10:00:00-03:00</dhEmi></ide>
  <emit><CNPJ>${FORNECEDOR_CNPJ}</CNPJ><CRT>3</CRT><enderEmit><UF>SP</UF></enderEmit></emit>
  <dest><CNPJ>${EMPRESA_CNPJ}</CNPJ><enderDest><UF>BA</UF></enderDest></dest>
  <transp><modFrete>1</modFrete></transp>
  <total><ICMSTot><vNF>1177.25</vNF><vBC>1000.00</vBC><vFrete>0.00</vFrete><vST>177.25</vST></ICMSTot></total>
  <det nItem="1"><prod><NCM>73170090</NCM><CEST>1005700</CEST><CFOP>6403</CFOP><xProd>PREGO</xProd><vProd>1000.00</vProd></prod>
    <imposto><ICMS><ICMS10><orig>0</orig><CST>10</CST><vBC>1000.00</vBC><pICMS>12.00</pICMS><vICMS>120.00</vICMS><modBCST>4</modBCST><pMVAST>45.00</pMVAST><vBCST>1450.00</vBCST><pICMSST>20.50</pICMSST><vICMSST>177.25</vICMSST></ICMS10></ICMS></imposto>
  </det>
</infNFe></NFe></nfeProc>`;

  const cteXml = buildCteXml({
    numero: '3001',
    chave: chaveCte('2601', 3001),
    vTPrest: '200.00',
    toma: '3',
    chavesNfe: [chvNfSt],
  });

  const res = await processFiscalLocally(
    {
      solicitacaoId: 'teste-cte-nf-st-excluida',
      periodoInicio: '2026-01-01',
      periodoFim: '2026-01-31',
      context: ctx,
      input: {
        xmlFiles: [
          new File([nfStXml], '701.xml', { type: 'text/xml' }),
          new File([cteXml], 'cte3001.xml', { type: 'text/xml' }),
        ],
      },
    },
    new Map(),
    loadTemplate,
  );

  assert.equal(res.itensExcluidos.length, 1);
  assert.equal(res.itensExcluidos[0].numero_nota, '701');
  assert.match(res.itensExcluidos[0].motivo, /ICMS ST já destacado no XML/);

  const rows = res.rowsByDestination.antecipacao_tributaria ?? [];
  assert.equal(rows.length, 1);
  assert.equal(rows[0].numero_nota, '3001');
  assert.equal(rows[0].v_total, 200);
  assert.equal(rows[0].mva, 45);
  assert.equal(res.notasProcessadas.length, 1);
});

test('rejeita NF-e de outro CNPJ destinatário antes de pausar para CT-e, bonificação ou Convênio 52/91', async () => {
  const ctx = buildCteContext();
  const chvFaltante = chaveNfe('2601', 999);
  const cteXml = buildCteXml({
    numero: '15420',
    chave: chaveCte('2601', 15420),
    vTPrest: '300.00',
    toma: '3',
    chavesNfe: [chvFaltante],
  });

  const chvBonus = chaveNfe('2601', 901);
  const nfBonusXml = `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe"><NFe><infNFe Id="NFe${chvBonus}">
  <ide><nNF>901</nNF><serie>1</serie><dhEmi>2026-01-10T10:00:00-03:00</dhEmi></ide>
  <emit><CNPJ>${FORNECEDOR_CNPJ}</CNPJ><CRT>3</CRT><enderEmit><UF>SP</UF></enderEmit></emit>
  <dest><CNPJ>${EMPRESA_CNPJ}</CNPJ><enderDest><UF>BA</UF></enderDest></dest>
  <total><ICMSTot><vNF>500.00</vNF><vBC>500.00</vBC></ICMSTot></total>
  <det nItem="1"><prod><NCM>21069090</NCM><CFOP>6910</CFOP><xProd>BONIFICACAO</xProd><vProd>500.00</vProd></prod>
    <imposto><ICMS><ICMS00><orig>0</orig><CST>00</CST><vBC>500.00</vBC><pICMS>12.00</pICMS></ICMS00></ICMS></imposto>
  </det>
</infNFe></NFe></nfeProc>`;

  const chvOutroCnpj = chaveNfe('2601', 461118);
  const nfOutroCnpjXml = `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe"><NFe><infNFe Id="NFe${chvOutroCnpj}">
  <ide><nNF>461118</nNF><serie>1</serie><dhEmi>2026-01-12T10:00:00-03:00</dhEmi></ide>
  <emit><CNPJ>${FORNECEDOR_CNPJ}</CNPJ><CRT>3</CRT><enderEmit><UF>SP</UF></enderEmit></emit>
  <dest><CNPJ>14679062000186</CNPJ><enderDest><UF>BA</UF></enderDest></dest>
  <total><ICMSTot><vNF>1000.00</vNF><vBC>1000.00</vBC></ICMSTot></total>
  <det nItem="1"><prod><NCM>21069090</NCM><CFOP>6102</CFOP><xProd>PRODUTO</xProd><vProd>1000.00</vProd></prod>
    <imposto><ICMS><ICMS00><orig>0</orig><CST>00</CST><vBC>1000.00</vBC><pICMS>12.00</pICMS></ICMS00></ICMS></imposto>
  </det>
</infNFe></NFe></nfeProc>`;

  await assert.rejects(
    () => processFiscalLocally(
      {
        solicitacaoId: 'teste-cnpj-precoce-com-cte',
        periodoInicio: '2026-01-01',
        periodoFim: '2026-01-31',
        context: ctx,
        input: {
          xmlFiles: [
            new File([cteXml], 'cte15420.xml', { type: 'text/xml' }),
            new File([nfBonusXml], '901.xml', { type: 'text/xml' }),
            new File([nfOutroCnpjXml], '461118.xml', { type: 'text/xml' }),
          ],
        },
      },
      new Map(),
      loadTemplate,
    ),
    /NF-e 461118 possui CNPJ destinatário 14679062000186, diferente da empresa selecionada\./,
  );

  // Sem CT-e, também deve falhar antes da confirmação de bonificação.
  await assert.rejects(
    () => processFiscalLocally(
      {
        solicitacaoId: 'teste-cnpj-precoce-sem-cte',
        periodoInicio: '2026-01-01',
        periodoFim: '2026-01-31',
        context: ctx,
        input: {
          xmlFiles: [
            new File([nfBonusXml], '901.xml', { type: 'text/xml' }),
            new File([nfOutroCnpjXml], '461118.xml', { type: 'text/xml' }),
          ],
        },
      },
      new Map(),
      loadTemplate,
    ),
    /NF-e 461118 possui CNPJ destinatário 14679062000186, diferente da empresa selecionada\./,
  );
});

test('emissão própria para outro CNPJ continua sendo ignorada sem erro na validação precoce', async () => {
  const ctx = buildCteContext();
  const chvSaida = `292601${EMPRESA_CNPJ}550010000001111000001110`;
  const nfSaidaXml = `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe"><NFe><infNFe Id="NFe${chvSaida}">
  <ide><nNF>111</nNF><serie>1</serie><dhEmi>2026-01-10T10:00:00-03:00</dhEmi></ide>
  <emit><CNPJ>${EMPRESA_CNPJ}</CNPJ><CRT>3</CRT><enderEmit><UF>BA</UF></enderEmit></emit>
  <dest><CNPJ>14679062000186</CNPJ><enderDest><UF>BA</UF></enderDest></dest>
  <total><ICMSTot><vNF>500.00</vNF><vBC>500.00</vBC></ICMSTot></total>
  <det nItem="1"><prod><NCM>21069090</NCM><CFOP>5102</CFOP><xProd>VENDA</xProd><vProd>500.00</vProd></prod>
    <imposto><ICMS><ICMS00><orig>0</orig><CST>00</CST><vBC>500.00</vBC><pICMS>12.00</pICMS></ICMS00></ICMS></imposto>
  </det>
</infNFe></NFe></nfeProc>`;
  const chvEntrada = chaveNfe('2601', 112);
  const nfEntradaXml = `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe"><NFe><infNFe Id="NFe${chvEntrada}">
  <ide><nNF>112</nNF><serie>1</serie><dhEmi>2026-01-10T10:00:00-03:00</dhEmi></ide>
  <emit><CNPJ>${FORNECEDOR_CNPJ}</CNPJ><CRT>3</CRT><enderEmit><UF>SP</UF></enderEmit></emit>
  <dest><CNPJ>${EMPRESA_CNPJ}</CNPJ><enderDest><UF>BA</UF></enderDest></dest>
  <total><ICMSTot><vNF>1000.00</vNF><vBC>1000.00</vBC></ICMSTot></total>
  <det nItem="1"><prod><NCM>21069090</NCM><CFOP>6102</CFOP><xProd>REVENDA</xProd><vProd>1000.00</vProd></prod>
    <imposto><ICMS><ICMS00><orig>0</orig><CST>00</CST><vBC>1000.00</vBC><pICMS>12.00</pICMS></ICMS00></ICMS></imposto>
  </det>
</infNFe></NFe></nfeProc>`;

  const res = await processFiscalLocally(
    {
      solicitacaoId: 'teste-emissao-propria-precoce',
      periodoInicio: '2026-01-01',
      periodoFim: '2026-01-31',
      context: ctx,
      input: {
        xmlFiles: [
          new File([nfSaidaXml], '111.xml', { type: 'text/xml' }),
          new File([nfEntradaXml], '112.xml', { type: 'text/xml' }),
        ],
      },
    },
    new Map(),
    loadTemplate,
  );

  assert.equal(res.notasProcessadas.length, 1);
  assert.equal(res.notasIgnoradas.length, 1);
  assert.match(res.notasIgnoradas[0].motivo, /emissão própria/);
});



