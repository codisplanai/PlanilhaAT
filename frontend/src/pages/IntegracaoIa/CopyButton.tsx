import React, { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { clsx } from 'clsx';

import { useManagedTimeout } from '../../hooks/useManagedTimeout';

interface CopyButtonProps {
  value: string;
  /** O que está sendo copiado, para o leitor de tela ("Copiar e-mail"). */
  label: string;
  className?: string;
  tone?: 'light' | 'dark';
}

export const CopyButton: React.FC<CopyButtonProps> = ({ value, label, className, tone = 'light' }) => {
  const [copied, setCopied] = useState(false);
  const feedback = useManagedTimeout();

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      feedback.schedule(() => setCopied(false), 2000);
    } catch {
      // Sem a Clipboard API o texto continua selecionável na tela.
    }
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      aria-label={copied ? `${label}: copiado` : label}
      title={label}
      className={clsx(
        'inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] font-semibold transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 shrink-0',
        tone === 'dark'
          ? 'text-slate-300 hover:text-white hover:bg-slate-700/80'
          : 'text-slate-500 hover:text-blue-700 hover:bg-blue-50',
        className,
      )}
    >
      {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
      <span aria-live="polite">{copied ? 'Copiado' : 'Copiar'}</span>
    </button>
  );
};

interface CodeBlockProps {
  value: string;
  label: string;
}

/** Bloco de código com botão de copiar; quebra linhas longas em vez de rolar. */
export const CodeBlock: React.FC<CodeBlockProps> = ({ value, label }) => (
  <div className="relative rounded-xl bg-slate-900 border border-slate-800 shadow-2xs">
    <div className="absolute top-1.5 right-1.5">
      <CopyButton value={value} label={label} tone="dark" />
    </div>
    <pre className="p-4 pr-24 text-[11px] leading-relaxed text-slate-100 font-mono whitespace-pre-wrap break-words">
      {value}
    </pre>
  </div>
);
