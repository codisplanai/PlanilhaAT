import React from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { Loader2 } from 'lucide-react';

export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  'aria-label': string;
  variant?: 'default' | 'primary' | 'danger' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  isLoading?: boolean;
}

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  (
    {
      'aria-label': ariaLabel,
      children,
      className,
      variant = 'default',
      size = 'md',
      isLoading = false,
      disabled,
      title,
      ...props
    },
    ref
  ) => {
    const baseStyles =
      'inline-flex items-center justify-center rounded-lg transition-all duration-150 active:scale-95 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2 disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100 cursor-pointer shrink-0';

    const variants = {
      default:
        'text-slate-400 hover:text-slate-700 hover:bg-slate-100 border border-transparent focus:ring-slate-400',
      primary:
        'text-blue-600 hover:text-blue-800 hover:bg-blue-50 border border-transparent focus:ring-blue-600',
      danger:
        'text-slate-400 hover:text-rose-600 hover:bg-rose-50 border border-transparent focus:ring-rose-500',
      ghost:
        'text-slate-500 hover:text-slate-900 hover:bg-slate-100 focus:ring-slate-400',
    };

    const sizes = {
      sm: 'w-8 h-8 p-1.5 text-xs',
      md: 'w-9 h-9 p-2 text-sm',
      lg: 'w-10 h-10 p-2.5 text-base',
    };

    return (
      <button
        ref={ref}
        type="button"
        aria-label={ariaLabel}
        title={title || ariaLabel}
        aria-busy={isLoading}
        disabled={disabled || isLoading}
        className={twMerge(clsx(baseStyles, variants[variant], sizes[size], className))}
        {...props}
      >
        {isLoading ? <Loader2 className="w-4 h-4 animate-spin text-current" /> : children}
      </button>
    );
  }
);

IconButton.displayName = 'IconButton';
