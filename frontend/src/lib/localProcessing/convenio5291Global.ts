import type { Convenio5291Config } from '../../types/perfil';

/**
 * Política global da Antecipação Parcial — Convênio ICMS 52/91 (Anexos I/II).
 *
 * Vale para todos os perfis, inclusive os criados antes da implementação e
 * aqueles sem configuração persistida. Não altera o cadastro no banco nem
 * remove regras de inclusão/exclusão específicas do perfil.
 *
 * Ligar globalmente NÃO significa aprovar NCMs automaticamente: somente as
 * correspondências legais seguras podem ser aplicadas sem intervenção; casos
 * técnicos e ambíguos continuam exigindo confirmação explícita do usuário.
 */
export const CONVENIO_5291_GLOBAL_DEFAULTS: Convenio5291Config = {
  enabled: true,
  aplicar_automaticamente_seguros: true,
  solicitar_confirmacao_duvidosos: true,
  considerar_cst20_como_indicio: true,
  ajustes: [],
};

export function effectiveConvenio5291PartialConfig(
  persisted: Convenio5291Config | undefined,
): Convenio5291Config {
  return {
    ...CONVENIO_5291_GLOBAL_DEFAULTS,
    ...(persisted ?? {}),
    enabled: true,
    // A configuração global nunca pode desabilitar a revisão de casos incertos.
    solicitar_confirmacao_duvidosos: true,
    // Somente os itens classificados explicitamente como seguros são automáticos.
    aplicar_automaticamente_seguros: true,
    ajustes: persisted?.ajustes ?? [],
  };
}
