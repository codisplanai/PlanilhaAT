import React from 'react';

export interface CodisplanLogoProps {
  theme?: 'light' | 'dark';
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}

export const CodisplanLogo: React.FC<CodisplanLogoProps> = ({
  theme = 'light',
  size = 'md',
  className = '',
}) => {
  const isLight = theme === 'light';

  const sizeClasses = {
    xs: 'h-5',
    sm: 'h-7',
    md: 'h-9',
    lg: 'h-12',
    xl: 'h-16',
  }[size];

  return (
    <div className={`inline-flex items-center select-none ${className}`}>
      <svg
        className={`${sizeClasses} w-auto max-w-full`}
        viewBox="0 0 320 90"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <style>
            {`
              @import url('https://fonts.googleapis.com/css2?family=Outfit:ital,wght@1,900&family=Inter:wght@800;900&display=swap');
              .codisplan-title-${theme} {
                font-family: 'Outfit', 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
                font-weight: 900;
                font-style: italic;
                font-size: 46px;
                fill: ${isLight ? '#0F172A' : '#FFFFFF'};
                letter-spacing: -0.5px;
              }
              .codisplan-sub-${theme} {
                font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
                font-weight: 800;
                font-size: 13px;
                fill: ${isLight ? '#475569' : '#94A3B8'};
                letter-spacing: 5px;
              }
            `}
          </style>
        </defs>

        {/* Texto Principal: CODISPLAN */}
        <g transform="translate(14, 48)">
          <text className={`codisplan-title-${theme}`} x="0" y="0">
            CODISPL<tspan fill={isLight ? '#0F172A' : '#FFFFFF'}>A</tspan>N
          </text>
          {/* Detalhe em Azul Ciano no traço da letra A */}
          <rect x="207" y="-17" width="22" height="4.5" rx="2.25" fill="#00B4D8" transform="skewX(-14)" />
        </g>

        {/* Subtítulo: CONTABILIDADE */}
        <g transform="translate(20, 74)">
          <text className={`codisplan-sub-${theme}`} x="0" y="0">
            CONTABILIDADE
          </text>
        </g>
      </svg>
    </div>
  );
};
