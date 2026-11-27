/** Gera identificador estável de arquivo para evitar duplicidades na etapa de anexos. */
export function fiscalFileKey(file: Pick<File, 'name' | 'size' | 'lastModified'>): string {
  return `${file.name}|${file.size}|${file.lastModified}`;
}

/** Mescla novos arquivos XML/ZIP evitando duplicatas e contabilizando quantos já existiam. */
export function mergeCteAttachedFiles(
  existingFiles: readonly File[],
  incomingFiles: readonly File[],
): { merged: File[]; added: File[]; duplicateCount: number } {
  const existingKeys = new Set(existingFiles.map(fiscalFileKey));
  const added: File[] = [];
  let duplicateCount = 0;

  for (const file of incomingFiles) {
    const key = fiscalFileKey(file);
    if (existingKeys.has(key)) {
      duplicateCount += 1;
      continue;
    }
    existingKeys.add(key);
    added.push(file);
  }

  return {
    merged: [...existingFiles, ...added],
    added,
    duplicateCount,
  };
}

/** Mensagem exibida no modal de CT-e quando o envio não resolve a pendência. */
export function cteAttachmentFeedback(params: {
  addedCount: number;
  duplicateCount: number;
  stillPending: boolean;
}): string | null {
  if (!params.stillPending) return null;
  if (params.addedCount === 0 && params.duplicateCount > 0) {
    return 'O(s) arquivo(s) selecionado(s) já estava(m) anexado(s) e não resolveram as pendências abaixo. Selecione outro XML/ZIP ou clique em "Continuar sem essas notas".';
  }
  if (params.addedCount > 0) {
    return 'Arquivo(s) anexado(s), mas as NF-es listadas abaixo continuam faltando. Confira as chaves de acesso ou clique em "Continuar sem essas notas".';
  }
  return null;
}

