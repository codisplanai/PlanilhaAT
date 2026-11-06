import { useState } from 'react';
import type { ChangeEvent, DragEvent } from 'react';

function isXmlOrZip(file: File): boolean {
  const name = file.name.toLowerCase();
  return name.endsWith('.xml') || name.endsWith('.zip');
}

const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_SPED_BYTES = 50 * 1024 * 1024;
const MAX_TOTAL_BYTES = 100 * 1024 * 1024;

export function useFiscalInputFiles() {
  const [xmlFiles, setXmlFiles] = useState<File[]>([]);
  const [spedFiles, setSpedFiles] = useState<File[]>([]);
  const [planilhaEntradaFile, setPlanilhaEntradaFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  /**
   * A decisão inteira acontece fora do atualizador de estado. Chamar
   * ``setFileError`` de dentro dele tornava o atualizador impuro — no
   * StrictMode o React o executa duas vezes e a mensagem de erro aparecia
   * mesmo quando a adição era aceita.
   */
  const addXmlFiles = (newFiles: File[]) => {
    if (newFiles.length === 0) return;

    const validFiles = newFiles.filter(
      (file) => isXmlOrZip(file) && file.size > 0 && file.size <= MAX_FILE_BYTES,
    );
    const fileKey = (file: File) => `${file.name}|${file.size}|${file.lastModified}`;
    const existingKeys = new Set(xmlFiles.map(fileKey));
    const addedFiles = validFiles.filter((file) => !existingKeys.has(fileKey(file)));
    const nextFiles = [...xmlFiles, ...addedFiles];

    if (nextFiles.reduce((sum, file) => sum + file.size, 0) > MAX_TOTAL_BYTES) {
      setFileError('O conjunto de XMLs/ZIPs não pode exceder 100 MB.');
      return;
    }

    if (addedFiles.length > 0) setXmlFiles(nextFiles);

    if (validFiles.length < newFiles.length) {
      setFileError(
        'Alguns arquivos foram ignorados. Use .xml/.zip não vazios, com no máximo 20 MB por arquivo.',
      );
    } else {
      setFileError(null);
    }
  };

  const handleXmlDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    addXmlFiles(Array.from(event.dataTransfer.files));
  };

  const handleXmlInput = (event: ChangeEvent<HTMLInputElement>) => {
    addXmlFiles(Array.from(event.target.files ?? []));
    event.target.value = '';
  };

  const removeXmlFile = (index: number) => {
    setXmlFiles((currentFiles) => currentFiles.filter((_, itemIndex) => itemIndex !== index));
  };

  const addSpedFiles = (newFiles: File[]) => {
    if (newFiles.length === 0) return;

    const validFiles = newFiles.filter(
      (file) => file.name.toLowerCase().endsWith('.txt') && file.size > 0 && file.size <= MAX_SPED_BYTES,
    );
    const fileKey = (file: File) => `${file.name}|${file.size}|${file.lastModified}`;
    const existingKeys = new Set(spedFiles.map(fileKey));
    const addedFiles = validFiles.filter((file) => !existingKeys.has(fileKey(file)));
    const nextFiles = [...spedFiles, ...addedFiles];

    if (addedFiles.length > 0) setSpedFiles(nextFiles);

    if (validFiles.length < newFiles.length) {
      const hasInvalidExt = newFiles.some((file) => !file.name.toLowerCase().endsWith('.txt'));
      setFileError(
        hasInvalidExt
          ? 'Selecione apenas arquivos de texto (.txt) do SPED Fiscal.'
          : 'Cada arquivo SPED deve ser não vazio e ter no máximo 50 MB.',
      );
    } else {
      setFileError(null);
    }
  };

  const handleSpedInput = (event: ChangeEvent<HTMLInputElement>) => {
    addSpedFiles(Array.from(event.target.files ?? []));
    event.target.value = '';
  };

  const handleSpedDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    addSpedFiles(Array.from(event.dataTransfer.files));
  };

  const removeSpedFile = (index: number) => {
    setSpedFiles((currentFiles) => currentFiles.filter((_, itemIndex) => itemIndex !== index));
  };

  const handlePlanilhaEntradaInput = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const filename = file.name.toLowerCase();
    if (!filename.endsWith('.xlsx') && !filename.endsWith('.xls')) {
      setFileError('Selecione uma planilha no formato .xlsx ou .xls.');
      event.target.value = '';
      return;
    }
    if (file.size === 0 || file.size > MAX_FILE_BYTES) {
      setFileError('A planilha de entrada deve ser não vazia e ter no máximo 20 MB.');
      event.target.value = '';
      return;
    }
    setPlanilhaEntradaFile(file);
    setFileError(null);
    event.target.value = '';
  };

  const handlePlanilhaEntradaDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const file = event.dataTransfer.files[0];
    if (!file) return;

    const filename = file.name.toLowerCase();
    if (!filename.endsWith('.xlsx') && !filename.endsWith('.xls')) {
      setFileError('Selecione uma planilha no formato .xlsx ou .xls.');
      return;
    }
    if (file.size === 0 || file.size > MAX_FILE_BYTES) {
      setFileError('A planilha de entrada deve ser não vazia e ter no máximo 20 MB.');
      return;
    }
    setPlanilhaEntradaFile(file);
    setFileError(null);
  };

  const resetFiles = () => {
    setXmlFiles([]);
    setSpedFiles([]);
    setPlanilhaEntradaFile(null);
    setFileError(null);
  };

  return {
    xmlFiles,
    spedFiles,
    spedFile: spedFiles[0] ?? null,
    planilhaEntradaFile,
    setXmlFiles,
    setSpedFiles,
    setPlanilhaEntradaFile,
    handleXmlDrop,
    handleXmlInput,
    removeXmlFile,
    handleSpedInput,
    handleSpedDrop,
    removeSpedFile,
    handlePlanilhaEntradaInput,
    handlePlanilhaEntradaDrop,
    resetFiles,
    fileError,
    clearFileError: () => setFileError(null),
  };
}
