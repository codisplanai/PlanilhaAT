# SDD ledger — plan: docs/superpowers/plans/2026-10-22-desconto-base-calculo-planilhas.md

## Pre-flight scan
| Produces Task | Consumes Task | Shared Interface | Status |
| --- | --- | --- | --- |
| Task 1 (Domain/Schemas) | Task 2 (Frontend Extraction) | `vDesc` em `ExtractedItem`, `vDescNota` em `ExtractedNote` | Alinhado |
| Task 1 (Domain/Schemas) | Task 4 (Backend Extraction) | `v_desc` em `ExtractedItemNF`, `v_desc_nota` em `ExtractedNFData` | Alinhado |
| Task 2 (Frontend Extraction) | Task 3 (Frontend Processor) | `ExtractedItem.baseCalculo`, `ExtractedItem.vDesc` | Alinhado |
| Task 4 (Backend Extraction) | Task 5 (Backend Pipeline) | `ExtractedItemNF.base_calculo`, `ExtractedNFData.v_desc_nota` | Alinhado |
| Tasks 2, 3, 4, 5 | Task 6 (E2E & Regressão) | Planilhas geradas e suites completas de testes | Alinhado |

## Tasks
- Task 1: complete
- Task 2: complete
- Task 3: complete
- Task 4: complete
- Task 5: complete
- Task 6: complete
