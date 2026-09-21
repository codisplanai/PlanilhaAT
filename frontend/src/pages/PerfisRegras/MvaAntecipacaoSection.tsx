import React, { useEffect, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  CheckCircle2,
  Plus,
  Save,
  ShieldCheck,
  Tags,
  X,
} from 'lucide-react';

import { getErrorMessage } from '../../api/client';
import { perfisApi } from '../../api/perfis';
import { queryKeys } from '../../api/queryKeys';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import { ErrorAlert } from '../../components/feedback/ErrorAlert';
import type {
  MvaAntecipacaoTributariaConfig,
  MvaGrupoConfig,
  PerfilRegras,
} from '../../types/perfil';

interface Props {
  perfil: PerfilRegras;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const cloneConfig = (
  config: MvaAntecipacaoTributariaConfig,
): MvaAntecipacaoTributariaConfig => ({
  ...config,
  special_ncms: [...(config.special_ncms || [])],
  description_fallback_ncms: [...(config.description_fallback_ncms || [])],
  special_keywords: [...(config.special_keywords || [])],
  exclusion_keywords: [...(config.exclusion_keywords || [])],
  mvas: {
    especial: { ...config.mvas.especial },
    demais: { ...config.mvas.demais },
  },
});

const formatCnpj = (value: string) => {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length !== 14) return value || 'Não informado';
  return digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
};

const parsePercent = (value: string): number | null => {
  const parsed = Number(String(value).replace(',', '.'));
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 500) return null;
  return parsed;
};

const normalizePercent = (value: string) => {
  const parsed = parsePercent(value);
  return parsed === null ? value : parsed.toFixed(2);
};

interface TokenEditorProps {
  label: string;
  helperText?: string;
  values: string[];
  onChange: (values: string[]) => void;
  numeric?: boolean;
  disabled?: boolean;
}

const TokenEditor: React.FC<TokenEditorProps> = ({
  label,
  helperText,
  values,
  onChange,
  numeric = false,
  disabled = false,
}) => {
  const [inputValue, setInputValue] = useState('');

  const addValue = () => {
    const candidate = numeric
      ? inputValue.replace(/\D/g, '')
      : inputValue.trim().toUpperCase();
    if (!candidate) return;
    if (numeric && candidate.length !== 8) return;
    if (!values.includes(candidate)) onChange([...values, candidate]);
    setInputValue('');
  };

  return (
    <div className="space-y-2">
      <div>
        <div className="text-xs font-semibold text-slate-800">{label}</div>
        {helperText && <p className="text-[11px] text-slate-500 mt-0.5">{helperText}</p>}
      </div>

      <div className="flex flex-wrap gap-1.5 min-h-8">
        {values.length > 0 ? (
          values.map((value) => (
            <span
              key={value}
              className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2 py-1 font-mono text-[11px] text-slate-700"
            >
              {value}
              {!disabled && (
                <button
                  type="button"
                  onClick={() => onChange(values.filter((item) => item !== value))}
                  className="rounded p-0.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-600"
                  aria-label={`Remover ${value}`}
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </span>
          ))
        ) : (
          <span className="text-xs text-slate-400 italic">Nenhum item configurado</span>
        )}
      </div>

      {!disabled && (
        <div className="flex gap-2">
          <input
            value={inputValue}
            onChange={(event) =>
              setInputValue(numeric ? event.target.value.replace(/\D/g, '').slice(0, 8) : event.target.value)
            }
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                addValue();
              }
            }}
            placeholder={numeric ? 'NCM com 8 dígitos' : 'Digite um termo'}
            className="min-w-0 flex-1 h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20"
            inputMode={numeric ? 'numeric' : undefined}
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={addValue}
            disabled={!inputValue.trim() || (numeric && inputValue.replace(/\D/g, '').length !== 8)}
            leftIcon={<Plus className="w-3.5 h-3.5" />}
          >
            Adicionar
          </Button>
        </div>
      )}
    </div>
  );
};

