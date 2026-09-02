import React from 'react';
import { UserPlus, Users, ShieldCheck, User as UserIcon } from 'lucide-react';

import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Select } from '../../components/ui/Select';
import { Modal } from '../../components/ui/Modal';
import { Badge } from '../../components/ui/Badge';
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
        description="Criação de contas de acesso e controle de credenciais da equipe contábil"
        badge={<Badge variant="warning" size="sm">Área Restrita</Badge>}
        action={
          <Button
            leftIcon={<UserPlus className="w-4 h-4" />}
            onClick={abrirModal}
            className="bg-amber-600 hover:bg-amber-700 focus:ring-amber-600 text-white shadow-xs shadow-amber-600/20"
          >
            Novo Usuário
          </Button>
        }
      />

      {erro && <ErrorAlert message={erro} />}

      <div className="bg-white border border-slate-200/80 rounded-xl shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs divide-y divide-slate-100">
            <thead className="bg-slate-50/70 text-slate-500 font-bold uppercase tracking-wider text-[10px]">
              <tr>
                <th className="py-3.5 px-4">Nome</th>
                <th className="py-3.5 px-4">E-mail</th>
                <th className="py-3.5 px-4">Papel / Cargo</th>
                <th className="py-3.5 px-4 text-center">Status</th>
                <th className="py-3.5 px-4 text-right">Ação</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100/80">
              {usuarios.map((u) => {
                const isCurrentUser = u.id === user?.id;
                const isAdmin = u.role === 'admin';
                return (
                  <tr key={u.id} className="hover:bg-slate-50/70 transition-colors">
                    <td className="py-3.5 px-4 font-semibold text-slate-900 flex items-center gap-2.5">
                      <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 border ${
                        isAdmin
                          ? 'bg-amber-50 text-amber-700 border-amber-200'
                          : 'bg-blue-50 text-blue-700 border-blue-200'
                      }`}>
                        {isAdmin ? <ShieldCheck className="w-3.5 h-3.5" /> : <UserIcon className="w-3.5 h-3.5" />}
                      </div>
                      <span>{u.nome}</span>
                      {isCurrentUser && (
                        <span className="text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.2 rounded font-bold">
                          Você
                        </span>
                      )}
                    </td>
                    <td className="py-3.5 px-4 font-mono text-slate-600">{u.email}</td>
                    <td className="py-3.5 px-4">
                      {isAdmin ? (
                        <Badge variant="warning" size="sm">
                          Admin — {u.cargo || 'Contador Sênior'}
                        </Badge>
                      ) : (
                        <Badge variant="info" size="sm">
                          Operador — {u.cargo || 'Analista Fiscal'}
                        </Badge>
                      )}
                    </td>
                    <td className="py-3.5 px-4 text-center">
                      <Badge variant={u.ativo ? 'success' : 'neutral'} size="sm" dot>
                        {u.ativo ? 'Ativo' : 'Inativo'}
                      </Badge>
                    </td>
                    <td className="py-3.5 px-4 text-right">
                      <button
                        type="button"
                        onClick={() => alternarStatus(u)}
                        disabled={isCurrentUser}
                        title={isCurrentUser ? 'Você não pode desativar a sua própria conta' : undefined}
                        className={`text-xs font-semibold px-2.5 py-1 rounded-lg transition-colors cursor-pointer ${
                          isCurrentUser
                            ? 'opacity-40 cursor-not-allowed text-slate-400'
                            : u.ativo
                            ? 'text-rose-600 hover:text-rose-700 hover:bg-rose-50'
                            : 'text-emerald-700 hover:text-emerald-800 hover:bg-emerald-50'
                        }`}
                      >
                        {u.ativo ? 'Desativar' : 'Ativar'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <Modal isOpen={modalAberto} onClose={fecharModal} title="Novo Usuário" subtitle="Cadastre um novo membro da equipe contábil">
        {erroFormulario && (
          <ErrorAlert
            title="Erro ao criar usuário"
            message={erroFormulario}
            onDismiss={() => setErroFormulario(null)}
          />
        )}

        <form onSubmit={onSubmit} className="space-y-4">
          <Input label="Nome Completo" placeholder="Ex: Maria Silva" {...register('nome')} error={errors.nome?.message} />
          <Input label="E-mail Institucional" type="email" placeholder="maria.silva@contabilidade.com" {...register('email')} error={errors.email?.message} />
          <Input label="Senha Inicial" type="password" placeholder="••••••••" {...register('password')} error={errors.password?.message} />
          <Select
            label="Papel / Cargo"
            options={[
              { value: 'operador', label: 'Operador — Analista Fiscal' },
              { value: 'admin', label: 'Admin — Contador Sênior' },
            ]}
            {...register('role')}
          />
          <div className="pt-4 border-t border-slate-100 flex justify-end gap-2.5">
            <Button type="button" variant="outline" onClick={fecharModal}>
              Cancelar
            </Button>
            <Button type="submit" isLoading={salvando}>
              Criar Usuário
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
