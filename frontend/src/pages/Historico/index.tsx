import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  History,
  Download,
  Eye,
  Edit2,
  Check,
  AlertTriangle,
  Trash2
} from 'lucide-react';

import { solicitacoesApi } from '../../api/solicitacoes';
import { getErrorMessage } from '../../api/client';
import type { Solicitacao, NotaFiscalProcessada } from '../../types/solicitacao';
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
  formatCompetencia
} from '../../lib/formatters';
import { StatusBadge } from '../../components/domain/StatusBadge';
import { getPlanilhaLabel } from '../../constants/domain';
import { queryKeys } from '../../api/queryKeys';
import { useEmpresasQuery, useSolicitacoesQuery } from '../../hooks/useApiQueries';

export const HistoricoPage: React.FC = () => {
  const queryClient = useQueryClient();
  const [empresaFilter, setEmpresaFilter] = useState<number | undefined>();
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [selectedSolicitacaoId, setSelectedSolicitacaoId] = useState<string | null>(null);

  // Estado para edição manual de data de entrada
  const [editingNota, setEditingNota] = useState<NotaFiscalProcessada | null>(null);
  const [manualDateInput, setManualDateInput] = useState<string>('');

  // Estado para exclusão de solicitação
  const [solicitacaoParaExcluir, setSolicitacaoParaExcluir] = useState<Solicitacao | null>(null);

  // Queries
  const { data: solicitacoes = [], isLoading, error } = useSolicitacoesQuery(
    empresaFilter,
    statusFilter,
  );

  const { data: empresas = [] } = useEmpresasQuery();

  // Query para drill-down da solicitação específica
  const { data: solicitacaoDetalhada, isLoading: isLoadingDetalhes } = useQuery({
    queryKey: queryKeys.solicitacao(selectedSolicitacaoId),
    queryFn: () => solicitacoesApi.obter(selectedSolicitacaoId!),
    enabled: !!selectedSolicitacaoId,
  });

  // Mutation para atualizar data de entrada manualmente
  const updateDataEntradaMutation = useMutation({
    mutationFn: async ({ solicitacaoId, notaId, dataEntrada }: { solicitacaoId: string; notaId: string; dataEntrada: string }) => {
      return await solicitacoesApi.atualizarDataEntrada(solicitacaoId, notaId, dataEntrada);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['solicitacao', selectedSolicitacaoId] });
      setEditingNota(null);
      setManualDateInput('');
    },
    onError: (err) => {
      alert(`Erro ao atualizar data de entrada: ${getErrorMessage(err)}`);
    },
  });

  // Mutation para excluir solicitação e planilhas geradas
  const deleteSolicitacaoMutation = useMutation({
    mutationFn: async (id: string) => {
      await solicitacoesApi.excluir(id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['solicitacoes'] });
      if (selectedSolicitacaoId === solicitacaoParaExcluir?.id) {
        setSelectedSolicitacaoId(null);
      }
      setSolicitacaoParaExcluir(null);
    },
    onError: (err) => {
      alert(`Erro ao excluir solicitação: ${getErrorMessage(err)}`);
    },
  });

  const handleOpenEditDataEntrada = (nota: NotaFiscalProcessada) => {
    setEditingNota(nota);
    setManualDateInput(nota.data_entrada ? nota.data_entrada.split('T')[0] : '');
  };

  const handleSaveDataEntrada = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSolicitacaoId || !editingNota || !manualDateInput) return;
    updateDataEntradaMutation.mutate({
      solicitacaoId: selectedSolicitacaoId,
      notaId: editingNota.id,
      dataEntrada: manualDateInput,
    });
  };

  const handleDownload = async (solicitacao: Solicitacao) => {
    try {
      const emp = empresas.find((e) => e.id === solicitacao.empresa_id);
      const empNome = emp ? emp.razao_social.slice(0, 15).replace(/\s+/g, '_') : 'Empresa';
      const filename = `Planilha_${solicitacao.tipo_planilha}_${empNome}_${solicitacao.periodo_inicio.slice(0, 7)}.xlsx`;
      await solicitacoesApi.downloadPlanilha(solicitacao.id, filename);
    } catch (err) {
      alert(getErrorMessage(err));
    }
  };

  const getEmpresa = (id: number) => empresas.find((e) => e.id === id);

  // Cálculos consolidados para o modal de drill-down
  const totalDebito = solicitacaoDetalhada?.notas_processadas?.reduce(
    (acc, item) => acc + Number(item.debito),
    0
  ) || 0;
  const totalCredito = solicitacaoDetalhada?.notas_processadas?.reduce(
    (acc, item) => acc + Number(item.credito),
    0
  ) || 0;
  const totalDevido = solicitacaoDetalhada?.notas_processadas?.reduce(
    (acc, item) => acc + Number(item.valor_devido),
    0
  ) || 0;
  const totalValorNotas = solicitacaoDetalhada?.notas_processadas?.reduce(
    (acc, item) => acc + Number(item.v_total),
    0
  ) || 0;

  return (
    <div className="space-y-6">
      <PageHeader
        icon={<History className="w-6 h-6 text-blue-800" />}
        title="Histórico de Solicitações e Planilhas Geradas"
        description="Consulte as solicitações realizadas, rebaixe arquivos `.xlsx` preenchidos e confira o detalhamento nota a nota"
      />

      {/* Filters Bar */}
      <Card className="p-3">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="flex-1">
            <select
              value={empresaFilter || ''}
              onChange={(e) => setEmpresaFilter(e.target.value ? Number(e.target.value) : undefined)}
              className="w-full px-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-md focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-800 text-slate-700"
            >
              <option value="">Todas as Empresas</option>
              {empresas.map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {emp.razao_social} ({formatCNPJ(emp.cnpj)})
                </option>
              ))}
            </select>
          </div>

          <div className="w-full sm:w-48">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-full px-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-md focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-800 text-slate-700"
            >
              <option value="">Todos os Status</option>
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
          icon={<History className="w-8 h-8 text-blue-700" />}
          title="Nenhuma solicitação encontrada"
          description="Nenhuma planilha foi gerada para os filtros selecionados. Crie uma nova solicitação para processar arquivos XML."
        />
      ) : (
        <div className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs divide-y divide-slate-200">
              <thead className="bg-slate-50/80 text-slate-700 font-semibold uppercase tracking-wider text-[11px]">
                <tr>
                  <th className="py-3 px-4">Empresa</th>
                  <th className="py-3 px-4">Competência / Período</th>
                  <th className="py-3 px-4">Tipo de Planilha</th>
                  <th className="py-3 px-4 text-center">Status</th>
                  <th className="py-3 px-4 text-center">Notas</th>
                  <th className="py-3 px-4">Data Solicitação</th>
                  <th className="py-3 px-4 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {solicitacoes.map((sol) => {
                  const emp = getEmpresa(sol.empresa_id);
                  return (
                    <tr key={sol.id} className="hover:bg-slate-50/70 transition-colors">
                      <td className="py-3 px-4 font-medium text-slate-900">
                        <div>{emp?.razao_social || `Empresa #${sol.empresa_id}`}</div>
                        {emp && (
                          <div className="text-[11px] font-mono text-slate-400">
                            {formatCNPJ(emp.cnpj)}
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-4 text-slate-600">
                        <span className="font-semibold text-slate-800">
                          {formatCompetencia(sol.periodo_inicio)}
                        </span>
                        <span className="text-[10px] text-slate-400 block">
                          {formatDate(sol.periodo_inicio)} a {formatDate(sol.periodo_fim)}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <span className="text-slate-800 font-medium">{getPlanilhaLabel(sol.tipo_planilha)}</span>
                      </td>
                      <td className="py-3 px-4 text-center"><StatusBadge status={sol.status} /></td>
                      <td className="py-3 px-4 text-center font-mono font-semibold text-slate-700">
                        {sol.total_notas_processadas}
                      </td>
                      <td className="py-3 px-4 text-slate-500 text-[11px]">
                        {formatDate(sol.criado_em)}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-2">
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
                              Baixar .xlsx
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
          setSelectedSolicitacaoId(null);
          setEditingNota(null);
        }}
        title="Detalhamento da Solicitação e Notas Fiscais"
        subtitle="Conferência fiscal dos valores extraídos do XML, data de entrada e rastreabilidade de origem"
        maxWidth="6xl"
      >
        {isLoadingDetalhes ? (
          <LoadingSpinner message="Carregando notas fiscais da solicitação..." />
        ) : !solicitacaoDetalhada ? (
          <p className="text-xs text-slate-500">Solicitação não encontrada.</p>
        ) : (
          <div className="space-y-5">
            {/* Cabeçalho da Solicitação */}
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 grid grid-cols-1 sm:grid-cols-4 gap-4 text-xs">
              <div>
                <span className="text-slate-500 block text-[10px] uppercase font-semibold">Empresa</span>
                <span className="font-bold text-slate-900 text-xs">
                  {getEmpresa(solicitacaoDetalhada.empresa_id)?.razao_social}
                </span>
                <span className="block font-mono text-[11px] text-slate-500">
                  {formatCNPJ(getEmpresa(solicitacaoDetalhada.empresa_id)?.cnpj)}
                </span>
              </div>

              <div>
                <span className="text-slate-500 block text-[10px] uppercase font-semibold">Período</span>
                <span className="font-medium text-slate-900">
                  {formatDate(solicitacaoDetalhada.periodo_inicio)} a {formatDate(solicitacaoDetalhada.periodo_fim)}
                </span>
              </div>

              <div>
                <span className="text-slate-500 block text-[10px] uppercase font-semibold">Tipo de Planilha</span>
                <span className="font-semibold text-blue-900">
                  {getPlanilhaLabel(solicitacaoDetalhada.tipo_planilha)}
                </span>
              </div>

              <div>
                <span className="text-slate-500 block text-[10px] uppercase font-semibold">Status</span>
                <div className="mt-0.5"><StatusBadge status={solicitacaoDetalhada.status} /></div>
              </div>
            </div>

            {solicitacaoDetalhada.mensagem_erro && (
              <ErrorAlert
                title="Mensagem de Erro Registrada"
                message={solicitacaoDetalhada.mensagem_erro}
              />
            )}

            {/* Aviso de Notas Ignoradas no Modal de Detalhes */}
            {solicitacaoDetalhada.notas_ignoradas && solicitacaoDetalhada.notas_ignoradas.length > 0 && (
              <div className="bg-amber-50/90 border border-amber-300 rounded-lg p-3.5 space-y-2">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                  <span className="text-xs font-bold text-amber-950">
                    {solicitacaoDetalhada.notas_ignoradas.length} nota(s) fiscal(is) desconsiderada(s) (operações internas ou fora do período)
                  </span>
                </div>
                <div className="overflow-x-auto border border-amber-200 rounded bg-white max-h-40">
                  <table className="w-full text-left text-xs divide-y divide-amber-100">
                    <thead className="bg-amber-50 text-amber-900 font-semibold uppercase text-[10px] sticky top-0">
                      <tr>
                        <th className="py-1.5 px-2.5">Nota / Série</th>
                        <th className="py-1.5 px-2.5">Emissão</th>
                        <th className="py-1.5 px-2.5">Arquivo de Origem</th>
                        <th className="py-1.5 px-2.5">Motivo</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-amber-100/60">
                      {solicitacaoDetalhada.notas_ignoradas.map((ign, idx) => (
                        <tr key={idx} className="hover:bg-amber-50/50">
                          <td className="py-1.5 px-2.5 font-medium text-slate-900">
                            NF-e nº {ign.numero_nota} {ign.serie ? `(${ign.serie})` : ''}
                          </td>
                          <td className="py-1.5 px-2.5 text-slate-700 font-mono">
                            {ign.data_emissao || '-'}
                          </td>
                          <td className="py-1.5 px-2.5 text-slate-500 font-mono text-[11px] truncate max-w-[150px]" title={ign.arquivo || ''}>
                            {ign.arquivo || '-'}
                          </td>
                          <td className="py-1.5 px-2.5 text-amber-900">
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
              <div className="bg-white border border-slate-200 p-3 rounded-md">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block">Total Notas</span>
                <span className="text-sm font-bold font-mono text-slate-900">{formatCurrency(totalValorNotas)}</span>
              </div>
              <div className="bg-white border border-slate-200 p-3 rounded-md">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block">Total Débito</span>
                <span className="text-sm font-bold font-mono text-blue-900">{formatCurrency(totalDebito)}</span>
              </div>
              <div className="bg-white border border-slate-200 p-3 rounded-md">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block">Total Crédito</span>
                <span className="text-sm font-bold font-mono text-slate-700">{formatCurrency(totalCredito)}</span>
              </div>
              <div className="bg-emerald-50 border border-emerald-200 p-3 rounded-md">
                <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-800 block">Valor Devido Total</span>
                <span className="text-sm font-bold font-mono text-emerald-900">{formatCurrency(totalDevido)}</span>
              </div>
            </div>

            {/* Tabela de Itens */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700">
                  Notas Fiscais Processadas ({solicitacaoDetalhada.notas_processadas?.length || 0} itens)
                </h4>
                {solicitacaoDetalhada.status === 'concluido' && (
                  <Button
                    size="sm"
                    onClick={() => handleDownload(solicitacaoDetalhada)}
                    leftIcon={<Download className="w-3.5 h-3.5" />}
                  >
                    Baixar Planilha (.xlsx)
                  </Button>
                )}
              </div>

              {(!solicitacaoDetalhada.notas_processadas || solicitacaoDetalhada.notas_processadas.length === 0) ? (
                <p className="text-xs text-slate-500 py-4 text-center bg-slate-50 rounded-md">
                  Nenhuma nota fiscal processada registrada nesta solicitação.
                </p>
              ) : (
                <div className="overflow-x-auto border border-slate-200 rounded-md bg-white max-h-96">
                  <table className="w-full text-left text-xs divide-y divide-slate-200">
                    <thead className="bg-slate-50 text-slate-700 font-semibold uppercase text-[10px] sticky top-0">
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
                          <td className="py-2 px-3 font-medium text-slate-900">{item.numero_nota}</td>
                          <td className="py-2 px-3 text-center">
                            <span className="inline-flex items-center justify-center font-bold text-[10px] bg-blue-100 text-blue-900 px-1.5 py-0.5 rounded border border-blue-200">
                              {item.uf_emitente || '-'}
                            </span>
                          </td>
                          <td className="py-2 px-3 text-slate-600">{formatDate(item.data_emissao)}</td>
                          
                          {/* Coluna Data de Entrada com Badge de Origem e Ação de Edição Manual */}
                          <td className="py-2 px-3">
                            <div className="flex items-center gap-1.5">
                              {item.data_entrada ? (
                                <>
                                  <span className="font-semibold text-slate-800">{formatDate(item.data_entrada)}</span>
                                  <Badge
                                    variant={item.origem_data_entrada === 'planilha_sistema_contabil' ? 'success' : 'info'}
                                    size="sm"
                                  >
                                    {item.origem_data_entrada === 'planilha_sistema_contabil' ? 'Planilha' : 'Manual'}
                                  </Badge>
                                </>
                              ) : (
                                <Badge variant="warning" size="sm">
                                  Pendente
                                </Badge>
                              )}
                              <button
                                type="button"
                                onClick={() => handleOpenEditDataEntrada(item)}
                                className="p-1 rounded text-slate-400 hover:text-blue-700 hover:bg-blue-50 transition-colors ml-1"
                                title="Editar Data de Entrada Manualmente"
                              >
                                <Edit2 className="w-3 h-3" />
                              </button>
                            </div>
                          </td>

                          <td className="py-2 px-3 font-mono text-slate-800">{item.ncm}</td>
                          <td className="py-2 px-3 text-right font-mono">{formatCurrency(item.v_total)}</td>
                          <td className="py-2 px-3 text-right font-mono">{formatCurrency(item.base_calculo)}</td>
                          <td className="py-2 px-3 text-right font-mono text-slate-600">{formatPercent(item.a_ori)}</td>
                          <td className="py-2 px-3 text-right font-mono font-bold text-blue-900">{formatPercent(item.a_dst_resolvida)}</td>
                          <td className="py-2 px-3 text-right font-mono text-blue-950">{formatCurrency(item.debito)}</td>
                          <td className="py-2 px-3 text-right font-mono text-slate-600">{formatCurrency(item.credito)}</td>
                          <td className="py-2 px-3 text-right font-mono font-bold text-emerald-800">
                            {formatCurrency(item.valor_devido)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

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
                    leftIcon={<Download className="w-4 h-4 text-blue-700" />}
                  >
                    Baixar Planilhas (.xlsx)
                  </Button>
                )}
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setSelectedSolicitacaoId(null);
                    setEditingNota(null);
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
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-700 mb-1.5">
              Data de Entrada Física no Estabelecimento
            </label>
            <input
              type="date"
              required
              value={manualDateInput}
              onChange={(e) => setManualDateInput(e.target.value)}
              className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-800 text-slate-900"
            />
            <p className="text-[11px] text-slate-500 mt-1">
              Esta data será salva e indicada com o selo de origem <strong>Manual</strong> para conferência contábil.
            </p>
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
              isLoading={updateDataEntradaMutation.isPending}
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
        subtitle="Esta ação removerá a solicitação e todos os arquivos gerados permanentemente."
        maxWidth="md"
      >
        {solicitacaoParaExcluir && (
          <div className="space-y-4 text-xs text-slate-600">
            <div className="bg-rose-50/70 border border-rose-200 rounded-lg p-3.5 text-rose-900 flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="font-semibold text-rose-950">Atenção: Ação Irreversível</p>
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

            <div className="bg-slate-50 border border-slate-200 rounded-md p-3 space-y-1 text-[11px]">
              <div className="flex justify-between">
                <span className="text-slate-500">Notas Processadas:</span>
                <span className="font-mono font-semibold text-slate-800">
                  {solicitacaoParaExcluir.total_notas_processadas}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Tipo de Planilha:</span>
                <span className="font-medium text-slate-800">
                  {getPlanilhaLabel(solicitacaoParaExcluir.tipo_planilha)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Criado em:</span>
                <span className="text-slate-700">{formatDate(solicitacaoParaExcluir.criado_em)}</span>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSolicitacaoParaExcluir(null)}
                disabled={deleteSolicitacaoMutation.isPending}
              >
                Cancelar
              </Button>
              <Button
                variant="danger"
                size="sm"
                onClick={() => deleteSolicitacaoMutation.mutate(solicitacaoParaExcluir.id)}
                isLoading={deleteSolicitacaoMutation.isPending}
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
