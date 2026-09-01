import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Sliders,
  Plus,
  Edit2,
  Trash2,
  Sparkles,
  Zap
} from 'lucide-react';

import { perfisApi } from '../../api/perfis';
import { regrasApi } from '../../api/regras';
import { regrasCfopApi } from '../../api/regrasCfop';
import { getErrorMessage } from '../../api/client';
import type { PerfilRegras, PerfilRegrasCreate } from '../../types/perfil';
import type { RegraAliquota, RegraAliquotaCreate } from '../../types/regra';
import type { RegraCfopCreate, RegraCfopEfetiva, DestinoCfop } from '../../types/regraCfop';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Select } from '../../components/ui/Select';
import { Modal } from '../../components/ui/Modal';
import { Badge } from '../../components/ui/Badge';
import { Card } from '../../components/ui/Card';
import { LoadingSpinner } from '../../components/feedback/LoadingSpinner';
import { EmptyState } from '../../components/feedback/EmptyState';
import { ErrorAlert } from '../../components/feedback/ErrorAlert';
import { formatPercent } from '../../lib/formatters';
import { UFS_BRASIL } from '../../constants/domain';
import { usePerfisQuery } from '../../hooks/useApiQueries';

const DESTINO_LABELS: Record<DestinoCfop, string> = {
  antecipacao_parcial: 'Antecipação Parcial',
  antecipacao_tributaria: 'Antecipação Tributária',
  difal: 'DIFAL',
  ignorar: 'Ignorar (não apurar)',
};

const DESTINO_BADGE: Record<DestinoCfop, 'info' | 'purple' | 'success' | 'neutral'> = {
  antecipacao_parcial: 'info',
  antecipacao_tributaria: 'purple',
  difal: 'success',
  ignorar: 'neutral',
};

// Schema Perfil
const perfilSchema = z.object({
  nome: z.string().min(2, 'Informe o nome do perfil'),
  descricao: z.string().optional(),
});

type PerfilFormData = z.infer<typeof perfilSchema>;

// Schema Regra Alíquota
const regraSchema = z.object({
  uf: z.string().length(2, 'Selecione a UF'),
  tipo_regra: z.enum(['padrao', 'excecao']),
  ncm: z.string().optional(),
  aliquota: z.number().min(0, 'Alíquota deve ser positiva').max(100, 'Alíquota máxima de 100%'),
  descricao: z.string().optional(),
}).refine(
  (data) => {
    if (data.tipo_regra === 'excecao') {
      const clean = data.ncm ? data.ncm.replace(/\D/g, '') : '';
      return clean.length === 8;
    }
    return true;
  },
  {
    message: 'Para regra de exceção, informe um NCM válido de 8 dígitos',
    path: ['ncm'],
  }
);

type RegraFormData = z.infer<typeof regraSchema>;

// Schema Regra de CFOP
const regraCfopSchema = z.object({
  cfop_sufixo: z.string()
    .regex(/^\d{3,4}$/, 'Informe os 3 últimos dígitos do CFOP (ex: 102) ou o CFOP completo (ex: 6102)'),
  destino: z.enum(['antecipacao_parcial', 'antecipacao_tributaria', 'difal', 'ignorar']),
  descricao: z.string().optional(),
});

type RegraCfopFormData = z.infer<typeof regraCfopSchema>;

