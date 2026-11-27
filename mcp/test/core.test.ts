import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { PlanautApi, PlanautApiError, formatApiDetail } from '../src/api.ts';
import { DEFAULT_PLANAUT_URL, loadConfig } from '../src/config.ts';
import { installNodeDom } from '../src/dom.ts';
import { FolderPolicy, writeUniqueFile } from '../src/files.ts';
import { fakePlanaut, json, tempDir, testConfig } from './helpers.ts';

installNodeDom();

test('DOM: XML inválido vira documento com parsererror, como no navegador', () => {
  const ok = new DOMParser().parseFromString('<a xmlns="urn:x"><b>1</b></a>', 'application/xml');
  assert.equal(ok.querySelector('parsererror'), null);
  const bad = new DOMParser().parseFromString('<a><b></a>', 'application/xml');
  assert.ok(bad.querySelector('parsererror'));
});

test('DOM: querySelectorAll("*") percorre em ordem de documento e children ignora texto', () => {
  const doc = new DOMParser().parseFromString('<r><a><b/></a> texto <c/></r>', 'application/xml');
  assert.deepEqual(Array.from(doc.querySelectorAll('*')).map((node) => node.localName), ['r', 'a', 'b', 'c']);
  assert.deepEqual(Array.from(doc.documentElement.children).map((node) => node.localName), ['a', 'c']);
  assert.throws(() => doc.querySelectorAll('a > b'), /Seletor não suportado/);
});

