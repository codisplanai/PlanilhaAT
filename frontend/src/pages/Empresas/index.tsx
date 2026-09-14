import React, { useState } from 'react';
import {
  Building2,
  Plus,
  Search,
  Edit2,
  Trash2,
  X,
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
import { formatCNPJ, formatDate, formatPercent, maskCNPJ } from '../../lib/formatters';
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
    definirTermoAcordo,
    removerTermoAcordo,
    register,
    errors,
    isSaving,
  } = useEmpresasPage();

  const [empresaTermo, setEmpresaTermo] = useState<typeof filteredEmpresas[0] | null>(null);
  const [aliquotaTermo, setAliquotaTermo] = useState('');
  const [descricaoTermo, setDescricaoTermo] = useState('');
  const [erroTermo, setErroTermo] = useState<string | null>(null);

  const handleOpenTermoModal = (empresa: typeof filteredEmpresas[0]) => {
    setEmpresaTermo(empresa);
    setErroTermo(null);
    if (empresa.termo_acordo) {
      setAliquotaTermo((Number(empresa.termo_acordo.aliquota) * 100).toFixed(2));
      setDescricaoTermo(empresa.termo_acordo.descricao || '');
    } else {
      setAliquotaTermo('');
      setDescricaoTermo('');
    }
  };

  const handleSalvarTermo = (e: React.FormEvent) => {
    e.preventDefault();
    if (!empresaTermo) return;
    const aliqNum = Number(aliquotaTermo.replace(',', '.'));
    if (isNaN(aliqNum) || aliqNum <= 0) {
      setErroTermo('Informe uma alíquota válida.');
      return;
    }
    definirTermoAcordo.mutate(
      {
        empresaId: empresaTermo.id,
        aliquota: aliqNum,
        descricao: descricaoTermo.trim() || null,
      },
      {
        onSuccess: () => {
          setEmpresaTermo(null);
        },
        onError: (err) => {
          setErroTermo(getErrorMessage(err));
        },
      },
    );
  };

  const handleRemoverTermo = (empresa: typeof filteredEmpresas[0]) => {
    if (confirm(`Remover termo de acordo da empresa "${empresa.razao_social}"?`)) {
      removerTermoAcordo.mutate(empresa.id, {
        onError: (err) => alert(getErrorMessage(err)),
      });
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        icon={<Building2 className="w-5 h-5 text-blue-700" />}
        title="Empresas Clientes"
        description="Gerenciamento das empresas atendidas pelo escritório contábil e vinculação aos perfis fiscais"
        action={
          <Button onClick={handleOpenCreateModal} leftIcon={<Plus className="w-4 h-4" />}>
            Cadastrar Empresa
          </Button>
        }
      />

      {perfisError && (
        <ErrorAlert
          title="Erro ao carregar perfis"
          message={getErrorMessage(perfisError)}
        />
      )}

      {/* Filters Bar */}
      <Card className="p-3.5">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5 pointer-events-none" />
            <input
              type="text"
              placeholder="Buscar por Razão Social, CNPJ ou UF..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-8 py-2 text-xs sm:text-sm bg-slate-50/70 border border-slate-200/90 rounded-lg focus:bg-white focus:outline-none focus:ring-4 focus:ring-blue-500/15 focus:border-blue-600 transition-all text-slate-900 placeholder:text-slate-400"
            />
            {searchTerm && (
              <button
                type="button"
                onClick={() => setSearchTerm('')}
                className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600 p-0.5 rounded cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          <div className="w-full sm:w-52">
            <select
              value={ufFilter}
              onChange={(e) => setUfFilter(e.target.value)}
              className="w-full px-3 py-2 text-xs sm:text-sm bg-slate-50/70 border border-slate-200/90 rounded-lg focus:bg-white focus:outline-none focus:ring-4 focus:ring-blue-500/15 focus:border-blue-600 text-slate-700 cursor-pointer transition-all"
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
            icon={<Building2 className="w-7 h-7 text-blue-700" />}
            title="Nenhuma empresa cadastrada ainda"
            description="Cadastre as empresas atendidas pela contabilidade para vincular os perfis de cálculo e processar as notas fiscais."
            actionLabel="Cadastrar Primeira Empresa"
            onAction={handleOpenCreateModal}
          />
        )
      ) : (
        <div className="bg-white border border-slate-200/80 rounded-xl shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs divide-y divide-slate-100">
              <thead className="bg-slate-50/70 text-slate-500 font-bold uppercase tracking-wider text-[10px]">
                <tr>
                  <th className="py-3.5 px-4">Razão Social</th>
                  <th className="py-3.5 px-4 font-mono">CNPJ</th>
                  <th className="py-3.5 px-4 font-mono">Inscrição Estadual</th>
                  <th className="py-3.5 px-4 text-center">UF</th>
                  <th className="py-3.5 px-4">Perfil de Regras</th>
                  <th className="py-3.5 px-4">Termo de Acordo</th>
                  <th className="py-3.5 px-4 text-center">Status</th>
                  <th className="py-3.5 px-4">Cadastro</th>
                  <th className="py-3.5 px-4 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100/80">
                {filteredEmpresas.map((empresa) => (
                  <tr
                    key={empresa.id}
                    className="hover:bg-slate-50/70 transition-colors group"
                  >
                    <td className="py-3.5 px-4 font-semibold text-slate-900">
                      <div className="flex items-center gap-2">
                        <span>{empresa.razao_social}</span>
                        {empresa.optante_simples_nacional && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-amber-50 text-amber-800 border border-amber-200">
                            Simples Nacional
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-3.5 px-4 font-mono font-medium text-slate-600">
                      {formatCNPJ(empresa.cnpj)}
                    </td>
                    <td className="py-3.5 px-4 font-mono text-slate-600">
                      {empresa.inscricao_estadual ? (
                        <span className="font-semibold text-slate-800">{empresa.inscricao_estadual}</span>
                      ) : (
                        <span className="text-slate-400 italic">Não informada</span>
                      )}
                    </td>
                    <td className="py-3.5 px-4 text-center">
                      <span className="inline-block font-bold text-slate-700 bg-slate-100 px-2 py-0.5 rounded text-[10px] border border-slate-200">
                        {empresa.uf}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 text-slate-700">
                      <span className="text-blue-950 font-medium">
                        {getPerfilNome(empresa.perfil_regras_id)}
                      </span>
                    </td>
                    <td className="py-3.5 px-4">
                      {empresa.termo_acordo ? (
                        <div className="flex items-center gap-1.5">
                          <span className="font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded text-[11px] border border-emerald-200">
                            {formatPercent(empresa.termo_acordo.aliquota)}
                          </span>
                          {empresa.termo_acordo.descricao && (
                            <span className="text-slate-500 text-[11px] truncate max-w-[120px]" title={empresa.termo_acordo.descricao}>
                              {empresa.termo_acordo.descricao}
                            </span>
                          )}
                          <button
                            type="button"
                            onClick={() => handleOpenTermoModal(empresa)}
                            className="p-1 text-slate-400 hover:text-blue-700 hover:bg-blue-50 rounded cursor-pointer"
                            title="Editar termo de acordo"
                          >
                            <Edit2 className="w-3 h-3" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleRemoverTermo(empresa)}
                            className="p-1 text-slate-400 hover:text-rose-700 hover:bg-rose-50 rounded cursor-pointer"
                            title="Remover termo de acordo"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      ) : (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-slate-400 hover:text-blue-700 text-[11px] h-6 px-1.5"
                          onClick={() => handleOpenTermoModal(empresa)}
                          leftIcon={<Plus className="w-3 h-3" />}
                        >
                          Cadastrar
                        </Button>
                      )}
                    </td>
                    <td className="py-3.5 px-4 text-center">
                      {empresa.ativo ? (
                        <Badge variant="success" size="sm" dot>
                          Ativa
                        </Badge>
                      ) : (
                        <Badge variant="neutral" size="sm" dot>
                          Inativa
                        </Badge>
                      )}
                    </td>
                    <td className="py-3.5 px-4 text-slate-500 text-[11px]">
                      {formatDate(empresa.criado_em)}
                    </td>
                    <td className="py-3.5 px-4 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => handleOpenEditModal(empresa)}
                          className="p-1.5 text-slate-400 hover:text-blue-700 hover:bg-blue-50 rounded-lg transition-colors cursor-pointer"
                          title="Editar empresa"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(empresa)}
                          className="p-1.5 text-slate-400 hover:text-rose-700 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
                          title="Remover empresa"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-3 bg-slate-50/50 border-t border-slate-100 text-xs text-slate-500 flex justify-between items-center">
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
        maxWidth="xl"
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
                maxLength={18}
                {...register('cnpj', {
                  onChange: (e) => {
                    e.target.value = maskCNPJ(e.target.value);
                  },
                })}
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

          <div className="p-3 bg-amber-50/70 border border-amber-200/90 rounded-lg space-y-1">
            <div className="flex items-center gap-2.5">
              <input
                type="checkbox"
                id="optante_simples_nacional"
                className="rounded-md border-amber-300 text-amber-600 focus:ring-amber-500 h-4 w-4 cursor-pointer"
                {...register('optante_simples_nacional')}
              />
              <label
                htmlFor="optante_simples_nacional"
                className="text-xs text-amber-950 font-bold cursor-pointer select-none"
              >
                Optante pelo Simples Nacional
              </label>
            </div>
            <p className="text-[11px] text-amber-800/90 pl-6.5">
              Aplica automaticamente o desconto legal de 20% no valor devido de Antecipação Parcial e utiliza os modelos oficiais do Simples Nacional (RP-154 / RP-156).
            </p>
          </div>

          <div className="pt-2 flex items-center gap-2.5">
            <input
              type="checkbox"
              id="ativo"
              className="rounded-md border-slate-300 text-blue-600 focus:ring-blue-500 h-4 w-4 cursor-pointer"
              {...register('ativo')}
            />
            <label htmlFor="ativo" className="text-xs text-slate-700 font-medium cursor-pointer select-none">
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

      {/* Modal de Termo de Acordo */}
      <Modal
        isOpen={empresaTermo !== null}
        onClose={() => setEmpresaTermo(null)}
        title={empresaTermo?.termo_acordo ? 'Editar Termo de Acordo' : 'Cadastrar Termo de Acordo'}
        subtitle={`Empresa: ${empresaTermo?.razao_social ?? ''}`}
      >
        {erroTermo && (
          <ErrorAlert
            title="Erro ao salvar termo de acordo"
            message={erroTermo}
            onDismiss={() => setErroTermo(null)}
          />
        )}

        <form onSubmit={handleSalvarTermo} className="space-y-4">
          <Input
            label="Alíquota"
            value={aliquotaTermo}
            onChange={(e) => setAliquotaTermo(e.target.value)}
            placeholder="12,06"
            helperText="Aceita 12,06 ou 0.1206. Alíquota de destino própria desta empresa. Vale para todas as mercadorias, exceto as que tiverem redução por produto cadastrada no perfil de regras."
            required
          />
          <Input
            label="Identificação do Termo / Legislação (opcional)"
            value={descricaoTermo}
            onChange={(e) => setDescricaoTermo(e.target.value)}
            placeholder="Termo de Acordo nº 123/2025"
          />
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setEmpresaTermo(null)}>
              Cancelar
            </Button>
            <Button type="submit" isLoading={definirTermoAcordo.isPending}>
              Salvar Termo
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
