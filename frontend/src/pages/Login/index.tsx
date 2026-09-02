import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ArrowRight, Eye, EyeOff, Lock, Mail, ShieldCheck, User as UserIcon } from 'lucide-react';
import { PlanAutLogo } from '../../components/ui/PlanAutLogo';
import { CodisplanLogo } from '../../components/ui/CodisplanLogo';

import { authApi } from '../../api/auth';
import { getErrorMessage } from '../../api/client';
import { Button } from '../../components/ui/Button';
import { ErrorAlert } from '../../components/feedback/ErrorAlert';
import type { User } from '../../types/auth';

const loginSchema = z.object({
  email: z.string().min(1, 'Informe seu e-mail institucional').email('Formato de e-mail inválido'),
  password: z.string().min(1, 'Informe sua senha de acesso'),
});

type LoginFormData = z.infer<typeof loginSchema>;

interface LoginPageProps {
  onAuthenticated: (user: User, token: string) => void;
}

export const LoginPage: React.FC<LoginPageProps> = ({ onAuthenticated }) => {
  const [loading, setLoading] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const navigate = useNavigate();

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: '',
      password: '',
    },
  });

  const onSubmit = async (data: LoginFormData) => {
    setLoading(true);
    setServerError(null);
    try {
      const resp = await authApi.login(data);
      onAuthenticated(resp.user, resp.access_token);
      navigate('/');
    } catch (err) {
      setServerError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const handleFillAdmin = () => {
    setValue('email', 'admin@codisplan.com', { shouldValidate: true });
    setValue('password', 'admin', { shouldValidate: true });
  };

  const handleFillOperador = () => {
    setValue('email', 'operador@contabilidade.com', { shouldValidate: true });
    setValue('password', 'fiscal', { shouldValidate: true });
  };

  const showDemoLogin = import.meta.env.VITE_ENABLE_DEMO_LOGIN !== 'false';

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 via-slate-100/70 to-slate-200/50 flex flex-col justify-center py-12 sm:px-6 lg:px-8 relative overflow-hidden selection:bg-cyan-500 selection:text-white">
      {/* Ambient background decoration */}
      <div className="absolute -top-40 -left-40 w-96 h-96 bg-blue-400/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute -bottom-40 -right-40 w-96 h-96 bg-cyan-400/10 rounded-full blur-3xl pointer-events-none" />

      <div className="sm:mx-auto sm:w-full sm:max-w-md text-center relative z-10 px-4 sm:px-0">
        {/* Codisplan Accounting Firm Header Badge */}
        <div className="flex justify-center mb-5">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/90 shadow-2xs border border-slate-200/90 backdrop-blur-xs">
            <span className="text-[9px] uppercase font-extrabold tracking-widest text-slate-400">Escritório:</span>
            <CodisplanLogo size="xs" />
          </div>
        </div>

        <div className="flex justify-center mb-3">
          <PlanAutLogo variant="icon" theme="light" size="xl" />
        </div>
        <h2 className="text-3xl font-black tracking-tight text-slate-900">
          Plan<span className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-600 via-teal-600 to-emerald-600">Aut</span>
        </h2>
        <p className="mt-1.5 text-xs font-medium text-slate-500 max-w-sm mx-auto leading-relaxed">
          Automação Contábil e Fiscal de Antecipação, ICMS e DIFAL
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md px-4 sm:px-0 relative z-10">
        <div className="bg-white/95 backdrop-blur-sm py-8 px-6 shadow-xl shadow-slate-200/60 rounded-2xl sm:px-10 border border-slate-200/90 animate-scale-in">
          {serverError && (
            <ErrorAlert
              title="Falha na autenticação"
              message={serverError}
              onDismiss={() => setServerError(null)}
            />
          )}

          <form className="space-y-4" onSubmit={handleSubmit(onSubmit)}>
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-700">
                E-mail Institucional
              </label>
              <div className="relative flex items-center">
                <div className="absolute left-3 pointer-events-none text-slate-400">
                  <Mail className="w-4 h-4" />
                </div>
                <input
                  type="email"
                  placeholder="seu.email@contabilidade.com"
                  autoComplete="email"
                  {...register('email')}
                  className={`w-full pl-9.5 pr-3 py-2 text-sm bg-white border rounded-lg shadow-2xs transition-all duration-150 focus:outline-none focus:ring-4 focus:ring-blue-500/15 focus:border-blue-600 placeholder:text-slate-400 text-slate-900 ${
                    errors.email ? 'border-rose-500 bg-rose-50/20' : 'border-slate-200/90 hover:border-slate-300'
                  }`}
                />
              </div>
              {errors.email && (
                <p className="text-xs text-rose-600 font-medium mt-1">{errors.email.message}</p>
              )}
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-700">
                Senha de Acesso
              </label>
              <div className="relative flex items-center">
                <div className="absolute left-3 pointer-events-none text-slate-400">
                  <Lock className="w-4 h-4" />
                </div>
                <input
                  type={showPassword ? 'text' : 'password'}
                  placeholder="••••••••"
                  autoComplete="current-password"
                  {...register('password')}
                  className={`w-full pl-9.5 pr-10 py-2 text-sm bg-white border rounded-lg shadow-2xs transition-all duration-150 focus:outline-none focus:ring-4 focus:ring-blue-500/15 focus:border-blue-600 placeholder:text-slate-400 text-slate-900 ${
                    errors.password ? 'border-rose-500 bg-rose-50/20' : 'border-slate-200/90 hover:border-slate-300'
                  }`}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 text-slate-400 hover:text-slate-700 cursor-pointer"
                  aria-label={showPassword ? 'Ocultar senha' : 'Exibir senha'}
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {errors.password && (
                <p className="text-xs text-rose-600 font-medium mt-1">{errors.password.message}</p>
              )}
            </div>

            <div className="pt-2">
              <Button
                type="submit"
                className="w-full justify-center"
                size="md"
                isLoading={loading}
                rightIcon={<ArrowRight className="w-4 h-4" />}
              >
                Entrar no Sistema
              </Button>
            </div>
          </form>

          {showDemoLogin && (
            <div className="mt-6 pt-4 border-t border-slate-100 bg-slate-50/70 p-3.5 rounded-xl border border-slate-200/60 text-center space-y-2">
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                Acesso Rápido de Teste:
              </p>
              <div className="flex flex-col sm:flex-row justify-center gap-2">
                <button
                  type="button"
                  onClick={handleFillAdmin}
                  className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-amber-200/90 text-xs font-bold text-amber-800 hover:bg-amber-50/80 hover:border-amber-400 shadow-2xs transition-all duration-150 active:scale-[0.98] cursor-pointer"
                >
                  <ShieldCheck className="w-3.5 h-3.5 text-amber-600" />
                  <span>Admin (Contador Sênior)</span>
                </button>
                <button
                  type="button"
                  onClick={handleFillOperador}
                  className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-100/80 shadow-2xs transition-all duration-150 active:scale-[0.98] cursor-pointer"
                >
                  <UserIcon className="w-3.5 h-3.5 text-slate-500" />
                  <span>Operador (Analista Fiscal)</span>
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="mt-6 text-center space-y-1">
          <p className="text-xs text-slate-500">
            Uso restrito da equipe contábil interna. Não compartilhe suas credenciais.
          </p>
          <p className="text-[11px] text-slate-400">
            Desenvolvido por <span className="text-slate-600 font-semibold">Rodrigo Sena</span>
          </p>
        </div>
      </div>
    </div>
  );
};
