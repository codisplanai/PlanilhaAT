import React, { useState } from 'react';
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
  KeyRound,
  X,
  Sparkles,
} from 'lucide-react';
import { PlanAutLogo } from '../ui/PlanAutLogo';
import { CodisplanLogo } from '../ui/CodisplanLogo';
import { AlterarSenhaModal } from '../auth/AlterarSenhaModal';
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
  const [isAlterarSenhaOpen, setIsAlterarSenhaOpen] = useState(false);

  const mainNav = [
    { to: '/', label: 'Visão Geral', icon: LayoutDashboard, end: true },
    { to: '/solicitacoes', label: 'Histórico de Planilhas', icon: History },
    { to: '/empresas', label: 'Empresas Clientes', icon: Building2 },
    { to: '/perfis-regras', label: 'Perfis e Alíquotas', icon: Sliders },
  ];

  return (
    <aside
      aria-label="Navegação principal"
      className={`fixed inset-y-0 left-0 z-40 w-68 bg-slate-900 text-slate-200 flex flex-col h-screen shrink-0 border-r border-slate-800 shadow-xl select-none transition-transform duration-200 ease-in-out lg:static lg:translate-x-0 ${
        isOpen ? 'translate-x-0' : '-translate-x-full'
      }`}
    >
      {/* Brand Header */}
      <div className="h-16 flex items-center justify-between px-5 border-b border-slate-800 bg-slate-950/60">
        <PlanAutLogo variant="full" theme="dark" size="md" />
        <button
          type="button"
          aria-label="Fechar menu"
          onClick={onClose}
          className="ml-auto p-1.5 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800 lg:hidden cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Primary Action Button */}
      <div className="p-4 border-b border-slate-800/80">
        <NavLink
          to="/nova-solicitacao"
          onClick={onNavigate}
          className={({ isActive }) =>
            `group relative flex items-center justify-center gap-2.5 w-full py-2.5 px-4 rounded-xl text-xs font-bold transition-all duration-150 active:scale-[0.98] shadow-sm ${
              isActive
                ? 'bg-blue-600 text-white shadow-blue-900/40 ring-2 ring-blue-400/40'
                : 'bg-gradient-to-r from-blue-600 via-blue-700 to-indigo-700 hover:from-blue-500 hover:via-blue-600 hover:to-indigo-600 text-white shadow-md shadow-blue-950/40'
            }`
          }
        >
          <PlusCircle className="w-4 h-4 transition-transform group-hover:rotate-90 duration-200" />
          <span>Gerar Nova Planilha</span>
          <Sparkles className="w-3.5 h-3.5 opacity-70 group-hover:opacity-100 transition-opacity" />
        </NavLink>
      </div>

      {/* Navigation Links */}
      <div className="flex-1 overflow-y-auto py-4 px-3 space-y-6">
        <div>
          <div className="px-3 mb-2 text-[10px] font-bold uppercase tracking-wider text-slate-400 flex items-center justify-between">
            <span>Operação Diária</span>
          </div>
          <nav className="space-y-1">
            {mainNav.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                onClick={onNavigate}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-3 py-2 rounded-lg text-xs font-semibold transition-all duration-150 ${
                    isActive
                      ? 'bg-blue-500/15 text-blue-400 font-bold border-l-3 border-blue-500 shadow-2xs'
                      : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800/70'
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    <item.icon
                      className={`w-4 h-4 shrink-0 transition-colors ${
                        isActive ? 'text-blue-400' : 'text-slate-400 group-hover:text-slate-200'
                      }`}
                    />
                    <span className="truncate">{item.label}</span>
                  </>
                )}
              </NavLink>
            ))}
          </nav>
        </div>

        {/* Administration Section */}
        {isAdmin && (
          <div>
            <div className="px-3 mb-2 text-[10px] font-bold uppercase tracking-wider text-amber-400 flex items-center gap-1.5">
              <ShieldAlert className="w-3.5 h-3.5 text-amber-400" />
              <span>Área Administrativa</span>
            </div>
            <nav className="space-y-1">
              <NavLink
                to="/templates"
                onClick={onNavigate}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-3 py-2 rounded-lg text-xs font-semibold transition-all duration-150 ${
                    isActive
                      ? 'bg-amber-500/15 text-amber-400 font-bold border-l-3 border-amber-500 shadow-2xs'
                      : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800/70'
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    <FileCode2
                      className={`w-4 h-4 shrink-0 transition-colors ${
                        isActive ? 'text-amber-400' : 'text-slate-400 group-hover:text-slate-200'
                      }`}
                    />
                    <span>Modelos de Planilha</span>
                  </>
                )}
              </NavLink>
              <NavLink
                to="/usuarios"
                onClick={onNavigate}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-3 py-2 rounded-lg text-xs font-semibold transition-all duration-150 ${
                    isActive
                      ? 'bg-amber-500/15 text-amber-400 font-bold border-l-3 border-amber-500 shadow-2xs'
                      : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800/70'
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    <Users
                      className={`w-4 h-4 shrink-0 transition-colors ${
                        isActive ? 'text-amber-400' : 'text-slate-400 group-hover:text-slate-200'
                      }`}
                    />
                    <span>Usuários</span>
                  </>
                )}
              </NavLink>
            </nav>
          </div>
        )}
      </div>

      {/* Institutional Codisplan & User Footer */}
      <div className="p-3.5 border-t border-slate-800 bg-slate-950/60 space-y-2.5">
        <div className="flex items-center justify-between px-1">
          <span className="text-[9px] uppercase font-extrabold tracking-widest text-slate-400">Escritório</span>
          <CodisplanLogo size="xs" theme="dark" />
        </div>

        <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between">
          <div className="flex items-center gap-2.5 overflow-hidden">
            <div
              className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 border shadow-2xs ${
                isAdmin
                  ? 'bg-amber-950/50 text-amber-400 border-amber-700/60'
                  : 'bg-blue-950/50 text-blue-400 border-blue-700/60'
              }`}
            >
              {isAdmin ? <ShieldCheck className="w-4 h-4" /> : <UserIcon className="w-4 h-4" />}
            </div>
            <div className="overflow-hidden">
              <p className="text-xs font-bold text-slate-100 truncate">{user?.nome || 'Operador'}</p>
              <div className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
                <span
                  className={`text-[10px] font-medium truncate ${
                    isAdmin ? 'text-amber-400 font-semibold' : 'text-slate-400'
                  }`}
                >
                  {user?.cargo || (isAdmin ? 'Contador Sênior' : 'Analista Fiscal')}
                </span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => setIsAlterarSenhaOpen(true)}
              aria-label="Alterar minha senha"
              title="Alterar minha senha"
              className="p-1.5 rounded-lg text-slate-400 hover:text-blue-400 hover:bg-slate-800 transition-colors cursor-pointer"
            >
              <KeyRound className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={onLogout}
              aria-label="Sair do sistema"
              title="Sair do sistema"
              className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-slate-800 transition-colors cursor-pointer"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="pt-2 border-t border-slate-800/80 text-center">
          <p className="text-[10px] text-slate-500 font-medium">
            Desenvolvido por <span className="text-slate-300 font-semibold">Rodrigo Sena</span>
          </p>
        </div>
      </div>

      <AlterarSenhaModal
        isOpen={isAlterarSenhaOpen}
        onClose={() => setIsAlterarSenhaOpen(false)}
      />
    </aside>
  );
};
