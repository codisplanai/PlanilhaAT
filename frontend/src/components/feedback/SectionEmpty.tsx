import React from 'react';
import { clsx } from 'clsx';

export interface SectionEmptyProps {
  icon?: React.ReactNode;
  /** Frase curta dizendo o que ainda não existe. */
  title: string;
  /** Instrução de como sair deste estado. */
  hint?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}

/**
 * Estado vazio de uma seção (dentro de um Card), ao contrário do EmptyState,
 * que ocupa a página inteira. Um vazio é um convite para agir, não um aviso.
 */
export const SectionEmpty: React.FC<SectionEmptyProps> = ({
  icon,
  title,
  hint,
  action,
  className,
}) => (
  <div
    className={clsx(
      'flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-slate-200 bg-slate-50/50 px-6 py-8 text-center',
      className,
    )}
  >
    {icon && <div className="text-slate-400">{icon}</div>}
    <p className="text-xs font-semibold text-slate-700">{title}</p>
    {hint && <p className="max-w-sm text-xs leading-relaxed text-slate-500">{hint}</p>}
    {action && <div className="mt-2">{action}</div>}
  </div>
);
