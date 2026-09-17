import { ArrowRight, CheckCircle2, Search, X } from 'lucide-react';

import { LoadingSpinner } from '../../components/feedback/LoadingSpinner';
import { Button } from '../../components/ui/Button';
import { formatCNPJ } from '../../lib/formatters';
import type { Empresa } from '../../types/empresa';

interface CompanySelectionStepProps {
  companies: Empresa[];
  isLoading: boolean;
  search: string;
  selectedCompany: Empresa | null;
  onSearchChange: (value: string) => void;
  onSelect: (company: Empresa) => void;
  onAdvance: () => void;
}

export function CompanySelectionStep({
  companies,
  isLoading,
  search,
  selectedCompany,
  onSearchChange,
  onSelect,
  onAdvance,
}: CompanySelectionStepProps) {
  return (
    <div className="space-y-5 animate-fade-in">
      <div>
        <h2 className="text-base sm:text-lg font-bold text-slate-900 tracking-tight">
          Etapa 1: Selecionar Empresa Cliente
        </h2>
        <p className="text-xs text-slate-500 mt-1 leading-relaxed">
          Escolha a empresa para a qual a planilha será gerada. <strong>Regra fundamental:</strong> Apenas notas fiscais emitidas por fornecedores de UF diferente da empresa cliente (operações interestaduais) são consideradas no cálculo de Antecipação e DIFAL.
        </p>
      </div>

      <div className="relative">
        <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3 pointer-events-none" />
        <input
          type="text"
          placeholder="Filtrar por Razão Social, CNPJ ou Estado..."
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          className="w-full pl-9 pr-8 py-2.5 text-base sm:text-sm min-h-[40px] bg-slate-50/70 border border-slate-200/90 rounded-xl focus:bg-white focus:outline-none focus:ring-4 focus:ring-blue-500/15 focus:border-blue-600 transition-all text-slate-900 placeholder:text-slate-400"
        />
        {search && (
          <button
            type="button"
            onClick={() => onSearchChange('')}
            aria-label="Limpar filtro de empresa"
            className="absolute right-3 top-3 text-slate-400 hover:text-slate-600 p-0.5 cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500 rounded"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {isLoading ? (
        <LoadingSpinner message="Carregando empresas cadastradas..." />
      ) : companies.length === 0 ? (
        <div className="py-8 text-center text-xs text-slate-500 bg-slate-50/50 rounded-xl border border-dashed border-slate-200 space-y-2">
          <p>
            {search
              ? 'Nenhuma empresa encontrada com o termo pesquisado.'
              : 'Nenhuma empresa ativa cadastrada no sistema.'}
          </p>
          {search && (
            <Button size="sm" variant="outline" onClick={() => onSearchChange('')}>
              Limpar pesquisa
            </Button>
          )}
        </div>
      ) : (
        <div
          role="radiogroup"
          aria-label="Lista de empresas para seleção"
          className="max-h-80 overflow-y-auto space-y-2 pr-1"
        >
          {companies.map((company) => {
            const isSelected = selectedCompany?.id === company.id;
            return (
              <div
                key={company.id}
                role="radio"
                aria-checked={isSelected}
                tabIndex={0}
                onClick={() => onSelect(company)}
                onKeyDown={(event) => {
                  if (event.key === ' ' || event.key === 'Enter') {
                    event.preventDefault();
                    onSelect(company);
                  }
                }}
                className={`p-3.5 rounded-xl border transition-all duration-150 cursor-pointer flex items-center justify-between gap-3 select-none focus:outline-none focus:ring-2 focus:ring-blue-600 ${
                  isSelected
                    ? 'bg-blue-50/80 border-blue-600 ring-2 ring-blue-600/20 shadow-xs'
                    : 'bg-white border-slate-200/80 hover:border-slate-300 hover:bg-slate-50/60'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div
                    className={`w-4 h-4 rounded-full border flex items-center justify-center shrink-0 transition-colors ${
                      isSelected ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-300 bg-white'
                    }`}
                  >
                    {isSelected && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                  </div>
                  <div className="space-y-1">
                    <div className="font-bold text-slate-900 text-xs sm:text-sm flex items-center gap-2">
                      <span>{company.razao_social}</span>
                      <span className="font-bold text-[10px] bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded border border-slate-200">
                        {company.uf}
                      </span>
                      {company.optante_simples_nacional && (
                        <span className="font-bold text-[10px] bg-amber-50 text-amber-800 px-1.5 py-0.5 rounded border border-amber-200">
                          Simples Nacional
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] font-mono text-slate-500 flex flex-wrap items-center gap-3">
                      <span>CNPJ: {formatCNPJ(company.cnpj)}</span>
                      {company.inscricao_estadual && (
                        <span className="text-slate-600 font-semibold">• I.E.: {company.inscricao_estadual}</span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="shrink-0">
                  {isSelected ? (
                    <span className="inline-flex items-center gap-1.5 text-xs font-bold text-blue-700 bg-blue-100/80 px-2.5 py-1 rounded-lg border border-blue-200">
                      <CheckCircle2 className="w-3.5 h-3.5" /> Selecionada
                    </span>
                  ) : (
                    <span className="text-[11px] font-medium text-slate-400">Selecionar</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="pt-4 border-t border-slate-100 flex justify-end">
        <Button
          onClick={onAdvance}
          disabled={!selectedCompany}
          rightIcon={<ArrowRight className="w-4 h-4" />}
        >
          Avançar: Período
        </Button>
      </div>
    </div>
  );
}
