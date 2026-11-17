import { useMemo, useState } from 'react';
import type { ChangeEvent, DragEvent } from 'react';

import { triggerBlobDownload } from '../../lib/downloadBlob';
import {
  fillAndReorderEntryDatesInXlsx,
  loadEntryDateIndex,
  type EntryDateFillFileResult,
  type EntryDateFillSummary,
} from '../../lib/localProcessing/entryDateFiller';
import { writeZip } from '../../lib/localProcessing/zip';

const MAX_XLSX_BYTES = 20 * 1024 * 1024;
const MAX_SPED_BYTES = 50 * 1024 * 1024;

const ENTRY_SHEET_EXTENSIONS = ['.xls', '.xlsx', '.csv', '.txt', '.tsv'];

function fileKey(file: File): string {
  return `${file.name}|${file.size}|${file.lastModified}`;
}

function hasExtension(filename: string, extensions: string[]): boolean {
  const lower = filename.toLowerCase();
  return extensions.some((ext) => lower.endsWith(ext));
}

function mergeUniqueValidFiles(
  current: File[],
  incoming: File[],
  isValid: (file: File) => boolean,
): { next: File[]; rejected: number } {
  const valid = incoming.filter(isValid);
  const existingKeys = new Set(current.map(fileKey));
  const added = valid.filter((file) => !existingKeys.has(fileKey(file)));
  return {
    next: added.length > 0 ? [...current, ...added] : current,
    rejected: incoming.length - valid.length,
  };
}

