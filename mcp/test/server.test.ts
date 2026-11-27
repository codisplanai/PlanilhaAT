import assert from 'node:assert/strict';
import test from 'node:test';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { installNodeDom } from '../src/dom.ts';
import { createPlanautServer } from '../src/server.ts';
import { percentToDecimalString } from '../src/tools/common.ts';
import { type FakeCall, fakePlanaut, json, tempDir, testConfig } from './helpers.ts';

installNodeDom();

const EXPECTED_TOOLS = [
  'adicionar_excecao_regra', 'aplicar_preset_fcp_bebidas_ba', 'cancelar_geracao', 'carregar_exclusoes_padrao_ba',
  'configurar_perfil', 'copiar_regras_entre_perfis', 'definir_termo_acordo', 'duplicar_perfil', 'excluir_empresa',
  'excluir_perfil', 'excluir_regra', 'gerar_planilhas', 'listar_arquivos_fiscais', 'listar_empresas', 'listar_perfis',
  'listar_regras', 'listar_solicitacoes', 'listar_templates', 'obter_empresa', 'obter_perfil', 'obter_solicitacao',
  'planaut_status', 'preencher_datas_entrada', 'remover_excecao_regra', 'remover_termo_acordo', 'responder_pendencias',
  'salvar_empresa', 'salvar_perfil', 'salvar_regra_aliquota', 'salvar_regra_cfop', 'salvar_regra_exclusao',
  'salvar_regra_fcp', 'salvar_regra_reclassificacao', 'salvar_regra_reducao',
];

async function connect(routes: Parameters<typeof fakePlanaut>[0] = {}) {
  const fake = fakePlanaut(routes);
  const { server } = createPlanautServer(testConfig([tempDir()]), fake.fetch);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'teste', version: '1.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const result = await client.callTool({ name, arguments: args }) as { isError?: boolean; content: Array<{ text: string }> };
    const text = result.content[0]?.text ?? '';
    return { isError: Boolean(result.isError), text, data: result.isError ? null : JSON.parse(text) };
  };
  return { client, call, calls: fake.calls };
}

test('expõe as ferramentas esperadas com anotações coerentes e instruções do servidor', async () => {
  const { client } = await connect();
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((tool) => tool.name).sort(), EXPECTED_TOOLS);
  for (const tool of tools) {
    if (/^(listar|obter)_|^planaut_status$/.test(tool.name)) assert.equal(tool.annotations?.readOnlyHint, true, tool.name);
    if (/^(excluir|remover)_/.test(tool.name)) assert.equal(tool.annotations?.destructiveHint, true, tool.name);
    assert.ok((tool.description ?? '').length > 40, `${tool.name} sem descrição útil`);
  }
  assert.match(client.getInstructions() ?? '', /nunca adivinha/);
});

test('percentual explícito: 20.5 vira 0.205 e 1 vira 0.01 (a API leria 1 como 100%)', () => {
  assert.equal(percentToDecimalString(20.5), '0.205');
  assert.equal(percentToDecimalString(1), '0.01');
  assert.equal(percentToDecimalString(12.06), '0.1206');
  assert.equal(percentToDecimalString(0), '0');
});

test('salvar_regra_aliquota envia fração e devolve aliquota_percentual', async () => {
  let posted: FakeCall | null = null;
  const { call } = await connect({
    'POST /regras-aliquotas': (request) => {
      posted = request;
      return json({ id: 9, perfil_regras_id: 3, uf: 'BA', ncm: null, aliquota: 0.205, descricao: null, criado_em: 'x', atualizado_em: 'y' }, 201);
    },
  });
  const result = await call('salvar_regra_aliquota', { perfil_id: 3, uf: 'ba', aliquota_percentual: 20.5 });
  assert.equal(result.isError, false, result.text);
  assert.deepEqual(posted!.body, { perfil_regras_id: 3, uf: 'BA', aliquota: '0.205' });
  assert.deepEqual(result.data.regra, { id: 9, uf: 'BA', ncm: null, descricao: null, aliquota_percentual: 20.5, perfil_id: 3 });

  const missing = await call('salvar_regra_aliquota', { perfil_id: 3 });
  assert.equal(missing.isError, true);
  assert.match(missing.text, /uf, aliquota_percentual/);
});

