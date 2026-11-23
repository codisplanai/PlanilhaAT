import type { LocalProcessingContext } from '../../types/localProcessing';
import type { ExtractedItem, ExtractedNote } from './domain';
import { normalizeDescription } from './domain.ts';
import { interstateRateKey, type MvaColumn } from './rules.ts';

// RICMS/BA Anexo 1, item 1.1 (2026), remete ao Anexo II do Convênio ICMS 142/18.
// Cobertura inicial deliberadamente restrita aos pares NCM/CEST conferidos.
// Não usar apenas o prefixo do CEST 01: o enquadramento exige o produto correto.
// https://mbusca.sefaz.ba.gov.br/DITRI/normas_complementares/decretos/decreto_2012_13780_ricms_anexo_1_vigente_2026.pdf
const AUTOPECAS: Readonly<Record<string, readonly string[]>> = {
  '0107500': ['87089990', '87085080'],
  '0105400': ['85111000'],
  '0107300': ['85443000'],
  '0112600': ['90322000'],
  '0100900': ['40169990'],
};
const MVA_DEMAIS = { '4': 107.43, '7': 100.95, '12': 90.15 } as const;
const digits = (value: string) => value.replace(/\D/g, '');
const near = (a: number, b: number) => Number.isFinite(a) && Math.abs(a - b) < 0.0001;
const percent = (a: number) => a <= 1 ? a * 100 : a;

/**
 * Complemento do Anexo para o caso SE -> BA em 2026, somente quando o fluxo
 * normal não resolveu a MVA e a NF-e corrobora o percentual legal do caso geral.
 * Não autoriza a MVA menor por fidelidade, não presume ST pago, não altera CFOP,
 * não substitui MVA de perfil nem uma MVA já determinada pela tabela.
 * CEST residual exige evidência adicional de operação no comércio automotivo.
 */
export function resolveAutopecasMvaXml(
  context: LocalProcessingContext,
  note: ExtractedNote,
  item: ExtractedItem,
  column: MvaColumn | null,
  originalAOri: number,
  aOri: number,
  aDst: number,
): number | null {
  if (column !== 'ajustada' || String(note.rawMetadata.crt) !== '3'
    || note.ufEmitente !== 'SE' || context.empresa.uf !== 'BA'
    || !note.dataEmissao.startsWith('2026-') || !context.mva_anexo.length) return null;
  const ncm = digits(item.ncm);
  const cest = digits(item.cest);
  const evidence = item.stXml;
  if (!evidence || evidence.cfop !== '6403' || !/^[26]403$/.test(item.cfop)
    || item.cstIcms !== '10' || evidence.modalidade !== '4'
    || !(evidence.valor > 0 && evidence.base > 0)
    || !near(evidence.aliquota, 20.5) || !near(percent(aDst), 20.5)
    || !near(percent(originalAOri), percent(aOri))) return null;
  // Se já há entrada explícita para o par no Anexo, não contornar uma
  // pendência condicional, não numérica ou de dados daquela entrada.
  if (context.mva_anexo.some((row) => {
    const code = digits(String(row.ncm ?? ''));
    return code && ncm.startsWith(code) && (row.cest ?? []).some((c) => digits(c) === cest);
  })) return null;
  const specific = AUTOPECAS[cest]?.includes(ncm) === true;
  const residual = cest === '0199900' && ncm === '73181500'
    && item.descricaoConfiavel && /\bPARAFUSO\b/.test(normalizeDescription(item.descricao))
    && /\bAUTO\s*PECAS\b/.test(normalizeDescription(String(note.rawMetadata.emit_nome ?? '')))
    && /\bAUTO\s*PECAS\b/.test(normalizeDescription(context.empresa.razao_social));
  if (!specific && !residual) return null;
  const key = interstateRateKey(originalAOri);
  if (!key) return null;
  const expected = MVA_DEMAIS[key];
  return near(evidence.mva, expected) ? expected : null;
}
