import React, { useState } from 'react';
import { isAxiosError } from 'axios';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { authApi } from '../../api/auth';
import { KeyRound, Eye, EyeOff, CheckCircle2 } from 'lucide-react';
import { ErrorAlert } from '../feedback/ErrorAlert';

interface AlterarSenhaModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const AlterarSenhaModal: React.FC<AlterarSenhaModalProps> = ({ isOpen, onClose }) => {
  const [senhaAtual, setSenhaAtual] = useState('');
  const [novaSenha, setNovaSenha] = useState('');
  const [confirmarSenha, setConfirmarSenha] = useState('');
  
  const [showSenhaAtual, setShowSenhaAtual] = useState(false);
  const [showNovaSenha, setShowNovaSenha] = useState(false);
  const [showConfirmarSenha, setShowConfirmarSenha] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const resetForm = () => {
    setSenhaAtual('');
    setNovaSenha('');
    setConfirmarSenha('');
    setShowSenhaAtual(false);
    setShowNovaSenha(false);
    setShowConfirmarSenha(false);
    setError(null);
    setSuccess(false);
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!senhaAtual.trim()) {
      setError('Por favor, informe a senha atual.');
      return;
    }

    if (novaSenha.length < 6) {
      setError('A nova senha deve ter no mínimo 6 caracteres.');
      return;
    }

    if (novaSenha === senhaAtual) {
      setError('A nova senha deve ser diferente da senha atual.');
      return;
    }

    if (novaSenha !== confirmarSenha) {
      setError('A confirmação não coincide com a nova senha.');
      return;
    }

    setLoading(true);
    try {
      await authApi.alterarSenha({
        senha_atual: senhaAtual,
        nova_senha: novaSenha,
      });
      setSuccess(true);
      setTimeout(() => {
        handleClose();
      }, 1800);
    } catch (err) {
      const responseData = isAxiosError<{ detail?: string; message?: string }>(err)
        ? err.response?.data
        : undefined;
      const msg =
        responseData?.detail ||
        responseData?.message ||
        'Não foi possível alterar a senha. Verifique os dados e tente novamente.';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Alterar Minha Senha"
      subtitle="Atualize sua senha de acesso ao sistema"
      maxWidth="md"
    >
      {success ? (
        <div className="py-8 text-center space-y-3 animate-fade-in">
          <div className="w-14 h-14 rounded-2xl bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto shadow-2xs">
            <CheckCircle2 className="w-8 h-8" />
          </div>
          <h3 className="text-base font-bold text-slate-900 tracking-tight">
            Senha alterada com sucesso!
          </h3>
          <p className="text-xs text-slate-500">
            Sua nova senha já está ativa para os próximos acessos.
          </p>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <ErrorAlert
              title="Atenção"
              message={error}
              onDismiss={() => setError(null)}
            />
          )}

          {/* Senha Atual */}
          <div className="space-y-1.5">
            <label
              htmlFor="input-senha-atual"
              className="block text-xs font-semibold uppercase tracking-wider text-slate-700"
            >
              Senha Atual
            </label>
            <div className="relative">
              <input
                id="input-senha-atual"
                type={showSenhaAtual ? 'text' : 'password'}
                value={senhaAtual}
                onChange={(e) => setSenhaAtual(e.target.value)}
                placeholder="Informe sua senha atual"
                required
                className="w-full pl-3 pr-10 py-2 text-sm bg-white border border-slate-200/90 rounded-lg shadow-2xs transition-all duration-150 focus:outline-none focus:ring-4 focus:ring-blue-500/15 focus:border-blue-600 placeholder:text-slate-400 text-slate-900"
              />
              <button
                type="button"
                onClick={() => setShowSenhaAtual(!showSenhaAtual)}
                className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-700 cursor-pointer"
                tabIndex={-1}
                aria-label={showSenhaAtual ? 'Ocultar senha' : 'Exibir senha'}
              >
                {showSenhaAtual ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Nova Senha */}
          <div className="space-y-1.5">
            <label
              htmlFor="input-nova-senha"
              className="block text-xs font-semibold uppercase tracking-wider text-slate-700"
            >
              Nova Senha
            </label>
            <div className="relative">
              <input
                id="input-nova-senha"
                type={showNovaSenha ? 'text' : 'password'}
                value={novaSenha}
                onChange={(e) => setNovaSenha(e.target.value)}
                placeholder="Mínimo 6 caracteres"
                required
                minLength={6}
                className="w-full pl-3 pr-10 py-2 text-sm bg-white border border-slate-200/90 rounded-lg shadow-2xs transition-all duration-150 focus:outline-none focus:ring-4 focus:ring-blue-500/15 focus:border-blue-600 placeholder:text-slate-400 text-slate-900"
              />
              <button
                type="button"
                onClick={() => setShowNovaSenha(!showNovaSenha)}
                className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-700 cursor-pointer"
                tabIndex={-1}
                aria-label={showNovaSenha ? 'Ocultar senha' : 'Exibir senha'}
              >
                {showNovaSenha ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <p className="text-[11px] text-slate-400">
              A senha deve conter no mínimo 6 caracteres.
            </p>
          </div>

          {/* Confirmar Nova Senha */}
          <div className="space-y-1.5">
            <label
              htmlFor="input-confirmar-senha"
              className="block text-xs font-semibold uppercase tracking-wider text-slate-700"
            >
              Confirmar Nova Senha
            </label>
            <div className="relative">
              <input
                id="input-confirmar-senha"
                type={showConfirmarSenha ? 'text' : 'password'}
                value={confirmarSenha}
                onChange={(e) => setConfirmarSenha(e.target.value)}
                placeholder="Repita a nova senha"
                required
                minLength={6}
                className="w-full pl-3 pr-10 py-2 text-sm bg-white border border-slate-200/90 rounded-lg shadow-2xs transition-all duration-150 focus:outline-none focus:ring-4 focus:ring-blue-500/15 focus:border-blue-600 placeholder:text-slate-400 text-slate-900"
              />
              <button
                type="button"
                onClick={() => setShowConfirmarSenha(!showConfirmarSenha)}
                className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-700 cursor-pointer"
                tabIndex={-1}
                aria-label={showConfirmarSenha ? 'Ocultar senha' : 'Exibir senha'}
              >
                {showConfirmarSenha ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Actions */}
          <div className="pt-4 border-t border-slate-100 flex items-center justify-end gap-2.5">
            <Button
              type="button"
              variant="outline"
              onClick={handleClose}
              disabled={loading}
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              variant="primary"
              isLoading={loading}
              leftIcon={<KeyRound className="w-4 h-4" />}
            >
              Salvar Nova Senha
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
};
