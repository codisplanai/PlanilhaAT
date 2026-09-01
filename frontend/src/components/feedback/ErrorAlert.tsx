import React from 'react';
import { AlertCircle, XCircle } from 'lucide-react';

interface ErrorAlertProps {
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
    <div role="alert" aria-live="assertive" className="p-4 rounded-lg bg-red-50 border border-red-200 text-red-900 flex items-start gap-3 my-3 animate-fade-in shadow-sm">
      <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
      <div className="flex-1 text-xs">
        <h4 className="font-semibold text-red-800 mb-0.5">{title}</h4>
        <p className="text-red-700 leading-relaxed break-words">{message}</p>
      </div>
      {onDismiss && (
        <button
          onClick={onDismiss}
          aria-label="Dispensar mensagem de erro"
          className="text-red-400 hover:text-red-700 p-0.5 rounded transition-colors"
        >
          <XCircle className="w-4 h-4" />
        </button>
      )}
    </div>
  );
};
