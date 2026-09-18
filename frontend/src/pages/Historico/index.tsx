import React from 'react';
import {
  History,
  Download,
  Eye,
  Edit2,
  Check,
  AlertTriangle,
  Trash2,
} from 'lucide-react';

import { getErrorMessage } from '../../api/client';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Modal } from '../../components/ui/Modal';
import { Card } from '../../components/ui/Card';
import { LoadingSpinner } from '../../components/feedback/LoadingSpinner';
import { EmptyState } from '../../components/feedback/EmptyState';
import { ErrorAlert } from '../../components/feedback/ErrorAlert';
import { PageHeader } from '../../components/layout/PageHeader';
import {
  formatCNPJ,
  formatDate,
  formatCurrency,
  formatPercent,
  formatCompetencia,
} from '../../lib/formatters';
import { StatusBadge } from '../../components/domain/StatusBadge';
import { ItensExcluidosSection } from '../../components/domain/ItensExcluidosSection';
import { AvisosAvaliacaoSection } from '../../components/domain/AvisosAvaliacaoSection';
import { getEntryOriginLabel, getPlanilhaLabel } from '../../constants/domain';
import { useHistoricoPage } from './useHistoricoPage';

export const HistoricoPage: React.FC = () => {
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
    selectedSolicitacaoId,
    setSelectedSolicitacaoId,
    editingNota,
    setEditingNota,
    manualDateInput,
    setManualDateInput,
    solicitacaoParaExcluir,
    setSolicitacaoParaExcluir,
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
  } = useHistoricoPage();

  return (
    <div className="space-y-6">
      <PageHeader
        icon={<History className="w-5 h-5 text-blue-700" />}
        title="Histórico de Solicitações e Planilhas Geradas"
        description="Consulte o histórico estruturado e baixe as planilhas geradas que ainda estejam armazenadas neste navegador"
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

          <div className="w-full sm:w-52">
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
                  <th className="py-3.5 px-4">Empresa</th>
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
                  return (
                    <tr key={sol.id} className="hover:bg-slate-50/70 transition-colors">
                      <td className="py-3.5 px-4 font-semibold text-slate-900">
                        <div>{emp?.razao_social || `Empresa #${sol.empresa_id}`}</div>
                        {emp && (
                          <div className="text-[11px] font-mono font-normal text-slate-400">
                            {formatCNPJ(emp.cnpj)}
                          </div>
                        )}
                      </td>
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
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleDownload(sol)}
                              leftIcon={<Download className="w-3.5 h-3.5 text-blue-700" />}
                            >
                              Baixar local
                            </Button>
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
      <Modal
        isOpen={!!selectedSolicitacaoId}
        onClose={() => {
          closeDetails();
        }}
        title="Detalhamento da Solicitação e Notas Fiscais"
        subtitle="Conferência fiscal dos valores extraídos do XML, data de entrada e rastreabilidade de origem"
        maxWidth="6xl"
      >
        {isLoadingDetalhes ? (
          <LoadingSpinner message="Carregando notas fiscais da solicitação..." />
        ) : detalhesError ? (
          <ErrorAlert message={getErrorMessage(detalhesError)} />
        ) : !solicitacaoDetalhada ? (
          <p className="text-xs text-slate-500">Solicitação não encontrada.</p>
        ) : (
          <div className="space-y-5">
            {/* Cabeçalho da Solicitação */}
            <div className="bg-slate-50/80 border border-slate-200/80 rounded-xl p-4 grid grid-cols-1 sm:grid-cols-4 gap-4 text-xs">
              <div>
                <span className="text-slate-400 block text-[10px] uppercase font-bold tracking-wider">Empresa</span>
                <span className="font-bold text-slate-900 text-xs mt-0.5 block">
                  {getEmpresa(solicitacaoDetalhada.empresa_id)?.razao_social}
                </span>
                <span className="block font-mono text-[11px] text-slate-500">
                  {formatCNPJ(getEmpresa(solicitacaoDetalhada.empresa_id)?.cnpj)}
                </span>
              </div>

              <div>
                <span className="text-slate-400 block text-[10px] uppercase font-bold tracking-wider">Período</span>
                <span className="font-semibold text-slate-800 mt-0.5 block">
                  {formatDate(solicitacaoDetalhada.periodo_inicio)} a {formatDate(solicitacaoDetalhada.periodo_fim)}
                </span>
              </div>

              <div>
                <span className="text-slate-400 block text-[10px] uppercase font-bold tracking-wider">Tipo de Planilha</span>
                <span className="font-bold text-blue-900 mt-0.5 block">
                  {getPlanilhaLabel(solicitacaoDetalhada.tipo_planilha)}
                </span>
              </div>

              <div>
                <span className="text-slate-400 block text-[10px] uppercase font-bold tracking-wider">Status</span>
                <div className="mt-1"><StatusBadge status={solicitacaoDetalhada.status} /></div>
              </div>
            </div>

            {solicitacaoDetalhada.mensagem_erro && (
              <ErrorAlert
                title="Mensagem de Erro Registrada"
                message={solicitacaoDetalhada.mensagem_erro}
              />
            )}

            {/* Avisos de Avaliação Fiscal */}
            {solicitacaoDetalhada.avisos_avaliacao && solicitacaoDetalhada.avisos_avaliacao.length > 0 && (
              <AvisosAvaliacaoSection avisos={solicitacaoDetalhada.avisos_avaliacao} />
            )}

            {/* Aviso de Notas Ignoradas no Modal de Detalhes */}
            {solicitacaoDetalhada.notas_ignoradas && solicitacaoDetalhada.notas_ignoradas.length > 0 && (
              <div className="bg-amber-50/90 border border-amber-300/80 rounded-xl p-4 space-y-2.5 shadow-2xs">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                  <span className="text-xs font-bold text-amber-950">
                    {solicitacaoDetalhada.notas_ignoradas.length} nota(s) fiscal(is) desconsiderada(s) (operações internas ou fora do período)
                  </span>
                </div>
                <div className="overflow-x-auto border border-amber-200 rounded-lg bg-white max-h-40">
                  <table className="w-full text-left text-xs divide-y divide-amber-100">
                    <thead className="bg-amber-50 text-amber-900 font-bold uppercase text-[10px] sticky top-0">
                      <tr>
                        <th className="py-2 px-2.5">Nota / Série</th>
                        <th className="py-2 px-2.5">Emissão</th>
                        <th className="py-2 px-2.5">Arquivo de Origem</th>
                        <th className="py-2 px-2.5">Motivo</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-amber-100/60">
                      {solicitacaoDetalhada.notas_ignoradas.map((ign, idx) => (
                        <tr key={idx} className="hover:bg-amber-50/50">
                          <td className="py-2 px-2.5 font-semibold text-slate-900">
                            NF-e nº {ign.numero_nota} {ign.serie ? `(${ign.serie})` : ''}
                          </td>
                          <td className="py-2 px-2.5 text-slate-700 font-mono">
                            {ign.data_emissao || '-'}
                          </td>
                          <td className="py-2 px-2.5 text-slate-500 font-mono text-[11px] truncate max-w-[150px]" title={ign.arquivo || ''}>
                            {ign.arquivo || '-'}
                          </td>
                          <td className="py-2 px-2.5 text-amber-900 font-medium">
                            {ign.motivo}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Totais Consolidados para Conferência */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="bg-white border border-slate-200/90 p-3.5 rounded-xl shadow-2xs">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">Valor total das notas</span>
                <span className="text-base font-bold font-mono text-slate-900 tabular-nums">{formatCurrency(totals.notas)}</span>
              </div>
              <div className="bg-white border border-slate-200/90 p-3.5 rounded-xl shadow-2xs">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">Total Débito</span>
                <span className="text-base font-bold font-mono text-blue-900 tabular-nums">{formatCurrency(totals.debito)}</span>
              </div>
              <div className="bg-white border border-slate-200/90 p-3.5 rounded-xl shadow-2xs">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">Total Crédito</span>
                <span className="text-base font-bold font-mono text-slate-700 tabular-nums">{formatCurrency(totals.credito)}</span>
              </div>
              <div className="bg-emerald-50 border border-emerald-200 p-3.5 rounded-xl shadow-2xs">
                <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-800 block">Valor Devido Total</span>
                <span className="text-base font-bold font-mono text-emerald-900 tabular-nums">{formatCurrency(totals.devido)}</span>
              </div>
            </div>

            {/* Tabela de Itens Processados */}
            <div>
              <div className="flex items-center justify-between mb-2.5">
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700">
                  Notas Fiscais Processadas ({solicitacaoDetalhada.notas_processadas?.length || 0} itens)
                </h4>
                {solicitacaoDetalhada.status === 'concluido' && (
                  <Button
                    size="sm"
                    onClick={() => handleDownload(solicitacaoDetalhada)}
                    leftIcon={<Download className="w-3.5 h-3.5" />}
                  >
                    Baixar planilha local
                  </Button>
                )}
              </div>

              {(!solicitacaoDetalhada.notas_processadas || solicitacaoDetalhada.notas_processadas.length === 0) ? (
                <p className="text-xs text-slate-500 py-6 text-center bg-slate-50/60 rounded-xl border border-dashed border-slate-200">
                  Nenhuma nota fiscal processada registrada nesta solicitação.
                </p>
              ) : (
                <div className="overflow-x-auto border border-slate-200/80 rounded-xl bg-white max-h-96 shadow-2xs">
                  <table className="w-full text-left text-xs divide-y divide-slate-100">
                    <thead className="bg-slate-50/80 text-slate-500 font-bold uppercase text-[10px] sticky top-0 tracking-wider">
                      <tr>
                        <th className="py-2.5 px-3">Nota</th>
                        <th className="py-2.5 px-3 text-center">UF Origem</th>
                        <th className="py-2.5 px-3">Emissão</th>
                        <th className="py-2.5 px-3">Data Entrada</th>
                        <th className="py-2.5 px-3 font-mono">NCM</th>
                        <th className="py-2.5 px-3 text-right">V. Total</th>
                        <th className="py-2.5 px-3 text-right">Base Cálc.</th>
                        <th className="py-2.5 px-3 text-right font-mono">A.ORI</th>
                        <th className="py-2.5 px-3 text-right font-mono">A.DST</th>
                        <th className="py-2.5 px-3 text-right">Débito</th>
                        <th className="py-2.5 px-3 text-right">Crédito</th>
                        <th className="py-2.5 px-3 text-right font-mono">Valor Devido</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {solicitacaoDetalhada.notas_processadas.map((item, idx) => (
                        <tr key={idx} className="hover:bg-slate-50/80 transition-colors">
                          <td className="py-2.5 px-3 font-semibold text-slate-900">{item.numero_nota}</td>
                          <td className="py-2.5 px-3 text-center">
                            <span className="inline-flex items-center justify-center font-bold text-[10px] bg-blue-50 text-blue-900 px-2 py-0.5 rounded border border-blue-200/80">
                              {item.uf_emitente || '-'}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 text-slate-600">{formatDate(item.data_emissao)}</td>
                          
                          {/* Coluna Data de Entrada */}
                          <td className="py-2.5 px-3">
                            <div className="flex items-center gap-1.5">
                              {item.data_entrada ? (
                                <>
                                  <span className="font-semibold text-slate-800">{formatDate(item.data_entrada)}</span>
                                  <Badge
                                    variant={item.origem_data_entrada === 'planilha_sistema_contabil' ? 'success' : 'info'}
                                    size="sm"
                                  >
                                    {getEntryOriginLabel(item.origem_data_entrada)}
                                  </Badge>
                                </>
                              ) : (
                                <Badge variant="warning" size="sm" dot>
                                  Pendente
                                </Badge>
                              )}
                              <button
                                type="button"
                                onClick={() => handleOpenEditDataEntrada(item)}
                                aria-label={`Editar data de entrada da nota ${item.numero_nota}`}
                                className="p-1 rounded-md text-slate-400 hover:text-blue-700 hover:bg-blue-50 transition-colors ml-1 cursor-pointer"
                                title="Editar Data de Entrada Manualmente"
                              >
                                <Edit2 className="w-3 h-3" />
                              </button>
                            </div>
                          </td>

                          <td className="py-2.5 px-3 font-mono text-slate-800">{item.ncm}</td>
                          <td className="py-2.5 px-3 text-right font-mono tabular-nums">{formatCurrency(item.v_total)}</td>
                          <td className="py-2.5 px-3 text-right font-mono tabular-nums">{formatCurrency(item.base_calculo)}</td>
                          <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-600">{formatPercent(item.a_ori)}</td>
                          <td className="py-2.5 px-3 text-right font-mono tabular-nums font-bold text-blue-900">{formatPercent(item.a_dst_resolvida)}</td>
                          <td className="py-2.5 px-3 text-right font-mono tabular-nums text-blue-950">{formatCurrency(item.debito)}</td>
                          <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-600">{formatCurrency(item.credito)}</td>
                          <td className="py-2.5 px-3 text-right font-mono tabular-nums font-bold text-emerald-800">
                            {formatCurrency(item.valor_devido)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Conferência de Itens Excluídos da Parcial */}
            {solicitacaoDetalhada.itens_excluidos && solicitacaoDetalhada.itens_excluidos.length > 0 && (
              <ItensExcluidosSection itens={solicitacaoDetalhada.itens_excluidos} />
            )}

            {/* Ações do Modal de Detalhes */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-4 border-t border-slate-200">
              <Button
                variant="ghost"
                size="sm"
                className="text-rose-600 hover:text-rose-700 hover:bg-rose-50 w-full sm:w-auto"
                leftIcon={<Trash2 className="w-4 h-4 text-rose-500" />}
                onClick={() => setSolicitacaoParaExcluir(solicitacaoDetalhada)}
              >
                Excluir esta Solicitação
              </Button>

              <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
                {solicitacaoDetalhada.status === 'concluido' && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleDownload(solicitacaoDetalhada)}
                    leftIcon={<Download className="w-3.5 h-3.5 text-blue-700" />}
                  >
                    Baixar planilhas locais
                  </Button>
                )}
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    closeDetails();
                  }}
                >
                  Fechar
                </Button>
              </div>
            </div>
          </div>
        )}
      </Modal>

      {/* Modal de Preenchimento Manual de Data de Entrada */}
      <Modal
        isOpen={!!editingNota}
        onClose={() => setEditingNota(null)}
        title="Preenchimento Manual da Data de Entrada"
        subtitle={`Nota Fiscal nº ${editingNota?.numero_nota} — Origem do dado será registrada como 'Manual'`}
        maxWidth="sm"
      >
        <form onSubmit={handleSaveDataEntrada} className="space-y-4">
          {entryDateError && (
            <ErrorAlert
              title="Falha ao salvar data"
              message={entryDateError}
              onDismiss={() => setEntryDateError(null)}
            />
          )}

          <div className="space-y-1.5">
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-700">
              Data de Entrada Física no Estabelecimento
            </label>
            <input
              type="date"
              required
              value={manualDateInput}
              onChange={(e) => setManualDateInput(e.target.value)}
              className="w-full px-3 py-2 text-sm bg-white border border-slate-200/90 rounded-lg shadow-2xs focus:outline-none focus:ring-4 focus:ring-blue-500/15 focus:border-blue-600 text-slate-900"
            />
            <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">
              Esta data será salva e indicada com o selo de origem <strong>Manual</strong> para conferência contábil.
            </p>
          </div>

          <div className="bg-amber-50/90 border border-amber-200 rounded-lg p-2.5 text-[11px] text-amber-900 leading-relaxed">
            <strong>Atenção:</strong> Ao alterar a data de entrada, qualquer planilha local já gerada para esta solicitação será invalidada. Para gerar uma nova planilha será necessário selecionar novamente os arquivos fiscais originais, que não são armazenados no servidor.
          </div>

          <div className="pt-3 border-t border-slate-100 flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setEditingNota(null)}
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              size="sm"
              isLoading={isUpdatingEntryDate}
              leftIcon={<Check className="w-3.5 h-3.5" />}
            >
              Salvar Data
            </Button>
          </div>
        </form>
      </Modal>

      {/* Modal de Confirmação de Exclusão */}
      <Modal
        isOpen={!!solicitacaoParaExcluir}
        onClose={() => setSolicitacaoParaExcluir(null)}
        title="Excluir Histórico de Planilha"
        subtitle="Esta ação removerá o histórico estruturado e também as planilhas locais deste navegador."
        maxWidth="md"
      >
        {solicitacaoParaExcluir && (
          <div className="space-y-4 text-xs text-slate-600">
            <div className="bg-rose-50/80 border border-rose-200 rounded-xl p-4 text-rose-900 flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="font-bold text-rose-950">Atenção: Ação Irreversível</p>
                <p className="text-[11px] text-rose-800 leading-relaxed">
                  Tem certeza de que deseja excluir o histórico de processamento para a empresa{' '}
                  <strong className="font-bold text-rose-950">
                    {getEmpresa(solicitacaoParaExcluir.empresa_id)?.razao_social || `#${solicitacaoParaExcluir.empresa_id}`}
                  </strong>{' '}
                  (competência{' '}
                  <strong>{formatCompetencia(solicitacaoParaExcluir.periodo_inicio)}</strong>)?
                </p>
              </div>
            </div>

            <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-3.5 space-y-1.5 text-[11px]">
              <div className="flex justify-between">
                <span className="text-slate-500">Notas Processadas:</span>
                <span className="font-mono font-bold text-slate-800">
                  {solicitacaoParaExcluir.total_notas_processadas}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Tipo de Planilha:</span>
                <span className="font-semibold text-slate-800">
                  {getPlanilhaLabel(solicitacaoParaExcluir.tipo_planilha)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Criado em:</span>
                <span className="text-slate-700">{formatDate(solicitacaoParaExcluir.criado_em)}</span>
              </div>
            </div>

            <div className="flex justify-end gap-2.5 pt-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSolicitacaoParaExcluir(null)}
                disabled={isDeletingRequest}
              >
                Cancelar
              </Button>
              <Button
                variant="danger"
                size="sm"
                onClick={() => deleteRequest(solicitacaoParaExcluir.id)}
                isLoading={isDeletingRequest}
                leftIcon={<Trash2 className="w-3.5 h-3.5" />}
              >
                Sim, Excluir Planilha
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};
