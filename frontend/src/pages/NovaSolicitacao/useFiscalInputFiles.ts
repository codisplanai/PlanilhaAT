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
  const [spedFile, setSpedFile] = useState<File | null>(null);
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

  const handleSpedInput = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.txt')) {
      setFileError('Selecione um arquivo de texto (.txt) do SPED Fiscal.');
      event.target.value = '';
      return;
    }
    if (file.size === 0 || file.size > MAX_SPED_BYTES) {
      setFileError('O arquivo SPED deve ser não vazio e ter no máximo 50 MB.');
      event.target.value = '';
      return;
    }
    setSpedFile(file);
    setFileError(null);
    event.target.value = '';
  };

  const handleSpedDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const file = event.dataTransfer.files[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.txt')) {
      setFileError('Selecione um arquivo com extensão .txt para o SPED Fiscal.');
      return;
    }
    if (file.size === 0 || file.size > MAX_SPED_BYTES) {
      setFileError('O arquivo SPED deve ser não vazio e ter no máximo 50 MB.');
      return;
    }
    setSpedFile(file);
    setFileError(null);
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

  const resetFiles = () => {
    setXmlFiles([]);
    setSpedFile(null);
    setPlanilhaEntradaFile(null);
    setFileError(null);
  };

  return {
    xmlFiles,
    spedFile,
    planilhaEntradaFile,
    setXmlFiles,
    setSpedFile,
    setPlanilhaEntradaFile,
    handleXmlDrop,
    handleXmlInput,
    removeXmlFile,
    handleSpedInput,
    handleSpedDrop,
    handlePlanilhaEntradaInput,
    resetFiles,
    fileError,
    clearFileError: () => setFileError(null),
  };
}
