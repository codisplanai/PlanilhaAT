import React, { useState } from 'react';
import { Modal } from './ui/Modal';
import { Button } from './ui/Button';
import { DanfeButton } from './DanfeButton';
import { validMvaDecision } from '../lib/localProcessing/mvaReview';
import type { MvaDecision, MvaPending } from '../types/localProcessing';
interface Props {
  pendencias: MvaPending[];
  xmlFiles: File[];
  onClose: () => void;
  onConfirm: (decisions: Record<string,MvaDecision>) => void;
  isProcessing: boolean;
}
type Draft = { value: string; reason: string; defer: boolean };
const empty: Draft = {value:'',reason:'',defer:false};
function decision(d: Draft): MvaDecision | undefined {
  if (!d.defer && !d.value.trim()) return undefined;
  return {mva:d.defer ? null : Number(d.value.replace(',','.')),justificativa:d.reason.trim()};
}
const rate=(v:number)=> (v<=1?v*100:v).toLocaleString('pt-BR',{maximumFractionDigits:4})+'%';
export const ModalPendenciaMva: React.FC<Props> = ({pendencias,xmlFiles,onClose,onConfirm,isProcessing})=>{
  const [drafts,setDrafts]=useState<Record<string,Draft>>({});
  const update=(key:string,patch:Partial<Draft>)=>setDrafts(prev=>({...prev,[key]:{...(prev[key]??empty),...patch}}));
  const ready=pendencias.filter(p=>validMvaDecision(decision(drafts[p.key]??empty))).length;
  return <Modal isOpen onClose={()=>{if(!isProcessing)onClose();}} title="Revisar MVA pendente"
    subtitle="Confirme os percentuais ou mantenha a pendência expressamente. A mesma solicitação será retomada." maxWidth="4xl">
    <div className="space-y-4">
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
        {ready} de {pendencias.length} itens revisados. O XML é evidência, não autorização automática.
        Confira a legislação, o regime e as condições. Se a base aplicável for PMPF ou preço sugerido, mantenha pendente em vez de inventar uma MVA.
      </div>
      <div className="max-h-[55dvh] overflow-y-auto space-y-3">
      {pendencias.map(p=>{
        const d=drafts[p.key]??empty;
        return <section key={p.key} className="rounded-xl border border-slate-200 p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-semibold">NF-e {p.numeroNota} · item {p.itemNumero}</p>
            <DanfeButton chaveAcesso={p.chaveAcesso} numeroNota={p.numeroNota} xmlFiles={xmlFiles}/>
          </div>
          <p className="text-xs break-all text-slate-500">{p.chaveAcesso}</p>
          <p className="text-sm">{p.descricao}</p>
          <p className="text-xs text-slate-600">NCM {p.ncm} · CEST {p.cest||'ausente'} · CFOP {p.cfop} · origem {rate(p.aOri)} · destino {rate(p.aDst)} · MVA {p.column??'indefinida'}</p>
          <p className="text-sm text-amber-800">{p.motivo}</p>
          <div className="flex flex-wrap gap-2">
            {p.mvaXml!==null && <Button type="button" variant="outline" disabled={isProcessing} onClick={()=>update(p.key,{value:String(p.mvaXml),defer:false})}>XML: {p.mvaXml}%</Button>}
            {p.suggestions.map(s=><Button key={s.label} type="button" variant="outline" disabled={isProcessing} onClick={()=>update(p.key,{value:String(s.value),defer:false})}>{s.label}: {s.value}%</Button>)}
          </div>
          <label className="block text-sm font-medium">MVA em percentual
            <input className="mt-1 w-full rounded-lg border border-slate-300 p-2" inputMode="decimal" placeholder="Ex.: 90,15" value={d.value} disabled={d.defer||isProcessing} onChange={e=>update(p.key,{value:e.target.value})}/>
          </label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={d.defer} disabled={isProcessing} onChange={e=>update(p.key,{defer:e.target.checked})}/> Manter pendente (item ficará fora da apuração)</label>
          <label className="block text-sm font-medium">Justificativa fiscal obrigatória
            <textarea className="mt-1 w-full rounded-lg border border-slate-300 p-2" maxLength={500} rows={2} disabled={isProcessing} value={d.reason} onChange={e=>update(p.key,{reason:e.target.value})}/>
          </label>
        </section>;
      })}
      </div>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" disabled={isProcessing} onClick={onClose}>Cancelar apuração</Button>
        <Button type="button" isLoading={isProcessing} disabled={ready!==pendencias.length||isProcessing} onClick={()=>{
          const result: Record<string,MvaDecision>={};
          for(const p of pendencias){const d=decision(drafts[p.key]??empty);if(!validMvaDecision(d))return;result[p.key]=d;}
          onConfirm(result);
        }}>Confirmar e reprocessar</Button>
      </div>
    </div>
  </Modal>;
};
