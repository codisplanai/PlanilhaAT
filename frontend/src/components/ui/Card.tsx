import React, { useId, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  title?: string;
  subtitle?: string;
  headerAction?: React.ReactNode;
  interactive?: boolean;
  bodyPadding?: 'none' | 'sm' | 'md' | 'lg';
  collapsible?: boolean;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  summary?: React.ReactNode;
  /** Marcador de ordem exibido à esquerda do título (ex.: nível de precedência). */
  marker?: React.ReactNode;
}

export const Card: React.FC<CardProps> = ({
  children,
  title,
  subtitle,
  headerAction,
  interactive = false,
  bodyPadding = 'md',
  collapsible = false,
  open,
  defaultOpen = true,
  onOpenChange,
  summary,
  marker,
  className,
  ...props
}) => {
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const isOpen = collapsible ? (open ?? internalOpen) : true;
  const bodyId = `${useId()}-body`;

  const toggleOpen = () => {
    if (!collapsible) return;
    const next = !isOpen;
    if (open === undefined) setInternalOpen(next);
    onOpenChange?.(next);
  };
  const paddingClasses = {
    none: '',
    sm: 'p-3.5',
    md: 'p-5',
    lg: 'p-6 sm:p-7',
  };

  const titleBlock = (
    <>
      {title && (
        <span className="block text-sm sm:text-base font-bold text-slate-900 tracking-tight text-balance">
          {title}
        </span>
      )}
      {subtitle && (
        <span
          className={clsx(
            'block text-xs text-slate-500 mt-1 leading-relaxed max-w-[68ch]',
            collapsible && !isOpen && 'line-clamp-2',
          )}
        >
          {subtitle}
        </span>
      )}
    </>
  );

  return (
    <div
      className={twMerge(
        clsx(
          'bg-white border border-slate-200/80 rounded-xl shadow-xs overflow-hidden transition-all duration-150',
          interactive && 'hover:shadow-md hover:border-slate-300 hover:-translate-y-0.5 cursor-pointer',
          className
        )
      )}
      {...props}
    >
      {(title || headerAction) && (
        <div
          className={clsx(
            'px-5 py-4 flex flex-wrap items-center gap-x-4 gap-y-3 bg-slate-50/40',
            isOpen && 'border-b border-slate-100/90',
          )}
        >
          {/* `basis` define a largura mínima confortável do título: abaixo dela as
              ações quebram para a linha seguinte em vez de espremer o texto. */}
          {collapsible ? (
            <button
              type="button"
              onClick={toggleOpen}
              aria-expanded={isOpen}
              aria-controls={bodyId}
              className="group min-w-0 flex-1 basis-[20rem] flex items-start gap-3 text-left rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 cursor-pointer"
            >
              <ChevronDown
                className={clsx(
                  'w-4 h-4 mt-0.5 shrink-0 text-slate-400 group-hover:text-slate-600 transition-transform duration-200',
                  isOpen && 'rotate-180',
                )}
              />
              {marker && <span className="shrink-0 mt-px">{marker}</span>}
              <span className="min-w-0">{titleBlock}</span>
            </button>
          ) : (
            <div className="min-w-0 flex-1 basis-[20rem] flex items-start gap-3">
              {marker && <span className="shrink-0 mt-px">{marker}</span>}
              <div className="min-w-0">{titleBlock}</div>
            </div>
          )}
          {(summary || (headerAction && isOpen)) && (
            <div className="shrink-0 ml-auto flex items-center gap-2 flex-wrap justify-end">
              {summary && <div className="text-xs text-slate-500">{summary}</div>}
              {/* Ações só quando aberto: não se opera sobre o que não está à vista. */}
              {headerAction && isOpen && <div>{headerAction}</div>}
            </div>
          )}
        </div>
      )}
      {isOpen && (
        <div id={bodyId} className={paddingClasses[bodyPadding]}>
          {children}
        </div>
      )}
    </div>
  );
};