export function usePreencherDatasEntradaPage() {
  const [targetFiles, setTargetFiles] = useState<File[]>([]);
  const [spedFiles, setSpedFiles] = useState<File[]>([]);
  const [entrySheetFiles, setEntrySheetFiles] = useState<File[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const [processError, setProcessError] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [results, setResults] = useState<EntryDateFillFileResult[]>([]);

  const invalidateResults = () => {
    setResults([]);
    setProcessError(null);
  };

  const addTargetFiles = (incoming: File[]) => {
    if (incoming.length === 0) return;
    const { next, rejected } = mergeUniqueValidFiles(
      targetFiles,
      incoming,
      (file) => hasExtension(file.name, ['.xlsx']) && file.size > 0 && file.size <= MAX_XLSX_BYTES,
    );
    if (next !== targetFiles) {
      setTargetFiles(next);
      invalidateResults();
    }
    setFileError(
      rejected > 0
        ? 'Selecione apenas planilhas .xlsx não vazias de até 20 MB.'
        : null,
    );
  };

  const addSpedFiles = (incoming: File[]) => {
    if (incoming.length === 0) return;
    const { next, rejected } = mergeUniqueValidFiles(
      spedFiles,
      incoming,
      (file) => hasExtension(file.name, ['.txt']) && file.size > 0 && file.size <= MAX_SPED_BYTES,
    );
    if (next !== spedFiles) {
      setSpedFiles(next);
      invalidateResults();
    }
    setFileError(
      rejected > 0
        ? 'Selecione apenas arquivos SPED Fiscal (.txt) não vazios de até 50 MB.'
        : null,
    );
  };

  const addEntrySheetFiles = (incoming: File[]) => {
    if (incoming.length === 0) return;
    const { next, rejected } = mergeUniqueValidFiles(
      entrySheetFiles,
      incoming,
      (file) =>
        hasExtension(file.name, ENTRY_SHEET_EXTENSIONS)
        && file.size > 0
        && file.size <= MAX_XLSX_BYTES,
    );
    if (next !== entrySheetFiles) {
      setEntrySheetFiles(next);
      invalidateResults();
    }
    setFileError(
      rejected > 0
        ? 'Selecione planilhas de entradas (.xls, .xlsx, .csv, .txt ou .tsv) não vazias de até 20 MB.'
        : null,
    );
  };

  const bindFileInput =
    (handler: (files: File[]) => void) => (event: ChangeEvent<HTMLInputElement>) => {
      handler(Array.from(event.target.files ?? []));
      event.target.value = '';
    };

  const bindDrop =
    (handler: (files: File[]) => void) => (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      handler(Array.from(event.dataTransfer.files));
    };

  const removeTargetFile = (index: number) => {
    setTargetFiles((curr) => curr.filter((_, idx) => idx !== index));
    invalidateResults();
  };

  const removeSpedFile = (index: number) => {
    setSpedFiles((curr) => curr.filter((_, idx) => idx !== index));
    invalidateResults();
  };

  const removeEntrySheetFile = (index: number) => {
    setEntrySheetFiles((curr) => curr.filter((_, idx) => idx !== index));
    invalidateResults();
  };

  const resetAll = () => {
    setTargetFiles([]);
    setSpedFiles([]);
    setEntrySheetFiles([]);
    setFileError(null);
    setProcessError(null);
    setResults([]);
  };

  const hasSources = spedFiles.length > 0 || entrySheetFiles.length > 0;
  const canProcess = targetFiles.length > 0 && hasSources && !isProcessing;

  const processSpreadsheets = async () => {
    if (!canProcess) return;
    setIsProcessing(true);
    setProcessError(null);
    setResults([]);

    try {
      const entryIndex = await loadEntryDateIndex({ spedFiles, entrySheetFiles });
      if (entryIndex.size === 0) {
        throw new Error(
          'Nenhuma data de entrada válida foi encontrada nos arquivos SPED ou planilhas de entrada enviados.',
        );
      }

      const processed: EntryDateFillFileResult[] = [];
      for (const file of targetFiles) {
        const buffer = await file.arrayBuffer();
        const result = await fillAndReorderEntryDatesInXlsx(buffer, file.name, entryIndex);
        processed.push(result);
      }
      setResults(processed);
    } catch (error) {
      setProcessError(
        error instanceof Error
          ? error.message
          : 'Não foi possível preencher as datas de entrada das planilhas selecionadas.',
      );
    } finally {
      setIsProcessing(false);
    }
  };

  const downloadResult = (result: EntryDateFillFileResult) => {
    triggerBlobDownload(
      new Blob([result.bytes], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }),
      result.outputFilename,
    );
  };

  const downloadAllZip = () => {
    if (results.length === 0) return;
    const entries = new Map<string, Uint8Array>();
    const usedNames = new Map<string, number>();

    for (const item of results) {
      const count = usedNames.get(item.outputFilename) ?? 0;
      usedNames.set(item.outputFilename, count + 1);
      const uniqueName = count === 0
        ? item.outputFilename
        : item.outputFilename.replace(/\.xlsx$/i, `_${count + 1}.xlsx`);
      entries.set(uniqueName, new Uint8Array(item.bytes));
    }

    const zipBytes = writeZip(entries);
    triggerBlobDownload(
      new Blob([zipBytes], { type: 'application/zip' }),
      'planilhas_datas_entrada_atualizadas.zip',
    );
  };

  const aggregatedSummary = useMemo<EntryDateFillSummary>(
    () =>
      results.reduce(
        (acc, item) => ({
          totalRows: acc.totalRows + item.summary.totalRows,
          filledNow: acc.filledNow + item.summary.filledNow,
          alreadyFilled: acc.alreadyFilled + item.summary.alreadyFilled,
          stillPending: acc.stillPending + item.summary.stillPending,
        }),
        { totalRows: 0, filledNow: 0, alreadyFilled: 0, stillPending: 0 },
      ),
    [results],
  );

  return {
    targetFiles,
    spedFiles,
    entrySheetFiles,
    fileError,
    clearFileError: () => setFileError(null),
    processError,
    clearProcessError: () => setProcessError(null),
    isProcessing,
    canProcess,
    hasSources,
    results,
    aggregatedSummary,
    handleTargetInput: bindFileInput(addTargetFiles),
    handleTargetDrop: bindDrop(addTargetFiles),
    removeTargetFile,
    clearTargetFiles: () => {
      setTargetFiles([]);
      invalidateResults();
    },
    handleSpedInput: bindFileInput(addSpedFiles),
    handleSpedDrop: bindDrop(addSpedFiles),
    removeSpedFile,
    clearSpedFiles: () => {
      setSpedFiles([]);
      invalidateResults();
    },
    handleEntrySheetInput: bindFileInput(addEntrySheetFiles),
    handleEntrySheetDrop: bindDrop(addEntrySheetFiles),
    removeEntrySheetFile,
    clearEntrySheetFiles: () => {
      setEntrySheetFiles([]);
      invalidateResults();
    },
    processSpreadsheets,
    downloadResult,
    downloadAllZip,
    resetAll,
  };
}

