import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { regrasExclusaoParcialApi } from '../../api/regrasExclusaoParcial';
import { queryKeys } from '../../api/queryKeys';
import type {
  RegraExclusaoParcialCreate,
  RegraExclusaoParcialUpdate,
} from '../../types/regraExclusaoParcial';

export function useExclusaoParcialSection(perfilId?: number) {
  const queryClient = useQueryClient();
  const [ufSelecionada, setUfSelecionada] = useState<string>('BA');
  const [erro, setErro] = useState<string | null>(null);
  const [sucessoMsg, setSucessoMsg] = useState<string | null>(null);

  const invalidar = () => {
    void queryClient.invalidateQueries({
      queryKey: queryKeys.regrasExclusaoParcial(perfilId, ufSelecionada),
    });
    void queryClient.invalidateQueries({
      queryKey: queryKeys.regrasExclusaoParcial(perfilId),
    });
  };

  const extrairErro = (e: unknown) => {
    const detail = (e as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
    setErro(typeof detail === 'string' ? detail : 'Não foi possível concluir a operação.');
  };

  const regras = useQuery({
    queryKey: queryKeys.regrasExclusaoParcial(perfilId, ufSelecionada),
    queryFn: () =>
      regrasExclusaoParcialApi.listar({
        perfil_id: perfilId,
        uf: ufSelecionada,
      }),
    enabled: typeof perfilId === 'number',
  });

  const criarRegra = useMutation({
    mutationFn: (payload: RegraExclusaoParcialCreate) =>
      regrasExclusaoParcialApi.criar(payload),
    onSuccess: () => {
      setErro(null);
      setSucessoMsg('Regra de exclusão criada com sucesso!');
      invalidar();
    },
    onError: extrairErro,
  });

  const atualizarRegra = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: RegraExclusaoParcialUpdate }) =>
      regrasExclusaoParcialApi.atualizar(id, payload),
    onSuccess: () => {
      setErro(null);
      setSucessoMsg('Regra de exclusão atualizada com sucesso!');
      invalidar();
    },
    onError: extrairErro,
  });

  const deletarRegra = useMutation({
    mutationFn: (id: number) => regrasExclusaoParcialApi.deletar(id),
    onSuccess: () => {
      setErro(null);
      setSucessoMsg('Regra de exclusão removida com sucesso!');
      invalidar();
    },
    onError: extrairErro,
  });

  const carregarPadraoBa = useMutation({
    mutationFn: (pid: number) => regrasExclusaoParcialApi.carregarPadraoBahia(pid),
    onSuccess: (data) => {
      setErro(null);
      setSucessoMsg(
        `Carga concluída: ${data.inseridas} regra(s) nova(s) inserida(s), ${data.existentes} já existente(s). Total: ${data.total} regras para BA.`
      );
      invalidar();
    },
    onError: extrairErro,
  });

  return {
    ufSelecionada,
    setUfSelecionada,
    regras,
    criarRegra,
    atualizarRegra,
    deletarRegra,
    carregarPadraoBa,
    erro,
    setErro,
    sucessoMsg,
    setSucessoMsg,
  };
}
