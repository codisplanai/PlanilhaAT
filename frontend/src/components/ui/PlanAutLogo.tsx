import React from 'react';

export interface PlanAutLogoProps {
  variant?: 'full' | 'compact' | 'icon';
  theme?: 'light' | 'dark';
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
  showTagline?: boolean;
}

export const PlanAutLogo: React.FC<PlanAutLogoProps> = ({
  variant = 'full',
  theme = 'light',
  size = 'md',
  className = '',
  showTagline = true,
}) => {
  const isLight = theme === 'light';

  // Size mappings
  const iconDimensions = {
    sm: { box: 32, svg: 'w-8 h-8' },
    md: { box: 40, svg: 'w-10 h-10' },
    lg: { box: 48, svg: 'w-12 h-12' },
    xl: { box: 60, svg: 'w-15 h-15' },
  }[size];

  const textSizes = {
    sm: 'text-base',
    md: 'text-xl',
    lg: 'text-2xl',
    xl: 'text-3xl',
  }[size];

  const subtextSizes = {
    sm: 'text-[6.5px]',
    md: 'text-[7.5px]',
    lg: 'text-[9px]',
    xl: 'text-[10px]',
  }[size];

  // SVG Icon Core
  const SvgIcon = () => (
    <svg className="w-full h-full" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="p-bolt-light" x1="26" y1="12" x2="52" y2="52" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#0284C7"/>
          <stop offset="50%" stopColor="#0891B2"/>
          <stop offset="100%" stopColor="#059669"/>
        </linearGradient>
        <linearGradient id="p-bolt-dark" x1="26" y1="12" x2="52" y2="52" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#38BDF8"/>
          <stop offset="45%" stopColor="#06B6D4"/>
          <stop offset="100%" stopColor="#10B981"/>
        </linearGradient>
      </defs>

      {/* Squircle Background Box */}
      <rect
        x="1"
        y="1"
        width="62"
        height="62"
        rx="18"
        fill={isLight ? '#F8FAFC' : '#0F172A'}
        stroke={isLight ? '#E2E8F0' : '#334155'}
        strokeWidth="1.5"
      />

      {/* Spreadsheet Grid Cells */}
      <rect x="14" y="14" width="10" height="10" rx="3" fill="#0284C7" fillOpacity={isLight ? 0.15 : 0.25} />
      <rect x="14" y="27" width="10" height="10" rx="3" fill="#0284C7" fillOpacity={isLight ? 0.25 : 0.35} />
      <rect x="14" y="40" width="10" height="10" rx="3" fill="#0284C7" fillOpacity={isLight ? 0.35 : 0.45} />
      <rect x="27" y="14" width="10" height="10" rx="3" fill="#0284C7" fillOpacity={isLight ? 0.15 : 0.25} />

      {/* Dynamic Lightning Bolt */}
      <path
        d="M37 13L24 33H34L28 51L44 29H34L40 13H37Z"
        fill={isLight ? 'url(#p-bolt-light)' : 'url(#p-bolt-dark)'}
        stroke={isLight ? '#FFFFFF' : '#020617'}
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );

  // Icon only rendering
  if (variant === 'icon') {
    return (
      <div
        className={`relative inline-flex items-center justify-center shrink-0 rounded-2xl shadow-sm transition-transform duration-200 hover:scale-105 ${iconDimensions.svg} ${className}`}
        title="PlanAut"
      >
        <SvgIcon />
      </div>
    );
  }

  return (
    <div className={`inline-flex items-center gap-3 select-none ${className}`}>
      {/* Icon Mark */}
      <div
        className={`relative inline-flex items-center justify-center shrink-0 rounded-2xl shadow-sm transition-transform duration-200 hover:scale-105 ${iconDimensions.svg}`}
      >
        <SvgIcon />
      </div>

      {/* Typography */}
      <div className="flex flex-col leading-tight">
        <div className={`font-black tracking-tight flex items-center gap-1 ${textSizes}`}>
          <span className={isLight ? 'text-slate-900' : 'text-white'}>
            Plan
          </span>
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-600 via-teal-600 to-emerald-600">
            Aut
          </span>
        </div>
        {variant === 'full' && showTagline && (
          <span className={`font-semibold tracking-[0.14em] uppercase ${isLight ? 'text-slate-500' : 'text-slate-400'} ${subtextSizes}`}>
            AUTOMAÇÃO FISCAL INTELIGENTE
          </span>
        )}
      </div>
    </div>
  );
};
