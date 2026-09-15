import React, { useState, useMemo } from 'react';
import { Search, ChevronDown, ChevronUp, ShieldAlert } from 'lucide-react';
import type { ItemExcluido } from '../../types/solicitacao';
import { formatCurrency, formatPercent } from '../../lib/formatters';
import { Badge } from '../ui/Badge';
import { PlanilhaBadge } from './PlanilhaBadge';
import type { TipoPlanilha } from '../../types/solicitacao';

interface ItensExcluidosSectionProps {
  itens: ItemExcluido[];
  defaultExpanded?: boolean;
}

export const ItensExcluidosSection: React.FC<ItensExcluidosSectionProps> = ({
  itens,
  defaultExpanded = true,
}) => {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterTipo, setFilterTipo] = useState<'todos' | 'mercadoria' | 'aliquotas_iguais'>('todos');

  const filteredItens = useMemo(() => {
    return itens.filter((item) => {
      if (filterTipo !== 'todos' && item.tipo_exclusao !== filterTipo) {
        return false;
      }
      if (!searchTerm.trim()) return true;
      const term = searchTerm.toLowerCase();
      return (
        item.numero_nota.toLowerCase().includes(term) ||
        item.ncm.toLowerCase().includes(term) ||
        (item.descricao && item.descricao.toLowerCase().includes(term)) ||
        item.motivo.toLowerCase().includes(term)
      );
    });
  }, [itens, filterTipo, searchTerm]);

  const countMercadoria = useMemo(() => itens.filter((i) => i.tipo_exclusao === 'mercadoria').length, [itens]);
  const countAliquotasIguais = useMemo(() => itens.filter((i) => i.tipo_exclusao === 'aliquotas_iguais').length, [itens]);

  if (!itens || itens.length === 0) return null;

  return (
    <div className="bg-slate-50/90 border border-slate-200/90 rounded-2xl p-4 sm:p-5 space-y-4 shadow-2xs animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-start sm:items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-slate-700 text-white flex items-center justify-center shrink-0 shadow-2xs">
            <ShieldAlert className="w-5 h-5 text-slate-100" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-sm sm:text-base font-bold text-slate-900 tracking-tight">
                Conferência de Itens Excluídos da Parcial
              </h3>
              <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-slate-200/80 text-slate-700">
                {itens.length} {itens.length === 1 ? 'item' : 'itens'}
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
              Itens desconsiderados automaticamente por exclusão legal de mercadorias (BA) ou alíquotas iguais (sem valor a recolher).
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setIsExpanded(!isExpanded)}
          className="self-end sm:self-auto inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-white border border-slate-200 text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
        >
          {isExpanded ? (
            <>
              <ChevronUp className="w-3.5 h-3.5" /> Recolher
            </>
          ) : (
            <>
              <ChevronDown className="w-3.5 h-3.5" /> Expandir Detalhes
            </>
          )}
        </button>
      </div>

      {isExpanded && (
        <div className="space-y-3.5 pt-2 border-t border-slate-200/80">
          {/* Controls: Search and Filters */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
            <div className="flex items-center gap-1.5 flex-wrap">
              <button
                type="button"
                onClick={() => setFilterTipo('todos')}
                className={`px-2.5 py-1 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
                  filterTipo === 'todos'
                    ? 'bg-slate-900 text-white shadow-2xs'
                    : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'
                }`}
              >
                Todos ({itens.length})
              </button>
              <button
                type="button"
                onClick={() => setFilterTipo('mercadoria')}
                className={`px-2.5 py-1 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
                  filterTipo === 'mercadoria'
                    ? 'bg-amber-700 text-white shadow-2xs'
                    : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'
                }`}
              >
                Mercadorias / Commodities ({countMercadoria})
              </button>
              <button
                type="button"
                onClick={() => setFilterTipo('aliquotas_iguais')}
                className={`px-2.5 py-1 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
                  filterTipo === 'aliquotas_iguais'
                    ? 'bg-indigo-700 text-white shadow-2xs'
                    : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'
                }`}
              >
                Alíquotas Iguais ({countAliquotasIguais})
              </button>
            </div>

            <div className="relative sm:w-64">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5 pointer-events-none" />
              <input
                type="text"
                placeholder="Filtrar por NF, NCM ou Produto..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-400 focus:border-slate-500 text-slate-800"
              />
            </div>
          </div>

          {/* Table */}
          {filteredItens.length === 0 ? (
            <div className="py-6 text-center text-xs text-slate-500 bg-white rounded-xl border border-dashed border-slate-200">
              Nenhum item excluído encontrado para os filtros selecionados.
            </div>
          ) : (
            <div className="overflow-x-auto border border-slate-200/90 rounded-xl bg-white shadow-2xs max-h-96">
              <table className="w-full text-left text-xs divide-y divide-slate-100">
                <thead className="bg-slate-50/90 text-slate-500 font-bold uppercase text-[10px] tracking-wider sticky top-0">
                  <tr>
                    <th className="py-2.5 px-3">Nota / Item</th>
                    <th className="py-2.5 px-3">Destino</th>
                    <th className="py-2.5 px-3 font-mono">NCM</th>
                    <th className="py-2.5 px-3">Descrição do Produto</th>
                    <th className="py-2.5 px-3">Motivo / Tipo de Exclusão</th>
                    <th className="py-2.5 px-3 text-right">V. Total</th>
                    <th className="py-2.5 px-3 text-right">Base Cálc.</th>
                    <th className="py-2.5 px-3 text-right font-mono">A.ORI</th>
                    <th className="py-2.5 px-3 text-right font-mono">A.DST</th>
                    <th className="py-2.5 px-3 text-right font-mono">Débito</th>
                    <th className="py-2.5 px-3 text-right font-mono">Crédito</th>
                    <th className="py-2.5 px-3 text-right font-mono text-slate-700">V. Devido</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredItens.map((item, idx) => {
                    const isMercadoria = item.tipo_exclusao === 'mercadoria';
                    return (
                      <tr key={idx} className="hover:bg-slate-50/70 transition-colors">
                        <td className="py-2.5 px-3 whitespace-nowrap">
                          <div className="font-semibold text-slate-900">
                            NF-e nº {item.numero_nota} {item.serie ? `(${item.serie})` : ''}
                          </div>
                          <div className="text-[10px] text-slate-400 font-mono">
                            Item {item.item_numero}
                          </div>
                        </td>
                        <td className="py-2.5 px-3 whitespace-nowrap">
                          {item.destino ? (
                            <PlanilhaBadge tipo={item.destino as TipoPlanilha} />
                          ) : (
                            <span className="text-slate-400">-</span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 font-mono text-slate-700 whitespace-nowrap">
                          {item.ncm}
                        </td>
                        <td className="py-2.5 px-3 max-w-xs">
                          <div className="text-slate-800 font-medium line-clamp-2" title={item.descricao}>
                            {item.descricao || <span className="text-slate-400 italic">Sem descrição</span>}
                          </div>
                          {!item.descricao_confiavel && (
                            <span className="inline-flex items-center gap-1 text-[9px] font-bold text-amber-700 bg-amber-50 px-1 py-0.5 rounded border border-amber-200 mt-0.5">
                              Descrição genérica/não confiável
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 max-w-sm">
                          <div className="flex items-center gap-1.5 mb-0.5">
                            {isMercadoria ? (
                              <Badge variant="warning" size="sm">
                                Commodity / Exclusão
                              </Badge>
                            ) : (
                              <Badge variant="info" size="sm">
                                Alíquotas Iguais (A.ORI=A.DST)
                              </Badge>
                            )}
                          </div>
                          <p className="text-[11px] text-slate-600 leading-snug">{item.motivo}</p>
                          {item.regras_aplicadas && item.regras_aplicadas.length > 0 && (
                            <div className="mt-1 flex flex-wrap gap-1">
                              {item.regras_aplicadas.map((r, rIdx) => (
                                <span key={rIdx} className="text-[9px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded font-mono border border-slate-200" title={`Regra #${r.id || ''}: ${r.descricao_regra || ''}`}>
                                  Termos: {(Array.isArray(r.termos_obrigatorios) ? r.termos_obrigatorios : []).join(', ')}
                                </span>
                              ))}
                            </div>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-700 whitespace-nowrap">
                          {item.v_total != null ? formatCurrency(item.v_total) : '-'}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-700 whitespace-nowrap">
                          {item.base_calculo != null ? formatCurrency(item.base_calculo) : '-'}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-600 whitespace-nowrap">
                          {item.a_ori != null ? formatPercent(item.a_ori) : '-'}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums font-bold text-slate-800 whitespace-nowrap">
                          {item.a_dst != null ? formatPercent(item.a_dst) : <span className="text-slate-400 font-sans font-normal italic text-[10px]">Não calculada</span>}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-600 whitespace-nowrap">
                          {item.debito != null ? formatCurrency(item.debito) : <span className="text-slate-400 font-sans italic text-[10px]">-</span>}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-600 whitespace-nowrap">
                          {item.credito != null ? formatCurrency(item.credito) : <span className="text-slate-400 font-sans italic text-[10px]">-</span>}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums whitespace-nowrap">
                          {item.valor_devido != null ? (
                            <span className={`font-bold ${item.valor_devido < 0 ? 'text-amber-700' : 'text-slate-600'}`}>
                              {formatCurrency(item.valor_devido)}
                            </span>
                          ) : (
                            <span className="text-slate-400 font-sans italic text-[10px]" title="Não calculado (exclusão por mercadoria)">
                              Não calculado
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
