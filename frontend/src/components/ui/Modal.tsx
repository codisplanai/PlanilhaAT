import React, { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  maxWidth?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '4xl' | '6xl';
}

let openModalCount = 0;
let originalOverflow = '';

export const Modal: React.FC<ModalProps> = ({ isOpen, onClose, title, subtitle, children, maxWidth = 'lg' }) => {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    if (openModalCount === 0) {
      originalOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    }
    openModalCount += 1;

    const focusTimer = window.setTimeout(() => {
      const firstFocusable = dialogRef.current?.querySelector<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
      );
      (firstFocusable || dialogRef.current)?.focus();
    }, 0);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
      ));
      if (focusable.length === 0) {
        event.preventDefault();
        dialogRef.current.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener('keydown', handleKeyDown);
      openModalCount = Math.max(0, openModalCount - 1);
      if (openModalCount === 0) document.body.style.overflow = originalOverflow;
      previouslyFocused?.focus();
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;
  const maxWidths = {
    sm: 'max-w-sm', md: 'max-w-md', lg: 'max-w-lg', xl: 'max-w-xl',
    '2xl': 'max-w-2xl', '4xl': 'max-w-4xl', '6xl': 'max-w-6xl',
  };

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-slate-900/60 backdrop-blur-sm animate-fade-in"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={subtitle ? descriptionId : undefined}
        tabIndex={-1}
        className={twMerge(clsx(
          'w-full bg-white rounded-lg shadow-xl border border-slate-200 overflow-hidden flex flex-col max-h-[94vh]',
          maxWidths[maxWidth]
        ))}
      >
        <div className="px-4 sm:px-6 py-4 border-b border-slate-100 flex items-center justify-between gap-4 bg-slate-50/50">
          <div>
            <h3 id={titleId} className="text-base font-semibold text-slate-900">{title}</h3>
            {subtitle && <p id={descriptionId} className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar janela" className="p-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-4 sm:p-6 overflow-y-auto flex-1">{children}</div>
      </div>
    </div>,
    document.body
  );
};
