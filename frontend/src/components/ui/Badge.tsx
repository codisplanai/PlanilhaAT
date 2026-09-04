import React from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import type { BadgeVariant } from '../../types/common';

export type { BadgeVariant } from '../../types/common';

export interface BadgeProps {
  children: React.ReactNode;
  variant?: BadgeVariant;
  size?: 'sm' | 'md';
  dot?: boolean;
  className?: string;
}

export const Badge: React.FC<BadgeProps> = ({
  children,
  variant = 'neutral',
  size = 'md',
  dot = false,
  className,
}) => {
  const baseStyles = 'inline-flex items-center font-medium rounded-full select-none tracking-tight whitespace-nowrap';

  const variants = {
    success: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-600/20',
    warning: 'bg-amber-50 text-amber-800 ring-1 ring-amber-600/20',
    error: 'bg-rose-50 text-rose-700 ring-1 ring-rose-600/20',
    info: 'bg-blue-50 text-blue-700 ring-1 ring-blue-600/20',
    purple: 'bg-purple-50 text-purple-700 ring-1 ring-purple-600/20 font-semibold',
    neutral: 'bg-slate-100 text-slate-700 ring-1 ring-slate-200/90',
  };

  const dotColors = {
    success: 'bg-emerald-500',
    warning: 'bg-amber-500',
    error: 'bg-rose-500',
    info: 'bg-blue-500',
    purple: 'bg-purple-500',
    neutral: 'bg-slate-400',
  };

  const sizes = {
    sm: 'text-[10px] px-2 py-0.5 gap-1',
    md: 'text-xs px-2.5 py-1 gap-1.5',
  };

  return (
    <span className={twMerge(clsx(baseStyles, variants[variant], sizes[size], className))}>
      {dot && <span className={clsx('w-1.5 h-1.5 rounded-full shrink-0', dotColors[variant])} />}
      {children}
    </span>
  );
};
