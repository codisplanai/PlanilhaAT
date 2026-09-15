import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { getErrorMessage } from '../../api/client';
import { perfisApi } from '../../api/perfis';
import { queryKeys } from '../../api/queryKeys';
import { regrasApi } from '../../api/regras';
import { regrasCfopApi } from '../../api/regrasCfop';
import { usePerfisQuery } from '../../hooks/useApiQueries';
import type { PerfilRegras, PerfilRegrasCreate } from '../../types/perfil';
import type { RegraAliquota, RegraAliquotaCreate } from '../../types/regra';
import type { RegraCfopCreate, RegraCfopEfetiva } from '../../types/regraCfop';

const perfilSchema = z.object({
  nome: z.string().min(2, 'Informe o nome do perfil'),
  descricao: z.string().optional(),
  limitar_a_ori_reducoes: z.boolean().optional(),
});

const regraSchema = z.object({
  uf: z.string().length(2, 'Selecione a UF'),
  tipo_regra: z.enum(['padrao', 'excecao']),
  ncm: z.string().optional(),
  aliquota: z.number().min(0, 'Alíquota deve ser positiva').max(100, 'Alíquota máxima de 100%'),
  descricao: z.string().optional(),
}).refine(
  (data) => data.tipo_regra !== 'excecao' || (data.ncm?.replace(/\D/g, '').length === 8),
  {
    message: 'Para regra de exceção, informe um NCM válido de 8 dígitos',
    path: ['ncm'],
  },
);

const regraCfopSchema = z.object({
  cfop_sufixo: z.string().regex(
    /^\d{3,4}$/,
    'Informe os 3 últimos dígitos do CFOP (ex: 102) ou o CFOP completo (ex: 6102)',
  ),
  destino: z.enum(['antecipacao_parcial', 'antecipacao_tributaria', 'difal', 'ignorar']),
  descricao: z.string().optional(),
});

type PerfilFormData = z.infer<typeof perfilSchema>;
type RegraFormData = z.infer<typeof regraSchema>;
type RegraCfopFormData = z.infer<typeof regraCfopSchema>;

