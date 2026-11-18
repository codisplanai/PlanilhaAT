import React from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Download,
  FileCheck2,
  Sparkles,
} from 'lucide-react';

import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { ErrorAlert } from '../../components/feedback/ErrorAlert';
import { PlanilhaBadge } from '../../components/domain/PlanilhaBadge';
import { ItensExcluidosSection } from '../../components/domain/ItensExcluidosSection';
import { AvisosAvaliacaoSection } from '../../components/domain/AvisosAvaliacaoSection';
import { NotasIgnoradasSection } from '../../components/domain/NotasIgnoradasSection';
import { ProcessingDiagnostics } from '../../components/processing/ProcessingDiagnostics';
import { getEntryOriginLabel } from '../../constants/domain';
import { formatCNPJ, formatCurrency, formatDate, formatPercent } from '../../lib/formatters';
import type { DiagnosticSession } from '../../lib/processingDiagnostics';
import type { Empresa } from '../../types/empresa';
import type { Solicitacao, TipoPlanilha } from '../../types/solicitacao';

interface ReviewAndResultStepProps {
  selectedEmpresa: Empresa | null;
  periodoInicio: string;
  periodoFim: string;
  xmlFiles: File[];
  spedFiles: File[];
  planilhaEntradaFile: File | null;
  isProcessing: boolean;
  resultadoSolicitacao: Solicitacao | null;
  hasLocalArtifact: (tipo: TipoPlanilha) => boolean;
  hasAnyLocalArtifact: boolean;
  errorMessage: string | null;
  setErrorMessage: (message: string | null) => void;
  downloadError: string | null;
  setDownloadError: (message: string | null) => void;
  diagnosticSession: DiagnosticSession;
  onBack: () => void;
  onGenerate: () => void;
  onDownload: (tipo?: TipoPlanilha) => void;
  onStartNewRequest: () => void;
  onClearDiagnostic: () => void;
  onExportDiagnosticText: () => void;
  onExportDiagnosticJson: () => void;
}

