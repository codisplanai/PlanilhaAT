import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Building2,
  Check,
  Copy,
  FileArchive,
  FileCode,
  FileSpreadsheet,
  Trash2,
  Truck,
  Upload,
} from 'lucide-react';
import { Modal } from './ui/Modal';
import { Button } from './ui/Button';
import { Badge } from './ui/Badge';
import { formatCurrency } from '../lib/formatters';
import { useManagedTimeout } from '../hooks/useManagedTimeout';
import type { CteSemNfePendencia } from '../types/solicitacao';

const MAX_FILE_BYTES = 20 * 1024 * 1024;

function isXmlOrZip(file: File): boolean {
  const name = file.name.toLowerCase();
  return name.endsWith('.xml') || name.endsWith('.zip');
}

export interface ModalPendenciaCteNfeProps {
  isOpen: boolean;
  onClose: () => void;
  pendencias: CteSemNfePendencia[];
  onAttachFiles: (files: File[]) => void;
  onIgnorePending: () => void;
  isProcessing?: boolean;
}

export const ModalPendenciaCteNfe: React.FC<ModalPendenciaCteNfeProps> = ({
  isOpen,
  onClose,
  pendencias,
  onAttachFiles,
  onIgnorePending,
  isProcessing = false,
}) => {
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const copyFeedbackTimeout = useManagedTimeout();

  useEffect(() => {
    if (!isOpen) {
      setAttachedFiles([]);
      setFileError(null);
      setDragOver(false);
    }
  }, [isOpen, pendencias]);

  const addFiles = (incoming: File[]) => {
    if (incoming.length === 0) return;
    const valid = incoming.filter(
      (file) => isXmlOrZip(file) && file.size > 0 && file.size <= MAX_FILE_BYTES,
    );
    const keyOf = (file: File) => `${file.name}|${file.size}|${file.lastModified}`;
    const existing = new Set(attachedFiles.map(keyOf));
    const added = valid.filter((file) => !existing.has(keyOf(file)));
    if (added.length > 0) {
      setAttachedFiles((prev) => [...prev, ...added]);
    }
    if (valid.length < incoming.length) {
      setFileError('Use apenas arquivos .xml ou .zip não vazios (até 20 MB por arquivo).');
    } else {
      setFileError(null);
    }
  };

  const handleCopyChave = async (chave: string) => {
    if (!chave) return;
    try {
      await navigator.clipboard.writeText(chave);
      setCopiedKey(chave);
      copyFeedbackTimeout.schedule(() => setCopiedKey(null), 2000);
    } catch {
      // O texto continua selecionável quando a Clipboard API estiver indisponível.
    }
  };

  const totalMissingNfes = pendencias.reduce((sum, item) => sum + item.nfes_faltantes.length, 0);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="NF-e(s) Originária(s) de CT-e Não Localizada(s)"
      subtitle="Forneça os XMLs das notas fiscais vinculadas aos CT-es (ou um arquivo .ZIP com várias notas) para calcular e ratear o frete."
      maxWidth="4xl"
    >
      <div className="space-y-4 text-slate-800">
        <div className="bg-amber-50/80 border border-amber-200 rounded-xl p-4 flex gap-3 text-xs sm:text-sm text-amber-950 leading-relaxed">
          <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="font-semibold">
              Foram identificados {pendencias.length} CT-e(s) com {totalMissingNfes} NF-e(s) originária(s) ausente(s)
            </p>
            <p className="text-amber-900/90 text-xs">
              Para incluir o CT-e na planilha de <strong>Antecipação Tributária</strong> ou <strong>DIFAL</strong> e realizar o rateio proporcional quando houver mercadorias mistas, o sistema precisa consultar os produtos e o MVA nos XMLs das NF-es abaixo. Você pode anexar um pacote <strong>.ZIP</strong> com várias notas que o sistema identificará automaticamente as que precisa.
            </p>
          </div>
        </div>

        {/* Lista de CT-es e suas NF-es faltantes */}
        <div className="max-h-64 overflow-y-auto space-y-3 pr-1">
          {pendencias.map((cte) => (
            <div
              key={cte.cte_chave_acesso || cte.cte_numero}
              className="p-3.5 rounded-xl border border-slate-200 bg-slate-50/60 space-y-2.5"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2 min-w-0">
                  <span className="font-bold text-slate-900 text-sm flex items-center gap-1.5">
                    <Truck className="w-4 h-4 text-blue-600 shrink-0" />
                    CT-e nº {cte.cte_numero}
                    {cte.cte_serie && (
                      <span className="text-slate-400 font-normal text-xs">Série {cte.cte_serie}</span>
                    )}
                  </span>
                  <Badge size="sm" variant="info">
                    {cte.nfes_faltantes.length} NF-e(s) faltante(s)
                  </Badge>
                </div>
                <span className="font-mono font-bold text-slate-900 text-xs sm:text-sm">
                  {formatCurrency(cte.valor_total)}
                </span>
              </div>

              {(cte.nome_emitente || cte.cnpj_emitente) && (
                <div className="text-xs text-slate-600 flex items-center gap-1.5 truncate">
                  <Building2 className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                  <span className="truncate font-medium text-slate-700">
                    {cte.nome_emitente || 'Transportadora'}
                  </span>
                  {cte.cnpj_emitente && (
                    <span className="text-slate-400 font-mono text-[11px] shrink-0">
                      ({cte.cnpj_emitente})
                    </span>
                  )}
                </div>
              )}

              <div className="space-y-1.5 pt-1 border-t border-slate-200/80">
                {cte.nfes_faltantes.map((nfe) => (
                  <div
                    key={nfe.chave_acesso}
                    className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 bg-white border border-slate-200/90 rounded-lg px-3 py-2 text-xs"
                  >
                    <div className="flex items-center gap-2 font-semibold text-slate-900 shrink-0">
                      <span>NF-e nº {nfe.numero_nota || '—'}</span>
                      {nfe.serie && (
                        <span className="text-slate-400 font-normal">Série {nfe.serie}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-mono text-[11px] text-slate-600 truncate select-all">
                        {nfe.chave_acesso}
                      </span>
                      <button
                        type="button"
                        onClick={() => void handleCopyChave(nfe.chave_acesso)}
                        className="text-slate-400 hover:text-slate-700 p-1 rounded hover:bg-slate-100 transition-colors shrink-0 cursor-pointer"
                        title="Copiar chave de acesso da NF-e"
                        aria-label={`Copiar chave da NF-e ${nfe.numero_nota}`}
                      >
                        {copiedKey === nfe.chave_acesso ? (
                          <Check className="w-3.5 h-3.5 text-emerald-600" />
                        ) : (
                          <Copy className="w-3.5 h-3.5" />
                        )}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Upload Complementar */}
        <div className="space-y-2.5">
          <input
            id="cte-missing-nfe-input"
            type="file"
            multiple
            accept=".xml,text/xml,.zip,application/zip,application/x-zip-compressed"
            onChange={(event) => {
              addFiles(Array.from(event.target.files ?? []));
              event.target.value = '';
            }}
            className="hidden"
          />
          <div
            role="button"
            tabIndex={0}
            aria-label="Selecionar XMLs ou ZIP das NF-es originárias"
            onClick={() => document.getElementById('cte-missing-nfe-input')?.click()}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                document.getElementById('cte-missing-nfe-input')?.click();
              }
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              addFiles(Array.from(e.dataTransfer.files));
            }}
            className={`border-2 border-dashed rounded-xl p-4 text-center transition-all cursor-pointer ${
              dragOver
                ? 'border-blue-500 bg-blue-50/70'
                : 'border-blue-200 bg-blue-50/20 hover:border-blue-400 hover:bg-blue-50/40'
            }`}
          >
            <div className="flex flex-col items-center gap-1">
              <Upload className="w-5 h-5 text-blue-600" />
              <p className="text-xs sm:text-sm font-semibold text-slate-800">
                Arraste os arquivos <span className="text-blue-700 font-bold">.XML ou .ZIP</span> aqui, ou{' '}
                <span className="text-blue-700 underline font-bold">clique para anexar</span>
              </p>
              <p className="text-[11px] text-slate-500">
                Se a NF-e for de outra competência, ela será usada apenas para cálculo e rateio do CT-e.
              </p>
            </div>
          </div>

          {fileError && (
            <p role="alert" className="text-xs font-medium text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
              {fileError}
            </p>
          )}

          {attachedFiles.length > 0 && (
            <div className="max-h-32 overflow-y-auto rounded-xl border border-slate-200 divide-y divide-slate-100 bg-slate-50/40">
              {attachedFiles.map((file, idx) => {
                const isZip = file.name.toLowerCase().endsWith('.zip');
                return (
                  <div
                    key={`${file.name}-${file.size}-${file.lastModified}`}
                    className="px-3 py-2 flex items-center justify-between text-xs"
                  >
                    <div className="flex items-center gap-2 overflow-hidden">
                      {isZip ? (
                        <FileArchive className="w-4 h-4 text-amber-600 shrink-0" />
                      ) : (
                        <FileCode className="w-4 h-4 text-blue-600 shrink-0" />
                      )}
                      <span className="font-medium text-slate-800 truncate">{file.name}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setAttachedFiles((prev) => prev.filter((_, i) => i !== idx))}
                      aria-label={`Remover ${file.name}`}
                      className="text-slate-400 hover:text-rose-600 p-1 rounded cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Rodapé */}
        <div className="pt-3 border-t border-slate-200 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5">
          <Button
            type="button"
            variant="ghost"
            onClick={onIgnorePending}
            disabled={isProcessing}
            className="text-slate-600 hover:text-slate-900"
          >
            Continuar sem essas notas (ignorar CT-es)
          </Button>

          <div className="flex items-center gap-2.5">
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
              onClick={() => onAttachFiles(attachedFiles)}
              disabled={attachedFiles.length === 0 || isProcessing}
              isLoading={isProcessing}
              leftIcon={<FileSpreadsheet className="w-4 h-4" />}
              className="flex-1 sm:flex-initial"
            >
              Anexar e Continuar Processamento
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
};

