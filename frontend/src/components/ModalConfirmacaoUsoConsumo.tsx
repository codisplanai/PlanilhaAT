import { useState } from 'react';
import { Modal } from './ui/Modal';
import { Button } from './ui/Button';
import { DanfeButton } from './DanfeButton';
import { formatCNPJ, formatCurrency } from '../lib/formatters';
import type { UsoConsumoPending } from '../types/localProcessing';

interface Props {
  notas: UsoConsumoPending[];
  xmlFiles?: File[];
  onClose: () => void;
  onConfirm: (decisions: Record<string, boolean>) => void;
  isProcessing: boolean;
}

export function ModalConfirmacaoUsoConsumo({ notas, xmlFiles, onClose, onConfirm, isProcessing }: Props) {
  const [decisions, setDecisions] = useState<Record<string, boolean>>({});
  const complete = notas.every(note => typeof decisions[note.key] === 'boolean');
  return <Modal isOpen onClose={onClose} maxWidth="2xl" title="Confirmar uso e consumo"
    subtitle="Decida a destinação de cada nota. Confirmar encaminha todos os itens para DIFAL; manter regras originais retoma a classificação fiscal normal.">
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="outline" disabled={isProcessing}
          onClick={() => setDecisions(Object.fromEntries(notas.map(note => [note.key, true])))}>Confirmar todas</Button>
        <Button type="button" size="sm" variant="outline" disabled={isProcessing}
          onClick={() => setDecisions(Object.fromEntries(notas.map(note => [note.key, false])))}>Manter todas originais</Button>
      </div>
      {notas.map(note => <div key={note.key} className="rounded-xl border border-slate-200 p-4 space-y-3">
        <div className="flex flex-wrap justify-between gap-2">
          <div><p className="font-semibold text-sm">{note.fornecedor || 'Fornecedor'} · NF-e {note.numeroNota}/{note.serie}</p>
            <p className="text-xs text-slate-500">{formatCNPJ(note.cnpj)} · {note.quantidadeItens} itens · {formatCurrency(note.valorTotal)}</p></div>
          <DanfeButton chaveAcesso={note.chaveAcesso} numeroNota={note.numeroNota} xmlFiles={xmlFiles} />
        </div>
        <p className="break-all font-mono text-xs text-slate-600">{note.chaveAcesso}</p>
        <fieldset className="flex flex-col sm:flex-row gap-3" disabled={isProcessing}>
          <legend className="sr-only">Destinação da NF-e {note.numeroNota}</legend>
          <label className="flex items-center gap-2 text-sm"><input type="radio" name={note.key} checked={decisions[note.key] === true}
            onChange={() => setDecisions(prev => ({ ...prev, [note.key]: true }))} /> Confirmar DIFAL</label>
          <label className="flex items-center gap-2 text-sm"><input type="radio" name={note.key} checked={decisions[note.key] === false}
            onChange={() => setDecisions(prev => ({ ...prev, [note.key]: false }))} /> Manter regras originais</label>
        </fieldset>
      </div>)}
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="outline" disabled={isProcessing} onClick={onClose}>Cancelar processamento</Button>
        <Button type="button" disabled={!complete || isProcessing} isLoading={isProcessing} onClick={() => onConfirm(decisions)}>Continuar processamento</Button>
      </div>
    </div>
  </Modal>;
}
