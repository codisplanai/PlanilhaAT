import React, { forwardRef, useId } from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { ChevronDown, AlertCircle } from 'lucide-react';

export interface Option {
  value: string | number;
  label: string;
}

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  options: Option[];
  error?: string;
  helperText?: string;
  placeholder?: string;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(({
  label,
  options,
  error,
  helperText,
  placeholder,
  className,
  id,
  ...props
}, ref) => {
  const generatedId = useId();
  const selectId = id || generatedId;
  const messageId = `${selectId}-message`;

  return (
    <div className="w-full space-y-1.5">
      {label && (
        <label
          htmlFor={selectId}
          className="block text-xs font-semibold uppercase tracking-wider text-slate-700 select-none"
        >
          {label}
        </label>
      )}
      <div className="relative">
        <select
          id={selectId}
          ref={ref}
          aria-invalid={Boolean(error)}
          aria-describedby={error || helperText ? messageId : undefined}
          className={twMerge(
            clsx(
              'w-full pl-3 pr-10 py-2 text-xs sm:text-sm bg-white border rounded-lg shadow-2xs transition-all duration-150 appearance-none cursor-pointer',
              'focus:outline-none focus:ring-4 focus:ring-blue-500/15 focus:border-blue-600',
              'text-slate-900',
              error
                ? 'border-rose-500 bg-rose-50/20 focus:ring-rose-500/15 focus:border-rose-500'
                : 'border-slate-200/90 hover:border-slate-300',
              className
            )
          )}
          {...props}
        >
          {placeholder && (
            <option value="" disabled>
              {placeholder}
            </option>
          )}
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">
          <ChevronDown className="w-4 h-4" />
        </div>
      </div>
      {error ? (
        <p id={messageId} role="alert" className="flex items-center gap-1 text-xs text-rose-600 font-medium">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          <span>{error}</span>
        </p>
      ) : helperText ? (
        <p id={messageId} className="text-xs text-slate-500 leading-relaxed">{helperText}</p>
      ) : null}
    </div>
  );
});

Select.displayName = 'Select';
