export function formatCurrency(value: number | string | null | undefined): string {
  if (value === null || value === undefined || isNaN(Number(value))) return 'R$ 0,00';
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(Number(value));
}

export function formatPercent(value: number | string | null | undefined, isDecimal = true): string {
  if (value === null || value === undefined || isNaN(Number(value))) return '0,00%';
  const num = Number(value);
  const percentValue = isDecimal && Math.abs(num) <= 1 ? num * 100 : num;
  return `${percentValue.toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}%`;
}

export function formatDate(dateString: string | null | undefined): string {
  if (!dateString) return '-';

  try {
    const cleanDate = dateString.split('T')[0];
    const [year, month, day] = cleanDate.split('-');
    if (year && month && day) {
      const parsed = new Date(`${year}-${month}-${day}T00:00:00`);
      if (!Number.isNaN(parsed.getTime())) return `${day}/${month}/${year}`;
    }
    const parsed = new Date(dateString);
    return Number.isNaN(parsed.getTime()) ? '-' : parsed.toLocaleDateString('pt-BR');
  } catch {
    return dateString;
  }
}

export function formatCNPJ(cnpj: string | null | undefined): string {
  if (!cnpj) return '-';
  const clean = cnpj.replace(/\D/g, '');
  if (clean.length !== 14) return cnpj;
  return clean.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
}

export function maskCNPJ(value: string | null | undefined): string {
  if (!value) return '';
  const clean = value.replace(/\D/g, '').slice(0, 14);
  if (clean.length <= 2) return clean;
  if (clean.length <= 5) return clean.replace(/^(\d{2})(\d+)/, '$1.$2');
  if (clean.length <= 8) return clean.replace(/^(\d{2})(\d{3})(\d+)/, '$1.$2.$3');
  if (clean.length <= 12) return clean.replace(/^(\d{2})(\d{3})(\d{3})(\d+)/, '$1.$2.$3/$4');
  return clean.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d+)/, '$1.$2.$3/$4-$5');
}

export function formatCompetencia(periodoInicio: string): string {
  if (!periodoInicio) return '-';

  try {
    const cleanDate = periodoInicio.split('T')[0];
    const [year, month] = cleanDate.split('-');
    if (!/^\d{4}$/.test(year || '') || !/^(0[1-9]|1[0-2])$/.test(month || '')) return '-';
    return `${month}/${year}`;
  } catch {
    return periodoInicio;
  }
}
