import type { LocalOutputRow } from '../../types/localProcessing';

/**
 * Mantém a data de entrada como critério principal e o número da NF como
 * segundo critério (numérico, inclusive quando há desdobramento com '*').
 * Na ausência de entrada, usa SOMENTE o dia da emissão para ordenar.
 * Não altera a data de entrada registrada nem o conteúdo do modelo Excel.
 */
export function sortRowsByEntryAndNumber(rows: LocalOutputRow[]): void {
  rows.sort((a, b) => {
    const aDay = (a.data_entrada || a.data_emissao).slice(0, 10);
    const bDay = (b.data_entrada || b.data_emissao).slice(0, 10);
    if (aDay !== bDay) return aDay.localeCompare(bDay);

    const aNumber = Number(a.numero_nota.replace(/\D/g, '')) || 0;
    const bNumber = Number(b.numero_nota.replace(/\D/g, '')) || 0;
    if (aNumber !== bNumber) return aNumber - bNumber;

    // Critérios estáveis apenas quando dia e número são iguais.
    return a.data_emissao.localeCompare(b.data_emissao)
      || String(a.chave_acesso ?? '').localeCompare(String(b.chave_acesso ?? ''))
      || a.item_numero - b.item_numero;
  });
}
