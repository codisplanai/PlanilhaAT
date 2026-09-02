import React from 'react';
import {
  Building2,
  Plus,
  Search,
  Edit2,
  Trash2
} from 'lucide-react';

import { getErrorMessage } from '../../api/client';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Select } from '../../components/ui/Select';
import { Modal } from '../../components/ui/Modal';
import { Badge } from '../../components/ui/Badge';
import { Card } from '../../components/ui/Card';
import { LoadingSpinner } from '../../components/feedback/LoadingSpinner';
import { EmptyState } from '../../components/feedback/EmptyState';
import { ErrorAlert } from '../../components/feedback/ErrorAlert';
import { PageHeader } from '../../components/layout/PageHeader';
import { formatCNPJ, formatDate } from '../../lib/formatters';
import { UFS_BRASIL } from '../../constants/domain';
import { useEmpresasPage } from './useEmpresasPage';

export const EmpresasPage: React.FC = () => {
  const {
    empresasQuery: { isLoading, error },
    perfisQuery: { error: perfisError },
    perfis,
    filteredEmpresas,
    getPerfilNome,
    searchTerm,
    setSearchTerm,
    ufFilter,
    setUfFilter,
    modalOpen,
    editingEmpresa,
    errorMessage,
    setErrorMessage,
    openCreateModal: handleOpenCreateModal,
    openEditModal: handleOpenEditModal,
    closeModal: handleCloseModal,
    deleteEmpresa: handleDelete,
    saveEmpresa,
    register,
    errors,
    isSaving,
  } = useEmpresasPage();

  return (
    <div className="space-y-6">
      <PageHeader
        icon={<Building2 className="w-6 h-6 text-blue-800" />}
        title="Empresas Clientes"
        description="Gerenciamento das empresas atendidas pelo escritório contábil e seus perfis fiscais"
        action={(
          <Button onClick={handleOpenCreateModal} leftIcon={<Plus className="w-4 h-4" />}>
            Cadastrar Empresa
          </Button>
        )}
      />

      {perfisError && <ErrorAlert message={`Não foi possível carregar os perfis: ${getErrorMessage(perfisError)}`} />}

      {/* Filters Bar */}
      <Card className="p-3">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              placeholder="Buscar por Razão Social, CNPJ ou UF..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-md focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-800"
            />
          </div>

          <div className="w-full sm:w-48">
            <select
              value={ufFilter}
              onChange={(e) => setUfFilter(e.target.value)}
              className="w-full px-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-md focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-800 text-slate-700"
            >
              <option value="">Todas as UFs</option>
              {UFS_BRASIL.map((uf) => (
                <option key={uf} value={uf}>
                  Estado: {uf}
                </option>
              ))}
            </select>
          </div>
        </div>
      </Card>

      {/* Main Table Content */}
      {isLoading ? (
        <LoadingSpinner message="Carregando empresas cadastradas..." />
      ) : error ? (
        <ErrorAlert message={getErrorMessage(error)} />
      ) : filteredEmpresas.length === 0 ? (
        searchTerm || ufFilter ? (
          <EmptyState
            title="Nenhuma empresa encontrada"
            description="Nenhum resultado corresponde aos filtros informados. Tente ajustar o termo de busca."
            actionLabel="Limpar Filtros"
            onAction={() => {
              setSearchTerm('');
              setUfFilter('');
            }}
          />
        ) : (
          <EmptyState
            icon={<Building2 className="w-8 h-8 text-blue-700" />}
            title="Nenhuma empresa cadastrada ainda"
            description="Cadastre as empresas atendidas pela contabilidade para vincular os perfis de cálculo e processar as notas fiscais."
            actionLabel="Cadastrar Primeira Empresa"
            onAction={handleOpenCreateModal}
          />
        )
      ) : (
        <div className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs divide-y divide-slate-200">
              <thead className="bg-slate-50/80 text-slate-700 font-semibold uppercase tracking-wider text-[11px]">
                <tr>
                  <th className="py-3 px-4">Razão Social</th>
                  <th className="py-3 px-4 font-mono">CNPJ</th>
                  <th className="py-3 px-4 font-mono">Inscrição Estadual</th>
                  <th className="py-3 px-4 text-center">UF</th>
                  <th className="py-3 px-4">Perfil de Regras</th>
                  <th className="py-3 px-4 text-center">Status</th>
                  <th className="py-3 px-4">Cadastro</th>
                  <th className="py-3 px-4 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredEmpresas.map((empresa) => (
                  <tr
                    key={empresa.id}
                    className="hover:bg-slate-50/70 transition-colors group"
                  >
                    <td className="py-3 px-4 font-medium text-slate-900">
                      {empresa.razao_social}
                    </td>
                    <td className="py-3 px-4 font-mono text-slate-600">
                      {formatCNPJ(empresa.cnpj)}
                    </td>
                    <td className="py-3 px-4 font-mono text-slate-600">
                      {empresa.inscricao_estadual ? (
                        <span className="font-semibold text-slate-800">{empresa.inscricao_estadual}</span>
                      ) : (
                        <span className="text-slate-400 italic">Não informada</span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-center">
                      <span className="inline-block font-bold text-slate-700 bg-slate-100 px-2 py-0.5 rounded text-[10px] border border-slate-200">
                        {empresa.uf}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-slate-700">
                      <span className="text-blue-950 font-medium">
                        {getPerfilNome(empresa.perfil_regras_id)}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-center">
                      {empresa.ativo ? (
                        <Badge variant="success" size="sm">
                          Ativa
                        </Badge>
                      ) : (
                        <Badge variant="neutral" size="sm">
                          Inativa
                        </Badge>
                      )}
                    </td>
                    <td className="py-3 px-4 text-slate-500 text-[11px]">
                      {formatDate(empresa.criado_em)}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => handleOpenEditModal(empresa)}
                          className="p-1 text-slate-400 hover:text-blue-800 hover:bg-blue-50 rounded transition-colors"
                          title="Editar empresa"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDelete(empresa)}
                          className="p-1 text-slate-400 hover:text-red-700 hover:bg-red-50 rounded transition-colors"
                          title="Remover empresa"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-2.5 bg-slate-50/50 border-t border-slate-100 text-[11px] text-slate-500 flex justify-between items-center">
            <span>
              Total de <strong>{filteredEmpresas.length}</strong> empresa(s) listada(s)
            </span>
          </div>
        </div>
      )}

      {/* Modal de Cadastro / Edição */}
      <Modal
        isOpen={modalOpen}
        onClose={handleCloseModal}
        title={editingEmpresa ? 'Editar Empresa' : 'Cadastrar Nova Empresa'}
        subtitle="Informe os dados cadastrais da empresa e vincule ao perfil fiscal compartilhado"
      >
        {errorMessage && (
          <ErrorAlert
            title="Erro ao salvar empresa"
            message={errorMessage}
            onDismiss={() => setErrorMessage(null)}
          />
        )}

        <form onSubmit={saveEmpresa} className="space-y-4">
          <div>
            <Input
              label="Razão Social"
              placeholder="Ex: Comercial de Alimentos Bahia LTDA"
              {...register('razao_social')}
              error={errors.razao_social?.message}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="sm:col-span-1">
              <Input
                label="CNPJ (14 dígitos)"
                placeholder="00.000.000/0000-00"
                {...register('cnpj')}
                error={errors.cnpj?.message}
              />
            </div>

            <div className="sm:col-span-1">
              <Input
                label="Inscrição Estadual (I.E.)"
                placeholder="Ex: 83592715"
                {...register('inscricao_estadual')}
                error={errors.inscricao_estadual?.message}
              />
            </div>

            <div className="sm:col-span-1">
              <Select
                label="Estado (UF)"
                options={UFS_BRASIL.map((uf) => ({ value: uf, label: uf }))}
                {...register('uf')}
                error={errors.uf?.message}
              />
            </div>
          </div>

          <div>
            <Select
              label="Perfil de Regras Fiscais Vinculado"
              placeholder="Selecione um perfil..."
              options={perfis.map((p) => ({
                value: p.id,
                label: `${p.nome} ${p.descricao ? `(${p.descricao})` : ''}`,
              }))}
              {...register('perfil_regras_id', { valueAsNumber: true })}
              error={errors.perfil_regras_id?.message}
              helperText="O perfil define as alíquotas padrão por estado e as exceções por NCM compartilhadas."
            />
          </div>

          <div className="pt-2 flex items-center gap-2">
            <input
              type="checkbox"
              id="ativo"
              className="rounded border-slate-300 text-blue-800 focus:ring-blue-800 h-4 w-4"
              {...register('ativo')}
            />
            <label htmlFor="ativo" className="text-xs text-slate-700 font-medium cursor-pointer">
              Empresa ativa para geração de planilhas
            </label>
          </div>

          <div className="pt-4 border-t border-slate-100 flex items-center justify-end gap-3">
            <Button type="button" variant="outline" onClick={handleCloseModal}>
              Cancelar
            </Button>
            <Button
              type="submit"
              isLoading={isSaving}
            >
              {editingEmpresa ? 'Salvar Alterações' : 'Cadastrar Empresa'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
