import React from 'react';
import { Loader2 } from 'lucide-react';

export interface LoadingSpinnerProps {
  message?: string;
  size?: 'sm' | 'md' | 'lg';
}

export const LoadingSpinner: React.FC<LoadingSpinnerProps> = ({
  message = 'Carregando informações...',
  size = 'md',
}) => {
  const sizes = {
    sm: 'w-4 h-4 border-2',
    md: 'w-7 h-7 border-2',
    lg: 'w-10 h-10 border-3',
  };

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex flex-col items-center justify-center py-12 gap-3.5 text-slate-500 animate-fade-in"
    >
      <div className="relative flex items-center justify-center">
        <Loader2 className={`${sizes[size]} animate-spin text-blue-600`} />
      </div>
      {message && (
        <p className="text-xs font-semibold text-slate-600 tracking-tight">
          {message}
        </p>
      )}
    </div>
  );
};