export const PerfisRegrasPage: React.FC = () => {
  const queryClient = useQueryClient();
  const [selectedPerfilId, setSelectedPerfilId] = useState<number | null>(null);
  
  // Modais
  const [perfilModalOpen, setPerfilModalOpen] = useState(false);
  const [editingPerfil, setEditingPerfil] = useState<PerfilRegras | null>(null);
  
  const [regraModalOpen, setRegraModalOpen] = useState(false);
  const [editingRegra, setEditingRegra] = useState<RegraAliquota | null>(null);

  const [regraCfopModalOpen, setRegraCfopModalOpen] = useState(false);
  const [editingRegraCfop, setEditingRegraCfop] = useState<RegraCfopEfetiva | null>(null);

  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Queries
  const {
    data: perfis = [],
    isLoading: isLoadingPerfis,
    error: errorPerfis,
  } = usePerfisQuery();

  // Perfil ativo selecionado (default para o primeiro se existir)
  const activePerfil =
    perfis.find((p) => p.id === selectedPerfilId) || perfis[0] || null;

  const { data: regras = [], isLoading: isLoadingRegras } = useQuery({
    queryKey: ['regras-aliquotas', activePerfil?.id],
    queryFn: () => regrasApi.listar({ perfil_id: activePerfil!.id }),
    enabled: !!activePerfil,
  });

  const { data: regrasCfopEfetivas = [], isLoading: isLoadingRegrasCfop } = useQuery({
    queryKey: ['regras-cfop-efetivas', activePerfil?.id],
    queryFn: () => regrasCfopApi.listarEfetivas(activePerfil!.id),
    enabled: !!activePerfil,
  });

  // Forms
  const {
    register: registerPerfil,
    handleSubmit: handleSubmitPerfil,
    reset: resetPerfil,
    formState: { errors: errorsPerfil, isSubmitting: isSubmittingPerfil },
  } = useForm<PerfilFormData>({
    resolver: zodResolver(perfilSchema),
  });

  const {
    register: registerRegra,
    handleSubmit: handleSubmitRegra,
    reset: resetRegra,
    watch: watchRegra,
    formState: { errors: errorsRegra, isSubmitting: isSubmittingRegra },
  } = useForm<RegraFormData>({
    resolver: zodResolver(regraSchema),
    defaultValues: {
      uf: 'BA',
      tipo_regra: 'padrao',
      ncm: '',
      aliquota: 20.5,
      descricao: '',
    },
  });

  const tipoRegraWatch = watchRegra('tipo_regra');

  const {
    register: registerRegraCfop,
    handleSubmit: handleSubmitRegraCfop,
    reset: resetRegraCfop,
    formState: { errors: errorsRegraCfop, isSubmitting: isSubmittingRegraCfop },
  } = useForm<RegraCfopFormData>({
    resolver: zodResolver(regraCfopSchema),
    defaultValues: {
      cfop_sufixo: '',
      destino: 'antecipacao_parcial',
      descricao: '',
    },
  });

  // Mutations Perfil
  const createPerfilMutation = useMutation({
    mutationFn: (payload: PerfilRegrasCreate) => perfisApi.criar(payload),
    onSuccess: (newPerfil) => {
      queryClient.invalidateQueries({ queryKey: ['perfis-regras'] });
      setSelectedPerfilId(newPerfil.id);
      setPerfilModalOpen(false);
    },
    onError: (err) => setErrorMessage(getErrorMessage(err)),
  });

  const updatePerfilMutation = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: PerfilRegrasCreate }) =>
      perfisApi.atualizar(id, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['perfis-regras'] });
      setPerfilModalOpen(false);
    },
    onError: (err) => setErrorMessage(getErrorMessage(err)),
  });

  const deletePerfilMutation = useMutation({
    mutationFn: (id: number) => perfisApi.deletar(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['perfis-regras'] });
      setSelectedPerfilId(null);
    },
    onError: (err) => alert(getErrorMessage(err)),
  });

  // Mutations Regras
  const createRegraMutation = useMutation({
    mutationFn: (payload: RegraAliquotaCreate) => regrasApi.criar(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['regras-aliquotas', activePerfil?.id] });
      setRegraModalOpen(false);
    },
    onError: (err) => setErrorMessage(getErrorMessage(err)),
  });

  const updateRegraMutation = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: RegraAliquotaCreate }) =>
      regrasApi.atualizar(id, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['regras-aliquotas', activePerfil?.id] });
      setRegraModalOpen(false);
    },
    onError: (err) => setErrorMessage(getErrorMessage(err)),
  });

  const deleteRegraMutation = useMutation({
    mutationFn: (id: number) => regrasApi.deletar(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['regras-aliquotas', activePerfil?.id] });
    },
    onError: (err) => alert(getErrorMessage(err)),
  });

  // Mutations Regras de CFOP
  const createRegraCfopMutation = useMutation({
    mutationFn: (payload: RegraCfopCreate) => regrasCfopApi.criar(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['regras-cfop-efetivas', activePerfil?.id] });
      setRegraCfopModalOpen(false);
    },
    onError: (err) => setErrorMessage(getErrorMessage(err)),
  });

  const updateRegraCfopMutation = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: RegraCfopCreate }) =>
      regrasCfopApi.atualizar(id, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['regras-cfop-efetivas', activePerfil?.id] });
      setRegraCfopModalOpen(false);
    },
    onError: (err) => setErrorMessage(getErrorMessage(err)),
  });

  const deleteRegraCfopMutation = useMutation({
    mutationFn: (id: number) => regrasCfopApi.deletar(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['regras-cfop-efetivas', activePerfil?.id] });
    },
    onError: (err) => alert(getErrorMessage(err)),
  });

  // Handlers Perfil
  const handleOpenCreatePerfil = () => {
    setEditingPerfil(null);
    setErrorMessage(null);
    resetPerfil({ nome: '', descricao: '' });
    setPerfilModalOpen(true);
  };

  const handleOpenEditPerfil = (p: PerfilRegras) => {
    setEditingPerfil(p);
    setErrorMessage(null);
    resetPerfil({ nome: p.nome, descricao: p.descricao || '' });
    setPerfilModalOpen(true);
  };

  const onSubmitPerfil = async (data: PerfilFormData) => {
    setErrorMessage(null);
    try {
      if (editingPerfil) {
        await updatePerfilMutation.mutateAsync({
          id: editingPerfil.id,
          payload: { nome: data.nome, descricao: data.descricao },
        });
      } else {
        await createPerfilMutation.mutateAsync({
          nome: data.nome,
          descricao: data.descricao,
        });
      }
    } catch {
      // onError da mutation exibe a falha no modal.
    }
  };

  // Handlers Regra
  const handleOpenCreateRegra = (tipo: 'padrao' | 'excecao' = 'padrao') => {
    setEditingRegra(null);
    setErrorMessage(null);
    resetRegra({
      uf: 'BA',
      tipo_regra: tipo,
      ncm: '',
      aliquota: 20.5,
      descricao: '',
    });
    setRegraModalOpen(true);
  };

  const handleOpenEditRegra = (r: RegraAliquota) => {
    setEditingRegra(r);
    setErrorMessage(null);
    const isExcecao = !!r.ncm;
    resetRegra({
      uf: r.uf,
      tipo_regra: isExcecao ? 'excecao' : 'padrao',
      ncm: r.ncm || '',
      aliquota: r.aliquota <= 1 ? r.aliquota * 100 : r.aliquota,
      descricao: r.descricao || '',
    });
    setRegraModalOpen(true);
  };

  const onSubmitRegra = async (data: RegraFormData) => {
    if (!activePerfil) return;
    setErrorMessage(null);

    const aliquotaDecimal = data.aliquota > 1 ? data.aliquota / 100 : data.aliquota;
    const cleanNcm = data.tipo_regra === 'excecao' && data.ncm ? data.ncm.replace(/\D/g, '') : null;

    const payload: RegraAliquotaCreate = {
      perfil_regras_id: activePerfil.id,
      uf: data.uf,
      ncm: cleanNcm,
      aliquota: aliquotaDecimal,
      descricao: data.descricao || (cleanNcm ? `Exceção NCM ${cleanNcm}` : `Alíquota Padrão ${data.uf}`),
    };

    try {
      if (editingRegra) {
        await updateRegraMutation.mutateAsync({ id: editingRegra.id, payload });
      } else {
        await createRegraMutation.mutateAsync(payload);
      }
    } catch {
      // onError da mutation exibe a falha no modal.
    }
  };

  // Handlers Regra de CFOP
  const handleOpenCreateRegraCfop = () => {
    setEditingRegraCfop(null);
    setErrorMessage(null);
    resetRegraCfop({ cfop_sufixo: '', destino: 'antecipacao_parcial', descricao: '' });
    setRegraCfopModalOpen(true);
  };

  const handleOpenEditRegraCfop = (r: RegraCfopEfetiva) => {
    setEditingRegraCfop(r);
    setErrorMessage(null);
    resetRegraCfop({ cfop_sufixo: r.cfop_sufixo, destino: r.destino, descricao: r.descricao || '' });
    setRegraCfopModalOpen(true);
  };

  const onSubmitRegraCfop = async (data: RegraCfopFormData) => {
    if (!activePerfil) return;
    setErrorMessage(null);

    const payload: RegraCfopCreate = {
      perfil_regras_id: activePerfil.id,
      cfop_sufixo: data.cfop_sufixo,
      destino: data.destino,
      descricao: data.descricao || null,
    };

    // Editando uma regra que hoje é apenas o padrão global (origem 'global'): cria a
    // sobrescrita para este perfil em vez de tentar atualizar a regra global compartilhada.
    try {
      if (editingRegraCfop && editingRegraCfop.origem === 'perfil') {
        await updateRegraCfopMutation.mutateAsync({ id: editingRegraCfop.regra_id, payload });
      } else {
        await createRegraCfopMutation.mutateAsync(payload);
      }
    } catch {
      // onError da mutation exibe a falha no modal.
    }
  };

  // Segregação explícita entre Regras Padrão e Exceções
  const regrasPadrao = regras.filter((r) => !r.ncm);
  const regrasExcecao = regras.filter((r) => !!r.ncm);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900 flex items-center gap-2">
            <Sliders className="w-6 h-6 text-blue-800" />
            Perfis de Regras e Alíquotas (A.DST)
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Configuração determinística das alíquotas de destino padrão por estado e suas exceções por NCM
          </p>
        </div>

        <Button onClick={handleOpenCreatePerfil} leftIcon={<Plus className="w-4 h-4" />}>
          Novo Perfil de Regras
        </Button>
      </div>

      {isLoadingPerfis ? (
        <LoadingSpinner message="Carregando perfis fiscais..." />
      ) : errorPerfis ? (
        <ErrorAlert message={getErrorMessage(errorPerfis)} />
      ) : perfis.length === 0 ? (
        <EmptyState
          icon={<Sliders className="w-8 h-8 text-blue-700" />}
          title="Nenhum perfil de regras cadastrado"
          description="Crie o primeiro perfil de regras para definir as alíquotas padrão por estado e as exceções por NCM compartilhadas pelas empresas."
          actionLabel="Criar Primeiro Perfil"
          onAction={handleOpenCreatePerfil}
        />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Coluna Esquerda: Seletor de Perfis */}
          <div className="lg:col-span-4 space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 px-1">
              Perfis Compartilhados ({perfis.length})
            </h3>

            <div className="space-y-2">
              {perfis.map((p) => {
                const isSelected = activePerfil?.id === p.id;
                return (
                  <div
                    key={p.id}
                    onClick={() => setSelectedPerfilId(p.id)}
                    className={`p-3.5 rounded-lg border text-left cursor-pointer transition-all ${
                      isSelected
                        ? 'bg-blue-50/70 border-blue-600 shadow-sm ring-1 ring-blue-600/30'
                        : 'bg-white border-slate-200 hover:border-slate-300 hover:bg-slate-50/50'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <h4
                        className={`text-sm font-semibold ${
                          isSelected ? 'text-blue-900' : 'text-slate-900'
                        }`}
                      >
                        {p.nome}
                      </h4>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleOpenEditPerfil(p);
                          }}
                          className="p-1 text-slate-400 hover:text-blue-800 rounded transition-colors"
                          title="Editar perfil"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        {perfis.length > 1 && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              if (confirm(`Deseja remover o perfil "${p.nome}"?`)) {
                                deletePerfilMutation.mutate(p.id);
                              }
                            }}
                            className="p-1 text-slate-400 hover:text-red-700 rounded transition-colors"
                            title="Remover perfil"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                    {p.descricao && (
                      <p className="text-xs text-slate-500 mt-1 line-clamp-2">{p.descricao}</p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Coluna Direita: Detalhes das Regras do Perfil Selecionado */}
          {activePerfil && (
            <div className="lg:col-span-8 space-y-6">
              {/* Card Explicativo de Precedência Fiscal */}
              <div className="bg-slate-900 text-slate-200 rounded-lg p-4 shadow-sm border border-slate-800 text-xs flex items-start gap-3">
                <Sparkles className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                <div className="leading-relaxed">
                  <span className="font-semibold text-white">Como o motor resolve a alíquota (A.DST): </span>
                  O sistema busca primeiro por uma <strong>Exceção (UF + NCM)</strong>. Se não existir regra específica para aquele NCM, aplica automaticamente a <strong>Alíquota Padrão do Estado (UF)</strong>. A alíquota de origem (A.ORI) vem pronta do XML.
                </div>
              </div>

              {/* Seção 1: Regras Padrão por Estado */}
              <Card
                title={`Alíquotas Padrão por Estado — ${activePerfil.nome}`}
                subtitle="Alíquota base aplicada a qualquer mercadoria que não possua exceção de NCM"
                headerAction={
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleOpenCreateRegra('padrao')}
                    leftIcon={<Plus className="w-3.5 h-3.5" />}
                  >
                    Nova Regra Estadual
                  </Button>
                }
              >
                {isLoadingRegras ? (
                  <LoadingSpinner size="sm" message="Carregando regras..." />
                ) : regrasPadrao.length === 0 ? (
                  <p className="text-xs text-slate-500 italic py-4 text-center">
                    Nenhuma alíquota padrão configurada para este perfil. Clique em "Nova Regra Estadual" para definir a alíquota padrão da UF.
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs divide-y divide-slate-200">
                      <thead className="bg-slate-50 text-slate-700 font-semibold uppercase tracking-wider text-[11px]">
                        <tr>
                          <th className="py-2.5 px-3">Estado</th>
                          <th className="py-2.5 px-3">Tipo</th>
                          <th className="py-2.5 px-3 font-mono text-right">A.DST Padrão</th>
                          <th className="py-2.5 px-3">Descrição / Legislação</th>
                          <th className="py-2.5 px-3 text-right">Ações</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {regrasPadrao.map((regra) => (
                          <tr key={regra.id} className="hover:bg-slate-50/70 transition-colors">
                            <td className="py-2.5 px-3">
                              <span className="font-bold text-slate-800 bg-slate-100 px-2 py-0.5 rounded text-[11px] border border-slate-200">
                                {regra.uf}
                              </span>
                            </td>
                            <td className="py-2.5 px-3">
                              <Badge variant="info" size="sm">
                                Padrão Estadual
                              </Badge>
                            </td>
                            <td className="py-2.5 px-3 font-mono font-bold text-blue-950 text-right">
                              {formatPercent(regra.aliquota)}
                            </td>
                            <td className="py-2.5 px-3 text-slate-600">
                              {regra.descricao || '-'}
                            </td>
                            <td className="py-2.5 px-3 text-right">
                              <div className="flex items-center justify-end gap-1">
                                <button
                                  onClick={() => handleOpenEditRegra(regra)}
                                  className="p-1 text-slate-400 hover:text-blue-800 hover:bg-blue-50 rounded"
                                  title="Editar regra"
                                >
                                  <Edit2 className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  onClick={() => {
                                    if (confirm(`Remover regra padrão de ${regra.uf}?`)) {
                                      deleteRegraMutation.mutate(regra.id);
                                    }
                                  }}
                                  className="p-1 text-slate-400 hover:text-red-700 hover:bg-red-50 rounded"
                                  title="Remover regra"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>

              {/* Seção 2: Exceções por Estado + NCM (Alta Prioridade) */}
              <Card
                title="Exceções Tributárias por NCM (Prioridade Máxima)"
                subtitle="Quando o item da nota coincidir com o NCM, esta alíquota sobrescreve a regra padrão"
                headerAction={
                  <Button
                    size="sm"
                    className="bg-purple-800 hover:bg-purple-900 focus:ring-purple-800"
                    onClick={() => handleOpenCreateRegra('excecao')}
                    leftIcon={<Plus className="w-3.5 h-3.5" />}
                  >
                    Nova Exceção NCM
                  </Button>
                }
              >
                {isLoadingRegras ? (
                  <LoadingSpinner size="sm" message="Carregando exceções..." />
                ) : regrasExcecao.length === 0 ? (
                  <p className="text-xs text-slate-500 italic py-4 text-center">
                    Nenhuma exceção por NCM configurada. Itens serão calculados pela alíquota padrão da UF.
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs divide-y divide-slate-200">
                      <thead className="bg-purple-50/60 text-purple-950 font-semibold uppercase tracking-wider text-[11px]">
                        <tr>
                          <th className="py-2.5 px-3">Estado</th>
                          <th className="py-2.5 px-3 font-mono">NCM (8 dígitos)</th>
                          <th className="py-2.5 px-3">Precedência</th>
                          <th className="py-2.5 px-3 font-mono text-right">A.DST Específica</th>
                          <th className="py-2.5 px-3">Descrição da Exceção</th>
                          <th className="py-2.5 px-3 text-right">Ações</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {regrasExcecao.map((regra) => (
                          <tr key={regra.id} className="hover:bg-purple-50/30 transition-colors">
                            <td className="py-2.5 px-3 font-bold text-slate-800">
                              {regra.uf}
                            </td>
                            <td className="py-2.5 px-3 font-mono font-bold text-purple-900">
                              {regra.ncm}
                            </td>
                            <td className="py-2.5 px-3">
                              <Badge variant="purple" size="sm">
                                <Zap className="w-3 h-3 mr-1 text-purple-600" />
                                Exceção com Prioridade
                              </Badge>
                            </td>
                            <td className="py-2.5 px-3 font-mono font-bold text-purple-950 text-right">
                              {formatPercent(regra.aliquota)}
                            </td>
                            <td className="py-2.5 px-3 text-slate-600">
                              {regra.descricao || '-'}
                            </td>
                            <td className="py-2.5 px-3 text-right">
                              <div className="flex items-center justify-end gap-1">
                                <button
                                  onClick={() => handleOpenEditRegra(regra)}
                                  className="p-1 text-slate-400 hover:text-purple-800 hover:bg-purple-50 rounded"
                                  title="Editar exceção"
                                >
                                  <Edit2 className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  onClick={() => {
                                    if (confirm(`Remover exceção NCM ${regra.ncm} para ${regra.uf}?`)) {
                                      deleteRegraMutation.mutate(regra.id);
                                    }
                                  }}
                                  className="p-1 text-slate-400 hover:text-red-700 hover:bg-red-50 rounded"
                                  title="Remover exceção"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>

              {/* Seção 3: Roteamento por CFOP -> Planilha */}
              <Card
                title="Roteamento por CFOP -> Planilha"
                subtitle="Define em qual planilha (Antecipação Parcial, Antecipação Tributária ou DIFAL) cada item da nota entra, a partir do CFOP"
                headerAction={
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleOpenCreateRegraCfop}
                    leftIcon={<Plus className="w-3.5 h-3.5" />}
                  >
                    Nova Exceção de CFOP
                  </Button>
                }
              >
                {isLoadingRegrasCfop ? (
                  <LoadingSpinner size="sm" message="Carregando regras de CFOP..." />
                ) : regrasCfopEfetivas.length === 0 ? (
                  <p className="text-xs text-slate-500 italic py-4 text-center">
                    Nenhuma regra de CFOP cadastrada (nem mesmo os padrões globais).
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs divide-y divide-slate-200">
                      <thead className="bg-slate-50 text-slate-700 font-semibold uppercase tracking-wider text-[11px]">
                        <tr>
                          <th className="py-2.5 px-3 font-mono">CFOP (sufixo)</th>
                          <th className="py-2.5 px-3">Planilha de Destino</th>
                          <th className="py-2.5 px-3">Origem</th>
                          <th className="py-2.5 px-3">Descrição</th>
                          <th className="py-2.5 px-3 text-right">Ações</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {regrasCfopEfetivas.map((regra) => (
                          <tr key={regra.cfop_sufixo} className="hover:bg-slate-50/70 transition-colors">
                            <td className="py-2.5 px-3">
                              <span className="font-bold text-slate-800 bg-slate-100 px-2 py-0.5 rounded text-[11px] border border-slate-200">
                                {regra.cfop_sufixo}
                              </span>
                            </td>
                            <td className="py-2.5 px-3">
                              <Badge variant={DESTINO_BADGE[regra.destino]} size="sm">
                                {DESTINO_LABELS[regra.destino]}
                              </Badge>
                            </td>
                            <td className="py-2.5 px-3">
                              {regra.origem === 'perfil' ? (
                                <Badge variant="purple" size="sm">
                                  <Zap className="w-3 h-3 mr-1 text-purple-600" />
                                  Exceção deste perfil
                                </Badge>
                              ) : (
                                <Badge variant="neutral" size="sm">Padrão do sistema</Badge>
                              )}
                            </td>
                            <td className="py-2.5 px-3 text-slate-600">
                              {regra.descricao || '-'}
                            </td>
                            <td className="py-2.5 px-3 text-right">
                              <div className="flex items-center justify-end gap-1">
                                <button
                                  onClick={() => handleOpenEditRegraCfop(regra)}
                                  className="p-1 text-slate-400 hover:text-blue-800 hover:bg-blue-50 rounded"
                                  title={regra.origem === 'perfil' ? 'Editar exceção' : 'Sobrescrever para este perfil'}
                                >
                                  <Edit2 className="w-3.5 h-3.5" />
                                </button>
                                {regra.origem === 'perfil' && (
                                  <button
                                    onClick={() => {
                                      if (confirm(`Remover a exceção de CFOP ${regra.cfop_sufixo} deste perfil? Voltará a usar o padrão do sistema.`)) {
                                        deleteRegraCfopMutation.mutate(regra.regra_id);
                                      }
                                    }}
                                    className="p-1 text-slate-400 hover:text-red-700 hover:bg-red-50 rounded"
                                    title="Remover exceção"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>
            </div>
          )}
        </div>
      )}

      {/* Modal Perfil */}
      <Modal
        isOpen={perfilModalOpen}
        onClose={() => setPerfilModalOpen(false)}
        title={editingPerfil ? 'Editar Perfil de Regras' : 'Novo Perfil de Regras'}
        subtitle="Perfis agrupam conjuntos de regras e alíquotas compartilhados entre várias empresas"
      >
        {errorMessage && <ErrorAlert message={errorMessage} onDismiss={() => setErrorMessage(null)} />}
        <form onSubmit={handleSubmitPerfil(onSubmitPerfil)} className="space-y-4">
          <Input
            label="Nome do Perfil"
            placeholder="Ex: Comércio Varejista BA - Geral"
            {...registerPerfil('nome')}
            error={errorsPerfil.nome?.message}
          />
          <Input
            label="Descrição (Opcional)"
            placeholder="Ex: Perfil padrão para empresas de vestuário e calçados"
            {...registerPerfil('descricao')}
            error={errorsPerfil.descricao?.message}
          />
          <div className="pt-4 border-t border-slate-100 flex justify-end gap-3">
            <Button type="button" variant="outline" onClick={() => setPerfilModalOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" isLoading={isSubmittingPerfil}>
              Salvar Perfil
            </Button>
          </div>
        </form>
      </Modal>

      {/* Modal Regra de Alíquota */}
      <Modal
        isOpen={regraModalOpen}
        onClose={() => setRegraModalOpen(false)}
        title={
          editingRegra
            ? 'Editar Regra de Alíquota'
            : tipoRegraWatch === 'excecao'
            ? 'Cadastrar Exceção por NCM'
            : 'Cadastrar Alíquota Padrão da UF'
        }
        subtitle={`Perfil: ${activePerfil?.nome}`}
      >
        {errorMessage && <ErrorAlert message={errorMessage} onDismiss={() => setErrorMessage(null)} />}
        <form onSubmit={handleSubmitRegra(onSubmitRegra)} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-700 mb-2">
              Tipo da Regra
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label
                className={`flex items-center gap-2 p-3 rounded-md border cursor-pointer text-xs font-medium transition-colors ${
                  tipoRegraWatch === 'padrao'
                    ? 'bg-blue-50 border-blue-600 text-blue-900 font-bold'
                    : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
              >
                <input
                  type="radio"
                  value="padrao"
                  className="text-blue-800 focus:ring-blue-800"
                  {...registerRegra('tipo_regra')}
                />
                <span>Padrão do Estado (UF)</span>
              </label>

              <label
                className={`flex items-center gap-2 p-3 rounded-md border cursor-pointer text-xs font-medium transition-colors ${
                  tipoRegraWatch === 'excecao'
                    ? 'bg-purple-50 border-purple-600 text-purple-900 font-bold'
                    : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
              >
                <input
                  type="radio"
                  value="excecao"
                  className="text-purple-800 focus:ring-purple-800"
                  {...registerRegra('tipo_regra')}
                />
                <span>Exceção por NCM</span>
              </label>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Select
              label="Estado (UF)"
              options={UFS_BRASIL.map((uf) => ({ value: uf, label: uf }))}
              {...registerRegra('uf')}
              error={errorsRegra.uf?.message}
            />

            <div>
              <Input
                label="Alíquota de Destino A.DST (%)"
                type="number"
                step="0.01"
                placeholder="Ex: 20.5 ou 18.0"
                {...registerRegra('aliquota', { valueAsNumber: true })}
                error={errorsRegra.aliquota?.message}
                helperText="Informe o percentual (ex: 20.5 para 20,5%)"
              />
            </div>
          </div>

          {tipoRegraWatch === 'excecao' && (
            <div>
              <Input
                label="Código NCM (8 dígitos)"
                placeholder="Ex: 84713012"
                maxLength={8}
                {...registerRegra('ncm')}
                error={errorsRegra.ncm?.message}
                helperText="Apenas números. Itens de NF-e com este NCM adotarão esta alíquota prioritariamente."
              />
            </div>
          )}

          <div>
            <Input
              label="Descrição / Motivo da Alíquota"
              placeholder="Ex: Alíquota interna BA com adicional de FECOP"
              {...registerRegra('descricao')}
              error={errorsRegra.descricao?.message}
            />
          </div>

          <div className="pt-4 border-t border-slate-100 flex justify-end gap-3">
            <Button type="button" variant="outline" onClick={() => setRegraModalOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" isLoading={isSubmittingRegra}>
              {editingRegra ? 'Salvar Alterações' : 'Salvar Regra'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Modal Regra de CFOP */}
      <Modal
        isOpen={regraCfopModalOpen}
        onClose={() => setRegraCfopModalOpen(false)}
        title={editingRegraCfop ? 'Sobrescrever Roteamento de CFOP' : 'Nova Exceção de Roteamento por CFOP'}
        subtitle={`Perfil: ${activePerfil?.nome}`}
      >
        {errorMessage && <ErrorAlert message={errorMessage} onDismiss={() => setErrorMessage(null)} />}
        <form onSubmit={handleSubmitRegraCfop(onSubmitRegraCfop)} className="space-y-4">
          <Input
            label="CFOP (3 últimos dígitos ou completo)"
            placeholder="Ex: 102 ou 6102"
            maxLength={4}
            {...registerRegraCfop('cfop_sufixo')}
            error={errorsRegraCfop.cfop_sufixo?.message}
            helperText="O mesmo sufixo casa tanto com o CFOP de saída do XML (6xxx) quanto com o de entrada do SPED (2xxx)"
          />

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-700 mb-2">
              Planilha de Destino
            </label>
            <select
              className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-800 text-slate-900"
              {...registerRegraCfop('destino')}
            >
              {(Object.keys(DESTINO_LABELS) as DestinoCfop[]).map((d) => (
                <option key={d} value={d}>{DESTINO_LABELS[d]}</option>
              ))}
            </select>
          </div>

          <Input
            label="Descrição (Opcional)"
            placeholder="Ex: Mercadoria sujeita a ST"
            {...registerRegraCfop('descricao')}
            error={errorsRegraCfop.descricao?.message}
          />

          <div className="pt-4 border-t border-slate-100 flex justify-end gap-3">
            <Button type="button" variant="outline" onClick={() => setRegraCfopModalOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" isLoading={isSubmittingRegraCfop}>
              Salvar Regra
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
