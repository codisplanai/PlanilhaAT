import React, { useState } from 'react';
import {
  FileCode,
  FileArchive,
  FileSpreadsheet,
  FileText,
  Upload,
  Trash2,
  X,
  CheckCircle2,
  ArrowLeft,
  ArrowRight,
  Plus,
  AlertCircle,
} from 'lucide-react';

import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

export interface FiscalFilesStepProps {
  xmlFiles: File[];
  spedFile: File | null;
  planilhaEntradaFile: File | null;
  onXmlDrop: (event: React.DragEvent<HTMLDivElement>) => void;
  onXmlInput: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onRemoveXml: (index: number) => void;
  onClearXmls: () => void;
  onSpedDrop: (event: React.DragEvent<HTMLDivElement>) => void;
  onSpedInput: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onRemoveSped: () => void;
  onPlanilhaDrop?: (event: React.DragEvent<HTMLDivElement>) => void;
  onPlanilhaInput: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onRemovePlanilha: () => void;
  onBack: () => void;
  onAdvance: () => void;
}

export const FiscalFilesStep: React.FC<FiscalFilesStepProps> = ({
  xmlFiles,
  spedFile,
  planilhaEntradaFile,
  onXmlDrop,
  onXmlInput,
  onRemoveXml,
  onClearXmls,
  onSpedDrop,
  onSpedInput,
  onRemoveSped,
  onPlanilhaDrop,
  onPlanilhaInput,
  onRemovePlanilha,
  onBack,
  onAdvance,
}) => {
  const [dragOverXml, setDragOverXml] = useState(false);
  const [dragOverSped, setDragOverSped] = useState(false);
  const [dragOverPlanilha, setDragOverPlanilha] = useState(false);

  const totalXmlBytes = xmlFiles.reduce((acc, f) => acc + f.size, 0);
  const hasRequiredFiles = xmlFiles.length > 0 || spedFile !== null;

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Cabeçalho da Etapa */}
      <div>
        <h2 className="text-base sm:text-lg font-bold text-slate-900 tracking-tight">
          Etapa 3: Arquivos Fiscais
        </h2>
        <p className="text-xs text-slate-500 mt-1">
          Envie os arquivos para a apuração. É necessário incluir ao menos os XMLs ou o SPED Fiscal.
        </p>
      </div>

      <div className="space-y-5">
        {/* ========================================================================= */}
        {/* CAMPO 1: NOTAS FISCAIS (XML / ZIP) */}
        {/* ========================================================================= */}
        <div className="rounded-2xl border-2 border-blue-100 bg-white p-5 shadow-xs transition-all hover:border-blue-200">
          <div className="flex items-center justify-between gap-3 mb-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 border border-blue-200/60 flex items-center justify-center shrink-0">
                <FileCode className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="text-sm font-bold text-slate-900">
                    Notas Fiscais (XML / ZIP)
                  </h3>
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-blue-50 text-blue-700 border border-blue-200/60">
                    .XML
                  </span>
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-blue-50 text-blue-700 border border-blue-200/60">
                    .ZIP
                  </span>
                </div>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Múltiplos arquivos ou pacote ZIP • até 20 MB por arquivo
                </p>
              </div>
            </div>

            <div>
              {xmlFiles.length > 0 ? (
                <Badge variant="info">
                  {xmlFiles.length} selecionado(s) ({formatBytes(totalXmlBytes)})
                </Badge>
              ) : (
                <Badge variant="info">Obrigatório*</Badge>
              )}
            </div>
          </div>

          <input
            id="xml-file-input"
            type="file"
            multiple
            accept=".xml,text/xml,.zip,application/zip,application/x-zip-compressed"
            onChange={onXmlInput}
            className="hidden"
          />

          {/* Zona de Drop / Seleção de XMLs */}
          <div
            role="button"
            tabIndex={0}
            aria-label="Selecionar arquivos XML ou ZIP"
            onClick={() => document.getElementById('xml-file-input')?.click()}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                document.getElementById('xml-file-input')?.click();
              }
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOverXml(true);
            }}
            onDragLeave={() => setDragOverXml(false)}
            onDrop={(e) => {
              setDragOverXml(false);
              onXmlDrop(e);
            }}
            className={`border-2 border-dashed rounded-xl p-5 text-center transition-all cursor-pointer ${
              dragOverXml
                ? 'border-blue-500 bg-blue-50/70 scale-[0.99]'
                : 'border-blue-200/90 bg-blue-50/20 hover:border-blue-400 hover:bg-blue-50/40'
            }`}
          >
            <div className="flex flex-col items-center gap-1.5">
              <Upload className="w-5 h-5 text-blue-600 mb-0.5" />
              <p className="text-xs sm:text-sm font-semibold text-slate-800">
                Arraste os arquivos <span className="text-blue-700 font-bold">XML ou .ZIP</span> aqui, ou{' '}
                <span className="text-blue-700 underline font-bold">clique para selecionar</span>
              </p>
              <p className="text-[11px] text-slate-500">
                NF-e modelo 55 da competência
              </p>
            </div>
          </div>

          {/* Lista de Arquivos XML Adicionados */}
          {xmlFiles.length > 0 && (
            <div className="mt-4 pt-3 border-t border-slate-100 space-y-2">
              <div className="flex items-center justify-between text-xs font-semibold text-slate-700 px-1">
                <span>Lista de Arquivos ({xmlFiles.length})</span>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => document.getElementById('xml-file-input')?.click()}
                    className="inline-flex items-center gap-1 text-[11px] font-bold text-blue-700 hover:text-blue-800 cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" /> Adicionar mais
                  </button>
                  <button
                    type="button"
                    onClick={onClearXmls}
                    className="text-[11px] font-bold text-rose-600 hover:text-rose-800 cursor-pointer"
                  >
                    Limpar todos
                  </button>
                </div>
              </div>

              <div className="max-h-44 overflow-y-auto rounded-xl border border-slate-200/80 divide-y divide-slate-100 bg-slate-50/40">
                {xmlFiles.map((file, idx) => {
                  const isZip = file.name.toLowerCase().endsWith('.zip');
                  return (
                    <div
                      key={`${file.name}-${file.size}-${file.lastModified}`}
                      className="p-2.5 px-3 flex items-center justify-between text-xs hover:bg-white transition-colors"
                    >
                      <div className="flex items-center gap-2.5 overflow-hidden">
                        {isZip ? (
                          <FileArchive className="w-4 h-4 text-amber-600 shrink-0" />
                        ) : (
                          <FileCode className="w-4 h-4 text-blue-600 shrink-0" />
                        )}
                        <span className="font-medium text-slate-800 truncate" title={file.name}>
                          {file.name}
                        </span>
                        <span className="text-[10px] text-slate-400 font-mono shrink-0">
                          {formatBytes(file.size)}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => onRemoveXml(idx)}
                        aria-label={`Remover ${file.name}`}
                        className="text-slate-400 hover:text-rose-600 p-1 rounded-md hover:bg-rose-50 transition-colors cursor-pointer shrink-0"
                        title="Remover arquivo"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* ========================================================================= */}
        {/* CAMPO 2: SPED FISCAL (.TXT) */}
        {/* ========================================================================= */}
        <div className="rounded-2xl border-2 border-indigo-100 bg-white p-5 shadow-xs transition-all hover:border-indigo-200">
          <div className="flex items-center justify-between gap-3 mb-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-600 border border-indigo-200/60 flex items-center justify-center shrink-0">
                <FileText className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="text-sm font-bold text-slate-900">
                    SPED Fiscal EFD ICMS/IPI
                  </h3>
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-indigo-50 text-indigo-700 border border-indigo-200/60">
                    .TXT
                  </span>
                </div>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Identifica notas já pagas e fornece as datas de entrada nativas
                </p>
              </div>
            </div>

            <div>
              {spedFile ? (
                <Badge variant="success">Anexado</Badge>
              ) : (
                <Badge variant="purple">Recomendado</Badge>
              )}
            </div>
          </div>

          <input
            id="sped-file-input"
            type="file"
            accept=".txt,text/plain"
            onChange={onSpedInput}
            className="hidden"
          />

          {!spedFile ? (
            <div
              role="button"
              tabIndex={0}
              aria-label="Selecionar arquivo SPED Fiscal"
              onClick={() => document.getElementById('sped-file-input')?.click()}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  document.getElementById('sped-file-input')?.click();
                }
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOverSped(true);
              }}
              onDragLeave={() => setDragOverSped(false)}
              onDrop={(e) => {
                setDragOverSped(false);
                onSpedDrop(e);
              }}
              className={`border-2 border-dashed rounded-xl p-5 text-center transition-all cursor-pointer ${
                dragOverSped
                  ? 'border-indigo-500 bg-indigo-50/70 scale-[0.99]'
                  : 'border-indigo-200/90 bg-indigo-50/20 hover:border-indigo-400 hover:bg-indigo-50/40'
              }`}
            >
              <div className="flex flex-col items-center gap-1.5">
                <Upload className="w-5 h-5 text-indigo-600 mb-0.5" />
                <p className="text-xs sm:text-sm font-semibold text-slate-800">
                  Arraste o arquivo <span className="text-indigo-700 font-bold">SPED Fiscal (.txt)</span> aqui, ou{' '}
                  <span className="text-indigo-700 underline font-bold">clique para selecionar</span>
                </p>
                <p className="text-[11px] text-slate-500">
                  Arquivo EFD com blocos 0 e C • até 50 MB
                </p>
              </div>
            </div>
          ) : (
            <div className="border border-indigo-200 bg-indigo-50/60 rounded-xl p-3.5 flex items-center justify-between">
              <div className="flex items-center gap-3 overflow-hidden">
                <div className="w-9 h-9 rounded-lg bg-indigo-600 text-white flex items-center justify-center shrink-0 shadow-2xs">
                  <CheckCircle2 className="w-4 h-4" />
                </div>
                <div className="overflow-hidden">
                  <p className="text-xs font-bold text-indigo-950 truncate" title={spedFile.name}>
                    {spedFile.name}
                  </p>
                  <p className="text-[11px] text-indigo-700">
                    {formatBytes(spedFile.size)} • EFD ICMS/IPI pronto
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={onRemoveSped}
                aria-label="Remover arquivo SPED"
                className="p-1.5 rounded-lg text-indigo-800 hover:text-rose-700 hover:bg-indigo-100 transition-colors cursor-pointer"
                title="Remover arquivo"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>

        {/* ========================================================================= */}
        {/* CAMPO 3: PLANILHA DE DATAS DO SISTEMA CONTÁBIL (.XLS / .XLSX) */}
        {/* ========================================================================= */}
        <div className="rounded-2xl border-2 border-emerald-100 bg-white p-5 shadow-xs transition-all hover:border-emerald-200">
          <div className="flex items-center justify-between gap-3 mb-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 border border-emerald-200/60 flex items-center justify-center shrink-0">
                <FileSpreadsheet className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="text-sm font-bold text-slate-900">
                    Planilha de Datas de Entrada
                  </h3>
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-emerald-50 text-emerald-700 border border-emerald-200/60">
                    .XLS
                  </span>
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-emerald-50 text-emerald-700 border border-emerald-200/60">
                    .XLSX
                  </span>
                </div>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Preenche automaticamente a data de entrada das notas
                </p>
              </div>
            </div>

            <div>
              {planilhaEntradaFile ? (
                <Badge variant="success">Anexada</Badge>
              ) : (
                <Badge variant="neutral">Opcional</Badge>
              )}
            </div>
          </div>

          <input
            id="planilha-entrada-input"
            type="file"
            accept=".xls,.xlsx"
            onChange={onPlanilhaInput}
            className="hidden"
          />

          {!planilhaEntradaFile ? (
            <div
              role="button"
              tabIndex={0}
              aria-label="Selecionar planilha auxiliar de datas de entrada"
              onClick={() => document.getElementById('planilha-entrada-input')?.click()}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  document.getElementById('planilha-entrada-input')?.click();
                }
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOverPlanilha(true);
              }}
              onDragLeave={() => setDragOverPlanilha(false)}
              onDrop={(e) => {
                setDragOverPlanilha(false);
                if (onPlanilhaDrop) onPlanilhaDrop(e);
              }}
              className={`border-2 border-dashed rounded-xl p-5 text-center transition-all cursor-pointer ${
                dragOverPlanilha
                  ? 'border-emerald-500 bg-emerald-50/70 scale-[0.99]'
                  : 'border-emerald-200/90 bg-emerald-50/20 hover:border-emerald-400 hover:bg-emerald-50/40'
              }`}
            >
              <div className="flex flex-col items-center gap-1.5">
                <Upload className="w-5 h-5 text-emerald-600 mb-0.5" />
                <p className="text-xs sm:text-sm font-semibold text-slate-800">
                  Arraste a <span className="text-emerald-700 font-bold">planilha contábil (.xls / .xlsx)</span> aqui, ou{' '}
                  <span className="text-emerald-700 underline font-bold">clique para selecionar</span>
                </p>
                <p className="text-[11px] text-slate-500">
                  Relatório de entradas do Prosoft, Domínio ou outros sistemas • até 20 MB
                </p>
              </div>
            </div>
          ) : (
            <div className="border border-emerald-200 bg-emerald-50/60 rounded-xl p-3.5 flex items-center justify-between">
              <div className="flex items-center gap-3 overflow-hidden">
                <div className="w-9 h-9 rounded-lg bg-emerald-600 text-white flex items-center justify-center shrink-0 shadow-2xs">
                  <CheckCircle2 className="w-4 h-4" />
                </div>
                <div className="overflow-hidden">
                  <p className="text-xs font-bold text-emerald-950 truncate" title={planilhaEntradaFile.name}>
                    {planilhaEntradaFile.name}
                  </p>
                  <p className="text-[11px] text-emerald-700">
                    {formatBytes(planilhaEntradaFile.size)} • Pronta para cruzamento de datas
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={onRemovePlanilha}
                aria-label="Remover planilha auxiliar"
                className="p-1.5 rounded-lg text-emerald-800 hover:text-rose-700 hover:bg-emerald-100 transition-colors cursor-pointer"
                title="Remover planilha"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Alerta de Validação Mínima */}
      {!hasRequiredFiles && (
        <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs flex items-center gap-2.5">
          <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
          <span>
            Adicione ao menos um arquivo <strong>XML de NF-e</strong> ou o arquivo <strong>SPED Fiscal</strong> para avançar.
          </span>
        </div>
      )}

      {/* Barra de Navegação Inferior */}
      <div className="pt-4 border-t border-slate-100 flex items-center justify-between">
        <Button
          variant="outline"
          onClick={onBack}
          leftIcon={<ArrowLeft className="w-4 h-4" />}
        >
          Voltar
        </Button>
        <Button
          onClick={onAdvance}
          disabled={!hasRequiredFiles}
          rightIcon={<ArrowRight className="w-4 h-4" />}
        >
          Avançar: Revisão e Processamento
        </Button>
      </div>
    </div>
  );
};
