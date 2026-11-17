import React from 'react';
import {
  History,
  Download,
  Eye,
  Trash2,
  X,
} from 'lucide-react';

import { getErrorMessage } from '../../api/client';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { LoadingSpinner } from '../../components/feedback/LoadingSpinner';
import { EmptyState } from '../../components/feedback/EmptyState';
import { ErrorAlert } from '../../components/feedback/ErrorAlert';
import { PageHeader } from '../../components/layout/PageHeader';
import {
  formatCNPJ,
  formatDate,
  formatCompetencia,
} from '../../lib/formatters';
import { StatusBadge } from '../../components/domain/StatusBadge';
import { getPlanilhaLabel } from '../../constants/domain';
import { useOutletContext } from 'react-router-dom';
import type { User } from '../../types/auth';
import { HistoricoModals } from './HistoricoModals';
import { SolicitacaoDetalheModal } from './SolicitacaoDetalheModal';
import { useHistoricoPage } from './useHistoricoPage';

export const HistoricoPage: React.FC = () => {
  const outlet = useOutletContext<{ user?: User }>();
  const currentUser = outlet?.user ?? null;
  const {
    solicitacoesQuery: { data: solicitacoes = [], isLoading, error },
    empresasQuery: { error: empresasError },
    empresas,
    detailQuery: {
      data: solicitacaoDetalhada,
      isLoading: isLoadingDetalhes,
      error: detalhesError,
    },
    totals,
    empresaFilter,
    setEmpresaFilter,
    statusFilter,
    setStatusFilter,
    usuarioFilter,
    setUsuarioFilter,
    isAdminOrSenior,
    usuarios,
    availableLocalIds,
    selectedSolicitacaoId,
    editingNota,
    setEditingNota,
    manualDateInput,
    setManualDateInput,
    solicitacaoParaExcluir,
    setSolicitacaoParaExcluir,
    selectedIds,
    isAllSelected,
    isSomeSelected,
    solicitacoesSelecionadas,
    setSelectedSolicitacaoId,
    toggleSelect,
    toggleSelectAll,
    clearSelection,
    isBatchDeleteModalOpen,
    setBatchDeleteModalOpen,
    deleteBatchRequests,
    isDeletingBatch,
    entryDateError,
    setEntryDateError,
    deleteError,
    setDeleteError,
    downloadError,
    setDownloadError,
    openEntryDateEditor: handleOpenEditDataEntrada,
    saveEntryDate: handleSaveDataEntrada,
    isUpdatingEntryDate,
    deleteRequest,
    isDeletingRequest,
    downloadRequest: handleDownload,
    closeDetails,
    getEmpresa,
  } = useHistoricoPage(currentUser);

  const headerCheckboxRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (headerCheckboxRef.current) {
      headerCheckboxRef.current.indeterminate = isSomeSelected;
    }
  }, [isSomeSelected]);


  return (
    <div className="space-y-6">
      <PageHeader
        icon={<History className="w-5 h-5 text-blue-700" />}
        title={
          isAdminOrSenior
            ? 'Histórico Geral de Solicitações e Planilhas'
            : 'Histórico das Minhas Planilhas Geradas'
        }
        description={
          isAdminOrSenior
            ? 'Painel de gestão com todas as planilhas geradas pelos usuários da equipe'
            : 'Consulte o histórico estruturado e baixe as planilhas geradas por você nesta sessão'
        }
      />
      {empresasError && <ErrorAlert message={getErrorMessage(empresasError)} />}
      {downloadError && (
        <ErrorAlert
          title="Falha no Download"
          message={downloadError}
          onDismiss={() => setDownloadError(null)}
        />
      )}
      {deleteError && (
        <ErrorAlert
          title="Falha na Exclusão"
          message={deleteError}
          onDismiss={() => setDeleteError(null)}
        />
      )}

      {/* Filters Bar */}
      <Card className="p-3.5">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="flex-1">
            <label htmlFor="filtro-empresa" className="block text-xs font-semibold text-slate-700 mb-1">
              Empresa
            </label>
            <select
              id="filtro-empresa"
              aria-label="Filtrar por Empresa"
              value={empresaFilter || ''}
              onChange={(e) => setEmpresaFilter(e.target.value ? Number(e.target.value) : undefined)}
              className="w-full px-3 py-2 text-base sm:text-sm min-h-[40px] bg-slate-50/70 border border-slate-200/90 rounded-lg focus:bg-white focus:outline-none focus:ring-4 focus:ring-blue-500/15 focus:border-blue-600 text-slate-700 cursor-pointer transition-all"
            >
              <option value="">Todas as Empresas</option>
              {empresas.map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {emp.razao_social} ({formatCNPJ(emp.cnpj)})
                </option>
              ))}
            </select>
          </div>

          {isAdminOrSenior && (
            <div className="w-full sm:w-56">
              <label htmlFor="filtro-usuario" className="block text-xs font-semibold text-slate-700 mb-1">
                Usuário
              </label>
              <select
                id="filtro-usuario"
                aria-label="Filtrar por Usuário"
                value={usuarioFilter}
                onChange={(e) => setUsuarioFilter(e.target.value)}
                className="w-full px-3 py-2 text-base sm:text-sm min-h-[40px] bg-slate-50/70 border border-slate-200/90 rounded-lg focus:bg-white focus:outline-none focus:ring-4 focus:ring-blue-500/15 focus:border-blue-600 text-slate-700 cursor-pointer transition-all"
              >
                <option value="">Todos os Usuários</option>
                {usuarios.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.nome} ({u.cargo || u.role})
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="w-full sm:w-48">
            <label htmlFor="filtro-status" className="block text-xs font-semibold text-slate-700 mb-1">
              Status
            </label>
            <select
              id="filtro-status"
              aria-label="Filtrar por Status"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-full px-3 py-2 text-base sm:text-sm min-h-[40px] bg-slate-50/70 border border-slate-200/90 rounded-lg focus:bg-white focus:outline-none focus:ring-4 focus:ring-blue-500/15 focus:border-blue-600 text-slate-700 cursor-pointer transition-all"
            >
              <option value="">Todos os Status</option>
              <option value="pendente">Pendente</option>
              <option value="concluido">Concluída</option>
              <option value="processando">Processando</option>
              <option value="erro">Erro</option>
            </select>
          </div>
        </div>
      </Card>

      {/* Main Table Content */}
      {isLoading ? (
        <LoadingSpinner message="Carregando histórico de planilhas..." />
      ) : error ? (
        <ErrorAlert message={getErrorMessage(error)} />
      ) : solicitacoes.length === 0 ? (
        <EmptyState
          icon={<History className="w-7 h-7 text-blue-700" />}
          title="Nenhuma solicitação encontrada"
          description="Nenhuma planilha foi gerada para os filtros selecionados. Crie uma nova solicitação para processar arquivos XML."
        />
      ) : (
        <div className="bg-white border border-slate-200/80 rounded-xl shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs divide-y divide-slate-100">
              <thead className="bg-slate-50/70 text-slate-500 font-bold uppercase tracking-wider text-[10px]">
                <tr>
                  <th className="py-3.5 px-4 w-10 text-center">
                    <input
                      ref={headerCheckboxRef}
                      type="checkbox"
                      checked={isAllSelected}
                      onChange={toggleSelectAll}
                      className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer transition-colors"
                      title={isAllSelected ? 'Desmarcar todos' : 'Selecionar todos os visíveis'}
                      aria-label="Selecionar todas as solicitações visíveis"
                    />
                  </th>
                  <th className="py-3.5 px-4">Empresa</th>
                  {isAdminOrSenior && <th className="py-3.5 px-4">Gerado por</th>}
                  <th className="py-3.5 px-4">Competência / Período</th>
                  <th className="py-3.5 px-4">Tipo de Planilha</th>
                  <th className="py-3.5 px-4 text-center">Status</th>
                  <th className="py-3.5 px-4 text-center">Notas</th>
                  <th className="py-3.5 px-4">Data Solicitação</th>
                  <th className="py-3.5 px-4 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100/80">
                {solicitacoes.map((sol) => {
                  const emp = getEmpresa(sol.empresa_id);
                  const isSelected = selectedIds.has(sol.id);
                  return (
                    <tr
                      key={sol.id}
                      className={`transition-colors ${
                        isSelected ? 'bg-blue-50/50 hover:bg-blue-50/80' : 'hover:bg-slate-50/70'
                      }`}
                    >
                      <td className="py-3.5 px-4 w-10 text-center">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelect(sol.id)}
                          className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer transition-colors"
                          aria-label={`Selecionar planilha de ${emp?.razao_social || sol.id}`}
                        />
                      </td>
                      <td className="py-3.5 px-4 font-semibold text-slate-900">
                        <div>{emp?.razao_social || `Empresa #${sol.empresa_id}`}</div>
                        {emp && (
                          <div className="text-[11px] font-mono font-normal text-slate-400">
                            {formatCNPJ(emp.cnpj)}
                          </div>
                        )}
                      </td>
                      {isAdminOrSenior && (
                        <td className="py-3.5 px-4">
                          <span
                            className="font-semibold text-slate-900 block truncate max-w-[150px]"
                            title={sol.usuario_nome || sol.usuario_email || 'Usuário'}
                          >
                            {sol.usuario_nome || sol.usuario_email || '—'}
                          </span>
                          {sol.usuario_email && (
                            <span
                              className="text-[10px] text-slate-400 block truncate max-w-[150px]"
                              title={sol.usuario_email}
                            >
                              {sol.usuario_email}
                            </span>
                          )}
                        </td>
                      )}
                      <td className="py-3.5 px-4 text-slate-600">
                        <span className="font-semibold text-slate-800">
                          {formatCompetencia(sol.periodo_inicio)}
                        </span>
                        <span className="text-[10px] text-slate-400 block font-medium">
                          {formatDate(sol.periodo_inicio)} a {formatDate(sol.periodo_fim)}
                        </span>
                      </td>
                      <td className="py-3.5 px-4">
                        <span className="text-slate-800 font-semibold">{getPlanilhaLabel(sol.tipo_planilha)}</span>
                      </td>
                      <td className="py-3.5 px-4 text-center">
                        <StatusBadge status={sol.status} />
                      </td>
                      <td className="py-3.5 px-4 text-center font-mono font-bold text-slate-700">
                        {sol.total_notas_processadas}
                      </td>
                      <td className="py-3.5 px-4 text-slate-500 text-[11px]">
                        {formatDate(sol.criado_em)}
                      </td>
                      <td className="py-3.5 px-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setSelectedSolicitacaoId(sol.id)}
                            leftIcon={<Eye className="w-3.5 h-3.5" />}
                          >
                            Conferir
                          </Button>

                          {sol.status === 'concluido' && (
                            availableLocalIds.has(sol.id) ? (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleDownload(sol)}
                                leftIcon={<Download className="w-3.5 h-3.5 text-blue-700" />}
                              >
                                Baixar local
                              </Button>
                            ) : (
                              <span
                                className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium text-slate-400 bg-slate-100 rounded-lg border border-slate-200/80 cursor-not-allowed select-none"
                                title="Planilha gerada em outro navegador ou sessão não disponível neste dispositivo."
                              >
                                <Download className="w-3 h-3 text-slate-400" />
                                Indisponível local
                              </span>
                            )
                          )}

                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-rose-600 hover:text-rose-700 hover:bg-rose-50"
                            onClick={() => setSolicitacaoParaExcluir(sol)}
                            leftIcon={<Trash2 className="w-3.5 h-3.5 text-rose-500" />}
                            title="Excluir histórico de planilha"
                          >
                            Excluir
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

      )}

      {/* Modal de Drill-down e Conferência de Notas */}
      <SolicitacaoDetalheModal
        selectedSolicitacaoId={selectedSolicitacaoId}
        onClose={closeDetails}
        isLoading={isLoadingDetalhes}
        error={detalhesError}
        solicitacaoDetalhada={solicitacaoDetalhada}
        totals={totals}
        getEmpresa={getEmpresa}
        onOpenEditDataEntrada={handleOpenEditDataEntrada}
        onDeleteRequest={setSolicitacaoParaExcluir}
        onDownload={handleDownload}
      />

      <HistoricoModals
        editingNota={editingNota}
        onCloseEditNota={() => setEditingNota(null)}
        manualDateInput={manualDateInput}
        onChangeManualDate={setManualDateInput}
        entryDateError={entryDateError}
        onDismissEntryDateError={() => setEntryDateError(null)}
        onSubmitEntryDate={handleSaveDataEntrada}
        isUpdatingEntryDate={isUpdatingEntryDate}
        solicitacaoParaExcluir={solicitacaoParaExcluir}
        onCloseDeleteRequest={() => setSolicitacaoParaExcluir(null)}
        onConfirmDeleteRequest={deleteRequest}
        isDeletingRequest={isDeletingRequest}
        isBatchDeleteModalOpen={isBatchDeleteModalOpen}
        onCloseBatchDelete={() => setBatchDeleteModalOpen(false)}
        onConfirmBatchDelete={deleteBatchRequests}
        isDeletingBatch={isDeletingBatch}
        selectedCount={selectedIds.size}
        solicitacoesSelecionadas={solicitacoesSelecionadas}
        getEmpresa={getEmpresa}
      />

      {/* Barra Flutuante de Ações em Lote */}
      {selectedIds.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 animate-in fade-in slide-in-from-bottom-5 duration-200">
          <div className="bg-slate-900/95 backdrop-blur-md text-white px-5 py-3 rounded-2xl shadow-2xl border border-slate-700/60 flex items-center gap-4">
            <div className="flex items-center gap-2 pr-3 border-r border-slate-700/80">
              <span className="flex items-center justify-center w-6 h-6 rounded-full bg-blue-600 text-xs font-bold text-white">
                {selectedIds.size}
              </span>
              <span className="text-xs font-medium text-slate-200">
                {selectedIds.size === 1 ? 'planilha selecionada' : 'planilhas selecionadas'}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="danger"
                onClick={() => setBatchDeleteModalOpen(true)}
                leftIcon={<Trash2 className="w-3.5 h-3.5" />}
                className="shadow-sm"
              >
                Excluir Selecionadas
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={clearSelection}
                className="text-slate-300 hover:text-white hover:bg-slate-800"
                leftIcon={<X className="w-3.5 h-3.5" />}
              >
                Cancelar
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

