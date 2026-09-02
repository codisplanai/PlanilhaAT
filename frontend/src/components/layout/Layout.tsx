import React, { useState } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import type { User } from '../../types/auth';
import { Menu } from 'lucide-react';
import { PlanAutLogo } from '../ui/PlanAutLogo';

interface LayoutProps {
  user: User;
  onLogout: () => void | Promise<void>;
}

export const Layout: React.FC<LayoutProps> = ({ user, onLogout }) => {
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const handleLogout = async () => {
    await onLogout();
    navigate('/login');
  };

  return (
    <div className="flex h-screen bg-slate-50/80 text-slate-900 overflow-hidden font-sans">
      {/* Mobile Backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-slate-950/40 backdrop-blur-sm lg:hidden transition-opacity duration-200"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}
      <Sidebar
        user={user}
        onLogout={handleLogout}
        isOpen={sidebarOpen}
        onNavigate={() => setSidebarOpen(false)}
        onClose={() => setSidebarOpen(false)}
      />
      <main className="flex-1 overflow-y-auto flex flex-col bg-slate-50/80">
        <header className="h-16 shrink-0 px-4 sm:px-6 flex items-center justify-between bg-white/90 backdrop-blur-md border-b border-slate-200/80 text-slate-800 lg:hidden shadow-2xs sticky top-0 z-20">
          <div className="flex items-center gap-3">
            <button
              type="button"
              aria-label="Abrir menu"
              aria-expanded={sidebarOpen}
              onClick={() => setSidebarOpen(true)}
              className="p-2 -ml-2 rounded-lg text-slate-600 hover:bg-slate-100 hover:text-slate-900 cursor-pointer"
            >
              <Menu className="w-5 h-5" />
            </button>
            <PlanAutLogo variant="compact" theme="light" size="sm" />
          </div>
        </header>
        <div className="flex-1 p-4 sm:p-6 lg:p-8 max-w-7xl w-full mx-auto animate-fade-in">
          <Outlet />
        </div>
      </main>
    </div>
  );
};
