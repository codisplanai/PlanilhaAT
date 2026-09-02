import React from 'react';
import {
  FileCode2,
  Upload,
  ShieldAlert,
  RotateCcw,
} from 'lucide-react';

import { getErrorMessage } from '../../api/client';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Select } from '../../components/ui/Select';
import { Modal } from '../../components/ui/Modal';
import { Badge } from '../../components/ui/Badge';
import { Card } from '../../components/ui/Card';
import { LoadingSpinner } from '../../components/feedback/LoadingSpinner';
import { EmptyState } from '../../components/feedback/EmptyState';
import { ErrorAlert } from '../../components/feedback/ErrorAlert';
import { PageHeader } from '../../components/layout/PageHeader';
import { formatDate } from '../../lib/formatters';
import { useAdminTemplatesPage } from './useAdminTemplatesPage';

export const AdminTemplatesPage: React.FC = () => {
  const {
    templatesQuery: { isLoading, error },
    templates,
    filteredTemplates,
    tiposPlanilha,
    selectedType,
    setSelectedType,
    modalOpen,
    closeModal,
    errorMessage,
    setErrorMessage,
    openUploadModal: handleOpenUploadModal,
    selectFile,
    promoteTemplate,
    isPromoting,
    uploadTemplate,
    register,
    errors,
    isUploading,
  } = useAdminTemplatesPage();

  return (
    <div className="space-y-6">
      {/* PageHeader Padronizado */}
      <PageHeader
        icon={<ShieldAlert className="w-5 h-5 text-amber-600" />}
        title="Administração de Modelos de Planilha (Templates)"
        description="Gestão restrita de arquivos .xlsx, mapeamento obrigatório de células de entrada e controle de versões"
        badge={<Badge variant="warning" size="sm">Área Restrita</Badge>}
        action={
          <Button
            onClick={() => handleOpenUploadModal(selectedType)}
            className="bg-amber-600 hover:bg-amber-700 focus:ring-amber-600 text-white shadow-xs shadow-amber-600/20"
            leftIcon={<Upload className="w-4 h-4" />}
          >
            Subir Novo Modelo (.xlsx)
          </Button>
        }
      />

      {/* Tabs por Tipo de Planilha */}
      <div className="flex border-b border-slate-200/80 gap-1.5 overflow-x-auto pb-0.5">
        {tiposPlanilha.map((tipo) => {
          const isSelected = selectedType === tipo.id;
          const count = templates.filter((t) => t.tipo === tipo.id).length;
          return (
            <button
              key={tipo.id}
              onClick={() => setSelectedType(tipo.id)}
              className={`py-2.5 px-4 text-xs font-bold border-b-2 transition-all duration-150 flex items-center gap-2 cursor-pointer select-none rounded-t-lg shrink-0 ${
                isSelected
                  ? 'border-amber-600 text-amber-950 bg-amber-50/60'
                  : 'border-transparent text-slate-500 hover:text-slate-900 hover:bg-slate-100/60'
              }`}
            >
              <span>{tipo.nome}</span>
              <span className={`text-[10px] px-2 py-0.5 rounded-full font-mono font-bold ${
                isSelected ? 'bg-amber-200 text-amber-900' : 'bg-slate-200/80 text-slate-700'
              }`}>
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Main Content */}
      {isLoading ? (
        <LoadingSpinner message="Carregando versões de templates..." />
      ) : error ? (
        <ErrorAlert message={getErrorMessage(error)} />
      ) : filteredTemplates.length === 0 ? (
        <EmptyState
          icon={<FileCode2 className="w-7 h-7 text-amber-600" />}
          title={`Nenhum modelo cadastrado para ${tiposPlanilha.find((t) => t.id === selectedType)?.nome}`}
          description="Faça o upload do primeiro arquivo .xlsx modelo e declare o mapeamento obrigatório de colunas para habilitar a geração de planilhas."
          actionLabel="Subir Primeiro Modelo"
          onAction={() => handleOpenUploadModal(selectedType)}
        />
      ) : (
        <div className="space-y-4 animate-fade-in">
          {filteredTemplates.map((template) => {
            const isAtivo = template.ativo;
            const mapping = template.mapeamento_campos;
            return (
              <Card
                key={template.id}
                className={isAtivo ? 'border-emerald-300 ring-2 ring-emerald-500/20 shadow-xs' : 'opacity-95'}
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-4">
                  <div className="flex items-center gap-3.5">
                    <div
                      className={`w-11 h-11 rounded-xl flex items-center justify-center font-bold font-mono text-sm shadow-2xs ${
                        isAtivo
                          ? 'bg-emerald-600 text-white shadow-emerald-600/20'
                          : 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      v{template.versao}
                    </div>
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="text-sm font-bold text-slate-900">
                          Versão {template.versao} — {tiposPlanilha.find((t) => t.id === template.tipo)?.nome}
                        </h3>
                        {isAtivo ? (
                          <Badge variant="success" size="sm" dot>
                            Versão Vigente (Ativa)
                          </Badge>
                        ) : (
                          <Badge variant="neutral" size="sm">
                            Versão Histórica
                          </Badge>
                        )}
                      </div>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        Cadastrado em {formatDate(template.criado_em)} • Hash SHA-256:{' '}
                        <span className="font-mono text-[10px] text-slate-600 font-medium">{template.arquivo_hash.slice(0, 16)}...</span>
                      </p>
                    </div>
                  </div>

                  {!isAtivo && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => promoteTemplate(template.id)}
                      isLoading={isPromoting}
                      leftIcon={<RotateCcw className="w-3.5 h-3.5" />}
                    >
                      Ativar Esta Versão
                    </Button>
                  )}
                </div>

                {template.observacoes && (
                  <p className="text-xs text-slate-600 mt-3 italic bg-slate-50/80 p-3 rounded-lg border border-slate-200/60 leading-relaxed">
                    "{template.observacoes}"
                  </p>
                )}

                {/* Mapeamento Declarado */}
                <div className="mt-4 pt-3 border-t border-slate-100">
                  <h4 className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2">
                    Mapeamento Declarado de Células / Colunas:
                  </h4>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                    <div className="bg-slate-50/80 p-2.5 rounded-lg border border-slate-200/80">
                      <span className="text-[10px] text-slate-400 block font-semibold">Linha Inicial</span>
                      <span className="font-bold font-mono text-slate-800">Linha {mapping.start_row}</span>
                    </div>

                    {Object.entries(mapping.columns || {}).map(([campo, col]) => (
                      <div key={campo} className="bg-slate-50/80 p-2.5 rounded-lg border border-slate-200/80">
                        <span className="text-[10px] text-slate-400 block font-semibold truncate">{campo}</span>
                        <span className="font-bold font-mono text-blue-900">Coluna {col}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Modal de Upload de Template com Mapeamento Obrigatório */}
      <Modal
        isOpen={modalOpen}
        onClose={closeModal}
        title="Subir Nova Versão de Template Excel"
        subtitle="O mapeamento de coordenadas de entrada é estritamente obrigatório para não corromper fórmulas."
        maxWidth="2xl"
      >
        {errorMessage && (
          <ErrorAlert
            title="Erro no envio do template"
            message={errorMessage}
            onDismiss={() => setErrorMessage(null)}
          />
        )}

        <form onSubmit={uploadTemplate} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Select
                label="Tipo de Planilha Modelo"
                options={tiposPlanilha.map((t) => ({ value: t.id, label: t.nome }))}
                {...register('tipo')}
                error={errors.tipo?.message}
              />
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-700">
                Arquivo Excel (.xlsx)
              </label>
              <input
                type="file"
                accept=".xlsx"
                onChange={selectFile}
                className="w-full text-xs text-slate-500 file:mr-3 file:py-2 file:px-3.5 file:rounded-lg file:border-0 file:text-xs file:font-bold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 cursor-pointer"
              />
            </div>
          </div>

          <div className="bg-amber-50/80 border border-amber-200/80 rounded-xl p-3.5 text-xs text-amber-900 leading-relaxed">
            <span className="font-bold block mb-0.5">Declaração de Mapeamento Obrigatória:</span>
            Indique a letra da coluna correspondente a cada dado na planilha. O sistema escreverá <strong>exclusivamente</strong> nessas colunas, preservando as fórmulas do Excel intactas.
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <Input
                label="Linha Inicial"
                type="number"
                {...register('start_row', { valueAsNumber: true })}
                error={errors.start_row?.message}
              />
            </div>

            <div>
              <Input
                label="Nº da Nota"
                placeholder="Ex: D"
                {...register('col_numero_nota')}
                error={errors.col_numero_nota?.message}
              />
            </div>

            <div>
              <Input
                label="Data Emissão"
                placeholder="Ex: C"
                {...register('col_data_emissao')}
                error={errors.col_data_emissao?.message}
              />
            </div>

            <div>
              <Input
                label="V. Total"
                placeholder="Ex: E"
                {...register('col_v_total')}
                error={errors.col_v_total?.message}
              />
            </div>

            <div>
              <Input
                label="IPI + Despesas"
                placeholder="Ex: G"
                {...register('col_ipi_despesas')}
                error={errors.col_ipi_despesas?.message}
              />
            </div>

            <div>
              <Input
                label="A. DST (Destino)"
                placeholder="Ex: H"
                {...register('col_a_dst')}
                error={errors.col_a_dst?.message}
              />
            </div>

            <div>
              <Input
                label="A. ORI (Origem)"
                placeholder="Ex: I"
                {...register('col_a_ori')}
                error={errors.col_a_ori?.message}
              />
            </div>

            <div>
              <Input
                label="Célula Cabeçalho"
                placeholder="Ex: A2"
                {...register('header_cell')}
                error={errors.header_cell?.message}
              />
            </div>
          </div>

          <div>
            <Input
              label="Observações da Versão"
              placeholder="Ex: Atualização da alíquota interna ou inclusão de novos campos de IPI"
              {...register('observacoes')}
              error={errors.observacoes?.message}
            />
          </div>

          <div className="pt-2 flex items-center gap-2.5">
            <input
              type="checkbox"
              id="promover_ativo"
              className="rounded-md border-slate-300 text-blue-600 focus:ring-blue-500 h-4 w-4 cursor-pointer"
              {...register('promover_ativo')}
            />
            <label htmlFor="promover_ativo" className="text-xs text-slate-700 font-medium cursor-pointer select-none">
              Tornar esta versão imediatamente vigente (ativa) para novos processamentos
            </label>
          </div>

          <div className="pt-4 border-t border-slate-100 flex justify-end gap-3">
            <Button type="button" variant="outline" onClick={closeModal}>
              Cancelar
            </Button>
            <Button type="submit" isLoading={isUploading}>
              Salvar Nova Versão
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
