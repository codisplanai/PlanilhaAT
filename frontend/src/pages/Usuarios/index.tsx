import React, { useMemo, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import {
  UserPlus,
  Users,
  ShieldCheck,
  User as UserIcon,
  Loader2,
  Search,
  Trash2,
} from 'lucide-react';

import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { PasswordInput } from '../../components/ui/PasswordInput';
import { Select } from '../../components/ui/Select';
import { Modal } from '../../components/ui/Modal';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { Badge } from '../../components/ui/Badge';
import { Card } from '../../components/ui/Card';
import { Tabs } from '../../components/ui/Tabs';
import { PageHeader } from '../../components/layout/PageHeader';
import { LoadingSpinner } from '../../components/feedback/LoadingSpinner';
import { EmptyState } from '../../components/feedback/EmptyState';
import { SectionEmpty } from '../../components/feedback/SectionEmpty';
import { ErrorAlert } from '../../components/feedback/ErrorAlert';
import type { User } from '../../types/auth';
import type { Usuario } from '../../types/usuario';
import { useUsuariosPage } from './useUsuariosPage';

interface UsuariosPageProps {
  user?: User | null;
}

type StatusFiltro = 'todas' | 'ativas' | 'inativas';

const RoleBadge: React.FC<{ usuario: Usuario }> = ({ usuario }) =>
  usuario.role === 'admin' ? (
    <Badge variant="warning" size="sm">Administrador</Badge>
  ) : (
    <Badge variant="info" size="sm">Operador</Badge>
  );

const Avatar: React.FC<{ usuario: Usuario }> = ({ usuario }) => (
  <div
    aria-hidden="true"
    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border ${
      usuario.role === 'admin'
        ? 'border-amber-200 bg-amber-50 text-amber-700'
        : 'border-blue-200 bg-blue-50 text-blue-700'
    }`}
  >
    {usuario.role === 'admin' ? (
      <ShieldCheck className="h-4 w-4" />
    ) : (
      <UserIcon className="h-4 w-4" />
    )}
  </div>
);

export const UsuariosPage: React.FC<UsuariosPageProps> = ({ user: propUser }) => {
  const outlet = useOutletContext<{ user?: User | null }>();
  const user = propUser ?? outlet?.user ?? null;

  const {
    usuarios,
    isLoading,
    refetch,
    pageError: erro,
    formError: erroFormulario,
    setFormError: setErroFormulario,
    modalOpen: modalAberto,
    openModal: abrirModal,
    closeModal: fecharModal,
    createUser: onSubmit,
    toggleStatus: alternarStatus,
    togglingUserId,
    deleteUser: excluirUsuario,
    deletingUserId,
    register,
    errors,
    isSaving: salvando,
  } = useUsuariosPage();

  const [statusFiltro, setStatusFiltro] = useState<StatusFiltro>('todas');
  const [busca, setBusca] = useState('');
  // Desativar uma conta tira o acesso de alguém: pede confirmação. Reativar não.
  const [usuarioParaDesativar, setUsuarioParaDesativar] = useState<Usuario | null>(null);
  const [usuarioParaExcluir, setUsuarioParaExcluir] = useState<Usuario | null>(null);

  const contagens = useMemo(
    () => ({
      todas: usuarios.length,
      ativas: usuarios.filter((u) => u.ativo).length,
      inativas: usuarios.filter((u) => !u.ativo).length,
    }),
    [usuarios],
  );

  const usuariosVisiveis = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return usuarios.filter((u) => {
      if (statusFiltro === 'ativas' && !u.ativo) return false;
      if (statusFiltro === 'inativas' && u.ativo) return false;
      if (!termo) return true;
      return (
        u.nome.toLowerCase().includes(termo) ||
        u.email.toLowerCase().includes(termo) ||
        (u.cargo || '').toLowerCase().includes(termo)
      );
    });
  }, [usuarios, statusFiltro, busca]);

  const pedirAlteracaoDeStatus = (u: Usuario) => {
    if (u.ativo) {
      setUsuarioParaDesativar(u);
      return;
    }
    alternarStatus(u);
  };

  const renderAcao = (u: Usuario) => {
    const isCurrentUser = u.id === user?.id;
    const isTogglingThis = togglingUserId === u.id;

    if (isCurrentUser) {
      return (
        <span
          className="cursor-not-allowed select-none whitespace-nowrap px-2.5 py-1 text-xs font-semibold text-slate-400"
          title="Você não pode desativar a sua própria conta"
        >
          Sua conta
        </span>
      );
    }

    return (
      <div className="inline-flex items-center gap-1">
      <button
        type="button"
        onClick={() => pedirAlteracaoDeStatus(u)}
        disabled={togglingUserId !== null}
        aria-label={`${u.ativo ? 'Desativar' : 'Ativar'} conta de ${u.nome}`}
        className={`inline-flex cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 ${
          togglingUserId !== null
            ? 'cursor-not-allowed opacity-50'
            : u.ativo
              ? 'text-rose-600 hover:bg-rose-50 hover:text-rose-700 focus-visible:ring-rose-500'
              : 'text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800 focus-visible:ring-emerald-500'
        }`}
      >
        {isTogglingThis ? (
          <>
            <Loader2 className="h-3 w-3 animate-spin text-slate-500" />
            <span className="text-slate-500">Alterando</span>
          </>
        ) : u.ativo ? (
          'Desativar'
        ) : (
          'Ativar'
        )}
      </button>
      <button
        type="button"
        onClick={() => setUsuarioParaExcluir(u)}
        disabled={deletingUserId !== null}
        title="Excluir conta"
        aria-label={`Excluir conta de ${u.nome}`}
        className={`cursor-pointer rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 ${
          deletingUserId !== null ? 'cursor-not-allowed opacity-50' : ''
        }`}
      >
        {deletingUserId === u.id ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Trash2 className="h-3.5 w-3.5" />
        )}
      </button>
      </div>
    );
  };

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

      {erro && <ErrorAlert message={erro} onRetry={() => refetch()} />}

      {isLoading ? (
        <LoadingSpinner message="Carregando usuários da equipe..." />
      ) : usuarios.length === 0 ? (
        <EmptyState
          icon={<Users className="w-7 h-7 text-amber-600" />}
          title="Nenhum usuário cadastrado"
          description="Cadastre os membros da equipe contábil para liberar o acesso ao sistema."
          actionLabel="Cadastrar Primeiro Usuário"
          onAction={abrirModal}
        />
      ) : (
        <div className="space-y-4">
          {/* O filtro carrega a contagem: um só device, sem faixa de números solta. */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Tabs
              variant="pills"
              ariaLabel="Filtrar contas por situação"
              activeTab={statusFiltro}
              onChange={(id) => setStatusFiltro(id as StatusFiltro)}
              tabs={[
                { id: 'todas', label: 'Todas', count: contagens.todas },
                { id: 'ativas', label: 'Ativas', count: contagens.ativas },
                { id: 'inativas', label: 'Inativas', count: contagens.inativas },
              ]}
            />
            <div className="relative w-full sm:w-64">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input
                type="search"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Buscar usuário"
                aria-label="Buscar usuário"
                className="w-full rounded-lg border border-slate-200/90 bg-white py-2 pl-9 pr-3 text-sm text-slate-900 shadow-2xs transition-all duration-150 placeholder:text-slate-400 hover:border-slate-300 focus:border-blue-600 focus:outline-none focus:ring-4 focus:ring-blue-500/15"
              />
            </div>
          </div>

          {usuariosVisiveis.length === 0 ? (
            <SectionEmpty
              icon={<Search className="h-6 w-6" />}
              title="Nenhuma conta corresponde a esta busca"
              hint="Ajuste o texto ou volte para todas as contas."
              action={
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setBusca('');
                    setStatusFiltro('todas');
                  }}
                >
                  Limpar filtros
                </Button>
              }
            />
          ) : (
            <Card bodyPadding="none">
              {/* Tabela a partir de sm; abaixo disso, cartões — 5 colunas não cabem num telefone. */}
              <div className="hidden overflow-x-auto sm:block">
                <table className="w-full divide-y divide-slate-100 text-left text-xs">
                  <thead className="bg-slate-50/70 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                    <tr>
                      <th scope="col" className="whitespace-nowrap px-4 py-3.5">Nome</th>
                      <th scope="col" className="w-full px-4 py-3.5">E-mail</th>
                      <th scope="col" className="px-4 py-3.5">Papel</th>
                      <th scope="col" className="px-4 py-3.5 text-center">Situação</th>
                      <th scope="col" className="px-4 py-3.5 text-right">Ação</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100/80">
                    {usuariosVisiveis.map((u) => (
                      <tr
                        key={u.id}
                        className={`transition-colors hover:bg-slate-50/70 ${
                          u.ativo ? '' : 'bg-slate-50/40 text-slate-500'
                        }`}
                      >
                        <td className="px-4 py-3.5">
                          <div className="flex items-center gap-2.5">
                            <Avatar usuario={u} />
                            <div className="min-w-0 max-w-[18rem]">
                              <div className="flex items-center gap-1.5">
                                <span
                                  title={u.nome}
                                  className={`truncate whitespace-nowrap font-semibold ${
                                    u.ativo ? 'text-slate-900' : 'text-slate-500'
                                  }`}
                                >
                                  {u.nome}
                                </span>
                                {u.id === user?.id && (
                                  <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-600">
                                    Você
                                  </span>
                                )}
                              </div>
                              <span className="block truncate whitespace-nowrap text-[11px] text-slate-500">
                                {u.cargo || 'Cargo não informado'}
                              </span>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3.5 font-mono text-slate-600">{u.email}</td>
                        <td className="px-4 py-3.5">
                          <RoleBadge usuario={u} />
                        </td>
                        <td className="px-4 py-3.5 text-center">
                          <Badge variant={u.ativo ? 'success' : 'neutral'} size="sm" dot>
                            {u.ativo ? 'Ativo' : 'Inativo'}
                          </Badge>
                        </td>
                        <td className="px-4 py-3.5 text-right">{renderAcao(u)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <ul className="divide-y divide-slate-100 sm:hidden">
                {usuariosVisiveis.map((u) => (
                  <li key={u.id} className={`p-4 ${u.ativo ? '' : 'bg-slate-50/40'}`}>
                    <div className="flex items-start gap-3">
                      <Avatar usuario={u} />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-sm font-bold tracking-tight text-slate-900">
                            {u.nome}
                          </span>
                          {u.id === user?.id && (
                            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-600">
                              Você
                            </span>
                          )}
                        </div>
                        <p className="truncate font-mono text-xs text-slate-500">{u.email}</p>
                        <p className="mt-0.5 text-[11px] text-slate-500">
                          {u.cargo || 'Cargo não informado'}
                        </p>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <RoleBadge usuario={u} />
                          <Badge variant={u.ativo ? 'success' : 'neutral'} size="sm" dot>
                            {u.ativo ? 'Ativo' : 'Inativo'}
                          </Badge>
                        </div>
                      </div>
                      <div className="shrink-0">{renderAcao(u)}</div>
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      )}

      <Modal
        isOpen={modalAberto}
        onClose={fecharModal}
        title="Novo Usuário"
        subtitle="Cadastre um novo membro da equipe contábil"
      >
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
          <PasswordInput
            label="Senha Inicial"
            placeholder="••••••••"
            {...register('password')}
            error={errors.password?.message}
            helperText="Ao menos 8 caracteres. O usuário pode trocá-la depois do primeiro acesso."
          />
          <Select
            label="Papel"
            options={[
              { value: 'operador', label: 'Operador — gera e consulta planilhas' },
              { value: 'admin', label: 'Administrador — também gerencia regras, modelos e contas' },
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

      <ConfirmDialog
        isOpen={Boolean(usuarioParaDesativar)}
        onClose={() => setUsuarioParaDesativar(null)}
        onConfirm={() => {
          if (usuarioParaDesativar) alternarStatus(usuarioParaDesativar);
          setUsuarioParaDesativar(null);
        }}
        title="Desativar conta"
        message={`${usuarioParaDesativar?.nome} perde o acesso ao sistema imediatamente. O histórico de solicitações dessa pessoa é preservado e a conta pode ser reativada depois.`}
        confirmLabel="Desativar conta"
        cancelLabel="Manter ativa"
        variant="danger"
        isLoading={togglingUserId === usuarioParaDesativar?.id}
      />

      <ConfirmDialog
        isOpen={Boolean(usuarioParaExcluir)}
        onClose={() => setUsuarioParaExcluir(null)}
        onConfirm={() => {
          if (usuarioParaExcluir) {
            excluirUsuario(usuarioParaExcluir, () => setUsuarioParaExcluir(null));
          }
        }}
        title="Excluir conta"
        message={
          <>
            <p>
              A conta de <strong>{usuarioParaExcluir?.nome}</strong> é removida em definitivo e não
              pode ser recuperada.
            </p>
            <p className="mt-2">
              As solicitações que essa pessoa gerou permanecem no histórico, mas deixam de mostrar
              quem as gerou. Para apenas bloquear o acesso, desative a conta em vez de excluí-la.
            </p>
          </>
        }
        confirmLabel="Excluir em definitivo"
        cancelLabel="Cancelar"
        variant="danger"
        isLoading={deletingUserId === usuarioParaExcluir?.id}
      />
    </div>
  );
};
