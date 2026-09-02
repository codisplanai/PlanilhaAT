import type { ReactNode } from 'react';
import { AlertCircle, CheckCircle2, Clock } from 'lucide-react';

import { STATUS_BADGE_VARIANTS, STATUS_LABELS } from '../../constants/domain';
import type { StatusSolicitacao } from '../../types/solicitacao';
import { Badge } from '../ui/Badge';

interface StatusBadgeProps {
  status: StatusSolicitacao;
}

const STATUS_ICONS: Partial<Record<StatusSolicitacao, ReactNode>> = {
  concluido: <CheckCircle2 className="w-3 h-3 text-emerald-600 shrink-0" />,
  processando: <Clock className="w-3 h-3 text-blue-600 animate-spin shrink-0" />,
  erro: <AlertCircle className="w-3 h-3 text-rose-600 shrink-0" />,
  pendente: <Clock className="w-3 h-3 text-amber-600 shrink-0" />,
};

export function StatusBadge({ status }: StatusBadgeProps) {
  return (
    <Badge variant={STATUS_BADGE_VARIANTS[status]} size="sm">
      {STATUS_ICONS[status]}
      <span>{STATUS_LABELS[status]}</span>
    </Badge>
  );
}