export function usePerfisRegrasPage() {
  const queryClient = useQueryClient();
  const [selectedPerfilId, setSelectedPerfilId] = useState<number | null>(null);
  const [perfilModalOpen, setPerfilModalOpen] = useState(false);
  const [editingPerfil, setEditingPerfil] = useState<PerfilRegras | null>(null);
  const [regraModalOpen, setRegraModalOpen] = useState(false);
  const [editingRegra, setEditingRegra] = useState<RegraAliquota | null>(null);
  const [regraCfopModalOpen, setRegraCfopModalOpen] = useState(false);
  const [editingRegraCfop, setEditingRegraCfop] = useState<RegraCfopEfetiva | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [perfilParaExcluir, setPerfilParaExcluir] = useState<PerfilRegras | null>(null);
  const [regraParaExcluir, setRegraParaExcluir] = useState<RegraAliquota | null>(null);
  const [regraCfopParaExcluir, setRegraCfopParaExcluir] = useState<RegraCfopEfetiva | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [aOriFeedback, setAOriFeedback] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [aOriError, setAOriError] = useState<string | null>(null);

  const perfisQuery = usePerfisQuery();
  const perfis = perfisQuery.data ?? [];
  const activePerfil = perfis.find((perfil) => perfil.id === selectedPerfilId) || perfis[0] || null;
  const regrasQuery = useQuery({
    queryKey: queryKeys.regrasAliquotas(activePerfil?.id),
    queryFn: () => regrasApi.listar({ perfil_id: activePerfil!.id }),
    enabled: Boolean(activePerfil),
  });
  const regrasCfopQuery = useQuery({
    queryKey: queryKeys.regrasCfopEfetivas(activePerfil?.id),
    queryFn: () => regrasCfopApi.listarEfetivas(activePerfil!.id),
    enabled: Boolean(activePerfil),
  });

  const perfilForm = useForm<PerfilFormData>({ resolver: zodResolver(perfilSchema) });
  const regraForm = useForm<RegraFormData>({
    resolver: zodResolver(regraSchema),
    defaultValues: { uf: 'BA', tipo_regra: 'padrao', ncm: '', aliquota: 20.5, descricao: '' },
  });
  const regraCfopForm = useForm<RegraCfopFormData>({
    resolver: zodResolver(regraCfopSchema),
    defaultValues: { cfop_sufixo: '', destino: 'antecipacao_parcial', descricao: '' },
  });

  const invalidatePerfis = () => queryClient.invalidateQueries({ queryKey: queryKeys.perfis });
  const invalidateRegras = () => queryClient.invalidateQueries({
    queryKey: queryKeys.regrasAliquotas(activePerfil?.id),
  });
  const invalidateRegrasCfop = () => queryClient.invalidateQueries({
    queryKey: queryKeys.regrasCfopEfetivas(activePerfil?.id),
  });
  const mutationError = (error: unknown) => setErrorMessage(getErrorMessage(error));

  const createPerfilMutation = useMutation({
    mutationFn: (payload: PerfilRegrasCreate) => perfisApi.criar(payload),
    onSuccess: async (newPerfil) => {
      await invalidatePerfis();
      setSelectedPerfilId(newPerfil.id);
      setPerfilModalOpen(false);
    },
    onError: mutationError,
  });
  const updatePerfilMutation = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: PerfilRegrasCreate }) =>
      perfisApi.atualizar(id, payload),
    onSuccess: async () => {
      await invalidatePerfis();
      setPerfilModalOpen(false);
    },
    onError: mutationError,
  });
  const deletePerfilMutation = useMutation({
    mutationFn: perfisApi.deletar,
    onSuccess: async () => {
      await invalidatePerfis();
      setSelectedPerfilId(null);
      setPerfilParaExcluir(null);
      setDeleteError(null);
    },
    onError: (error) => setDeleteError(getErrorMessage(error)),
  });

  const createRegraMutation = useMutation({
    mutationFn: (payload: RegraAliquotaCreate) => regrasApi.criar(payload),
    onSuccess: async () => {
      await invalidateRegras();
      setRegraModalOpen(false);
    },
    onError: mutationError,
  });
  const updateRegraMutation = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: RegraAliquotaCreate }) =>
      regrasApi.atualizar(id, payload),
    onSuccess: async () => {
      await invalidateRegras();
      setRegraModalOpen(false);
    },
    onError: mutationError,
  });
  const deleteRegraMutation = useMutation({
    mutationFn: regrasApi.deletar,
    onSuccess: async () => {
      await invalidateRegras();
      setRegraParaExcluir(null);
      setDeleteError(null);
    },
    onError: (error) => setDeleteError(getErrorMessage(error)),
  });

  const createRegraCfopMutation = useMutation({
    mutationFn: (payload: RegraCfopCreate) => regrasCfopApi.criar(payload),
    onSuccess: async () => {
      await invalidateRegrasCfop();
      setRegraCfopModalOpen(false);
    },
    onError: mutationError,
  });
  const updateRegraCfopMutation = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: RegraCfopCreate }) =>
      regrasCfopApi.atualizar(id, payload),
    onSuccess: async () => {
      await invalidateRegrasCfop();
      setRegraCfopModalOpen(false);
    },
    onError: mutationError,
  });
  const deleteRegraCfopMutation = useMutation({
    mutationFn: regrasCfopApi.deletar,
    onSuccess: async () => {
      await invalidateRegrasCfop();
      setRegraCfopParaExcluir(null);
      setDeleteError(null);
    },
    onError: (error) => setDeleteError(getErrorMessage(error)),
  });

  const openCreatePerfil = () => {
    setEditingPerfil(null);
    setErrorMessage(null);
    perfilForm.reset({ nome: '', descricao: '', limitar_a_ori_reducoes: false });
    setPerfilModalOpen(true);
  };
  const openEditPerfil = (perfil: PerfilRegras) => {
    setEditingPerfil(perfil);
    setErrorMessage(null);
    perfilForm.reset({
      nome: perfil.nome,
      descricao: perfil.descricao || '',
      limitar_a_ori_reducoes: Boolean(perfil.configuracoes_extras?.limitar_a_ori_reducoes),
    });
    setPerfilModalOpen(true);
  };
  const submitPerfil = perfilForm.handleSubmit(async (data) => {
    setErrorMessage(null);
    try {
      const payload: PerfilRegrasCreate = {
        nome: data.nome,
        descricao: data.descricao || null,
        configuracoes_extras: {
          ...(editingPerfil?.configuracoes_extras || {}),
          limitar_a_ori_reducoes: Boolean(data.limitar_a_ori_reducoes),
        },
      };
      if (editingPerfil) {
        await updatePerfilMutation.mutateAsync({ id: editingPerfil.id, payload });
      } else {
        await createPerfilMutation.mutateAsync(payload);
      }
    } catch {
      // A mutation mantém o erro visível no modal.
    }
  });

  const toggleLimitarAliquotaOrigem = async (perfil: PerfilRegras) => {
    const current = Boolean(perfil.configuracoes_extras?.limitar_a_ori_reducoes);
    setAOriFeedback('saving');
    setAOriError(null);
    try {
      await updatePerfilMutation.mutateAsync({
        id: perfil.id,
        payload: {
          nome: perfil.nome,
          descricao: perfil.descricao,
          configuracoes_extras: {
            ...(perfil.configuracoes_extras || {}),
            limitar_a_ori_reducoes: !current,
          },
        },
      });
      setAOriFeedback('saved');
      setTimeout(() => {
        setAOriFeedback((prev) => (prev === 'saved' ? 'idle' : prev));
      }, 3000);
    } catch (err) {
      setAOriFeedback('error');
      setAOriError(getErrorMessage(err));
    }
  };

  const confirmDeletePerfil = () => {
    if (perfilParaExcluir) {
      deletePerfilMutation.mutate(perfilParaExcluir.id);
    }
  };

  const cancelDeletePerfil = () => {
    setPerfilParaExcluir(null);
    setDeleteError(null);
  };

  const confirmDeleteRegra = () => {
    if (regraParaExcluir) {
      deleteRegraMutation.mutate(regraParaExcluir.id);
    }
  };

  const cancelDeleteRegra = () => {
    setRegraParaExcluir(null);
    setDeleteError(null);
  };

  const confirmDeleteRegraCfop = () => {
    if (regraCfopParaExcluir) {
      deleteRegraCfopMutation.mutate(regraCfopParaExcluir.regra_id);
    }
  };

  const cancelDeleteRegraCfop = () => {
    setRegraCfopParaExcluir(null);
    setDeleteError(null);
  };

  const openCreateRegra = (tipo: 'padrao' | 'excecao' = 'padrao') => {
    setEditingRegra(null);
    setErrorMessage(null);
    regraForm.reset({ uf: 'BA', tipo_regra: tipo, ncm: '', aliquota: 20.5, descricao: '' });
    setRegraModalOpen(true);
  };
  const openEditRegra = (regra: RegraAliquota) => {
    setEditingRegra(regra);
    setErrorMessage(null);
    regraForm.reset({
      uf: regra.uf,
      tipo_regra: regra.ncm ? 'excecao' : 'padrao',
      ncm: regra.ncm || '',
      aliquota: regra.aliquota <= 1 ? regra.aliquota * 100 : regra.aliquota,
      descricao: regra.descricao || '',
    });
    setRegraModalOpen(true);
  };
  const submitRegra = regraForm.handleSubmit(async (data) => {
    if (!activePerfil) return;
    setErrorMessage(null);
    const cleanNcm = data.tipo_regra === 'excecao' && data.ncm
      ? data.ncm.replace(/\D/g, '')
      : null;
    const payload: RegraAliquotaCreate = {
      perfil_regras_id: activePerfil.id,
      uf: data.uf,
      ncm: cleanNcm,
      aliquota: data.aliquota > 1 ? data.aliquota / 100 : data.aliquota,
      descricao: data.descricao || (cleanNcm
        ? `Exceção NCM ${cleanNcm}`
        : `Alíquota Padrão ${data.uf}`),
    };
    try {
      if (editingRegra) {
        await updateRegraMutation.mutateAsync({ id: editingRegra.id, payload });
      } else {
        await createRegraMutation.mutateAsync(payload);
      }
    } catch {
      // A mutation mantém o erro visível no modal.
    }
  });

  const openCreateRegraCfop = () => {
    setEditingRegraCfop(null);
    setErrorMessage(null);
    regraCfopForm.reset({ cfop_sufixo: '', destino: 'antecipacao_parcial', descricao: '' });
    setRegraCfopModalOpen(true);
  };
  const openEditRegraCfop = (regra: RegraCfopEfetiva) => {
    setEditingRegraCfop(regra);
    setErrorMessage(null);
    regraCfopForm.reset({
      cfop_sufixo: regra.cfop_sufixo,
      destino: regra.destino,
      descricao: regra.descricao || '',
    });
    setRegraCfopModalOpen(true);
  };
  const submitRegraCfop = regraCfopForm.handleSubmit(async (data) => {
    if (!activePerfil) return;
    setErrorMessage(null);
    const payload: RegraCfopCreate = {
      perfil_regras_id: activePerfil.id,
      cfop_sufixo: data.cfop_sufixo,
      destino: data.destino,
      descricao: data.descricao || null,
    };
    try {
      if (editingRegraCfop?.origem === 'perfil') {
        await updateRegraCfopMutation.mutateAsync({ id: editingRegraCfop.regra_id, payload });
      } else {
        await createRegraCfopMutation.mutateAsync(payload);
      }
    } catch {
      // A mutation mantém o erro visível no modal.
    }
  });

  const regras = regrasQuery.data ?? [];
  return {
    perfis,
    perfisQuery,
    activePerfil,
    selectedPerfilId,
    setSelectedPerfilId,
    regrasPadrao: regras.filter((regra) => !regra.ncm),
    regrasExcecao: regras.filter((regra) => Boolean(regra.ncm)),
    regrasQuery,
    isLoadingRegras: regrasQuery.isLoading,
    regrasCfopQuery,
    regrasCfopEfetivas: regrasCfopQuery.data ?? [],
    isLoadingRegrasCfop: regrasCfopQuery.isLoading,
    perfilModalOpen,
    setPerfilModalOpen,
    editingPerfil,
    regraModalOpen,
    setRegraModalOpen,
    editingRegra,
    regraCfopModalOpen,
    setRegraCfopModalOpen,
    editingRegraCfop,
    errorMessage,
    setErrorMessage,
    perfilParaExcluir,
    setPerfilParaExcluir,
    confirmDeletePerfil,
    cancelDeletePerfil,
    isDeletingPerfil: deletePerfilMutation.isPending,
    regraParaExcluir,
    setRegraParaExcluir,
    confirmDeleteRegra,
    cancelDeleteRegra,
    isDeletingRegra: deleteRegraMutation.isPending,
    regraCfopParaExcluir,
    setRegraCfopParaExcluir,
    confirmDeleteRegraCfop,
    cancelDeleteRegraCfop,
    isDeletingRegraCfop: deleteRegraCfopMutation.isPending,
    deleteError,
    setDeleteError,
    aOriFeedback,
    aOriError,
    setAOriError,
    openCreatePerfil,
    openEditPerfil,
    deletePerfil: deletePerfilMutation.mutate,
    submitPerfil,
    toggleLimitarAliquotaOrigem,
    isTogglingAliquotaOrigem: updatePerfilMutation.isPending,
    registerPerfil: perfilForm.register,
    perfilWatch: perfilForm.watch,
    setPerfilValue: perfilForm.setValue,
    errorsPerfil: perfilForm.formState.errors,
    isSubmittingPerfil: perfilForm.formState.isSubmitting,
    openCreateRegra,
    openEditRegra,
    deleteRegra: deleteRegraMutation.mutate,
    submitRegra,
    registerRegra: regraForm.register,
    errorsRegra: regraForm.formState.errors,
    isSubmittingRegra: regraForm.formState.isSubmitting,
    tipoRegraWatch: regraForm.watch('tipo_regra'),
    openCreateRegraCfop,
    openEditRegraCfop,
    deleteRegraCfop: deleteRegraCfopMutation.mutate,
    submitRegraCfop,
    registerRegraCfop: regraCfopForm.register,
    errorsRegraCfop: regraCfopForm.formState.errors,
    isSubmittingRegraCfop: regraCfopForm.formState.isSubmitting,
  };
}
