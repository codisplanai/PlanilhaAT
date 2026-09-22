import React, { useMemo, useState } from 'react';
import { Copy, Edit2, Search, Trash2 } from 'lucide-react';

import type { PerfilRegras } from '../../types/perfil';

interface PerfilListProps {
  perfis: PerfilRegras[];
  activePerfilId?: number;
  onSelect: (perfilId: number) => void;
  onEdit: (perfil: PerfilRegras) => void;
  onDuplicate: (perfil: PerfilRegras) => void;
  onDelete: (perfil: PerfilRegras) => void;
}

export const PerfilList: React.FC<PerfilListProps> = ({
  perfis,
  activePerfilId,
  onSelect,
  onEdit,
  onDuplicate,
  onDelete,
}) => {
  const [filter, setFilter] = useState('');
  const showSearch = perfis.length > 6;
  const visibleProfiles = useMemo(() => {
    const term = filter.trim().toLowerCase();
    if (!term) return perfis;
    return perfis.filter(
      (perfil) =>
        perfil.nome.toLowerCase().includes(term) ||
        (perfil.descricao || '').toLowerCase().includes(term),
    );
  }, [perfis, filter]);

  return (
    <div className="space-y-3 lg:col-span-4 lg:sticky lg:top-4 lg:self-start">
      <div className="flex items-baseline justify-between gap-2 px-1">
        <h2 className="text-sm font-bold tracking-tight text-slate-900">
          Perfis compartilhados
        </h2>
        <span className="font-mono text-xs tabular-nums text-slate-400">{perfis.length}</span>
      </div>

      {showSearch && (
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Buscar perfil"
            aria-label="Buscar perfil pelo nome ou descrição"
            className="w-full rounded-lg border border-slate-200/90 bg-white py-2 pl-9 pr-3 text-sm text-slate-900 shadow-2xs transition-all duration-150 placeholder:text-slate-400 hover:border-slate-300 focus:border-blue-600 focus:outline-none focus:ring-4 focus:ring-blue-500/15"
          />
        </div>
      )}

      <div className="space-y-2 lg:max-h-[calc(100vh-11rem)] lg:overflow-y-auto lg:pr-1">
        {visibleProfiles.length === 0 && (
          <p className="rounded-xl border border-dashed border-slate-200 bg-white/60 px-4 py-6 text-center text-xs text-slate-500">
            Nenhum perfil corresponde a &ldquo;{filter}&rdquo;.
          </p>
        )}
        {visibleProfiles.map((perfil) => {
          const isSelected = activePerfilId === perfil.id;
          return (
            <div
              key={perfil.id}
              role="button"
              tabIndex={0}
              aria-pressed={isSelected}
              onClick={() => onSelect(perfil.id)}
              onKeyDown={(event) => {
                if (
                  event.target === event.currentTarget &&
                  (event.key === 'Enter' || event.key === ' ')
                ) {
                  event.preventDefault();
                  onSelect(perfil.id);
                }
              }}
              className={`group relative cursor-pointer rounded-xl border py-3.5 pl-4 pr-3 text-left transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 ${
                isSelected
                  ? 'border-blue-600 bg-blue-50/70 shadow-xs'
                  : 'border-slate-200/80 bg-white hover:border-slate-300 hover:bg-slate-50/60'
              }`}
            >
              {isSelected && (
                <span
                  aria-hidden="true"
                  className="absolute inset-y-2.5 left-0 w-1 rounded-r-full bg-blue-600"
                />
              )}
              <div className="flex items-start justify-between gap-2">
                <h4
                  className={`text-sm font-bold tracking-tight ${
                    isSelected ? 'text-blue-950' : 'text-slate-900'
                  }`}
                >
                  {perfil.nome}
                </h4>
                <div
                  className={`flex shrink-0 items-center gap-0.5 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100 max-lg:opacity-100 ${
                    isSelected ? 'opacity-100' : 'opacity-0'
                  }`}
                >
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onEdit(perfil);
                    }}
                    className="p-1 rounded-md text-slate-400 hover:text-blue-700 hover:bg-blue-50 transition-colors cursor-pointer"
                    title="Editar perfil"
                    aria-label={`Editar perfil ${perfil.nome}`}
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onDuplicate(perfil);
                    }}
                    className="p-1 rounded-md text-slate-400 hover:text-blue-700 hover:bg-blue-50 transition-colors cursor-pointer"
                    title="Duplicar perfil"
                    aria-label={`Duplicar perfil ${perfil.nome}`}
                  >
                    <Copy className="w-3.5 h-3.5" />
                  </button>
                  {perfis.length > 1 && (
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        onDelete(perfil);
                      }}
                      className="p-1 rounded-md text-slate-400 hover:text-rose-700 hover:bg-rose-50 transition-colors cursor-pointer"
                      title="Remover perfil"
                      aria-label={`Remover perfil ${perfil.nome}`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
              {perfil.descricao && (
                <p className="text-xs text-slate-500 mt-1 line-clamp-2 leading-relaxed">
                  {perfil.descricao}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
