import React, { useEffect, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, BookOpen, Plus, Save, ShieldCheck, Trash2 } from 'lucide-react';

import { getErrorMessage } from '../../api/client';
import { perfisApi } from '../../api/perfis';
import { queryKeys } from '../../api/queryKeys';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { ErrorAlert } from '../../components/feedback/ErrorAlert';
import type { Convenio5291Adjustment, Convenio5291Config, PerfilRegras } from '../../types/perfil';

interface Props {
  perfil: PerfilRegras;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const DEFAULT_CONFIG: Convenio5291Config = {
  enabled: true,
  aplicar_automaticamente_seguros: true,
  solicitar_confirmacao_duvidosos: true,
  considerar_cst20_como_indicio: true,
  ajustes: [],
};

function clone(config: Convenio5291Config): Convenio5291Config {
  return { ...config, ajustes: (config.ajustes ?? []).map((item) => ({ ...item, termos_descricao: [...(item.termos_descricao ?? [])] })) };
}

const newId = () => `ajuste-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

export const Convenio5291Section: React.FC<Props> = ({ perfil, open, onOpenChange }) => {
  const queryClient = useQueryClient();
  const config = perfil.configuracoes_extras?.convenio_icms_52_91_anexo_i;
  const [draft, setDraft] = useState<Convenio5291Config>(clone(config ?? { ...DEFAULT_CONFIG, enabled: false }));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(clone(config ?? { ...DEFAULT_CONFIG, enabled: false }));
    setError(null);
  }, [perfil.id, config]);

  const dirty = useMemo(() => JSON.stringify(config ?? { ...DEFAULT_CONFIG, enabled: false }) !== JSON.stringify(draft), [config, draft]);
  const invalid = draft.ajustes.some((item) => !/^\d{8}$/.test(String(item.ncm || '').replace(/\D/g, '')));

  const saveMutation = useMutation({
    mutationFn: (payload: Convenio5291Config) => perfisApi.atualizar(perfil.id, {
      configuracoes_extras: {
        ...(perfil.configuracoes_extras || {}),
        convenio_icms_52_91_anexo_i: payload,
      },
    }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.perfis });
      setError(null);
    },
    onError: (err) => setError(getErrorMessage(err)),
  });

  const updateAdjustment = (id: string, patch: Partial<Convenio5291Adjustment>) => {
    setDraft((current) => ({
      ...current,
      ajustes: current.ajustes.map((item) => item.id === id ? { ...item, ...patch } : item),
    }));
  };

  return (
    <Card
      collapsible
      open={open}
      onOpenChange={onOpenChange}
      title="Convênio ICMS 52/91 — Anexo I"
      subtitle="Redução de base para máquinas, aparelhos e equipamentos industriais, com catálogo legal central e ajustes por perfil."
      summary={
        <div className="flex items-center gap-2">
          <Badge variant={draft.enabled ? 'success' : 'neutral'} size="sm">{draft.enabled ? 'Ativo' : 'Inativo'}</Badge>
          <span>{draft.ajustes.length} ajuste(s)</span>
        </div>
      }
    >
      <div className="space-y-5">
        {error && <ErrorAlert message={error} onDismiss={() => setError(null)} />}

        <div className="flex flex-col gap-4 rounded-xl border border-blue-200 bg-blue-50/50 p-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex gap-3">
            <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-blue-700" />
            <div>
              <p className="text-sm font-bold text-slate-900">Aplicação da regra</p>
              <p className="mt-1 max-w-2xl text-xs leading-relaxed text-slate-600">
                Itens seguros são aplicados automaticamente. Itens ambíguos pausam o processamento para confirmação do usuário; CST X20 e pRedBC aparecem como indícios, nunca como prova isolada.
              </p>
              <div className="mt-3 grid gap-1 text-[11px] text-slate-600 sm:grid-cols-2">
                <span>A.DEST Bahia: <strong>8,80%</strong></span>
                <span>A.ORIG Sul/Sudeste exceto ES: <strong>5,14%</strong></span>
                <span>Demais origens interestaduais: <strong>8,80%</strong></span>
                <span>Operação 4%: <strong>revisão manual</strong></span>
              </div>
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={draft.enabled}
            onClick={() => setDraft((current) => ({ ...current, enabled: !current.enabled }))}
            className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2 ${draft.enabled ? 'bg-blue-600' : 'bg-slate-300'}`}
          >
            <span className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${draft.enabled ? 'translate-x-5' : 'translate-x-0'}`} />
          </button>
        </div>

        <div className="rounded-xl border border-slate-200 p-4">
          <div className="flex items-start gap-3">
            <BookOpen className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
            <div>
              <p className="text-xs font-bold text-slate-800">Catálogo fiscal central</p>
              <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
                A relação legal não é apagada por ajustes do perfil. Alterações abaixo apenas sobrescrevem o comportamento operacional para NCM/descrição e vigência informadas.
              </p>
              <a
                href="https://www.confaz.fazenda.gov.br/legislacao/convenios/1991/CV052_91"
                target="_blank"
                rel="noreferrer"
                className="mt-2 inline-flex text-[11px] font-semibold text-blue-700 hover:underline"
              >
                Consultar Convênio consolidado no CONFAZ
              </a>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 bg-slate-50/60 px-4 py-3">
            <div>
              <p className="text-sm font-bold text-slate-900">Ajustes do catálogo</p>
              <p className="text-[11px] text-slate-500">O ajuste mais específico do perfil prevalece sobre o comportamento padrão do catálogo.</p>
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              leftIcon={<Plus className="h-3.5 w-3.5" />}
              onClick={() => setDraft((current) => ({
                ...current,
                ajustes: [...current.ajustes, {
                  id: newId(),
                  ncm: '',
                  acao: 'revisar',
                  termos_descricao: [],
                  vigencia_inicio: null,
                  vigencia_fim: null,
                  motivo: '',
                }],
              }))}
            >
              Adicionar ajuste
            </Button>
          </div>

          {draft.ajustes.length === 0 ? (
            <p className="p-4 text-xs italic text-slate-400">Nenhum ajuste: vale exclusivamente o catálogo central.</p>
          ) : (
            <div className="divide-y divide-slate-100">
              {draft.ajustes.map((item) => (
                <div key={item.id} className="grid gap-3 p-4 lg:grid-cols-12">
                  <div className="lg:col-span-2">
                    <label className="text-[10px] font-bold uppercase text-slate-500">NCM</label>
                    <input
                      value={item.ncm}
                      inputMode="numeric"
                      maxLength={8}
                      onChange={(event) => updateAdjustment(item.id, { ncm: event.target.value.replace(/\D/g, '').slice(0, 8) })}
                      className="mt-1 h-9 w-full rounded-lg border border-slate-300 px-2.5 font-mono text-xs"
                      placeholder="8 dígitos"
                    />
                  </div>
                  <div className="lg:col-span-2">
                    <label className="text-[10px] font-bold uppercase text-slate-500">Ação</label>
                    <select
                      value={item.acao}
                      onChange={(event) => updateAdjustment(item.id, { acao: event.target.value as Convenio5291Adjustment['acao'] })}
                      className="mt-1 h-9 w-full rounded-lg border border-slate-300 bg-white px-2 text-xs"
                    >
                      <option value="automatico">Automático</option>
                      <option value="revisar">Sempre revisar</option>
                      <option value="nao_aplicar">Não aplicar</option>
                    </select>
                  </div>
                  <div className="lg:col-span-3">
                    <label className="text-[10px] font-bold uppercase text-slate-500">Descrição contém</label>
                    <input
                      value={(item.termos_descricao ?? []).join(', ')}
                      onChange={(event) => updateAdjustment(item.id, {
                        termos_descricao: event.target.value.split(',').map((term) => term.trim().toUpperCase()).filter(Boolean),
                      })}
                      className="mt-1 h-9 w-full rounded-lg border border-slate-300 px-2.5 text-xs"
                      placeholder="Opcional · termos separados por vírgula"
                    />
                  </div>
                  <div className="lg:col-span-2">
                    <label className="text-[10px] font-bold uppercase text-slate-500">Início</label>
                    <input type="date" value={item.vigencia_inicio ?? ''} onChange={(event) => updateAdjustment(item.id, { vigencia_inicio: event.target.value || null })} className="mt-1 h-9 w-full rounded-lg border border-slate-300 px-2 text-xs" />
                  </div>
                  <div className="lg:col-span-2">
                    <label className="text-[10px] font-bold uppercase text-slate-500">Fim</label>
                    <input type="date" value={item.vigencia_fim ?? ''} onChange={(event) => updateAdjustment(item.id, { vigencia_fim: event.target.value || null })} className="mt-1 h-9 w-full rounded-lg border border-slate-300 px-2 text-xs" />
                  </div>
                  <div className="flex items-end justify-end lg:col-span-1">
                    <button
                      type="button"
                      onClick={() => setDraft((current) => ({ ...current, ajustes: current.ajustes.filter((candidate) => candidate.id !== item.id) }))}
                      className="rounded-lg p-2 text-slate-400 hover:bg-rose-50 hover:text-rose-700"
                      title="Excluir ajuste"
                      aria-label="Excluir ajuste"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="lg:col-span-12">
                    <input
                      value={item.motivo ?? ''}
                      onChange={(event) => updateAdjustment(item.id, { motivo: event.target.value })}
                      className="h-9 w-full rounded-lg border border-slate-300 px-2.5 text-xs"
                      placeholder="Motivo/observação do ajuste (recomendado)"
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {invalid && (
          <div className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            Todo ajuste deve informar NCM com exatamente 8 dígitos.
          </div>
        )}

        <div className="flex items-center justify-end gap-2 border-t border-slate-100 pt-4">
          <Button type="button" variant="outline" disabled={!dirty || saveMutation.isPending} onClick={() => setDraft(clone(config ?? { ...DEFAULT_CONFIG, enabled: false }))}>
            Descartar
          </Button>
          <Button
            type="button"
            disabled={!dirty || invalid}
            isLoading={saveMutation.isPending}
            leftIcon={<Save className="h-4 w-4" />}
            onClick={() => saveMutation.mutate({
              ...draft,
              ajustes: draft.ajustes.map((item) => ({
                ...item,
                ncm: item.ncm.replace(/\D/g, ''),
                termos_descricao: Array.from(new Set((item.termos_descricao ?? []).map((term) => term.trim().toUpperCase()).filter(Boolean))),
              })),
            })}
          >
            Salvar alterações
          </Button>
        </div>
      </div>
    </Card>
  );
};
