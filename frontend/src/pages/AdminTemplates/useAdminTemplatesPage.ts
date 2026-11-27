import { useEffect, useMemo, useState } from 'react';
import type { ChangeEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { getErrorMessage } from '../../api/client';
import { queryKeys } from '../../api/queryKeys';
import { templatesApi } from '../../api/templates';
import { TIPOS_PLANILHA_OPTIONS } from '../../constants/domain';
import { useEmpresasQuery, useTemplatesQuery } from '../../hooks/useApiQueries';
import { buildTemplateMapping, getDefaultTemplateLayout } from '../../lib/templateMapping';
import type { TemplateXlsx } from '../../types/template';
import type { TipoPlanilha } from '../../types/solicitacao';

export interface Faixa {
  capacidade: number | null;
  oficial: TemplateXlsx | null;
  substituidas: TemplateXlsx[];
}

const templateUploadSchema = z.object({
  tipo: z.enum([
    'antecipacao_parcial',
    'antecipacao_parcial_antecipado',
    'antecipacao_parcial_simples',
    'antecipacao_parcial_antecipado_simples',
    'antecipacao_tributaria',
    'antecipacao_tributaria_antecipado',
    'difal',
    'difal_antecipado',
    'controle_imposto_pago_entrada',
  ]),
  capacidade_linhas: z.number().int().min(1, 'A capacidade deve ser maior ou igual a 1 linha'),
  start_row: z.number().min(1, 'Linha inicial deve ser maior ou igual a 1'),
  col_item_index: z.string().optional(),
  col_numero_nota: z.string().min(1, 'Informe a coluna').toUpperCase(),
  col_data_entrada: z.string().optional(),
  col_data_emissao: z.string().min(1, 'Informe a coluna').toUpperCase(),
  col_v_total: z.string().min(1, 'Informe a coluna').toUpperCase(),
  col_base_calculo: z.string().optional(),
  col_ipi_despesas: z.string().optional(),
  col_mva: z.string().optional(),
  col_reducao: z.string().optional(),
  col_red: z.string().optional(),
  col_aliq_simples: z.string().optional(),
  col_a_dst: z.string().min(1, 'Informe a coluna').toUpperCase(),
  col_a_ori: z.string().min(1, 'Informe a coluna').toUpperCase(),
  header_cell: z.string().optional(),
  aliquota_format: z.enum(['percent_number', 'decimal']),
  observacoes: z.string().optional(),
  promover_ativo: z.boolean(),
}).superRefine((data, ctx) => {
  if (
    ['antecipacao_tributaria', 'antecipacao_tributaria_antecipado'].includes(data.tipo)
    && !data.col_mva?.trim()
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['col_mva'],
      message: 'Informe a coluna do MVA para Antecipação Tributária',
    });
  }
  if (
    ['antecipacao_tributaria', 'antecipacao_tributaria_antecipado'].includes(data.tipo)
    && !data.col_reducao?.trim()
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['col_reducao'],
      message: 'Informe a coluna da Redução para Antecipação Tributária',
    });
  }
});

type TemplateUploadFormData = z.infer<typeof templateUploadSchema>;

function getDefaultMapping(tipo: TipoPlanilha): TemplateUploadFormData {
  return {
    tipo,
    ...getDefaultTemplateLayout(tipo),
    observacoes: '',
    promover_ativo: true,
  };
}

