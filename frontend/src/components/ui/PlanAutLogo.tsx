import React, { useId } from 'react';

export interface PlanAutLogoProps {
  variant?: 'full' | 'compact' | 'icon';
  theme?: 'light' | 'dark';
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
  showTagline?: boolean;
}

/**
 * PlanAutLogo — Logotipo Tipográfico Minimalista e Moderno (Wordmark).
 * 
 * Características:
 * - "PlanAut" juntos, sem espaços e sem separação de palavras.
 * - Sem ícones externos: pura tipografia geométrica de alta precisão.
 * - Contraste arquitetural: "Plan" em peso Black sólido + "Aut" em gradiente tecnológico (Ciano / Esmeralda).
 * - Ponto de precisão "." ao final, simbolizando apuração exata e determinação contábil.
 * - Subtítulo opcional de alta legibilidade ("AUTOMAÇÃO FISCAL").
 */
export const PlanAutLogo: React.FC<PlanAutLogoProps> = ({
  variant = 'full',
  theme = 'light',
  size = 'md',
  className = '',
  showTagline = true,
}) => {
  const isLight = theme === 'light';
  const rawId = useId();
  const safeId = rawId.replace(/[^a-zA-Z0-9_-]/g, '');

  const hasTagline = variant === 'full' && showTagline;

  const sizeClasses = {
    sm: 'h-6',
    md: 'h-8',
    lg: 'h-10',
    xl: 'h-14',
  }[size];

  return (
    <div
      className={`inline-flex items-center select-none transition-transform duration-150 hover:opacity-95 ${className}`}
      title="PlanAut — Automação Fiscal"
    >
      <svg
        className={`${sizeClasses} w-auto max-w-full`}
        viewBox={hasTagline ? '0 0 190 52' : '0 0 190 40'}
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <style>
            {`
              @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:ital,wght@0,800;0,900;1,900&family=Inter:wght@700;800&display=swap');
              .planaut-title-${safeId} {
                font-family: 'Plus Jakarta Sans', 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                font-size: 36px;
                font-weight: 800;
                letter-spacing: -0.04em;
              }
              .planaut-tag-${safeId} {
                font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                font-size: 7.5px;
                font-weight: 700;
                letter-spacing: 0.28em;
                text-transform: uppercase;
                fill: ${isLight ? '#64748B' : '#94A3B8'};
              }
            `}
          </style>

          {/* Gradiente de Automação: Ciano -> Teal -> Esmeralda */}
          <linearGradient
            id={`aut-grad-${safeId}`}
            x1="0"
            y1="0"
            x2="1"
            y2="0"
          >
            <stop offset="0%" stopColor={isLight ? '#0284C7' : '#38BDF8'} />
            <stop offset="50%" stopColor={isLight ? '#0891B2' : '#22D3EE'} />
            <stop offset="100%" stopColor={isLight ? '#059669' : '#34D399'} />
          </linearGradient>
        </defs>

        {/* Wordmark Principal "PlanAut." Juntos */}
        <text x="0" y="32" className={`planaut-title-${safeId}`}>
          <tspan fill={isLight ? '#0F172A' : '#FFFFFF'}>Plan</tspan>
          <tspan fill={`url(#aut-grad-${safeId})`}>Aut</tspan>
          <tspan fill={`url(#aut-grad-${safeId})`}>.</tspan>
        </text>

        {/* Subtítulo Institucional Minimalista */}
        {hasTagline && (
          <text x="1.5" y="47" className={`planaut-tag-${safeId}`}>
            AUTOMAÇÃO FISCAL
          </text>
        )}
      </svg>
    </div>
  );
};
