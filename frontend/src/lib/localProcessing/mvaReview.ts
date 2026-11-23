import type { ExtractedItem, ExtractedNote } from './domain';
import type { MvaDecision } from '../../types/localProcessing';
export function mvaReviewKey(note: ExtractedNote, item: ExtractedItem): string {
  return JSON.stringify([note.chaveAcesso || [note.cnpjEmitente,note.serie,note.numeroNota,note.dataEmissao],item.itemNumero]);
}
export function validMvaDecision(decision: MvaDecision | undefined): decision is MvaDecision {
  return !!decision && typeof decision.justificativa === 'string'
    && decision.justificativa.trim().length >= 5 && decision.justificativa.length <= 500
    && (decision.mva === null || (typeof decision.mva === 'number' && Number.isFinite(decision.mva)
      && decision.mva >= 0 && decision.mva <= 10000));
}
export function manualMvaEngineValue(value: number): number {
  return value <= 1 ? value / 100 : value;
}
