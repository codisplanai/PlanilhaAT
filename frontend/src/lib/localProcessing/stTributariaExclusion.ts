import type { ExtractedItem, ExtractedNote } from './domain.ts';
import { normalizeDescription } from './domain.ts';

// Somente estas empresas dispensam a Antecipação Tributária quando a
// própria NF-e já apresenta ICMS ST destacado. Demais empresas: regra geral.
const COMPANIES = [
  'ARMAZEM COMERCIO',
  'ARMAZEM RECONCAVO',
  'ARMAZEM DO RECONCAVO',
  'BAHIA FERRO SALVADOR',
  'BAIA FERRO SALVADOR',
  'CASA VIP',
  'BAHIA FERRO FSA',
  'BAIA FERRO FSA',
  'BAHIA FERRO INDUSTRIAL',
  'BAIA FERRO INDUSTRIAL',
  'BAHIA FERRO INDUSTRIA',
  'BAIA FERRO INDUSTRIA',
  'BAHIA FERRO LAURO',
  'BAIA FERRO LAURO',
  'MERCAL',
  'MERCADAO SUPERMERCADO',
  'MERCADAO SUPERMECADO',
];

export function shouldExcludeStItemFromTributaria(
  companyName: string,
  note: Pick<ExtractedNote, 'rawMetadata'>,
  item: Pick<ExtractedItem, 'vIcmsSt'>,
): boolean {
  const normalized = normalizeDescription(companyName);
  const affected = COMPANIES.some((company) => normalized === company || normalized.startsWith(`${company} `));
  if (!affected) return false;
  // Não inferir retenção de ST pelo CFOP, pela reclassificação ou pelo total
  // da nota. SPED isolado não é prova de ST paga no item.
  if (!Object.prototype.hasOwnProperty.call(note.rawMetadata, 'icms_st_xml')) return false;
  return Number(item.vIcmsSt ?? 0) > 0;
}

export const ST_TRIBUTARIA_EXCLUSION_REASON =
  'Antecipação Tributária excluída: ICMS ST já destacado no XML para este item (regra específica da empresa; frete FOB separado avaliado independentemente).';
