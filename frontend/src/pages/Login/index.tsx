import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { FileSpreadsheet, ArrowRight } from 'lucide-react';

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
  const navigate = useNavigate();
  const [serverError, setServerError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

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
    setServerError(null);
    setLoading(true);
    try {
      const response = await authApi.login(data);
      onAuthenticated(response.user, response.access_token);
      navigate('/');
    } catch (err) {
      setServerError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const handleUseDemo = () => {
    setValue('email', 'admin@contabilidade.com');
    setValue('password', 'admin');
  };

  return (
    <div className="min-h-screen bg-slate-900 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md text-center">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-blue-600 text-white shadow-lg shadow-blue-600/30 mb-4">
          <FileSpreadsheet className="w-7 h-7" />
        </div>
        <h2 className="text-2xl font-bold tracking-tight text-white">
          Planilha AT — Acesso Interno
        </h2>
        <p className="mt-1.5 text-xs text-slate-400">
          Automação de Antecipação Tributária, ICMS e DIFAL para Escritório Contábil
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md px-4 sm:px-0">
        <div className="bg-white py-8 px-6 shadow-xl rounded-xl sm:px-10 border border-slate-200">
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
                className="w-full justify-center"
                size="md"
                isLoading={loading}
                rightIcon={<ArrowRight className="w-4 h-4" />}
              >
                Entrar no Sistema
              </Button>
            </div>
          </form>

          {/* Quick Fill Box for Internal Team */}
          <div className="mt-6 pt-4 border-t border-slate-100 bg-slate-50 p-3 rounded-md text-center">
            <p className="text-[11px] text-slate-500 mb-2">
              Acesso padrão de administrador do escritório:
            </p>
            <button
              type="button"
              onClick={handleUseDemo}
              className="text-xs font-semibold text-blue-700 hover:text-blue-900 underline"
            >
              Preencher com admin@contabilidade.com
            </button>
          </div>
        </div>

        <p className="mt-6 text-center text-xs text-slate-500">
          Uso restrito da equipe contábil interna. Não compartilhe suas credenciais.
        </p>
      </div>
    </div>
  );
};
