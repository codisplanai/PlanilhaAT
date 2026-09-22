import { ArrowLeft, ArrowRight, Calendar } from 'lucide-react';

import { Button } from '../../components/ui/Button';
import { getMonthPeriod } from '../../lib/periods';

interface PeriodSelectionStepProps {
  companyName?: string;
  start: string;
  end: string;
  onStartChange: (value: string) => void;
  onEndChange: (value: string) => void;
  onBack: () => void;
  onAdvance: () => void;
}

export function PeriodSelectionStep({
  companyName,
  start,
  end,
  onStartChange,
  onEndChange,
  onBack,
  onAdvance,
}: PeriodSelectionStepProps) {
  const selectMonth = (offset: number) => {
    const period = getMonthPeriod(offset);
    onStartChange(period.start);
    onEndChange(period.end);
  };

  return (
    <div className="space-y-5 animate-fade-in">
      <div>
        <h2 className="text-base sm:text-lg font-bold text-slate-900 tracking-tight">
          Etapa 2: Período de Competência
        </h2>
        <p className="text-xs text-slate-500 mt-1 leading-relaxed">
          Defina o intervalo de datas das notas fiscais a serem processadas para a empresa <strong>{companyName}</strong>.
        </p>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mr-1">
          Atalhos Rápidos:
        </span>
        <button
          type="button"
          onClick={() => selectMonth(0)}
          className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors cursor-pointer"
        >
          Mês Atual
        </button>
        <button
          type="button"
          onClick={() => selectMonth(-1)}
          className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors cursor-pointer"
        >
          Mês Anterior
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <label className="block text-xs font-semibold text-slate-700">Data Inicial do Período</label>
          <input
            type="date"
            value={start}
            onChange={(event) => onStartChange(event.target.value)}
            max={end || undefined}
            className="w-full px-3 py-2 text-base sm:text-sm min-h-[40px] bg-white border border-slate-200/90 rounded-lg shadow-2xs focus:outline-none focus:ring-4 focus:ring-blue-500/15 focus:border-blue-600 text-slate-900 font-medium"
          />
        </div>

        <div className="space-y-1.5">
          <label className="block text-xs font-semibold text-slate-700">Data Final do Período</label>
          <input
            type="date"
            value={end}
            onChange={(event) => onEndChange(event.target.value)}
            min={start || undefined}
            className="w-full px-3 py-2 text-base sm:text-sm min-h-[40px] bg-white border border-slate-200/90 rounded-lg shadow-2xs focus:outline-none focus:ring-4 focus:ring-blue-500/15 focus:border-blue-600 text-slate-900 font-medium"
          />
        </div>
      </div>

      <div className="bg-blue-50/80 border border-blue-200/70 rounded-xl p-3.5 text-xs text-blue-950 flex items-center gap-2.5">
        <Calendar className="w-4 h-4 text-blue-700 shrink-0" />
        <span>Notas fiscais com data de emissão fora deste intervalo são desconsideradas na apuração contábil.</span>
      </div>

      <div className="pt-4 border-t border-slate-100 flex justify-between">
        <Button variant="outline" onClick={onBack} leftIcon={<ArrowLeft className="w-4 h-4" />}>
          Voltar
        </Button>
        <Button onClick={onAdvance} rightIcon={<ArrowRight className="w-4 h-4" />}>
          Avançar: Upload de Arquivos
        </Button>
      </div>
    </div>
  );
}
