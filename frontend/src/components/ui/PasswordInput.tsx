import React, { forwardRef, useId, useState } from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { Eye, EyeOff, Lock, AlertCircle } from 'lucide-react';

export interface PasswordInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  helperText?: string;
}

export const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(
  ({ label, error, helperText, className, id, required, ...props }, ref) => {
    const [showPassword, setShowPassword] = useState(false);
    const generatedId = useId();
    const inputId = id || generatedId;
    const messageId = `${inputId}-message`;

    return (
      <div className="w-full space-y-1.5">
        {label && (
          <label
            htmlFor={inputId}
            className="block text-xs font-semibold text-slate-700 select-none"
          >
            {label}
            {required && <span className="text-rose-500 ml-0.5">*</span>}
          </label>
        )}
        <div className="relative flex items-center">
          <div className="absolute left-3 pointer-events-none text-slate-400">
            <Lock className="w-4 h-4" />
          </div>
          <input
            id={inputId}
            ref={ref}
            type={showPassword ? 'text' : 'password'}
            required={required}
            aria-invalid={Boolean(error)}
            aria-describedby={error || helperText ? messageId : undefined}
            className={twMerge(
              clsx(
                'w-full pl-9 pr-11 py-2 text-base sm:text-sm min-h-[40px] bg-white border rounded-lg shadow-2xs transition-all duration-150',
                'focus:outline-none focus:ring-4 focus:ring-blue-500/15 focus:border-blue-600',
                'placeholder:text-slate-400 text-slate-900',
                error
                  ? 'border-rose-500 bg-rose-50/20 focus:ring-rose-500/15 focus:border-rose-500'
                  : 'border-slate-200/90 hover:border-slate-300',
                className
              )
            )}
            {...props}
          />
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            aria-label={showPassword ? `Ocultar ${label || 'senha'}` : `Exibir ${label || 'senha'}`}
            title={showPassword ? 'Ocultar senha' : 'Exibir senha'}
            className="absolute right-2.5 p-1.5 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
          >
            {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
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
  }
);

PasswordInput.displayName = 'PasswordInput';
