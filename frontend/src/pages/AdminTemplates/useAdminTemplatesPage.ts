import { useEffect, useState } from 'react';
import type { ChangeEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { getErrorMessage } from '../../api/client';
import { queryKeys } from '../../api/queryKeys';
import { templatesApi } from '../../api/templates';
import { TIPOS_PLANILHA_OPTIONS } from '../../constants/domain';
import { useTemplatesQuery } from '../../hooks/useApiQueries';
import type { TemplateMapping } from '../../types/template';
import type { TipoPlanilha } from '../../types/solicitacao';

const templateUploadSchema = z.object({
  tipo: z.enum([
    'antecipacao_parcial',
    'antecipacao_parcial_antecipado',
    'antecipacao_parcial_simples',
    'antecipacao_parcial_antecipado_simples',
    'antecipacao_tributaria',
    'difal',
  ]),
  capacidade_linhas: z.number().int().min(1, 'A capacidade deve ser maior ou igual a 1 linha'),
  start_row: z.number().min(1, 'Linha inicial deve ser maior ou igual a 1'),
  col_numero_nota: z.string().min(1, 'Informe a coluna').toUpperCase(),
  col_data_emissao: z.string().min(1, 'Informe a coluna').toUpperCase(),
  col_v_total: z.string().min(1, 'Informe a coluna').toUpperCase(),
  col_base_calculo: z.string().optional(),
  col_ipi_despesas: z.string().optional(),
  col_a_dst: z.string().min(1, 'Informe a coluna').toUpperCase(),
  col_a_ori: z.string().min(1, 'Informe a coluna').toUpperCase(),
  header_cell: z.string().optional(),
  aliquota_format: z.enum(['percent_number', 'decimal']),
  observacoes: z.string().optional(),
  promover_ativo: z.boolean(),
});

type TemplateUploadFormData = z.infer<typeof templateUploadSchema>;

function getDefaultMapping(tipo: TipoPlanilha): TemplateUploadFormData {
  const isAntecipado =
    tipo === 'antecipacao_parcial_antecipado' ||
    tipo === 'antecipacao_parcial_antecipado_simples';
  const isParcial =
    tipo === 'antecipacao_parcial' ||
    tipo === 'antecipacao_parcial_simples';
  const isTributaria = tipo === 'antecipacao_tributaria';
  const isDifal = tipo === 'difal';
  return {
    tipo,
    capacidade_linhas: 100,
    start_row: 4,
    col_numero_nota: 'D',
    col_data_emissao: 'C',
    col_v_total: 'E',
    col_base_calculo: isAntecipado || isTributaria || isParcial ? 'F' : '',
    col_ipi_despesas: isDifal ? 'F' : 'G',
    col_a_dst: isTributaria ? 'J' : isDifal ? 'I' : 'H',
    col_a_ori: isTributaria ? 'K' : isDifal ? 'J' : 'I',
    header_cell: 'A2',
    aliquota_format: 'percent_number',
    observacoes: '',
    promover_ativo: true,
  };
}

export function useAdminTemplatesPage() {
  const queryClient = useQueryClient();
  const [selectedType, setSelectedType] = useState<TipoPlanilha>('antecipacao_parcial');
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const templatesQuery = useTemplatesQuery();
  const templates = templatesQuery.data ?? [];
  const safetyConfigQuery = useQuery({
    queryKey: queryKeys.templateSelectionConfigs,
    queryFn: templatesApi.listarConfiguracoesSelecao,
  });
  const [safetyMarginInput, setSafetyMarginInput] = useState('0');
  const [safetyMarginError, setSafetyMarginError] = useState<string | null>(null);
  const [safetyMarginSaved, setSafetyMarginSaved] = useState(false);

  const form = useForm<TemplateUploadFormData>({
    resolver: zodResolver(templateUploadSchema),
    defaultValues: getDefaultMapping('antecipacao_parcial'),
  });

  useEffect(() => {
    const current = safetyConfigQuery.data?.find((item) => item.tipo === selectedType);
    setSafetyMarginInput(String(current?.margem_seguranca_linhas ?? 0));
    setSafetyMarginError(null);
    setSafetyMarginSaved(false);
  }, [selectedType, safetyConfigQuery.data]);

  const safetyMarginMutation = useMutation({
    mutationFn: ({ tipo, margin }: { tipo: TipoPlanilha; margin: number }) =>
      templatesApi.atualizarConfiguracaoSelecao(tipo, margin),
    onSuccess: async () => {
      setSafetyMarginError(null);
      setSafetyMarginSaved(true);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.templateSelectionConfigs }),
        queryClient.invalidateQueries({ queryKey: queryKeys.templates }),
      ]);
    },
    onError: (error) => {
      setSafetyMarginSaved(false);
      setSafetyMarginError(getErrorMessage(error));
    },
  });

  const saveSafetyMargin = () => {
    const normalized = Number(safetyMarginInput);
    if (!Number.isInteger(normalized) || normalized < 0 || normalized > 100_000) {
      setSafetyMarginSaved(false);
      setSafetyMarginError('Informe um número inteiro entre 0 e 100.000 linhas.');
      return;
    }
    setSafetyMarginError(null);
    setSafetyMarginSaved(false);
    safetyMarginMutation.mutate({ tipo: selectedType, margin: normalized });
  };

  const [promotingId, setPromotingId] = useState<number | null>(null);
  const [promoteError, setPromoteError] = useState<string | null>(null);

  const promoteMutation = useMutation({
    mutationFn: (id: number) => {
      setPromotingId(id);
      return templatesApi.promover(id);
    },
    onSettled: () => setPromotingId(null),
    onSuccess: () => {
      setPromoteError(null);
      return queryClient.invalidateQueries({ queryKey: queryKeys.templates });
    },
    onError: (error) => setPromoteError(getErrorMessage(error)),
  });

  const uploadMutation = useMutation({
    mutationFn: (data: FormData) => templatesApi.upload(data),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.templates });
      setModalOpen(false);
      setSelectedFile(null);
    },
    onError: (error) => setErrorMessage(getErrorMessage(error)),
  });

  const openUploadModal = (tipo: TipoPlanilha = 'antecipacao_parcial') => {
    setErrorMessage(null);
    setSelectedFile(null);
    form.reset(getDefaultMapping(tipo));
    setModalOpen(true);
  };

  const selectFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] || null;
    if (
      file
      && (!file.name.toLowerCase().endsWith('.xlsx')
        || file.size === 0
        || file.size > 20 * 1024 * 1024)
    ) {
      setSelectedFile(null);
      setErrorMessage('Selecione um arquivo .xlsx não vazio, com no máximo 20 MB.');
      event.target.value = '';
      return;
    }
    setSelectedFile(file);
    setErrorMessage(null);
  };

  const uploadTemplate = form.handleSubmit(async (data) => {
    if (!selectedFile) {
      setErrorMessage('Por favor, selecione um arquivo de planilha .xlsx modelo.');
      return;
    }

    const columns: Record<string, string> = {
      numero_nota: data.col_numero_nota.toUpperCase(),
      data_emissao: data.col_data_emissao.toUpperCase(),
      v_total: data.col_v_total.toUpperCase(),
      a_dst: data.col_a_dst.toUpperCase(),
      a_ori: data.col_a_ori.toUpperCase(),
    };
    if (data.col_base_calculo) columns.base_calculo = data.col_base_calculo.toUpperCase();
    if (data.col_ipi_despesas) columns.ipi_despesas = data.col_ipi_despesas.toUpperCase();

    const headerCell = data.header_cell || 'A2';
    const mapping: TemplateMapping = {
      start_row: data.start_row,
      columns,
      header_cell: headerCell,
      extra_options: {
        header_cell: headerCell,
        aliquota_format: data.aliquota_format,
      },
    };
    const payload = new FormData();
    payload.append('tipo', data.tipo);
    payload.append('capacidade_linhas', String(data.capacidade_linhas));
    payload.append('file', selectedFile);
    payload.append('mapeamento_json', JSON.stringify(mapping));
    if (data.observacoes) payload.append('observacoes', data.observacoes);
    payload.append('promover_ativo', String(data.promover_ativo));

    setErrorMessage(null);
    try {
      await uploadMutation.mutateAsync(payload);
    } catch {
      // A mutation mantém o erro visível no modal.
    }
  });

  return {
    templatesQuery,
    templates,
    filteredTemplates: templates.filter((template) => template.tipo === selectedType),
    tiposPlanilha: TIPOS_PLANILHA_OPTIONS,
    selectedType,
    setSelectedType,
    safetyConfigQuery,
    safetyMarginInput,
    setSafetyMarginInput: (value: string) => {
      setSafetyMarginInput(value);
      setSafetyMarginSaved(false);
      setSafetyMarginError(null);
    },
    safetyMarginError,
    safetyMarginSaved,
    saveSafetyMargin,
    isSavingSafetyMargin: safetyMarginMutation.isPending,
    modalOpen,
    closeModal: () => setModalOpen(false),
    errorMessage,
    setErrorMessage,
    openUploadModal,
    selectFile,
    promoteTemplate: promoteMutation.mutate,
    promotingId,
    isPromoting: promotingId !== null,
    promoteError,
    setPromoteError,
    uploadTemplate,
    register: form.register,
    errors: form.formState.errors,
    isUploading: form.formState.isSubmitting || uploadMutation.isPending,
  };
}
