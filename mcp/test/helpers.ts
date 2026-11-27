import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { PlanautMcpConfig } from '../src/config.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(here, '..', '..');
export const TEMPLATES_DIR = path.join(REPO_ROOT, 'storage', 'templates');

export const EMPRESA_CNPJ = '12345678000195';
export const FORNECEDOR_CNPJ = '98765432000180';

export function tempDir(prefix = 'planaut-mcp-test-'): string {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

export function testConfig(roots: string[], overrides: Partial<PlanautMcpConfig> = {}): PlanautMcpConfig {
  return {
    baseUrl: 'http://127.0.0.1:9',
    email: 'admin@contabilidade.com',
    senha: 'admin',
    pastasPermitidas: roots,
    pastaSaidaPadrao: null,
    ...overrides,
  };
}

export function chave(numero: number): string {
  return `352601${FORNECEDOR_CNPJ}55001${String(numero).padStart(9, '0')}1${String(numero).padStart(8, '0')}0`;
}

/** NF-e mínima de SP para a empresa BA (mesmo formato das fixtures do motor). */
export function xmlNfe(options: { numero: number; valor: string; cfop: string; data: string; vIcms?: string; pIcms?: string }): string {
  const key = chave(options.numero);
  const vIcms = options.vIcms ?? '0.00';
  const pIcms = options.pIcms ?? '12.00';
  const vBC = Number(pIcms) > 0 ? options.valor : '0.00';
  return `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><NFe>
  <infNFe Id="NFe${key}" versao="4.00">
    <ide><nNF>${options.numero}</nNF><serie>1</serie><dhEmi>${options.data}T10:00:00-03:00</dhEmi></ide>
    <emit><CNPJ>${FORNECEDOR_CNPJ}</CNPJ><xNome>FORNECEDOR SP</xNome><CRT>3</CRT><enderEmit><UF>SP</UF></enderEmit></emit>
    <dest><CNPJ>${EMPRESA_CNPJ}</CNPJ><enderDest><UF>BA</UF></enderDest></dest>
    <total><ICMSTot><vBC>${vBC}</vBC><vICMS>${vIcms}</vICMS><vProd>${options.valor}</vProd><vNF>${options.valor}</vNF></ICMSTot></total>
    <det nItem="1"><prod><cProd>P1</cProd><xProd>PRODUTO TESTE</xProd><NCM>21069090</NCM><CFOP>${options.cfop}</CFOP><vProd>${options.valor}</vProd></prod>
    <imposto><ICMS><ICMS00><orig>0</orig><CST>00</CST><vBC>${vBC}</vBC><pICMS>${pIcms}</pICMS><vICMS>${vIcms}</vICMS></ICMS00></ICMS></imposto></det>
  </infNFe></NFe></nfeProc>`;
}

export function loadContext(): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(here, 'fixtures', 'contexto-ba.json'), 'utf8'));
}

export interface FakeCall {
  method: string;
  path: string;
  query: Record<string, string>;
  body: unknown;
  headers: Record<string, string>;
}

type Handler = (call: FakeCall) => Response | Promise<Response> | unknown;

export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(status === 204 ? null : JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

/**
 * API do Planaut falsa: responde por "MÉTODO /caminho" (sem /api/v1).
 * Login e refresh já vêm prontos; cada teste acrescenta as rotas que usa.
 */
export function fakePlanaut(routes: Record<string, Handler> = {}) {
  const calls: FakeCall[] = [];
  let tokenCounter = 0;
  const baseRoutes: Record<string, Handler> = {
    'POST /auth/login': () => {
      tokenCounter += 1;
      return json(
        {
          access_token: `token-${tokenCounter}`,
          token_type: 'bearer',
          expires_in: 3600,
          user: { id: 'u1', nome: 'Contador', email: 'admin@contabilidade.com', cargo: 'Contador Sênior', role: 'admin' },
        },
        200,
        { 'Set-Cookie': `planaut_refresh=refresh-${tokenCounter}; HttpOnly; Path=/api/v1/auth; Max-Age=2592000` },
      );
    },
    ...routes,
  };

  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const pathname = url.pathname.replace(/^\/api\/v1/, '');
    const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>));
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    const call: FakeCall = {
      method: (init?.method ?? 'GET').toUpperCase(),
      path: pathname,
      query: Object.fromEntries(url.searchParams.entries()),
      body,
      headers,
    };
    calls.push(call);
    const routeKey = `${call.method} ${pathname}`;
    const handler: Handler | undefined = Object.hasOwn(baseRoutes, routeKey)
      ? baseRoutes[routeKey]
      : Object.entries(baseRoutes).find(([key]) => {
        const [method, route] = key.split(' ');
        if (method !== call.method || !route.includes(':')) return false;
        const regex = new RegExp(`^${route.replace(/:[^/]+/g, '[^/]+')}$`);
        return regex.test(pathname);
      })?.[1];
    if (!handler) return json({ detail: `Rota não simulada: ${call.method} ${pathname}` }, 404);
    const result = await handler(call);
    return result instanceof Response ? result : json(result);
  }) as typeof fetch;

  return { fetch: fetchImpl, calls };
}

export function templateBytes(file: string): ArrayBuffer {
  const buffer = fs.readFileSync(path.join(TEMPLATES_DIR, file));
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
}
