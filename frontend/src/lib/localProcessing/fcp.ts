import type { JsonObject } from '../../types/common';
import type { LocalOutputRow } from '../../types/localProcessing';
import type { TipoPlanilha } from '../../types/solicitacao';
import { calculateTax, roundCurrency } from './calculations.ts';
import type { CalculationResult, ExtractedNote, TaxRateResolution } from './domain';
import { TAX_SUBSTITUTION_DESTINATIONS } from './domain.ts';

/** Arredonda taxas decimais eliminando ruído binário de ponto flutuante (ex.: 0.12 + 0.02). */
export function roundRate(value: number, decimals = 6): number {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

export function formatRateString(value: number): string {
  const fixed4 = value.toFixed(4);
  return Math.abs(Number(fixed4) - value) <= 1e-9 ? fixed4 : String(value);
}

export function formatCurrencyString(value: number): string {
  return roundCurrency(value).toFixed(2);
}

/**
 * Erro do motor de alíquotas com a NF-e que o disparou, como no pipeline do
 * servidor: um conflito de cadastro sem o documento obriga a procurar o item à mão.
 */
export function withNoteContext<T>(note: ExtractedNote, resolve: () => T): T {
  try {
    return resolve();
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    throw new Error(`NF-e ${note.numeroNota} (arquivo ${note.filename}): ${error.message}`, { cause: error });
  }
}

export function computeFcpApplication(
  destination: TipoPlanilha,
  isSimplesCompany: boolean,
  baseADst: number,
  fcpResolution: TaxRateResolution | null,
): {
  fcpAliquota: number;
  fcpSeparado: number | null;
  effectiveADst: number;
} {
  const fcpAliquota = fcpResolution && fcpResolution.aliquota > 0 ? Number(fcpResolution.aliquota) : 0;
  const isTributariaRegimeNormal = TAX_SUBSTITUTION_DESTINATIONS.has(destination) && !isSimplesCompany;
  if (fcpAliquota > 0 && isTributariaRegimeNormal) {
    return {
      fcpAliquota,
      fcpSeparado: fcpAliquota,
      effectiveADst: baseADst,
    };
  }
  if (fcpAliquota > 0) {
    return {
      fcpAliquota,
      fcpSeparado: null,
      effectiveADst: roundRate(baseADst + fcpAliquota),
    };
  }
  return {
    fcpAliquota: 0,
    fcpSeparado: null,
    effectiveADst: baseADst,
  };
}

export function calculateSeparateFcp(params: {
  destination: TipoPlanilha;
  vTotal: number;
  baseCalculo: number;
  ipiDespesas: number;
  mva: number;
  reducao: number | null;
  fcpAliquota: number;
}): CalculationResult {
  return calculateTax(params.destination, {
    vTotal: params.vTotal,
    baseCalculo: params.baseCalculo,
    ipiDespesas: params.ipiDespesas,
    aOri: 0,
    aDst: params.fcpAliquota,
    mva: params.mva,
    reducao: params.reducao,
    isSimples: false,
    valorPago: 0,
  });
}

export function buildFcpOutputRow(
  baseRow: LocalOutputRow,
  fcpAliquota: number,
  fcpCalc: CalculationResult,
  overrides?: Partial<LocalOutputRow>,
): LocalOutputRow {
  return {
    ...baseRow,
    ...overrides,
    a_ori: 0,
    a_dst: fcpAliquota,
    debito: fcpCalc.debito,
    credito: 0,
    valor_devido: fcpCalc.valorDevido,
    valor_pago: 0,
  };
}

export function buildFcpMetadata(params: {
  aDstBase: number;
  fcpAliquota: number | null;
  fcpOrigem: string | null;
  fcpDetalhe: string | null;
  fcpSeparado: boolean;
  fcpCalc?: CalculationResult | null;
}): JsonObject {
  const temFcp = params.fcpAliquota != null && params.fcpAliquota > 0;
  const fcpSeparado = Boolean(params.fcpSeparado && temFcp);
  const meta: JsonObject = {
    a_dst_base: formatRateString(params.aDstBase),
    fcp_aliquota: temFcp ? formatRateString(params.fcpAliquota!) : null,
    fcp_origem: temFcp ? params.fcpOrigem : null,
    fcp_detalhe: temFcp ? params.fcpDetalhe : null,
    fcp_separado: fcpSeparado,
  };
  if (fcpSeparado && params.fcpCalc) {
    meta.fcp_base_st = formatCurrencyString(Number(params.fcpCalc.detalhes.base_st ?? 0));
    meta.fcp_valor_devido = formatCurrencyString(params.fcpCalc.valorDevido);
  }
  return meta;
}
