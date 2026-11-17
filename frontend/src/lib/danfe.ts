import { getErrorMessage } from '../api/client';
import { readZip } from './localProcessing/zip';

function decodeXml(bytes: ArrayBuffer | Uint8Array): string {
  const buffer = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const declaration = new TextDecoder('ascii').decode(buffer.subarray(0, 150));
  const encoding = declaration.match(/encoding=["']([^"']+)["']/i)?.[1]?.toLowerCase();
  const decoder = encoding && /^(iso-8859-1|latin1|windows-1252)$/.test(encoding)
    ? new TextDecoder('windows-1252') : new TextDecoder('utf-8');
  const xml = decoder.decode(buffer);
  // Ao enviar texto JSON, os bytes serão codificados em UTF-8 no servidor.
  return xml.replace(/(<\?xml[^>]*encoding=["'])[^"']+(["'][^>]*\?>)/i, '$1UTF-8$2');
}

function matchesAccessKey(xml: string, chave: string): boolean {
  if (!xml.includes(chave)) return false;
  const document = new DOMParser().parseFromString(xml, 'application/xml');
  if (document.querySelector('parsererror')) return false;
  const nfe = Array.from(document.querySelectorAll('*'))
    .find((node) => node.localName === 'infNFe');
  return nfe?.getAttribute('Id') === 'NFe' + chave;
}

/** Procura o XML local correto sem remeter outros XMLs ao servidor. */
export async function findXmlForDanfe(chave: string, files: File[]): Promise<string | null> {
  for (const file of files) {
    if (file.name.toLowerCase().endsWith('.xml')) {
      const xml = decodeXml(await file.arrayBuffer());
      if (matchesAccessKey(xml, chave)) return xml;
      continue;
    }
    if (!file.name.toLowerCase().endsWith('.zip')) continue;
    const entries = await readZip(await file.arrayBuffer());
    for (const [name, bytes] of entries) {
      if (!name.toLowerCase().endsWith('.xml')) continue;
      const xml = decodeXml(bytes);
      if (matchesAccessKey(xml, chave)) return xml;
    }
  }
  return null;
}

export async function pdfErrorMessage(error: unknown): Promise<string> {
  // Axios recebe erros JSON como Blob quando responseType='blob'.
  const response = error && typeof error === 'object'
    ? (error as { response?: { data?: unknown } }).response : undefined;
  if (response?.data instanceof Blob && response.data.type.includes('json')) {
    try {
      const detail = await response.data.text();
      const parsed: unknown = JSON.parse(detail);
      if (parsed && typeof parsed === 'object' && 'detail' in parsed) {
        const message = (parsed as { detail?: unknown }).detail;
        if (typeof message === 'string') return message;
      }
    } catch { /* Retorna mensagem padrão abaixo. */ }
  }
  return getErrorMessage(error);
}

