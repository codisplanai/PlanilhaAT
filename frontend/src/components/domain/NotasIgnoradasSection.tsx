import React from 'react';
import { AlertTriangle } from 'lucide-react';

import type { NotaIgnorada } from '../../types/solicitacao';
import { DanfeButton } from '../DanfeButton';

interface NotasIgnoradasSectionProps {
  notas: NotaIgnorada[];
  variant?: 'default' | 'compact';
}

export const NotasIgnoradasSection: React.FC<NotasIgnoradasSectionProps> = ({
  notas,
  variant = 'default',
}) => {
  if (!notas || notas.length === 0) return null;
  const compact = variant === 'compact';

  return (
    <div
      className={
        compact
          ? 'bg-amber-50/90 border border-amber-300/80 rounded-xl p-4 space-y-2.5 shadow-2xs'
          : 'bg-amber-50/90 border border-amber-300/80 rounded-xl p-4 sm:p-5 space-y-3 shadow-2xs animate-fade-in'
      }
    >
      {compact ? (
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
          <span className="text-xs font-bold text-amber-950">
            {notas.length} nota(s) fiscal(is) desconsiderada(s) (operações internas ou fora do período)
          </span>
        </div>
      ) : (
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-lg bg-amber-500 text-white flex items-center justify-center shrink-0 mt-0.5 shadow-2xs">
            <AlertTriangle className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-amber-950 tracking-tight">
              Aviso: {notas.length} nota(s) fiscal(is) desconsiderada(s)
            </h3>
            <p className="text-xs text-amber-800/90 mt-0.5 leading-relaxed">
              As notas fiscais abaixo foram desconsideradas automaticamente pela Camada de Sanidade e Regras Fiscais (operações internas com mesma UF do cliente ou datas fora do período). As notas válidas foram apuradas normalmente.
            </p>
          </div>
        </div>
      )}

      <div
        className={`overflow-x-auto border border-amber-200 rounded-lg bg-white ${
          compact ? 'max-h-40' : ''
        }`}
      >
        <table className="w-full text-left text-xs divide-y divide-amber-100">
          <thead
            className={`text-amber-900 font-bold uppercase text-[10px] ${
              compact ? 'bg-amber-50 sticky top-0' : 'bg-amber-50/80'
            }`}
          >
            <tr>
              <th className={compact ? 'py-2 px-2.5' : 'py-2.5 px-3'}>Nota / Série</th>
              <th className={compact ? 'py-2 px-2.5' : 'py-2.5 px-3'}>
                {compact ? 'Emissão' : 'Data Emissão'}
              </th>
              <th className={compact ? 'py-2 px-2.5' : 'py-2.5 px-3'}>Arquivo de Origem</th>
              <th className={compact ? 'py-2 px-2.5' : 'py-2.5 px-3'}>
                {compact ? 'Motivo' : 'Motivo da Desconsideração'}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-amber-100/60">
            {notas.map((ign, idx) => (
              <tr key={idx} className="hover:bg-amber-50/50">
                <td className={`${compact ? 'py-2 px-2.5' : 'py-2.5 px-3'} font-semibold text-slate-900`}>
                  NF-e nº {ign.numero_nota}{' '}
                  {ign.serie ? (compact ? `(${ign.serie})` : `(Série ${ign.serie})`) : ''}
                  {compact && (
                    <div className="mt-1.5">
                      <DanfeButton chaveAcesso={ign.chave_acesso} numeroNota={ign.numero_nota} />
                    </div>
                  )}
                </td>
                <td
                  className={`${compact ? 'py-2 px-2.5' : 'py-2.5 px-3 font-semibold'} text-slate-700 font-mono`}
                >
                  {ign.data_emissao || '-'}
                </td>
                <td
                  className={`${compact ? 'py-2 px-2.5 max-w-[150px]' : 'py-2.5 px-3 max-w-[200px]'} text-slate-500 font-mono text-[11px] truncate`}
                  title={ign.arquivo || ''}
                >
                  {ign.arquivo || '-'}
                </td>
                <td className={`${compact ? 'py-2 px-2.5' : 'py-2.5 px-3'} text-amber-900 font-medium`}>
                  {ign.motivo}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

