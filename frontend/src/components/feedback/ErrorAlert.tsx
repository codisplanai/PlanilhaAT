import React from 'react';
import { AlertCircle, X } from 'lucide-react';

export interface ErrorAlertProps {
  title?: string;
  message: string;
  onDismiss?: () => void;
}

export const ErrorAlert: React.FC<ErrorAlertProps> = ({
  title = 'Inconsistência identificada',
  message,
  onDismiss,
}) => {
  if (!message) return null;

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="p-4 rounded-xl bg-rose-50/90 border border-rose-200/90 text-rose-900 flex items-start gap-3 my-3 animate-fade-in shadow-2xs"
    >
      <div className="w-8 h-8 rounded-lg bg-rose-100 text-rose-600 flex items-center justify-center shrink-0 mt-0.5">
        <AlertCircle className="w-4 h-4" />
      </div>
      <div className="flex-1 text-xs">
        <h4 className="font-bold text-rose-900 mb-0.5 tracking-tight">{title}</h4>
        <p className="text-rose-700 leading-relaxed break-words">{message}</p>
      </div>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dispensar mensagem de erro"
          className="text-rose-400 hover:text-rose-700 p-1 rounded-md hover:bg-rose-100 transition-colors cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>
      )}
    </div>
  );
};
