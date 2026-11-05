import type { LocalOutputRow } from '../../types/localProcessing';

const sum = (rows: LocalOutputRow[], field: 'v_total' | 'base_calculo' | 'ipi_despesas'): number =>
  Math.round(rows.reduce((total, row) => total + row[field], 0) * 100) / 100;

/**
 * Uma linha por nota e par de alíquotas (A.ORI, A.DST), com os valores somados.
 * Mesma regra das demais planilhas: só há desdobramento quando a mesma nota tem
 * alíquotas diferentes; a partir do segundo grupo a nota recebe "*".
 * Espelha consolidar_linhas_controle (app/services/pipeline_helpers.py).
 */
export function consolidateControlRows(rows: LocalOutputRow[]): LocalOutputRow[] {
  const groups = new Map<string, LocalOutputRow[]>();
  for (const row of rows) {
    const key = JSON.stringify([
      row.chave_acesso || row.numero_nota, row.serie ?? '', row.cnpj_emitente ?? '', row.a_ori, row.a_dst ?? null,
    ]);
    const group = groups.get(key);
    if (group) group.push(row);
    else groups.set(key, [row]);
  }

  const splitByNote = new Map<string, number>();
  const consolidated: LocalOutputRow[] = [];
  for (const group of groups.values()) {
    const first = group[0];
    const noteKey = JSON.stringify([first.chave_acesso || first.numero_nota, first.serie ?? '', first.cnpj_emitente ?? '']);
    const index = (splitByNote.get(noteKey) ?? 0) + 1;
    splitByNote.set(noteKey, index);
    consolidated.push({
      ...first,
      v_total: sum(group, 'v_total'),
      base_calculo: sum(group, 'base_calculo'),
      ipi_despesas: sum(group, 'ipi_despesas'),
      data_entrada: group.find((row) => row.data_entrada)?.data_entrada ?? null,
      item_numero: index,
      numero_nota: index > 1 ? `${first.numero_nota}*` : first.numero_nota,
      descricao: group.length > 1 ? `NF-e ${first.numero_nota} (${group.length} itens)` : first.descricao,
    });
  }
  return consolidated;
}
