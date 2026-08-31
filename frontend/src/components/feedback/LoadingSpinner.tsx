import React from 'react';
import { Loader2 } from 'lucide-react';

interface LoadingSpinnerProps {
  message?: string;
  size?: 'sm' | 'md' | 'lg';
}

export const LoadingSpinner: React.FC<LoadingSpinnerProps> = ({
  message = 'Carregando informações...',
  size = 'md',
}) => {
  const sizes = {
    sm: 'w-4 h-4',
    md: 'w-6 h-6',
    lg: 'w-8 h-8',
  };

  return (
    <div className="flex flex-col items-center justify-center py-10 gap-3 text-slate-500">
      <Loader2 className={`${sizes[size]} animate-spin text-blue-800`} />
      {message && <p className="text-xs font-medium text-slate-600">{message}</p>}
    </div>
  );
};
