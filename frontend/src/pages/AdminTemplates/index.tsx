import React from 'react';
import {
  Building2,
  FileCode2,
  Globe,
  PowerOff,
  Upload,
  ShieldAlert,
  RotateCcw,
  Settings2,
  Check,
  FileSpreadsheet,
  TriangleAlert,
} from 'lucide-react';

import { getErrorMessage } from '../../api/client';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Select } from '../../components/ui/Select';
import { Modal } from '../../components/ui/Modal';
import { Badge } from '../../components/ui/Badge';
import { Tabs } from '../../components/ui/Tabs';
import { Card } from '../../components/ui/Card';
import { LoadingSpinner } from '../../components/feedback/LoadingSpinner';
import { EmptyState } from '../../components/feedback/EmptyState';
import { ErrorAlert } from '../../components/feedback/ErrorAlert';
import { PageHeader } from '../../components/layout/PageHeader';
import { formatCNPJ, formatDate } from '../../lib/formatters';
import type { TemplateMapping } from '../../types/template';
import { useAdminTemplatesPage } from './useAdminTemplatesPage';

/** Nomes dos campos do mapeamento como o administrador os conhece. */
const CAMPO_LABELS: Record<string, string> = {
  item_index: 'Nº do item',
  numero_nota: 'Nº da nota',
  data_entrada: 'Data de entrada',
  data_emissao: 'Data de emissão',
  v_total: 'Valor total',
  base_calculo: 'Base de cálculo',
  ipi_despesas: 'IPI + despesas',
  mva: 'MVA',
  reducao: 'Redução',
  red: 'RED. (S/N)',
  aliq_simples: 'Alíq. Simples',
  a_dst: 'A.DST',
  a_ori: 'A.ORI',
  valor_pago: 'VR. PG.',
};

const plural = (n: number, singular: string, plural_: string): string =>
  `${n} ${n === 1 ? singular : plural_}`;

const MapeamentoChips: React.FC<{ mapping: TemplateMapping }> = ({ mapping }) => (
  <div className="flex flex-wrap gap-1.5">
    <span className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200/80 bg-slate-50/80 px-2 py-1 text-[11px]">
      <span className="text-slate-500">Primeira linha de dados</span>
      <span className="font-mono font-bold text-slate-800">{mapping.start_row}</span>
    </span>
    {mapping.header_cell && (
      <span className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200/80 bg-slate-50/80 px-2 py-1 text-[11px]">
        <span className="text-slate-500">Cabeçalho</span>
        <span className="font-mono font-bold text-slate-800">{mapping.header_cell}</span>
      </span>
    )}
    {Object.entries(mapping.columns || {}).map(([campo, col]) => (
      <span
        key={campo}
        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200/80 bg-slate-50/80 px-2 py-1 text-[11px]"
      >
        <span className="text-slate-500">{CAMPO_LABELS[campo] || campo}</span>
        <span className="font-mono font-bold text-blue-900">{col}</span>
      </span>
    ))}
  </div>
);

