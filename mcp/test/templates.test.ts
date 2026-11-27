import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { installNodeDom } from '../src/dom.ts';
import { createPlanautServer } from '../src/server.ts';
import { aplicarAjustes, compararMapeamentos, escolherReferencia } from '../src/tools/templates.ts';
import { type FakeCall, TEMPLATES_DIR, fakePlanaut, json, tempDir, testConfig } from './helpers.ts';

installNodeDom();

const PARCIAL_ATIVO = {
  id: 1,
  tipo: 'antecipacao_parcial',
  versao: 3,
  ativo: true,
  empresa_id: null,
  capacidade_linhas: 100,
  mapeamento_campos: {
    start_row: 4,
    columns: { item_index: 'A', numero_nota: 'D', data_entrada: 'B', data_emissao: 'C', v_total: 'E', base_calculo: 'F', ipi_despesas: 'G', a_dst: 'H', a_ori: 'I' },
    sheet_name: 'JANEIRO',
    header_cell: 'A2',
    aliquota_format: null,
    extra_options: { header_cell: 'A2', aliquota_format: 'percent_number', margem_seguranca_linhas: 5 },
  },
};

async function setup() {
  const root = tempDir();
  for (const name of ['modelo_padrao_antecipacao_parcial.xlsx', 'modelo_padrao_antecipacao_tributaria.xlsx']) {
    fs.copyFileSync(path.join(TEMPLATES_DIR, name), path.join(root, name));
  }
  const uploads: FakeCall[] = [];
  const fake = fakePlanaut({
    'GET /templates': (call) => (call.query.tipo === 'antecipacao_parcial' ? [PARCIAL_ATIVO] : []),
    'GET /templates/:id': () => PARCIAL_ATIVO,
    'POST /templates/upload': (call) => {
      uploads.push(call);
      const body = call.body as Record<string, string>;
      return json({
        id: 9,
        tipo: body.tipo,
        versao: 4,
        ativo: body.promover_ativo === 'true',
        empresa_id: body.empresa_id ? Number(body.empresa_id) : null,
        capacidade_linhas: Number(body.capacidade_linhas),
        mapeamento_campos: JSON.parse(body.mapeamento_json),
      }, 201);
    },
  });
  const { server } = createPlanautServer(testConfig([root]), fake.fetch);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'teste', version: '1.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const result = await client.callTool({ name, arguments: args }) as { isError?: boolean; content: Array<{ text: string }> };
    const text = result.content[0]?.text ?? '';
    return { isError: Boolean(result.isError), text, data: result.isError ? null : JSON.parse(text) };
  };
  return { root, call, uploads };
}

test('simulação da Tributária com o layout padrão do site não envia nada', async () => {
  const { root, call, uploads } = await setup();
  const result = await call('enviar_template', {
    arquivo: path.join(root, 'modelo_padrao_antecipacao_tributaria.xlsx'),
    tipo: 'antecipacao_tributaria',
    capacidade_linhas: 100,
    colocar_em_uso: true,
    mapeamento_base: 'padrao_do_site',
    simular: true,
  });
  assert.equal(result.isError, false, result.text);
  assert.equal(result.data.acao, 'simulacao');
  assert.deepEqual(result.data.mapeamento.columns, {
    numero_nota: 'D', data_emissao: 'C', v_total: 'E', a_dst: 'J', a_ori: 'K', data_entrada: 'B',
    base_calculo: 'F', ipi_despesas: 'G', mva: 'H', reducao: 'I', valor_pago: 'S',
  });
  assert.equal(result.data.mapeamento.start_row, 4);
  assert.match(result.data.efeito, /entra em uso/);
  assert.equal(result.data.comparado_com, null);
  assert.ok(result.data.abas.length > 0 && result.data.abas.every((aba: unknown) => typeof aba === 'string' && aba));
  assert.equal(uploads.length, 0);
});

test('por padrão copia o mapeamento do modelo em uso e mostra o que o padrão do site perderia', async () => {
  const { root, call, uploads } = await setup();
  const base = {
    arquivo: path.join(root, 'modelo_padrao_antecipacao_parcial.xlsx'),
    tipo: 'antecipacao_parcial',
    capacidade_linhas: 100,
    colocar_em_uso: true,
    simular: true,
  };
  const padrao = await call('enviar_template', base);
  assert.equal(padrao.isError, false, padrao.text);
  assert.deepEqual(padrao.data.mapeamento.columns, PARCIAL_ATIVO.mapeamento_campos.columns);
  assert.equal(padrao.data.mapeamento.sheet_name, 'JANEIRO');
  assert.match(padrao.data.origem_mapeamento, /modelo 1 .*em uso/);
  assert.deepEqual(padrao.data.diferencas, []);
  assert.match(padrao.data.efeito, /no lugar da v3/);

  const site = await call('enviar_template', { ...base, mapeamento_base: 'padrao_do_site' });
  assert.deepEqual(site.data.diferencas, ['item_index: sai (era A)', 'aba: JANEIRO -> automática']);

  const semModelo = await call('enviar_template', {
    ...base,
    arquivo: path.join(root, 'modelo_padrao_antecipacao_tributaria.xlsx'),
    tipo: 'antecipacao_tributaria',
  });
  assert.equal(semModelo.isError, true);
  assert.match(semModelo.text, /Não há modelo em uso de Antecipação Tributária.*padrao_do_site/);
  assert.equal(uploads.length, 0);
});

