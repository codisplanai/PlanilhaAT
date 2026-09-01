import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ArrowRight } from 'lucide-react';
import { PlanAutLogo } from '../../components/ui/PlanAutLogo';
import { CodisplanLogo } from '../../components/ui/CodisplanLogo';

import { authApi } from '../../api/auth';
import { getErrorMessage } from '../../api/client';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
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
    setValue('email', 'admin@codisplan.com');
    setValue('password', 'admin');
  };

  const handleFillOperador = () => {
    setValue('email', 'operador@contabilidade.com');
    setValue('password', 'fiscal');
  };

  const showDemoLogin = import.meta.env.DEV && import.meta.env.VITE_ENABLE_DEMO_LOGIN === 'true';

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 via-slate-100 to-slate-200/70 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md text-center">
        {/* Codisplan Accounting Firm Header Badge */}
        <div className="flex justify-center mb-4">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white shadow-xs border border-slate-200/80">
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
        <p className="mt-1.5 text-xs font-medium text-slate-500">
          Automação Contábil e Fiscal de Antecipação, ICMS e DIFAL
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md px-4 sm:px-0">
        <div className="bg-white py-8 px-6 shadow-xl shadow-slate-300/40 rounded-2xl sm:px-10 border border-slate-200/90">
          {serverError && (
            <ErrorAlert
              title="Falha na autenticação"
              message={serverError}
              onDismiss={() => setServerError(null)}
            />
          )}

          <form className="space-y-4" onSubmit={handleSubmit(onSubmit)}>
            <div>
              <Input
                label="E-mail de Acesso"
                type="email"
                placeholder="seu.email@contabilidade.com"
                autoComplete="email"
                {...register('email')}
                error={errors.email?.message}
              />
            </div>

            <div>
              <Input
                label="Senha de Acesso"
                type="password"
                placeholder="••••••••"
                autoComplete="current-password"
                {...register('password')}
                error={errors.password?.message}
              />
            </div>

            <div className="pt-2">
              <Button
                type="submit"
                className="w-full justify-center bg-gradient-to-r from-cyan-600 via-blue-600 to-indigo-600 hover:from-cyan-500 hover:to-blue-500 font-bold shadow-md shadow-blue-500/20"
                size="md"
                isLoading={loading}
                rightIcon={<ArrowRight className="w-4 h-4" />}
              >
                Entrar no Sistema
              </Button>
            </div>
          </form>

          {showDemoLogin && (
            <div className="mt-6 pt-4 border-t border-slate-100 bg-slate-50/80 p-3.5 rounded-xl border border-slate-200/60 text-center space-y-2">
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                Acesso Rápido de Teste:
              </p>
              <div className="flex flex-col sm:flex-row justify-center gap-2">
                <button
                  type="button"
                  onClick={handleFillAdmin}
                  className="px-3 py-1.5 rounded-lg bg-white border border-cyan-200 text-xs font-bold text-cyan-800 hover:bg-cyan-50 hover:border-cyan-400 shadow-2xs transition-all"
                >
                  👑 Admin (admin@codisplan.com / admin)
                </button>
                <button
                  type="button"
                  onClick={handleFillOperador}
                  className="px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-100 shadow-2xs transition-all"
                >
                  👤 Operador (operador@contabilidade.com / fiscal)
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
