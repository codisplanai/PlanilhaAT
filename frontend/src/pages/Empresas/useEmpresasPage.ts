import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { getErrorMessage } from '../../api/client';
import { empresasApi } from '../../api/empresas';
import { queryKeys } from '../../api/queryKeys';
import { formatCNPJ } from '../../lib/formatters';
import type { Empresa, EmpresaCreate } from '../../types/empresa';
import { useEmpresasQuery, usePerfisQuery } from '../../hooks/useApiQueries';

const empresaSchema = z.object({
  razao_social: z.string().min(2, 'Razão Social deve ter pelo menos 2 caracteres'),
  cnpj: z
    .string()
    .min(14, 'CNPJ deve conter 14 dígitos')
    .refine(
      (value) => value.replace(/\D/g, '').length === 14,
      'CNPJ deve ter exatamente 14 dígitos numéricos',
    ),
  inscricao_estadual: z.string().optional(),
  uf: z.string().length(2, 'Selecione o estado (UF)'),
  perfil_regras_id: z.number().min(1, 'Selecione um perfil de regras'),
  optante_simples_nacional: z.boolean(),
  ativo: z.boolean(),
});

type EmpresaFormData = z.infer<typeof empresaSchema>;

const EMPTY_FORM: EmpresaFormData = {
  razao_social: '',
  cnpj: '',
  inscricao_estadual: '',
  uf: 'BA',
  perfil_regras_id: 1,
  optante_simples_nacional: false,
  ativo: true,
};