test('regra de CFOP global só com pedido explícito', async () => {
  const bodies: unknown[] = [];
  const { call } = await connect({
    'POST /regras-cfop': (request) => {
      bodies.push(request.body);
      return json({ id: 1, perfil_regras_id: null, cfop_sufixo: '910', destino: 'difal' }, 201);
    },
  });
  const semEscopo = await call('salvar_regra_cfop', { cfop: '6910', destino: 'difal' });
  assert.equal(semEscopo.isError, true);
  assert.match(semEscopo.text, /global=true/);
  const global = await call('salvar_regra_cfop', { cfop: '6910', destino: 'difal', global: true });
  assert.equal(global.isError, false, global.text);
  assert.deepEqual(bodies, [{ perfil_regras_id: null, cfop_sufixo: '6910', destino: 'difal' }]);
});

test('configurar_perfil altera uma chave e preserva as demais', async () => {
  let saved: Record<string, unknown> | null = null;
  const { call } = await connect({
    'GET /perfis-regras/:id': () => ({ id: 5, nome: 'P', configuracoes_extras: { mva_revenda_antecipacao_tributaria: { enabled: true }, limitar_a_ori_reducoes: false } }),
    'PUT /perfis-regras/:id': (request) => {
      saved = request.body as Record<string, unknown>;
      return { id: 5, nome: 'P', configuracoes_extras: (request.body as Record<string, unknown>).configuracoes_extras };
    },
  });
  const result = await call('configurar_perfil', { perfil_id: 5, chave: 'politica_aliquotas_iguais_parcial', valor: { SP: true } });
  assert.equal(result.isError, false, result.text);
  assert.deepEqual(saved, {
    configuracoes_extras: {
      mva_revenda_antecipacao_tributaria: { enabled: true },
      limitar_a_ori_reducoes: false,
      politica_aliquotas_iguais_parcial: { SP: true },
    },
  });
  const removed = await call('configurar_perfil', { perfil_id: 5, chave: 'limitar_a_ori_reducoes', valor: null });
  assert.equal(removed.data.acao, 'chave_removida');
});

test('listar_empresas busca por CNPJ sem máscara e por nome sem acento; oculta inativas', async () => {
  const { call } = await connect({
    'GET /empresas': () => [
      { id: 1, razao_social: 'Comércio São João LTDA', cnpj: '12345678000195', uf: 'BA', perfil_regras_id: 1, ativo: true },
      { id: 2, razao_social: 'Outra', cnpj: '11222333000181', uf: 'BA', perfil_regras_id: 1, ativo: true },
      { id: 3, razao_social: 'Sao Joao Antiga', cnpj: '11444777000161', uf: 'BA', perfil_regras_id: 1, ativo: false },
    ],
  });
  assert.deepEqual((await call('listar_empresas', { busca: '12.345.678/0001-95' })).data.empresas.map((e: any) => e.id), [1]);
  assert.deepEqual((await call('listar_empresas', { busca: 'sao joao' })).data.empresas.map((e: any) => e.id), [1]);
  assert.deepEqual((await call('listar_empresas', { busca: 'sao joao', incluir_inativas: true })).data.empresas.map((e: any) => e.id), [1, 3]);
});

test('erros da API chegam à IA como resultado de erro legível', async () => {
  const { call } = await connect({
    'DELETE /empresas/:id': () => json({ detail: 'A empresa possui solicitações e não pode ser excluída.' }, 409),
  });
  const result = await call('excluir_empresa', { empresa_id: 7 });
  assert.equal(result.isError, true);
  assert.equal(result.text, 'Planaut (HTTP 409): A empresa possui solicitações e não pode ser excluída.');
});