const MvaRow: React.FC<{
  label: string;
  values: MvaGrupoConfig;
  onChange: (key: keyof MvaGrupoConfig, value: string) => void;
  disabled?: boolean;
}> = ({ label, values, onChange, disabled }) => (
  <tr className="border-t border-slate-100">
    <td className="py-3 pr-3 text-xs font-semibold text-slate-800">{label}</td>
    {(['4', '7', '12', 'original'] as const).map((key) => (
      <td key={key} className="py-2 px-1.5">
        <div className="relative min-w-20">
          <input
            type="text"
            inputMode="decimal"
            value={values[key]}
            disabled={disabled}
            onChange={(event) => onChange(key, event.target.value)}
            onBlur={(event) => onChange(key, normalizePercent(event.target.value))}
            className="h-9 w-full rounded-lg border border-slate-300 bg-white px-2.5 pr-7 text-right text-sm tabular-nums text-slate-900 outline-none transition focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20 disabled:bg-slate-100 disabled:text-slate-500"
            aria-label={`${label} - MVA ${key === 'original' ? 'original' : `${key}%`}`}
          />
          <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-slate-400">%</span>
        </div>
      </td>
    ))}
  </tr>
);

export const MvaAntecipacaoSection: React.FC<Props> = ({ perfil, open, onOpenChange }) => {
  const queryClient = useQueryClient();
  const config = perfil.configuracoes_extras?.mva_revenda_antecipacao_tributaria;

  const [draft, setDraft] = useState<MvaAntecipacaoTributariaConfig | null>(
    config ? cloneConfig(config) : null,
  );
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setDraft(config ? cloneConfig(config) : null);
    setError(null);
    setSaved(false);
  }, [perfil.id, config]);

  const dirty = useMemo(() => {
    if (!config || !draft) return false;
    return JSON.stringify(config) !== JSON.stringify(draft);
  }, [config, draft]);

  const validationError = useMemo(() => {
    if (!draft) return null;
    const cnpj = String(draft.empresa_cnpj || '').replace(/\D/g, '');
    if (cnpj.length !== 14) return 'O CNPJ autorizado precisa ter 14 dígitos.';

    for (const ncm of [...draft.special_ncms, ...draft.description_fallback_ncms]) {
      if (!/^\d{8}$/.test(ncm)) return `NCM inválido: ${ncm}. Use exatamente 8 dígitos.`;
    }

    for (const group of [draft.mvas.especial, draft.mvas.demais]) {
      for (const key of ['4', '7', '12', 'original'] as const) {
        if (parsePercent(group[key]) === null) {
          return 'Todos os MVAs devem ser percentuais válidos entre 0% e 500%.';
        }
      }
    }
    return null;
  }, [draft]);

  const saveMutation = useMutation({
    mutationFn: async (payload: MvaAntecipacaoTributariaConfig) =>
      perfisApi.atualizar(perfil.id, {
        configuracoes_extras: {
          ...(perfil.configuracoes_extras || {}),
          mva_revenda_antecipacao_tributaria: payload,
        },
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.perfis });
      setSaved(true);
      setError(null);
      window.setTimeout(() => setSaved(false), 3000);
    },
    onError: (err) => {
      setSaved(false);
      setError(getErrorMessage(err));
    },
  });

  const updateMva = (
    grupo: 'especial' | 'demais',
    key: keyof MvaGrupoConfig,
    value: string,
  ) => {
    setSaved(false);
    setDraft((current) => {
      if (!current) return current;
      return {
        ...current,
        mvas: {
          ...current.mvas,
          [grupo]: {
            ...current.mvas[grupo],
            [key]: value,
          },
        },
      };
    });
  };

  const summary = config ? (
    <div className="flex items-center gap-2">
      <Badge variant={config.enabled ? 'success' : 'neutral'} size="sm">
        {config.enabled ? 'Ativo' : 'Inativo'}
      </Badge>
      <span className="hidden sm:inline">
        {config.special_ncms.length} NCMs especiais
      </span>
    </div>
  ) : (
    <Badge variant="neutral" size="sm">Não configurado</Badge>
  );

  return (
    <Card
      collapsible
      open={open}
      onOpenChange={onOpenChange}
      title="MVA / Antecipação Tributária"
      subtitle="Parâmetros especiais de classificação e MVA vinculados a este perfil."
      summary={summary}
    >
      {!draft ? (
        <div className="flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs text-slate-600">
          <ShieldCheck className="w-4 h-4 mt-0.5 shrink-0 text-slate-500" />
          <div>
            <div className="font-semibold text-slate-800">Nenhuma regra especial de MVA neste perfil</div>
            <p className="mt-1 leading-relaxed">
              A seção permanece visível apenas para conferência. Para proteger os demais cadastros,
              uma política especial não é criada automaticamente em perfis que não possuem essa configuração.
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-5">
          {error && <ErrorAlert message={error} onDismiss={() => setError(null)} />}

          <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <ShieldCheck className="w-4 h-4 text-blue-700" />
                  <span className="text-sm font-bold text-slate-900">Aplicação da regra</span>
                  <Badge variant={draft.enabled ? 'success' : 'neutral'} size="sm">
                    {draft.enabled ? 'Habilitada' : 'Desabilitada'}
                  </Badge>
                </div>
                <p className="mt-1 text-xs leading-relaxed text-slate-500">
                  Vínculo protegido pelo CNPJ autorizado. Alterar os parâmetros abaixo não modifica
                  as regras das demais empresas.
                </p>
                <div className="mt-3 text-xs text-slate-600">
                  <span className="font-semibold text-slate-800">CNPJ autorizado:</span>{' '}
                  <span className="font-mono">{formatCnpj(draft.empresa_cnpj)}</span>
                </div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={draft.enabled}
                onClick={() => {
                  setSaved(false);
                  setDraft((current) => current ? { ...current, enabled: !current.enabled } : current);
                }}
                className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2 ${
                  draft.enabled ? 'bg-blue-600' : 'bg-slate-300'
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${
                    draft.enabled ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-5">
            <div className="rounded-xl border border-slate-200 p-4 space-y-5">
              <div className="flex items-center gap-2">
                <Tags className="w-4 h-4 text-slate-500" />
                <div>
                  <div className="text-sm font-bold text-slate-900">Classificação dos produtos</div>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    NCM exato é o critério principal; fallback por descrição é usado apenas nos NCMs amplos cadastrados.
                  </p>
                </div>
              </div>

              <TokenEditor
                label="NCMs do grupo especial"
                helperText="Bolsas, cintos, calçados e carteiras reconhecidos diretamente pelo NCM."
                values={draft.special_ncms}
                numeric
                onChange={(values) => {
                  setSaved(false);
                  setDraft({ ...draft, special_ncms: values });
                }}
              />

              <TokenEditor
                label="NCMs que exigem confirmação pela descrição"
                helperText="O NCM sozinho não ativa o grupo especial; a descrição também precisa corresponder."
                values={draft.description_fallback_ncms}
                numeric
                onChange={(values) => {
                  setSaved(false);
                  setDraft({ ...draft, description_fallback_ncms: values });
                }}
              />

              <TokenEditor
                label="Palavras que confirmam o fallback"
                values={draft.special_keywords}
                onChange={(values) => {
                  setSaved(false);
                  setDraft({ ...draft, special_keywords: values });
                }}
              />

              <TokenEditor
                label="Palavras de exclusão do grupo especial"
                helperText="Itens com essas descrições permanecem no grupo 'demais produtos'."
                values={draft.exclusion_keywords}
                onChange={(values) => {
                  setSaved(false);
                  setDraft({ ...draft, exclusion_keywords: values });
                }}
              />
            </div>

            <div className="rounded-xl border border-slate-200 overflow-hidden">
              <div className="px-4 py-3 bg-slate-50/70 border-b border-slate-100">
                <div className="text-sm font-bold text-slate-900">Tabela de MVA</div>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Fornecedor do Simples Nacional utiliza o MVA Original do respectivo grupo.
                </p>
              </div>
              <div className="overflow-x-auto px-4 pb-3">
                <table className="w-full min-w-[620px]">
                  <thead>
                    <tr className="text-[10px] uppercase tracking-wider text-slate-500">
                      <th className="py-3 pr-3 text-left">Grupo</th>
                      <th className="py-3 px-1.5 text-center">Origem 4%</th>
                      <th className="py-3 px-1.5 text-center">Origem 7%</th>
                      <th className="py-3 px-1.5 text-center">Origem 12%</th>
                      <th className="py-3 px-1.5 text-center">MVA original</th>
                    </tr>
                  </thead>
                  <tbody>
                    <MvaRow
                      label="Bolsas, cintos, calçados e carteiras"
                      values={draft.mvas.especial}
                      onChange={(key, value) => updateMva('especial', key, value)}
                    />
                    <MvaRow
                      label="Demais produtos"
                      values={draft.mvas.demais}
                      onChange={(key, value) => updateMva('demais', key, value)}
                    />
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {validationError && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-900">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{validationError}</span>
            </div>
          )}

          <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-3 border-t border-slate-100 pt-4">
            <div className="text-xs">
              {saved ? (
                <span className="inline-flex items-center gap-1.5 font-semibold text-emerald-700">
                  <CheckCircle2 className="w-4 h-4" />
                  Alterações salvas
                </span>
              ) : dirty ? (
                <span className="text-amber-700 font-medium">Há alterações não salvas nesta seção.</span>
              ) : (
                <span className="text-slate-400">Configuração sincronizada.</span>
              )}
            </div>
            <div className="flex items-center gap-2 justify-end">
              <Button
                type="button"
                variant="outline"
                disabled={!dirty || saveMutation.isPending}
                onClick={() => {
                  setDraft(cloneConfig(config));
                  setSaved(false);
                  setError(null);
                }}
              >
                Descartar
              </Button>
              <Button
                type="button"
                disabled={!dirty || Boolean(validationError)}
                isLoading={saveMutation.isPending}
                onClick={() => {
                  if (!draft || validationError) return;
                  const normalized: MvaAntecipacaoTributariaConfig = {
                    ...draft,
                    empresa_cnpj: String(draft.empresa_cnpj).replace(/\D/g, ''),
                    special_ncms: Array.from(new Set(draft.special_ncms)),
                    description_fallback_ncms: Array.from(new Set(draft.description_fallback_ncms)),
                    special_keywords: Array.from(new Set(draft.special_keywords.map((item) => item.trim().toUpperCase()).filter(Boolean))),
                    exclusion_keywords: Array.from(new Set(draft.exclusion_keywords.map((item) => item.trim().toUpperCase()).filter(Boolean))),
                    mvas: {
                      especial: {
                        '4': normalizePercent(draft.mvas.especial['4']),
                        '7': normalizePercent(draft.mvas.especial['7']),
                        '12': normalizePercent(draft.mvas.especial['12']),
                        original: normalizePercent(draft.mvas.especial.original),
                      },
                      demais: {
                        '4': normalizePercent(draft.mvas.demais['4']),
                        '7': normalizePercent(draft.mvas.demais['7']),
                        '12': normalizePercent(draft.mvas.demais['12']),
                        original: normalizePercent(draft.mvas.demais.original),
                      },
                    },
                  };
                  saveMutation.mutate(normalized);
                }}
                leftIcon={<Save className="w-4 h-4" />}
              >
                Salvar alterações
              </Button>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
};