test('DOM: serialização preserva namespaces de planilha', () => {
  const xml = '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
    + 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheetData/><drawing r:id="rId1"/></worksheet>';
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const drawing = doc.getElementsByTagNameNS('http://schemas.openxmlformats.org/spreadsheetml/2006/main', 'drawing')[0];
  assert.equal(drawing.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id'), 'rId1');
  const out = new XMLSerializer().serializeToString(doc);
  assert.match(out, /xmlns:r="http:\/\/schemas.openxmlformats.org\/officeDocument\/2006\/relationships"/);
  assert.match(out, /<drawing r:id="rId1"\/>/);
});

test('config: padrões, pastas por argumento/variável e placeholders vazios da extensão', () => {
  const base = loadConfig({}, []);
  assert.equal(base.baseUrl, DEFAULT_PLANAUT_URL);
  assert.deepEqual(base.pastasPermitidas, [os.homedir()]);

  const config = loadConfig(
    {
      PLANAUT_URL: 'http://127.0.0.1:8765/',
      PLANAUT_PASTAS: '/dados/xml;/dados/sped\n/dados/xml',
      PLANAUT_EMAIL: ' admin@x.com ',
      PLANAUT_SENHA: '${user_config.senha}',
      PLANAUT_PASTA_SAIDA: '${user_config.pasta_saida}',
    },
    ['/clientes', '--flag'],
  );
  assert.equal(config.baseUrl, 'http://127.0.0.1:8765');
  assert.deepEqual(config.pastasPermitidas, ['/clientes', '/dados/xml', '/dados/sped']);
  assert.equal(config.email, 'admin@x.com');
  assert.equal(config.senha, null);
  assert.equal(config.pastaSaidaPadrao, null);
});

test('config: recusa http fora do localhost', () => {
  assert.throws(() => loadConfig({ PLANAUT_URL: 'http://planaut.codisplan.com.br' }, []), /https/);
  assert.throws(() => loadConfig({ PLANAUT_URL: 'planaut.codisplan.com.br' }, []), /inválida/);
});

test('api: faz login uma vez, envia Bearer e formata erros de validação do FastAPI', async () => {
  const fake = fakePlanaut({
    'GET /empresas': () => [{ id: 1 }],
    'POST /empresas': () => json({ detail: [{ loc: ['body', 'cnpj'], msg: 'CNPJ inválido' }] }, 422),
  });
  const api = new PlanautApi(testConfig([os.tmpdir()]), fake.fetch);
  assert.deepEqual(await api.get('/empresas'), [{ id: 1 }]);
  assert.deepEqual(await api.get('/empresas'), [{ id: 1 }]);
  assert.equal(fake.calls.filter((call) => call.path === '/auth/login').length, 1);
  assert.equal(fake.calls.at(-1)?.headers.Authorization, 'Bearer token-1');
  await assert.rejects(api.post('/empresas', {}), (error: unknown) => (
    error instanceof PlanautApiError && error.status === 422 && error.message === 'cnpj: CNPJ inválido'
  ));
  assert.equal(formatApiDetail('texto'), 'texto');
});

test('api: em 401 renova pelo cookie de refresh e repete a requisição', async () => {
  let empresasCalls = 0;
  const fake = fakePlanaut({
    'GET /empresas': (call) => {
      empresasCalls += 1;
      return call.headers.Authorization === 'Bearer renovado' ? [{ id: 2 }] : json({ detail: 'expirado' }, 401);
    },
    'POST /auth/refresh': (call) => {
      assert.equal(call.headers.Cookie, 'planaut_refresh=refresh-1');
      return json(
        { access_token: 'renovado', expires_in: 3600, user: { id: 'u1', nome: 'C', email: 'a@b.c', cargo: 'x' } },
        200,
        { 'Set-Cookie': 'planaut_refresh=refresh-2; HttpOnly; Path=/api/v1/auth' },
      );
    },
  });
  const api = new PlanautApi(testConfig([os.tmpdir()]), fake.fetch);
  assert.deepEqual(await api.get('/empresas'), [{ id: 2 }]);
  assert.equal(empresasCalls, 2);
});

test('api: refresh recusado leva a novo login com a senha configurada', async () => {
  const fake = fakePlanaut({
    'GET /perfis-regras': (call) => (call.headers.Authorization === 'Bearer token-2' ? [] : json({ detail: 'expirado' }, 401)),
    'POST /auth/refresh': () => json({ detail: 'Sessão expirada.' }, 401, { 'Set-Cookie': 'planaut_refresh=""; Max-Age=0; Path=/api/v1/auth' }),
  });
  const api = new PlanautApi(testConfig([os.tmpdir()]), fake.fetch);
  assert.deepEqual(await api.get('/perfis-regras'), []);
  assert.equal(fake.calls.filter((call) => call.path === '/auth/login').length, 2);
});

test('api: endereço errado que devolve a página do site vira erro explicável', async () => {
  const fake = fakePlanaut({
    'GET /empresas': () => new Response('<!doctype html><html></html>', { status: 200, headers: { 'Content-Type': 'text/html' } }),
  });
  const api = new PlanautApi(testConfig([os.tmpdir()]), fake.fetch);
  await assert.rejects(api.get('/empresas'), /Resposta inesperada do Planaut .* Confira o endereço/);
});

test('api: sem e-mail e senha a mensagem orienta a configuração', async () => {
  const api = new PlanautApi(testConfig([os.tmpdir()], { email: null, senha: null }), fakePlanaut().fetch);
  await assert.rejects(api.get('/empresas'), /E-mail e senha do Planaut não configurados/);
});

test('pastas: aceita caminhos dentro das liberadas e recusa fora, inclusive por link simbólico', async () => {
  const root = tempDir();
  const outside = tempDir();
  fs.writeFileSync(path.join(root, 'nota.xml'), '<a/>');
  fs.writeFileSync(path.join(outside, 'segredo.xml'), '<a/>');
  fs.symlinkSync(outside, path.join(root, 'atalho'));
  const policy = new FolderPolicy([root]);

  assert.equal(await policy.resolveExisting(path.join(root, 'nota.xml')), path.join(root, 'nota.xml'));
  await assert.rejects(policy.resolveExisting(path.join(outside, 'segredo.xml')), /fora das pastas liberadas/);
  await assert.rejects(policy.resolveExisting(path.join(root, 'atalho', 'segredo.xml')), /fora das pastas liberadas/);
  await assert.rejects(policy.resolveExisting(path.join(root, 'nao-existe.xml')), /não encontrado/);

  const created = await policy.resolveOutputDir(path.join(root, 'saida', '2026-01'));
  assert.ok(fs.statSync(created).isDirectory());
  await assert.rejects(policy.resolveOutputDir(path.join(outside, 'saida')), /fora das pastas liberadas/);
});

test('gravação nunca sobrescreve: acrescenta sufixo numerado', async () => {
  const dir = tempDir();
  const first = await writeUniqueFile(dir, 'RP-153_X.xlsx', new Uint8Array([1]));
  const second = await writeUniqueFile(dir, 'RP-153_X.xlsx', new Uint8Array([2]));
  const third = await writeUniqueFile(dir, 'RP:153/Y.xlsx', new Uint8Array([3]));
  assert.equal(path.basename(first), 'RP-153_X.xlsx');
  assert.equal(path.basename(second), 'RP-153_X (2).xlsx');
  assert.equal(path.basename(third), 'RP_153_Y.xlsx');
  assert.deepEqual([...fs.readFileSync(first)], [1]);
});
