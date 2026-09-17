export interface FiscalInputFiles {
  xmlFiles?: File[];
  spedFile?: File | null;
  entrySheet?: File | null;
}

export function createFiscalInputFormData(
  files: FiscalInputFiles,
  bonusDecisions?: Record<string, boolean>,
): FormData {
  const formData = new FormData();

  files.xmlFiles?.forEach((file) => formData.append('files', file));
  if (files.spedFile) formData.append('sped_file', files.spedFile);
  if (files.entrySheet) formData.append('planilha_entradas', files.entrySheet);
  if (bonusDecisions && Object.keys(bonusDecisions).length > 0) {
    formData.append('decisoes_bonificacao', JSON.stringify(bonusDecisions));
  }

  return formData;
}
