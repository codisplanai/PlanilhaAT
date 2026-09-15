import React from 'react';
import { AlertCircle } from 'lucide-react';
import type { AvisoAvaliacao } from '../../types/solicitacao';

interface AvisosAvaliacaoSectionProps {
  avisos: AvisoAvaliacao[];
}

export const AvisosAvaliacaoSection: React.FC<AvisosAvaliacaoSectionProps> = ({ avisos }) => {
  if (!avisos || avisos.length === 0) return null;

  return (
    <div className="bg-amber-50/90 border border-amber-300/80 rounded-2xl p-4 sm:p-5 space-y-3 shadow-2xs animate-fade-in">
      <div className="flex items-start gap-3">
        <div className="w-8 h-8 rounded-xl bg-amber-500 text-white flex items-center justify-center shrink-0 shadow-2xs mt-0.5">
          <AlertCircle className="w-5 h-5" />
        </div>
        <div>
          <h3 className="text-sm font-bold text-amber-950 tracking-tight">
            Avisos de Avaliação Fiscal ({avisos.length} {avisos.length === 1 ? 'item' : 'itens'})
          </h3>
          <p className="text-xs text-amber-900/90 mt-0.5 leading-relaxed">
            Alguns itens não puderam ter os termos descritivos avaliados por ausência de descrição do produto na fonte (ex: SPED Fiscal sem registro filho C170). O cálculo padrão foi mantido.
          </p>
        </div>
      </div>

      <div className="overflow-x-auto border border-amber-200 rounded-xl bg-white max-h-48">
        <table className="w-full text-left text-xs divide-y divide-amber-100">
          <thead className="bg-amber-50 text-amber-900 font-bold uppercase text-[10px] sticky top-0">
            <tr>
              <th className="py-2 px-3">Nota / Item</th>
              <th className="py-2 px-3">Arquivo de Origem</th>
              <th className="py-2 px-3">Aviso de Avaliação</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-amber-100/60">
            {avisos.map((aviso, idx) => (
              <tr key={idx} className="hover:bg-amber-50/50">
                <td className="py-2 px-3 font-semibold text-slate-900 whitespace-nowrap">
                  NF-e nº {aviso.numero_nota} {aviso.serie ? `(${aviso.serie})` : ''} • Item {aviso.item_numero}
                </td>
                <td className="py-2 px-3 text-slate-500 font-mono text-[11px] truncate max-w-[180px]" title={aviso.arquivo || ''}>
                  {aviso.arquivo || '-'}
                </td>
                <td className="py-2 px-3 text-amber-950 font-medium">
                  {aviso.aviso}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
