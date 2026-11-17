import React from 'react';
import { Download, Edit2, Trash2 } from 'lucide-react';

import { getErrorMessage } from '../../api/client';
import { DanfeButton } from '../../components/DanfeButton';
import { AvisosAvaliacaoSection } from '../../components/domain/AvisosAvaliacaoSection';
import { ItensExcluidosSection } from '../../components/domain/ItensExcluidosSection';
import { NotasIgnoradasSection } from '../../components/domain/NotasIgnoradasSection';
import { StatusBadge } from '../../components/domain/StatusBadge';
import { ErrorAlert } from '../../components/feedback/ErrorAlert';
import { LoadingSpinner } from '../../components/feedback/LoadingSpinner';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { getEntryOriginLabel, getPlanilhaLabel } from '../../constants/domain';
import { formatCNPJ, formatCurrency, formatDate, formatPercent } from '../../lib/formatters';
import type { Empresa } from '../../types/empresa';
import type { NotaFiscalProcessada, Solicitacao } from '../../types/solicitacao';

interface DetailTotals {
  debito: number;
  credito: number;
  devido: number;
  notas: number;
}

interface SolicitacaoDetalheModalProps {
  selectedSolicitacaoId: string | null;
  onClose: () => void;
  isLoading: boolean;
  error: unknown;
  solicitacaoDetalhada?: Solicitacao;
  totals: DetailTotals;
  getEmpresa: (id: number) => Empresa | undefined;
  onOpenEditDataEntrada: (nota: NotaFiscalProcessada) => void;
  onDeleteRequest: (solicitacao: Solicitacao) => void;
  onDownload: (solicitacao: Solicitacao) => void;
}

export const SolicitacaoDetalheModal: React.FC<SolicitacaoDetalheModalProps> = ({
  selectedSolicitacaoId,
  onClose,
  isLoading,
  error,
  solicitacaoDetalhada,
  totals,
  getEmpresa,
  onOpenEditDataEntrada,
  onDeleteRequest,
  onDownload,
}) => (
  <Modal
    isOpen={!!selectedSolicitacaoId}
    onClose={onClose}
    title="Detalhamento da Solicitação e Notas Fiscais"
    subtitle="Conferência fiscal dos valores extraídos do XML, data de entrada e rastreabilidade de origem"
    maxWidth="6xl"
  >
    {isLoading ? (
      <LoadingSpinner message="Carregando notas fiscais da solicitação..." />
    ) : error ? (
      <ErrorAlert message={getErrorMessage(error)} />
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
          <NotasIgnoradasSection notas={solicitacaoDetalhada.notas_ignoradas} variant="compact" />
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
                onClick={() => onDownload(solicitacaoDetalhada)}
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
                      <td className="py-2.5 px-3 font-semibold text-slate-900">
                        {item.numero_nota}
                        <div className="mt-1.5"><DanfeButton chaveAcesso={item.chave_acesso} numeroNota={item.numero_nota} /></div>
                      </td>
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
                            onClick={() => onOpenEditDataEntrada(item)}
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
            onClick={() => onDeleteRequest(solicitacaoDetalhada)}
          >
            Excluir esta Solicitação
          </Button>

          <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
            {solicitacaoDetalhada.status === 'concluido' && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => onDownload(solicitacaoDetalhada)}
                leftIcon={<Download className="w-3.5 h-3.5 text-blue-700" />}
              >
                Baixar planilhas
              </Button>
            )}
            <Button variant="secondary" size="sm" onClick={onClose}>
              Fechar
            </Button>
          </div>
        </div>
      </div>
    )}
  </Modal>
);
