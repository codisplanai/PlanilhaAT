export const queryKeys = {
  empresas: ['empresas'] as const,
  perfis: ['perfis-regras'] as const,
  templates: ['templates'] as const,
  templatesAtivos: ['templates-ativos-resumo'] as const,
  templateSelectionConfigs: ['template-selection-configs'] as const,
  usuarios: ['usuarios'] as const,
  solicitacoesRoot: ['solicitacoes'] as const,
  solicitacoes: (empresaId?: number, status?: string) =>
    ['solicitacoes', empresaId, status ?? ''] as const,
  solicitacao: (id: string | null) => ['solicitacao', id] as const,
  regrasAliquotas: (perfilId?: number) => ['regras-aliquotas', perfilId] as const,
  regrasCfopEfetivas: (perfilId?: number) => ['regras-cfop-efetivas', perfilId] as const,
  regrasReducaoProduto: (perfilId?: number) => ['regras-reducao-produto', perfilId] as const,
  regrasReclassificacaoCfop: (perfilId?: number) => ['regras-reclassificacao-cfop', perfilId] as const,
  regrasExclusaoParcial: (perfilId?: number, uf?: string) =>
    ['regras-exclusao-parcial', perfilId, uf ?? ''] as const,
};
