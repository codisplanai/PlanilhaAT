import type { ExtractedNote } from './domain.ts';

// Somente estas três empresas dispensam a Antecipação Tributária quando a
// própria NF-e já apresenta ICMS ST destacado. Demais empresas: regra geral.
const COMPANIES = [
  'ARMAZEM COMERCIO',
  'ARMAZEM RECONCAVO',
  'BAIA FERRO SALVADOR',
];

function normalizeCompanyName(name: string): string {
  return name.normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}

export function shouldExcludeStFromTributaria(
  companyName: string,
  note: Pick<ExtractedNote, 'vStNota' | 'itens'>,
): boolean {
  const normalized = normalizeCompanyName(companyName);
  const affected = COMPANIES.some((company) => normalized === company || normalized.startsWith(`${company} `));
  if (!affected) return false;
  return Number(note.vStNota ?? 0) > 0
    || note.itens.some((item) => Number(item.vIcmsSt ?? 0) > 0);
}

export const ST_TRIBUTARIA_EXCLUSION_REASON =
  'Antecipação Tributária excluída: ICMS ST já destacado no XML da NF-e (regra específica da empresa, independentemente do valor pago).';
