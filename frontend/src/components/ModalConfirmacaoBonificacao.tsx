import React, { useState, useEffect } from 'react';
import {
  HelpCircle,
  Copy,
  Check,
  CheckCircle2,
  XCircle,
  Package,
  Building2,
  FileSpreadsheet,
} from 'lucide-react';
import { Modal } from './ui/Modal';
import { Button } from './ui/Button';
import { Badge } from './ui/Badge';
import type { NotaBonificacaoPendencia } from '../types/solicitacao';

export interface ModalConfirmacaoBonificacaoProps {
  isOpen: boolean;
  onClose: () => void;
  notas: NotaBonificacaoPendencia[];
  onConfirm: (decisoes: Record<string, boolean>) => void;
  isProcessing?: boolean;
}

export const ModalConfirmacaoBonificacao: React.FC<ModalConfirmacaoBonificacaoProps> = ({
  isOpen,
  onClose,
  notas,
  onConfirm,
  isProcessing = false,
}) => {
  const [decisoes, setDecisoes] = useState<Record<string, boolean>>({});
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Inicializa decisões com as sugestões inteligentes detectadas
  useEffect(() => {
    if (notas && notas.length > 0) {
      const initial: Record<string, boolean> = {};
      notas.forEach((nota) => {
        const key = nota.chave_acesso || nota.numero_nota;
        initial[key] = nota.sugestao_revenda;
      });
      setDecisoes(initial);
    }
  }, [notas]);

  const handleToggle = (key: string, value: boolean) => {
    setDecisoes((prev) => ({ ...prev, [key]: value }));
  };

  const handleSetAll = (value: boolean) => {
    const updated: Record<string, boolean> = {};
    notas.forEach((nota) => {
      const key = nota.chave_acesso || nota.numero_nota;
      updated[key] = value;
    });
    setDecisoes(updated);
  };

  const handleCopyChave = (chave: string) => {
    if (!chave) return;
    navigator.clipboard.writeText(chave);
    setCopiedKey(chave);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const formatCurrency = (val: number) =>
    Number(val || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  const totalParaRevenda = Object.values(decisoes).filter(Boolean).length;
  const totalNaoRevenda = notas.length - totalParaRevenda;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Destinação de Bonificação e Amostra Grátis"
      subtitle="Defina se as mercadorias recebidas serão destinadas à revenda para apuração do imposto parcial."
      maxWidth="4xl"
    >
      <div className="space-y-4 text-slate-800">
        {/* Banner Informativo */}
        <div className="bg-blue-50/70 border border-blue-200/80 rounded-xl p-4 flex gap-3 text-xs sm:text-sm text-blue-900 leading-relaxed shadow-xs">
          <HelpCircle className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="font-semibold text-blue-950">
              Por que esta confirmação é necessária?
            </p>
            <p className="text-blue-800/90">
              Mercadorias em <strong>remessa em bonificação (CFOP 6910 / 2910)</strong> ou{' '}
              <strong>amostra grátis (CFOP 6911 / 2911)</strong> destinadas para comercialização/revenda
              devem ser incluídas na <strong>Planilha de Antecipação Parcial</strong>. Caso não sejam destinadas
              à revenda, não devem ser tributadas e serão listadas no relatório de notas desconsideradas.
            </p>
          </div>
        </div>

        {/* Ações em Massa */}
        {notas.length > 1 && (
          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <span className="text-xs text-slate-500 font-medium">
              {notas.length} nota(s) fiscal(is) identificada(s):
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => handleSetAll(true)}
                className="text-xs text-emerald-700 hover:text-emerald-800 font-medium px-2.5 py-1 rounded-md bg-emerald-50 hover:bg-emerald-100/80 border border-emerald-200 transition-colors"
              >
                Marcar todas como Revenda
              </button>
              <button
                type="button"
                onClick={() => handleSetAll(false)}
                className="text-xs text-slate-600 hover:text-slate-800 font-medium px-2.5 py-1 rounded-md bg-slate-100 hover:bg-slate-200/80 border border-slate-200 transition-colors"
              >
                Marcar todas como Não
              </button>
            </div>
          </div>
        )}

        {/* Lista de Notas Fiscais */}
        <div className="max-h-[380px] overflow-y-auto space-y-3 pr-1 divide-y divide-slate-100">
          {notas.map((nota) => {
            const key = nota.chave_acesso || nota.numero_nota;
            const isRevenda = Boolean(decisoes[key]);

            return (
              <div
                key={key}
                className={`p-3.5 rounded-xl border transition-all duration-150 ${
                  isRevenda
                    ? 'bg-emerald-50/30 border-emerald-300/80 shadow-2xs'
                    : 'bg-white border-slate-200/90'
                }`}
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  {/* Informações da Nota */}
                  <div className="space-y-1.5 min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-bold text-slate-900 text-sm flex items-center gap-1.5">
                        <Package className="w-4 h-4 text-slate-500" />
                        NF-e nº {nota.numero_nota}
                        {nota.serie && <span className="text-slate-400 font-normal">Série {nota.serie}</span>}
                      </span>
                      {nota.cfops.map((cfop) => (
                        <Badge key={cfop} size="sm" variant="purple">
                          CFOP {cfop}
                        </Badge>
                      ))}
                      <Badge
                        size="sm"
                        variant={nota.tem_credito ? 'success' : 'neutral'}
                        dot
                      >
                        {nota.tem_credito ? 'Crédito destacado' : 'Sem crédito destacado'}
                      </Badge>
                    </div>

                    {/* Emitente */}
                    <div className="text-xs text-slate-600 flex items-center gap-1.5 truncate">
                      <Building2 className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      <span className="truncate font-medium text-slate-700">
                        {nota.nome_emitente || 'Fornecedor'}
                      </span>
                      {nota.cnpj_emitente && (
                        <span className="text-slate-400 shrink-0 font-mono text-[11px]">
                          ({nota.cnpj_emitente})
                        </span>
                      )}
                    </div>

                    {/* Chave de Acesso */}
                    {nota.chave_acesso && (
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[11px] text-slate-500 truncate select-all">
                          Chave: {nota.chave_acesso}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleCopyChave(nota.chave_acesso)}
                          className="text-slate-400 hover:text-slate-700 transition-colors shrink-0"
                          title="Copiar chave de acesso"
                        >
                          {copiedKey === nota.chave_acesso ? (
                            <Check className="w-3.5 h-3.5 text-emerald-600" />
                          ) : (
                            <Copy className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </div>
                    )}

                    {/* Motivo da Sugestão */}
                    <div className="text-[11px] text-slate-500 italic">
                      Sugestão do sistema: {nota.motivo_sugestao}
                    </div>
                  </div>

                  {/* Valor e Botões de Ação */}
                  <div className="flex sm:flex-col items-center sm:items-end justify-between sm:justify-center gap-2 shrink-0 pt-2 sm:pt-0 border-t sm:border-t-0 border-slate-100">
                    <div className="text-right">
                      <span className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold block">
                        Valor Bonificado
                      </span>
                      <span className="font-bold text-slate-900 text-sm sm:text-base">
                        {formatCurrency(nota.valor_total)}
                      </span>
                    </div>

                    {/* Alternância Sim / Não */}
                    <div className="inline-flex rounded-lg p-0.5 bg-slate-100/90 border border-slate-200">
                      <button
                        type="button"
                        onClick={() => handleToggle(key, true)}
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all select-none ${
                          isRevenda
                            ? 'bg-emerald-600 text-white shadow-xs'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        Sim (Revenda)
                      </button>
                      <button
                        type="button"
                        onClick={() => handleToggle(key, false)}
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all select-none ${
                          !isRevenda
                            ? 'bg-slate-700 text-white shadow-xs'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        <XCircle className="w-3.5 h-3.5" />
                        Não
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Resumo e Botões de Rodapé */}
        <div className="pt-3 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="text-xs text-slate-600">
            <span className="font-semibold text-emerald-700">{totalParaRevenda}</span> para revenda (incluídas na Parcial)
            {' • '}
            <span className="font-semibold text-slate-700">{totalNaoRevenda}</span> desconsiderada(s)
          </div>

          <div className="flex items-center gap-2.5 w-full sm:w-auto">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={isProcessing}
              className="flex-1 sm:flex-initial"
            >
              Cancelar
            </Button>
            <Button
              type="button"
              variant="primary"
              onClick={() => onConfirm(decisoes)}
              isLoading={isProcessing}
              leftIcon={<FileSpreadsheet className="w-4 h-4" />}
              className="flex-1 sm:flex-initial"
            >
              Confirmar e Gerar Planilha
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
};
