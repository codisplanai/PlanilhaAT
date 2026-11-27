import os from 'node:os';
import path from 'node:path';

export const DEFAULT_PLANAUT_URL = 'https://planaut.codisplan.com.br';

export interface PlanautMcpConfig {
  /** Endereço do Planaut (frontend e API no mesmo domínio). */
  baseUrl: string;
  email: string | null;
  senha: string | null;
  /** Pastas onde o servidor pode ler arquivos fiscais e gravar planilhas. */
  pastasPermitidas: string[];
  /** Pasta padrão das planilhas geradas; sem ela, usa a pasta dos XMLs. */
  pastaSaidaPadrao: string | null;
}

function cleanList(values: Array<string | undefined>): string[] {
  const result: string[] = [];
  for (const raw of values) {
    // Só ";" e quebra de linha: ":" conflitaria com a letra de unidade do Windows.
    for (const part of String(raw ?? '').split(/[\r\n;]+/)) {
      const clean = part.trim().replace(/^["']|["']$/g, '');
      if (clean && !result.includes(clean)) result.push(clean);
    }
  }
  return result;
}

function expandHome(value: string): string {
  if (value === '~') return os.homedir();
  if (value.startsWith('~/') || value.startsWith('~\\')) return path.join(os.homedir(), value.slice(2));
  return value;
}

function emptyToNull(value: string | undefined): string | null {
  const clean = (value ?? '').trim();
  // Extensões do Claude Desktop substituem campos opcionais vazios pela própria
  // expressão quando o usuário não preenche nada.
  if (!clean || /^\$\{user_config\.[^}]+\}$/.test(clean)) return null;
  return clean;
}

/**
 * Lê a configuração do ambiente e dos argumentos.
 *
 * Pastas permitidas podem vir como argumentos posicionais (é assim que a
 * extensão do Claude Desktop entrega um campo de diretórios múltiplos) ou na
 * variável PLANAUT_PASTAS, separadas por ";" ou quebra de linha. Sem nenhuma,
 * a pasta pessoal do usuário é usada.
 */
export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
  argv: string[] = process.argv.slice(2),
): PlanautMcpConfig {
  const positional = argv.filter((arg) => !arg.startsWith('--'));
  const folders = cleanList([...positional, env.PLANAUT_PASTAS])
    .map((folder) => emptyToNull(folder))
    .filter((folder): folder is string => Boolean(folder))
    .map((folder) => path.resolve(expandHome(folder)));

  const baseUrl = (emptyToNull(env.PLANAUT_URL) ?? DEFAULT_PLANAUT_URL).replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(baseUrl)) {
    throw new Error(`PLANAUT_URL inválida: "${baseUrl}". Use o endereço completo, por exemplo ${DEFAULT_PLANAUT_URL}.`);
  }
  const isLocalHttp = /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(baseUrl);
  if (baseUrl.toLowerCase().startsWith('http://') && !isLocalHttp) {
    throw new Error('PLANAUT_URL precisa usar https (http só é aceito para localhost).');
  }

  const saida = emptyToNull(env.PLANAUT_PASTA_SAIDA);
  return {
    baseUrl,
    email: emptyToNull(env.PLANAUT_EMAIL),
    senha: emptyToNull(env.PLANAUT_SENHA),
    pastasPermitidas: folders.length > 0 ? folders : [os.homedir()],
    pastaSaidaPadrao: saida ? path.resolve(expandHome(saida)) : null,
  };
}
