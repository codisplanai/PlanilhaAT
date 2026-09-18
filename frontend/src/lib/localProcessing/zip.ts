const ZIP_LOCAL_FILE = 0x04034b50;
const ZIP_CENTRAL_FILE = 0x02014b50;
const ZIP_END = 0x06054b50;

function u16(view: DataView, offset: number): number {
  return view.getUint16(offset, true);
}

function u32(view: DataView, offset: number): number {
  return view.getUint32(offset, true);
}

function setU16(view: DataView, offset: number, value: number): void {
  view.setUint16(offset, value, true);
}

function setU32(view: DataView, offset: number, value: number): void {
  view.setUint32(offset, value >>> 0, true);
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}

async function inflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('Este navegador não oferece descompressão local necessária para ZIP/XLSX.');
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function findEndOfCentralDirectory(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const minOffset = Math.max(0, bytes.byteLength - 65557);
  for (let offset = bytes.byteLength - 22; offset >= minOffset; offset -= 1) {
    if (u32(view, offset) === ZIP_END) return offset;
  }
  throw new Error('Arquivo ZIP inválido: diretório central não encontrado.');
}

export async function readZip(input: ArrayBuffer | Uint8Array): Promise<Map<string, Uint8Array>> {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const endOffset = findEndOfCentralDirectory(bytes);
  const entryCount = u16(view, endOffset + 10);
  const centralOffset = u32(view, endOffset + 16);
  const decoder = new TextDecoder('utf-8');
  const entries = new Map<string, Uint8Array>();

  let cursor = centralOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (u32(view, cursor) !== ZIP_CENTRAL_FILE) {
      throw new Error('Arquivo ZIP inválido: entrada do diretório central corrompida.');
    }

    const flags = u16(view, cursor + 8);
    const method = u16(view, cursor + 10);
    const compressedSize = u32(view, cursor + 20);
    const filenameLength = u16(view, cursor + 28);
    const extraLength = u16(view, cursor + 30);
    const commentLength = u16(view, cursor + 32);
    const localOffset = u32(view, cursor + 42);
    const nameBytes = bytes.subarray(cursor + 46, cursor + 46 + filenameLength);
    const filename = decoder.decode(nameBytes);

    if ((flags & 0x0001) !== 0) {
      throw new Error(`ZIP protegido por senha não é suportado: ${filename}`);
    }

    if (!filename.endsWith('/')) {
      if (u32(view, localOffset) !== ZIP_LOCAL_FILE) {
        throw new Error(`ZIP inválido: cabeçalho local ausente para ${filename}.`);
      }
      const localNameLength = u16(view, localOffset + 26);
      const localExtraLength = u16(view, localOffset + 28);
      const dataStart = localOffset + 30 + localNameLength + localExtraLength;
      const compressed = bytes.subarray(dataStart, dataStart + compressedSize);

      let data: Uint8Array;
      if (method === 0) {
        data = compressed.slice();
      } else if (method === 8) {
        data = await inflateRaw(compressed);
      } else {
        throw new Error(`Método de compressão ZIP não suportado (${method}) em ${filename}.`);
      }
      entries.set(filename, data);
    }

    cursor += 46 + filenameLength + extraLength + commentLength;
  }

  return entries;
}

let crcTable: Uint32Array | null = null;

function getCrcTable(): Uint32Array {
  if (crcTable) return crcTable;
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  crcTable = table;
  return table;
}

function crc32(bytes: Uint8Array): number {
  const table = getCrcTable();
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

interface CentralEntry {
  header: Uint8Array;
  offset: number;
}

export function writeZip(entries: Map<string, Uint8Array>): ArrayBuffer {
  const encoder = new TextEncoder();
  const localParts: Uint8Array[] = [];
  const centralEntries: CentralEntry[] = [];
  let offset = 0;

  for (const [filename, data] of entries.entries()) {
    const name = encoder.encode(filename);
    const checksum = crc32(data);
    const local = new Uint8Array(30 + name.byteLength);
    const localView = new DataView(local.buffer);

    setU32(localView, 0, ZIP_LOCAL_FILE);
    setU16(localView, 4, 20);
    setU16(localView, 6, 0x0800);
    setU16(localView, 8, 0);
    setU16(localView, 10, 0);
    setU16(localView, 12, 0);
    setU32(localView, 14, checksum);
    setU32(localView, 18, data.byteLength);
    setU32(localView, 22, data.byteLength);
    setU16(localView, 26, name.byteLength);
    setU16(localView, 28, 0);
    local.set(name, 30);

    localParts.push(local, data);

    const central = new Uint8Array(46 + name.byteLength);
    const centralView = new DataView(central.buffer);
    setU32(centralView, 0, ZIP_CENTRAL_FILE);
    setU16(centralView, 4, 20);
    setU16(centralView, 6, 20);
    setU16(centralView, 8, 0x0800);
    setU16(centralView, 10, 0);
    setU16(centralView, 12, 0);
    setU16(centralView, 14, 0);
    setU32(centralView, 16, checksum);
    setU32(centralView, 20, data.byteLength);
    setU32(centralView, 24, data.byteLength);
    setU16(centralView, 28, name.byteLength);
    setU16(centralView, 30, 0);
    setU16(centralView, 32, 0);
    setU16(centralView, 34, 0);
    setU16(centralView, 36, 0);
    setU32(centralView, 38, 0);
    setU32(centralView, 42, offset);
    central.set(name, 46);

    centralEntries.push({ header: central, offset });
    offset += local.byteLength + data.byteLength;
  }

  const centralParts = centralEntries.map((entry) => entry.header);
  const centralSize = centralParts.reduce((sum, part) => sum + part.byteLength, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  setU32(endView, 0, ZIP_END);
  setU16(endView, 4, 0);
  setU16(endView, 6, 0);
  setU16(endView, 8, centralEntries.length);
  setU16(endView, 10, centralEntries.length);
  setU32(endView, 12, centralSize);
  setU32(endView, 16, offset);
  setU16(endView, 20, 0);

  return concat([...localParts, ...centralParts, end]).buffer;
}
