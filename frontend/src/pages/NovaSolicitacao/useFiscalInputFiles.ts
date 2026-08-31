import { useState } from 'react';
import type { ChangeEvent, DragEvent } from 'react';

function isXmlOrZip(file: File): boolean {
  const name = file.name.toLowerCase();
  return (
    name.endsWith('.xml')
    || name.endsWith('.zip')
    || file.type.includes('xml')
    || file.type.includes('zip')
  );
}

export function useFiscalInputFiles() {
  const [xmlFiles, setXmlFiles] = useState<File[]>([]);
  const [spedFile, setSpedFile] = useState<File | null>(null);
  const [planilhaEntradaFile, setPlanilhaEntradaFile] = useState<File | null>(null);

  const addXmlFiles = (newFiles: File[]) => {
    const validFiles = newFiles.filter(isXmlOrZip);
    if (validFiles.length < newFiles.length) {
      alert(
        'Alguns arquivos foram ignorados: envie arquivos com extensão .xml ou '
        + 'pacotes .zip contendo os XMLs.',
      );
    }

    setXmlFiles((currentFiles) => {
      const existingNames = new Set(currentFiles.map((file) => file.name));
      return [
        ...currentFiles,
        ...validFiles.filter((file) => !existingNames.has(file.name)),
      ];
    });
  };

  const handleXmlDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    addXmlFiles(Array.from(event.dataTransfer.files));
  };

  const handleXmlInput = (event: ChangeEvent<HTMLInputElement>) => {
    addXmlFiles(Array.from(event.target.files ?? []));
  };

  const removeXmlFile = (index: number) => {
    setXmlFiles((currentFiles) => currentFiles.filter((_, itemIndex) => itemIndex !== index));
  };

  const handleSpedInput = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.txt')) {
      alert('Por favor, selecione um arquivo de texto (.txt) do SPED Fiscal.');
      return;
    }
    setSpedFile(file);
  };

  const handleSpedDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const file = event.dataTransfer.files[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.txt')) {
      alert('Por favor, envie um arquivo com extensão .txt para o SPED Fiscal.');
      return;
    }
    setSpedFile(file);
  };

  const handlePlanilhaEntradaInput = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const filename = file.name.toLowerCase();
    if (!filename.endsWith('.xls') && !filename.endsWith('.xlsx')) {
      alert('Por favor, selecione um arquivo de planilha no formato .xls ou .xlsx.');
      return;
    }
    setPlanilhaEntradaFile(file);
  };

  const resetFiles = () => {
    setXmlFiles([]);
    setSpedFile(null);
    setPlanilhaEntradaFile(null);
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
  };
}
