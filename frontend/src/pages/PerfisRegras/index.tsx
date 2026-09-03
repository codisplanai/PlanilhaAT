import React from 'react';
import {
  Sliders,
  Plus,
  Edit2,
  Trash2,
  Sparkles,
  Zap,
} from 'lucide-react';

import { getErrorMessage } from '../../api/client';
import type { DestinoCfop } from '../../types/regraCfop';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Select } from '../../components/ui/Select';
import { Modal } from '../../components/ui/Modal';
import { Badge } from '../../components/ui/Badge';
import { Card } from '../../components/ui/Card';
import { LoadingSpinner } from '../../components/feedback/LoadingSpinner';
import { EmptyState } from '../../components/feedback/EmptyState';
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

export const PerfisRegrasPage: React.FC = () => {
  const {
    perfis,
    perfisQuery: { isLoading: isLoadingPerfis, error: errorPerfis },
    activePerfil,
    setSelectedPerfilId,
    regrasPadrao,
    regrasExcecao,
    isLoadingRegras,
    regrasCfopEfetivas,
    isLoadingRegrasCfop,
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
    openCreatePerfil: handleOpenCreatePerfil,
    openEditPerfil: handleOpenEditPerfil,
    deletePerfil,
    submitPerfil,
    registerPerfil,
    errorsPerfil,
    isSubmittingPerfil,
    openCreateRegra: handleOpenCreateRegra,
    openEditRegra: handleOpenEditRegra,
    deleteRegra,
    submitRegra,
    registerRegra,
    errorsRegra,
    isSubmittingRegra,
    tipoRegraWatch,
    openCreateRegraCfop: handleOpenCreateRegraCfop,
    openEditRegraCfop: handleOpenEditRegraCfop,
    deleteRegraCfop,
    submitRegraCfop,
    registerRegraCfop,
    errorsRegraCfop,
    isSubmittingRegraCfop,
  } = usePerfisRegrasPage();

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
          {/* Coluna Esquerda: Seletor de Perfis */}
          <div className="lg:col-span-4 space-y-3">
            <div className="flex items-center justify-between px-1">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">
                Perfis Compartilhados ({perfis.length})
              </h3>
            </div>

            <div className="space-y-2">
              {perfis.map((p) => {
                const isSelected = activePerfil?.id === p.id;
                return (
                  <div
                    key={p.id}
                    onClick={() => setSelectedPerfilId(p.id)}
                    className={`p-4 rounded-xl border text-left cursor-pointer transition-all duration-150 ${
                      isSelected
                        ? 'bg-blue-50/80 border-blue-600 shadow-xs ring-2 ring-blue-600/20'
                        : 'bg-white border-slate-200/80 hover:border-slate-300 hover:bg-slate-50/60'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <h4
                        className={`text-xs sm:text-sm font-bold tracking-tight ${
                          isSelected ? 'text-blue-950' : 'text-slate-900'
                        }`}
                      >
                        {p.nome}
                      </h4>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleOpenEditPerfil(p);
                          }}
                          className="p-1 rounded-md text-slate-400 hover:text-blue-700 hover:bg-blue-50 transition-colors cursor-pointer"
                          title="Editar perfil"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        {perfis.length > 1 && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (confirm(`Deseja remover o perfil "${p.nome}"?`)) {
                                deletePerfil(p.id);
                              }
                            }}
                            className="p-1 rounded-md text-slate-400 hover:text-rose-700 hover:bg-rose-50 transition-colors cursor-pointer"
                            title="Remover perfil"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                    {p.descricao && (
                      <p className="text-xs text-slate-500 mt-1 line-clamp-2 leading-relaxed">{p.descricao}</p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Coluna Direita: Detalhes das Regras do Perfil Selecionado */}
          {activePerfil && (
            <div className="lg:col-span-8 space-y-6 animate-fade-in">
              {/* Card Explicativo de Precedência Fiscal */}
              <div className="bg-slate-950 text-slate-200 rounded-xl p-4 shadow-xs border border-slate-800 text-xs flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg bg-amber-500/20 border border-amber-400/30 text-amber-400 flex items-center justify-center shrink-0 mt-0.5">
                  <Sparkles className="w-4 h-4" />
                </div>
                <div className="leading-relaxed">
                  <span className="font-bold text-white tracking-tight">Como o motor resolve a alíquota (A.DST): </span>
                  O sistema resolve a A.DST em três níveis de precedência: <strong>1. Redução por Produto (NCM + Descrição)</strong> &gt; <strong>2. Termo de Acordo da Empresa</strong> &gt; <strong>3. Padrão do Estado (Exceção NCM ou Base UF)</strong>. A alíquota de origem (A.ORI) vem do XML/SPED.
                </div>
              </div>

              {/* Seção 0: Reduções por Produto (NCM + Descrição) */}
              <ReducaoProdutoSection perfilId={activePerfil.id} />

              {/* Seção 1: Regras Padrão por Estado */}
              <Card
                title={`Alíquotas Padrão por Estado — ${activePerfil.nome}`}
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
                  <LoadingSpinner size="sm" message="Carregando regras estaduais..." />
                ) : regrasPadrao.length === 0 ? (
                  <p className="text-xs text-slate-500 italic py-6 text-center bg-slate-50/60 rounded-xl border border-dashed border-slate-200">
                    Nenhuma alíquota padrão configurada para este perfil. Clique em "Nova Regra Estadual" para definir a alíquota padrão da UF.
                  </p>
                ) : (
                  <div className="overflow-x-auto -mx-5 -my-5">
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
                                >
                                  <Edit2 className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (confirm(`Remover regra padrão de ${regra.uf}?`)) {
                                      deleteRegra(regra.id);
                                    }
                                  }}
                                  className="p-1.5 text-slate-400 hover:text-rose-700 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
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

              {/* Seção 2: Exceções por Estado + NCM */}
              <Card
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
                  <LoadingSpinner size="sm" message="Carregando exceções..." />
                ) : regrasExcecao.length === 0 ? (
                  <p className="text-xs text-slate-500 italic py-6 text-center bg-purple-50/20 rounded-xl border border-dashed border-purple-200/80">
                    Nenhuma exceção por NCM configurada. Itens serão calculados pela alíquota padrão da UF.
                  </p>
                ) : (
                  <div className="overflow-x-auto -mx-5 -my-5">
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
                                >
                                  <Edit2 className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (confirm(`Remover exceção NCM ${regra.ncm} para ${regra.uf}?`)) {
                                      deleteRegra(regra.id);
                                    }
                                  }}
                                  className="p-1.5 text-slate-400 hover:text-rose-700 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
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
                  <p className="text-xs text-slate-500 italic py-6 text-center bg-slate-50/60 rounded-xl border border-dashed border-slate-200">
                    Nenhuma regra de CFOP cadastrada.
                  </p>
                ) : (
                  <div className="overflow-x-auto -mx-5 -my-5">
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
                                >
                                  <Edit2 className="w-3.5 h-3.5" />
                                </button>
                                {regra.origem === 'perfil' && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      if (confirm(`Remover a exceção de CFOP ${regra.cfop_sufixo} deste perfil? Voltará a usar o padrão do sistema.`)) {
                                        deleteRegraCfop(regra.regra_id);
                                      }
                                    }}
                                    className="p-1.5 text-slate-400 hover:text-rose-700 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
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
        <form onSubmit={submitPerfil} className="space-y-4">
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
    </div>
  );
};
