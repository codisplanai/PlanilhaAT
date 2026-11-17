import React from 'react';
import { Check, Edit2, Percent, Plus, Trash2, Zap } from 'lucide-react';

import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { LoadingSpinner } from '../../components/feedback/LoadingSpinner';
import { SectionEmpty } from '../../components/feedback/SectionEmpty';
import { formatPercent } from '../../lib/formatters';
import type { RegraAliquota } from '../../types/regra';
import { CopiarRegrasButton } from './CopiarRegrasButton';

export type ToggleFeedbackState = 'idle' | 'saving' | 'saved' | 'error';

/** Nível de precedência da regra, na mesma numeração do quadro do topo. */
export const NivelMarker: React.FC<{ nivel: string; descricao: string }> = ({ nivel, descricao }) => (
  <span
    title={descricao}
    className="inline-flex h-5 min-w-[1.375rem] items-center justify-center rounded-md bg-slate-900 px-1.5 font-mono text-[10px] font-bold tabular-nums text-white"
  >
    {nivel}
  </span>
);

interface PolicySwitchCardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  subtitle: string;
  checked: boolean;
  activeLabel?: string;
  description: React.ReactNode;
  feedback: ToggleFeedbackState;
  error: string | null;
  disabled: boolean;
  onToggle: () => void;
}

export const PolicySwitchCard: React.FC<PolicySwitchCardProps> = ({
  open,
  onOpenChange,
  title,
  subtitle,
  checked,
  activeLabel = 'Ativo',
  description,
  feedback,
  error,
  disabled,
  onToggle,
}) => (
  <Card
    collapsible
    open={open}
    onOpenChange={onOpenChange}
    title={title}
    subtitle={subtitle}
    summary={
      checked
        ? <Badge variant="success" size="sm">{activeLabel}</Badge>
        : <Badge variant="neutral" size="sm">Inativo</Badge>
    }
  >
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
      <div className="space-y-2 min-w-0">
        <p className="text-xs text-slate-500 leading-relaxed max-w-2xl">{description}</p>
        <div className="min-h-4">
          {feedback === 'saving' && (
            <span className="text-[11px] text-blue-600 font-semibold animate-pulse">Salvando...</span>
          )}
          {feedback === 'saved' && (
            <span className="text-[11px] text-emerald-600 font-semibold inline-flex items-center gap-1">
              <Check className="w-3 h-3" /> Salvo
            </span>
          )}
          {feedback === 'error' && (
            <span className="text-[11px] text-rose-600 font-semibold">
              {error || 'Erro ao salvar'}
            </span>
          )}
        </div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={onToggle}
        className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2 ${
          checked ? 'bg-blue-600' : 'bg-slate-200'
        } ${disabled ? 'opacity-60 cursor-not-allowed' : ''}`}
      >
        <span
          className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-md ring-0 transition duration-200 ease-in-out ${
            checked ? 'translate-x-5' : 'translate-x-0'
          }`}
        />
      </button>
    </div>
  </Card>
);

interface ExcecoesNcmCardProps {
  perfilId: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isLoading: boolean;
  regras: RegraAliquota[];
  onCreate: () => void;
  onEdit: (regra: RegraAliquota) => void;
  onDelete: (regra: RegraAliquota) => void;
}

