import React from 'react';
import { AlertTriangle, Check, Trash2 } from 'lucide-react';

import { ErrorAlert } from '../../components/feedback/ErrorAlert';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { getPlanilhaLabel } from '../../constants/domain';
import { formatCNPJ, formatCompetencia, formatDate } from '../../lib/formatters';
import type { Empresa } from '../../types/empresa';
import type { NotaFiscalProcessada, Solicitacao } from '../../types/solicitacao';

interface HistoricoModalsProps {
  editingNota: NotaFiscalProcessada | null;
  onCloseEditNota: () => void;
  manualDateInput: string;
  onChangeManualDate: (value: string) => void;
  entryDateError: string | null;
  onDismissEntryDateError: () => void;
  onSubmitEntryDate: React.FormEventHandler<HTMLFormElement>;
  isUpdatingEntryDate: boolean;
  solicitacaoParaExcluir: Solicitacao | null;
  onCloseDeleteRequest: () => void;
  onConfirmDeleteRequest: (id: string) => void;
  isDeletingRequest: boolean;
  isBatchDeleteModalOpen: boolean;
  onCloseBatchDelete: () => void;
  onConfirmBatchDelete: () => void;
  isDeletingBatch: boolean;
  selectedCount: number;
  solicitacoesSelecionadas: Solicitacao[];
  getEmpresa: (id: number) => Empresa | undefined;
}

export const HistoricoModals: React.FC<HistoricoModalsProps> = ({
  editingNota,
  onCloseEditNota,
  manualDateInput,
  onChangeManualDate,
  entryDateError,
  onDismissEntryDateError,
  onSubmitEntryDate,
  isUpdatingEntryDate,
  solicitacaoParaExcluir,
  onCloseDeleteRequest,
  onConfirmDeleteRequest,
  isDeletingRequest,
  isBatchDeleteModalOpen,
  onCloseBatchDelete,
  onConfirmBatchDelete,
  isDeletingBatch,
  selectedCount,
  solicitacoesSelecionadas,
  getEmpresa,
}) => (
  <>
    {/* Modal de Preenchimento Manual de Data de Entrada */}
    <Modal
      isOpen={!!editingNota}
      onClose={onCloseEditNota}
      title="Preenchimento Manual da Data de Entrada"
      subtitle={`Nota Fiscal nº ${editingNota?.numero_nota} — Origem do dado será registrada como 'Manual'`}
      maxWidth="sm"
    >
      <form onSubmit={onSubmitEntryDate} className="space-y-4">
        {entryDateError && (
          <ErrorAlert
            title="Falha ao salvar data"
            message={entryDateError}
            onDismiss={onDismissEntryDateError}
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
            onChange={(e) => onChangeManualDate(e.target.value)}
            className="w-full px-3 py-2 text-sm bg-white border border-slate-200/90 rounded-lg shadow-2xs focus:outline-none focus:ring-4 focus:ring-blue-500/15 focus:border-blue-600 text-slate-900"
          />
          <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">
            Esta data será salva e indicada com o selo de origem <strong>Manual</strong> para conferência contábil.
          </p>
        </div>

        <div className="bg-amber-50/90 border border-amber-200 rounded-lg p-2.5 text-[11px] text-amber-900 leading-relaxed">
          <strong>Atenção:</strong> Ao alterar a data de entrada, qualquer planilha já gerada para esta solicitação será invalidada. Para gerar uma nova planilha será necessário selecionar novamente os arquivos fiscais originais.
        </div>

        <div className="pt-3 border-t border-slate-100 flex justify-end gap-2">
          <Button type="button" variant="outline" size="sm" onClick={onCloseEditNota}>
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
      onClose={onCloseDeleteRequest}
      title="Excluir Histórico de Planilha"
      subtitle="Esta ação removerá o histórico estruturado e as planilhas disponíveis nesta sessão."
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
              onClick={onCloseDeleteRequest}
              disabled={isDeletingRequest}
            >
              Cancelar
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={() => onConfirmDeleteRequest(solicitacaoParaExcluir.id)}
              isLoading={isDeletingRequest}
              leftIcon={<Trash2 className="w-3.5 h-3.5" />}
            >
              Sim, Excluir Planilha
            </Button>
          </div>
        </div>
      )}
    </Modal>

    {/* Modal de Confirmação de Exclusão em Lote */}
    <Modal
      isOpen={isBatchDeleteModalOpen}
      onClose={() => {
        if (!isDeletingBatch) onCloseBatchDelete();
      }}
      title="Excluir Planilhas em Lote"
      subtitle="Confirmação de exclusão permanente de histórico estruturado"
      maxWidth="lg"
    >
      <div className="space-y-4 text-xs text-slate-600">
        <div className="bg-rose-50/80 border border-rose-200 rounded-xl p-4 text-rose-900 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="font-bold text-rose-950">Atenção: Ação Irreversível</p>
            <p className="text-[11px] text-rose-800 leading-relaxed">
              Você selecionou <strong className="font-bold text-rose-950">{selectedCount}</strong>{' '}
              {selectedCount === 1 ? 'planilha' : 'planilhas'} para exclusão permanente. O histórico estruturado no servidor e os arquivos armazenados na sessão local do navegador serão apagados.
            </p>
          </div>
        </div>

        <div>
          <h4 className="text-xs font-semibold text-slate-700 mb-2">
            Planilhas selecionadas ({solicitacoesSelecionadas.length}):
          </h4>
          <div className="max-h-56 overflow-y-auto border border-slate-200/90 rounded-xl divide-y divide-slate-100 bg-slate-50/60 p-1">
            {solicitacoesSelecionadas.map((sol) => {
              const emp = getEmpresa(sol.empresa_id);
              return (
                <div key={sol.id} className="p-2.5 flex items-center justify-between text-xs gap-3 rounded-lg hover:bg-white transition-colors">
                  <div className="min-w-0">
                    <div className="font-semibold text-slate-800 truncate">
                      {emp?.razao_social || `Empresa #${sol.empresa_id}`}
                    </div>
                    <div className="text-[11px] text-slate-500 flex items-center gap-2 mt-0.5">
                      {emp?.cnpj && <span className="font-mono">{formatCNPJ(emp.cnpj)}</span>}
                      <span>•</span>
                      <span>{formatCompetencia(sol.periodo_inicio)}</span>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <span className="inline-block px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-200/80 text-slate-700">
                      {getPlanilhaLabel(sol.tipo_planilha)}
                    </span>
                    <div className="text-[10px] text-slate-400 font-mono mt-0.5">
                      {sol.total_notas_processadas} {sol.total_notas_processadas === 1 ? 'nota' : 'notas'}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="flex justify-end gap-2.5 pt-2 border-t border-slate-100">
          <Button
            variant="ghost"
            size="sm"
            onClick={onCloseBatchDelete}
            disabled={isDeletingBatch}
          >
            Cancelar
          </Button>
          <Button
            variant="danger"
            size="sm"
            onClick={onConfirmBatchDelete}
            isLoading={isDeletingBatch}
            leftIcon={<Trash2 className="w-3.5 h-3.5" />}
          >
            Sim, Excluir {selectedCount} {selectedCount === 1 ? 'Planilha' : 'Planilhas'}
          </Button>
        </div>
      </div>
    </Modal>
  </>
);

