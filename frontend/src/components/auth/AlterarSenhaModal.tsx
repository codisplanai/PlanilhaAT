import React, { useState, useRef, useEffect } from 'react';
import { isAxiosError } from 'axios';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { PasswordInput } from '../ui/PasswordInput';
import { authApi } from '../../api/auth';
import { CheckCircle2 } from 'lucide-react';
import { ErrorAlert } from '../feedback/ErrorAlert';

interface AlterarSenhaModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const AlterarSenhaModal: React.FC<AlterarSenhaModalProps> = ({ isOpen, onClose }) => {
  const [senhaAtual, setSenhaAtual] = useState('');
  const [novaSenha, setNovaSenha] = useState('');
  const [confirmarSenha, setConfirmarSenha] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const closeTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);
    };
  }, []);

  const resetForm = () => {
    setSenhaAtual('');
    setNovaSenha('');
    setConfirmarSenha('');
    setError(null);
    setSuccess(false);
  };

  const handleClose = () => {
    if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);
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
      closeTimerRef.current = window.setTimeout(() => {
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
          <PasswordInput
            id="input-senha-atual"
            label="Senha Atual"
            value={senhaAtual}
            onChange={(e) => setSenhaAtual(e.target.value)}
            placeholder="Informe sua senha atual"
            required
            autoComplete="current-password"
          />

          {/* Nova Senha */}
          <PasswordInput
            id="input-nova-senha"
            label="Nova Senha"
            value={novaSenha}
            onChange={(e) => setNovaSenha(e.target.value)}
            placeholder="Mínimo 6 caracteres"
            required
            minLength={6}
            helperText="A senha deve conter no mínimo 6 caracteres."
            autoComplete="new-password"
          />

          {/* Confirmar Nova Senha */}
          <PasswordInput
            id="input-confirmar-senha"
            label="Confirmar Nova Senha"
            value={confirmarSenha}
            onChange={(e) => setConfirmarSenha(e.target.value)}
            placeholder="Repita a nova senha"
            required
            minLength={6}
            autoComplete="new-password"
          />

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
              isLoading={loading}
            >
              Salvar Nova Senha
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
};
