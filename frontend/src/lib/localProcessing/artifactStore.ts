import type { LocalGeneratedArtifact } from '../../types/localProcessing';
import type { TipoPlanilha } from '../../types/solicitacao';
import { writeZip } from './zip';

const DB_NAME = 'planaut-local-artifacts';
const DB_VERSION = 1;
const STORE_NAME = 'outputs';

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
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'key' });
        store.createIndex('requestId', 'requestId', { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Não foi possível abrir o armazenamento local.'));
  });
}

function requestKey(requestId: string, tipo: TipoPlanilha): string {
  return `${requestId}:${tipo}`;
}

async function transaction<T>(
  mode: IDBTransactionMode,
  handler: (store: IDBObjectStore, resolve: (value: T) => void, reject: (reason?: unknown) => void) => void,
): Promise<T> {
  const db = await openDatabase();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, mode);
    const store = tx.objectStore(STORE_NAME);
    handler(store, resolve, reject);
    tx.onabort = () => reject(tx.error ?? new Error('Operação local cancelada.'));
    tx.onerror = () => reject(tx.error ?? new Error('Falha no armazenamento local.'));
    tx.oncomplete = () => db.close();
  });
}

export async function saveLocalArtifacts(
  requestId: string,
  artifacts: LocalGeneratedArtifact[],
): Promise<void> {
  if (artifacts.length === 0) return;
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    for (const artifact of artifacts) {
      const record: StoredArtifact = {
        key: requestKey(requestId, artifact.tipo),
        requestId,
        tipo: artifact.tipo,
        filename: artifact.filename,
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        bytes: artifact.bytes.slice(0),
        createdAt: new Date().toISOString(),
      };
      store.put(record);
    }
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error ?? new Error('Não foi possível disponibilizar as planilhas nesta sessão.'));
    };
    tx.onabort = () => {
      db.close();
      reject(tx.error ?? new Error('Armazenamento local cancelado.'));
    };
  });
}

export async function listLocalArtifacts(requestId: string): Promise<StoredArtifact[]> {
  return transaction<StoredArtifact[]>('readonly', (store, resolve, reject) => {
    const index = store.index('requestId');
    const request = index.getAll(IDBKeyRange.only(requestId));
    request.onsuccess = () => resolve((request.result as StoredArtifact[]).sort((a, b) => a.tipo.localeCompare(b.tipo)));
    request.onerror = () => reject(request.error);
  });
}

export async function hasLocalArtifact(requestId: string, tipo?: TipoPlanilha): Promise<boolean> {
  if (tipo) {
    return transaction<boolean>('readonly', (store, resolve, reject) => {
      const request = store.get(requestKey(requestId, tipo));
      request.onsuccess = () => resolve(Boolean(request.result));
      request.onerror = () => reject(request.error);
    });
  }
  return (await listLocalArtifacts(requestId)).length > 0;
}

export async function deleteLocalArtifacts(requestId: string): Promise<void> {
  const artifacts = await listLocalArtifacts(requestId);
  if (artifacts.length === 0) return;
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    for (const artifact of artifacts) store.delete(artifact.key);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error ?? new Error('Não foi possível remover as planilhas desta sessão.'));
    };
  });
}

export async function deleteMultipleLocalArtifacts(requestIds: string[]): Promise<void> {
  if (!requestIds || requestIds.length === 0) return;
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const index = store.index('requestId');

    for (const reqId of requestIds) {
      const getReq = index.getAllKeys(IDBKeyRange.only(reqId));
      getReq.onsuccess = () => {
        const keys = getReq.result;
        for (const key of keys) {
          store.delete(key);
        }
      };
    }

    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error ?? new Error('Não foi possível remover as planilhas desta sessão.'));
    };
  });
}


function triggerDownload(bytes: ArrayBuffer, filename: string, mimeType: string): void {
  const url = URL.createObjectURL(new Blob([bytes], { type: mimeType }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
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
