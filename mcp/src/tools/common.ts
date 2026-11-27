import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult, ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import { PlanautApiError, type PlanautApi } from '../api.ts';
import { FileAccessError, type FolderPolicy } from '../files.ts';
import type { GeracaoManager } from '../generation.ts';
import { GeracaoError } from '../generation.ts';

export interface ToolContext {
  server: McpServer;
  api: PlanautApi;
  policy: FolderPolicy;
  geracoes: GeracaoManager;
}

export const READ_ONLY: ToolAnnotations = { readOnlyHint: true, openWorldHint: false };
export const WRITE: ToolAnnotations = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
export const WRITE_IDEMPOTENT: ToolAnnotations = { ...WRITE, idempotentHint: true };
export const DESTRUCTIVE: ToolAnnotations = { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false };

export function ok(data: unknown): CallToolResult {
  return { content: [{ type: 'text', text: typeof data === 'string' ? data : JSON.stringify(data, null, 2) }] };
}

export function fail(error: unknown): CallToolResult {
  let message: string;
  if (error instanceof PlanautApiError) {
    message = error.status ? `Planaut (HTTP ${error.status}): ${error.message}` : error.message;
  } else if (error instanceof GeracaoError || error instanceof FileAccessError) {
    message = error.message;
  } else if (error instanceof Error) {
    message = error.message || error.name;
  } else {
    message = String(error);
  }
  return { isError: true, content: [{ type: 'text', text: message }] };
}

/** Executa a ferramenta convertendo exceções em resultado de erro legível pela IA. */
export function safe<A>(fn: (args: A) => Promise<unknown>): (args: A) => Promise<CallToolResult> {
  return async (args: A) => {
    try {
      return ok(await fn(args));
    } catch (error) {
      return fail(error);
    }
  };
}

// ---------------------------------------------------------------- percentuais

/**
 * A API aceita 0.12 ou 12 e decide pelo tamanho — 1 seria lido como 100%.
 * Nas ferramentas o percentual é sempre explícito (12 = 12%) e a conversão
 * para a fração enviada à API acontece aqui, em texto, sem erro de ponto
 * flutuante.
 */
export function percentToDecimalString(percent: number): string {
  if (!Number.isFinite(percent)) throw new GeracaoError('Percentual inválido.');
  const fixed = (percent / 100).toFixed(8);
  return fixed.replace(/0+$/, '').replace(/\.$/, '') || '0';
}

export function decimalToPercent(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  return Math.round(num * 100 * 10_000) / 10_000;
}

export const percent = (description: string) => z
  .number()
  .min(0)
  .max(100)
  .describe(`${description} Em percentual: 20.5 significa 20,5%.`);

// ---------------------------------------------------------------- formatação

type JsonRecord = Record<string, unknown>;

export function omit<T extends JsonRecord>(record: T, keys: string[]): JsonRecord {
  const copy: JsonRecord = { ...record };
  for (const key of keys) delete copy[key];
  return copy;
}

const TIMESTAMPS = ['criado_em', 'atualizado_em'];

/** Troca `aliquota` (fração) por `aliquota_percentual` e tira carimbos de data. */
export function formatRule(rule: JsonRecord): JsonRecord {
  const out = omit(rule, TIMESTAMPS);
  if ('aliquota' in out) {
    out.aliquota_percentual = decimalToPercent(out.aliquota);
    delete out.aliquota;
  }
  if ('perfil_regras_id' in out) {
    out.perfil_id = out.perfil_regras_id;
    delete out.perfil_regras_id;
  }
  if (Array.isArray(out.excecoes)) {
    out.excecoes = (out.excecoes as JsonRecord[]).map((excecao) => omit(excecao, TIMESTAMPS));
  }
  return out;
}

export function formatEmpresa(empresa: JsonRecord, compact = false): JsonRecord {
  const termo = empresa.termo_acordo as JsonRecord | null | undefined;
  const base: JsonRecord = {
    id: empresa.id,
    razao_social: empresa.razao_social,
    cnpj: empresa.cnpj,
    uf: empresa.uf,
    perfil_id: empresa.perfil_regras_id,
    optante_simples_nacional: empresa.optante_simples_nacional,
    atividade: empresa.atividade,
    ativo: empresa.ativo,
    termo_acordo: termo
      ? { aliquota_percentual: decimalToPercent(termo.aliquota), descricao: termo.descricao ?? null }
      : null,
  };
  if (compact) return base;
  return {
    ...base,
    inscricao_estadual: empresa.inscricao_estadual ?? null,
    a_ori_fixa_parcial_percentual: decimalToPercent(empresa.a_ori_fixa_parcial),
    fornecedores_uso_consumo: empresa.fornecedores_uso_consumo ?? [],
    atualizado_em: empresa.atualizado_em,
  };
}

export function normalizeSearch(text: unknown): string {
  return String(text ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

export function matchesSearch(fields: unknown[], query: string | undefined): boolean {
  if (!query || !query.trim()) return true;
  const needle = normalizeSearch(query);
  const digits = query.replace(/\D/g, '');
  return fields.some((field) => {
    const text = normalizeSearch(field);
    if (text.includes(needle)) return true;
    return digits.length >= 4 && String(field ?? '').replace(/\D/g, '').includes(digits);
  });
}

export function cleanUndefined(record: JsonRecord): JsonRecord {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined));
}
