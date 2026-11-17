import type { Empresa } from '../types/empresa';

export function matchesEmpresaSearch(empresa: Empresa, term: string): boolean {
  const normalized = term.toLowerCase();
  const digits = normalized.replace(/\D/g, '');
  return (
    empresa.razao_social.toLowerCase().includes(normalized)
    || (digits.length > 0 && empresa.cnpj.includes(digits))
    || empresa.uf.toLowerCase().includes(normalized)
  );
}

