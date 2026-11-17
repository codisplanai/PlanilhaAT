import type { LocalTemplateDescriptor } from '../../types/localProcessing';
import type { TipoPlanilha } from '../../types/solicitacao';

interface ScopeSelection {
  selected: LocalTemplateDescriptor | null;
  maxCapacity: number | null;
}

function selectFromScope(
  candidates: LocalTemplateDescriptor[],
  requiredCapacity: number,
): ScopeSelection {
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
    const maxCapacity = Number(capacityTemplates[capacityTemplates.length - 1].capacidade_linhas);
    const selected = capacityTemplates.find(
      (template) => Number(template.capacidade_linhas) >= requiredCapacity,
    ) ?? null;
    return { selected, maxCapacity };
  }

  const legacy = candidates
    .filter((template) => template.capacidade_linhas == null)
    .sort((a, b) => b.versao - a.versao)[0] ?? null;
  return { selected: legacy, maxCapacity: null };
}

export function selectTemplateForRows(
  templates: LocalTemplateDescriptor[],
  tipo: TipoPlanilha,
  requiredRows: number,
  safetyMargin = 0,
  empresaId?: number | null,
): LocalTemplateDescriptor | null {
  if (!Number.isInteger(requiredRows) || requiredRows < 1) {
    throw new Error('A quantidade de linhas necessária deve ser maior ou igual a 1.');
  }
  if (!Number.isInteger(safetyMargin) || safetyMargin < 0) {
    throw new Error('A margem de segurança deve ser um número inteiro maior ou igual a 0.');
  }

  const requiredCapacity = requiredRows + safetyMargin;
  const ofType = templates.filter((template) => template.tipo === tipo);
  const companyCandidates = ofType.filter((template) =>
    template.empresa_id != null && (empresaId == null || template.empresa_id === empresaId),
  );
  const globalCandidates = ofType.filter((template) => template.empresa_id == null);

  let companyMaxCapacity: number | null = null;
  if (companyCandidates.length > 0) {
    const companyResult = selectFromScope(companyCandidates, requiredCapacity);
    if (companyResult.selected) return companyResult.selected;
    companyMaxCapacity = companyResult.maxCapacity;
  }

  const globalResult = selectFromScope(globalCandidates, requiredCapacity);
  if (globalResult.selected) return globalResult.selected;

  const availableCaps = [companyMaxCapacity, globalResult.maxCapacity].filter(
    (cap): cap is number => cap !== null,
  );
  if (availableCaps.length > 0) {
    const maxCapacity = Math.max(...availableCaps);
    const marginDetail = safetyMargin > 0
      ? ` + ${safetyMargin} linhas de segurança = ${requiredCapacity}`
      : '';
    throw new Error(
      `O processamento de ${tipo} necessita de ${requiredRows} linhas${marginDetail}, mas o maior modelo oficial cadastrado suporta ${maxCapacity} linhas. `
      + `Cadastre um modelo com capacidade igual ou superior a ${requiredCapacity}.`,
    );
  }

  return null;
}
