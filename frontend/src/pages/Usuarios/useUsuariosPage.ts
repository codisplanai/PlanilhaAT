import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { getErrorMessage } from '../../api/client';
import { queryKeys } from '../../api/queryKeys';
import { usuariosApi } from '../../api/usuarios';
import { useUsuariosQuery } from '../../hooks/useApiQueries';
import type { Usuario } from '../../types/usuario';

export type StatusFiltro = 'todas' | 'ativas' | 'inativas';

const usuarioSchema = z.object({
  nome: z.string().min(1, 'Informe o nome').max(255, 'Nome muito longo'),
  email: z.string().min(1, 'Informe o e-mail').email('Formato de e-mail inválido'),
  password: z.string().min(8, 'A senha deve ter ao menos 8 caracteres'),
  role: z.enum(['operador', 'admin']),
});

type UsuarioFormData = z.infer<typeof usuarioSchema>;

const EMPTY_USER: UsuarioFormData = {
  nome: '',
  email: '',
  password: '',
  role: 'operador',
};

export function useUsuariosPage() {
  const queryClient = useQueryClient();
  const [pageError, setPageError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const form = useForm<UsuarioFormData>({
    resolver: zodResolver(usuarioSchema),
    defaultValues: EMPTY_USER,
  });

  const [statusFiltro, setStatusFiltro] = useState<StatusFiltro>('todas');
  const [busca, setBusca] = useState('');
  // Desativar uma conta tira o acesso de alguém: pede confirmação. Reativar não.
  const [usuarioParaDesativar, setUsuarioParaDesativar] = useState<Usuario | null>(null);
  const [usuarioParaExcluir, setUsuarioParaExcluir] = useState<Usuario | null>(null);

  const usersQuery = useUsuariosQuery();
  const usuarios = useMemo(() => usersQuery.data ?? [], [usersQuery.data]);

  const contagens = useMemo(
    () => ({
      todas: usuarios.length,
      ativas: usuarios.filter((u) => u.ativo).length,
      inativas: usuarios.filter((u) => !u.ativo).length,
    }),
    [usuarios],
  );

  const usuariosVisiveis = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return usuarios.filter((u) => {
      if (statusFiltro === 'ativas' && !u.ativo) return false;
      if (statusFiltro === 'inativas' && u.ativo) return false;
      if (!termo) return true;
      return (
        u.nome.toLowerCase().includes(termo)
        || u.email.toLowerCase().includes(termo)
        || (u.cargo || '').toLowerCase().includes(termo)
      );
    });
  }, [usuarios, statusFiltro, busca]);

  const createMutation = useMutation({
    mutationFn: usuariosApi.criar,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.usuarios });
      closeModal();
    },
    onError: (error) => setFormError(getErrorMessage(error)),
  });

  const [togglingUserId, setTogglingUserId] = useState<string | null>(null);

  const statusMutation = useMutation({
    mutationFn: ({ id, ativo }: { id: string; ativo: boolean }) => {
      setTogglingUserId(id);
      return usuariosApi.alterarStatus(id, ativo);
    },
    onSettled: () => setTogglingUserId(null),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.usuarios }),
    onError: (error) => setPageError(getErrorMessage(error)),
  });

  const [deletingUserId, setDeletingUserId] = useState<string | null>(null);

  const deleteMutation = useMutation({
    mutationFn: (id: string) => {
      setDeletingUserId(id);
      return usuariosApi.excluir(id);
    },
    onSettled: () => setDeletingUserId(null),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.usuarios }),
    onError: (error) => setPageError(getErrorMessage(error)),
  });

  function openModal() {
    setFormError(null);
    form.reset(EMPTY_USER);
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
    setFormError(null);
    form.reset(EMPTY_USER);
  }

  const createUser = form.handleSubmit(async (data) => {
    setFormError(null);
    try {
      await createMutation.mutateAsync(data);
    } catch {
      // A mutation mantém o erro visível no modal.
    }
  });

  const toggleStatus = (user: Usuario) => {
    setPageError(null);
    statusMutation.mutate({ id: user.id, ativo: !user.ativo });
  };

  /** ``onDone`` fecha a confirmação em qualquer desfecho: com erro, o alerta da
   *  página precisa ficar visível, e o modal o cobriria. */
  const deleteUser = (user: Usuario, onDone?: () => void) => {
    setPageError(null);
    deleteMutation.mutate(user.id, { onSettled: () => onDone?.() });
  };

  const pedirAlteracaoDeStatus = (u: Usuario) => {
    if (u.ativo) {
      setUsuarioParaDesativar(u);
      return;
    }
    toggleStatus(u);
  };

  const confirmarDesativacao = () => {
    if (usuarioParaDesativar) toggleStatus(usuarioParaDesativar);
    setUsuarioParaDesativar(null);
  };

  const confirmarExclusao = () => {
    if (usuarioParaExcluir) {
      deleteUser(usuarioParaExcluir, () => setUsuarioParaExcluir(null));
    }
  };

  return {
    usuarios,
    isLoading: usersQuery.isLoading,
    refetch: usersQuery.refetch,
    pageError: pageError || (usersQuery.error ? getErrorMessage(usersQuery.error) : null),
    setPageError,
    formError,
    setFormError,
    modalOpen,
    openModal,
    closeModal,
    createUser,
    toggleStatus,
    togglingUserId,
    deleteUser,
    deletingUserId,
    statusFiltro,
    setStatusFiltro,
    busca,
    setBusca,
    contagens,
    usuariosVisiveis,
    usuarioParaDesativar,
    setUsuarioParaDesativar,
    usuarioParaExcluir,
    setUsuarioParaExcluir,
    pedirAlteracaoDeStatus,
    confirmarDesativacao,
    confirmarExclusao,
    register: form.register,
    control: form.control,
    errors: form.formState.errors,
    isSaving: createMutation.isPending,
  };
}
