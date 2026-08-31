export const queryKeys = {
  empresas: ['empresas'] as const,
  perfis: ['perfis-regras'] as const,
  templates: ['templates'] as const,
  solicitacoes: (empresaId?: number, status?: string) =>
    ['solicitacoes', empresaId, status ?? ''] as const,
  solicitacao: (id: string | null) => ['solicitacao', id] as const,
  regrasAliquotas: (perfilId?: number) => ['regras-aliquotas', perfilId] as const,
  regrasCfopEfetivas: (perfilId?: number) => ['regras-cfop-efetivas', perfilId] as const,
};
