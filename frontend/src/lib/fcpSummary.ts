import type { JsonObject } from '../types/common.ts';
import type { NotaFiscalProcessada, TipoPlanilha } from '../types/solicitacao.ts';
import { formatPercentInput } from './formatters.ts';

export interface NotaFcpInfo {
  aliquota: number | null;
  separado: boolean;
  valorDevido: number;
}

function roundCents(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function parsePositiveNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function parsePositiveCurrency(value: unknown): number {
  return parsePositiveNumber(value) ?? 0;
}

function extractFcpParcelas(meta: JsonObject | undefined): JsonObject[] {
  const raw = meta?.fcp_parcelas;
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is JsonObject => Boolean(item) && typeof item === 'object' && !Array.isArray(item));
}

function extractSeparatedValorDevido(meta: JsonObject | undefined, parcelas: JsonObject[]): number {
  if (meta?.fcp_separado !== true) return 0;
  // CT-e multi-alíquota concentra as parcelas em `fcp_parcelas`; nunca somar junto o campo de topo.
  if (parcelas.length > 0) {
    return roundCents(
      parcelas.reduce((sum, parcela) => sum + parsePositiveCurrency(parcela.fcp_valor_devido), 0),
    );
  }
  return roundCents(parsePositiveCurrency(meta.fcp_valor_devido));
}

/**
 * Extrai a alíquota de FCP, se foi apurado em aba separada e o valor devido separado de uma nota/CT-e.
 */
export function getNotaFcpInfo(
  nota: Pick<NotaFiscalProcessada, 'metadados_extras'>,
): NotaFcpInfo {
  const meta = nota.metadados_extras;
  const parcelas = extractFcpParcelas(meta);
  const topAliquota = parsePositiveNumber(meta?.fcp_aliquota);
  const parcelaAliquotas = parcelas
    .map((p) => parsePositiveNumber(p.fcp_aliquota))
    .filter((v): v is number => v !== null);

  const aliquota = topAliquota ?? (parcelaAliquotas.length > 0 ? Math.max(...parcelaAliquotas) : null);
  if (aliquota === null) {
    return { aliquota: null, separado: false, valorDevido: 0 };
  }

  const separado = meta?.fcp_separado === true;
  return {
    aliquota,
    separado,
    valorDevido: separado ? extractSeparatedValorDevido(meta, parcelas) : 0,
  };
}

/**
 * Soma apenas o FCP apurado em guia/aba separada (`fcp_separado === true`), filtrando por destino quando informado.
 */
export function sumSeparatedFcpByDestination(
  notas: NotaFiscalProcessada[] | undefined,
  destino?: TipoPlanilha,
): number {
  if (!notas || notas.length === 0) return 0;

  let total = 0;
  for (const nota of notas) {
    if (destino && nota.destino_planilha !== destino) continue;
    const meta = nota.metadados_extras;
    if (meta?.fcp_separado !== true) continue;
    const parcelas = extractFcpParcelas(meta);
    total += extractSeparatedValorDevido(meta, parcelas);
  }
  return roundCents(total);
}

/**
 * Formata uma alíquota decimal de FCP sem zeros supérfluos (ex.: 0.02 -> "2%", 0.025 -> "2,5%").
 */
export function formatFcpPercent(aliquota: number): string {
  return `${formatPercentInput(aliquota)}%`;
}

/**
 * Retorna o rótulo percentual do FCP da nota (ou parcelas de CT-e), ou null quando não houver FCP.
 */
export function formatNotaFcpRateLabel(
  nota: Pick<NotaFiscalProcessada, 'metadados_extras'>,
): string | null {
  const info = getNotaFcpInfo(nota);
  if (info.aliquota === null) return null;

  const parcelas = extractFcpParcelas(nota.metadados_extras);
  if (parcelas.length > 1) {
    const distinctRates = Array.from(
      new Set(
        parcelas
          .map((p) => parsePositiveNumber(p.fcp_aliquota))
          .filter((v): v is number => v !== null),
      ),
    ).sort((a, b) => a - b);
    if (distinctRates.length > 1) {
      return distinctRates.map(formatFcpPercent).join(' / ');
    }
  }

  return formatFcpPercent(info.aliquota);
}

/**
 * Monta o nome da aba de FCP a partir de `periodo_inicio` ("MM-AAAA FCP"), com fallback para "FCP".
 */
export function formatFcpCompetenceTab(periodoInicio: string | null | undefined): string {
  if (!periodoInicio) return 'FCP';
  const cleanDate = periodoInicio.split('T')[0];
  const [year, month] = cleanDate.split('-');
  if (!/^\d{4}$/.test(year || '') || !/^(0[1-9]|1[0-2])$/.test(month || '')) {
    return 'FCP';
  }
  return `${month}-${year} FCP`;
}
