import { useQuery } from '@tanstack/react-query';

import { empresasApi } from '../api/empresas';
import { perfisApi } from '../api/perfis';
import { queryKeys } from '../api/queryKeys';
import { solicitacoesApi } from '../api/solicitacoes';
import { templatesApi } from '../api/templates';
import { usuariosApi } from '../api/usuarios';

export function useEmpresasQuery() {
  return useQuery({
    queryKey: queryKeys.empresas,
    queryFn: () => empresasApi.listar(),
  });
}

export function usePerfisQuery() {
  return useQuery({
    queryKey: queryKeys.perfis,
    queryFn: () => perfisApi.listar(),
  });
}

export function useTemplatesQuery() {
  return useQuery({
    queryKey: queryKeys.templates,
    queryFn: () => templatesApi.listar(),
  });
}

export function useSolicitacoesQuery(empresaId?: number, status?: string, usuarioId?: string) {
  return useQuery({
    queryKey: queryKeys.solicitacoes(empresaId, status, usuarioId),
    queryFn: () =>
      solicitacoesApi.listar({
        empresa_id: empresaId,
        status_filter: status || undefined,
        usuario_id: usuarioId || undefined,
      }),
  });
}

export function useUsuariosQuery(enabled = true) {
  return useQuery({
    queryKey: queryKeys.usuarios,
    queryFn: () => usuariosApi.listar(),
    enabled,
  });
}
