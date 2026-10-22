import React, { useEffect, useState } from 'react';
import { Download, ExternalLink, FileText } from 'lucide-react';

import { apiClient, getErrorMessage } from '../api/client';
import { readZip } from '../lib/localProcessing/zip';
import { Button } from './ui/Button';
import { Modal } from './ui/Modal';

interface DanfeButtonProps {
  chaveAcesso?: string | null;
  xmlFiles?: File[];
  numeroNota?: string;
  className?: string;
}

// Apenas durante a sessão em memória. Não persiste PDFs/chaves no navegador.
const pdfCache = new Map<string, Blob>();
const MAX_CACHED_PDFS = 5;

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

async function pdfErrorMessage(error: unknown): Promise<string> {
  // Axios recebe erros JSON como Blob quando responseType='blob'.
  const response = error && typeof error === 'object'
    ? (error as { response?: { data?: unknown } }).response : undefined;
  if (response?.data instanceof Blob && response.data.type.includes('json')) {
    try {
      const detail = (await response.data.text());
      const parsed: unknown = JSON.parse(detail);
      if (parsed && typeof parsed === 'object' && 'detail' in parsed) {
        const message = (parsed as { detail?: unknown }).detail;
        if (typeof message === 'string') return message;
      }
    } catch { /* Retorna mensagem padrão abaixo. */ }
  }
  return getErrorMessage(error);
}

export const DanfeButton: React.FC<DanfeButtonProps> = ({
  chaveAcesso, xmlFiles = [], numeroNota, className,
}) => {
  const chave = (chaveAcesso ?? '').replace(/\D/g, '');
  const valid = chave.length === 44;
  const [loading, setLoading] = useState(false);
  const [needsPaidLookup, setNeedsPaidLookup] = useState(false);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<'xml' | 'chave' | null>(null);

  useEffect(() => {
    return () => {
      if (pdfUrl) URL.revokeObjectURL(pdfUrl);
    };
  }, [pdfUrl]);

  const visualizar = async (autorizarBusca = false) => {
    if (!valid || loading) return;
    setLoading(true);
    setError(null);
    setNeedsPaidLookup(false);
    let consultedWithXml = false;
    try {
      let pdf = pdfCache.get(chave);
      if (!pdf) {
        const xml = await findXmlForDanfe(chave, xmlFiles);
        consultedWithXml = Boolean(xml);
        setSource(xml ? 'xml' : 'chave');
        const { data } = await apiClient.post<Blob>(
          '/danfe/pdf',
          { chave_acesso: chave, xml, buscar_por_chave: !xml && autorizarBusca },
          { responseType: 'blob', timeout: 60_000 },
        );
        if (!(data instanceof Blob) || !data.type.includes('pdf')) {
          throw new Error('O serviço não retornou um PDF válido.');
        }
        pdf = data;
        if (pdfCache.size >= MAX_CACHED_PDFS) {
          pdfCache.delete(pdfCache.keys().next().value!);
        }
        pdfCache.set(chave, pdf);
      }
      setPdfUrl(URL.createObjectURL(pdf));
    } catch (cause) {
      const status = cause && typeof cause === 'object'
        ? (cause as { response?: { status?: number } }).response?.status : undefined;
      if (status === 404 && !autorizarBusca && !consultedWithXml) {
        // Consulta por chave ainda ausente só é enviada após confirmação do custo.
        setNeedsPaidLookup(true);
      } else {
        setError(await pdfErrorMessage(cause));
      }
    } finally {
      setLoading(false);
    }
  };

  if (!valid) return null;

  return (
    <>
      <div className={className ?? ''}>
        <Button
          type="button"
          variant="outline"
          onClick={() => void visualizar(false)}
          isLoading={loading}
          leftIcon={<FileText className="h-4 w-4" />}
          className="w-full sm:w-auto"
        >
          Visualizar DANFE
        </Button>
        {needsPaidLookup && (
          <div className="mt-2 space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
            <p>O DANFE ainda não consta no Meu DANFE. A busca por chave pode custar R$ 0,03 e envia a chave ao fornecedor.</p>
            <Button type="button" variant="outline" onClick={() => void visualizar(true)} isLoading={loading}>
              Autorizar busca pela chave
            </Button>
          </div>
        )}
        {error && (
          <p role="alert" className="mt-1.5 text-xs leading-relaxed text-red-700">{error}</p>
        )}
      </div>

      <Modal
        isOpen={pdfUrl !== null}
        onClose={() => setPdfUrl(null)}
        title={'DANFE · NF-e ' + (numeroNota || chave.slice(25, 34))}
        subtitle="Consulta auxiliar para conferir a nota. A decisão fiscal continua sendo do usuário."
        maxWidth="6xl"
      >
        {pdfUrl && (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2 text-xs text-slate-600">
              <span className="rounded-lg bg-slate-100 px-2.5 py-1.5 font-medium">
                {source === 'xml' ? 'Gerado do XML enviado' : 'Documento consultado no Meu DANFE'}
              </span>
              <span>O PDF é aberto somente após sua solicitação.</span>
            </div>
            <iframe
              src={pdfUrl}
              title={'DANFE da NF-e ' + (numeroNota || chave)}
              className="h-[56dvh] min-h-[280px] w-full rounded-xl border border-slate-200 bg-slate-50"
            />
            <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
              <a
                href={pdfUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                <ExternalLink className="h-4 w-4" /> Abrir em outra aba
              </a>
              <a
                href={pdfUrl}
                download={'danfe-' + chave + '.pdf'}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-700 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-800"
              >
                <Download className="h-4 w-4" /> Baixar PDF
              </a>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
};
