import React, { forwardRef, useId } from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  helperText?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(({
  label,
  error,
  helperText,
  className,
  id,
  ...props
}, ref) => {
  const generatedId = useId();
  const inputId = id || generatedId;
  const messageId = `${inputId}-message`;

  return (
    <div className="w-full">
      {label && (
        <label htmlFor={inputId} className="block text-xs font-semibold uppercase tracking-wider text-slate-700 mb-1.5">
          {label}
        </label>
      )}
      <input
        id={inputId}
        ref={ref}
        aria-invalid={Boolean(error)}
        aria-describedby={error || helperText ? messageId : undefined}
        className={twMerge(
          clsx(
            'w-full px-3 py-2 text-sm bg-white border rounded-md shadow-sm transition-colors',
            'focus:outline-none focus:ring-2 focus:ring-blue-800 focus:border-blue-800',
            'placeholder:text-slate-400 text-slate-900',
            error ? 'border-red-500 focus:ring-red-500 focus:border-red-500' : 'border-slate-300',
            className
          )
        )}
        {...props}
      />
      {error ? (
        <p id={messageId} role="alert" className="mt-1 text-xs text-red-600 font-medium">{error}</p>
      ) : helperText ? (
        <p id={messageId} className="mt-1 text-xs text-slate-500">{helperText}</p>
      ) : null}
    </div>
  );
});

Input.displayName = 'Input';
