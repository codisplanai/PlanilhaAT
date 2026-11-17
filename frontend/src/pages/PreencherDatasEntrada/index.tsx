import React, { useState } from 'react';
import {
  AlertTriangle,
  CalendarCheck2,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  FileText,
  Info,
  Plus,
  RotateCcw,
  Trash2,
  Upload,
} from 'lucide-react';

import { ErrorAlert } from '../../components/feedback/ErrorAlert';
import { PageHeader } from '../../components/layout/PageHeader';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { formatDate } from '../../lib/formatters';
import type { EntryDateRowStatus } from '../../lib/localProcessing/entryDateFiller';
import { usePreencherDatasEntradaPage } from './usePreencherDatasEntradaPage';

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

const STATUS_BADGE: Record<EntryDateRowStatus, { label: string; variant: 'warning' | 'success' | 'info' }> = {
  pendente: { label: 'Sem data (topo)', variant: 'warning' },
  preenchida_agora: { label: 'Preenchida agora', variant: 'success' },
  ja_preenchida: { label: 'Já preenchida', variant: 'info' },
};

export const PreencherDatasEntradaPage: React.FC = () => {
  const {
    targetFiles,
    spedFiles,
    entrySheetFiles,
    fileError,
    clearFileError,
    processError,
    clearProcessError,
    isProcessing,
    canProcess,
    results,
    aggregatedSummary,
    handleTargetInput,
    handleTargetDrop,
    removeTargetFile,
    clearTargetFiles,
    handleSpedInput,
    handleSpedDrop,
    removeSpedFile,
    clearSpedFiles,
    handleEntrySheetInput,
    handleEntrySheetDrop,
    removeEntrySheetFile,
    clearEntrySheetFiles,
    processSpreadsheets,
    downloadResult,
    downloadAllZip,
    resetAll,
  } = usePreencherDatasEntradaPage();

  const [dragTarget, setDragTarget] = useState(false);
  const [dragSped, setDragSped] = useState(false);
  const [dragEntry, setDragEntry] = useState(false);

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <PageHeader
        icon={<CalendarCheck2 className="w-5 h-5 text-blue-700" />}
        title="Preencher Datas de Entrada"
        description="Atualize a coluna de Data de Entrada em planilhas já geradas (como Pago Antecipadamente), mantendo edições manuais e fórmulas intactas."
        action={
          (targetFiles.length > 0 || spedFiles.length > 0 || entrySheetFiles.length > 0 || results.length > 0) && (
            <Button
              variant="outline"
              size="sm"
              onClick={resetAll}
              disabled={isProcessing}
              leftIcon={<RotateCcw className="w-3.5 h-3.5" />}
            >
              Limpar tudo
            </Button>
          )
        }
      />

      {fileError && (
        <ErrorAlert title="Arquivo não aceito" message={fileError} onDismiss={clearFileError} />
      )}
      {processError && (
        <ErrorAlert title="Falha no preenchimento" message={processError} onDismiss={clearProcessError} />
      )}

      <div className="rounded-xl border border-blue-200/80 bg-blue-50/60 p-4 text-xs text-blue-950 flex items-start gap-3">
        <Info className="w-4 h-4 text-blue-700 shrink-0 mt-0.5" />
        <div className="space-y-1 leading-relaxed">
          <p className="font-semibold">Como funciona a atualização e reordenação:</p>
          <p className="text-blue-900/90">
            O sistema preenche apenas as linhas em que a <strong>Data de Entrada</strong> está em branco, preservando datas já informadas e edições manuais (como <em>VR. PAGO</em> e <em>DATA VENC.</em>). Em seguida, reordena a planilha deixando as notas <strong>ainda sem data de entrada no topo</strong> e as notas <strong>com data preenchida abaixo</strong>.
          </p>
        </div>
      </div>

      {/* 1. Planilha(s) alvo (.xlsx) */}
      <Card
        title="1. Planilhas de Pago Antecipadamente (.xlsx)"
        subtitle="Selecione uma ou mais planilhas geradas anteriormente cuja coluna de Data de Entrada precisa ser preenchida."
        headerAction={
          targetFiles.length > 0 ? (
            <Badge variant="info">{targetFiles.length} selecionada(s)</Badge>
          ) : (
            <Badge variant="neutral">Obrigatório</Badge>
          )
        }
      >
        <input
          id="target-xlsx-input"
          type="file"
          multiple
          accept=".xlsx"
          onChange={handleTargetInput}
          className="hidden"
        />

        <div
          role="button"
          tabIndex={0}
          aria-label="Selecionar planilhas .xlsx para atualizar"
          onClick={() => document.getElementById('target-xlsx-input')?.click()}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              document.getElementById('target-xlsx-input')?.click();
            }
          }}
          onDragOver={(e) => {
            e.preventDefault();
            setDragTarget(true);
          }}
          onDragLeave={() => setDragTarget(false)}
          onDrop={(e) => {
            setDragTarget(false);
            handleTargetDrop(e);
          }}
          className={`border-2 border-dashed rounded-xl p-5 text-center transition-all cursor-pointer ${
            dragTarget
              ? 'border-blue-500 bg-blue-50/70 scale-[0.99]'
              : 'border-blue-200/90 bg-blue-50/20 hover:border-blue-400 hover:bg-blue-50/40'
          }`}
        >
          <div className="flex flex-col items-center gap-1.5">
            <Upload className="w-5 h-5 text-blue-600 mb-0.5" />
            <p className="text-xs sm:text-sm font-semibold text-slate-800">
              Arraste as planilhas <span className="text-blue-700 font-bold">.xlsx</span> aqui, ou{' '}
              <span className="text-blue-700 underline font-bold">clique para selecionar</span>
            </p>
            <p className="text-[11px] text-slate-500">
              Planilhas de Parcial Antecipado, AT Antecipado ou DIFAL Antecipado • até 20 MB por arquivo
            </p>
          </div>
        </div>

        {targetFiles.length > 0 && (
          <div className="mt-4 pt-3 border-t border-slate-100 space-y-2">
            <div className="flex items-center justify-between text-xs font-semibold text-slate-700 px-1">
              <span>Arquivos selecionados ({targetFiles.length})</span>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => document.getElementById('target-xlsx-input')?.click()}
                  className="inline-flex items-center gap-1 text-[11px] font-bold text-blue-700 hover:text-blue-800 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" /> Adicionar mais
                </button>
                <button
                  type="button"
                  onClick={clearTargetFiles}
                  className="text-[11px] font-bold text-rose-600 hover:text-rose-800 cursor-pointer"
                >
                  Limpar todos
                </button>
              </div>
            </div>

            <div className="max-h-44 overflow-y-auto rounded-xl border border-slate-200/80 divide-y divide-slate-100 bg-slate-50/40">
              {targetFiles.map((file, idx) => (
                <div
                  key={`${file.name}-${file.size}-${file.lastModified}`}
                  className="p-2.5 px-3 flex items-center justify-between text-xs hover:bg-white transition-colors"
                >
                  <div className="flex items-center gap-2.5 overflow-hidden">
                    <FileSpreadsheet className="w-4 h-4 text-blue-600 shrink-0" />
                    <span className="font-medium text-slate-800 truncate" title={file.name}>
                      {file.name}
                    </span>
                    <span className="text-[10px] text-slate-400 font-mono shrink-0">
                      {formatBytes(file.size)}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeTargetFile(idx)}
                    aria-label={`Remover ${file.name}`}
                    className="text-slate-400 hover:text-rose-600 p-1 rounded-md hover:bg-rose-50 transition-colors cursor-pointer shrink-0"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </Card>

      {/* 2. Fontes das datas de entrada */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <Card
          title="2A. SPED Fiscal EFD (.txt)"
          subtitle="Extrai datas de entrada confirmadas no Registro C100."
          headerAction={
            spedFiles.length > 0 ? (
              <Badge variant="success">{spedFiles.length} arquivo(s)</Badge>
            ) : (
              <Badge variant="neutral">Opcional</Badge>
            )
          }
        >
          <input
            id="entry-filler-sped-input"
            type="file"
            multiple
            accept=".txt,text/plain"
            onChange={handleSpedInput}
            className="hidden"
          />

          <div
            role="button"
            tabIndex={0}
            aria-label="Selecionar arquivos SPED Fiscal"
            onClick={() => document.getElementById('entry-filler-sped-input')?.click()}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                document.getElementById('entry-filler-sped-input')?.click();
              }
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setDragSped(true);
            }}
            onDragLeave={() => setDragSped(false)}
            onDrop={(e) => {
              setDragSped(false);
              handleSpedDrop(e);
            }}
            className={`border-2 border-dashed rounded-xl p-5 text-center transition-all cursor-pointer ${
              dragSped
                ? 'border-indigo-500 bg-indigo-50/70 scale-[0.99]'
                : 'border-indigo-200/90 bg-indigo-50/20 hover:border-indigo-400 hover:bg-indigo-50/40'
            }`}
          >
            <div className="flex flex-col items-center gap-1.5">
              <FileText className="w-5 h-5 text-indigo-600 mb-0.5" />
              <p className="text-xs font-semibold text-slate-800">
                Arraste arquivo(s) <span className="text-indigo-700 font-bold">SPED (.txt)</span> ou{' '}
                <span className="text-indigo-700 underline font-bold">clique</span>
              </p>
              <p className="text-[11px] text-slate-500">Pode enviar SPEDs de múltiplos meses • até 50 MB</p>
            </div>
          </div>

          {spedFiles.length > 0 && (
            <div className="mt-3 pt-3 border-t border-slate-100 space-y-2">
              <div className="flex items-center justify-between text-xs font-semibold text-slate-700 px-1">
                <span>SPEDs ({spedFiles.length})</span>
                <button
                  type="button"
                  onClick={clearSpedFiles}
                  className="text-[11px] font-bold text-rose-600 hover:text-rose-800 cursor-pointer"
                >
                  Limpar
                </button>
              </div>
              <div className="max-h-36 overflow-y-auto rounded-xl border border-indigo-200/80 divide-y divide-indigo-100 bg-indigo-50/30">
                {spedFiles.map((file, idx) => (
                  <div
                    key={`${file.name}-${file.size}-${file.lastModified}`}
                    className="p-2 px-3 flex items-center justify-between text-xs"
                  >
                    <span className="font-medium text-indigo-950 truncate" title={file.name}>
                      {file.name}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeSpedFile(idx)}
                      aria-label={`Remover ${file.name}`}
                      className="text-indigo-400 hover:text-rose-600 p-1 rounded-md cursor-pointer shrink-0"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>

        <Card
          title="2B. Planilha de Entradas Contábil"
          subtitle="Relatório de entradas (.xls, .xlsx, .csv, .txt, .tsv)."
          headerAction={
            entrySheetFiles.length > 0 ? (
              <Badge variant="success">{entrySheetFiles.length} arquivo(s)</Badge>
            ) : (
              <Badge variant="neutral">Opcional</Badge>
            )
          }
        >
          <input
            id="entry-filler-sheet-input"
            type="file"
            multiple
            accept=".xls,.xlsx,.csv,.txt,.tsv"
            onChange={handleEntrySheetInput}
            className="hidden"
          />

          <div
            role="button"
            tabIndex={0}
            aria-label="Selecionar planilhas de entrada do sistema contábil"
            onClick={() => document.getElementById('entry-filler-sheet-input')?.click()}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                document.getElementById('entry-filler-sheet-input')?.click();
              }
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setDragEntry(true);
            }}
            onDragLeave={() => setDragEntry(false)}
            onDrop={(e) => {
              setDragEntry(false);
              handleEntrySheetDrop(e);
            }}
            className={`border-2 border-dashed rounded-xl p-5 text-center transition-all cursor-pointer ${
              dragEntry
                ? 'border-emerald-500 bg-emerald-50/70 scale-[0.99]'
                : 'border-emerald-200/90 bg-emerald-50/20 hover:border-emerald-400 hover:bg-emerald-50/40'
            }`}
          >
            <div className="flex flex-col items-center gap-1.5">
              <FileSpreadsheet className="w-5 h-5 text-emerald-600 mb-0.5" />
              <p className="text-xs font-semibold text-slate-800">
                Arraste planilha(s) de <span className="text-emerald-700 font-bold">entradas</span> ou{' '}
                <span className="text-emerald-700 underline font-bold">clique</span>
              </p>
              <p className="text-[11px] text-slate-500">Prosoft, Domínio ou Excel • até 20 MB por arquivo</p>
            </div>
          </div>

          {entrySheetFiles.length > 0 && (
            <div className="mt-3 pt-3 border-t border-slate-100 space-y-2">
              <div className="flex items-center justify-between text-xs font-semibold text-slate-700 px-1">
                <span>Planilhas ({entrySheetFiles.length})</span>
                <button
                  type="button"
                  onClick={clearEntrySheetFiles}
                  className="text-[11px] font-bold text-rose-600 hover:text-rose-800 cursor-pointer"
                >
                  Limpar
                </button>
              </div>
              <div className="max-h-36 overflow-y-auto rounded-xl border border-emerald-200/80 divide-y divide-emerald-100 bg-emerald-50/30">
                {entrySheetFiles.map((file, idx) => (
                  <div
                    key={`${file.name}-${file.size}-${file.lastModified}`}
                    className="p-2 px-3 flex items-center justify-between text-xs"
                  >
                    <span className="font-medium text-emerald-950 truncate" title={file.name}>
                      {file.name}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeEntrySheetFile(idx)}
                      aria-label={`Remover ${file.name}`}
                      className="text-emerald-600 hover:text-rose-600 p-1 rounded-md cursor-pointer shrink-0"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>
      </div>

      {/* Ação principal */}
      <div className="flex justify-end">
        <Button
          size="lg"
          onClick={processSpreadsheets}
          disabled={!canProcess}
          isLoading={isProcessing}
          leftIcon={<CalendarCheck2 className="w-4 h-4" />}
        >
          {isProcessing ? 'Processando planilhas...' : 'Preencher Datas e Reordenar Planilha(s)'}
        </Button>
      </div>

      {/* Resultado e conferência */}
      {results.length > 0 && (
        <div className="space-y-5 animate-fade-in">
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-600 text-white flex items-center justify-center shrink-0">
                <CheckCircle2 className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-sm sm:text-base font-bold text-emerald-950">
                  {results.length === 1
                    ? 'Planilha atualizada e reordenada com sucesso!'
                    : `${results.length} planilhas atualizadas e reordenadas com sucesso!`}
                </h2>
                <p className="text-xs text-emerald-900/80 mt-0.5">
                  Linhas sem data de entrada ficaram no topo e linhas com data de entrada ficaram abaixo.
                </p>
              </div>
            </div>

            {results.length > 1 && (
              <Button
                onClick={downloadAllZip}
                leftIcon={<Download className="w-4 h-4" />}
              >
                Baixar Todas (.zip)
              </Button>
            )}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-white border border-slate-200/90 p-3.5 rounded-xl shadow-2xs">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                Total de Linhas
              </span>
              <span className="text-lg font-bold font-mono text-slate-900 tabular-nums">
                {aggregatedSummary.totalRows}
              </span>
            </div>
            <div className="bg-emerald-50/70 border border-emerald-200 p-3.5 rounded-xl shadow-2xs">
              <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-800 block">
                Preenchidas Agora
              </span>
              <span className="text-lg font-bold font-mono text-emerald-900 tabular-nums">
                {aggregatedSummary.filledNow}
              </span>
            </div>
            <div className="bg-blue-50/70 border border-blue-200 p-3.5 rounded-xl shadow-2xs">
              <span className="text-[10px] font-bold uppercase tracking-wider text-blue-800 block">
                Já Preenchidas Antes
              </span>
              <span className="text-lg font-bold font-mono text-blue-900 tabular-nums">
                {aggregatedSummary.alreadyFilled}
              </span>
            </div>
            <div className="bg-amber-50/80 border border-amber-200 p-3.5 rounded-xl shadow-2xs">
              <span className="text-[10px] font-bold uppercase tracking-wider text-amber-800 block">
                Sem Data (no Topo)
              </span>
              <span className="text-lg font-bold font-mono text-amber-900 tabular-nums">
                {aggregatedSummary.stillPending}
              </span>
            </div>
          </div>

          {results.map((result) => (
            <Card
              key={result.originalFilename}
              title={result.outputFilename}
              subtitle={`Aba "${result.sheetName}" • ${result.summary.totalRows} nota(s): ${result.summary.stillPending} pendente(s) no topo, ${result.summary.filledNow} preenchida(s) agora, ${result.summary.alreadyFilled} mantida(s)`}
              headerAction={
                <Button
                  size="sm"
                  onClick={() => downloadResult(result)}
                  leftIcon={<Download className="w-3.5 h-3.5" />}
                >
                  Baixar .xlsx
                </Button>
              }
            >
              {result.warnings.length > 0 && (
                <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50/70 p-3 text-xs text-amber-950 space-y-1">
                  <div className="flex items-center gap-1.5 font-bold">
                    <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                    <span>Atenção — notas com ambiguidade mantidas sem alteração</span>
                  </div>
                  <ul className="list-disc pl-5 space-y-0.5 text-[11px]">
                    {result.warnings.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="overflow-x-auto border border-slate-200/80 rounded-xl max-h-80">
                <table className="w-full text-left text-xs divide-y divide-slate-100">
                  <thead className="bg-slate-50/80 text-slate-500 font-bold uppercase text-[10px] tracking-wider sticky top-0">
                    <tr>
                      <th className="py-2.5 px-3">Ord.</th>
                      <th className="py-2.5 px-3">Linha Excel</th>
                      <th className="py-2.5 px-3">Nº Nota</th>
                      <th className="py-2.5 px-3">Data Emissão</th>
                      <th className="py-2.5 px-3">Data Entrada</th>
                      <th className="py-2.5 px-3">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {result.rowsReport.map((row) => {
                      const badge = STATUS_BADGE[row.status];
                      return (
                        <tr key={`${row.linhaExcel}-${row.numeroNota}`} className="hover:bg-slate-50/70">
                          <td className="py-2 px-3 font-mono text-slate-500">{row.novaOrdem}</td>
                          <td className="py-2 px-3 font-mono text-slate-400">{row.linhaExcel}</td>
                          <td className="py-2 px-3 font-semibold text-slate-900">{row.numeroNota}</td>
                          <td className="py-2 px-3 text-slate-600">{formatDate(row.dataEmissao)}</td>
                          <td className="py-2 px-3 font-semibold text-slate-900">
                            {row.dataEntrada ? formatDate(row.dataEntrada) : '—'}
                          </td>
                          <td className="py-2 px-3">
                            <div className="flex items-center gap-2">
                              <Badge variant={badge.variant} size="sm" dot>
                                {badge.label}
                              </Badge>
                              {row.motivo && (
                                <span className="text-[11px] text-amber-800">{row.motivo}</span>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};

