import React from 'react';
import { FolderOpen } from 'lucide-react';
import { Button } from '../ui/Button';

export interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  icon,
  title,
  description,
  actionLabel,
  onAction,
}) => {
  return (
    <div className="flex flex-col items-center justify-center p-8 sm:p-12 text-center bg-white/60 border border-dashed border-slate-300/80 rounded-2xl animate-fade-in">
      <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-slate-50 via-slate-100 to-blue-50/50 border border-slate-200/80 flex items-center justify-center text-slate-500 mb-4 shadow-2xs">
        {icon || <FolderOpen className="w-6 h-6 text-slate-400" />}
      </div>
      <h3 className="text-sm sm:text-base font-bold text-slate-900 mb-1 tracking-tight">
        {title}
      </h3>
      <p className="text-xs text-slate-500 max-w-md mb-6 leading-relaxed">
        {description}
      </p>
      {actionLabel && onAction && (
        <Button onClick={onAction} size="sm">
          {actionLabel}
        </Button>
      )}
    </div>
  );
};
