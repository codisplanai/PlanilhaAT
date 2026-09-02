import type { ReactNode } from 'react';

export interface PageHeaderProps {
  icon: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
  badge?: ReactNode;
}

export function PageHeader({ icon, title, description, action, badge }: PageHeaderProps) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-1">
      <div className="flex items-start sm:items-center gap-3.5">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-50 to-cyan-50 border border-blue-200/60 flex items-center justify-center text-blue-700 shadow-2xs shrink-0 mt-0.5 sm:mt-0">
          {icon}
        </div>
        <div>
          <div className="flex items-center gap-2.5 flex-wrap">
            <h1 className="text-lg sm:text-xl font-black tracking-tight text-slate-900">
              {title}
            </h1>
            {badge && <div>{badge}</div>}
          </div>
          <p className="text-xs text-slate-500 mt-0.5 leading-relaxed max-w-3xl">
            {description}
          </p>
        </div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
