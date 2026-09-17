export interface DatePeriod {
  start: string;
  end: string;
}

export function getMonthPeriod(monthOffset = 0, today = new Date()): DatePeriod {
  const year = today.getFullYear();
  const month = today.getMonth() + monthOffset;
  return {
    start: new Date(year, month, 1).toISOString().split('T')[0],
    end: new Date(year, month + 1, 0).toISOString().split('T')[0],
  };
}
