import type { ExtractedItem, ExtractedNote } from './domain';

/**
 * Alíquota interestadual de referência (não é crédito fiscal destacado).
 * Mesma tabela utilizada no backend: Res. Senado 22/1989 e 13/2012.
 * Não aplica exceções específicas de mercadorias não representadas no XML/SPED.
 */
const UFS = new Set([
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG',
  'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
]);
const SUL_SUDESTE_ORIGEM_7 = new Set(['SP', 'RJ', 'MG', 'PR', 'SC', 'RS']);
const IMPORTADOS_4 = new Set(['1', '2', '3', '8']);
const CSOSN = new Set(['101', '102', '103', '201', '202', '203', '300', '400', '500', '900']);

export function resolveInterstateRate(
  ufOrigem: string,
  ufDestino: string,
  origemMercadoria?: string | number | null,
): number {
  const from = ufOrigem.trim().toUpperCase();
  const to = ufDestino.trim().toUpperCase();
  if (!UFS.has(from) || !UFS.has(to) || from === to) {
    throw new Error(`UF inválida ou operação não interestadual: ${from} -> ${to}.`);
  }
  const sourceCode = String(origemMercadoria ?? '').trim();
  if (IMPORTADOS_4.has(sourceCode)) return 0.04;
  return SUL_SUDESTE_ORIGEM_7.has(from) && !SUL_SUDESTE_ORIGEM_7.has(to) ? 0.07 : 0.12;
}

/** SPED: 1102 = origem 1 + CSOSN 102; 102 = CSOSN sem origem conhecida. */
export function parseSpedTaxCode(raw: string): { origemMercadoria: string; csosn: string } {
  const code = raw.trim();
  if (/^[0-8]\d{3}$/.test(code) && CSOSN.has(code.slice(1))) {
    return { origemMercadoria: code[0], csosn: code.slice(1) };
  }
  if (CSOSN.has(code)) {
    // Os 3 dígitos são o CSOSN, NÃO a origem da mercadoria.
    return { origemMercadoria: '', csosn: code };
  }
  if (/^[0-8]\d{2}$/.test(code)) {
    return { origemMercadoria: code[0], csosn: '' };
  }
  return { origemMercadoria: '', csosn: '' };
}

export function isSimplesSupplier(note: ExtractedNote): boolean {
  const crt = String(note.rawMetadata.crt ?? '').trim();
  return ['1', '2', '4'].includes(crt)
    || note.rawMetadata.fornecedor_simples_nacional === true
    || note.itens.some((item) => Boolean(item.csosn));
}

/** Só infere A.ORI se faltar pICMS, houver Simples comprovado e a
 * operação for interestadual. Convênio ICMS 52/91 tem precedência. */
export function resolveSimpleOriginReference(
  note: ExtractedNote,
  item: ExtractedItem,
  destinationUF: string,
  agreementApplied: boolean,
): { rate: number; inferred: boolean } {
  const originUF = note.ufEmitente.toUpperCase();
  const targetUF = destinationUF.toUpperCase();
  if (agreementApplied || item.aOri !== 0 || !isSimplesSupplier(note)
    || !originUF || !targetUF || originUF === targetUF) {
    return { rate: item.aOri, inferred: false };
  }
  return { rate: resolveInterstateRate(originUF, targetUF, item.origemMercadoria), inferred: true };
}
