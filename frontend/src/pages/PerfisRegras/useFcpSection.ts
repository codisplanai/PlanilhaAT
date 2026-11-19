import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { getErrorMessage } from '../../api/client';
import { queryKeys } from '../../api/queryKeys';
import { regrasFcpApi } from '../../api/regrasFcp';
import type {
  ExcecaoFcpCreate,
  PresetBebidasBaResultado,
  RegraFcpCreate,
  RegraFcpUpdate,
} from '../../types/regraFcp';

export function useFcpSection(perfilId?: number) {
  const queryClient = useQueryClient();
  const [erro, setErro] = useState<string | null>(null);
  const [presetResultado, setPresetResultado] = useState<PresetBebidasBaResultado | null>(null);

  useEffect(() => {
    setErro(null);
    setPresetResultado(null);
  }, [perfilId]);

  const invalidar = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.regrasFcp(perfilId) });
  };

  const extrairErro = (e: unknown) => {
    setErro(getErrorMessage(e));
  };

  const regras = useQuery({
    queryKey: queryKeys.regrasFcp(perfilId),
    queryFn: () => regrasFcpApi.listar({ perfil_id: perfilId }),
    enabled: typeof perfilId === 'number',
  });

  const criarRegra = useMutation({
    mutationFn: (payload: RegraFcpCreate) => regrasFcpApi.criar(payload),
    onSuccess: () => {
      setErro(null);
      invalidar();
    },
    onError: extrairErro,
  });

  const atualizarRegra = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: RegraFcpUpdate }) =>
      regrasFcpApi.atualizar(id, payload),
    onSuccess: () => {
      setErro(null);
      invalidar();
    },
    onError: extrairErro,
  });

  const deletarRegra = useMutation({
    mutationFn: (id: number) => regrasFcpApi.deletar(id),
    onSuccess: () => {
      setErro(null);
      invalidar();
    },
    onError: extrairErro,
  });

  const criarExcecao = useMutation({
    mutationFn: ({ regraId, payload }: { regraId: number; payload: ExcecaoFcpCreate }) =>
      regrasFcpApi.criarExcecao(regraId, payload),
    onSuccess: () => {
      setErro(null);
      invalidar();
    },
    onError: extrairErro,
  });

  const deletarExcecao = useMutation({
    mutationFn: ({ regraId, excecaoId }: { regraId: number; excecaoId: number }) =>
      regrasFcpApi.deletarExcecao(regraId, excecaoId),
    onSuccess: () => {
      setErro(null);
      invalidar();
    },
    onError: extrairErro,
  });

  const carregarPresetBebidasBa = useMutation({
    mutationFn: (pid: number) => regrasFcpApi.carregarPresetBebidasBa(pid),
    onSuccess: (data) => {
      setErro(null);
      setPresetResultado(data);
      void queryClient.invalidateQueries({ queryKey: queryKeys.regrasFcp(perfilId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.regrasAliquotas(perfilId) });
    },
    onError: extrairErro,
  });

  return {
    regras,
    criarRegra,
    atualizarRegra,
    deletarRegra,
    criarExcecao,
    deletarExcecao,
    carregarPresetBebidasBa,
    erro,
    setErro,
    presetResultado,
    setPresetResultado,
  };
}
