import React from 'react';
import {
  Sliders,
  Plus,
  Edit2,
  Trash2,
  Sparkles,
  Zap
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
import { formatPercent } from '../../lib/formatters';
import {
  DESTINO_CFOP_BADGE_VARIANTS,
  DESTINO_CFOP_LABELS,
  UFS_BRASIL,
} from '../../constants/domain';
import { usePerfisRegrasPage } from './usePerfisRegrasPage';

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
                                deletePerfil(p.id);
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
                                      deleteRegra(regra.id);
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
                                      deleteRegra(regra.id);
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
                              <Badge variant={DESTINO_CFOP_BADGE_VARIANTS[regra.destino]} size="sm">
                                {DESTINO_CFOP_LABELS[regra.destino]}
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
                                        deleteRegraCfop(regra.regra_id);
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
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-700 mb-2">
              Planilha de Destino
            </label>
            <select
              className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-800 text-slate-900"
              {...registerRegraCfop('destino')}
            >
              {(Object.keys(DESTINO_CFOP_LABELS) as DestinoCfop[]).map((d) => (
                <option key={d} value={d}>{DESTINO_CFOP_LABELS[d]}</option>
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