export const ExcecoesNcmCard: React.FC<ExcecoesNcmCardProps> = ({
  perfilId,
  open,
  onOpenChange,
  isLoading,
  regras,
  onCreate,
  onEdit,
  onDelete,
}) => (
  <Card
    collapsible
    open={open}
    onOpenChange={onOpenChange}
    summary={<span>{regras.length} exceção(ões)</span>}
    bodyPadding="none"
    marker={<NivelMarker nivel="3a" descricao="Nível 3a: exceção por NCM, vence a alíquota base da UF" />}
    title="Exceções Tributárias por NCM"
    subtitle="Sobrescreve a alíquota padrão do estado. É superada pelas reduções por produto e pelo termo de acordo da empresa."
    headerAction={
      <>
        <CopiarRegrasButton
          perfilId={perfilId}
          secao="aliquotas"
          regraIds={regras.map((r) => r.id)}
          label="Copiar para..."
          descricao="Copia todas as exceções de NCM listadas."
        />
        <Button
          size="sm"
          className="bg-purple-700 hover:bg-purple-800 focus:ring-purple-700 text-white shadow-xs shadow-purple-700/20"
          onClick={onCreate}
          leftIcon={<Plus className="w-3.5 h-3.5" />}
        >
          Nova Exceção NCM
        </Button>
      </>
    }
  >
    {isLoading ? (
      <div className="p-5">
        <LoadingSpinner size="sm" message="Carregando exceções..." />
      </div>
    ) : regras.length === 0 ? (
      <div className="p-5">
        <SectionEmpty
          icon={<Zap className="h-6 w-6" />}
          title="Nenhuma exceção por NCM"
          hint="Os itens seguem a alíquota padrão da UF até que uma exceção seja cadastrada."
          className="border-purple-200/80 bg-purple-50/20"
          action={
            <Button
              size="sm"
              variant="outline"
              onClick={onCreate}
              leftIcon={<Plus className="w-3.5 h-3.5" />}
            >
              Cadastrar exceção por NCM
            </Button>
          }
        />
      </div>
    ) : (
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs divide-y divide-purple-100/60">
          <thead className="bg-purple-50/50 text-purple-900 font-bold uppercase tracking-wider text-[10px]">
            <tr>
              <th className="py-3 px-4">Estado</th>
              <th className="py-3 px-4 font-mono">NCM (8 dígitos)</th>
              <th className="py-3 px-4">Precedência</th>
              <th className="py-3 px-4 font-mono text-right">A.DST Específica</th>
              <th className="py-3 px-4">Descrição da Exceção</th>
              <th className="py-3 px-4 text-right">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-purple-100/40">
            {regras.map((regra) => (
              <tr key={regra.id} className="hover:bg-purple-50/30 transition-colors">
                <td className="py-3 px-4 font-bold text-slate-800">{regra.uf}</td>
                <td className="py-3 px-4 font-mono font-bold text-purple-900">{regra.ncm}</td>
                <td className="py-3 px-4">
                  <Badge variant="purple" size="sm">
                    <Zap className="w-3 h-3 text-purple-600 shrink-0" />
                    <span>Exceção Prioritária</span>
                  </Badge>
                </td>
                <td className="py-3 px-4 font-mono font-bold text-purple-950 text-right tabular-nums">
                  {formatPercent(regra.aliquota)}
                </td>
                <td className="py-3 px-4 text-slate-600">{regra.descricao || '-'}</td>
                <td className="py-3 px-4 text-right">
                  <div className="flex items-center justify-end gap-1">
                    <CopiarRegrasButton
                      perfilId={perfilId}
                      secao="aliquotas"
                      regraIds={[regra.id]}
                      descricao="Copia esta exceção de NCM."
                    />
                    <button
                      type="button"
                      onClick={() => onEdit(regra)}
                      className="p-1.5 text-slate-400 hover:text-purple-800 hover:bg-purple-50 rounded-lg transition-colors cursor-pointer"
                      title="Editar exceção"
                      aria-label={`Editar exceção NCM ${regra.ncm}`}
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onDelete(regra)}
                      className="p-1.5 text-slate-400 hover:text-rose-700 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
                      title="Remover exceção"
                      aria-label={`Remover exceção NCM ${regra.ncm}`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )}
  </Card>
);

interface AliquotasPadraoCardProps {
  perfilId: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isLoading: boolean;
  regras: RegraAliquota[];
  onCreate: () => void;
  onEdit: (regra: RegraAliquota) => void;
  onDelete: (regra: RegraAliquota) => void;
}

export const AliquotasPadraoCard: React.FC<AliquotasPadraoCardProps> = ({
  perfilId,
  open,
  onOpenChange,
  isLoading,
  regras,
  onCreate,
  onEdit,
  onDelete,
}) => (
  <Card
    collapsible
    open={open}
    onOpenChange={onOpenChange}
    summary={<span>{regras.length} regra(s)</span>}
    bodyPadding="none"
    marker={<NivelMarker nivel="3b" descricao="Nível 3b: alíquota base da UF" />}
    title="Alíquotas Padrão por Estado"
    subtitle="Alíquota base do estado. Vale quando não há redução por produto, termo de acordo nem exceção de NCM."
    headerAction={
      <>
        <CopiarRegrasButton
          perfilId={perfilId}
          secao="aliquotas"
          regraIds={regras.map((r) => r.id)}
          label="Copiar para..."
          descricao="Copia todas as alíquotas padrão listadas."
        />
        <Button
          size="sm"
          variant="outline"
          onClick={onCreate}
          leftIcon={<Plus className="w-3.5 h-3.5" />}
        >
          Nova Regra Estadual
        </Button>
      </>
    }
  >
    {isLoading ? (
      <div className="p-5">
        <LoadingSpinner size="sm" message="Carregando regras estaduais..." />
      </div>
    ) : regras.length === 0 ? (
      <div className="p-5">
        <SectionEmpty
          icon={<Percent className="h-6 w-6" />}
          title="Nenhuma alíquota padrão neste perfil"
          hint="Sem a alíquota base da UF, itens que não casam com nenhuma regra ficam sem A.DST."
          action={
            <Button
              size="sm"
              variant="outline"
              onClick={onCreate}
              leftIcon={<Plus className="w-3.5 h-3.5" />}
            >
              Cadastrar alíquota da UF
            </Button>
          }
        />
      </div>
    ) : (
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs divide-y divide-slate-100">
          <thead className="bg-slate-50/70 text-slate-500 font-bold uppercase tracking-wider text-[10px]">
            <tr>
              <th className="py-3 px-4">Estado</th>
              <th className="py-3 px-4">Tipo</th>
              <th className="py-3 px-4 font-mono text-right">A.DST Padrão</th>
              <th className="py-3 px-4">Descrição / Legislação</th>
              <th className="py-3 px-4 text-right">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100/80">
            {regras.map((regra) => (
              <tr key={regra.id} className="hover:bg-slate-50/70 transition-colors">
                <td className="py-3 px-4">
                  <span className="font-bold text-slate-800 bg-slate-100 px-2 py-0.5 rounded text-[11px] border border-slate-200">
                    {regra.uf}
                  </span>
                </td>
                <td className="py-3 px-4">
                  <Badge variant="info" size="sm">Padrão Estadual</Badge>
                </td>
                <td className="py-3 px-4 font-mono font-bold text-blue-950 text-right tabular-nums">
                  {formatPercent(regra.aliquota)}
                </td>
                <td className="py-3 px-4 text-slate-600">{regra.descricao || '-'}</td>
                <td className="py-3 px-4 text-right">
                  <div className="flex items-center justify-end gap-1">
                    <CopiarRegrasButton
                      perfilId={perfilId}
                      secao="aliquotas"
                      regraIds={[regra.id]}
                      descricao="Copia esta alíquota padrão."
                    />
                    <button
                      type="button"
                      onClick={() => onEdit(regra)}
                      className="p-1.5 text-slate-400 hover:text-blue-700 hover:bg-blue-50 rounded-lg transition-colors cursor-pointer"
                      title="Editar regra"
                      aria-label={`Editar regra padrão de ${regra.uf}`}
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onDelete(regra)}
                      className="p-1.5 text-slate-400 hover:text-rose-700 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
                      title="Remover regra"
                      aria-label={`Remover regra padrão de ${regra.uf}`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )}
  </Card>
);

