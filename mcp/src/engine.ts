/**
 * Ponte para o motor fiscal local do site.
 *
 * O MCP não tem um motor próprio: importa o mesmo código que o navegador roda
 * em `frontend/src/lib/localProcessing`. Assim a planilha gerada pela IA sai
 * idêntica à gerada no site, e qualquer correção fiscal no motor vale para os
 * dois caminhos sem duplicação.
 */
export { processFiscalLocally } from '../../frontend/src/lib/localProcessing/processor.ts';
export {
  fillAndReorderEntryDatesInXlsx,
  loadEntryDateIndex,
} from '../../frontend/src/lib/localProcessing/entryDateFiller.ts';

export type {
  LocalProcessingContext,
  LocalProcessingRequest,
  LocalProcessingResult,
  LocalTemplateDescriptor,
  MvaDecision,
  MvaPending,
  UsoConsumoPending,
} from '../../frontend/src/types/localProcessing.ts';
export type {
  Convenio5291Decision,
  Convenio5291Pendencia,
  CteSemNfePendencia,
  NotaBonificacaoPendencia,
  Solicitacao,
  TipoPlanilha,
} from '../../frontend/src/types/solicitacao.ts';
export type { EntryDateFillFileResult } from '../../frontend/src/lib/localProcessing/entryDateFiller.ts';
