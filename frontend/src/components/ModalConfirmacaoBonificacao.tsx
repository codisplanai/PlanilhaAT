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
import { DanfeButton } from './DanfeButton';
import { Button } from './ui/Button';
import { Badge } from './ui/Badge';
import { formatCurrency } from '../lib/formatters';
import { useManagedTimeout } from '../hooks/useManagedTimeout';
import { initialBonusDecisions } from '../lib/bonusDecisions';
import type { NotaBonificacaoPendencia } from '../types/solicitacao';

export interface ModalConfirmacaoBonificacaoProps {
  isOpen: boolean;
  onClose: () => void;
  notas: NotaBonificacaoPendencia[];
  xmlFiles?: File[];
  onConfirm: (decisoes: Record<string, boolean>) => void;
  isProcessing?: boolean;
  /** Empresa industrial: escolhe entre uso/consumo (DIFAL) e ignorar. */
  industria?: boolean;
}

export const ModalConfirmacaoBonificacao: React.FC<ModalConfirmacaoBonificacaoProps> = ({
  isOpen,
  onClose,
  notas,
  xmlFiles,
  onConfirm,
  isProcessing = false,
  industria = false,
}) => {
  // Contrato da decisão: true = não é uso/consumo (revenda; na indústria, ignorar),
  // false = uso/consumo (DIFAL).
  const textos = industria
    ? {
      titulo: 'Confirmação de Uso/Consumo (CFOP 6910, 6911, 6949)',
      subtitulo: 'Empresa industrial: confirme quais mercadorias são para uso/consumo ou ativo (DIFAL). As demais serão ignoradas.',
      opcaoTrue: 'Ignorar',
      opcaoFalse: 'Uso/Consumo (DIFAL)',
      todasTrue: 'Marcar todas como Ignorar',
      todasFalse: 'Marcar todas como Uso/Consumo (DIFAL)',
      resumoTrue: 'ignorada(s)',
      resumoFalse: 'para uso/consumo (DIFAL)',
    }
    : {
      titulo: 'Destinação de Mercadorias (CFOP 6910, 6911, 6949)',
      subtitulo: 'Defina se as mercadorias recebidas serão destinadas à revenda (Antecipação Parcial) ou uso/consumo (DIFAL).',
      opcaoTrue: 'Revenda (Parcial)',
      opcaoFalse: 'Uso/Consumo (DIFAL)',
      todasTrue: 'Marcar todas como Revenda (Parcial)',
      todasFalse: 'Marcar todas como Uso/Consumo (DIFAL)',
      resumoTrue: 'para revenda (Parcial)',
      resumoFalse: 'para uso/consumo (DIFAL)',
    };
  const [decisoes, setDecisoes] = useState<Record<string, boolean>>({});
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);
  const copyFeedbackTimeout = useManagedTimeout();

  // Inicializa decisões com as sugestões inteligentes detectadas
  useEffect(() => {
    if (notas && notas.length > 0) {
      setDecisoes(initialBonusDecisions(notas, industria));
    }
  }, [notas, industria]);

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

  const handleCopyChave = async (chave: string) => {
    if (!chave) return;
    try {
      // Indisponível fora de contexto seguro ou sem permissão: sem o try, a
      // promessa rejeitada virava um erro não tratado no console.
      await navigator.clipboard.writeText(chave);
      setCopiedKey(chave);
      copyFeedbackTimeout.schedule(() => setCopiedKey(null), 2000);
    } catch {
      setCopyError('Não foi possível copiar a chave de acesso. Selecione o texto e copie manualmente.');
      copyFeedbackTimeout.schedule(() => setCopyError(null), 4000);
    }
  };

  const totalParaRevenda = Object.values(decisoes).filter(Boolean).length;
  const totalNaoRevenda = notas.length - totalParaRevenda;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={textos.titulo}
      subtitle={textos.subtitulo}
      maxWidth="4xl"
    >
      <div className="space-y-4 text-slate-800">
        {copyError && (
          <p
            role="status"
            className="text-xs font-medium text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2"
          >
            {copyError}
          </p>
        )}

        {/* Banner Informativo */}
        <div className="bg-blue-50/70 border border-blue-200/80 rounded-xl p-4 flex gap-3 text-xs sm:text-sm text-blue-900 leading-relaxed shadow-xs">
          <HelpCircle className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="font-semibold text-blue-950">
              Por que esta confirmação é necessária?
            </p>
            <p className="text-blue-800/90">
              Mercadorias em <strong>bonificação (CFOP 6910 / 2910)</strong>,{' '}
              <strong>amostra grátis (CFOP 6911 / 2911)</strong> ou{' '}
              <strong>outras saídas (CFOP 6949 / 2949)</strong> destinadas para comercialização/revenda
              serão incluídas na <strong>Planilha de Antecipação Parcial</strong>. Caso sejam destinadas
              ao uso ou consumo do estabelecimento, serão direcionadas para a <strong>Planilha de DIFAL</strong>.
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
                {textos.todasTrue}
              </button>
              <button
                type="button"
                onClick={() => handleSetAll(false)}
                className="text-xs text-amber-700 hover:text-amber-800 font-medium px-2.5 py-1 rounded-md bg-amber-50 hover:bg-amber-100/80 border border-amber-200 transition-colors"
              >
                {textos.todasFalse}
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
                    : 'bg-amber-50/20 border-amber-200/80'
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

                    <div className="pt-1">
                      <DanfeButton chaveAcesso={nota.chave_acesso} numeroNota={nota.numero_nota} xmlFiles={xmlFiles} />
                      <p className="mt-1 text-[10px] text-slate-500">O XML é enviado somente ao solicitar o DANFE. Busca apenas pela chave pode custar R$ 0,03.</p>
                    </div>

                    {/* Motivo da Sugestão */}
                    <div className="text-[11px] text-slate-500 italic">
                      Sugestão do sistema: {nota.motivo_sugestao}
                    </div>
                  </div>

                  {/* Valor e Botões de Ação */}
                  <div className="flex sm:flex-col items-center sm:items-end justify-between sm:justify-center gap-2 shrink-0 pt-2 sm:pt-0 border-t sm:border-t-0 border-slate-100">
                    <div className="text-right">
                      <span className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold block">
                        Valor dos Itens
                      </span>
                      <span className="font-bold text-slate-900 text-sm sm:text-base">
                        {formatCurrency(nota.valor_total)}
                      </span>
                    </div>

                    {/* Alternância Revenda vs Uso/Consumo */}
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
                        {textos.opcaoTrue}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleToggle(key, false)}
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all select-none ${
                          !isRevenda
                            ? 'bg-amber-600 text-white shadow-xs'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        <XCircle className="w-3.5 h-3.5" />
                        {textos.opcaoFalse}
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
            {industria ? (
              <>
                <span className="font-semibold text-amber-700">{totalNaoRevenda}</span> {textos.resumoFalse}
                {' • '}
                <span className="font-semibold text-slate-700">{totalParaRevenda}</span> {textos.resumoTrue}
              </>
            ) : (
              <>
                <span className="font-semibold text-emerald-700">{totalParaRevenda}</span> {textos.resumoTrue}
                {' • '}
                <span className="font-semibold text-amber-700">{totalNaoRevenda}</span> {textos.resumoFalse}
              </>
            )}
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
