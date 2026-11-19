import React, { useEffect, useState } from 'react';
import {
  Sliders,
  Plus,
  Edit2,
  Trash2,
  Sparkles,
  Zap,
  Percent,
  Layers,
  Route,
} from 'lucide-react';

import { getErrorMessage } from '../../api/client';
import { Button } from '../../components/ui/Button';
import { Tabs } from '../../components/ui/Tabs';
import { Badge } from '../../components/ui/Badge';
import { Card } from '../../components/ui/Card';
import { LoadingSpinner } from '../../components/feedback/LoadingSpinner';
import { EmptyState } from '../../components/feedback/EmptyState';
import { SectionEmpty } from '../../components/feedback/SectionEmpty';
import { ErrorAlert } from '../../components/feedback/ErrorAlert';
import { PageHeader } from '../../components/layout/PageHeader';
import { DESTINO_CFOP_BADGE_VARIANTS, DESTINO_CFOP_LABELS } from '../../constants/domain';
import { usePerfisRegrasPage } from './usePerfisRegrasPage';
import { ReducaoProdutoSection } from './ReducaoProdutoSection';
import { FcpSection } from './FcpSection';
import { ReclassificacaoCfopSection } from './ReclassificacaoCfopSection';
import { ExclusaoParcialSection } from './ExclusaoParcialSection';
import { MvaAntecipacaoSection } from './MvaAntecipacaoSection';
import { Convenio5291Section } from './Convenio5291Section';
import { PerfilList } from './PerfilList';
import { CopiarRegrasButton } from './CopiarRegrasButton';

import {
  AliquotasPadraoCard,
  ExcecoesNcmCard,
  NivelMarker,
  PolicySwitchCard,
} from './AliquotasSectionCards';
import { PerfisRegrasModals } from './PerfisRegrasModals';

type SectionKey =
  | 'limiteAori'
  | 'aliquotasIguais'
  | 'reducoes'
  | 'fcp'
  | 'convenio5291'
  | 'convenio5291Agricola'
  | 'exclusoes'
  | 'mva'
  | 'padrao'
  | 'excecoes'
  | 'cfop';

