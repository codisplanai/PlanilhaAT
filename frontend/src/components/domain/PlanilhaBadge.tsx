import {
  PLANILHA_BADGE_VARIANTS,
  PLANILHA_DETAILED_LABELS,
  PLANILHA_LABELS,
} from '../../constants/domain';
import type { TipoPlanilha } from '../../types/solicitacao';
import { Badge } from '../ui/Badge';

interface PlanilhaBadgeProps {
  tipo: TipoPlanilha;
  detailed?: boolean;
}

export function PlanilhaBadge({ tipo, detailed = false }: PlanilhaBadgeProps) {
  return (
    <Badge variant={PLANILHA_BADGE_VARIANTS[tipo]} size="sm">
      {detailed ? PLANILHA_DETAILED_LABELS[tipo] : PLANILHA_LABELS[tipo]}
    </Badge>
  );
}
