export interface DatePeriod {
  start: string;
  end: string;
}

/**
 * Formata uma data pelos componentes locais.
 *
 * ``toISOString()`` converte para UTC antes de recortar o dia: a meia-noite
 * local do primeiro dia do mês cai no dia anterior em qualquer fuso a leste de
 * Greenwich, e o período de competência sugerido vinha deslocado em um dia.
 */
function toIsoDate(date: Date): string {
  const year = String(date.getFullYear()).padStart(4, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function getMonthPeriod(monthOffset = 0, today = new Date()): DatePeriod {
  const year = today.getFullYear();
  const month = today.getMonth() + monthOffset;
  return {
    start: toIsoDate(new Date(year, month, 1)),
    // Dia 0 do mês seguinte é o último dia do mês corrente.
    end: toIsoDate(new Date(year, month + 1, 0)),
  };
}
