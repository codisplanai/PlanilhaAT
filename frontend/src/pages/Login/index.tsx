import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  ArrowRight,
  Eye,
  EyeOff,
  Lock,
  Mail,
  ShieldCheck,
  Sparkles,
  CheckCircle2,
  FileSpreadsheet,
  Calculator,
} from 'lucide-react';
import { PlanAutLogo } from '../../components/ui/PlanAutLogo';
import { CodisplanLogo } from '../../components/ui/CodisplanLogo';

import { authApi } from '../../api/auth';
import { getErrorMessage } from '../../api/client';
import { Button } from '../../components/ui/Button';
import { ErrorAlert } from '../../components/feedback/ErrorAlert';
import type { User } from '../../types/auth';

const loginSchema = z.object({
  email: z
    .string()
    .min(1, 'Informe seu e-mail institucional')
    .email('Formato de e-mail inválido'),
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

  return (
    <div className="min-h-screen flex flex-col lg:flex-row bg-slate-50 selection:bg-cyan-500 selection:text-white">
      {/* ── Painel Esquerdo: Identidade Visual e Recursos (Desktop) ── */}
      <div className="relative hidden lg:flex lg:w-5/12 xl:w-1/2 flex-col justify-between p-12 xl:p-16 bg-slate-950 text-white overflow-hidden">
        {/* Glows de Fundo Sofisticados */}
        <div className="absolute -top-32 -left-32 w-96 h-96 bg-cyan-500/15 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute top-1/2 -right-32 w-96 h-96 bg-blue-600/15 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-24 left-1/4 w-80 h-80 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />

        {/* Textura geométrica sutil */}
        <div
          className="absolute inset-0 opacity-[0.03] pointer-events-none"
          style={{
            backgroundImage: `radial-gradient(circle at 1px 1px, white 1px, transparent 0)`,
            backgroundSize: '32px 32px',
          }}
        />

        {/* Header do Painel Esquerdo */}
        <div className="relative z-10">
          <PlanAutLogo variant="full" theme="dark" size="lg" />
        </div>

        {/* Conteúdo Central Institucional */}
        <div className="relative z-10 max-w-lg space-y-8 my-auto py-8">
          <div className="space-y-4">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-cyan-950/70 border border-cyan-500/30 text-cyan-300 text-xs font-semibold backdrop-blur-xs">
              <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
              <span>Automação Fiscal Integrada</span>
            </div>

            <h1 className="text-3xl xl:text-4xl font-extrabold tracking-tight text-white leading-tight">
              Cálculo fiscal preciso, ágil e em total conformidade.
            </h1>

            <p className="text-sm xl:text-base text-slate-400 leading-relaxed">
              Plataforma contábil para apuração determinística de Antecipação
              Parcial, Antecipação Tributária e DIFAL, gerando planilhas oficiais
              com fórmulas auditáveis.
            </p>
          </div>

          {/* Destaques de Funcionalidades */}
          <div className="space-y-3 pt-2">
            <div className="flex items-center gap-3 p-3 rounded-xl bg-slate-900/60 border border-slate-800/80 backdrop-blur-xs">
              <div className="w-9 h-9 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-400 flex items-center justify-center shrink-0">
                <Calculator className="w-4 h-4" />
              </div>
              <div className="text-xs">
                <p className="font-semibold text-slate-200">
                  Resolução Determinística de MVA
                </p>
                <p className="text-slate-400">
                  Tabela oficial do Anexo I (Decreto 13.780/2012) da SEFAZ Bahia
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3 p-3 rounded-xl bg-slate-900/60 border border-slate-800/80 backdrop-blur-xs">
              <div className="w-9 h-9 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0">
                <FileSpreadsheet className="w-4 h-4" />
              </div>
              <div className="text-xs">
                <p className="font-semibold text-slate-200">
                  Planilhas com Fórmulas Vivas
                </p>
                <p className="text-slate-400">
                  Templates Excel padronizados com rastreabilidade total
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3 p-3 rounded-xl bg-slate-900/60 border border-slate-800/80 backdrop-blur-xs">
              <div className="w-9 h-9 rounded-lg bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 flex items-center justify-center shrink-0">
                <CheckCircle2 className="w-4 h-4" />
              </div>
              <div className="text-xs">
                <p className="font-semibold text-slate-200">
                  Roteamento Inteligente por CFOP
                </p>
                <p className="text-slate-400">
                  Distribuição automática de notas entre as guias de apuração
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Rodapé do Painel Esquerdo */}
        <div className="relative z-10 pt-8 border-t border-slate-800/80 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-[11px] font-bold uppercase tracking-widest text-slate-500">
              Escritório Contábil:
            </span>
            <div className="inline-flex items-center px-2 py-0.5 rounded-md bg-slate-900/90 border border-slate-800 shadow-2xs">
              <CodisplanLogo theme="dark" size="xs" />
            </div>
          </div>
          <span className="text-[11px] font-medium text-slate-500">
            Bahia · 2026
          </span>
        </div>
      </div>

      {/* ── Painel Direito: Formulário de Autenticação ── */}
      <div className="flex-1 flex flex-col justify-between p-6 sm:p-10 lg:p-14 xl:p-16">
        <div className="w-full max-w-md mx-auto my-auto py-8">
          {/* Header Mobile / Tablet (Oculto em Desktop) */}
          <div className="lg:hidden text-center mb-8 space-y-4">
            <div className="flex justify-center">
              <PlanAutLogo variant="full" theme="light" size="md" />
            </div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-slate-100/90 border border-slate-200/80 text-xs shadow-2xs">
              <span className="text-[10px] uppercase font-bold tracking-widest text-slate-400">
                Escritório:
              </span>
              <CodisplanLogo size="xs" />
            </div>
          </div>

          {/* Cartão de Autenticação */}
          <div className="bg-white rounded-2xl border border-slate-200/90 shadow-xl shadow-slate-200/40 p-7 sm:p-9 space-y-6">
            <div className="space-y-1.5">
              <h2 className="text-2xl font-bold tracking-tight text-slate-900">
                Acesse sua conta
              </h2>
              <p className="text-xs sm:text-sm text-slate-500 leading-relaxed">
                Informe suas credenciais institucionais para acessar a
                plataforma.
              </p>
            </div>

            {serverError && (
              <ErrorAlert
                title="Falha na autenticação"
                message={serverError}
                onDismiss={() => setServerError(null)}
              />
            )}

            <form className="space-y-4" onSubmit={handleSubmit(onSubmit)}>
              {/* Campo: E-mail */}
              <div className="space-y-1.5">
                <label
                  htmlFor="login-email"
                  className="block text-xs font-bold uppercase tracking-wider text-slate-700"
                >
                  E-mail Corporativo
                </label>
                <div className="relative flex items-center">
                  <div className="absolute left-3.5 pointer-events-none text-slate-400">
                    <Mail className="w-4 h-4" />
                  </div>
                  <input
                    id="login-email"
                    type="email"
                    placeholder="seu.email@codisplan.com"
                    autoComplete="email"
                    {...register('email')}
                    className={`w-full pl-10 pr-3.5 py-2.5 text-sm bg-slate-50/50 border rounded-xl shadow-2xs transition-all duration-150 focus:outline-none focus:bg-white focus:ring-4 focus:ring-blue-500/15 focus:border-blue-600 placeholder:text-slate-400 text-slate-900 ${
                      errors.email
                        ? 'border-rose-500 bg-rose-50/20'
                        : 'border-slate-200 hover:border-slate-300'
                    }`}
                  />
                </div>
                {errors.email && (
                  <p className="text-xs text-rose-600 font-medium mt-1">
                    {errors.email.message}
                  </p>
                )}
              </div>

              {/* Campo: Senha */}
              <div className="space-y-1.5">
                <label
                  htmlFor="login-password"
                  className="block text-xs font-bold uppercase tracking-wider text-slate-700"
                >
                  Senha de Acesso
                </label>
                <div className="relative flex items-center">
                  <div className="absolute left-3.5 pointer-events-none text-slate-400">
                    <Lock className="w-4 h-4" />
                  </div>
                  <input
                    id="login-password"
                    type={showPassword ? 'text' : 'password'}
                    placeholder="••••••••"
                    autoComplete="current-password"
                    {...register('password')}
                    className={`w-full pl-10 pr-11 py-2.5 text-sm bg-slate-50/50 border rounded-xl shadow-2xs transition-all duration-150 focus:outline-none focus:bg-white focus:ring-4 focus:ring-blue-500/15 focus:border-blue-600 placeholder:text-slate-400 text-slate-900 ${
                      errors.password
                        ? 'border-rose-500 bg-rose-50/20'
                        : 'border-slate-200 hover:border-slate-300'
                    }`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3.5 text-slate-400 hover:text-slate-700 cursor-pointer p-0.5 rounded-md hover:bg-slate-100 transition-colors"
                    aria-label={showPassword ? 'Ocultar senha' : 'Exibir senha'}
                    tabIndex={-1}
                  >
                    {showPassword ? (
                      <EyeOff className="w-4 h-4" />
                    ) : (
                      <Eye className="w-4 h-4" />
                    )}
                  </button>
                </div>
                {errors.password && (
                  <p className="text-xs text-rose-600 font-medium mt-1">
                    {errors.password.message}
                  </p>
                )}
              </div>

              {/* Botão de Submissão */}
              <div className="pt-2">
                <Button
                  type="submit"
                  className="w-full justify-center py-2.5 text-sm font-bold shadow-md shadow-blue-600/20 rounded-xl"
                  size="md"
                  isLoading={loading}
                  rightIcon={<ArrowRight className="w-4 h-4" />}
                >
                  Entrar no Sistema
                </Button>
              </div>
            </form>

            {/* Aviso de Segurança */}
            <div className="pt-2">
              <div className="flex items-center gap-2.5 p-3 rounded-xl bg-slate-50 border border-slate-200/80 text-[11px] text-slate-500">
                <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
                <span className="leading-tight">
                  Acesso seguro restrito à equipe autorizada Codisplan.
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Rodapé da Página */}
        <div className="text-center space-y-1 pb-4 pt-2">
          <p className="text-xs text-slate-500">
            Desenvolvido por{' '}
            <span className="text-slate-700 font-semibold">Rodrigo Sena</span>
          </p>
          <p className="text-[11px] text-slate-400">
            © {new Date().getFullYear()} Codisplan Contabilidade. Todos os
            direitos reservados.
          </p>
        </div>
      </div>
    </div>
  );
};
