import { useCallback, useEffect, useRef } from 'react';

/**
 * Agenda um callback garantindo que o timer seja cancelado ao desmontar e que
 * um novo agendamento substitua o anterior.
 *
 * Os avisos temporários de "salvo" usavam ``setTimeout`` solto: ao sair da tela
 * antes do prazo, o timer continuava vivo e disparava uma atualização de estado
 * em um componente que já não existia.
 */
export function useManagedTimeout() {
  const timerRef = useRef<number | null>(null);

  const clear = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const schedule = useCallback(
    (callback: () => void, delayMs: number) => {
      clear();
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        callback();
      }, delayMs);
    },
    [clear],
  );

  useEffect(() => clear, [clear]);

  return { schedule, clear };
}
