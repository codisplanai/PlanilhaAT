import type { UserRole } from './auth';

export interface Usuario {
  id: string;
  nome: string;
  email: string;
  cargo: string;
  role: UserRole;
  ativo: boolean;
  criado_em?: string | null;
}

export interface UsuarioCreatePayload {
  nome: string;
  email: string;
  password: string;
  role: UserRole;
}
