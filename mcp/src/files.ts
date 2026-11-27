import fs from 'node:fs/promises';
import path from 'node:path';

/** Mesmos limites do site (useFiscalInputFiles). */
export const MAX_XML_FILE_BYTES = 20 * 1024 * 1024;
export const MAX_XML_TOTAL_BYTES = 100 * 1024 * 1024;
export const MAX_SPED_FILE_BYTES = 50 * 1024 * 1024;
export const MAX_SHEET_FILE_BYTES = 20 * 1024 * 1024;
const MAX_WALK_ENTRIES = 20_000;

export type FiscalFileKind = 'xml' | 'zip' | 'sped' | 'planilha' | 'outro';

export class FileAccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FileAccessError';
  }
}

function isInside(child: string, parent: string): boolean {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

/**
 * Restringe leitura e gravação às pastas liberadas na configuração.
 *
 * Os caminhos são resolvidos de verdade (links simbólicos incluídos) antes da
 * comparação: um atalho dentro da pasta liberada não pode levar para fora dela.
 */
export class FolderPolicy {
  private resolvedRoots: string[] | null = null;
  readonly roots: string[];

  constructor(roots: string[]) {
    this.roots = roots;
  }

  private async roots_(): Promise<string[]> {
    if (!this.resolvedRoots) {
      const resolved: string[] = [];
      for (const root of this.roots) {
        try {
          resolved.push(await fs.realpath(root));
        } catch {
          // Pasta configurada que não existe neste computador: ignorada.
        }
      }
      this.resolvedRoots = resolved;
    }
    return this.resolvedRoots;
  }

  describeRoots(): string {
    return this.roots.map((root) => `"${root}"`).join(', ');
  }

  /** Caminho existente e liberado. */
  async resolveExisting(input: string): Promise<string> {
    if (!input || !input.trim()) throw new FileAccessError('Informe um caminho de arquivo ou pasta.');
    const absolute = path.resolve(input.trim());
    let real: string;
    try {
      real = await fs.realpath(absolute);
    } catch {
      throw new FileAccessError(`Caminho não encontrado: ${absolute}`);
    }
    const roots = await this.roots_();
    if (!roots.some((root) => isInside(real, root))) {
      throw new FileAccessError(
        `O caminho ${absolute} está fora das pastas liberadas para o Planaut (${this.describeRoots()}). `
        + 'Inclua a pasta nas configurações da extensão para usá-la.',
      );
    }
    return real;
  }

  /** Pasta de saída liberada; é criada se ainda não existir. */
  async resolveOutputDir(input: string): Promise<string> {
    const absolute = path.resolve(input.trim());
    let existing = absolute;
    const missing: string[] = [];
    while (true) {
      try {
        await fs.access(existing);
        break;
      } catch {
        const parent = path.dirname(existing);
        if (parent === existing) throw new FileAccessError(`Pasta de saída inválida: ${absolute}`);
        missing.unshift(path.basename(existing));
        existing = parent;
      }
    }
    const realBase = await this.resolveExisting(existing);
    const stat = await fs.stat(realBase);
    if (!stat.isDirectory()) throw new FileAccessError(`A saída precisa ser uma pasta: ${realBase}`);
    const target = path.join(realBase, ...missing);
    if (missing.length > 0) await fs.mkdir(target, { recursive: true });
    return target;
  }
}

export function classifyByName(filename: string): FiscalFileKind {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.xml')) return 'xml';
  if (lower.endsWith('.zip')) return 'zip';
  if (lower.endsWith('.txt')) return 'sped';
  if (lower.endsWith('.xlsx') || lower.endsWith('.xls') || lower.endsWith('.csv')) return 'planilha';
  return 'outro';
}

export interface FoundFile {
  path: string;
  name: string;
  size: number;
  modifiedAt: Date;
  kind: FiscalFileKind;
}

async function walk(dir: string, recursive: boolean, found: FoundFile[]): Promise<void> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  for (const entry of entries) {
    if (found.length >= MAX_WALK_ENTRIES) {
      throw new FileAccessError(`A pasta ${dir} tem arquivos demais (limite de ${MAX_WALK_ENTRIES}). Indique uma subpasta.`);
    }
    if (entry.name.startsWith('.') || entry.name.startsWith('~$')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (recursive) await walk(full, recursive, found);
      continue;
    }
    if (!entry.isFile()) continue;
    const stat = await fs.stat(full);
    found.push({ path: full, name: entry.name, size: stat.size, modifiedAt: stat.mtime, kind: classifyByName(entry.name) });
  }
}

/** Expande arquivos e pastas (já liberados) em uma lista de arquivos. */
export async function expandPaths(
  policy: FolderPolicy,
  inputs: string[],
  options: { recursive?: boolean } = {},
): Promise<FoundFile[]> {
  const found: FoundFile[] = [];
  const seen = new Set<string>();
  for (const input of inputs) {
    const real = await policy.resolveExisting(input);
    const stat = await fs.stat(real);
    const batch: FoundFile[] = [];
    if (stat.isDirectory()) {
      await walk(real, options.recursive ?? false, batch);
    } else if (stat.isFile()) {
      batch.push({ path: real, name: path.basename(real), size: stat.size, modifiedAt: stat.mtime, kind: classifyByName(real) });
    }
    for (const file of batch) {
      if (seen.has(file.path)) continue;
      seen.add(file.path);
      found.push(file);
    }
  }
  return found;
}

/** Detecta SPED Fiscal pelo registro de abertura, sem ler o arquivo inteiro. */
export async function looksLikeSped(filePath: string): Promise<boolean> {
  const handle = await fs.open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(16);
    const { bytesRead } = await handle.read(buffer, 0, 16, 0);
    return buffer.subarray(0, bytesRead).toString('latin1').replace(/^﻿|^ï»¿/, '').startsWith('|0000|');
  } finally {
    await handle.close();
  }
}

/** Lê o arquivo como `File` do Web API, que é o que o motor do navegador espera. */
export async function toWebFile(file: FoundFile): Promise<File> {
  const bytes = await fs.readFile(file.path);
  return new File([bytes], file.name, { lastModified: file.modifiedAt.getTime() });
}

/** Grava sem sobrescrever: acrescenta " (2)", " (3)"... se o nome já existir. */
export async function writeUniqueFile(dir: string, filename: string, bytes: ArrayBuffer | Uint8Array): Promise<string> {
  const safeName = filename.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim() || 'planilha.xlsx';
  const ext = path.extname(safeName);
  const stem = safeName.slice(0, safeName.length - ext.length);
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let attempt = 1; attempt < 1000; attempt += 1) {
    const candidate = path.join(dir, attempt === 1 ? safeName : `${stem} (${attempt})${ext}`);
    try {
      await fs.writeFile(candidate, data, { flag: 'wx' });
      return candidate;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') continue;
      throw error;
    }
  }
  throw new FileAccessError(`Não foi possível gravar ${safeName} em ${dir}: nomes esgotados.`);
}

export function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}
