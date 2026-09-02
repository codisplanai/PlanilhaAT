import React from 'react';
import {
  FileSpreadsheet,
  CheckCircle2,
  Calendar,
  UploadCloud,
  FileCode,
  FileArchive,
  Trash2,
  Download,
  ArrowRight,
  ArrowLeft,
  Search,
  Sparkles,
  FileCheck2,
  CalendarDays,
  FileUp,
  X,
  AlertTriangle
} from 'lucide-react';

import { getErrorMessage } from '../../api/client';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { ErrorAlert } from '../../components/feedback/ErrorAlert';
import { LoadingSpinner } from '../../components/feedback/LoadingSpinner';
import { PageHeader } from '../../components/layout/PageHeader';
import { PlanilhaBadge } from '../../components/domain/PlanilhaBadge';
import { getEntryOriginLabel } from '../../constants/domain';
import { TemplateUpdateBanner } from '../../components/feedback/TemplateUpdateBanner';
import { formatCNPJ, formatDate, formatCurrency, formatPercent } from '../../lib/formatters';
import { REQUEST_STEPS, useNovaSolicitacaoPage } from './useNovaSolicitacaoPage';

export const NovaSolicitacaoPage: React.FC = () => {
  const {
    currentStep,
    setCurrentStep,
    selectedEmpresa,
    setSelectedEmpresa,
    empresaSearch,
    setEmpresaSearch,
    periodoInicio,
    setPeriodoInicio,
    periodoFim,
    setPeriodoFim,
    xmlFiles,
    spedFile,
    planilhaEntradaFile,
    setXmlFiles,
    setSpedFile,
    setPlanilhaEntradaFile,
    handleXmlDrop,
    handleXmlInput,
    removeXmlFile,
    handleSpedInput,
    handleSpedDrop,
    handlePlanilhaEntradaInput,
    fileError,
    clearFileError,
    isProcessing,
    resultadoSolicitacao,
    errorMessage,
    setErrorMessage,
    empresasQuery: { isLoading: isLoadingEmpresas, error: empresasError },
    filteredEmpresas,
    generateSpreadsheet: handleGerarPlanilha,
    downloadSpreadsheet: handleDownload,
    startNewRequest,
  } = useNovaSolicitacaoPage();

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <PageHeader
        icon={<FileSpreadsheet className="w-6 h-6 text-blue-800" />}
        title="Gerar Planilha de Antecipação / DIFAL"
        description="Assistente guiado em 4 etapas para extração de dados e preenchimento determinístico do Excel"
      />

      <TemplateUpdateBanner />
      {empresasError && <ErrorAlert message={getErrorMessage(empresasError)} />}
      {fileError && <ErrorAlert title="Arquivo não aceito" message={fileError} onDismiss={clearFileError} />}

      {/* Wizard Steps Bar */}
      <div className="bg-white border border-slate-200 rounded-lg p-3 shadow-sm">
        <div className="flex items-center justify-between">
          {REQUEST_STEPS.map((s, idx) => {
            const isDone = currentStep > s.num || (currentStep === 4 && resultadoSolicitacao?.status === 'concluido');
            const isCurrent = currentStep === s.num;
            return (
              <React.Fragment key={s.num}>
                <div className="flex items-center gap-2">
                  <div
                    className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-all ${
                      isDone
                        ? 'bg-emerald-600 text-white shadow-sm'
                        : isCurrent
                        ? 'bg-blue-800 text-white ring-4 ring-blue-100'
                        : 'bg-slate-100 text-slate-400'
                    }`}
                  >
                    {isDone ? <CheckCircle2 className="w-4 h-4" /> : s.num}
                  </div>
                  <span
                    className={`text-xs font-semibold hidden sm:inline ${
                      isCurrent ? 'text-blue-900' : isDone ? 'text-slate-700' : 'text-slate-400'
                    }`}
                  >
                    {s.label}
                  </span>
                </div>
                {idx < REQUEST_STEPS.length - 1 && (
                  <div
                    className={`flex-1 h-0.5 mx-2 sm:mx-4 transition-colors ${
                      currentStep > s.num ? 'bg-emerald-500' : 'bg-slate-200'
                    }`}
                  />
                )}
              </React.Fragment>
            );
          })}
        </div>
      </div>

      {/* Main Content by Step */}
      <Card className="p-6">
        {/* ETAPA 1: SELEÇÃO DA EMPRESA */}
        {currentStep === 1 && (
          <div className="space-y-4">
            <div>
              <h2 className="text-base font-bold text-slate-900">Etapa 1: Selecionar Empresa Cliente</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Escolha a empresa para a qual a planilha será gerada. <strong>Regra fundamental:</strong> Apenas notas fiscais emitidas por fornecedores de UF diferente da empresa cliente (operações interestaduais) são consideradas no cálculo de Antecipação e DIFAL.
              </p>
            </div>

            {/* Busca */}
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
              <input
                type="text"
                placeholder="Filtrar por Razão Social, CNPJ ou Estado..."
                value={empresaSearch}
                onChange={(e) => setEmpresaSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-md focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-800 text-slate-900"
              />
            </div>

            {isLoadingEmpresas ? (
              <LoadingSpinner message="Carregando empresas..." />
            ) : filteredEmpresas.length === 0 ? (
              <div className="py-6 text-center text-xs text-slate-500">
                Nenhuma empresa encontrada com o termo pesquisado.
              </div>
            ) : (
              <div className="max-h-72 overflow-y-auto divide-y divide-slate-100 border border-slate-200 rounded-md">
                {filteredEmpresas.map((empresa) => {
                  const isSelected = selectedEmpresa?.id === empresa.id;
                  return (
                    <div
                      key={empresa.id}
                      onClick={() => setSelectedEmpresa(empresa)}
                      className={`p-3 text-xs flex items-center justify-between cursor-pointer transition-colors ${
                        isSelected
                          ? 'bg-blue-50/80 text-blue-900 font-medium'
                          : 'hover:bg-slate-50 text-slate-700'
                      }`}
                    >
                      <div className="space-y-0.5">
                        <div className="font-semibold text-slate-900 flex items-center gap-2">
                          <span>{empresa.razao_social}</span>
                          <span className="font-bold text-[10px] bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200">
                            {empresa.uf}
                          </span>
                        </div>
                        <div className="text-[11px] font-mono text-slate-500 flex items-center gap-3">
                          <span>CNPJ: {formatCNPJ(empresa.cnpj)}</span>
                          {empresa.inscricao_estadual && (
                            <span className="text-slate-600 font-semibold">• I.E.: {empresa.inscricao_estadual}</span>
                          )}
                        </div>
                      </div>
                      <div>
                        {isSelected ? (
                          <span className="inline-flex items-center gap-1 text-xs font-bold text-blue-700 bg-blue-100 px-2 py-0.5 rounded">
                            <CheckCircle2 className="w-3.5 h-3.5" /> Selecionada
                          </span>
                        ) : (
                          <span className="text-[11px] text-slate-400 group-hover:text-slate-600">
                            Clique para selecionar
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="pt-4 border-t border-slate-100 flex justify-end">
              <Button
                onClick={() => setCurrentStep(2)}
                disabled={!selectedEmpresa}
                rightIcon={<ArrowRight className="w-4 h-4" />}
              >
                Avançar: Período
              </Button>
            </div>
          </div>
        )}

        {/* ETAPA 2: SELEÇÃO DO PERÍODO */}
        {currentStep === 2 && (
          <div className="space-y-5">
            <div>
              <h2 className="text-base font-bold text-slate-900">Etapa 2: Período de Competência</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Defina o intervalo de datas das notas fiscais a serem processadas para a empresa <strong>{selectedEmpresa?.razao_social}</strong>.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-700 mb-1.5">
                  Data Inicial do Período
                </label>
                <input
                  type="date"
                  value={periodoInicio}
                  onChange={(e) => setPeriodoInicio(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-800 text-slate-900"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-700 mb-1.5">
                  Data Final do Período
                </label>
                <input
                  type="date"
                  value={periodoFim}
                  onChange={(e) => setPeriodoFim(e.target.value)}
                  min={periodoInicio}
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-800 text-slate-900"
                />
              </div>
            </div>

            <div className="bg-blue-50 border border-blue-200 rounded-md p-3 text-xs text-blue-900 flex items-center gap-2">
              <Calendar className="w-4 h-4 text-blue-700 shrink-0" />
              <span>
                Notas fiscais com data de emissão fora deste intervalo serão bloqueadas pela Camada de Sanidade do backend.
              </span>
            </div>

            <div className="pt-4 border-t border-slate-100 flex justify-between">
              <Button variant="outline" onClick={() => setCurrentStep(1)} leftIcon={<ArrowLeft className="w-4 h-4" />}>
                Voltar
              </Button>
              <Button onClick={() => setCurrentStep(3)} rightIcon={<ArrowRight className="w-4 h-4" />}>
                Avançar: Upload de Arquivos
              </Button>
            </div>
          </div>
        )}

        {/* ETAPA 3: UPLOAD DE ARQUIVOS (XML E/OU SPED FISCAL) + PLANILHA CONTÁBIL */}
        {currentStep === 3 && (
          <div className="space-y-6">
            <div>
              <h2 className="text-base font-bold text-slate-900">Etapa 3: Adicionar Arquivos de Entrada</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Envie os XMLs de NF-e, o arquivo SPED Fiscal (.txt) da competência, ou ambos simultaneamente.
              </p>
            </div>

            <div className="bg-blue-50 border border-blue-200 rounded-md p-3 text-xs text-blue-900">
              Envie os <strong>XMLs da competência</strong> e o <strong>SPED Fiscal do mesmo mês</strong> para
              separar automaticamente a planilha <strong>Antecipação Parcial — Pago Antecipadamente</strong>:
              as notas emitidas no período que não constarem do SPED ainda não deram entrada no estabelecimento
              e são apuradas em arquivo próprio. Enviando apenas os XMLs, todas entram na planilha normal.
            </div>

            {/* Fonte 1: XMLs de NF-e da competência ou Pacote .ZIP */}
            <div className="space-y-2">
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-700">
                Arquivos XML de NF-e ou Pacote .ZIP (opcional se enviar o SPED)
              </label>
              <div
                role="button"
                tabIndex={0}
                aria-label="Selecionar XMLs ou arquivos ZIP"
                onDragOver={(e) => e.preventDefault()}
                onDrop={handleXmlDrop}
                className="border-2 border-dashed border-slate-300 hover:border-blue-700 bg-slate-50/50 hover:bg-blue-50/30 rounded-lg p-6 text-center transition-colors cursor-pointer"
                onClick={() => document.getElementById('xml-file-input')?.click()}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') document.getElementById('xml-file-input')?.click();
                }}
              >
                <input
                  id="xml-file-input"
                  type="file"
                  multiple
                  accept=".xml,text/xml,.zip,application/zip,application/x-zip-compressed"
                  onChange={handleXmlInput}
                  className="hidden"
                />
                <UploadCloud className="w-8 h-8 text-blue-700 mx-auto mb-2" />
                <p className="text-xs font-semibold text-slate-800">
                  Arraste os arquivos XML ou pacotes .ZIP aqui, ou <span className="text-blue-800 underline">clique para selecionar</span>
                </p>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Suporta seleção múltipla de XMLs de NF-e ou arquivos compactados (.zip)
                </p>
              </div>

              {/* Lista de Arquivos XML / ZIP Adicionados */}
              {xmlFiles.length > 0 && (
                <div className="space-y-1.5 pt-1">
                  <div className="flex items-center justify-between text-xs font-semibold text-slate-700">
                    <span>Arquivos Selecionados ({xmlFiles.length})</span>
                    <button
                      type="button"
                      onClick={() => setXmlFiles([])}
                      className="text-red-600 hover:text-red-800 font-medium text-[11px]"
                    >
                      Limpar Todos
                    </button>
                  </div>

                  <div className="max-h-36 overflow-y-auto border border-slate-200 rounded-md divide-y divide-slate-100 bg-white">
                    {xmlFiles.map((file, idx) => {
                      const isZip = file.name.toLowerCase().endsWith('.zip');
                      return (
                        <div key={`${file.name}-${file.size}-${file.lastModified}`} className="p-2 flex items-center justify-between text-xs hover:bg-slate-50">
                          <div className="flex items-center gap-2 overflow-hidden">
                            {isZip ? (
                              <FileArchive className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                            ) : (
                              <FileCode className="w-3.5 h-3.5 text-blue-700 shrink-0" />
                            )}
                            <span className="font-medium text-slate-800 truncate">{file.name}</span>
                            <span className="text-[10px] text-slate-400 font-mono">
                              ({(file.size / 1024).toFixed(1)} KB)
                            </span>
                            {isZip && (
                              <span className="text-[10px] bg-amber-100 text-amber-800 font-semibold px-1.5 py-0.5 rounded text-[9px] uppercase tracking-wider">
                                ZIP
                              </span>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={() => removeXmlFile(idx)}
                            aria-label={`Remover ${file.name}`}
                            className="text-slate-400 hover:text-red-600 p-1 transition-colors"
                            title="Remover arquivo"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Fonte 2: SPED Fiscal da MESMA competência */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-700">
                  Arquivo SPED Fiscal EFD ICMS/IPI (.txt) (opcional)
                </label>
                <span className="text-[11px] font-medium text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded border border-indigo-200/60">
                  ✨ Datas de Entrada Nativas
                </span>
              </div>

              {!spedFile ? (
                <div
                  role="button"
                  tabIndex={0}
                  aria-label="Selecionar arquivo SPED Fiscal"
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={handleSpedDrop}
                  onClick={() => document.getElementById('sped-file-input')?.click()}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') document.getElementById('sped-file-input')?.click();
                  }}
                  className="border-2 border-dashed border-indigo-200 hover:border-indigo-600 bg-indigo-50/30 hover:bg-indigo-50/60 rounded-lg p-6 text-center transition-colors cursor-pointer"
                >
                  <input
                    id="sped-file-input"
                    type="file"
                    accept=".txt,text/plain"
                    onChange={handleSpedInput}
                    className="hidden"
                  />
                  <UploadCloud className="w-8 h-8 text-indigo-700 mx-auto mb-2" />
                  <p className="text-xs font-semibold text-slate-800">
                    Arraste o arquivo SPED Fiscal (.txt) aqui, ou <span className="text-indigo-700 underline">clique para selecionar</span>
                  </p>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    Arquivo gerado pelo sistema contábil contendo os registros 0000, 0150, 0200, C100 e C170
                  </p>
                </div>
              ) : (
                <div className="border border-indigo-300 bg-indigo-50/80 rounded-lg p-3.5 flex items-center justify-between">
                  <div className="flex items-center gap-3 overflow-hidden">
                    <div className="w-8 h-8 rounded bg-indigo-600 text-white flex items-center justify-center shrink-0">
                      <FileCheck2 className="w-4 h-4" />
                    </div>
                    <div className="overflow-hidden">
                      <p className="text-xs font-bold text-indigo-950 truncate">
                        {spedFile.name}
                      </p>
                      <p className="text-[10px] text-indigo-700 font-mono">
                        {(spedFile.size / 1024).toFixed(1)} KB • EFD ICMS/IPI pronto para processamento
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSpedFile(null)}
                    aria-label="Remover arquivo SPED"
                    className="p-1 rounded text-indigo-800 hover:text-red-700 hover:bg-indigo-100 transition-colors"
                    title="Remover arquivo SPED"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>

            {/* Segundo Campo de Upload: Planilha Contábil de Datas de Entrada (Opcional) */}
            <div className="pt-3 border-t border-slate-200/80 space-y-2">
              <div className="flex items-center gap-1.5">
                <CalendarDays className="w-4 h-4 text-emerald-700" />
                <label className="text-xs font-bold uppercase tracking-wider text-slate-800">
                  Planilha auxiliar de datas de entrada (opcional)
                </label>
                <Badge variant="neutral" size="sm">Opcional</Badge>
              </div>

              <p className="text-xs text-slate-500">
                {'Se você tiver a exportação do sistema contábil (Prosoft ou similar) com as datas de entrada das notas, anexe aqui para preencher automaticamente. Caso não possua, a data de entrada permanecerá em branco para preenchimento manual.'}
              </p>

              {!planilhaEntradaFile ? (
                <div
                  role="button"
                  tabIndex={0}
                  aria-label="Selecionar planilha auxiliar de datas de entrada"
                  onClick={() => document.getElementById('planilha-entrada-input')?.click()}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') document.getElementById('planilha-entrada-input')?.click();
                  }}
                  className="border border-emerald-300/80 bg-emerald-50/40 hover:bg-emerald-50 rounded-lg p-3.5 flex items-center justify-between cursor-pointer transition-colors"
                >
                  <input
                    id="planilha-entrada-input"
                    type="file"
                    accept=".xls,.xlsx"
                    onChange={handlePlanilhaEntradaInput}
                    className="hidden"
                  />
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded bg-emerald-600 text-white flex items-center justify-center shrink-0">
                      <FileUp className="w-4 h-4" />
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-emerald-950">
                        Anexar planilha contábil (.xls / .xlsx)
                      </p>
                      <p className="text-[11px] text-emerald-700">
                        Cruzamento inequívoco por Chave de Acesso ou CNPJ + Série + Número
                      </p>
                    </div>
                  </div>
                  <span className="inline-flex items-center rounded-md px-2.5 py-1.5 text-xs font-medium border border-emerald-400 text-emerald-800 bg-white">
                    Selecionar Arquivo
                  </span>
                </div>
              ) : (
                <div className="border border-emerald-300 bg-emerald-50/90 rounded-lg p-3 flex items-center justify-between">
                  <div className="flex items-center gap-2.5 overflow-hidden">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                    <div className="overflow-hidden">
                      <p className="text-xs font-bold text-emerald-950 truncate">
                        {planilhaEntradaFile.name}
                      </p>
                      <p className="text-[10px] text-emerald-700 font-mono">
                        {(planilhaEntradaFile.size / 1024).toFixed(1)} KB • Pronto para cruzamento de datas
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setPlanilhaEntradaFile(null)}
                    aria-label="Remover planilha auxiliar"
                    className="p-1 rounded text-emerald-800 hover:text-red-700 hover:bg-emerald-100 transition-colors"
                    title="Remover planilha"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>

            <div className="pt-4 border-t border-slate-100 flex justify-between">
              <Button variant="outline" onClick={() => setCurrentStep(2)} leftIcon={<ArrowLeft className="w-4 h-4" />}>
                Voltar
              </Button>
              <Button
                onClick={() => setCurrentStep(4)}
                disabled={xmlFiles.length === 0 && !spedFile}
                rightIcon={<ArrowRight className="w-4 h-4" />}
              >
                Avançar: Revisão e Envio
              </Button>
            </div>
          </div>
        )}

        {/* ETAPA 4: REVISÃO, PROCESSAMENTO E DOWNLOAD */}
        {currentStep === 4 && (
          <div className="space-y-6">
            {!resultadoSolicitacao && (
              <>
                <div>
                  <h2 className="text-base font-bold text-slate-900">Etapa 4: Revisão dos Dados e Geração</h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Confira as informações antes de executar o motor de cálculo. O sistema roteia cada item pelo CFOP e gera automaticamente as planilhas aplicáveis (Antecipação Parcial, Antecipação Tributária e/ou DIFAL).
                  </p>
                </div>

                {/* Resumo */}
                <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                  <div>
                    <span className="text-slate-500 block text-[11px] uppercase font-semibold">Empresa Destinatária</span>
                    <span className="font-bold text-slate-900 text-sm">{selectedEmpresa?.razao_social}</span>
                    <span className="block font-mono text-slate-600 mt-0.5">CNPJ: {formatCNPJ(selectedEmpresa?.cnpj)}</span>
                  </div>

                  <div>
                    <span className="text-slate-500 block text-[11px] uppercase font-semibold">Estado (UF)</span>
                    <span className="font-bold text-slate-900">{selectedEmpresa?.uf}</span>
                  </div>

                  <div>
                    <span className="text-slate-500 block text-[11px] uppercase font-semibold">Período de Competência</span>
                    <span className="font-medium text-slate-900">
                      {formatDate(periodoInicio)} a {formatDate(periodoFim)}
                    </span>
                  </div>

                  <div className="sm:col-span-2 pt-2 border-t border-slate-200 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-slate-700">Fontes anexadas:</span>
                      <span className="font-bold text-blue-900 font-mono text-sm text-right">
                        {[
                          xmlFiles.length > 0
                            ? xmlFiles.some((f) => f.name.toLowerCase().endsWith('.zip'))
                              ? `${xmlFiles.length} arquivo(s) (XML/ZIP)`
                              : `${xmlFiles.length} XML(s)`
                            : null,
                          spedFile ? `SPED (${spedFile.name})` : null,
                        ].filter(Boolean).join(' + ')}
                      </span>
                    </div>

                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-600">Datas de entrada contábeis:</span>
                      {spedFile ? (
                        <span className="font-semibold text-indigo-700 flex items-center gap-1">
                          <CheckCircle2 className="w-3.5 h-3.5" /> Extração nativa do SPED (Registro C100)
                        </span>
                      ) : planilhaEntradaFile ? (
                        <span className="font-semibold text-emerald-700 flex items-center gap-1">
                          <CheckCircle2 className="w-3.5 h-3.5" /> {planilhaEntradaFile.name}
                        </span>
                      ) : (
                        <span className="text-slate-400 italic">Ordenação por data de emissão</span>
                      )}
                    </div>
                  </div>
                </div>

                {errorMessage && (
                  <ErrorAlert
                    title="Falha no Processamento ou Validação Fiscal"
                    message={errorMessage}
                    onDismiss={() => setErrorMessage(null)}
                  />
                )}

                <div className="pt-4 border-t border-slate-100 flex justify-between items-center">
                  <Button variant="outline" onClick={() => setCurrentStep(3)} disabled={isProcessing} leftIcon={<ArrowLeft className="w-4 h-4" />}>
                    Voltar aos Arquivos
                  </Button>
                  <Button
                    onClick={handleGerarPlanilha}
                    isLoading={isProcessing}
                    size="lg"
                    rightIcon={<Sparkles className="w-4 h-4" />}
                  >
                    {isProcessing ? 'Processando NF-es...' : 'Gerar Planilha'}
                  </Button>
                </div>
              </>
            )}

            {/* RESULTADO CONCLUÍDO COM SUCESSO */}
            {resultadoSolicitacao && (
              <div className="space-y-6 animate-fade-in">
                <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-6 text-center">
                  <div className="w-12 h-12 rounded-full bg-emerald-600 text-white flex items-center justify-center mx-auto mb-3 shadow-md">
                    <FileCheck2 className="w-6 h-6" />
                  </div>
                  <h2 className="text-lg font-bold text-emerald-950">Planilha(s) Gerada(s) com Sucesso!</h2>
                  <p className="text-xs text-emerald-800 mt-1 max-w-md mx-auto">
                    Cada item foi roteado pelo CFOP para a planilha correspondente. Uma mesma NF-e pode aparecer em
                    mais de uma planilha, cada uma com os valores dos itens daquela natureza.
                  </p>

                  <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
                    <Button
                      variant="outline"
                      onClick={() => {
                        startNewRequest();
                      }}
                    >
                      Gerar Nova Solicitação
                    </Button>
                  </div>
                </div>

                {/* Cards das planilhas geradas por destino (Parcial / Tributária / DIFAL) */}
                {resultadoSolicitacao.saidas && resultadoSolicitacao.saidas.length > 0 && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">
                        Planilhas Geradas ({resultadoSolicitacao.saidas.length})
                      </h3>
                      {resultadoSolicitacao.saidas.filter((s) => s.arquivo_path).length > 1 && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleDownload()}
                          leftIcon={<Download className="w-3.5 h-3.5" />}
                        >
                          Baixar Todas (.zip)
                        </Button>
                      )}
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                      {resultadoSolicitacao.saidas.map((saida) => (
                        <div
                          key={saida.tipo}
                          className={`rounded-lg border p-4 space-y-2 ${
                            saida.arquivo_path ? 'bg-white border-slate-200' : 'bg-amber-50/60 border-amber-200'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <PlanilhaBadge tipo={saida.tipo} detailed />
                            {!saida.arquivo_path && (
                              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                            )}
                          </div>
                          <div className="text-xs text-slate-600 space-y-0.5">
                            <div>{saida.total_notas} nota(s) processada(s)</div>
                            <div className="font-mono font-semibold text-slate-900">
                              {formatCurrency(saida.total_valor_devido)}
                            </div>
                          </div>
                          {saida.arquivo_path ? (
                            <Button
                              size="sm"
                              className="w-full"
                              onClick={() => handleDownload(saida.tipo)}
                              leftIcon={<Download className="w-3.5 h-3.5" />}
                            >
                              Baixar (.xlsx)
                            </Button>
                          ) : (
                            <p className="text-[11px] text-amber-800">
                              {saida.aviso || 'Nenhum template ativo cadastrado para este tipo. Cadastre em Admin > Templates.'}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Resumo de itens com CFOP sem regra de roteamento cadastrada */}
                {resultadoSolicitacao.cfops_sem_regra && Object.keys(resultadoSolicitacao.cfops_sem_regra).length > 0 && (
                  <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-xs text-slate-600">
                    <span className="font-semibold text-slate-700">Itens desconsiderados por CFOP sem regra cadastrada: </span>
                    {Object.entries(resultadoSolicitacao.cfops_sem_regra)
                      .map(([sufixo, qtd]) => `${sufixo} (${qtd})`)
                      .join(', ')}
                  </div>
                )}

                {/* Relatório / Aviso de Notas Desconsideradas (Operação Interna ou Fora do Período) */}
                {resultadoSolicitacao.notas_ignoradas && resultadoSolicitacao.notas_ignoradas.length > 0 && (
                  <div className="bg-amber-50/90 border border-amber-300 rounded-lg p-4 space-y-3 shadow-sm animate-fade-in">
                    <div className="flex items-start gap-3">
                      <div className="w-8 h-8 rounded-full bg-amber-500 text-white flex items-center justify-center shrink-0 mt-0.5 shadow-sm">
                        <AlertTriangle className="w-4 h-4" />
                      </div>
                      <div>
                        <h3 className="text-sm font-bold text-amber-950">
                          Aviso: {resultadoSolicitacao.notas_ignoradas.length} nota(s) fiscal(is) desconsiderada(s)
                        </h3>
                        <p className="text-xs text-amber-800 mt-0.5">
                          As notas fiscais abaixo foram desconsideradas automaticamente pela Camada de Sanidade e Regras Fiscais (operações internas com mesma UF do cliente ou datas fora do período). As notas válidas foram apuradas normalmente.
                        </p>
                      </div>
                    </div>

                    <div className="overflow-x-auto border border-amber-200/80 rounded-md bg-white">
                      <table className="w-full text-left text-xs divide-y divide-amber-100">
                        <thead className="bg-amber-50/80 text-amber-900 font-semibold uppercase text-[10px]">
                          <tr>
                            <th className="py-2 px-3">Nota / Série</th>
                            <th className="py-2 px-3">Data Emissão</th>
                            <th className="py-2 px-3">Arquivo de Origem</th>
                            <th className="py-2 px-3">Motivo da Desconsideração</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-amber-100/60">
                          {resultadoSolicitacao.notas_ignoradas.map((ign, idx) => (
                            <tr key={idx} className="hover:bg-amber-50/50">
                              <td className="py-2 px-3 font-medium text-slate-900">
                                NF-e nº {ign.numero_nota} {ign.serie ? `(Série ${ign.serie})` : ''}
                              </td>
                              <td className="py-2 px-3 text-slate-700 font-medium font-mono">
                                {ign.data_emissao || '-'}
                              </td>
                              <td className="py-2 px-3 text-slate-500 font-mono text-[11px] truncate max-w-[200px]" title={ign.arquivo || ''}>
                                {ign.arquivo || '-'}
                              </td>
                              <td className="py-2 px-3 text-amber-900 font-medium">
                                {ign.motivo}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Resumo das Notas Fiscais Processadas */}
                {resultadoSolicitacao.notas_processadas && resultadoSolicitacao.notas_processadas.length > 0 && (
                  <div className="space-y-3">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">
                      Conferência de Notas Fiscais Processadas ({resultadoSolicitacao.notas_processadas.length} itens)
                    </h3>

                    <div className="overflow-x-auto border border-slate-200 rounded-md bg-white">
                      <table className="w-full text-left text-xs divide-y divide-slate-200">
                        <thead className="bg-slate-50 text-slate-700 font-semibold uppercase text-[10px]">
                          <tr>
                            <th className="py-2 px-3">Nota</th>
                            <th className="py-2 px-3">Planilha</th>
                            <th className="py-2 px-3 text-center">UF Origem</th>
                            <th className="py-2 px-3">Data Emissão</th>
                            <th className="py-2 px-3">Data Entrada</th>
                            <th className="py-2 px-3 font-mono">NCM</th>
                            <th className="py-2 px-3 text-right">V. Total</th>
                            <th className="py-2 px-3 text-right">Base Cálc.</th>
                            <th className="py-2 px-3 text-right font-mono">A.ORI</th>
                            <th className="py-2 px-3 text-right font-mono">A.DST</th>
                            <th className="py-2 px-3 text-right font-mono">Valor Devido</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {resultadoSolicitacao.notas_processadas.map((nota, i) => (
                            <tr key={i} className="hover:bg-slate-50">
                              <td className="py-2 px-3 font-medium text-slate-900">{nota.numero_nota}</td>
                              <td className="py-2 px-3">
                                {nota.destino_planilha ? (
                                  <PlanilhaBadge tipo={nota.destino_planilha} detailed />
                                ) : '-'}
                              </td>
                              <td className="py-2 px-3 text-center">
                                <span className="inline-flex items-center justify-center font-bold text-[10px] bg-blue-100 text-blue-900 px-1.5 py-0.5 rounded border border-blue-200">
                                  {nota.uf_emitente || '-'}
                                </span>
                              </td>
                              <td className="py-2 px-3 text-slate-600">{formatDate(nota.data_emissao)}</td>
                              <td className="py-2 px-3">
                                {nota.data_entrada ? (
                                  <div className="flex items-center gap-1.5">
                                    <span className="font-semibold text-slate-900">{formatDate(nota.data_entrada)}</span>
                                    <Badge variant={nota.origem_data_entrada === 'planilha_sistema_contabil' ? 'success' : 'info'} size="sm">
                                      {getEntryOriginLabel(nota.origem_data_entrada)}
                                    </Badge>
                                  </div>
                                ) : (
                                  <Badge variant="warning" size="sm">Pendente</Badge>
                                )}
                              </td>
                              <td className="py-2 px-3 font-mono text-slate-700">{nota.ncm}</td>
                              <td className="py-2 px-3 text-right font-mono">{formatCurrency(nota.v_total)}</td>
                              <td className="py-2 px-3 text-right font-mono">{formatCurrency(nota.base_calculo)}</td>
                              <td className="py-2 px-3 text-right font-mono text-slate-600">{formatPercent(nota.a_ori)}</td>
                              <td className="py-2 px-3 text-right font-mono font-bold text-blue-900">{formatPercent(nota.a_dst_resolvida)}</td>
                              <td className="py-2 px-3 text-right font-mono font-bold text-emerald-800">
                                {formatCurrency(nota.valor_devido)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </Card>
    </div>
  );
};
