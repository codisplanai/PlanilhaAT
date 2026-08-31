import type { BadgeVariant } from '../components/ui/Badge';
import type { StatusSolicitacao, TipoPlanilha } from '../types/solicitacao';

export const UFS_BRASIL = [
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO',
  'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI',
  'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
] as const;

export const PLANILHA_LABELS: Record<TipoPlanilha | 'multi', string> = {
  antecipacao_parcial: 'Antecipação Parcial',
  antecipacao_parcial_antecipado: 'Antecipação Parcial — Pago Antecipadamente',
  antecipacao_tributaria: 'Antecipação Tributária',
  difal: 'DIFAL',
  multi: 'Roteamento automático',
};

export const PLANILHA_BADGE_VARIANTS: Record<TipoPlanilha, BadgeVariant> = {
  antecipacao_parcial: 'info',
  antecipacao_parcial_antecipado: 'warning',
  antecipacao_tributaria: 'purple',
  difal: 'success',
};

export const PLANILHA_DETAILED_LABELS: Record<TipoPlanilha, string> = {
  antecipacao_parcial: PLANILHA_LABELS.antecipacao_parcial,
  antecipacao_parcial_antecipado: PLANILHA_LABELS.antecipacao_parcial_antecipado,
  antecipacao_tributaria: PLANILHA_LABELS.antecipacao_tributaria,
  difal: 'DIFAL (Diferencial de Alíquota)',
};

export const STATUS_LABELS: Record<StatusSolicitacao, string> = {
  pendente: 'Pendente',
  processando: 'Processando',
  concluido: 'Concluída',
  erro: 'Erro',
};

export const STATUS_BADGE_VARIANTS: Record<StatusSolicitacao, BadgeVariant> = {
  pendente: 'neutral',
  processando: 'warning',
  concluido: 'success',
  erro: 'error',
};

export function getPlanilhaLabel(tipo: string): string {
  return PLANILHA_LABELS[tipo as TipoPlanilha | 'multi'] ?? tipo;
}
