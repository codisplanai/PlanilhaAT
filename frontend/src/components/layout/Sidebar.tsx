import React from 'react';
import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  Building2,
  Sliders,
  History,
  FileCode2,
  LogOut,
  User as UserIcon,
  PlusCircle,
  ShieldCheck,
  ShieldAlert,
  Users,
  X,
} from 'lucide-react';
import { PlanAutLogo } from '../ui/PlanAutLogo';
import { CodisplanLogo } from '../ui/CodisplanLogo';
import type { User } from '../../types/auth';

interface SidebarProps {
  user: User | null;
  onLogout: () => void | Promise<void>;
  isOpen: boolean;
  onNavigate: () => void;
  onClose: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ user, onLogout, isOpen, onNavigate, onClose }) => {
  const isAdmin = user?.role === 'admin';

  const mainNav = [
    { to: '/', label: 'Visão Geral', icon: LayoutDashboard, end: true },
    { to: '/solicitacoes', label: 'Histórico de Planilhas', icon: History },
    { to: '/empresas', label: 'Empresas Clientes', icon: Building2 },
    { to: '/perfis-regras', label: 'Perfis e Alíquotas', icon: Sliders },
  ];

  return (
    <aside
      aria-label="Navegação principal"
      className={`fixed inset-y-0 left-0 z-40 w-64 bg-white text-slate-700 flex flex-col h-screen shrink-0 border-r border-slate-200 shadow-sm select-none transition-transform lg:static lg:translate-x-0 ${
        isOpen ? 'translate-x-0' : '-translate-x-full'
      }`}
    >
      {/* Brand Header */}
      <div className="h-16 flex items-center justify-between px-6 border-b border-slate-200/80 bg-slate-50/60">
        <PlanAutLogo variant="full" theme="light" size="sm" />
        <button
          type="button"
          aria-label="Fechar menu"
          onClick={onClose}
          className="ml-auto p-2 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 lg:hidden"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Primary Action Button */}
      <div className="p-4 border-b border-slate-100">
        <NavLink
          to="/nova-solicitacao"
          onClick={onNavigate}
          className={({ isActive }) =>
            `flex items-center justify-center gap-2 w-full py-2.5 px-4 rounded-lg text-xs font-bold transition-all shadow-sm ${
              isActive
                ? 'bg-cyan-600 text-white shadow-cyan-600/30 ring-2 ring-cyan-500/30'
                : 'bg-gradient-to-r from-cyan-600 via-blue-600 to-indigo-600 hover:from-cyan-500 hover:to-blue-500 text-white shadow-blue-500/20'
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
          <div className="px-3 mb-2 text-[10px] font-extrabold uppercase tracking-wider text-slate-400">
            Operação Diária
          </div>
          <nav className="space-y-1">
            {mainNav.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                onClick={onNavigate}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-3 py-2 rounded-lg text-xs font-semibold transition-all ${
                    isActive
                      ? 'bg-cyan-50 text-cyan-800 font-bold border-l-3 border-cyan-600 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100/80'
                  }`
                }
              >
                <item.icon className="w-4 h-4 shrink-0 text-cyan-700" />
                <span>{item.label}</span>
              </NavLink>
            ))}
          </nav>
        </div>

        {/* Administration Section */}
        {isAdmin && (
          <div>
            <div className="px-3 mb-2 text-[10px] font-extrabold uppercase tracking-wider text-amber-700 flex items-center gap-1.5">
              <ShieldAlert className="w-3.5 h-3.5 text-amber-600" />
              <span>Área Administrativa</span>
            </div>
            <nav className="space-y-1">
              <NavLink
                to="/templates"
                onClick={onNavigate}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-3 py-2 rounded-lg text-xs font-semibold transition-all ${
                    isActive
                      ? 'bg-amber-50 text-amber-800 font-bold border-l-3 border-amber-600 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100/80'
                  }`
                }
              >
                <FileCode2 className="w-4 h-4 shrink-0 text-amber-600" />
                <span>Modelos de Planilha</span>
              </NavLink>
              <NavLink
                to="/usuarios"
                onClick={onNavigate}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-3 py-2 rounded-lg text-xs font-semibold transition-all ${
                    isActive
                      ? 'bg-amber-50 text-amber-800 font-bold border-l-3 border-amber-600 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100/80'
                  }`
                }
              >
                <Users className="w-4 h-4 shrink-0 text-amber-600" />
                <span>Usuários</span>
              </NavLink>
            </nav>
          </div>
        )}
      </div>

      {/* Institutional Codisplan & User Footer */}
      <div className="p-3.5 border-t border-slate-200 bg-slate-50/80 space-y-2.5">
        <div className="flex items-center justify-between px-1">
          <span className="text-[9px] uppercase font-extrabold tracking-widest text-slate-400">Escritório</span>
          <CodisplanLogo size="xs" />
        </div>

        <div className="pt-2 border-t border-slate-200/60 flex items-center justify-between">
          <div className="flex items-center gap-2.5 overflow-hidden">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 border ${
              isAdmin
                ? 'bg-amber-100 text-amber-700 border-amber-300'
                : 'bg-cyan-100 text-cyan-800 border-cyan-200'
            }`}>
              {isAdmin ? <ShieldCheck className="w-4 h-4" /> : <UserIcon className="w-4 h-4" />}
            </div>
            <div className="overflow-hidden">
              <p className="text-xs font-bold text-slate-800 truncate">{user?.nome || 'Operador'}</p>
              <div className="flex items-center gap-1">
                <span className={`text-[10px] font-medium truncate ${
                  isAdmin ? 'text-amber-700 font-semibold' : 'text-slate-500'
                }`}>
                  {user?.cargo || (isAdmin ? 'Contador Sênior' : 'Analista Fiscal')}
                </span>
              </div>
            </div>
          </div>
          <button
            onClick={onLogout}
            aria-label="Sair do sistema"
            title="Sair do sistema"
            className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>

        <div className="pt-2 border-t border-slate-200/60 text-center">
          <p className="text-[10px] text-slate-400 font-medium">
            Desenvolvido por <span className="text-slate-600 font-semibold">Rodrigo Sena</span>
          </p>
        </div>
      </div>
    </aside>
  );
};
