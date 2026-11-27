import React from 'react';
import { FileSpreadsheet } from 'lucide-react';

import { getErrorMessage } from '../../api/client';
import { Card } from '../../components/ui/Card';
import { ErrorAlert } from '../../components/feedback/ErrorAlert';
import { PageHeader } from '../../components/layout/PageHeader';
import { ModalConfirmacaoBonificacao } from '../../components/ModalConfirmacaoBonificacao';
import { ModalConfirmacaoConvenio5291 } from '../../components/ModalConfirmacaoConvenio5291';
import { ModalPendenciaCteNfe } from '../../components/ModalPendenciaCteNfe';
import { ModalConfirmacaoUsoConsumo } from '../../components/ModalConfirmacaoUsoConsumo';
import { ModalPendenciaMva } from '../../components/ModalPendenciaMva';
import { CompanySelectionStep } from './CompanySelectionStep';
import { PeriodSelectionStep } from './PeriodSelectionStep';
import { FiscalFilesStep } from './FiscalFilesStep';
import { RequestStepper } from './RequestStepper';
import { ReviewAndResultStep } from './ReviewAndResultStep';
import { useNovaSolicitacaoPage } from './useNovaSolicitacaoPage';

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
    spedFiles,
    planilhaEntradaFile,
    setXmlFiles,
    setSpedFiles,
    setPlanilhaEntradaFile,
    handleXmlDrop,
    handleXmlInput,
    removeXmlFile,
    handleSpedInput,
    handleSpedDrop,
    removeSpedFile,
    handlePlanilhaEntradaInput,
    handlePlanilhaEntradaDrop,
    fileError,
    clearFileError,
    isProcessing,
    resultadoSolicitacao,
    hasLocalArtifact,
    hasAnyLocalArtifact,
    errorMessage,
    setErrorMessage,
    downloadError,
    setDownloadError,
    advanceFromPeriod,
    empresasQuery: { isLoading: isLoadingEmpresas, error: empresasError },
    filteredEmpresas,
    generateSpreadsheet: handleGerarPlanilha,
    downloadSpreadsheet: handleDownload,
    startNewRequest,
    pendenciasCteNfe,
    showModalCteNfe,
    cteModalFeedback,
    clearCteModalFeedback,
    anexarNfesFaltantesEProcessar,
    ignorarCtesSemNfeEProcessar,
    cancelarModalCteNfe,
    pendenciasBonificacao,
    showModalBonificacao,
    confirmarBonificacoesEProcessar,
    cancelarModalBonificacao,
    pendenciasConvenio5291,
    showModalConvenio5291,
    confirmarConvenio5291EProcessar,
    cancelarModalConvenio5291,
    pendenciasUsoConsumo, showModalUsoConsumo, confirmarUsoConsumoEProcessar, cancelarModalUsoConsumo,
    pendenciasMva, showModalMva, confirmarMvasEProcessar, cancelarModalMva,
    diagnosticSession,
    clearDiagnostic,
    exportDiagnosticText,
    exportDiagnosticJson,
  } = useNovaSolicitacaoPage();

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <PageHeader
        icon={<FileSpreadsheet className="w-5 h-5 text-blue-700" />}
        title="Gerar Planilha de Antecipação / DIFAL"
        description="Assistente guiado em 4 etapas para extração de dados e preenchimento determinístico do Excel"
      />

      {empresasError && <ErrorAlert message={getErrorMessage(empresasError)} />}
      {fileError && <ErrorAlert title="Arquivo não aceito" message={fileError} onDismiss={clearFileError} />}

      <RequestStepper
        currentStep={currentStep}
        completed={resultadoSolicitacao?.status === 'concluido'}
      />

      {/* Main Content by Step */}
      <Card className="p-6 sm:p-7">
        {currentStep === 1 && (
          <CompanySelectionStep
            companies={filteredEmpresas}
            isLoading={isLoadingEmpresas}
            search={empresaSearch}
            selectedCompany={selectedEmpresa}
            onSearchChange={setEmpresaSearch}
            onSelect={setSelectedEmpresa}
            onAdvance={() => setCurrentStep(2)}
          />
        )}

        {currentStep === 2 && (
          <PeriodSelectionStep
            companyName={selectedEmpresa?.razao_social}
            start={periodoInicio}
            end={periodoFim}
            onStartChange={setPeriodoInicio}
            onEndChange={setPeriodoFim}
            onBack={() => setCurrentStep(1)}
            onAdvance={advanceFromPeriod}
          />
        )}

        {/* ETAPA 3: SELEÇÃO LOCAL DE ARQUIVOS */}
        {currentStep === 3 && (
          <FiscalFilesStep
            xmlFiles={xmlFiles}
            spedFiles={spedFiles}
            planilhaEntradaFile={planilhaEntradaFile}
            onXmlDrop={handleXmlDrop}
            onXmlInput={handleXmlInput}
            onRemoveXml={removeXmlFile}
            onClearXmls={() => setXmlFiles([])}
            onSpedDrop={handleSpedDrop}
            onSpedInput={handleSpedInput}
            onRemoveSped={removeSpedFile}
            onClearSpeds={() => setSpedFiles([])}
            onPlanilhaDrop={handlePlanilhaEntradaDrop}
            onPlanilhaInput={handlePlanilhaEntradaInput}
            onRemovePlanilha={() => setPlanilhaEntradaFile(null)}
            onBack={() => setCurrentStep(2)}
            onAdvance={() => setCurrentStep(4)}
          />
        )}

        {/* ETAPA 4: REVISÃO E PROCESSAMENTO */}
        {currentStep === 4 && (
          <ReviewAndResultStep
            selectedEmpresa={selectedEmpresa}
            periodoInicio={periodoInicio}
            periodoFim={periodoFim}
            xmlFiles={xmlFiles}
            spedFiles={spedFiles}
            planilhaEntradaFile={planilhaEntradaFile}
            isProcessing={isProcessing}
            resultadoSolicitacao={resultadoSolicitacao}
            hasLocalArtifact={hasLocalArtifact}
            hasAnyLocalArtifact={hasAnyLocalArtifact}
            errorMessage={errorMessage}
            setErrorMessage={setErrorMessage}
            downloadError={downloadError}
            setDownloadError={setDownloadError}
            diagnosticSession={diagnosticSession}
            onBack={() => setCurrentStep(3)}
            onGenerate={handleGerarPlanilha}
            onDownload={handleDownload}
            onStartNewRequest={startNewRequest}
            onClearDiagnostic={clearDiagnostic}
            onExportDiagnosticText={exportDiagnosticText}
            onExportDiagnosticJson={exportDiagnosticJson}
          />
        )}
      </Card>

      <ModalPendenciaCteNfe
        isOpen={showModalCteNfe}
        onClose={cancelarModalCteNfe}
        pendencias={pendenciasCteNfe}
        onAttachFiles={anexarNfesFaltantesEProcessar}
        onIgnorePending={ignorarCtesSemNfeEProcessar}
        isProcessing={isProcessing}
        feedbackMessage={cteModalFeedback}
        onClearFeedback={clearCteModalFeedback}
      />

      {showModalUsoConsumo && <ModalConfirmacaoUsoConsumo
        notas={pendenciasUsoConsumo}
        xmlFiles={xmlFiles}
        onClose={cancelarModalUsoConsumo}
        onConfirm={confirmarUsoConsumoEProcessar}
        isProcessing={isProcessing}
      />}
      <ModalConfirmacaoBonificacao
        isOpen={showModalBonificacao}
        onClose={cancelarModalBonificacao}
        notas={pendenciasBonificacao}
        xmlFiles={xmlFiles}
        onConfirm={confirmarBonificacoesEProcessar}
        isProcessing={isProcessing}
        industria={selectedEmpresa?.atividade === 'industria'}
      />

      {showModalMva && <ModalPendenciaMva
        pendencias={pendenciasMva}
        xmlFiles={xmlFiles}
        onClose={cancelarModalMva}
        onConfirm={confirmarMvasEProcessar}
        isProcessing={isProcessing}
      />}
      <ModalConfirmacaoConvenio5291
        isOpen={showModalConvenio5291}
        onClose={cancelarModalConvenio5291}
        itens={pendenciasConvenio5291}
        xmlFiles={xmlFiles}
        onConfirm={confirmarConvenio5291EProcessar}
        isProcessing={isProcessing}
      />
    </div>
  );
};
