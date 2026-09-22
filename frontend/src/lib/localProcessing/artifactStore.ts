import type { LocalGeneratedArtifact } from '../../types/localProcessing';
import type { TipoPlanilha } from '../../types/solicitacao';
import { writeZip } from './zip';

const DB_NAME = 'planaut-local-artifacts';
const DB_VERSION = 1;
const STORE_NAME = 'outputs';

/**
 * Teto de retenção local. Sem ele, cada apuração acrescentava planilhas ao
 * IndexedDB para sempre até a cota do navegador estourar, e a partir daí
 * nenhuma nova planilha ficava disponível para download.
 */
const MAX_STORED_REQUESTS = 40;

interface StoredArtifact {
  key: string;
  requestId: string;
  tipo: TipoPlanilha;
  filename: string;
  mimeType: string;
  bytes: ArrayBuffer;
  createdAt: string;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (error) {
      // Navegação privada e políticas de armazenamento podem lançar de imediato.
      reject(
        error instanceof Error
          ? error
          : new Error('Armazenamento local indisponível neste navegador.'),
      );
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'key' });
        store.createIndex('requestId', 'requestId', { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Não foi possível abrir o armazenamento local.'));
    request.onblocked = () => reject(
      new Error('O armazenamento local está em uso por outra aba. Feche as demais abas do PlanAut e tente novamente.'),
    );
  });
}

function requestKey(requestId: string, tipo: TipoPlanilha): string {
  return `${requestId}:${tipo}`;
}

function toError(reason: unknown, fallback: string): Error {
  return reason instanceof Error ? reason : new Error(fallback);
}

/**
 * Executa uma leitura garantindo que a conexão sempre feche e que a promessa
 * sempre se resolva ou rejeite — inclusive quando a transação aborta ou quando
 * o handler lança de forma síncrona. Sem essas garantias, um erro de cota
 * deixava conexões abertas e chamadas presas para sempre.
 */
async function runReadTransaction<T>(
  handler: (store: IDBObjectStore, resolve: (value: T) => void, reject: (reason?: unknown) => void) => void,
  fallbackError: string,
): Promise<T> {
  const db = await openDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      let settled = false;
      const done = (value: T) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };
      const fail = (reason?: unknown) => {
        if (settled) return;
        settled = true;
        reject(toError(reason, fallbackError));
      };

      let tx: IDBTransaction;
      try {
        tx = db.transaction(STORE_NAME, 'readonly');
      } catch (error) {
        fail(error);
        return;
      }

      tx.onabort = () => fail(tx.error);
      tx.onerror = () => fail(tx.error);
      // Uma transação que completa sem que o handler tenha resolvido significa
      // que o resultado se perdeu: rejeitar é melhor que travar a chamada.
      tx.oncomplete = () => fail(new Error(fallbackError));

      try {
        handler(tx.objectStore(STORE_NAME), done, fail);
      } catch (error) {
        try {
          tx.abort();
        } catch {
          // A transação pode já ter sido encerrada pelo próprio erro.
        }
        fail(error);
      }
    });
  } finally {
    db.close();
  }
}

/** Variante para escritas, em que o resultado só vale após ``oncomplete``. */
async function runWriteTransaction(
  handler: (store: IDBObjectStore) => void,
  fallbackError: string,
): Promise<void> {
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      const fail = (reason?: unknown) => {
        if (settled) return;
        settled = true;
        reject(toError(reason, fallbackError));
      };

      let tx: IDBTransaction;
      try {
        tx = db.transaction(STORE_NAME, 'readwrite');
      } catch (error) {
        fail(error);
        return;
      }

      tx.oncomplete = done;
      tx.onabort = () => fail(tx.error);
      tx.onerror = () => fail(tx.error);

      try {
        handler(tx.objectStore(STORE_NAME));
      } catch (error) {
        try {
          tx.abort();
        } catch {
          // A transação pode já ter sido encerrada pelo próprio erro.
        }
        fail(error);
      }
    });
  } finally {
    db.close();
  }
}

async function listAllArtifacts(): Promise<StoredArtifact[]> {
  return runReadTransaction<StoredArtifact[]>(
    (store, resolve, reject) => {
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result as StoredArtifact[]);
      request.onerror = () => reject(request.error);
    },
    'Não foi possível consultar as planilhas armazenadas nesta sessão.',
  );
}

