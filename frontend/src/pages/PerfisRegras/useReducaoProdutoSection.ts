import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { regrasReducaoApi } from '../../api/regrasReducao';
import { queryKeys } from '../../api/queryKeys';
import type { ExcecaoReducaoCreate, RegraReducaoCreate } from '../../types/regraReducao';

export function useReducaoProdutoSection(perfilId?: number) {
  const queryClient = useQueryClient();
  const [erro, setErro] = useState<string | null>(null);

  const invalidar = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.regrasReducaoProduto(perfilId) });
  };

  const extrairErro = (e: unknown) => {
    const detail = (e as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
    setErro(typeof detail === 'string' ? detail : 'Não foi possível concluir a operação.');
  };

  const regras = useQuery({
    queryKey: queryKeys.regrasReducaoProduto(perfilId),
    queryFn: () => regrasReducaoApi.listar({ perfil_id: perfilId }),
    enabled: typeof perfilId === 'number',
  });

  const criarRegra = useMutation({
    mutationFn: (payload: RegraReducaoCreate) => regrasReducaoApi.criar(payload),
    onSuccess: () => { setErro(null); invalidar(); },
    onError: extrairErro,
  });

  const deletarRegra = useMutation({
    mutationFn: (id: number) => regrasReducaoApi.deletar(id),
    onSuccess: () => { setErro(null); invalidar(); },
    onError: extrairErro,
  });

  const criarExcecao = useMutation({
    mutationFn: ({ regraId, payload }: { regraId: number; payload: ExcecaoReducaoCreate }) =>
      regrasReducaoApi.criarExcecao(regraId, payload),
    onSuccess: () => { setErro(null); invalidar(); },
    onError: extrairErro,
  });

  const deletarExcecao = useMutation({
    mutationFn: ({ regraId, excecaoId }: { regraId: number; excecaoId: number }) =>
      regrasReducaoApi.deletarExcecao(regraId, excecaoId),
    onSuccess: () => { setErro(null); invalidar(); },
    onError: extrairErro,
  });

  return { regras, criarRegra, deletarRegra, criarExcecao, deletarExcecao, erro, setErro };
}
