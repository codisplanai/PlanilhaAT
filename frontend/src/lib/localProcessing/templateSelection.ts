import type { LocalTemplateDescriptor } from '../../types/localProcessing';
import type { TipoPlanilha } from '../../types/solicitacao';

export function selectTemplateForRows(
  templates: LocalTemplateDescriptor[],
  tipo: TipoPlanilha,
  requiredRows: number,
): LocalTemplateDescriptor | null {
  if (!Number.isInteger(requiredRows) || requiredRows < 1) {
    throw new Error('A quantidade de linhas necessária deve ser maior ou igual a 1.');
  }

  const candidates = templates.filter((template) => template.tipo === tipo);
  const capacityTemplates = candidates
    .filter(
      (template) =>
        typeof template.capacidade_linhas === 'number'
        && Number.isInteger(template.capacidade_linhas)
        && template.capacidade_linhas > 0,
    )
    .sort((a, b) => {
      const capacityDiff = Number(a.capacidade_linhas) - Number(b.capacidade_linhas);
      return capacityDiff || b.versao - a.versao;
    });

  if (capacityTemplates.length > 0) {
    const selected = capacityTemplates.find(
      (template) => Number(template.capacidade_linhas) >= requiredRows,
    );
    if (selected) return selected;

    const maxCapacity = Number(capacityTemplates[capacityTemplates.length - 1].capacidade_linhas);
    throw new Error(
      `O processamento de ${tipo} necessita de ${requiredRows} linhas, mas o maior modelo oficial cadastrado suporta ${maxCapacity} linhas. `
      + `Cadastre um modelo com capacidade igual ou superior a ${requiredRows}.`,
    );
  }

  return candidates
    .filter((template) => template.capacidade_linhas == null)
    .sort((a, b) => b.versao - a.versao)[0] ?? null;
}
