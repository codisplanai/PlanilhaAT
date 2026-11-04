import type { NotaBonificacaoPendencia } from '../types/solicitacao';

/**
 * Decisões iniciais do diálogo de bonificação (true = não é uso/consumo).
 *
 * No comércio, o crédito de ICMS sugere revenda. Na indústria o crédito não diz
 * se a mercadoria é de uso/consumo, e "Ignorar" perderia a DIFAL: todas começam
 * como uso/consumo e o usuário desmarca as que não forem.
 */
export function initialBonusDecisions(
  notas: NotaBonificacaoPendencia[],
  industria: boolean,
): Record<string, boolean> {
  const initial: Record<string, boolean> = {};
  for (const nota of notas) {
    initial[nota.chave_acesso || nota.numero_nota] = industria ? false : nota.sugestao_revenda;
  }
  return initial;
}
