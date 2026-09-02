import React from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  title?: string;
  subtitle?: string;
  headerAction?: React.ReactNode;
  interactive?: boolean;
}

export const Card: React.FC<CardProps> = ({
  children,
  title,
  subtitle,
  headerAction,
  interactive = false,
  className,
  ...props
}) => {
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
        <div className="px-5 py-4 border-b border-slate-100/90 flex flex-wrap items-center justify-between gap-3 bg-slate-50/40">
          <div>
            {title && <h3 className="text-sm sm:text-base font-bold text-slate-900 tracking-tight">{title}</h3>}
            {subtitle && <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">{subtitle}</p>}
          </div>
          {headerAction && <div className="shrink-0">{headerAction}</div>}
        </div>
      )}
      <div className="p-5">{children}</div>
    </div>
  );
};