test('envio copia o mapeamento de um modelo, aplica ajustes e manda multipart para a API', async () => {
  const { root, call, uploads } = await setup();
  const result = await call('enviar_template', {
    arquivo: path.join(root, 'modelo_padrao_antecipacao_parcial.xlsx'),
    tipo: 'antecipacao_parcial',
    capacidade_linhas: 100,
    colocar_em_uso: false,
    mapeamento_base: 'copiar_de_template',
    copiar_de_template_id: 1,
    observacoes: 'Layout 2027',
    ajustes: { linha_inicial: 5, colunas: { data_entrada: null }, aba: 'auto' },
  });
  assert.equal(result.isError, false, result.text);
  assert.equal(result.data.acao, 'enviado');
  assert.equal(result.data.template.em_uso, false);
  assert.match(result.data.efeito, /promover_template/);
  assert.deepEqual(result.data.diferencas, ['data_entrada: sai (era B)', 'linha inicial: 4 -> 5', 'aba: JANEIRO -> automática']);

  const body = uploads[0].body as Record<string, any>;
  assert.equal(body.tipo, 'antecipacao_parcial');
  assert.equal(body.capacidade_linhas, '100');
  assert.equal(body.promover_ativo, 'false');
  assert.equal(body.observacoes, 'Layout 2027');
  assert.equal(body.file.name, 'modelo_padrao_antecipacao_parcial.xlsx');
  assert.ok(body.file.size > 1000);
  const mapeamento = JSON.parse(body.mapeamento_json);
  assert.equal(mapeamento.start_row, 5);
  assert.equal(mapeamento.sheet_name, 'auto');
  assert.equal(mapeamento.columns.data_entrada, undefined);
  assert.equal(mapeamento.columns.a_ori, 'I');
  assert.equal(mapeamento.extra_options.aliquota_format, 'percent_number');
});

test('envio recusa coluna obrigatória ausente, aba inexistente, tipo errado de arquivo e pasta não liberada', async () => {
  const { root, call, uploads } = await setup();
  const arquivo = path.join(root, 'modelo_padrao_antecipacao_parcial.xlsx');
  const base = { arquivo, tipo: 'antecipacao_parcial', capacidade_linhas: 100, colocar_em_uso: true };

  const semAori = await call('enviar_template', { ...base, ajustes: { colunas: { a_ori: null } } });
  assert.equal(semAori.isError, true);
  assert.match(semAori.text, /precisa das colunas: a_ori/);

  const abaErrada = await call('enviar_template', { ...base, ajustes: { aba: 'Não existe' } });
  assert.equal(abaErrada.isError, true);
  assert.match(abaErrada.text, /Abas encontradas/);

  fs.writeFileSync(path.join(root, 'modelo.xls'), 'x');
  const xls = await call('enviar_template', { ...base, arquivo: path.join(root, 'modelo.xls') });
  assert.match(xls.text, /\.xlsx/);

  const fora = await call('enviar_template', { ...base, arquivo: path.join(TEMPLATES_DIR, 'modelo_padrao_antecipacao_parcial.xlsx') });
  assert.match(fora.text, /fora das pastas liberadas/);
  assert.equal(uploads.length, 0);
});

test('ajustes de mapeamento: letras validadas, Tributária ganha redução e valor pago', () => {
  const base = { start_row: 4, columns: { numero_nota: 'D', data_emissao: 'C', v_total: 'E', a_dst: 'J', a_ori: 'K', mva: 'H' } };
  const mapping = aplicarAjustes('antecipacao_tributaria', base, { colunas: { mva: 'h' }, formato_aliquota: 'decimal', celula_cabecalho: 'b3' });
  assert.equal(mapping.columns.mva, 'H');
  assert.equal(mapping.columns.reducao, 'I');
  assert.equal(mapping.columns.valor_pago, 'S');
  assert.equal(mapping.header_cell, 'B3');
  assert.deepEqual(mapping.extra_options, { header_cell: 'B3', aliquota_format: 'decimal' });
  assert.throws(() => aplicarAjustes('difal', base, { colunas: { v_total: 'E1' } }), /Coluna inválida/);
  assert.deepEqual(base.columns.mva, 'H', 'o mapeamento base não pode ser alterado');
});

test('referência: mesma família, depois o modelo base sem capacidade, depois a capacidade mais próxima', () => {
  const modelo = (id: number, capacidade: number | null) => ({
    id, capacidade_linhas: capacidade, mapeamento_campos: { start_row: 4, columns: { numero_nota: 'D' } },
  });
  assert.equal(escolherReferencia([modelo(1, null), modelo(2, 100)], 100)?.id, 2);
  assert.equal(escolherReferencia([modelo(3, 35), modelo(1, null)], 100)?.id, 1);
  assert.equal(escolherReferencia([modelo(3, 35), modelo(4, 80)], 100)?.id, 4);
  assert.equal(escolherReferencia([{ id: 5, capacidade_linhas: 100 }], 100), null, 'modelo sem mapeamento não serve de referência');
  assert.deepEqual(
    compararMapeamentos(
      { start_row: 4, columns: { a_dst: 'H' }, extra_options: { aliquota_format: 'percent_number' } },
      { start_row: 4, columns: { a_dst: 'H' }, header_cell: 'B2', extra_options: { aliquota_format: 'decimal' } },
    ),
    ['cabeçalho: A2 -> B2', 'formato das alíquotas: percent_number -> decimal'],
  );
});
