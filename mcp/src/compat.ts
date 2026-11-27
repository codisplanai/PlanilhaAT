/**
 * APIs do navegador que o motor fiscal usa e que podem faltar no Node do
 * cliente MCP (o Claude Desktop traz um Node próprio, de versão não fixada).
 */
import { Duplex } from 'node:stream';
import zlib from 'node:zlib';

import { installNodeDom } from './dom.ts';

type Format = 'deflate' | 'deflate-raw' | 'gzip';

function supportsDeflateRaw(): boolean {
  try {
    const Native = (globalThis as { DecompressionStream?: new (format: string) => unknown }).DecompressionStream;
    if (!Native) return false;
    new Native('deflate-raw');
    return true;
  } catch {
    return false;
  }
}

/** `DecompressionStream('deflate-raw')` (usado para ler ZIP e XLSX) sobre o zlib do Node. */
export function installDecompressionFallback(force = false): void {
  if (!force && supportsDeflateRaw()) return;
  class NodeDecompressionStream {
    readonly readable: ReadableStream<Uint8Array>;
    readonly writable: WritableStream<Uint8Array>;

    constructor(format: Format) {
      const inflater = format === 'deflate-raw'
        ? zlib.createInflateRaw()
        : format === 'deflate'
          ? zlib.createInflate()
          : format === 'gzip'
            ? zlib.createGunzip()
            : null;
      if (!inflater) throw new TypeError(`Formato de descompressão não suportado: ${String(format)}`);
      const web = Duplex.toWeb(inflater);
      this.readable = web.readable as unknown as ReadableStream<Uint8Array>;
      this.writable = web.writable as unknown as WritableStream<Uint8Array>;
    }
  }
  (globalThis as Record<string, unknown>).DecompressionStream = NodeDecompressionStream;
}

export function installNodeCompat(): void {
  installNodeDom();
  installDecompressionFallback();
}
