import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Sparkles, X, FileSpreadsheet, CheckCircle2 } from 'lucide-react';
import { templatesApi, type TemplateAtivoResumo } from '../../api/templates';
import { getPlanilhaLabel } from '../../constants/domain';
import { getErrorMessage } from '../../api/client';
import { ErrorAlert } from './ErrorAlert';
import { queryKeys } from '../../api/queryKeys';

export const TemplateUpdateBanner: React.FC = () => {
  const [dismissed, setDismissed] = useState(false);

  const { data: templatesAtivos = [], error } = useQuery<TemplateAtivoResumo[]>({
    queryKey: queryKeys.templatesAtivos,
    queryFn: templatesApi.listarAtivosResumo,
    staleTime: 60_000,
  });

  if (dismissed) {
    return null;
  }

  if (error) return <ErrorAlert title="Modelos indisponíveis" message={getErrorMessage(error)} />;
  if (templatesAtivos.length === 0) return null;

  return (
    <div className="mb-6 rounded-xl border border-blue-500/25 bg-gradient-to-r from-slate-950 via-blue-950 to-slate-950 p-4 sm:p-5 shadow-sm text-white animate-fade-in backdrop-blur-md">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3.5">
          <div className="p-2 rounded-lg bg-blue-500/20 border border-blue-400/30 text-cyan-400 shrink-0 mt-0.5">
            <Sparkles className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h4 className="text-xs sm:text-sm font-bold text-white tracking-tight">
                Modelos Oficiais Ativos & Sincronizados
              </h4>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                <CheckCircle2 className="w-3 h-3" />
                Atualizado pelo Contador Sênior
              </span>
            </div>
            <p className="mt-1 text-xs text-slate-300/90 leading-relaxed">
              Cada apuração utiliza automaticamente o menor modelo oficial cuja capacidade comporte todas as linhas geradas:
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {templatesAtivos.map((t) => (
                <div
                  key={t.id}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-900/90 border border-slate-700/80 text-[11px] text-slate-200 shadow-2xs"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5 text-cyan-400" />
                  <span className="font-medium">
                    {getPlanilhaLabel(t.tipo)}:
                  </span>
                  <span className="px-1.5 py-0.2 rounded bg-blue-900/70 text-cyan-300 font-mono text-[10px] font-bold">
                    v{t.versao}{t.capacidade_linhas ? ` · até ${t.capacidade_linhas.toLocaleString('pt-BR')} linhas` : ' · legado'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setDismissed(true)}
          aria-label="Fechar aviso de modelos"
          className="text-slate-400 hover:text-slate-200 p-1.5 rounded-lg hover:bg-slate-800/70 transition-colors cursor-pointer"
          title="Fechar aviso"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
