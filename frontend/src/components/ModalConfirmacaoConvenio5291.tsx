import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check, Copy, FileSpreadsheet, PackageSearch } from 'lucide-react';
import { Badge } from './ui/Badge';
import { Button } from './ui/Button';
import { Modal } from './ui/Modal';
import { useManagedTimeout } from '../hooks/useManagedTimeout';
import { formatCurrency, formatPercent } from '../lib/formatters';
import type { Convenio5291Pendencia } from '../types/solicitacao';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  itens: Convenio5291Pendencia[];
  onConfirm: (decisoes: Record<string, boolean>) => void;
  isProcessing?: boolean;
}

function groupIdentity(item: Convenio5291Pendencia): string {
  return `${item.ncm}|${item.descricao_normalizada}`;
}

export const ModalConfirmacaoConvenio5291: React.FC<Props> = ({
  isOpen,
  onClose,
  itens,
  onConfirm,
  isProcessing = false,
}) => {
  const [decisoes, setDecisoes] = useState<Record<string, boolean>>({});
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const copyTimeout = useManagedTimeout();

  useEffect(() => {
    const initial: Record<string, boolean> = {};
    itens.forEach((item) => {
      initial[item.decision_key] = item.sugestao_aplicar;
    });
    setDecisoes(initial);
  }, [itens]);

  const setDecision = (item: Convenio5291Pendencia, value: boolean, identical = false) => {
    setDecisoes((current) => {
      const next = { ...current, [item.decision_key]: value };
      if (identical) {
        const identity = groupIdentity(item);
        itens.forEach((candidate) => {
          if (groupIdentity(candidate) === identity) next[candidate.decision_key] = value;
        });
      }
      return next;
    });
  };

  const totals = useMemo(() => {
    const apply = itens.filter((item) => decisoes[item.decision_key] === true).length;
    return { apply, normal: itens.length - apply };
  }, [decisoes, itens]);

  const copyKey = async (key: string) => {
    try {
      await navigator.clipboard.writeText(key.replace(/\D/g, ''));
      setCopiedKey(key);
      copyTimeout.schedule(() => setCopiedKey(null), 1800);
    } catch {
      // O texto continua selecionável quando a Clipboard API estiver indisponível.
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Possível redução de base — Convênio ICMS 52/91"
      subtitle="Confirme somente os itens em que NCM, descrição ou tratamento da NF-e não permitem decisão automática."
      maxWidth="6xl"
    >
      <div className="space-y-4">
        <div className="flex gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs leading-relaxed text-amber-950">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
          <div>
            <p className="font-bold">A confirmação vale apenas para este processamento.</p>
            <p className="mt-1 text-amber-900/90">
              CST terminado em 20 e pRedBC são indícios do tratamento adotado pelo fornecedor, mas não substituem o enquadramento legal do produto.
            </p>
          </div>
        </div>

        <div className="max-h-[520px] space-y-3 overflow-y-auto pr-1">
          {itens.map((item) => {
            const applying = decisoes[item.decision_key] === true;
            const identicalCount = itens.filter((candidate) => groupIdentity(candidate) === groupIdentity(item)).length;
            return (
              <div
                key={item.decision_key}
                className={`rounded-xl border p-4 transition ${applying ? 'border-emerald-300 bg-emerald-50/30' : 'border-slate-200 bg-white'}`}
              >
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="inline-flex items-center gap-1.5 text-sm font-bold text-slate-900">
                        <PackageSearch className="h-4 w-4 text-slate-500" />
                        NF-e {item.numero_nota} · Item {item.item_numero}
                      </span>
                      <Badge size="sm" variant="purple">NCM {item.ncm}</Badge>
                      {item.cst && <Badge size="sm" variant={item.cst.endsWith('20') ? 'warning' : 'neutral'}>CST {item.cst}</Badge>}
                    </div>

                    <p className="text-xs font-semibold text-slate-800">{item.fornecedor || 'Fornecedor não identificado'}</p>
                    <p className="text-xs leading-relaxed text-slate-700">{item.descricao}</p>

                    {item.chave_acesso && (
                      <div className="flex items-center gap-2">
                        <span className="select-all break-all font-mono text-[11px] text-slate-500">
                          Chave: {item.chave_acesso}
                        </span>
                        <button
                          type="button"
                          onClick={() => void copyKey(item.chave_acesso)}
                          className="shrink-0 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                          title="Copiar chave de acesso"
                          aria-label="Copiar chave de acesso"
                        >
                          {copiedKey === item.chave_acesso ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                        </button>
                      </div>
                    )}

                    <div className="grid grid-cols-2 gap-2 rounded-lg bg-slate-50 p-3 text-[11px] sm:grid-cols-4">
                      <div><span className="block text-slate-400">pICMS</span><strong>{formatPercent(item.p_icms)}</strong></div>
                      <div><span className="block text-slate-400">pRedBC</span><strong>{formatPercent(item.p_red_bc)}</strong></div>
                      <div><span className="block text-slate-400">vBC da NF-e</span><strong>{formatCurrency(item.v_bc_xml)}</strong></div>
                      <div><span className="block text-slate-400">Base proposta</span><strong>{formatCurrency(item.base_sem_ipi)}</strong></div>
                    </div>

                    <div className="rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2 text-[11px] leading-relaxed text-slate-600">
                      <strong className="text-slate-800">Motivo da revisão:</strong> {item.motivo}
                      {(item.cst20 || item.reducao_destacada) && (
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {item.cst20 && <Badge size="sm" variant="warning">CST X20</Badge>}
                          {item.reducao_destacada && <Badge size="sm" variant="warning">Redução destacada</Badge>}
                          {item.operacao_quatro_por_cento && <Badge size="sm" variant="neutral">Origem 4%</Badge>}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="shrink-0 space-y-2 lg:w-[280px]">
                    <div className="grid grid-cols-2 gap-2">
                      <Button type="button" variant={applying ? 'outline' : 'secondary'} onClick={() => setDecision(item, false)}>
                        Não aplicar
                      </Button>
                      <Button type="button" variant={applying ? 'primary' : 'outline'} onClick={() => setDecision(item, true)}>
                        Aplicar Convênio
                      </Button>
                    </div>
                    {identicalCount > 1 && (
                      <button
                        type="button"
                        onClick={() => setDecision(item, applying, true)}
                        className="w-full rounded-lg border border-slate-200 px-2.5 py-2 text-[11px] font-semibold text-slate-600 hover:bg-slate-50"
                      >
                        Aplicar esta decisão aos {identicalCount} itens idênticos
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex flex-col gap-3 border-t border-slate-200 pt-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-slate-600">
            <strong className="text-emerald-700">{totals.apply}</strong> aplicar Convênio ·{' '}
            <strong>{totals.normal}</strong> manter tratamento normal
          </p>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={isProcessing}>Cancelar</Button>
            <Button
              type="button"
              onClick={() => onConfirm(decisoes)}
              isLoading={isProcessing}
              leftIcon={<FileSpreadsheet className="h-4 w-4" />}
            >
              Confirmar e continuar
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
};
