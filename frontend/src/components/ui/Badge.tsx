import React from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import type { BadgeVariant } from '../../types/common';

export type { BadgeVariant } from '../../types/common';

interface BadgeProps {
  children: React.ReactNode;
  variant?: BadgeVariant;
  size?: 'sm' | 'md';
  className?: string;
}

export const Badge: React.FC<BadgeProps> = ({
  children,
  variant = 'neutral',
  size = 'md',
  className,
}) => {
  const baseStyles = 'inline-flex items-center font-medium rounded-full';

  const variants = {
    success: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
    warning: 'bg-amber-50 text-amber-800 border border-amber-200',
    error: 'bg-red-50 text-red-700 border border-red-200',
    info: 'bg-blue-50 text-blue-800 border border-blue-200',
    purple: 'bg-purple-50 text-purple-800 border border-purple-200 font-semibold', // Para exceções NCM
    neutral: 'bg-slate-100 text-slate-700 border border-slate-200',
  };

  const sizes = {
    sm: 'text-[11px] px-2 py-0.5',
    md: 'text-xs px-2.5 py-1',
  };

  return (
    <span className={twMerge(clsx(baseStyles, variants[variant], sizes[size], className))}>
      {children}
    </span>
  );
};
