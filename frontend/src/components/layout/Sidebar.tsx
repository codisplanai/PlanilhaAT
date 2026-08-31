import React from 'react';
import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  FileSpreadsheet,
  Building2,
  Sliders,
  History,
  FileCode2,
  LogOut,
  User as UserIcon,
  PlusCircle,
  ShieldCheck,
  ShieldAlert
} from 'lucide-react';
import type { User } from '../../types/auth';

interface SidebarProps {
  user: User | null;
  onLogout: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ user, onLogout }) => {
  const isAdmin =
    user?.role === 'admin'
    || user?.cargo?.toLowerCase().includes('contador sênior')
    || user?.cargo?.toLowerCase().includes('contador senior')
    || user?.cargo?.toLowerCase().includes('admin');

  const mainNav = [
    { to: '/', label: 'Visão Geral', icon: LayoutDashboard, end: true },
    { to: '/solicitacoes', label: 'Histórico de Planilhas', icon: History },
    { to: '/empresas', label: 'Empresas Clientes', icon: Building2 },
    { to: '/perfis-regras', label: 'Perfis e Alíquotas', icon: Sliders },
  ];

  return (
    <aside className="w-64 bg-slate-900 text-slate-300 flex flex-col h-screen shrink-0 border-r border-slate-800 select-none">
      {/* Brand Header */}
      <div className="h-16 flex items-center px-6 gap-3 border-b border-slate-800 bg-slate-950/50">
        <div className="w-8 h-8 rounded bg-blue-600 flex items-center justify-center text-white font-bold shadow-md shadow-blue-600/20">
          <FileSpreadsheet className="w-5 h-5" />
        </div>
        <div>
          <h1 className="text-sm font-bold tracking-tight text-white flex items-center gap-1.5">
            Planilha AT
            <span className="text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-blue-900/60 text-blue-300 border border-blue-700/50">
              Fiscal
            </span>
          </h1>
          <p className="text-[11px] text-slate-400">Automação Contábil</p>
        </div>
      </div>

      {/* Primary Action Button */}
      <div className="p-4 border-b border-slate-800/80">
        <NavLink
          to="/nova-solicitacao"
          className={({ isActive }) =>
            `flex items-center justify-center gap-2 w-full py-2.5 px-4 rounded-md text-xs font-semibold shadow-sm transition-all ${
              isActive
                ? 'bg-blue-600 text-white shadow-blue-600/25 ring-2 ring-blue-400/30'
                : 'bg-blue-600 hover:bg-blue-500 text-white shadow-blue-900/30'
            }`
          }
        >
          <PlusCircle className="w-4 h-4" />
          <span>Gerar Nova Planilha</span>
        </NavLink>
      </div>

      {/* Navigation Links */}
      <div className="flex-1 overflow-y-auto py-4 px-3 space-y-6">
        <div>
          <div className="px-3 mb-2 text-[10px] font-bold uppercase tracking-wider text-slate-500">
            Operação Diária
          </div>
          <nav className="space-y-1">
            {mainNav.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-3 py-2 rounded-md text-xs font-medium transition-colors ${
                    isActive
                      ? 'bg-blue-600/15 text-blue-400 font-semibold border-l-2 border-blue-500'
                      : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800/60'
                  }`
                }
              >
                <item.icon className="w-4 h-4 shrink-0" />
                <span>{item.label}</span>
              </NavLink>
            ))}
          </nav>
        </div>

        {/* Administration Section - Visível apenas para Contador Sênior / Adm */}
        {isAdmin && (
          <div>
            <div className="px-3 mb-2 text-[10px] font-bold uppercase tracking-wider text-amber-500/80 flex items-center gap-1.5">
              <ShieldAlert className="w-3 h-3 text-amber-400" />
              <span>Área Administrativa</span>
            </div>
            <nav className="space-y-1">
              <NavLink
                to="/templates"
                className={({ isActive }) =>
                  `flex items-center gap-3 px-3 py-2 rounded-md text-xs font-medium transition-colors ${
                    isActive
                      ? 'bg-amber-500/15 text-amber-400 font-semibold border-l-2 border-amber-500'
                      : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800/60'
                  }`
                }
              >
                <FileCode2 className="w-4 h-4 shrink-0 text-amber-400" />
                <span>Modelos de Planilha</span>
              </NavLink>
            </nav>
          </div>
        )}
      </div>

      {/* User Footer */}
      <div className="p-4 border-t border-slate-800 bg-slate-950/40">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5 overflow-hidden">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 border ${
              isAdmin
                ? 'bg-amber-500/20 text-amber-400 border-amber-500/40'
                : 'bg-slate-800 text-slate-300 border-slate-700'
            }`}>
              {isAdmin ? <ShieldCheck className="w-4 h-4" /> : <UserIcon className="w-4 h-4" />}
            </div>
            <div className="overflow-hidden">
              <p className="text-xs font-medium text-slate-200 truncate">{user?.nome || 'Operador'}</p>
              <div className="flex items-center gap-1">
                <span className={`text-[10px] font-medium truncate ${
                  isAdmin ? 'text-amber-400 font-semibold' : 'text-slate-400'
                }`}>
                  {user?.cargo || (isAdmin ? 'Contador Sênior' : 'Analista Fiscal')}
                </span>
              </div>
            </div>
          </div>
          <button
            onClick={onLogout}
            title="Sair do sistema"
            className="p-1.5 rounded text-slate-400 hover:text-red-400 hover:bg-slate-800 transition-colors"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </aside>
  );
};
