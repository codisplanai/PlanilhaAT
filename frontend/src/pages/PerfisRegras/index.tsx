import React, { useEffect, useState } from 'react';
import {
  Sliders,
  Plus,
  Edit2,
  Trash2,
  Sparkles,
  Zap,
  Check,
  Percent,
  Layers,
  Route,
} from 'lucide-react';

import { getErrorMessage } from '../../api/client';
import type { DestinoCfop } from '../../types/regraCfop';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Select } from '../../components/ui/Select';
import { Modal } from '../../components/ui/Modal';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { Tabs } from '../../components/ui/Tabs';
import { Badge } from '../../components/ui/Badge';
import { Card } from '../../components/ui/Card';
import { LoadingSpinner } from '../../components/feedback/LoadingSpinner';
import { EmptyState } from '../../components/feedback/EmptyState';
import { SectionEmpty } from '../../components/feedback/SectionEmpty';
import { ErrorAlert } from '../../components/feedback/ErrorAlert';
import { PageHeader } from '../../components/layout/PageHeader';
import { formatPercent } from '../../lib/formatters';
import {
  DESTINO_CFOP_BADGE_VARIANTS,
  DESTINO_CFOP_LABELS,
  UFS_BRASIL,
} from '../../constants/domain';
import { usePerfisRegrasPage } from './usePerfisRegrasPage';
import { ReducaoProdutoSection } from './ReducaoProdutoSection';
import { ReclassificacaoCfopSection } from './ReclassificacaoCfopSection';
import { ExclusaoParcialSection } from './ExclusaoParcialSection';
import { MvaAntecipacaoSection } from './MvaAntecipacaoSection';
import { PerfilList } from './PerfilList';

type SectionKey =
  | 'limiteAori'
  | 'aliquotasIguais'
  | 'reducoes'
  | 'exclusoes'
  | 'mva'
  | 'padrao'
  | 'excecoes'
  | 'cfop';

// Ordem de leitura da página: primeiro a cadeia que resolve a A.DST,
// depois a antecipação e por fim o roteamento dos itens.
const SECTION_KEYS: SectionKey[] = [
  'reducoes',
  'excecoes',
  'padrao',
  'limiteAori',
  'exclusoes',
  'aliquotasIguais',
  'mva',
  'cfop',
];

/** Nível de precedência da regra, na mesma numeração do quadro do topo. */
const NivelMarker: React.FC<{ nivel: string; descricao: string }> = ({ nivel, descricao }) => (
  <span
    title={descricao}
    className="inline-flex h-5 min-w-[1.375rem] items-center justify-center rounded-md bg-slate-900 px-1.5 font-mono text-[10px] font-bold tabular-nums text-white"
  >
    {nivel}
  </span>
);

const GroupHeading: React.FC<{ icon: React.ReactNode; title: string; hint: string }> = ({
  icon,
  title,
  hint,
}) => (
  <div className="flex items-center gap-3">
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 shadow-2xs">
      {icon}
    </span>
    <div className="min-w-0">
      <h3 className="text-sm font-bold tracking-tight text-slate-900">{title}</h3>
      <p className="text-xs text-slate-500">{hint}</p>
    </div>
    <span className="ml-1 hidden h-px flex-1 bg-slate-200 sm:block" />
  </div>
);

const collapsedSections = (): Record<SectionKey, boolean> => ({
  limiteAori: false,
  aliquotasIguais: false,
  reducoes: false,
  exclusoes: false,
  mva: false,
  padrao: false,
  excecoes: false,
  cfop: false,
});

