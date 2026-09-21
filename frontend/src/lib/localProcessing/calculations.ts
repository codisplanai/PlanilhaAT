import type { CalculationResult } from './domain';
import type { TipoPlanilha } from '../../types/solicitacao';

export function roundCurrency(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function calculateTax(
  destination: TipoPlanilha,
  input: {
    vTotal: number;
    baseCalculo: number;
    ipiDespesas: number;
    aOri: number;
    aDst: number;
    mva?: number;
    aliqSimples?: string;
    isSimples?: boolean;
  },
): CalculationResult {
  const { vTotal, baseCalculo, ipiDespesas, aOri, aDst } = input;

  if (
    destination === 'antecipacao_parcial'
    || destination === 'antecipacao_parcial_antecipado'
    || destination === 'antecipacao_parcial_simples'
    || destination === 'antecipacao_parcial_antecipado_simples'
  ) {
    const debito = roundCurrency(vTotal * aDst);
    const credito = roundCurrency(baseCalculo * aOri);
    const bruto = debito - credito;
    const isSimples = Boolean(input.isSimples);
    const valorDevido = isSimples && bruto > 0 ? roundCurrency(bruto * 0.8) : bruto;
    return {
      debito,
      credito,
      valorDevido,
      detalhes: {
        tipo: 'antecipacao_parcial',
        is_simples: isSimples,
        reducao: isSimples ? '20%' : '0%',
      },
    };
  }

  if (
    destination === 'antecipacao_tributaria'
    || destination === 'antecipacao_tributaria_antecipado'
  ) {
    let mva = Number(input.mva ?? 0);
    if (mva > 1) mva /= 100;
    const baseSt = mva > 0
      ? (vTotal + ipiDespesas) * (1 + mva)
      : (ipiDespesas > 0 ? vTotal + ipiDespesas : vTotal);
    const debito = roundCurrency(baseSt * aDst);
    const credito = roundCurrency(baseCalculo * aOri);
    return {
      debito,
      credito,
      valorDevido: debito - credito,
      detalhes: {
        tipo: 'antecipacao_tributaria',
        mva_aplicado: mva,
        base_st: roundCurrency(baseSt),
      },
    };
  }

  if (destination === 'difal') {
    const aliqSimples = String(input.aliqSimples ?? 'N').trim().toUpperCase();
    const dstRate = aDst > 1 ? aDst / 100 : aDst;
    const oriRate = aOri > 1 ? aOri / 100 : aOri;
    const divisor = 1 - dstRate > 0 ? 1 - dstRate : 1;
    let baseSt: number;
    let debito: number;
    let credito: number;
    let valorDevido: number;

    if (aliqSimples === 'S') {
      baseSt = (vTotal + ipiDespesas) / divisor;
      valorDevido = roundCurrency(baseSt * (dstRate - oriRate));
      debito = roundCurrency(baseSt * dstRate);
      credito = roundCurrency(baseSt * oriRate);
    } else if (aliqSimples !== '' && aliqSimples !== 'N') {
      let creditoSimples = Number(aliqSimples.replace(',', '.'));
      if (!Number.isFinite(creditoSimples)) creditoSimples = 0;
      if (creditoSimples > 1) creditoSimples /= 100;
      baseSt = ((vTotal + ipiDespesas) - vTotal * creditoSimples) / divisor;
      valorDevido = roundCurrency(baseSt * (dstRate - oriRate));
      debito = roundCurrency(baseSt * dstRate);
      credito = debito - valorDevido;
    } else {
      baseSt = ((vTotal + ipiDespesas) - vTotal * oriRate) / divisor;
      debito = roundCurrency(baseSt * dstRate);
      credito = roundCurrency(vTotal * oriRate);
      valorDevido = debito - credito;
    }

    return {
      debito,
      credito,
      valorDevido,
      detalhes: {
        tipo: 'difal',
        aliq_simples: aliqSimples,
        base_st: roundCurrency(baseSt),
        diferencial_aliquota: dstRate - oriRate,
      },
    };
  }

  throw new Error(`Tipo de cálculo não suportado: ${destination}.`);
}
