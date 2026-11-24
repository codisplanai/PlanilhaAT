import type { ExtractedNote } from './domain';
import type { LocalProcessingContext } from '../../types/localProcessing';

type Company = LocalProcessingContext['empresa'];
const digits = (value: string | null | undefined) => (value ?? '').replace(/\D/g, '');

export function usageDecisionKey(note: ExtractedNote): string {
  const key = digits(note.chaveAcesso);
  return key.length === 44 ? key : [digits(note.cnpjEmitente), note.serie, note.numeroNota, note.dataEmissao.slice(0, 10)].join(':');
}

export function supplierUsageRule(note: ExtractedNote, company: Company) {
  const supplier = digits(note.cnpjEmitente);
  const client = digits(company.cnpj);
  const uf = note.ufEmitente?.trim().toUpperCase();
  const clientUf = company.uf?.trim().toUpperCase();
  if (supplier.length !== 14 || supplier === client || digits(note.cnpjDestinatario) !== client
    || note.rawMetadata.ind_emit === '0' || !uf || !clientUf || uf === clientUf) return undefined;
  return company.fornecedores_uso_consumo?.find(item => digits(item.cnpj) === supplier);
}

export function supplierUsageMode(note: ExtractedNote, company: Company, decisions?: Record<string, boolean>) {
  const rule = supplierUsageRule(note, company);
  if (rule?.modo === 'automatico') return 'automatico';
  if (rule?.modo === 'confirmacao' && decisions?.[usageDecisionKey(note)] === true) return 'confirmado';
  return null;
}
