export interface Usuario {
  id: string;
  nome: string;
  email: string;
  cargo: string;
  role: string;
  ativo: boolean;
  criado_em?: string | null;
}

export interface UsuarioCreatePayload {
  nome: string;
  email: string;
  password: string;
  role: 'admin' | 'operador';
}
