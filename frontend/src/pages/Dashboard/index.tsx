import { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import {
  Building2,
  CheckCircle2,
  AlertCircle,
  PlusCircle,
  Download,
  ArrowRight,
  TrendingUp,
  FileSpreadsheet,
} from 'lucide-react';

import { solicitacoesApi } from '../../api/solicitacoes';
import { getErrorMessage } from '../../api/client';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { LoadingSpinner } from '../../components/feedback/LoadingSpinner';
import { EmptyState } from '../../components/feedback/EmptyState';
import { ErrorAlert } from '../../components/feedback/ErrorAlert';
import {
  formatCNPJ,
  formatDate,
  formatCompetencia,
} from '../../lib/formatters';
import { StatusBadge } from '../../components/domain/StatusBadge';
import { getPlanilhaLabel, TIPOS_PLANILHA_OPTIONS } from '../../constants/domain';
import { CodisplanLogo } from '../../components/ui/CodisplanLogo';
import {
  useEmpresasQuery,
  useSolicitacoesQuery,
  useTemplatesQuery,
} from '../../hooks/useApiQueries';

export const DashboardPage: React.FC = () => {
  const navigate = useNavigate();
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const { data: solicitacoes = [], isLoading: isLoadingSols, error: solicitacoesError } = useSolicitacoesQuery();
  const { data: empresas = [], isLoading: isLoadingEmps, error: empresasError } = useEmpresasQuery();
  const { data: templates = [], isLoading: isLoadingTemplates, error: templatesError } = useTemplatesQuery();

  const concluidasCount = solicitacoes.filter((s) => s.status === 'concluido').length;
  const erroCount = solicitacoes.filter((s) => s.status === 'erro').length;
  const totalNotas = solicitacoes.reduce((acc, s) => acc + (s.total_notas_processadas || 0), 0);

  const templatesAtivos = templates.filter((t) => t.ativo);
  const recentSolicitacoes = solicitacoes.slice(0, 8);

  const getEmpresa = (id: number) => empresas.find((e) => e.id === id);

  const handleDownload = async (id: string, tipo: string, empId: number, data: string) => {
    setDownloadError(null);
    setDownloadingId(id);
    try {
      const emp = getEmpresa(empId);
      const empNome = emp ? emp.razao_social.slice(0, 15).replace(/\s+/g, '_') : 'Empresa';
      const filename = `Planilha_${tipo}_${empNome}_${data.slice(0, 7)}.xlsx`;
      await solicitacoesApi.downloadPlanilha(id, filename);
    } catch (err) {
      setDownloadError(getErrorMessage(err));
    } finally {
      setDownloadingId(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Banner Operacional */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-slate-950 via-blue-950 to-slate-900 text-white p-6 sm:p-8 shadow-md border border-blue-800/40 flex flex-col sm:flex-row sm:items-center justify-between gap-6">
        <div className="absolute top-0 right-0 w-80 h-80 bg-cyan-500/10 rounded-full blur-3xl pointer-events-none" />

        <div className="space-y-2.5 max-w-xl relative z-10">
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-blue-500/20 text-cyan-300 text-[11px] font-semibold border border-blue-400/30">
              <TrendingUp className="w-3.5 h-3.5" />
              <span>Sistema Contábil Integrado</span>
            </div>
            <div className="inline-flex items-center px-2 py-0.5 rounded-md bg-slate-900/80 border border-slate-700/60 shadow-2xs">
              <CodisplanLogo theme="dark" size="xs" />
            </div>
          </div>
          <h1 className="text-xl sm:text-2xl font-black tracking-tight text-white">
            Painel Operacional de Antecipação e DIFAL
          </h1>
          <p className="text-xs text-blue-100/80 leading-relaxed">
            Processamento determinístico de NF-e e SPED Fiscal com preenchimento inviolável de fórmulas Excel.
          </p>
        </div>

        <div className="shrink-0 relative z-10">
          <NavLink
            to="/nova-solicitacao"
            className="inline-flex items-center justify-center gap-2 rounded-xl px-5 py-3 bg-white text-slate-900 hover:bg-blue-50 shadow-md font-bold text-xs transition-all duration-150 active:scale-[0.98] focus:outline-none focus:ring-2 focus:ring-white focus:ring-offset-2 focus:ring-offset-blue-950 cursor-pointer"
          >
            <PlusCircle className="w-4 h-4 text-blue-700" />
            <span>Gerar Nova Planilha</span>
          </NavLink>
        </div>
      </div>

      {(solicitacoesError || empresasError || templatesError) && (
        <ErrorAlert message={getErrorMessage(solicitacoesError || empresasError || templatesError)} />
      )}

      {downloadError && (
        <ErrorAlert
          title="Erro ao baixar planilha"
          message={downloadError}
          onDismiss={() => setDownloadError(null)}
        />
      )}

      {/* Metrics Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Concluídas */}
        <Card className="p-4 sm:p-5 card-interactive">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                Planilhas Geradas
              </p>
              <p className="text-2xl sm:text-3xl font-bold font-mono text-slate-900 mt-1 tabular-nums">
                {isLoadingSols ? '...' : concluidasCount}
              </p>
            </div>
            <div className="w-11 h-11 rounded-xl bg-emerald-50 text-emerald-600 border border-emerald-200/60 flex items-center justify-center shadow-2xs">
              <CheckCircle2 className="w-5 h-5" />
            </div>
          </div>
          <p className="text-[11px] text-slate-500 mt-2.5 flex items-center gap-1.5 font-medium">
            <span className="font-semibold text-slate-700">{totalNotas}</span> itens de NF-e processados
          </p>
        </Card>

        {/* Card 2: Empresas Atendidas */}
        <Card className="p-4 sm:p-5 card-interactive">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                Empresas Atendidas
              </p>
              <p className="text-2xl sm:text-3xl font-bold font-mono text-slate-900 mt-1 tabular-nums">
                {isLoadingEmps ? '...' : empresas.length}
              </p>
            </div>
            <div className="w-11 h-11 rounded-xl bg-blue-50 text-blue-700 border border-blue-200/60 flex items-center justify-center shadow-2xs">
              <Building2 className="w-5 h-5" />
            </div>
          </div>
          <NavLink
            to="/empresas"
            className="text-[11px] text-blue-700 hover:text-blue-900 font-semibold mt-2.5 inline-flex items-center gap-1 group"
          >
            <span>Gerenciar empresas clientes</span>
            <ArrowRight className="w-3 h-3 transition-transform group-hover:translate-x-0.5" />
          </NavLink>
        </Card>

        {/* Card 3: Modelos Vigentes */}
        <Card className="p-4 sm:p-5 card-interactive">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                Modelos de Excel
              </p>
              <p className="text-2xl sm:text-3xl font-bold font-mono text-slate-900 mt-1 tabular-nums">
                {isLoadingTemplates ? '...' : `${templatesAtivos.length}/${TIPOS_PLANILHA_OPTIONS.length}`}
              </p>
            </div>
            <div className="w-11 h-11 rounded-xl bg-amber-50 text-amber-600 border border-amber-200/60 flex items-center justify-center shadow-2xs">
              <FileSpreadsheet className="w-5 h-5" />
            </div>
          </div>
          <p className="text-[11px] text-slate-500 mt-2.5 flex items-center gap-1 font-medium">
            <span className="font-semibold text-slate-700">{templates.length}</span> versões versionadas
          </p>
        </Card>

        {/* Card 4: Inconsistências / Erros */}
        <Card className="p-4 sm:p-5 card-interactive">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                Inconsistências / Erros
              </p>
              <p className="text-2xl sm:text-3xl font-bold font-mono text-slate-900 mt-1 tabular-nums">
                {isLoadingSols ? '...' : erroCount}
              </p>
            </div>
            <div className="w-11 h-11 rounded-xl bg-rose-50 text-rose-600 border border-rose-200/60 flex items-center justify-center shadow-2xs">
              <AlertCircle className="w-5 h-5" />
            </div>
          </div>
          <p className="text-[11px] text-slate-500 mt-2.5 font-medium">
            Bloqueados por validação fiscal
          </p>
        </Card>
      </div>

      {/* Solicitações Recentes */}
      <Card
        title="Solicitações Recentes de Processamento"
        subtitle="Acompanhamento das últimas planilhas geradas e download direto"
        bodyPadding="none"
        headerAction={
          <NavLink
            to="/solicitacoes"
            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-700 hover:text-slate-900 hover:bg-slate-100/90 transition-colors"
          >
            <span>Ver Histórico Completo</span>
            <ArrowRight className="w-3.5 h-3.5 text-slate-500" />
          </NavLink>
        }
      >
        {isLoadingSols ? (
          <div className="p-6 sm:p-8">
            <LoadingSpinner message="Carregando solicitações..." />
          </div>
        ) : recentSolicitacoes.length === 0 ? (
          <div className="p-6 sm:p-8">
            <EmptyState
              icon={<FileSpreadsheet className="w-7 h-7 text-blue-700" />}
              title="Nenhuma planilha gerada ainda"
              description="Inicie a primeira solicitação para carregar os XMLs de notas fiscais e gerar a planilha Excel."
              actionLabel="Gerar Primeira Planilha"
              onAction={() => navigate('/nova-solicitacao')}
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs divide-y divide-slate-100">
              <thead className="bg-slate-50/70 text-slate-500 font-bold uppercase tracking-wider text-[10px]">
                <tr>
                  <th scope="col" className="py-3 px-5">Empresa</th>
                  <th scope="col" className="py-3 px-4">Competência</th>
                  <th scope="col" className="py-3 px-4">Tipo</th>
                  <th scope="col" className="py-3 px-4 text-center">Status</th>
                  <th scope="col" className="py-3 px-4 text-center">Notas</th>
                  <th scope="col" className="py-3 px-4">Data</th>
                  <th scope="col" className="py-3 px-5 text-right">Ação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100/80">
                {recentSolicitacoes.map((sol) => {
                  const emp = getEmpresa(sol.empresa_id);
                  return (
                    <tr key={sol.id} className="hover:bg-slate-50/70 transition-colors">
                      <td className="py-3.5 px-5 font-semibold text-slate-900">
                        <div>{emp?.razao_social || `Empresa #${sol.empresa_id}`}</div>
                        {emp && (
                          <div className="text-[11px] font-mono font-normal text-slate-400">
                            {formatCNPJ(emp.cnpj)}
                          </div>
                        )}
                      </td>
                      <td className="py-3.5 px-4 font-semibold text-slate-800">
                        {formatCompetencia(sol.periodo_inicio)}
                      </td>
                      <td className="py-3.5 px-4 text-slate-700 font-medium">
                        {getPlanilhaLabel(sol.tipo_planilha)}
                      </td>
                      <td className="py-3.5 px-4 text-center">
                        <StatusBadge status={sol.status} />
                      </td>
                      <td className="py-3.5 px-4 text-center font-mono font-bold text-slate-700">
                        {sol.total_notas_processadas}
                      </td>
                      <td className="py-3.5 px-4 text-slate-500 text-[11px]">
                        {formatDate(sol.criado_em)}
                      </td>
                      <td className="py-3.5 px-5 text-right">
                        {sol.status === 'concluido' ? (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleDownload(sol.id, sol.tipo_planilha, sol.empresa_id, sol.periodo_inicio)}
                            isLoading={downloadingId === sol.id}
                            disabled={downloadingId !== null}
                            leftIcon={<Download className="w-3.5 h-3.5 text-blue-700" />}
                          >
                            Baixar .xlsx
                          </Button>
                        ) : (
                          <NavLink
                            to="/solicitacoes"
                            className="inline-flex items-center rounded-lg px-2.5 py-1 text-xs font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-colors"
                          >
                            Ver Detalhes
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