// Ordem de leitura da página: primeiro a cadeia que resolve a A.DST,
// depois a antecipação e por fim o roteamento dos itens.
const SECTION_KEYS: SectionKey[] = [
  'reducoes',
  'fcp',
  'convenio5291',
  'convenio5291Agricola',
  'excecoes',
  'padrao',
  'limiteAori',
  'exclusoes',
  'aliquotasIguais',
  'mva',
  'cfop',
];

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
  fcp: false,
  convenio5291: false,
  convenio5291Agricola: false,
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

              <Convenio5291Section
                perfil={activePerfil}
                open={openSections.convenio5291}
                onOpenChange={(open) => setSectionOpen('convenio5291', open)}
              />
              <Convenio5291Section
                key={`${activePerfil.id}-agricola`}
                anexo="II"
                perfil={activePerfil}
                open={openSections.convenio5291Agricola}
                onOpenChange={(open) => setSectionOpen('convenio5291Agricola', open)}
              />

              {/* Nível 3a — exceção por NCM, sobrescreve a base da UF */}
              <ExcecoesNcmCard
                perfilId={activePerfil.id}
                open={openSections.excecoes}
                onOpenChange={(open) => setSectionOpen('excecoes', open)}
                isLoading={isLoadingRegras}
                regras={regrasExcecao}
                onCreate={() => handleOpenCreateRegra('excecao')}
                onEdit={handleOpenEditRegra}
                onDelete={setRegraParaExcluir}
              />

              {/* Nível 3b — alíquota base da UF */}
              <AliquotasPadraoCard
                perfilId={activePerfil.id}
                open={openSections.padrao}
                onOpenChange={(open) => setSectionOpen('padrao', open)}
                isLoading={isLoadingRegras}
                regras={regrasPadrao}
                onCreate={() => handleOpenCreateRegra('padrao')}
                onEdit={handleOpenEditRegra}
                onDelete={setRegraParaExcluir}
              />

              {/* Modificador da A.ORI, aplicado depois que o nível é resolvido */}
              <PolicySwitchCard
                open={openSections.limiteAori}
                onOpenChange={(open) => setSectionOpen('limiteAori', open)}
                title="Limitar Alíquota de Origem (A.ORI) a 10%"
                subtitle="Aplica o limite somente a itens calculados sob Redução por Produto ou Termo de Acordo. Na Antecipação Parcial, não se aplica quando a A.ORI do XML é igual à A.DST."
                checked={Boolean(activePerfil.configuracoes_extras?.limitar_a_ori_reducoes)}
                description={
                  <>
                    Alíquotas interestaduais superiores a 10% (como 12%) são automaticamente
                    limitadas a <strong>10%</strong> na planilha e no cálculo fiscal. Alíquotas
                    de 7% ou 4% permanecem conforme a nota.
                  </>
                }
                feedback={aOriFeedback}
                error={aOriError}
                disabled={isTogglingAliquotaOrigem}
                onToggle={() => toggleLimitarAliquotaOrigem(activePerfil)}
              />

              {/* Regras de FCP (adicional apurado em aba separada) */}
              <FcpSection
                perfilId={activePerfil.id}
                open={openSections.fcp}
                onOpenChange={(open) => setSectionOpen('fcp', open)}
              />
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
              <PolicySwitchCard
                open={openSections.aliquotasIguais}
                onOpenChange={(open) => setSectionOpen('aliquotasIguais', open)}
                title="Condição Numérica de Alíquotas Iguais (BA)"
                subtitle="Trata itens da Antecipação Parcial quando A.ORI e A.DST são iguais."
                checked={(() => {
                  const extras = activePerfil.configuracoes_extras || {};
                  return typeof extras.politica_aliquotas_iguais_parcial === 'object' && extras.politica_aliquotas_iguais_parcial !== null
                    ? Boolean((extras.politica_aliquotas_iguais_parcial as Record<string, boolean>)['BA'])
                    : extras.politica_aliquotas_iguais_parcial === true;
                })()}
                activeLabel="Ativo (BA)"
                description={
                  <>
                    Calcula o item individualmente. Se o valor devido final resultar em
                    <strong> R$ 0,00 ou negativo</strong>, o item é excluído com registro de conferência.
                    Se houver diferença positiva por IPI, frete ou outras bases, o item permanece na apuração.
                  </>
                }
                feedback={aliqIguaisFeedback}
                error={aliqIguaisError}
                disabled={isTogglingAliquotaOrigem}
                onToggle={() => togglePoliticaAliquotasIguais(activePerfil, 'BA')}
              />

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
                    <>
                      <CopiarRegrasButton perfilId={activePerfil.id} secao="cfop" regraIds={regrasCfopEfetivas.filter((r) => r.origem === 'perfil').map((r) => r.regra_id)} label="Copiar para..." descricao="Copia as exceções de roteamento por CFOP cadastradas neste perfil." />
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={handleOpenCreateRegraCfop}
                        leftIcon={<Plus className="w-3.5 h-3.5" />}
                      >
                        Nova Exceção de CFOP
                      </Button>
                    </>
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
                                  {regra.origem === 'perfil' && (
                                    <CopiarRegrasButton perfilId={activePerfil.id} secao="cfop" regraIds={[regra.regra_id]} descricao="Copia esta regra de roteamento por CFOP." />
                                  )}
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

      <PerfisRegrasModals
        activePerfil={activePerfil}
        errorMessage={errorMessage}
        setErrorMessage={setErrorMessage}
        perfilModalOpen={perfilModalOpen}
        setPerfilModalOpen={setPerfilModalOpen}
        editingPerfil={editingPerfil}
        duplicatingPerfil={duplicatingPerfil}
        submitPerfil={submitPerfil}
        registerPerfil={registerPerfil}
        errorsPerfil={errorsPerfil}
        isSubmittingPerfil={isSubmittingPerfil}
        regraModalOpen={regraModalOpen}
        setRegraModalOpen={setRegraModalOpen}
        editingRegra={editingRegra}
        tipoRegraWatch={tipoRegraWatch}
        submitRegra={submitRegra}
        registerRegra={registerRegra}
        errorsRegra={errorsRegra}
        isSubmittingRegra={isSubmittingRegra}
        regraCfopModalOpen={regraCfopModalOpen}
        setRegraCfopModalOpen={setRegraCfopModalOpen}
        editingRegraCfop={editingRegraCfop}
        submitRegraCfop={submitRegraCfop}
        registerRegraCfop={registerRegraCfop}
        errorsRegraCfop={errorsRegraCfop}
        isSubmittingRegraCfop={isSubmittingRegraCfop}
        perfilParaExcluir={perfilParaExcluir}
        confirmDeletePerfil={confirmDeletePerfil}
        cancelDeletePerfil={cancelDeletePerfil}
        isDeletingPerfil={isDeletingPerfil}
        regraParaExcluir={regraParaExcluir}
        confirmDeleteRegra={confirmDeleteRegra}
        cancelDeleteRegra={cancelDeleteRegra}
        isDeletingRegra={isDeletingRegra}
        regraCfopParaExcluir={regraCfopParaExcluir}
        confirmDeleteRegraCfop={confirmDeleteRegraCfop}
        cancelDeleteRegraCfop={cancelDeleteRegraCfop}
        isDeletingRegraCfop={isDeletingRegraCfop}
      />
    </div>
  );
};
