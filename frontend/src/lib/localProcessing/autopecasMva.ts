import type { LocalMvaEntry, LocalProcessingContext } from '../../types/localProcessing';
import type { ExtractedItem, ExtractedNote } from './domain';
import { normalizeDescription } from './domain.ts';
import { interstateRateKey, type MvaColumn } from './rules.ts';

const digits = (value: string) => value.replace(/\D/g, '');
const near = (a: number, b: number) => Number.isFinite(a) && Math.abs(a - b) < 0.0001;
const percent = (a: number) => a <= 1 ? a * 100 : a;
const PROT97 = new Set('AC AL AP MA MT PA PB PR PE PI RJ RR SE TO'.split(' '));
const PROT41 = new Set('AC AL AM AP DF MA MG MT PA PB PR PI RJ RR'.split(' '));
const EXCEPT41 = new Set(['0101900','0106201','0111200','0112700','0112800','0199900']);

export function autopecasEntries(context: LocalProcessingContext, note: ExtractedNote, item: ExtractedItem): LocalMvaEntry[] {
  const ncm = digits(item.ncm), cest = digits(item.cest), day = note.dataEmissao.slice(0,10);
  if (ncm.length !== 8 || ncm === '00000000' || !cest.startsWith('01') || cest.length !== 7 || context.empresa.uf !== 'BA') return [];
  return context.mva_anexo.filter(row => {
    if (!row.autopecas || !row.vigencia_inicio || !row.vigencia_fim
      || day < row.vigencia_inicio || day > row.vigencia_fim
      || !(row.cest ?? []).some(c => digits(c) === cest)) return false;
    const code = digits(row.ncm);
    if (cest === '0199900') return !code;
    if (cest === '0102100' && ncm === '73259100') return false;
    if (cest === '0112700' && ncm === '87169090') return false;
    return !!code && ncm.startsWith(code);
  });
}

export function autopecasMvaSuggestions(context: LocalProcessingContext, note: ExtractedNote, item: ExtractedItem,
  column: MvaColumn | null, aOri: number): Array<{label: string; value: number}> {
  if (!column) return [];
  const key = interstateRateKey(aOri);
  const results = new Map<string, number>();
  for (const row of autopecasEntries(context,note,item)) {
    const cases = column === 'original' ? row.mva_original : row.mva_ajustada;
    for (const entry of cases ?? []) {
      const raw = 'valor' in entry ? entry.valor : key && 'aliquotas' in entry ? entry.aliquotas?.[key] : null;
      if (raw == null || raw === '' || !Number.isFinite(Number(raw))) continue;
      results.set(entry.caso ?? 'Anexo 1', Number(raw));
    }
  }
  return [...results].map(([label,value])=>({label,value}));
}

/** Não inferir benefício de fidelidade; o XML só corrobora o caso geral. */
export function resolveAutopecasMvaXml(context: LocalProcessingContext, note: ExtractedNote, item: ExtractedItem,
  column: MvaColumn | null, originalAOri: number, aOri: number, aDst: number): number | null {
  const cest = digits(item.cest), ncm = digits(item.ncm);
  if (column !== 'ajustada' || String(note.rawMetadata.crt) !== '3'
    || (!PROT97.has(note.ufEmitente) && !(PROT41.has(note.ufEmitente) && !EXCEPT41.has(cest)))) return null;
  const evidence = item.stXml;
  if (!evidence || evidence.cfop !== '6403' || !/^[26]403$/.test(item.cfop)
    || item.cstIcms !== '10' || evidence.modalidade !== '4'
    || !(evidence.valor > 0 && evidence.base > 0)
    || !near(evidence.aliquota, 20.5) || !near(percent(aDst), 20.5)
    || !near(percent(originalAOri), percent(aOri))
    || !item.descricaoConfiavel || !item.descricao.trim()) return null;
  if (cest === '0199900' && !(ncm === '73181500'
    && /\bPARAFUSO\b/.test(normalizeDescription(item.descricao))
    && /\bAUTO\s*PECAS\b/.test(normalizeDescription(String(note.rawMetadata.emit_nome ?? '')))
    && /\bAUTO\s*PECAS\b/.test(normalizeDescription(context.empresa.razao_social)))) return null;
  // Não suplantar uma entrada distinta do Anexo.
  if (context.mva_anexo.some(row=>!row.autopecas && !!row.ncm && ncm.startsWith(digits(row.ncm))
    && (row.cest??[]).some(c=>digits(c)===cest))) return null;
  const expected = autopecasMvaSuggestions(context,note,item,column,originalAOri).find(x=>x.label==='demais')?.value;
  return expected != null && near(evidence.mva, expected) ? expected : null;
}