export function useEmpresasPage() {
  const queryClient = useQueryClient();
  const [searchTerm, setSearchTerm] = useState('');
  const [ufFilter, setUfFilter] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingEmpresa, setEditingEmpresa] = useState<Empresa | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [empresaParaExcluir, setEmpresaParaExcluir] = useState<Empresa | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [termoParaRemover, setTermoParaRemover] = useState<Empresa | null>(null);
  const [removerTermoError, setRemoverTermoError] = useState<string | null>(null);

  const empresasQuery = useEmpresasQuery();
  const perfisQuery = usePerfisQuery();
  const empresas = empresasQuery.data ?? [];
  const perfis = perfisQuery.data ?? [];

  const form = useForm<EmpresaFormData>({
    resolver: zodResolver(empresaSchema),
    defaultValues: EMPTY_FORM,
  });

  const closeModal = () => {
    setModalOpen(false);
    setEditingEmpresa(null);
    setErrorMessage(null);
  };

  const mutationCallbacks = {
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.empresas });
      closeModal();
    },
    onError: (error: unknown) => setErrorMessage(getErrorMessage(error)),
  };

  const createMutation = useMutation({
    mutationFn: (payload: EmpresaCreate) => empresasApi.criar(payload),
    ...mutationCallbacks,
  });
  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: EmpresaCreate }) =>
      empresasApi.atualizar(id, payload),
    ...mutationCallbacks,
  });
  const deleteMutation = useMutation({
    mutationFn: (id: number) => empresasApi.deletar(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.empresas });
      setEmpresaParaExcluir(null);
      setDeleteError(null);
    },
    onError: (error) => setDeleteError(getErrorMessage(error)),
  });

  const definirTermoAcordo = useMutation({
    mutationFn: ({
      empresaId,
      aliquota,
      descricao,
    }: {
      empresaId: number;
      aliquota: number;
      descricao?: string | null;
    }) => empresasApi.definirTermoAcordo(empresaId, { aliquota, descricao }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.empresas });
    },
  });

  const removerTermoAcordo = useMutation({
    mutationFn: (empresaId: number) => empresasApi.removerTermoAcordo(empresaId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.empresas });
      setTermoParaRemover(null);
      setRemoverTermoError(null);
    },
    onError: (error) => setRemoverTermoError(getErrorMessage(error)),
  });

  const openCreateModal = () => {
    setEditingEmpresa(null);
    setErrorMessage(null);
    form.reset({ ...EMPTY_FORM, perfil_regras_id: perfis[0]?.id || 1 });
    setModalOpen(true);
  };

  const openEditModal = (empresa: Empresa) => {
    setEditingEmpresa(empresa);
    setErrorMessage(null);
    form.reset({
      razao_social: empresa.razao_social,
      cnpj: formatCNPJ(empresa.cnpj),
      inscricao_estadual: empresa.inscricao_estadual || '',
      uf: empresa.uf,
      perfil_regras_id: empresa.perfil_regras_id,
      optante_simples_nacional: Boolean(empresa.optante_simples_nacional),
      ativo: empresa.ativo,
    });
    setModalOpen(true);
  };

  const saveEmpresa = form.handleSubmit(async (data) => {
    setErrorMessage(null);
    const payload: EmpresaCreate = {
      razao_social: data.razao_social.trim(),
      cnpj: data.cnpj.replace(/\D/g, ''),
      inscricao_estadual:
        data.inscricao_estadual?.trim() || (editingEmpresa ? null : undefined),
      uf: data.uf,
      perfil_regras_id: Number(data.perfil_regras_id),
      optante_simples_nacional: Boolean(data.optante_simples_nacional),
      ativo: data.ativo,
    };
    try {
      if (editingEmpresa) {
        await updateMutation.mutateAsync({ id: editingEmpresa.id, payload });
      } else {
        await createMutation.mutateAsync(payload);
      }
    } catch {
      // A mutation mantém o erro visível no modal.
    }
  });

  const requestDeleteEmpresa = (empresa: Empresa) => {
    setDeleteError(null);
    setEmpresaParaExcluir(empresa);
  };

  const confirmDeleteEmpresa = () => {
    if (empresaParaExcluir) {
      deleteMutation.mutate(empresaParaExcluir.id);
    }
  };

  const cancelDeleteEmpresa = () => {
    setEmpresaParaExcluir(null);
    setDeleteError(null);
  };

  const requestRemoverTermo = (empresa: Empresa) => {
    setRemoverTermoError(null);
    setTermoParaRemover(empresa);
  };

  const confirmRemoverTermo = () => {
    if (termoParaRemover) {
      removerTermoAcordo.mutate(termoParaRemover.id);
    }
  };

  const cancelRemoverTermo = () => {
    setTermoParaRemover(null);
    setRemoverTermoError(null);
  };

  const filteredEmpresas = empresas.filter((empresa) => {
    const search = searchTerm.toLowerCase();
    const digits = search.replace(/\D/g, '');
    const matchesSearch =
      empresa.razao_social.toLowerCase().includes(search)
      || (digits.length > 0 && empresa.cnpj.includes(digits))
      || empresa.uf.toLowerCase().includes(search);
    return matchesSearch && (!ufFilter || empresa.uf === ufFilter);
  });

  const getPerfilNome = (id: number) =>
    perfis.find((perfil) => perfil.id === id)?.nome || `Perfil #${id}`;

  return {
    empresasQuery,
    perfisQuery,
    perfis,
    filteredEmpresas,
    getPerfilNome,
    searchTerm,
    setSearchTerm,
    ufFilter,
    setUfFilter,
    modalOpen,
    editingEmpresa,
    errorMessage,
    setErrorMessage,
    empresaParaExcluir,
    deleteError,
    setDeleteError,
    termoParaRemover,
    removerTermoError,
    setRemoverTermoError,
    requestDeleteEmpresa,
    confirmDeleteEmpresa,
    cancelDeleteEmpresa,
    isDeletingEmpresa: deleteMutation.isPending,
    requestRemoverTermo,
    confirmRemoverTermo,
    cancelRemoverTermo,
    isRemovendoTermo: removerTermoAcordo.isPending,
    openCreateModal,
    openEditModal,
    closeModal,
    saveEmpresa,
    definirTermoAcordo,
    removerTermoAcordo,
    register: form.register,
    errors: form.formState.errors,
    isSaving:
      form.formState.isSubmitting
      || createMutation.isPending
      || updateMutation.isPending,
  };
}