/** Descarta as apurações mais antigas quando o histórico local cresce demais. */
async function pruneOldRequests(keepRequestId: string): Promise<void> {
  const artifacts = await listAllArtifacts();
  const newestByRequest = new Map<string, string>();
  for (const artifact of artifacts) {
    const current = newestByRequest.get(artifact.requestId);
    if (!current || artifact.createdAt > current) {
      newestByRequest.set(artifact.requestId, artifact.createdAt);
    }
  }
  if (newestByRequest.size <= MAX_STORED_REQUESTS) return;

  const expired = new Set(
    [...newestByRequest.entries()]
      .filter(([requestId]) => requestId !== keepRequestId)
      .sort((a, b) => a[1].localeCompare(b[1]))
      .slice(0, newestByRequest.size - MAX_STORED_REQUESTS)
      .map(([requestId]) => requestId),
  );
  if (expired.size === 0) return;

  const staleKeys = artifacts
    .filter((artifact) => expired.has(artifact.requestId))
    .map((artifact) => artifact.key);
  await runWriteTransaction(
    (store) => {
      for (const key of staleKeys) store.delete(key);
    },
    'Não foi possível liberar espaço no armazenamento local.',
  );
}

export async function saveLocalArtifacts(
  requestId: string,
  artifacts: LocalGeneratedArtifact[],
): Promise<void> {
  if (artifacts.length === 0) return;
  const createdAt = new Date().toISOString();
  await runWriteTransaction(
    (store) => {
      for (const artifact of artifacts) {
        const record: StoredArtifact = {
          key: requestKey(requestId, artifact.tipo),
          requestId,
          tipo: artifact.tipo,
          filename: artifact.filename,
          mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          bytes: artifact.bytes.slice(0),
          createdAt,
        };
        store.put(record);
      }
    },
    'Não foi possível disponibilizar as planilhas nesta sessão.',
  );

  // A limpeza é oportunista: falhar aqui não invalida as planilhas recém-salvas.
  try {
    await pruneOldRequests(requestId);
  } catch {
    // Mantém o histórico local como está; o download desta apuração já está garantido.
  }
}

export async function listLocalArtifacts(requestId: string): Promise<StoredArtifact[]> {
  return runReadTransaction<StoredArtifact[]>(
    (store, resolve, reject) => {
      const index = store.index('requestId');
      const request = index.getAll(IDBKeyRange.only(requestId));
      request.onsuccess = () => resolve(
        (request.result as StoredArtifact[]).sort((a, b) => a.tipo.localeCompare(b.tipo)),
      );
      request.onerror = () => reject(request.error);
    },
    'Não foi possível consultar as planilhas desta sessão.',
  );
}

export async function hasLocalArtifact(requestId: string, tipo?: TipoPlanilha): Promise<boolean> {
  if (tipo) {
    return runReadTransaction<boolean>(
      (store, resolve, reject) => {
        const request = store.get(requestKey(requestId, tipo));
        request.onsuccess = () => resolve(Boolean(request.result));
        request.onerror = () => reject(request.error);
      },
      'Não foi possível consultar as planilhas desta sessão.',
    );
  }
  return (await listLocalArtifacts(requestId)).length > 0;
}

export async function deleteLocalArtifacts(requestId: string): Promise<void> {
  await deleteMultipleLocalArtifacts([requestId]);
}

export async function deleteMultipleLocalArtifacts(requestIds: string[]): Promise<void> {
  const uniqueIds = [...new Set((requestIds ?? []).filter(Boolean))];
  if (uniqueIds.length === 0) return;

  await runWriteTransaction(
    (store) => {
      const index = store.index('requestId');
      for (const requestId of uniqueIds) {
        const keysRequest = index.getAllKeys(IDBKeyRange.only(requestId));
        keysRequest.onsuccess = () => {
          for (const key of keysRequest.result) store.delete(key);
        };
      }
    },
    'Não foi possível remover as planilhas desta sessão.',
  );
}

function triggerDownload(bytes: ArrayBuffer, filename: string, mimeType: string): void {
  const url = URL.createObjectURL(new Blob([bytes], { type: mimeType }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Firefox e WebKit abortam o download quando a URL é revogada no mesmo tick.
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export async function downloadLocalArtifacts(
  requestId: string,
  tipo?: TipoPlanilha,
): Promise<void> {
  const artifacts = await listLocalArtifacts(requestId);
  const selected = tipo ? artifacts.filter((artifact) => artifact.tipo === tipo) : artifacts;
  if (selected.length === 0) {
    throw new Error(
      'A planilha não está mais disponível nesta sessão. Gere-a novamente para fazer o download.',
    );
  }

  if (selected.length === 1) {
    triggerDownload(selected[0].bytes, selected[0].filename, selected[0].mimeType);
    return;
  }

  const entries = new Map<string, Uint8Array>(
    selected.map((artifact) => [artifact.filename, new Uint8Array(artifact.bytes)]),
  );
  const zip = writeZip(entries);
  triggerDownload(zip, `planilhas_${requestId.slice(0, 8)}.zip`, 'application/zip');
}