export const ReviewAndResultStep: React.FC<ReviewAndResultStepProps> = ({
  selectedEmpresa,
  periodoInicio,
  periodoFim,
  xmlFiles,
  spedFiles,
  planilhaEntradaFile,
  isProcessing,
  resultadoSolicitacao,
  hasLocalArtifact,
  hasAnyLocalArtifact,
  errorMessage,
  setErrorMessage,
  downloadError,
  setDownloadError,
  diagnosticSession,
  onBack,
  onGenerate,
  onDownload,
  onStartNewRequest,
  onClearDiagnostic,
  onExportDiagnosticText,
  onExportDiagnosticJson,
}) => (
  <div className="space-y-6 animate-fade-in">
    {!resultadoSolicitacao && (
      <>
        <div>
          <h2 className="text-base sm:text-lg font-bold text-slate-900 tracking-tight">
            Etapa 4: Revisar e Iniciar Apuração
          </h2>
          <p className="text-xs text-slate-500 mt-1 leading-relaxed">
            Confirme os parâmetros antes de iniciar a apuração.
          </p>
        </div>

        <div className="bg-slate-50/70 border border-slate-200/80 rounded-xl p-5 grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
          <div>
            <span className="text-slate-400 block text-[10px] uppercase font-bold tracking-wider">Empresa Destinatária</span>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="font-bold text-slate-900 text-sm block">{selectedEmpresa?.razao_social}</span>
              {selectedEmpresa?.optante_simples_nacional && (
                <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-amber-50 text-amber-800 border border-amber-200">
                  Simples Nacional (-20%)
                </span>
              )}
              {selectedEmpresa?.atividade === 'industria' && (
                <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-teal-50 text-teal-800 border border-teal-200">
                  Indústria (somente DIFAL)
                </span>
              )}
            </div>
            <span className="block font-mono text-slate-500 mt-0.5">CNPJ: {formatCNPJ(selectedEmpresa?.cnpj)}</span>
          </div>

          <div>
            <span className="text-slate-400 block text-[10px] uppercase font-bold tracking-wider">Estado (UF)</span>
            <span className="font-bold text-slate-900 text-sm mt-0.5 block">{selectedEmpresa?.uf}</span>
          </div>

          <div>
            <span className="text-slate-400 block text-[10px] uppercase font-bold tracking-wider">Período de Competência</span>
            <span className="font-semibold text-slate-800 text-sm mt-0.5 block">
              {formatDate(periodoInicio)} a {formatDate(periodoFim)}
            </span>
          </div>

          <div className="sm:col-span-2 pt-3 border-t border-slate-200/80 space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-medium text-slate-600">Fontes anexadas:</span>
              <span className="font-bold text-blue-900 font-mono text-sm text-right">
                {[
                  xmlFiles.length > 0
                    ? xmlFiles.some((f) => f.name.toLowerCase().endsWith('.zip'))
                      ? `${xmlFiles.length} arquivo(s) (XML/ZIP)`
                      : `${xmlFiles.length} XML(s)`
                    : null,
                  spedFiles.length > 0
                    ? spedFiles.length === 1
                      ? `SPED (${spedFiles[0].name})`
                      : `${spedFiles.length} SPEDs (${spedFiles.map((f) => f.name).join(', ')})`
                    : null,
                ].filter(Boolean).join(' + ')}
              </span>
            </div>

            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-500">Datas de entrada contábeis:</span>
              {spedFiles.length > 0 ? (
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
          <Button variant="outline" onClick={onBack} disabled={isProcessing} leftIcon={<ArrowLeft className="w-4 h-4" />}>
            Voltar aos Arquivos
          </Button>
          <Button
            onClick={onGenerate}
            isLoading={isProcessing}
            size="lg"
            rightIcon={<Sparkles className="w-4 h-4" />}
          >
            {isProcessing ? 'Processando...' : 'Gerar Planilha'}
          </Button>
        </div>
      </>
    )}

    <ProcessingDiagnostics
      session={diagnosticSession}
      isProcessing={isProcessing}
      onDownloadText={onExportDiagnosticText}
      onDownloadJson={onExportDiagnosticJson}
      onClear={onClearDiagnostic}
    />

    {/* RESULTADO CONCLUÍDO */}
    {resultadoSolicitacao && (
      <div className="space-y-6 animate-fade-in">
        {downloadError && (
          <ErrorAlert
            title="Falha no Download"
            message={downloadError}
            onDismiss={() => setDownloadError(null)}
          />
        )}

        {(() => {
          const hasCfopsSemRegra = Boolean(
            resultadoSolicitacao.cfops_sem_regra &&
            Object.keys(resultadoSolicitacao.cfops_sem_regra).length > 0
          );
          // Item com MVA pendente não é "nada a recolher": precisa de tratamento manual.
          const temMvaPendente = Boolean(
            resultadoSolicitacao.itens_excluidos?.some((item) => item.tipo_exclusao === 'mva_pendente')
          );
          const semPlanilhaPorMvaPendente = temMvaPendente && resultadoSolicitacao.total_notas_processadas === 0;
          const todosExcluidos = resultadoSolicitacao.total_notas_processadas === 0 &&
            (resultadoSolicitacao.itens_excluidos && resultadoSolicitacao.itens_excluidos.length > 0) &&
            !hasCfopsSemRegra &&
            !temMvaPendente;
          const temAvisos = !todosExcluidos && (
            (resultadoSolicitacao.notas_ignoradas && resultadoSolicitacao.notas_ignoradas.length > 0) ||
            (resultadoSolicitacao.saidas && resultadoSolicitacao.saidas.some((s) => Boolean(s.aviso) || !hasLocalArtifact(s.tipo))) ||
            hasCfopsSemRegra ||
            temMvaPendente
          );
          const temArquivos = hasAnyLocalArtifact;

          return (
            <div
              className={`border rounded-2xl p-6 text-center shadow-xs transition-colors ${
                todosExcluidos
                  ? 'bg-slate-50/90 border-slate-300 text-slate-900'
                  : temAvisos
                  ? 'bg-amber-50/90 border-amber-300/80 text-amber-950'
                  : 'bg-emerald-50/80 border-emerald-200 text-emerald-950'
              }`}
            >
              <div
                className={`w-14 h-14 rounded-2xl text-white flex items-center justify-center mx-auto mb-3 shadow-md ${
                  todosExcluidos
                    ? 'bg-slate-700 shadow-slate-700/20'
                    : temAvisos
                    ? 'bg-amber-600 shadow-amber-600/20'
                    : 'bg-emerald-600 shadow-emerald-600/20'
                }`}
              >
                {todosExcluidos ? (
                  <CheckCircle2 className="w-7 h-7" />
                ) : temAvisos ? (
                  <AlertTriangle className="w-7 h-7" />
                ) : (
                  <FileCheck2 className="w-7 h-7" />
                )}
              </div>
              <h2 className="text-lg sm:text-xl font-black tracking-tight">
                {todosExcluidos
                  ? 'Nenhum item a recolher na Parcial'
                  : semPlanilhaPorMvaPendente
                  ? 'Itens com MVA Pendente'
                  : temAvisos
                  ? 'Apuração Concluída com Avisos Fiscais'
                  : 'Planilha(s) Gerada(s) com Sucesso!'}
              </h2>
              <p
                className={`text-xs mt-1 max-w-md mx-auto leading-relaxed ${
                  todosExcluidos
                    ? 'text-slate-600'
                    : temAvisos
                    ? 'text-amber-850'
                    : 'text-emerald-800/90'
                }`}
              >
                {todosExcluidos
                  ? 'Todos os itens de Antecipação Parcial foram desconsiderados conforme as regras de exclusão de commodities e/ou alíquotas iguais (A.ORI = A.DST).'
                  : temMvaPendente
                  ? 'Há itens da Antecipação Tributária com MVA pendente: eles ficaram fora da planilha e precisam de tratamento manual (veja a conferência de itens excluídos).'
                  : temAvisos
                  ? 'Algumas notas ou itens exigiram atenção e foram desconsiderados pelas regras de sanidade, mas os dados válidos foram apurados.'
                  : 'Cada item foi roteado pelo CFOP para a planilha correspondente. Uma mesma NF-e pode aparecer em mais de uma planilha.'}
              </p>

              <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
                {temArquivos && (
                  <Button
                    variant="primary"
                    onClick={() => onDownload()}
                    leftIcon={<Download className="w-4 h-4" />}
                  >
                    Baixar Todas as Planilhas (.zip)
                  </Button>
                )}
                <Button variant="outline" onClick={onStartNewRequest}>
                  Gerar Nova Solicitação
                </Button>
              </div>
            </div>
          );
        })()}

        {/* Cards das planilhas geradas por destino */}
        {resultadoSolicitacao.saidas && resultadoSolicitacao.saidas.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">
                Planilhas Geradas ({resultadoSolicitacao.saidas.length})
              </h3>
              {resultadoSolicitacao.saidas.filter((s) => hasLocalArtifact(s.tipo)).length > 1 && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onDownload()}
                  leftIcon={<Download className="w-3.5 h-3.5" />}
                >
                  Baixar Todas (.zip)
                </Button>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
              {resultadoSolicitacao.saidas.map((saida) => (
                <div
                  key={saida.tipo}
                  className={`rounded-xl border p-4 space-y-3 shadow-2xs transition-all ${
                    hasLocalArtifact(saida.tipo) ? 'bg-white border-slate-200/90 hover:border-slate-300' : 'bg-amber-50/60 border-amber-200'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <PlanilhaBadge tipo={saida.tipo} detailed />
                    {!hasLocalArtifact(saida.tipo) && (
                      <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                    )}
                  </div>
                  <div className="text-xs text-slate-600 space-y-0.5">
                    <div>{saida.total_notas} nota(s) processada(s)</div>
                    <div className="font-mono font-bold text-slate-900 text-sm tabular-nums">
                      {formatCurrency(saida.total_valor_devido)}
                    </div>
                  </div>
                  {hasLocalArtifact(saida.tipo) ? (
                    <Button
                      size="sm"
                      className="w-full"
                      onClick={() => onDownload(saida.tipo)}
                      leftIcon={<Download className="w-3.5 h-3.5" />}
                    >
                      Baixar .xlsx
                    </Button>
                  ) : (
                    <p className="text-[11px] text-amber-800 leading-relaxed">
                      {saida.aviso || 'Nenhum template ativo cadastrado para este tipo. Cadastre em Admin > Templates.'}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Resumo de itens com CFOP sem regra de roteamento */}
        {resultadoSolicitacao.cfops_sem_regra && Object.keys(resultadoSolicitacao.cfops_sem_regra).length > 0 && (
          <div className="bg-slate-50/80 border border-slate-200/80 rounded-xl p-3.5 text-xs text-slate-600">
            <span className="font-bold text-slate-700">Itens desconsiderados por CFOP sem regra cadastrada: </span>
            {Object.entries(resultadoSolicitacao.cfops_sem_regra)
              .map(([sufixo, qtd]) => `${sufixo} (${qtd})`)
              .join(', ')}
          </div>
        )}

        {/* Avisos de Avaliação Fiscal (ex: SPED sem C170) */}
        {resultadoSolicitacao.avisos_avaliacao && resultadoSolicitacao.avisos_avaliacao.length > 0 && (
          <AvisosAvaliacaoSection avisos={resultadoSolicitacao.avisos_avaliacao} />
        )}

        {/* Relatório / Aviso de Notas Desconsideradas */}
        {resultadoSolicitacao.notas_ignoradas && resultadoSolicitacao.notas_ignoradas.length > 0 && (
          <NotasIgnoradasSection notas={resultadoSolicitacao.notas_ignoradas} />
        )}

        {/* Conferência de Itens Excluídos da Parcial */}
        {resultadoSolicitacao.itens_excluidos && resultadoSolicitacao.itens_excluidos.length > 0 && (
          <ItensExcluidosSection itens={resultadoSolicitacao.itens_excluidos} xmlFiles={xmlFiles} />
        )}

        {/* Resumo das Notas Fiscais Processadas */}
        {resultadoSolicitacao.notas_processadas && resultadoSolicitacao.notas_processadas.length > 0 && (
          <div className="space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">
              Conferência de Notas Fiscais Processadas ({resultadoSolicitacao.notas_processadas.length} itens)
            </h3>

            <div className="overflow-x-auto border border-slate-200/80 rounded-xl bg-white shadow-2xs">
              <table className="w-full text-left text-xs divide-y divide-slate-100">
                <thead className="bg-slate-50/70 text-slate-500 font-bold uppercase text-[10px] tracking-wider">
                  <tr>
                    <th className="py-2.5 px-3">Nota</th>
                    <th className="py-2.5 px-3">Planilha</th>
                    <th className="py-2.5 px-3 text-center">UF Origem</th>
                    <th className="py-2.5 px-3">Data Emissão</th>
                    <th className="py-2.5 px-3">Data Entrada</th>
                    <th className="py-2.5 px-3 font-mono">NCM</th>
                    <th className="py-2.5 px-3 text-right">V. Total</th>
                    <th className="py-2.5 px-3 text-right">Base Cálc.</th>
                    <th className="py-2.5 px-3 text-right font-mono">A.ORI</th>
                    <th className="py-2.5 px-3 text-right font-mono">A.DST</th>
                    <th className="py-2.5 px-3 text-right font-mono">Valor Devido</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {resultadoSolicitacao.notas_processadas.map((nota, i) => {
                    const isCte = nota.metadados_extras?.tipo_documento === 'cte';
                    const aOriOculta = isCte && nota.metadados_extras?.a_ori_destacada === false;
                    return (
                    <tr key={i} className="hover:bg-slate-50/70 transition-colors">
                      <td className="py-2.5 px-3 font-semibold text-slate-900">
                        <div className="flex items-center gap-1.5">
                          <span>{nota.numero_nota}</span>
                          {isCte && <Badge variant="info" size="sm">CT-e</Badge>}
                        </div>
                      </td>
                      <td className="py-2.5 px-3">
                        {nota.destino_planilha ? (
                          <PlanilhaBadge tipo={nota.destino_planilha} detailed />
                        ) : '-'}
                      </td>
                      <td className="py-2.5 px-3 text-center">
                        <span className="inline-flex items-center justify-center font-bold text-[10px] bg-blue-50 text-blue-900 px-2 py-0.5 rounded border border-blue-200/80">
                          {nota.uf_emitente || '-'}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-slate-600">{formatDate(nota.data_emissao)}</td>
                      <td className="py-2.5 px-3">
                        {nota.data_entrada ? (
                          <div className="flex items-center gap-1.5">
                            <span className="font-semibold text-slate-900">{formatDate(nota.data_entrada)}</span>
                            <Badge variant={nota.origem_data_entrada === 'planilha_sistema_contabil' ? 'success' : 'info'} size="sm">
                              {getEntryOriginLabel(nota.origem_data_entrada)}
                            </Badge>
                          </div>
                        ) : (
                          <Badge variant="warning" size="sm" dot>Pendente</Badge>
                        )}
                      </td>
                      <td className="py-2.5 px-3 font-mono text-slate-700">{nota.ncm || '-'}</td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums">{formatCurrency(nota.v_total)}</td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums">{formatCurrency(nota.base_calculo)}</td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-600">{aOriOculta ? '-' : formatPercent(nota.a_ori)}</td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums font-bold text-blue-900">{formatPercent(nota.a_dst_resolvida)}</td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums font-bold text-emerald-800">
                        {formatCurrency(nota.valor_devido)}
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    )}
  </div>
);