export function useAdminTemplatesPage() {
  const queryClient = useQueryClient();
  const [selectedEmpresaId, setSelectedEmpresaIdState] = useState<number | null>(null);
  const [selectedType, setSelectedType] = useState<TipoPlanilha>('antecipacao_parcial');
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const templatesQuery = useTemplatesQuery();
  const empresasQuery = useEmpresasQuery();
  const templates = useMemo(() => templatesQuery.data ?? [], [templatesQuery.data]);
  const empresas = useMemo(
    () =>
      (empresasQuery.data ?? [])
        .slice()
        .sort((a, b) => a.razao_social.localeCompare(b.razao_social, 'pt-BR')),
    [empresasQuery.data],
  );
  const selectedEmpresa = useMemo(
    () => empresas.find((empresa) => empresa.id === selectedEmpresaId) ?? null,
    [empresas, selectedEmpresaId],
  );
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
  const watchedTipo = form.watch('tipo');

  useEffect(() => {
    if (!modalOpen) return;
    const defaults = getDefaultMapping(watchedTipo);
    form.reset({
      ...defaults,
      observacoes: form.getValues('observacoes'),
      promover_ativo: form.getValues('promover_ativo'),
    });
  }, [watchedTipo, modalOpen, form]);

  const persistedSafetyMargin = safetyConfigQuery.data?.find(
    (item) => item.tipo === selectedType,
  )?.margem_seguranca_linhas;

  /**
   * Só reidrata o campo quando o valor salvo realmente muda. Depender do objeto
   * da query fazia cada refetch — inclusive o disparado pelo próprio salvamento
   * — sobrescrever o que o administrador estava digitando e apagar o aviso de
   * "salvo" no mesmo instante em que ele aparecia.
   */
  useEffect(() => {
    setSafetyMarginInput(String(persistedSafetyMargin ?? 0));
    setSafetyMarginError(null);
  }, [selectedType, persistedSafetyMargin]);

  useEffect(() => {
    setSafetyMarginSaved(false);
  }, [selectedType]);

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
  const [deactivatingId, setDeactivatingId] = useState<number | null>(null);
  const [deactivateError, setDeactivateError] = useState<string | null>(null);

  const setSelectedEmpresaId = (empresaId: number | null) => {
    setSelectedEmpresaIdState(empresaId);
    setPromoteError(null);
    setDeactivateError(null);
  };

  const promoteMutation = useMutation({
    mutationFn: (id: number) => {
      setPromotingId(id);
      return templatesApi.promover(id);
    },
    onSettled: () => setPromotingId(null),
    onSuccess: async () => {
      setPromoteError(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.templates }),
        queryClient.invalidateQueries({ queryKey: queryKeys.templatesAtivos }),
      ]);
    },
    onError: (error) => setPromoteError(getErrorMessage(error)),
  });

  const deactivateMutation = useMutation({
    mutationFn: (id: number) => {
      setDeactivatingId(id);
      return templatesApi.desativar(id);
    },
    onSettled: () => setDeactivatingId(null),
    onSuccess: async () => {
      setDeactivateError(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.templates }),
        queryClient.invalidateQueries({ queryKey: queryKeys.templatesAtivos }),
      ]);
    },
    onError: (error) => setDeactivateError(getErrorMessage(error)),
  });

  const uploadMutation = useMutation({
    mutationFn: (data: FormData) => templatesApi.upload(data),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.templates }),
        queryClient.invalidateQueries({ queryKey: queryKeys.templatesAtivos }),
      ]);
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

    const mapping = buildTemplateMapping(data.tipo, data);
    const payload = new FormData();
    payload.append('tipo', data.tipo);
    payload.append('capacidade_linhas', String(data.capacidade_linhas));
    if (selectedEmpresaId !== null) {
      payload.append('empresa_id', String(selectedEmpresaId));
    }
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

  const templatesByScope = useMemo(
    () =>
      templates.filter((template) =>
        selectedEmpresaId === null
          ? template.empresa_id == null
          : template.empresa_id === selectedEmpresaId,
      ),
    [templates, selectedEmpresaId],
  );

  const filteredTemplates = useMemo(
    () => templatesByScope.filter((template) => template.tipo === selectedType),
    [templatesByScope, selectedType],
  );

  // O motor escolhe o menor modelo cuja capacidade cobre (linhas reais + margem).
  // A página só é legível se as capacidades aparecerem como uma escada.
  const faixas = useMemo<Faixa[]>(() => {
    const porCapacidade = new Map<number | null, TemplateXlsx[]>();
    for (const template of filteredTemplates) {
      const chave = template.capacidade_linhas ?? null;
      const atual = porCapacidade.get(chave);
      if (atual) atual.push(template);
      else porCapacidade.set(chave, [template]);
    }
    return [...porCapacidade.entries()]
      .map(([capacidade, versoes]) => {
        const ordenadas = [...versoes].sort((a, b) => b.versao - a.versao);
        return {
          capacidade,
          oficial: ordenadas.find((t) => t.ativo) ?? null,
          substituidas: ordenadas.filter((t) => !t.ativo),
        };
      })
      .sort((a, b) => {
        // Modelos legados (sem capacidade declarada) ficam no fim da escada.
        if (a.capacidade === null) return 1;
        if (b.capacidade === null) return -1;
        return a.capacidade - b.capacidade;
      });
  }, [filteredTemplates]);

  return {
    templatesQuery,
    empresasQuery,
    empresas,
    selectedEmpresaId,
    setSelectedEmpresaId,
    selectedEmpresa,
    templates,
    templatesByScope,
    filteredTemplates,
    faixas,
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
    selectedFile,
    promoteTemplate: promoteMutation.mutate,
    promotingId,
    isPromoting: promotingId !== null,
    promoteError,
    setPromoteError,
    deactivateTemplate: deactivateMutation.mutate,
    deactivatingId,
    isDeactivating: deactivatingId !== null,
    deactivateError,
    setDeactivateError,
    uploadTemplate,
    register: form.register,
    watch: form.watch,
    errors: form.formState.errors,
    isUploading: form.formState.isSubmitting || uploadMutation.isPending,
  };
}
