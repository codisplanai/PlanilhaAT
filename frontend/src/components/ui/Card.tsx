import React, { useState } from 'react';
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
  className,
  ...props
}) => {
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const isOpen = collapsible ? (open ?? internalOpen) : true;

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
            'px-5 py-4 flex flex-wrap items-center justify-between gap-3 bg-slate-50/40',
            isOpen && 'border-b border-slate-100/90',
          )}
        >
          {collapsible ? (
            <button
              type="button"
              onClick={toggleOpen}
              aria-expanded={isOpen}
              className="min-w-0 flex-1 flex items-start gap-3 text-left rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2"
            >
              <ChevronDown
                className={clsx(
                  'w-4 h-4 mt-0.5 shrink-0 text-slate-400 transition-transform duration-200',
                  isOpen && 'rotate-180',
                )}
              />
              <span className="min-w-0">
                {title && (
                  <span className="block text-sm sm:text-base font-bold text-slate-900 tracking-tight">
                    {title}
                  </span>
                )}
                {subtitle && (
                  <span className="block text-xs text-slate-500 mt-0.5 leading-relaxed">
                    {subtitle}
                  </span>
                )}
              </span>
            </button>
          ) : (
            <div className="min-w-0">
              {title && <h3 className="text-sm sm:text-base font-bold text-slate-900 tracking-tight">{title}</h3>}
              {subtitle && <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">{subtitle}</p>}
            </div>
          )}
          {(summary || headerAction) && (
            <div className="shrink-0 flex items-center gap-2 flex-wrap justify-end">
              {summary && <div className="text-xs text-slate-500">{summary}</div>}
              {headerAction && <div>{headerAction}</div>}
            </div>
          )}
        </div>
      )}
      {isOpen && <div className={paddingClasses[bodyPadding]}>{children}</div>}
    </div>
  );
};
