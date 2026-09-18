import React, { useMemo, useState } from 'react';
import { Activity, Download, Eye, FileJson, Trash2 } from 'lucide-react';

import type { DiagnosticAttempt, DiagnosticSession, DiagnosticStatus } from '../../lib/processingDiagnostics';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';

interface ProcessingDiagnosticsProps {
  session: DiagnosticSession;
  isProcessing: boolean;
  onDownloadText: () => void;
  onDownloadJson: () => void;
  onClear: () => void;
}

const statusLabels: Record<DiagnosticStatus, string> = {
  em_andamento: 'Em andamento',
  aguardando_decisao: 'Aguardando confirmação',
  concluido: 'Concluído',
  concluido_com_avisos: 'Concluído com avisos',
  parcialmente_concluido: 'Parcialmente concluído',
  cancelado: 'Cancelado',
  falhou: 'Falhou',
};

function statusVariant(status: DiagnosticStatus): 'success' | 'warning' | 'error' | 'info' | 'neutral' {
  if (status === 'concluido') return 'success';
  if (status === 'falhou') return 'error';
  if (status === 'em_andamento' || status === 'aguardando_decisao') return 'info';
  if (status === 'concluido_com_avisos' || status === 'parcialmente_concluido') return 'warning';
  return 'neutral';
}

function shortId(value: string): string {
  return value.length > 24 ? `${value.slice(0, 12)}…${value.slice(-8)}` : value;
}

export const ProcessingDiagnostics: React.FC<ProcessingDiagnosticsProps> = ({
  session,
  isProcessing,
  onDownloadText,
  onDownloadJson,
  onClear,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedAttemptId, setSelectedAttemptId] = useState<string | null>(null);
  const latest = session.attempts.at(-1);
  const selected = useMemo<DiagnosticAttempt | undefined>(
    () => session.attempts.find((attempt) => attempt.attemptId === selectedAttemptId) ?? latest,
    [latest, selectedAttemptId, session.attempts],
  );
  const warningCount = latest?.summary.warnings ?? 0;
  const errorCount = latest?.summary.errors ?? 0;

  return (
    <>
      <section className="rounded-xl border border-slate-200 bg-slate-50/70 p-4" aria-label="Diagnóstico do processamento">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Activity className="h-4 w-4 text-blue-700" />
              <h3 className="text-sm font-bold text-slate-900">Acompanhamento da execução</h3>
              {latest && <Badge variant={statusVariant(latest.status)} size="sm" dot>{statusLabels[latest.status]}</Badge>}
            </div>
            <p className="mt-1 text-xs leading-relaxed text-slate-500">
              {latest
                ? `Etapa atual: ${latest.currentStage.replaceAll('_', ' ')} · ${warningCount} aviso(s) · ${errorCount} erro(s)`
                : 'O diagnóstico será iniciado junto com a geração da planilha.'}
            </p>
            <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
              Registros temporários mantidos apenas nesta página. Eles serão perdidos ao fechar ou recarregar.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              leftIcon={<Eye className="h-3.5 w-3.5" />}
              disabled={session.attempts.length === 0}
              onClick={() => setIsOpen(true)}
            >
              Ver diagnóstico
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              leftIcon={<Download className="h-3.5 w-3.5" />}
              disabled={session.attempts.length === 0}
              onClick={onDownloadText}
            >
              Baixar log
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              leftIcon={<Trash2 className="h-3.5 w-3.5" />}
              disabled={isProcessing || session.attempts.length === 0}
              onClick={onClear}
            >
              Limpar diagnóstico
            </Button>
          </div>
        </div>
      </section>

      <Modal
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        title="Diagnóstico do processamento"
        subtitle={`Sessão ${shortId(session.sessionId)} · ${session.timezone} · versão ${session.appVersion}`}
        maxWidth="4xl"
      >
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-2">
              {session.attempts.map((attempt, index) => (
                <button
                  key={attempt.attemptId}
                  type="button"
                  onClick={() => setSelectedAttemptId(attempt.attemptId)}
                  className={`rounded-lg border px-3 py-2 text-left text-xs transition-colors cursor-pointer ${
                    selected?.attemptId === attempt.attemptId
                      ? 'border-blue-500 bg-blue-50 text-blue-900'
                      : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                  }`}
                >
                  <span className="block font-bold">Tentativa {index + 1}</span>
                  <span>{statusLabels[attempt.status]}</span>
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="outline" size="sm" leftIcon={<Download className="h-3.5 w-3.5" />} onClick={onDownloadText}>
                Baixar .txt
              </Button>
              <Button type="button" variant="outline" size="sm" leftIcon={<FileJson className="h-3.5 w-3.5" />} onClick={onDownloadJson}>
                Baixar JSON
              </Button>
            </div>
          </div>

          {selected && (
            <>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {[
                  ['Lidos', selected.summary.read],
                  ['Processados', selected.summary.processed],
                  ['Ignorados', selected.summary.ignored],
                  ['Rejeitados', selected.summary.rejected],
                  ['Saídas', selected.summary.outputs],
                  ['Avisos', selected.summary.warnings],
                  ['Erros', selected.summary.errors],
                  ['Duração', `${selected.durationMs ?? 0} ms`],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-lg border border-slate-200 bg-white p-3">
                    <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</span>
                    <span className="mt-0.5 block text-sm font-bold text-slate-900">{value}</span>
                  </div>
                ))}
              </div>

              {selected.truncatedEvents > 0 && (
                <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
                  Este diagnóstico atingiu o limite de eventos não críticos. {selected.truncatedEvents} evento(s) foram truncados; erros foram preservados.
                </div>
              )}

              <div className="max-h-[44vh] overflow-auto rounded-xl border border-slate-200 bg-slate-950 p-3 font-mono text-[11px] leading-relaxed text-slate-200">
                {selected.events.map((event) => (
                  <div key={`${event.sequence}-${event.timestamp}`} className="border-b border-slate-800 py-2 last:border-b-0">
                    <div className={event.level === 'error' ? 'text-rose-300' : event.level === 'warning' ? 'text-amber-300' : 'text-slate-200'}>
                      [{event.sequence}] {event.timestamp} {event.level.toUpperCase()} [{event.stage}] {event.message}
                    </div>
                    {event.durationMs !== undefined && <div className="text-slate-400">duração: {event.durationMs} ms</div>}
                    {event.context && <pre className="mt-1 whitespace-pre-wrap break-words text-slate-400">{JSON.stringify(event.context, null, 2)}</pre>}
                    {event.exception && <pre className="mt-1 whitespace-pre-wrap break-words text-rose-200">{JSON.stringify(event.exception, null, 2)}</pre>}
                  </div>
                ))}
              </div>
            </>
          )}

          <p className="text-[11px] leading-relaxed text-slate-500">
            Os arquivos de diagnóstico são criados somente quando você solicita o download. O histórico não usa armazenamento permanente e não pode ser recuperado após o fechamento ou recarregamento da página.
          </p>
        </div>
      </Modal>
    </>
  );
};
