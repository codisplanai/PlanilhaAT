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
    <div className="mb-6 rounded-lg border border-blue-500/30 bg-gradient-to-r from-blue-950/60 via-slate-900/80 to-blue-950/40 p-4 shadow-md shadow-blue-950/20 backdrop-blur-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-md bg-blue-500/15 border border-blue-400/30 text-blue-400 shrink-0">
            <Sparkles className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h4 className="text-xs font-semibold text-white">
                Modelos Oficiais Ativos & Sincronizados
              </h4>
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                <CheckCircle2 className="w-3 h-3" />
                Atualizado pelo Contador Sênior
              </span>
            </div>
            <p className="mt-1 text-xs text-slate-300">
              Todas as novas apurações fiscais geradas utilizarão automaticamente a versão mais recente dos modelos:
            </p>
            <div className="mt-2.5 flex flex-wrap gap-2">
              {templatesAtivos.map((t) => (
                <div
                  key={t.id}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-slate-800/90 border border-slate-700 text-[11px] text-slate-200"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5 text-blue-400" />
                  <span className="font-medium">
                    {getPlanilhaLabel(t.tipo)}:
                  </span>
                  <span className="px-1 py-0.2 rounded bg-blue-900/60 text-blue-300 font-mono text-[10px]">
                    v{t.versao}
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
          className="text-slate-400 hover:text-slate-200 p-1 rounded-md hover:bg-slate-800/60 transition-colors"
          title="Fechar aviso"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
