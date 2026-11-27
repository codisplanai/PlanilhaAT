#!/usr/bin/env node
/**
 * Teste ponta a ponta do servidor MCP contra uma API do Planaut rodando localmente.
 *
 * Pré-requisito: backend com autenticação local, por exemplo
 *   ENABLE_LOCAL_AUTH=true AUTO_CREATE_SCHEMA=true SEED_DEFAULTS=true \
 *   DATABASE_URL=sqlite:///./e2e.db uvicorn app.main:app --port 8765
 *
 * Uso: PLANAUT_URL=http://127.0.0.1:8765 node scripts/e2e-local.mjs
 *
 * Cria um perfil, uma alíquota, uma empresa e XMLs sintéticos; gera a Parcial
 * respondendo a uma pendência de bonificação, confere o histórico, preenche
 * datas de entrada pelo SPED e gera uma Antecipação Tributária com MVA
 * pendente. Grava dados na API: por isso só roda contra localhost.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const mcpRoot = path.resolve(here, '..');
const baseUrl = process.env.PLANAUT_URL ?? 'http://127.0.0.1:8765';
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/.test(baseUrl)) {
  console.error(`Recusado: o e2e cria perfis e empresas e só roda contra uma API local (recebido ${baseUrl}).`);
  process.exit(2);
}
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'planaut-mcp-e2e-'));
const fiscalDir = path.join(workDir, 'cliente-ba', '2026-01');
fs.mkdirSync(fiscalDir, { recursive: true });

const EMPRESA_CNPJ = '12345678000195';
const FORNECEDOR_CNPJ = '98765432000180';
const suffix = Date.now().toString(36);

function chave(numero) {
  return `352601${FORNECEDOR_CNPJ}55001${String(numero).padStart(9, '0')}1${String(numero).padStart(8, '0')}0`;
}

function spedJaneiro(notas) {
  const linhas = [
    `|0000|019|0|01012026|31012026|Cliente BA E2E|${EMPRESA_CNPJ}||BA|123456|2927408|||A|1|`,
    `|0150|F1|FORNECEDOR SP|1058|${FORNECEDOR_CNPJ}||SP|3550308||R|1||C|`,
    '|0200|P1|PRODUTO TESTE|||UN|01|21069090|||18,00||',
  ];
  for (const nota of notas) {
    const total = nota.valor.replace('.', ',');
    linhas.push(`|C100|0|1|F1|55|00|1|${nota.numero}|${chave(nota.numero)}|${nota.dtDoc}|${nota.dtEntrada}|${total}|0|0,00|0,00|${total}|0|0,00|0,00|0,00|${total}|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|`);
    linhas.push(`|C170|1|P1|PRODUTO TESTE|1,000|UN|${total}|0,00|0|000|${nota.cfopEntrada}||${total}|12,00|0,00|0,00|0,00|0,00|0|50|999|0,00|0,00|0,00|`);
  }
  linhas.push(`|9999|${linhas.length + 1}|`);
  return linhas.join('\n');
}

function xmlNfe({ numero, valor, cfop, data, vIcms, ncm = '21069090' }) {
  const key = chave(numero);
  return `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><NFe>
  <infNFe Id="NFe${key}" versao="4.00">
    <ide><nNF>${numero}</nNF><serie>1</serie><dhEmi>${data}T10:00:00-03:00</dhEmi></ide>
    <emit><CNPJ>${FORNECEDOR_CNPJ}</CNPJ><xNome>FORNECEDOR SP &amp; CIA</xNome><CRT>3</CRT><enderEmit><UF>SP</UF></enderEmit></emit>
    <dest><CNPJ>${EMPRESA_CNPJ}</CNPJ><enderDest><UF>BA</UF></enderDest></dest>
    <total><ICMSTot><vBC>${valor}</vBC><vICMS>${vIcms}</vICMS><vProd>${valor}</vProd><vNF>${valor}</vNF></ICMSTot></total>
    <det nItem="1"><prod><cProd>P1</cProd><xProd>PRODUTO TESTE</xProd><NCM>${ncm}</NCM><CFOP>${cfop}</CFOP><vProd>${valor}</vProd></prod>
    <imposto><ICMS><ICMS00><orig>0</orig><CST>00</CST><vBC>${valor}</vBC><pICMS>12.00</pICMS><vICMS>${vIcms}</vICMS></ICMS00></ICMS></imposto></det>
  </infNFe></NFe></nfeProc>`;
}

fs.writeFileSync(path.join(fiscalDir, 'nfe-1001.xml'), xmlNfe({ numero: 1001, valor: '1000.00', cfop: '6102', data: '2026-01-10', vIcms: '120.00' }));
fs.writeFileSync(path.join(fiscalDir, 'nfe-1002.xml'), xmlNfe({ numero: 1002, valor: '500.00', cfop: '6910', data: '2026-01-15', vIcms: '60.00' }));

// PLANAUT_MCP_ENTRY aponta para o servidor empacotado (build/mcpb/server/index.js) e
// PLANAUT_MCP_NODE para outro executável do Node, para testar o que a extensão roda.
const entry = process.env.PLANAUT_MCP_ENTRY ? path.resolve(process.env.PLANAUT_MCP_ENTRY) : null;
const transport = new StdioClientTransport({
  command: process.env.PLANAUT_MCP_NODE ?? process.execPath,
  args: entry
    ? [entry, workDir]
    : ['--experimental-strip-types', '--no-warnings', path.join(mcpRoot, 'src', 'index.ts'), workDir],
  env: {
    ...process.env,
    PLANAUT_URL: baseUrl,
    PLANAUT_EMAIL: process.env.PLANAUT_EMAIL ?? 'admin@contabilidade.com',
    PLANAUT_SENHA: process.env.PLANAUT_SENHA ?? 'admin',
  },
  stderr: 'inherit',
});
const client = new Client({ name: 'planaut-e2e', version: '1.0.0' });
await client.connect(transport);

async function call(name, args = {}) {
  const result = await client.callTool({ name, arguments: args });
  const text = result.content?.[0]?.text ?? '';
  if (result.isError) throw new Error(`${name} falhou: ${text}`);
  return JSON.parse(text);
}

try {
  const { tools } = await client.listTools();
  console.log(`ferramentas: ${tools.length}`);

  const status = await call('planaut_status');
  assert.equal(status.usuario.papel, 'administrador');

  const perfil = await call('salvar_perfil', { nome: `Perfil E2E ${suffix}`, descricao: 'Criado pelo teste do MCP' });
  const perfilId = perfil.perfil.id;
  const aliquota = await call('salvar_regra_aliquota', { perfil_id: perfilId, uf: 'BA', aliquota_percentual: 20.5, descricao: 'Padrão BA' });
  assert.equal(aliquota.regra.aliquota_percentual, 20.5);

  const regras = await call('listar_regras', { perfil_id: perfilId, secoes: ['aliquotas', 'cfop'] });
  assert.ok(regras.cfop.regras.some((regra) => regra.cfop_sufixo === '102' && regra.destino === 'antecipacao_parcial'));

  const existentes = await call('listar_empresas', { busca: EMPRESA_CNPJ, incluir_inativas: true });
  let empresaId = existentes.empresas[0]?.id;
  if (empresaId) {
    await call('salvar_empresa', { empresa_id: empresaId, perfil_id: perfilId, ativo: true, optante_simples_nacional: false, atividade: 'comercio' });
  } else {
    const empresa = await call('salvar_empresa', {
      razao_social: 'Cliente BA E2E', cnpj: '12.345.678/0001-95', uf: 'BA', perfil_id: perfilId, inscricao_estadual: '123456',
    });
    empresaId = empresa.empresa.id;
  }

  const arquivos = await call('listar_arquivos_fiscais', { pasta: fiscalDir });
  assert.equal(arquivos.resumo.nfe, 2);
  assert.deepEqual(arquivos.cnpjs_destinatarios_nfe[0], { cnpj: EMPRESA_CNPJ, notas: 2 });

  const inicio = await call('gerar_planilhas', { empresa_id: empresaId, competencia: '2026-01', xmls: [fiscalDir] });
  assert.equal(inicio.status, 'aguardando_decisao');
  assert.equal(inicio.etapa, 'bonificacao');
  const pendencia = inicio.pendencias[0];
  console.log(`pendência: ${pendencia.id} nota ${pendencia.nota} sugestão ${pendencia.sugestao_do_sistema}`);

  const fim = await call('responder_pendencias', { geracao_id: inicio.geracao_id, bonificacao: { [pendencia.id]: 'revenda' } });
  assert.equal(fim.status, 'concluida', JSON.stringify(fim));
  assert.ok(fim.planilhas.length >= 1);
  for (const planilha of fim.planilhas) {
    assert.ok(fs.existsSync(planilha.arquivo), planilha.arquivo);
    console.log(`planilha: ${planilha.planilha} -> ${planilha.arquivo} (${planilha.linhas} linhas, R$ ${planilha.valor_devido})`);
  }

  const historico = await call('obter_solicitacao', { solicitacao_id: fim.solicitacao_id, incluir_registros: true });
  assert.equal(historico.status, 'Concluída');
  console.log(`histórico: ${historico.total_registros} registros, planilhas ${historico.planilhas.map((p) => p.tipo).join(', ')}`);

  // Datas de entrada a partir do SPED, numa cópia da planilha já gerada.
  const spedPath = path.join(workDir, 'cliente-ba', 'sped-2026-01.txt');
  fs.writeFileSync(spedPath, spedJaneiro([
    { numero: 1001, valor: '1000.00', dtDoc: '10012026', dtEntrada: '12012026', cfopEntrada: '2102' },
    { numero: 1002, valor: '500.00', dtDoc: '15012026', dtEntrada: '16012026', cfopEntrada: '2910' },
  ]), 'latin1');
  const datas = await call('preencher_datas_entrada', { planilhas: [fim.planilhas[0].arquivo], speds: [spedPath] });
  assert.equal(datas.arquivos[0].preenchidas_agora, 2, JSON.stringify(datas));
  console.log(`datas de entrada: ${datas.arquivos[0].preenchidas_agora} preenchidas -> ${datas.arquivos[0].gerado}`);

  const pastaSped = await call('listar_arquivos_fiscais', { pasta: path.join(workDir, 'cliente-ba') });
  assert.equal(pastaSped.speds[0].cnpj, EMPRESA_CNPJ);
  assert.equal(pastaSped.speds[0].periodo, '2026-01-01 a 2026-01-31');

  // Antecipação Tributária com NCM fora do Anexo 1: a MVA fica pendente até o usuário decidir.
  const stDir = path.join(workDir, 'cliente-ba', 'st-2026-01');
  fs.mkdirSync(stDir);
  fs.writeFileSync(path.join(stDir, 'nfe-2001.xml'), xmlNfe({ numero: 2001, valor: '800.00', cfop: '6403', data: '2026-01-20', vIcms: '96.00', ncm: '84713012' }));
  const st = await call('gerar_planilhas', { empresa_id: empresaId, competencia: '2026-01', xmls: [stDir] });
  assert.equal(st.status, 'aguardando_decisao', JSON.stringify(st));
  assert.equal(st.etapa, 'mva');
  const mvaId = st.pendencias[0].id;
  console.log(`MVA pendente: ${mvaId} NCM ${st.pendencias[0].ncm} — ${st.pendencias[0].motivo}`);
  const semJustificativa = await client.callTool({ name: 'responder_pendencias', arguments: { geracao_id: st.geracao_id, mva: { [mvaId]: { mva_percentual: 50, justificativa: 'x' } } } });
  assert.equal(semJustificativa.isError, true);
  const stFim = await call('responder_pendencias', {
    geracao_id: st.geracao_id,
    mva: { [mvaId]: { mva_percentual: 50, justificativa: 'MVA informada pelo contador para o teste ponta a ponta' } },
  });
  assert.equal(stFim.status, 'concluida', JSON.stringify(stFim));
  assert.equal(stFim.planilhas[0].tipo, 'antecipacao_tributaria');
  console.log(`tributária: ${stFim.planilhas[0].arquivo} (R$ ${stFim.planilhas[0].valor_devido})`);

  const fora = await client.callTool({ name: 'listar_arquivos_fiscais', arguments: { pasta: os.homedir() } });
  assert.equal(fora.isError, true);
  assert.match(fora.content[0].text, /fora das pastas liberadas/);

  console.log(`OK — arquivos de teste em ${workDir}`);
  console.log(JSON.stringify({ empresaId, perfilId, saida: fim.planilhas.map((p) => p.arquivo) }));
} finally {
  await client.close();
}
