export type UserRole = 'admin' | 'operador';

export interface User {
  id: string | number;
  nome: string;
  email: string;
  cargo: string;
  role?: UserRole;
}

export interface LoginResponse {
  access_token: string;
  token_type: string;
  user: User;
}

export interface LoginCredentials {
  email: string;
  password: string;
}

export interface AlterarSenhaPayload {
  senha_atual: string;
  nova_senha: string;
}
