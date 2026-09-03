import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { regrasReclassificacaoCfopApi } from '../../api/regrasReclassificacaoCfop';
import { queryKeys } from '../../api/queryKeys';
import type {
  ExcecaoReclassificacaoCfopCreate,
  RegraReclassificacaoCfopCreate,
} from '../../types/regraReclassificacaoCfop';

export function useReclassificacaoCfopSection(perfilId?: number) {
  const queryClient = useQueryClient();
  const [erro, setErro] = useState<string | null>(null);

  const invalidar = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.regrasReclassificacaoCfop(perfilId) });
  };

  const extrairErro = (e: unknown) => {
    const detail = (e as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
    setErro(typeof detail === 'string' ? detail : 'Não foi possível concluir a operação.');
  };

  const regras = useQuery({
    queryKey: queryKeys.regrasReclassificacaoCfop(perfilId),
    queryFn: () => regrasReclassificacaoCfopApi.listar({ perfil_id: perfilId }),
    enabled: typeof perfilId === 'number',
  });

  const criarRegra = useMutation({
    mutationFn: (payload: RegraReclassificacaoCfopCreate) =>
      regrasReclassificacaoCfopApi.criar(payload),
    onSuccess: () => {
      setErro(null);
      invalidar();
    },
    onError: extrairErro,
  });

  const deletarRegra = useMutation({
    mutationFn: (id: number) => regrasReclassificacaoCfopApi.deletar(id),
    onSuccess: () => {
      setErro(null);
      invalidar();
    },
    onError: extrairErro,
  });

  const criarExcecao = useMutation({
    mutationFn: ({
      regraId,
      payload,
    }: {
      regraId: number;
      payload: ExcecaoReclassificacaoCfopCreate;
    }) => regrasReclassificacaoCfopApi.criarExcecao(regraId, payload),
    onSuccess: () => {
      setErro(null);
      invalidar();
    },
    onError: extrairErro,
  });

  const deletarExcecao = useMutation({
    mutationFn: ({ regraId, excecaoId }: { regraId: number; excecaoId: number }) =>
      regrasReclassificacaoCfopApi.deletarExcecao(regraId, excecaoId),
    onSuccess: () => {
      setErro(null);
      invalidar();
    },
    onError: extrairErro,
  });

  return {
    regras,
    criarRegra,
    deletarRegra,
    criarExcecao,
    deletarExcecao,
    erro,
    setErro,
  };
}
