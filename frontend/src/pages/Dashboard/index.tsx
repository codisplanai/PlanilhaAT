import React from 'react';
import { NavLink } from 'react-router-dom';
import {
  Building2,
  CheckCircle2,
  AlertCircle,
  PlusCircle,
  Download,
  ArrowRight,
  TrendingUp,
  FileSpreadsheet
} from 'lucide-react';

import { solicitacoesApi } from '../../api/solicitacoes';
import { getErrorMessage } from '../../api/client';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { LoadingSpinner } from '../../components/feedback/LoadingSpinner';
import { EmptyState } from '../../components/feedback/EmptyState';
import {
  formatCNPJ,
  formatDate,
  formatCompetencia
} from '../../lib/formatters';
import { StatusBadge } from '../../components/domain/StatusBadge';
import { getPlanilhaLabel } from '../../constants/domain';
import {
  useEmpresasQuery,
  useSolicitacoesQuery,
  useTemplatesQuery,
} from '../../hooks/useApiQueries';

export const DashboardPage: React.FC = () => {
  // Queries agregadas
  const { data: solicitacoes = [], isLoading: isLoadingSols } = useSolicitacoesQuery();

  const { data: empresas = [], isLoading: isLoadingEmps } = useEmpresasQuery();

  const { data: templates = [], isLoading: isLoadingTemplates } = useTemplatesQuery();

  const concluidasCount = solicitacoes.filter((s) => s.status === 'concluido').length;
  const erroCount = solicitacoes.filter((s) => s.status === 'erro').length;
  const totalNotas = solicitacoes.reduce((acc, s) => acc + (s.total_notas_processadas || 0), 0);

  const templatesAtivos = templates.filter((t) => t.ativo);
  const recentSolicitacoes = solicitacoes.slice(0, 8);

  const getEmpresa = (id: number) => empresas.find((e) => e.id === id);

  const handleDownload = async (id: string, tipo: string, empId: number, data: string) => {
    try {
      const emp = getEmpresa(empId);
      const empNome = emp ? emp.razao_social.slice(0, 15).replace(/\s+/g, '_') : 'Empresa';
      const filename = `Planilha_${tipo}_${empNome}_${data.slice(0, 7)}.xlsx`;
      await solicitacoesApi.downloadPlanilha(id, filename);
    } catch (err) {
      alert(getErrorMessage(err));
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Banner Operacional */}
      <div className="bg-gradient-to-r from-blue-900 via-blue-850 to-slate-900 text-white rounded-xl p-6 shadow-md border border-blue-800/60 flex flex-col sm:flex-row sm:items-center justify-between gap-6">
        <div className="space-y-1.5 max-w-xl">
          <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-blue-700/60 text-blue-200 text-[11px] font-semibold border border-blue-500/30">
            <TrendingUp className="w-3.5 h-3.5" />
            Sistema Contábil Integrado
          </div>
          <h1 className="text-xl font-bold tracking-tight text-white">
            Painel Operacional de Antecipação e DIFAL
          </h1>
          <p className="text-xs text-blue-100/80 leading-relaxed">
            Processamento automatizado de NF-e e preenchimento de planilhas com preservação inviolável de fórmulas.
          </p>
        </div>

        <div className="shrink-0">
          <NavLink to="/nova-solicitacao">
            <Button
              size="lg"
              className="bg-white text-blue-950 hover:bg-blue-50 shadow-md font-bold text-xs"
              leftIcon={<PlusCircle className="w-4 h-4 text-blue-800" />}
            >
              Gerar Nova Planilha
            </Button>
          </NavLink>
        </div>
      </div>

      {/* Metrics Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Concluídas */}
        <Card className="p-4 border-l-4 border-l-emerald-500">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                Planilhas Geradas
              </p>
              <p className="text-2xl font-bold font-mono text-slate-900 mt-1">
                {isLoadingSols ? '...' : concluidasCount}
              </p>
            </div>
            <div className="w-10 h-10 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center">
              <CheckCircle2 className="w-5 h-5" />
            </div>
          </div>
          <p className="text-[11px] text-slate-500 mt-2">
            {totalNotas} itens de NF-e processados
          </p>
        </Card>

        {/* Card 2: Empresas Atendidas */}
        <Card className="p-4 border-l-4 border-l-blue-600">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                Empresas Cadastradas
              </p>
              <p className="text-2xl font-bold font-mono text-slate-900 mt-1">
                {isLoadingEmps ? '...' : empresas.length}
              </p>
            </div>
            <div className="w-10 h-10 rounded-lg bg-blue-50 text-blue-700 flex items-center justify-center">
              <Building2 className="w-5 h-5" />
            </div>
          </div>
          <NavLink to="/empresas" className="text-[11px] text-blue-700 hover:underline mt-2 inline-block font-medium">
            Gerenciar empresas clientes &rarr;
          </NavLink>
        </Card>

        {/* Card 3: Modelos Vigentes */}
        <Card className="p-4 border-l-4 border-l-amber-500">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                Modelos de Excel
              </p>
              <p className="text-2xl font-bold font-mono text-slate-900 mt-1">
                {isLoadingTemplates ? '...' : `${templatesAtivos.length}/4`}
              </p>
            </div>
            <div className="w-10 h-10 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center">
              <FileSpreadsheet className="w-5 h-5" />
            </div>
          </div>
          <p className="text-[11px] text-slate-500 mt-2">
            {templates.length} versões versionadas
          </p>
        </Card>

        {/* Card 4: Status Pendentes / Erros */}
        <Card className="p-4 border-l-4 border-l-slate-400">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                Inconsistências / Erros
              </p>
              <p className="text-2xl font-bold font-mono text-slate-900 mt-1">
                {isLoadingSols ? '...' : erroCount}
              </p>
            </div>
            <div className="w-10 h-10 rounded-lg bg-red-50 text-red-600 flex items-center justify-center">
              <AlertCircle className="w-5 h-5" />
            </div>
          </div>
          <p className="text-[11px] text-slate-500 mt-2">
            Bloqueados por validação fiscal
          </p>
        </Card>
      </div>

      {/* Solicitações Recentes */}
      <Card
        title="Solicitações Recentes de Processamento"
        subtitle="Acompanhamento das últimas planilhas geradas e download direto"
        headerAction={
          <NavLink to="/solicitacoes">
            <Button size="sm" variant="ghost" rightIcon={<ArrowRight className="w-3.5 h-3.5" />}>
              Ver Histórico Completo
            </Button>
          </NavLink>
        }
      >
        {isLoadingSols ? (
          <LoadingSpinner message="Carregando solicitações..." />
        ) : recentSolicitacoes.length === 0 ? (
          <EmptyState
            icon={<FileSpreadsheet className="w-8 h-8 text-blue-700" />}
            title="Nenhuma planilha gerada ainda"
            description="Inicie a primeira solicitação para carregar os XMLs de notas fiscais e gerar a planilha Excel."
            actionLabel="Gerar Primeira Planilha"
            onAction={() => window.location.href = '/nova-solicitacao'}
          />
        ) : (
          <div className="overflow-x-auto -mx-5 -mb-5">
            <table className="w-full text-left text-xs divide-y divide-slate-200">
              <thead className="bg-slate-50/80 text-slate-700 font-semibold uppercase tracking-wider text-[11px]">
                <tr>
                  <th className="py-3 px-5">Empresa</th>
                  <th className="py-3 px-4">Competência</th>
                  <th className="py-3 px-4">Tipo</th>
                  <th className="py-3 px-4 text-center">Status</th>
                  <th className="py-3 px-4 text-center">Notas</th>
                  <th className="py-3 px-4">Data</th>
                  <th className="py-3 px-5 text-right">Ação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {recentSolicitacoes.map((sol) => {
                  const emp = getEmpresa(sol.empresa_id);
                  return (
                    <tr key={sol.id} className="hover:bg-slate-50/70 transition-colors">
                      <td className="py-3 px-5 font-medium text-slate-900">
                        <div>{emp?.razao_social || `Empresa #${sol.empresa_id}`}</div>
                        {emp && (
                          <div className="text-[10px] font-mono text-slate-400">
                            {formatCNPJ(emp.cnpj)}
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-4 font-semibold text-slate-800">
                        {formatCompetencia(sol.periodo_inicio)}
                      </td>
                      <td className="py-3 px-4 text-slate-700">
                        {getPlanilhaLabel(sol.tipo_planilha)}
                      </td>
                      <td className="py-3 px-4 text-center">
                        <StatusBadge status={sol.status} />
                      </td>
                      <td className="py-3 px-4 text-center font-mono font-bold text-slate-700">
                        {sol.total_notas_processadas}
                      </td>
                      <td className="py-3 px-4 text-slate-500 text-[11px]">
                        {formatDate(sol.criado_em)}
                      </td>
                      <td className="py-3 px-5 text-right">
                        {sol.status === 'concluido' ? (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleDownload(sol.id, sol.tipo_planilha, sol.empresa_id, sol.periodo_inicio)}
                            leftIcon={<Download className="w-3.5 h-3.5 text-blue-700" />}
                          >
                            Baixar .xlsx
                          </Button>
                        ) : (
                          <NavLink to="/solicitacoes">
                            <Button size="sm" variant="ghost">
                              Ver Detalhes
                            </Button>
                          </NavLink>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
};
