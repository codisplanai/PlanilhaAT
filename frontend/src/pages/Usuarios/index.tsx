import React from 'react';
import { UserPlus, Users } from 'lucide-react';

import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Modal } from '../../components/ui/Modal';
import { PageHeader } from '../../components/layout/PageHeader';
import { ErrorAlert } from '../../components/feedback/ErrorAlert';
import type { User } from '../../types/auth';
import { useUsuariosPage } from './useUsuariosPage';

interface UsuariosPageProps {
  user: User | null;
}

export const UsuariosPage: React.FC<UsuariosPageProps> = ({ user }) => {
  const {
    usuarios,
    pageError: erro,
    formError: erroFormulario,
    setFormError: setErroFormulario,
    modalOpen: modalAberto,
    openModal: abrirModal,
    closeModal: fecharModal,
    createUser: onSubmit,
    toggleStatus: alternarStatus,
    register,
    errors,
    isSaving: salvando,
  } = useUsuariosPage();

  return (
    <div className="space-y-6">
      <PageHeader
        icon={<Users className="w-5 h-5 text-amber-600" />}
        title="Gestão de Usuários"
        description="Criação de contas de acesso e controle de quem pode entrar no sistema"
        action={
          <Button leftIcon={<UserPlus className="w-4 h-4" />} onClick={abrirModal}>
            Novo Usuário
          </Button>
        }
      />

      {erro && <ErrorAlert message={erro} />}

      <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
            <tr>
              <th className="text-left px-4 py-3">Nome</th>
              <th className="text-left px-4 py-3">E-mail</th>
              <th className="text-left px-4 py-3">Cargo</th>
              <th className="text-left px-4 py-3">Status</th>
              <th className="text-right px-4 py-3">Ação</th>
            </tr>
          </thead>
          <tbody>
            {usuarios.map((u) => (
              <tr key={u.id} className="border-t border-slate-100">
                <td className="px-4 py-3 font-medium text-slate-800">{u.nome}</td>
                <td className="px-4 py-3 text-slate-600">{u.email}</td>
                <td className="px-4 py-3 text-slate-600">{u.cargo}</td>
                <td className="px-4 py-3">
                  <span className={u.ativo ? 'text-emerald-700' : 'text-slate-400'}>
                    {u.ativo ? 'Ativo' : 'Inativo'}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  <button
                    type="button"
                    onClick={() => alternarStatus(u)}
                    disabled={u.id === user?.id}
                    title={u.id === user?.id ? 'Você não pode desativar a sua própria conta' : undefined}
                    className="text-xs font-semibold text-slate-600 hover:text-slate-900 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {u.ativo ? 'Desativar' : 'Ativar'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal isOpen={modalAberto} onClose={fecharModal} title="Novo Usuário">
        {erroFormulario && (
          <ErrorAlert
            title="Erro ao criar usuário"
            message={erroFormulario}
            onDismiss={() => setErroFormulario(null)}
          />
        )}

        <form onSubmit={onSubmit} className="space-y-4">
          <Input label="Nome" {...register('nome')} error={errors.nome?.message} />
          <Input label="E-mail" type="email" {...register('email')} error={errors.email?.message} />
          <Input label="Senha inicial" type="password" {...register('password')} error={errors.password?.message} />
          <div>
            <label className="block text-xs font-bold uppercase tracking-wide text-slate-500 mb-1">
              Papel
            </label>
            <select {...register('role')} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm">
              <option value="operador">Operador — Analista Fiscal</option>
              <option value="admin">Admin — Contador Sênior</option>
            </select>
          </div>
          <Button type="submit" isLoading={salvando} className="w-full">
            {salvando ? 'Criando...' : 'Criar Usuário'}
          </Button>
        </form>
      </Modal>
    </div>
  );
};