export const PerfisRegrasPage: React.FC = () => {
  const {
    perfis,
    perfisQuery: { isLoading: isLoadingPerfis, error: errorPerfis },
    activePerfil,
    setSelectedPerfilId,
    regrasPadrao,
    regrasExcecao,
    regrasQuery,
    isLoadingRegras,
    regrasCfopQuery,
    regrasCfopEfetivas,
    isLoadingRegrasCfop,
    perfilModalOpen,
    setPerfilModalOpen,
    editingPerfil,
    duplicatingPerfil,
    openDuplicatePerfil,
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
    isDeletingPerfil,
    regraParaExcluir,
    setRegraParaExcluir,
    confirmDeleteRegra,
    cancelDeleteRegra,
    isDeletingRegra,
    regraCfopParaExcluir,
    setRegraCfopParaExcluir,
    confirmDeleteRegraCfop,
    cancelDeleteRegraCfop,
    isDeletingRegraCfop,
    deleteError,
    setDeleteError,
    aOriFeedback,
    aOriError,
    aliqIguaisFeedback,
    aliqIguaisError,
    togglePoliticaAliquotasIguais,
    openCreatePerfil: handleOpenCreatePerfil,
    openEditPerfil: handleOpenEditPerfil,
    submitPerfil,
    toggleLimitarAliquotaOrigem,
    isTogglingAliquotaOrigem,
    registerPerfil,
    errorsPerfil,
    isSubmittingPerfil,
    openCreateRegra: handleOpenCreateRegra,
    openEditRegra: handleOpenEditRegra,
    submitRegra,
    registerRegra,
    errorsRegra,
    isSubmittingRegra,
    tipoRegraWatch,
    openCreateRegraCfop: handleOpenCreateRegraCfop,
    openEditRegraCfop: handleOpenEditRegraCfop,
    submitRegraCfop,
    registerRegraCfop,
    errorsRegraCfop,
    isSubmittingRegraCfop,
  } = usePerfisRegrasPage();

  const [cfopTab, setCfopTab] = useState<'geral' | 'reclassificacao'>('geral');
  const [openSections, setOpenSections] = useState<Record<SectionKey, boolean>>(collapsedSections);

  useEffect(() => {
    setOpenSections(collapsedSections());
  }, [activePerfil?.id]);

  const setSectionOpen = (key: SectionKey, open: boolean) => {
    setOpenSections((current) => ({ ...current, [key]: open }));
  };

  const expandAllSections = () => {
    setOpenSections(Object.fromEntries(SECTION_KEYS.map((key) => [key, true])) as Record<SectionKey, boolean>);
  };

  const collapseAllSections = () => {
    setOpenSections(collapsedSections());
  };

  const allSectionsOpen = SECTION_KEYS.every((key) => openSections[key]);
  const allSectionsClosed = SECTION_KEYS.every((key) => !openSections[key]);

  return (
    <div className="space-y-6">
      {/* PageHeader Padronizado */}
      <PageHeader
        icon={<Sliders className="w-5 h-5 text-blue-700" />}
        title="Perfis de Regras e Alíquotas (A.DST)"
        description="Configuração determinística das alíquotas de destino padrão por estado e suas exceções por NCM"
        action={
          <Button onClick={handleOpenCreatePerfil} leftIcon={<Plus className="w-4 h-4" />}>
            Novo Perfil de Regras
          </Button>
        }
      />

      {deleteError && (
        <ErrorAlert
          title="Falha ao excluir"
          message={deleteError}
          onDismiss={() => setDeleteError(null)}
        />
      )}
      {regrasQuery.error && (
        <ErrorAlert
          title="Erro ao carregar regras estaduais"
          message={getErrorMessage(regrasQuery.error)}
          actionLabel="Tentar novamente"
          onAction={() => regrasQuery.refetch()}
        />
      )}
      {regrasCfopQuery.error && (
        <ErrorAlert
          title="Erro ao carregar regras de CFOP"
          message={getErrorMessage(regrasCfopQuery.error)}
          actionLabel="Tentar novamente"
          onAction={() => regrasCfopQuery.refetch()}
        />
      )}

      {isLoadingPerfis ? (
        <LoadingSpinner message="Carregando perfis fiscais..." />
      ) : errorPerfis ? (
        <ErrorAlert message={getErrorMessage(errorPerfis)} />
      ) : perfis.length === 0 ? (
        <EmptyState
          icon={<Sliders className="w-7 h-7 text-blue-700" />}
          title="Nenhum perfil de regras cadastrado"
          description="Crie o primeiro perfil de regras para definir as alíquotas padrão por estado e as exceções por NCM compartilhadas pelas empresas."
          actionLabel="Criar Primeiro Perfil"
          onAction={handleOpenCreatePerfil}
        />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <PerfilList
            perfis={perfis}
            activePerfilId={activePerfil?.id}
            onSelect={setSelectedPerfilId}
            onEdit={handleOpenEditPerfil}
            onDuplicate={openDuplicatePerfil}
            onDelete={setPerfilParaExcluir}
          />

          {/* Coluna Direita: Detalhes das Regras do Perfil Selecionado */}
          {activePerfil && (
            <div className="lg:col-span-8 space-y-6 animate-fade-in">
              {/* Cadeia de precedência: o modelo mental que a página inteira serve */}
              <div className="rounded-xl border border-slate-800 bg-slate-950 p-4 text-slate-200 shadow-xs sm:p-5">
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-amber-400/30 bg-amber-500/15 text-amber-400">
                    <Sparkles className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-bold tracking-tight text-white">
                      Como o motor decide a alíquota de destino
                    </p>
                    <p className="mt-1 max-w-[70ch] text-xs leading-relaxed text-slate-400">
                      O primeiro nível que casar com o item define a A.DST; não casando, o cálculo
                      cai para o nível seguinte. A alíquota de origem (A.ORI) vem sempre do XML ou do SPED.
                    </p>
                  </div>
                </div>
                <ol className="mt-4 grid gap-2 sm:grid-cols-3">
                  {[
                    {
                      nivel: '1',
                      titulo: 'Redução por produto',
                      texto: 'O NCM e a descrição do item conferem com uma regra deste perfil.',
                      aqui: true,
                    },
                    {
                      nivel: '2',
                      titulo: 'Termo de acordo',
                      texto: 'Regime próprio da empresa, definido no cadastro dela.',
                      aqui: false,
                    },
                    {
                      nivel: '3',
                      titulo: 'Padrão do estado',
                      texto: 'Exceção por NCM (3a); sem exceção, a alíquota base da UF (3b).',
                      aqui: true,
                    },
                  ].map((passo) => (
                    <li
                      key={passo.nivel}
                      className={`rounded-lg border p-3 ${
                        passo.aqui
                          ? 'border-slate-800 bg-slate-900/60'
                          : 'border-dashed border-slate-700 bg-transparent'
                      }`}
                    >
                      <div className="flex items-baseline gap-2">
                        <span className="font-mono text-[11px] font-bold tabular-nums text-amber-400">
                          {passo.nivel}
                        </span>
                        <span className="text-xs font-bold text-white">{passo.titulo}</span>
                      </div>
                      <p className="mt-1 text-[11px] leading-relaxed text-slate-400">{passo.texto}</p>
                      {!passo.aqui && (
                        <p className="mt-1.5 text-[11px] font-medium text-slate-500">
                          Configurado no cadastro da empresa
                        </p>
                      )}
                    </li>
                  ))}
                </ol>
              </div>

              {/* Barra de contexto: lembra qual perfil está sendo editado durante a rolagem */}
              <div className="sticky top-0 z-10 -mx-1 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-slate-200/80 bg-slate-50/90 px-1 py-2.5 backdrop-blur-sm">
                <div className="flex min-w-0 items-center gap-2">
                  <Sliders className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                  <p className="truncate text-sm font-bold tracking-tight text-slate-900">
                    {activePerfil.nome}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={expandAllSections}
                    disabled={allSectionsOpen}
                  >
                    Expandir todas
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={collapseAllSections}
                    disabled={allSectionsClosed}
                  >
                    Recolher todas
                  </Button>
                </div>
              </div>

              <div className="space-y-8">
              <section className="space-y-4">
                <GroupHeading
                  icon={<Percent className="h-4 w-4" />}
                  title="Alíquota de destino (A.DST)"
                  hint="Na ordem em que o motor avalia cada item."
                />
              {/* Nível 1 — vence o termo de acordo e as demais regras */}
              <ReducaoProdutoSection
                marker={<NivelMarker nivel="1" descricao="Nível 1: vence todas as demais regras" />}
                perfilId={activePerfil.id}
                open={openSections.reducoes}
                onOpenChange={(open) => setSectionOpen('reducoes', open)}
              />

              {/* Nível 3a — exceção por NCM, sobrescreve a base da UF */}
              <Card
                collapsible
                open={openSections.excecoes}
                onOpenChange={(open) => setSectionOpen('excecoes', open)}
                summary={<span>{regrasExcecao.length} exceção(ões)</span>}
                bodyPadding="none"
                marker={<NivelMarker nivel="3a" descricao="Nível 3a: exceção por NCM, vence a alíquota base da UF" />}
                title="Exceções Tributárias por NCM"
                subtitle="Sobrescreve a alíquota padrão do estado. É superada pelas reduções por produto e pelo termo de acordo da empresa."
                headerAction={
                  <Button
                    size="sm"
                    className="bg-purple-700 hover:bg-purple-800 focus:ring-purple-700 text-white shadow-xs shadow-purple-700/20"
                    onClick={() => handleOpenCreateRegra('excecao')}
                    leftIcon={<Plus className="w-3.5 h-3.5" />}
                  >
                    Nova Exceção NCM
                  </Button>
                }
              >
                {isLoadingRegras ? (
                  <div className="p-5">
                    <LoadingSpinner size="sm" message="Carregando exceções..." />
                  </div>
                ) : regrasExcecao.length === 0 ? (
                  <div className="p-5">
                    <SectionEmpty
                      icon={<Zap className="h-6 w-6" />}
                      title="Nenhuma exceção por NCM"
                      hint="Os itens seguem a alíquota padrão da UF até que uma exceção seja cadastrada."
                      className="border-purple-200/80 bg-purple-50/20"
                      action={
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleOpenCreateRegra('excecao')}
                          leftIcon={<Plus className="h-3.5 w-3.5" />}
                        >
                          Cadastrar exceção por NCM
                        </Button>
                      }
                    />
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs divide-y divide-purple-100/60">
                      <thead className="bg-purple-50/50 text-purple-900 font-bold uppercase tracking-wider text-[10px]">
                        <tr>
                          <th className="py-3 px-4">Estado</th>
                          <th className="py-3 px-4 font-mono">NCM (8 dígitos)</th>
                          <th className="py-3 px-4">Precedência</th>
                          <th className="py-3 px-4 font-mono text-right">A.DST Específica</th>
                          <th className="py-3 px-4">Descrição da Exceção</th>
                          <th className="py-3 px-4 text-right">Ações</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-purple-100/40">
                        {regrasExcecao.map((regra) => (
                          <tr key={regra.id} className="hover:bg-purple-50/30 transition-colors">
                            <td className="py-3 px-4 font-bold text-slate-800">
                              {regra.uf}
                            </td>
                            <td className="py-3 px-4 font-mono font-bold text-purple-900">
                              {regra.ncm}
                            </td>
                            <td className="py-3 px-4">
                              <Badge variant="purple" size="sm">
                                <Zap className="w-3 h-3 text-purple-600 shrink-0" />
                                <span>Exceção Prioritária</span>
                              </Badge>
                            </td>
                            <td className="py-3 px-4 font-mono font-bold text-purple-950 text-right tabular-nums">
                              {formatPercent(regra.aliquota)}
                            </td>
                            <td className="py-3 px-4 text-slate-600">
                              {regra.descricao || '-'}
                            </td>
                            <td className="py-3 px-4 text-right">
                              <div className="flex items-center justify-end gap-1">
                                <button
                                  type="button"
                                  onClick={() => handleOpenEditRegra(regra)}
                                  className="p-1.5 text-slate-400 hover:text-purple-800 hover:bg-purple-50 rounded-lg transition-colors cursor-pointer"
                                  title="Editar exceção"
                                  aria-label={`Editar exceção NCM ${regra.ncm}`}
                                >
                                  <Edit2 className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setRegraParaExcluir(regra)}
                                  className="p-1.5 text-slate-400 hover:text-rose-700 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
                                  title="Remover exceção"
                                  aria-label={`Remover exceção NCM ${regra.ncm}`}
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

              {/* Nível 3b — alíquota base da UF */}
              <Card
                collapsible
                open={openSections.padrao}
                onOpenChange={(open) => setSectionOpen('padrao', open)}
                summary={<span>{regrasPadrao.length} regra(s)</span>}
                bodyPadding="none"
                marker={<NivelMarker nivel="3b" descricao="Nível 3b: alíquota base da UF" />}
                title="Alíquotas Padrão por Estado"
                subtitle="Alíquota base do estado. Vale quando não há redução por produto, termo de acordo nem exceção de NCM."
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
                  <div className="p-5">
                    <LoadingSpinner size="sm" message="Carregando regras estaduais..." />
                  </div>
                ) : regrasPadrao.length === 0 ? (
                  <div className="p-5">
                    <SectionEmpty
                      icon={<Percent className="h-6 w-6" />}
                      title="Nenhuma alíquota padrão neste perfil"
                      hint="Sem a alíquota base da UF, itens que não casam com nenhuma regra ficam sem A.DST."
                      action={
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleOpenCreateRegra('padrao')}
                          leftIcon={<Plus className="h-3.5 w-3.5" />}
                        >
                          Cadastrar alíquota da UF
                        </Button>
                      }
                    />
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs divide-y divide-slate-100">
                      <thead className="bg-slate-50/70 text-slate-500 font-bold uppercase tracking-wider text-[10px]">
                        <tr>
                          <th className="py-3 px-4">Estado</th>
                          <th className="py-3 px-4">Tipo</th>
                          <th className="py-3 px-4 font-mono text-right">A.DST Padrão</th>
                          <th className="py-3 px-4">Descrição / Legislação</th>
                          <th className="py-3 px-4 text-right">Ações</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100/80">
                        {regrasPadrao.map((regra) => (
                          <tr key={regra.id} className="hover:bg-slate-50/70 transition-colors">
                            <td className="py-3 px-4">
                              <span className="font-bold text-slate-800 bg-slate-100 px-2 py-0.5 rounded text-[11px] border border-slate-200">
                                {regra.uf}
                              </span>
                            </td>
                            <td className="py-3 px-4">
                              <Badge variant="info" size="sm">
                                Padrão Estadual
                              </Badge>
                            </td>
                            <td className="py-3 px-4 font-mono font-bold text-blue-950 text-right tabular-nums">
                              {formatPercent(regra.aliquota)}
                            </td>
                            <td className="py-3 px-4 text-slate-600">
                              {regra.descricao || '-'}
                            </td>
                            <td className="py-3 px-4 text-right">
                              <div className="flex items-center justify-end gap-1">
                                <button
                                  type="button"
                                  onClick={() => handleOpenEditRegra(regra)}
                                  className="p-1.5 text-slate-400 hover:text-blue-700 hover:bg-blue-50 rounded-lg transition-colors cursor-pointer"
                                  title="Editar regra"
                                  aria-label={`Editar regra padrão de ${regra.uf}`}
                                >
                                  <Edit2 className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setRegraParaExcluir(regra)}
                                  className="p-1.5 text-slate-400 hover:text-rose-700 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
                                  title="Remover regra"
                                  aria-label={`Remover regra padrão de ${regra.uf}`}
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

              {/* Modificador da A.ORI, aplicado depois que o nível é resolvido */}
              {(() => {
                const limitarAori = Boolean(activePerfil.configuracoes_extras?.limitar_a_ori_reducoes);
                return (
                  <Card
                    collapsible
                    open={openSections.limiteAori}
                    onOpenChange={(open) => setSectionOpen('limiteAori', open)}
                    title="Limitar Alíquota de Origem (A.ORI) a 10%"
                    subtitle="Aplica o limite somente a itens calculados sob Redução por Produto ou Termo de Acordo."
                    summary={
                      limitarAori
                        ? <Badge variant="success" size="sm">Ativo</Badge>
                        : <Badge variant="neutral" size="sm">Inativo</Badge>
                    }
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                      <div className="space-y-2 min-w-0">
                        <p className="text-xs text-slate-500 leading-relaxed max-w-2xl">
                          Alíquotas interestaduais superiores a 10% (como 12%) são automaticamente
                          limitadas a <strong>10%</strong> na planilha e no cálculo fiscal. Alíquotas
                          de 7% ou 4% permanecem conforme a nota.
                        </p>
                        <div className="min-h-4">
                          {aOriFeedback === 'saving' && (
                            <span className="text-[11px] text-blue-600 font-semibold animate-pulse">Salvando...</span>
                          )}
                          {aOriFeedback === 'saved' && (
                            <span className="text-[11px] text-emerald-600 font-semibold inline-flex items-center gap-1">
                              <Check className="w-3 h-3" /> Salvo
                            </span>
                          )}
                          {aOriFeedback === 'error' && (
                            <span className="text-[11px] text-rose-600 font-semibold">
                              {aOriError || 'Erro ao salvar'}
                            </span>
                          )}
                        </div>
                      </div>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={limitarAori}
                        disabled={isTogglingAliquotaOrigem}
                        onClick={() => toggleLimitarAliquotaOrigem(activePerfil)}
                        className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2 ${
                          limitarAori ? 'bg-blue-600' : 'bg-slate-200'
                        } ${isTogglingAliquotaOrigem ? 'opacity-60 cursor-not-allowed' : ''}`}
                      >
                        <span
                          className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-md ring-0 transition duration-200 ease-in-out ${
                            limitarAori ? 'translate-x-5' : 'translate-x-0'
                          }`}
                        />
                      </button>
                    </div>
                  </Card>
                );
              })()}
              </section>

              <section className="space-y-4">
                <GroupHeading
                  icon={<Layers className="h-4 w-4" />}
                  title="Antecipação"
                  hint="O que entra e o que fica de fora da apuração."
                />
              {/* O que sai da apuração da Parcial */}
              <ExclusaoParcialSection
                perfilId={activePerfil.id}
                open={openSections.exclusoes}
                onOpenChange={(open) => setSectionOpen('exclusoes', open)}
              />

              {/* Exclusão por condição numérica, quando A.ORI = A.DST */}
              {(() => {
                const extras = activePerfil.configuracoes_extras || {};
                const aliqIguaisBa = typeof extras.politica_aliquotas_iguais_parcial === 'object' && extras.politica_aliquotas_iguais_parcial !== null
                  ? Boolean((extras.politica_aliquotas_iguais_parcial as Record<string, boolean>)['BA'])
                  : extras.politica_aliquotas_iguais_parcial === true;
                return (
                  <Card
                    collapsible
                    open={openSections.aliquotasIguais}
                    onOpenChange={(open) => setSectionOpen('aliquotasIguais', open)}
                    title="Condição Numérica de Alíquotas Iguais (BA)"
                    subtitle="Trata itens da Antecipação Parcial quando A.ORI e A.DST são iguais."
                    summary={
                      aliqIguaisBa
                        ? <Badge variant="success" size="sm">Ativo (BA)</Badge>
                        : <Badge variant="neutral" size="sm">Inativo</Badge>
                    }
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                      <div className="space-y-2 min-w-0">
                        <p className="text-xs text-slate-500 leading-relaxed max-w-2xl">
                          Calcula o item individualmente. Se o valor devido final resultar em
                          <strong> R$ 0,00 ou negativo</strong>, o item é excluído com registro de conferência.
                          Se houver diferença positiva por IPI, frete ou outras bases, o item permanece na apuração.
                        </p>
                        <div className="min-h-4">
                          {aliqIguaisFeedback === 'saving' && (
                            <span className="text-[11px] text-blue-600 font-semibold animate-pulse">Salvando...</span>
                          )}
                          {aliqIguaisFeedback === 'saved' && (
                            <span className="text-[11px] text-emerald-600 font-semibold inline-flex items-center gap-1">
                              <Check className="w-3 h-3" /> Salvo
                            </span>
                          )}
                          {aliqIguaisFeedback === 'error' && (
                            <span className="text-[11px] text-rose-600 font-semibold">
                              {aliqIguaisError || 'Erro ao salvar'}
                            </span>
                          )}
                        </div>
                      </div>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={aliqIguaisBa}
                        disabled={isTogglingAliquotaOrigem}
                        onClick={() => togglePoliticaAliquotasIguais(activePerfil, 'BA')}
                        className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2 ${
                          aliqIguaisBa ? 'bg-blue-600' : 'bg-slate-200'
                        } ${isTogglingAliquotaOrigem ? 'opacity-60 cursor-not-allowed' : ''}`}
                      >
                        <span
                          className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-md ring-0 transition duration-200 ease-in-out ${
                            aliqIguaisBa ? 'translate-x-5' : 'translate-x-0'
                          }`}
                        />
                      </button>
                    </div>
                  </Card>
                );
              })()}

              {/* MVA da antecipação tributária, vinculada ao CNPJ autorizado */}
              <MvaAntecipacaoSection
                perfil={activePerfil}
                open={openSections.mva}
                onOpenChange={(open) => setSectionOpen('mva', open)}
              />
              </section>

              <section className="space-y-4">
                <GroupHeading
                  icon={<Route className="h-4 w-4" />}
                  title="Roteamento de itens"
                  hint="Em qual planilha cada item da nota é lançado."
                />
              {/* Destino de cada item na planilha */}
              <Card
                collapsible
                open={openSections.cfop}
                onOpenChange={(open) => setSectionOpen('cfop', open)}
                summary={<span>{regrasCfopEfetivas.length} rota(s)</span>}
                bodyPadding="none"
                title="Roteamento por CFOP"
                subtitle="Define em qual planilha cada item da nota entra a partir do CFOP, e reclassifica produtos específicos por NCM."
                headerAction={
                  cfopTab === 'geral' ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleOpenCreateRegraCfop}
                      leftIcon={<Plus className="w-3.5 h-3.5" />}
                    >
                      Nova Exceção de CFOP
                    </Button>
                  ) : null
                }
              >
                <div className="p-5 pb-0">
                  <Tabs
                    tabs={[
                      { id: 'geral', label: 'Roteamento Geral (Sufixo CFOP → Planilha)' },
                      { id: 'reclassificacao', label: 'Reclassificação por NCM / Produto' },
                    ]}
                    activeTab={cfopTab}
                    onChange={(id) => setCfopTab(id as 'geral' | 'reclassificacao')}
                    className="mb-4"
                  />
                </div>

                {cfopTab === 'geral' && (
                  isLoadingRegrasCfop ? (
                    <div className="p-5">
                      <LoadingSpinner size="sm" message="Carregando regras de CFOP..." />
                    </div>
                  ) : regrasCfopEfetivas.length === 0 ? (
                    <div className="p-5">
                      <SectionEmpty
                        icon={<Route className="h-6 w-6" />}
                        title="Nenhuma regra de CFOP cadastrada"
                        hint="Sem regras, todos os itens seguem o roteamento padrão do sistema."
                        action={
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={handleOpenCreateRegraCfop}
                            leftIcon={<Plus className="h-3.5 w-3.5" />}
                          >
                            Cadastrar exceção de CFOP
                          </Button>
                        }
                      />
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs divide-y divide-slate-100">
                        <thead className="bg-slate-50/70 text-slate-500 font-bold uppercase tracking-wider text-[10px]">
                          <tr>
                            <th className="py-3 px-4 font-mono">CFOP (sufixo)</th>
                            <th className="py-3 px-4">Planilha de Destino</th>
                            <th className="py-3 px-4">Origem</th>
                            <th className="py-3 px-4">Descrição</th>
                            <th className="py-3 px-4 text-right">Ações</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100/80">
                          {regrasCfopEfetivas.map((regra) => (
                            <tr key={regra.cfop_sufixo} className="hover:bg-slate-50/70 transition-colors">
                              <td className="py-3 px-4">
                                <span className="font-bold text-slate-800 bg-slate-100 px-2 py-0.5 rounded text-[11px] border border-slate-200">
                                  {regra.cfop_sufixo}
                                </span>
                              </td>
                              <td className="py-3 px-4">
                                <Badge variant={DESTINO_CFOP_BADGE_VARIANTS[regra.destino]} size="sm">
                                  {DESTINO_CFOP_LABELS[regra.destino]}
                                </Badge>
                              </td>
                              <td className="py-3 px-4">
                                {regra.origem === 'perfil' ? (
                                  <Badge variant="purple" size="sm">
                                    <Zap className="w-3 h-3 text-purple-600 shrink-0" />
                                    <span>Exceção deste perfil</span>
                                  </Badge>
                                ) : (
                                  <Badge variant="neutral" size="sm">Padrão do sistema</Badge>
                                )}
                              </td>
                              <td className="py-3 px-4 text-slate-600">
                                {regra.descricao || '-'}
                              </td>
                              <td className="py-3 px-4 text-right">
                                <div className="flex items-center justify-end gap-1">
                                  <button
                                    type="button"
                                    onClick={() => handleOpenEditRegraCfop(regra)}
                                    className="p-1.5 text-slate-400 hover:text-blue-700 hover:bg-blue-50 rounded-lg transition-colors cursor-pointer"
                                    title={regra.origem === 'perfil' ? 'Editar exceção' : 'Sobrescrever para este perfil'}
                                    aria-label={`Editar regra de CFOP ${regra.cfop_sufixo}`}
                                  >
                                    <Edit2 className="w-3.5 h-3.5" />
                                  </button>
                                  {regra.origem === 'perfil' && (
                                    <button
                                      type="button"
                                      onClick={() => setRegraCfopParaExcluir(regra)}
                                      className="p-1.5 text-slate-400 hover:text-rose-700 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
                                      title="Remover exceção"
                                      aria-label={`Remover regra de CFOP ${regra.cfop_sufixo}`}
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
                  )
                )}
                {cfopTab === 'reclassificacao' && (
                  <div className="p-5 pt-0">
                    <ReclassificacaoCfopSection perfilId={activePerfil.id} />
                  </div>
                )}
              </Card>
              </section>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Modal Perfil */}
      <Modal
        isOpen={perfilModalOpen}
        onClose={() => setPerfilModalOpen(false)}
        title={duplicatingPerfil ? 'Duplicar Perfil de Regras' : editingPerfil ? 'Editar Perfil de Regras' : 'Novo Perfil de Regras'}
        subtitle={duplicatingPerfil ? `Cópia de ${duplicatingPerfil.nome}: inclui todas as regras, exceções e configurações. As empresas permanecem no perfil original.` : "Perfis agrupam conjuntos de regras e alíquotas compartilhados entre várias empresas"}
      >
        {errorMessage && <ErrorAlert message={errorMessage} onDismiss={() => setErrorMessage(null)} />}
        <form onSubmit={submitPerfil} className="space-y-4">
          <Input
            label="Nome do Perfil"
            placeholder="Ex: Comércio Varejista BA - Geral"
            {...registerPerfil('nome')}
            error={errorsPerfil.nome?.message}
          />
          {!duplicatingPerfil && <>
          <Input
            label="Descrição (Opcional)"
            placeholder="Ex: Perfil padrão para empresas de vestuário e calçados"
            {...registerPerfil('descricao')}
            error={errorsPerfil.descricao?.message}
          />
          <div className="p-3.5 rounded-xl border border-slate-200/90 bg-slate-50/70 flex items-start gap-3">
            <input
              type="checkbox"
              id="limitar_a_ori_reducoes"
              {...registerPerfil('limitar_a_ori_reducoes')}
              className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
            />
            <label htmlFor="limitar_a_ori_reducoes" className="text-xs text-slate-700 select-none cursor-pointer">
              <span className="font-bold text-slate-900 block mb-0.5">
                Limitar Alíquota de Origem (A.ORI) a 10% em Reduções e Termo de Acordo
              </span>
              <span className="text-slate-500 leading-relaxed block">
                Quando ativo, alíquotas interestaduais superiores a 10% (como 12%) são automaticamente limitadas a 10% nos cálculos fiscais e no preenchimento da planilha para itens de notas sob Redução ou Termo de Acordo.
              </span>
            </label>
          </div>
          </>}
          <div className="pt-4 border-t border-slate-100 flex justify-end gap-3">
            <Button type="button" variant="outline" onClick={() => setPerfilModalOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" isLoading={isSubmittingPerfil}>
              {duplicatingPerfil ? 'Duplicar Perfil' : 'Salvar Perfil'}
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
        <form onSubmit={submitRegra} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-700 mb-2">
              Tipo da Regra
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label
                className={`flex items-center gap-2 p-3.5 rounded-xl border cursor-pointer text-xs font-semibold transition-all ${
                  tipoRegraWatch === 'padrao'
                    ? 'bg-blue-50 border-blue-600 text-blue-950 font-bold shadow-2xs'
                    : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
              >
                <input
                  type="radio"
                  value="padrao"
                  className="text-blue-600 focus:ring-blue-500 h-4 w-4"
                  {...registerRegra('tipo_regra')}
                />
                <span>Padrão do Estado (UF)</span>
              </label>

              <label
                className={`flex items-center gap-2 p-3.5 rounded-xl border cursor-pointer text-xs font-semibold transition-all ${
                  tipoRegraWatch === 'excecao'
                    ? 'bg-purple-50 border-purple-600 text-purple-950 font-bold shadow-2xs'
                    : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
              >
                <input
                  type="radio"
                  value="excecao"
                  className="text-purple-600 focus:ring-purple-500 h-4 w-4"
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
        <form onSubmit={submitRegraCfop} className="space-y-4">
          <Input
            label="CFOP (3 últimos dígitos ou completo)"
            placeholder="Ex: 102 ou 6102"
            maxLength={4}
            {...registerRegraCfop('cfop_sufixo')}
            error={errorsRegraCfop.cfop_sufixo?.message}
            helperText="O mesmo sufixo casa tanto com o CFOP de saída do XML (6xxx) quanto com o de entrada do SPED (2xxx)"
          />

          <div>
            <Select
              label="Planilha de Destino"
              options={(Object.keys(DESTINO_CFOP_LABELS) as DestinoCfop[]).map((d) => ({
                value: d,
                label: DESTINO_CFOP_LABELS[d],
              }))}
              {...registerRegraCfop('destino')}
            />
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

      {/* Confirmação de Exclusão de Perfil */}
      <ConfirmDialog
        isOpen={Boolean(perfilParaExcluir)}
        onClose={cancelDeletePerfil}
        onConfirm={confirmDeletePerfil}
        title="Excluir Perfil de Regras"
        message={`Tem certeza de que deseja remover o perfil "${perfilParaExcluir?.nome}"? Todas as regras deste perfil serão removidas permanentemente.`}
        confirmLabel="Sim, Excluir Perfil"
        cancelLabel="Cancelar"
        variant="danger"
        isLoading={isDeletingPerfil}
      />

      {/* Confirmação de Exclusão de Regra Alíquota */}
      <ConfirmDialog
        isOpen={Boolean(regraParaExcluir)}
        onClose={cancelDeleteRegra}
        onConfirm={confirmDeleteRegra}
        title="Excluir Regra de Alíquota"
        message={`Tem certeza de que deseja remover a regra para o estado "${regraParaExcluir?.uf}" ${regraParaExcluir?.ncm ? `(NCM ${regraParaExcluir.ncm})` : '(padrão)'}?`}
        confirmLabel="Sim, Excluir Regra"
        cancelLabel="Cancelar"
        variant="danger"
        isLoading={isDeletingRegra}
      />

      {/* Confirmação de Exclusão de Regra CFOP */}
      <ConfirmDialog
        isOpen={Boolean(regraCfopParaExcluir)}
        onClose={cancelDeleteRegraCfop}
        onConfirm={confirmDeleteRegraCfop}
        title="Remover Exceção de CFOP"
        message={`Tem certeza de que deseja remover a exceção para o CFOP ${regraCfopParaExcluir?.cfop_sufixo}? O roteamento voltará ao padrão do sistema.`}
        confirmLabel="Sim, Remover Exceção"
        cancelLabel="Cancelar"
        variant="danger"
        isLoading={isDeletingRegraCfop}
      />
    </div>
  );
};