export const AdminTemplatesPage: React.FC = () => {
  const {
    templatesQuery: { isLoading, error },
    empresasQuery,
    empresas,
    selectedEmpresaId,
    setSelectedEmpresaId,
    selectedEmpresa,
    templatesByScope,
    faixas,
    tiposPlanilha,
    selectedType,
    setSelectedType,
    safetyConfigQuery,
    safetyMarginInput,
    setSafetyMarginInput,
    safetyMarginError,
    safetyMarginSaved,
    saveSafetyMargin,
    isSavingSafetyMargin,
    modalOpen,
    closeModal,
    errorMessage,
    setErrorMessage,
    openUploadModal: handleOpenUploadModal,
    selectFile,
    selectedFile,
    promoteTemplate,
    promotingId,
    isPromoting,
    promoteError,
    setPromoteError,
    deactivateTemplate,
    deactivatingId,
    isDeactivating,
    deactivateError,
    setDeactivateError,
    uploadTemplate,
    register,
    watch,
    errors,
    isUploading,
  } = useAdminTemplatesPage();
  const tipoUpload = watch('tipo');
  const nomeTipoAtual = tiposPlanilha.find((t) => t.id === selectedType)?.nome ?? '';
  const margemAtual = Number.parseInt(safetyMarginInput, 10) || 0;

  return (
    <div className="space-y-6">
      <PageHeader
        icon={<ShieldAlert className="w-5 h-5 text-amber-600" />}
        title="Modelos de Planilha"
        description="Arquivos .xlsx por tipo e capacidade. A cada processamento o sistema prioriza os modelos personalizados da empresa (se houver) e cai automaticamente para o padrão global."
        badge={<Badge variant="warning" size="sm">Área Restrita</Badge>}
        action={
          <Button
            onClick={() => handleOpenUploadModal(selectedType)}
            className="bg-amber-600 hover:bg-amber-700 focus:ring-amber-600 text-white shadow-xs shadow-amber-600/20"
            leftIcon={<Upload className="w-4 h-4" />}
          >
            {selectedEmpresa ? 'Subir modelo da empresa' : 'Subir novo modelo'}
          </Button>
        }
      />

      {promoteError && (
        <ErrorAlert
          title="Erro ao ativar versão"
          message={promoteError}
          onDismiss={() => setPromoteError(null)}
        />
      )}

      {deactivateError && (
        <ErrorAlert
          title="Erro ao desativar modelo"
          message={deactivateError}
          onDismiss={() => setDeactivateError(null)}
        />
      )}

      <Card
        title="Escopo dos modelos"
        subtitle={
          selectedEmpresa
            ? 'Modelos ativos desta empresa têm prioridade automática sobre o padrão global. Tipos ou capacidades sem modelo próprio continuam usando o padrão global.'
            : 'Modelos padrão globais usados por todas as empresas que não possuem modelo personalizado para o tipo ou capacidade.'
        }
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <Select
              label="Aplicar modelos para"
              value={selectedEmpresaId === null ? '' : String(selectedEmpresaId)}
              onChange={(event) => {
                const value = event.target.value;
                setSelectedEmpresaId(value ? Number(value) : null);
              }}
              options={[
                { value: '', label: 'Padrão Global (todas as empresas)' },
                ...empresas.map((empresa) => ({
                  value: String(empresa.id),
                  label: `${empresa.razao_social} — ${formatCNPJ(empresa.cnpj)}`,
                })),
              ]}
              disabled={empresasQuery.isLoading}
            />
          </div>
          <div className="flex items-center gap-2 pb-1">
            {selectedEmpresa ? (
              <Badge variant="info" size="sm" dot>
                <span className="inline-flex items-center gap-1">
                  <Building2 className="h-3 w-3" />
                  Personalizado: {selectedEmpresa.razao_social}
                </span>
              </Badge>
            ) : (
              <Badge variant="neutral" size="sm" dot>
                <span className="inline-flex items-center gap-1">
                  <Globe className="h-3 w-3" />
                  Padrão Global
                </span>
              </Badge>
            )}
          </div>
        </div>
        {empresasQuery.error && (
          <div className="mt-3">
            <ErrorAlert message={getErrorMessage(empresasQuery.error)} />
          </div>
        )}
      </Card>

      <Tabs
        tabs={tiposPlanilha.map((tipo) => ({
          id: tipo.id,
          label: tipo.nome,
          count: templatesByScope.filter((t) => t.tipo === tipo.id).length,
        }))}
        activeTab={selectedType}
        onChange={(id) => setSelectedType(id)}
        ariaLabel="Tipos de Planilha Modelo"
      />

      {/* A margem desloca todos os limites da escada, então vem antes dela. */}
      <Card
        title={`Margem de segurança — ${nomeTipoAtual}`}
        subtitle="Reserva somada à quantidade real de linhas antes de escolher o modelo. Use 0 para desativar."
        headerAction={
          <div className="flex items-end gap-2">
            <div className="w-32">
              <Input
                label="Linhas"
                type="number"
                min={0}
                max={100000}
                step={1}
                value={safetyMarginInput}
                onChange={(event) => setSafetyMarginInput(event.target.value)}
                disabled={safetyConfigQuery.isLoading}
              />
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={saveSafetyMargin}
              isLoading={isSavingSafetyMargin}
              disabled={safetyConfigQuery.isLoading}
              className="mb-[2px]"
            >
              Salvar margem
            </Button>
          </div>
        }
      >
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <div className="flex items-start gap-2.5 text-xs leading-relaxed text-slate-600">
            <Settings2 className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
            <p className="max-w-[68ch]">
              {margemAtual > 0 ? (
                <>
                  Com {plural(margemAtual, 'linha', 'linhas')} de reserva, uma apuração de{' '}
                  <span className="font-mono font-semibold text-slate-800">N</span> linhas exige um
                  modelo de pelo menos{' '}
                  <span className="font-mono font-semibold text-slate-800">N + {margemAtual}</span>{' '}
                  linhas de capacidade.
                </>
              ) : (
                'Sem reserva, o modelo escolhido precisa comportar exatamente a quantidade de linhas da apuração.'
              )}
            </p>
          </div>
          {safetyMarginSaved && (
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700">
              <Check className="h-3 w-3" /> Margem salva
            </span>
          )}
        </div>
        {safetyConfigQuery.error && (
          <div className="mt-3">
            <ErrorAlert message={getErrorMessage(safetyConfigQuery.error)} />
          </div>
        )}
        {safetyMarginError && (
          <div className="mt-3">
            <ErrorAlert message={safetyMarginError} />
          </div>
        )}
      </Card>

      {isLoading ? (
        <LoadingSpinner message="Carregando versões de templates..." />
      ) : error ? (
        <ErrorAlert message={getErrorMessage(error)} />
      ) : faixas.length === 0 ? (
        <EmptyState
          icon={<FileCode2 className="w-7 h-7 text-amber-600" />}
          title={
            selectedEmpresa
              ? `Esta empresa usa o modelo padrão global para ${nomeTipoAtual}`
              : `Nenhum modelo cadastrado para ${nomeTipoAtual}`
          }
          description={
            selectedEmpresa
              ? `Nenhum modelo personalizado foi cadastrado para ${selectedEmpresa.razao_social} neste tipo. Você pode enviar um arquivo .xlsx exclusivo ou manter o padrão global.`
              : 'Faça o upload do primeiro arquivo .xlsx modelo e declare o mapeamento obrigatório de colunas para habilitar a geração de planilhas.'
          }
          actionLabel={
            selectedEmpresa
              ? 'Subir modelo personalizado para esta empresa'
              : 'Subir Primeiro Modelo'
          }
          onAction={() => handleOpenUploadModal(selectedType)}
        />
      ) : (
        <div className="space-y-8">
          {faixas.map((faixa) => {
            const atendeAte =
              faixa.capacidade === null ? null : Math.max(faixa.capacidade - margemAtual, 0);
            return (
              <section key={faixa.capacidade ?? 'legado'} className="space-y-3">
                {/* A capacidade é o número sobre o qual o administrador raciocina. */}
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  {faixa.capacidade === null ? (
                    <h2 className="text-lg font-bold tracking-tight text-slate-900">
                      Modelos legados
                    </h2>
                  ) : (
                    <h2 className="flex items-baseline gap-1.5">
                      <span className="text-2xl font-black tabular-nums tracking-tight text-slate-900">
                        {faixa.capacidade.toLocaleString('pt-BR')}
                      </span>
                      <span className="text-sm font-semibold text-slate-500">linhas</span>
                    </h2>
                  )}
                  <p className="text-xs text-slate-500">
                    {faixa.capacidade === null
                      ? 'Sem capacidade declarada: só entram em uso quando nenhum modelo dimensionado atende.'
                      : margemAtual > 0
                        ? `Atende apurações de até ${atendeAte?.toLocaleString('pt-BR')} linhas reais, já descontada a margem.`
                        : `Atende apurações de até ${faixa.capacidade.toLocaleString('pt-BR')} linhas reais.`}
                  </p>
                  <span className="ml-1 hidden h-px flex-1 bg-slate-200 sm:block" />
                </div>

                {faixa.oficial ? (
                  <Card>
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                      <div className="flex min-w-0 items-start gap-3.5">
                        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-600 font-mono text-sm font-bold text-white shadow-2xs shadow-emerald-600/20">
                          v{faixa.oficial.versao}
                        </div>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="text-sm font-bold tracking-tight text-slate-900">
                              Versão {faixa.oficial.versao}
                            </h3>
                            <Badge variant="success" size="sm" dot>
                              {faixa.capacidade === null ? 'Em uso' : 'Em uso nesta capacidade'}
                            </Badge>
                          </div>
                          <p className="mt-0.5 text-[11px] text-slate-500">
                            Cadastrado em {formatDate(faixa.oficial.criado_em)}
                          </p>
                          <p className="mt-0.5 font-mono text-[10px] text-slate-400">
                            SHA-256 {faixa.oficial.arquivo_hash.slice(0, 16)}
                          </p>
                        </div>
                      </div>
                      {selectedEmpresa && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => deactivateTemplate(faixa.oficial!.id)}
                          isLoading={deactivatingId === faixa.oficial.id}
                          disabled={isDeactivating || isPromoting}
                          leftIcon={<PowerOff className="w-3.5 h-3.5" />}
                        >
                          Desativar (usar padrão global)
                        </Button>
                      )}
                    </div>

                    {faixa.oficial.observacoes && (
                      <p className="mt-3 rounded-lg border border-slate-200/60 bg-slate-50/80 p-3 text-xs leading-relaxed text-slate-600">
                        {faixa.oficial.observacoes}
                      </p>
                    )}

                    <div className="mt-4 border-t border-slate-100 pt-3">
                      <h4 className="mb-2 text-xs font-semibold text-slate-700">
                        Colunas em que o sistema escreve
                      </h4>
                      <MapeamentoChips mapping={faixa.oficial.mapeamento_campos} />
                    </div>
                  </Card>
                ) : (
                  <Card className="border-amber-300 bg-amber-50/40">
                    <div className="flex items-start gap-2.5 text-xs text-amber-900">
                      <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                      <p className="leading-relaxed">
                        {selectedEmpresa
                          ? 'Nenhuma versão personalizada está em uso nesta capacidade. Enquanto estiver desativada, esta empresa utiliza o padrão global.'
                          : 'Nenhuma versão está em uso nesta capacidade. Ative uma das versões abaixo para que apurações desse tamanho voltem a ser geradas.'}
                      </p>
                    </div>
                  </Card>
                )}

                {faixa.substituidas.length > 0 && (
                  <Card
                    collapsible
                    defaultOpen={false}
                    bodyPadding="none"
                    title={plural(
                      faixa.substituidas.length,
                      'versão substituída',
                      'versões substituídas',
                    )}
                    subtitle="Histórico desta capacidade, mantido para auditoria. Colocar uma versão em uso substitui a atual."
                  >
                    <div className="overflow-x-auto">
                      <table className="w-full divide-y divide-slate-100 text-left text-xs">
                        <thead className="bg-slate-50/70 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                          <tr>
                            <th className="px-4 py-2.5">Versão</th>
                            <th className="px-4 py-2.5">Cadastrada em</th>
                            <th className="px-4 py-2.5">Observações</th>
                            <th className="px-4 py-2.5 font-mono">SHA-256</th>
                            <th className="px-4 py-2.5 text-right">Ação</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100/80">
                          {faixa.substituidas.map((template) => (
                            <tr key={template.id} className="transition-colors hover:bg-slate-50/70">
                              <td className="px-4 py-2.5">
                                <span className="rounded border border-slate-200 bg-slate-100 px-2 py-0.5 font-mono text-[11px] font-bold text-slate-700">
                                  v{template.versao}
                                </span>
                              </td>
                              <td className="px-4 py-2.5 text-slate-600">
                                {formatDate(template.criado_em)}
                              </td>
                              <td className="px-4 py-2.5 text-slate-600">
                                {template.observacoes || '—'}
                              </td>
                              <td className="px-4 py-2.5 font-mono text-[10px] text-slate-400">
                                {template.arquivo_hash.slice(0, 16)}
                              </td>
                              <td className="px-4 py-2.5 text-right">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => promoteTemplate(template.id)}
                                  isLoading={promotingId === template.id}
                                  disabled={isPromoting || isDeactivating}
                                  leftIcon={<RotateCcw className="w-3.5 h-3.5" />}
                                >
                                  Colocar em uso
                                </Button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </Card>
                )}
              </section>
            );
          })}
        </div>
      )}

      <Modal
        isOpen={modalOpen}
        onClose={closeModal}
        title={
          selectedEmpresa
            ? 'Cadastrar modelo personalizado da empresa'
            : 'Cadastrar modelo por capacidade'
        }
        subtitle="Informe quantas linhas de dados o arquivo comporta. O sistema escolherá automaticamente o menor modelo suficiente para cada processamento."
        maxWidth="2xl"
      >
        <div
          className={`mb-4 flex items-center gap-2 rounded-lg border px-3 py-2 text-xs ${
            selectedEmpresa
              ? 'border-blue-200 bg-blue-50/70 text-blue-900'
              : 'border-slate-200 bg-slate-50 text-slate-700'
          }`}
        >
          {selectedEmpresa ? (
            <>
              <Building2 className="h-4 w-4 shrink-0 text-blue-700" />
              <span>
                Escopo: <strong>{selectedEmpresa.razao_social}</strong> ({formatCNPJ(selectedEmpresa.cnpj)})
              </span>
            </>
          ) : (
            <>
              <Globe className="h-4 w-4 shrink-0 text-slate-500" />
              <span>
                Escopo: <strong>Padrão Global</strong> (todas as empresas sem modelo próprio)
              </span>
            </>
          )}
        </div>

        {errorMessage && (
          <ErrorAlert
            title="Erro no envio do template"
            message={errorMessage}
            onDismiss={() => setErrorMessage(null)}
          />
        )}

        <form onSubmit={uploadTemplate} className="space-y-5">
          <fieldset className="space-y-3">
            <legend className="text-xs font-bold tracking-tight text-slate-900">
              O arquivo
            </legend>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Select
                label="Tipo de planilha"
                options={tiposPlanilha.map((t) => ({ value: t.id, label: t.nome }))}
                {...register('tipo')}
                error={errors.tipo?.message}
              />
              <Input
                label="Capacidade de linhas"
                type="number"
                min={1}
                placeholder="Ex: 300"
                {...register('capacidade_linhas', { valueAsNumber: true })}
                error={errors.capacidade_linhas?.message}
                helperText="Máximo de linhas de dados que este arquivo comporta."
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="template-arquivo" className="block text-xs font-semibold text-slate-700">
                Arquivo Excel (.xlsx)
              </label>
              <input
                id="template-arquivo"
                type="file"
                accept=".xlsx"
                onChange={selectFile}
                className="w-full cursor-pointer text-xs text-slate-500 file:mr-3 file:rounded-lg file:border-0 file:bg-blue-50 file:px-3.5 file:py-2 file:text-xs file:font-bold file:text-blue-700 hover:file:bg-blue-100"
              />
              {selectedFile && (
                <p className="inline-flex items-center gap-1.5 text-[11px] text-slate-600">
                  <FileSpreadsheet className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
                  <span className="font-medium">{selectedFile.name}</span>
                  <span className="text-slate-400">
                    {(selectedFile.size / 1024).toLocaleString('pt-BR', {
                      maximumFractionDigits: 0,
                    })}{' '}
                    KB
                  </span>
                </p>
              )}
            </div>
          </fieldset>

          <fieldset className="space-y-3 border-t border-slate-100 pt-4">
            <legend className="text-xs font-bold tracking-tight text-slate-900">
              Onde o sistema escreve
            </legend>
            <p className="text-xs leading-relaxed text-slate-500">
              Indique a letra da coluna de cada dado. O sistema escreve exclusivamente nessas colunas
              e preserva as fórmulas do arquivo.
            </p>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Input
                label="Linha inicial"
                type="number"
                {...register('start_row', { valueAsNumber: true })}
                error={errors.start_row?.message}
              />
              <Input
                label="Célula do cabeçalho"
                placeholder="Ex: A2"
                {...register('header_cell')}
                error={errors.header_cell?.message}
              />
              <Input
                label="Nº do item"
                placeholder="Ex: A"
                {...register('col_item_index')}
                error={errors.col_item_index?.message}
              />
              <Input
                label="Nº da nota"
                placeholder="Ex: D"
                {...register('col_numero_nota')}
                error={errors.col_numero_nota?.message}
              />
              <Input
                label="Data de emissão"
                placeholder="Ex: C"
                {...register('col_data_emissao')}
                error={errors.col_data_emissao?.message}
              />
              <Input
                label="Data de entrada"
                placeholder="Ex: B"
                {...register('col_data_entrada')}
                error={errors.col_data_entrada?.message}
              />
              <Input
                label="Valor total"
                placeholder="Ex: E"
                {...register('col_v_total')}
                error={errors.col_v_total?.message}
              />
              <Input
                label="IPI + despesas"
                placeholder="Ex: G"
                {...register('col_ipi_despesas')}
                error={errors.col_ipi_despesas?.message}
              />
              {(
                tipoUpload === 'antecipacao_tributaria'
                || tipoUpload === 'antecipacao_tributaria_antecipado'
              ) && (
                  <>
                    <Input
                      label="MVA"
                      placeholder="Ex: H"
                      {...register('col_mva')}
                      error={errors.col_mva?.message}
                    />
                    <Input
                      label="Redução"
                      placeholder="Ex: I"
                      {...register('col_reducao')}
                      error={errors.col_reducao?.message}
                    />
                    <Input
                      label="RED. (S/N)"
                      placeholder="Ex: L"
                      {...register('col_red')}
                      error={errors.col_red?.message}
                    />
                  </>
                )}
              {(tipoUpload === 'difal' || tipoUpload === 'difal_antecipado') && (
                <Input
                  label="Alíq. Simples"
                  placeholder="Ex: G"
                  {...register('col_aliq_simples')}
                  error={errors.col_aliq_simples?.message}
                />
              )}
              <Input
                label="A.DST (destino)"
                placeholder="Ex: H"
                {...register('col_a_dst')}
                error={errors.col_a_dst?.message}
              />
              <Input
                label="A.ORI (origem)"
                placeholder="Ex: I"
                {...register('col_a_ori')}
                error={errors.col_a_ori?.message}
              />
            </div>
          </fieldset>

          <fieldset className="space-y-3 border-t border-slate-100 pt-4">
            <legend className="text-xs font-bold tracking-tight text-slate-900">
              Registro da versão
            </legend>
            <Input
              label="Observações"
              placeholder="Ex: Atualização da alíquota interna ou inclusão de novos campos de IPI"
              {...register('observacoes')}
              error={errors.observacoes?.message}
              helperText="Aparece na lista de versões substituídas, para auditoria."
            />
            <div className="flex items-start gap-2.5">
              <input
                type="checkbox"
                id="promover_ativo"
                className="mt-0.5 h-4 w-4 cursor-pointer rounded-md border-slate-300 text-blue-600 focus:ring-blue-500"
                {...register('promover_ativo')}
              />
              <label
                htmlFor="promover_ativo"
                className="cursor-pointer select-none text-xs font-medium leading-relaxed text-slate-700"
              >
                Colocar esta versão em uso nesta capacidade
                <span className="mt-0.5 block font-normal text-slate-500">
                  A versão em uso hoje passa para o histórico e pode ser reativada quando quiser.
                </span>
              </label>
            </div>
          </fieldset>

          <div className="flex justify-end gap-3 border-t border-slate-100 pt-4">
            <Button type="button" variant="outline" onClick={closeModal}>
              Cancelar
            </Button>
            <Button type="submit" isLoading={isUploading}>
              Salvar versão
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
