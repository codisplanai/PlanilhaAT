import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { getErrorMessage } from '../../api/client';
import { queryKeys } from '../../api/queryKeys';
import { usuariosApi } from '../../api/usuarios';
import type { Usuario } from '../../types/usuario';

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

  const usersQuery = useQuery({
    queryKey: queryKeys.usuarios,
    queryFn: usuariosApi.listar,
  });

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

  return {
    usuarios: usersQuery.data ?? [],
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
    register: form.register,
    control: form.control,
    errors: form.formState.errors,
    isSaving: createMutation.isPending,
  };
}
