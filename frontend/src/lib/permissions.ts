import type { User } from '../types/auth';

/**
 * Determina se o usuário possui privilégios de Administrador ou Contador Sênior.
 * Usuários com esses privilégios têm visão global sobre o histórico de apurações e planilhas.
 */
export function isAdminOrSenior(user?: User | null): boolean {
  if (!user) return false;
  const role = (user.role ?? '').toLowerCase().trim();
  const cargo = (user.cargo ?? '').toLowerCase().trim();
  return (
    role === 'admin'
    || role === 'senior'
    || cargo.includes('contador sênior')
    || cargo.includes('contador senior')
  );
}
