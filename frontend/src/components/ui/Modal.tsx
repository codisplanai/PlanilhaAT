import React, { useEffect, useId, useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  maxWidth?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '4xl' | '6xl';
}

/**
 * A pilha de modais abertos é estado compartilhado entre instâncias, então vive
 * fora do React e é publicada por ``useSyncExternalStore``. Mantê-la em um
 * array mutável simples fazia a renderização ler a pilha antes do efeito que a
 * empilha: o topo real nunca era reconhecido e todo modal nascia com
 * ``aria-hidden`` e sem clique no backdrop.
 */
let modalStack: readonly string[] = [];
let originalOverflow = '';
const stackSubscribers = new Set<() => void>();

function subscribeToStack(onStoreChange: () => void): () => void {
  stackSubscribers.add(onStoreChange);
  return () => {
    stackSubscribers.delete(onStoreChange);
  };
}

function getStackSnapshot(): readonly string[] {
  return modalStack;
}

function setStack(next: readonly string[]): void {
  modalStack = next;
  for (const notify of stackSubscribers) notify();
}

export const Modal: React.FC<ModalProps> = ({
  isOpen,
  onClose,
  title,
  subtitle,
  children,
  maxWidth = 'lg',
}) => {
  const instanceId = useId();
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const stack = useSyncExternalStore(subscribeToStack, getStackSnapshot, getStackSnapshot);

  useEffect(() => {
    onCloseRef.current = onClose;
  });

  // Empilhar antes da pintura evita um quadro com o modal marcado como inerte.
  useLayoutEffect(() => {
    if (!isOpen) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    if (modalStack.length === 0) {
      originalOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    }
    setStack([...modalStack, instanceId]);

    return () => {
      setStack(modalStack.filter((id) => id !== instanceId));
      if (modalStack.length === 0) {
        document.body.style.overflow = originalOverflow;
      }
      previouslyFocused?.focus();
    };
  }, [isOpen, instanceId]);

  useEffect(() => {
    if (!isOpen) return;

    const focusTimer = window.setTimeout(() => {
      if (dialogRef.current?.contains(document.activeElement)) return;
      const firstInput = dialogRef.current?.querySelector<HTMLElement>(
        'input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled])'
      );
      const firstFocusable = dialogRef.current?.querySelector<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
      );
      (firstInput || firstFocusable || dialogRef.current)?.focus();
    }, 50);

    const handleKeyDown = (event: KeyboardEvent) => {
      // Only the top-most modal in the stack handles keyboard events
      if (modalStack[modalStack.length - 1] !== instanceId) return;

      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
        )
      );
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
    };
  }, [isOpen, instanceId]);

  if (!isOpen) return null;

  const stackIndex = Math.max(0, stack.indexOf(instanceId));
  // Até o efeito de layout empilhar esta instância, ela é o modal mais recente
  // a ser aberto e deve se comportar como topo — nunca como um modal inerte.
  const isTopModal = stack.length === 0
    || !stack.includes(instanceId)
    || stack[stack.length - 1] === instanceId;
  const zIndex = 50 + stackIndex * 10;

  const maxWidths = {
    sm: 'max-w-sm',
    md: 'max-w-md',
    lg: 'max-w-lg',
    xl: 'max-w-xl',
    '2xl': 'max-w-2xl',
    '4xl': 'max-w-4xl',
    '6xl': 'max-w-6xl',
  };

  return createPortal(
    <div
      style={{ zIndex }}
      aria-hidden={!isTopModal ? 'true' : undefined}
      className={twMerge(
        clsx(
          'fixed inset-0 flex items-center justify-center p-3 sm:p-6 bg-slate-950/50 backdrop-blur-md animate-fade-in',
          !isTopModal && 'pointer-events-none opacity-90'
        )
      )}
      onMouseDown={(event) => {
        if (isTopModal && event.target === event.currentTarget) {
          onCloseRef.current();
        }
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={subtitle ? descriptionId : undefined}
        tabIndex={-1}
        className={twMerge(
          clsx(
            'w-full bg-white rounded-2xl shadow-2xl border border-slate-200/90 overflow-hidden flex flex-col max-h-[92dvh] animate-scale-in pointer-events-auto',
            maxWidths[maxWidth]
          )
        )}
      >
        <div className="px-5 sm:px-6 py-4 border-b border-slate-100 flex items-center justify-between gap-4 bg-slate-50/60 shrink-0">
          <div>
            <h3 id={titleId} className="text-base font-bold text-slate-900 tracking-tight">
              {title}
            </h3>
            {subtitle && (
              <p id={descriptionId} className="text-xs text-slate-500 mt-0.5 leading-relaxed">
                {subtitle}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={() => onCloseRef.current()}
            aria-label="Fechar janela"
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-600"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-5 sm:p-6 overflow-y-auto flex-1">{children}</div>
      </div>
    </div>,
    document.body
  );
};
