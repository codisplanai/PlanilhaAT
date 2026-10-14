# Separação de Frete e IPI nas Planilhas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Impedir que valores de frete (`vFrete`) e outras despesas acessórias sejam indevidamente importados para a coluna de IPI nas planilhas geradas, garantindo que a coluna de IPI reflita estritamente o IPI destacado no documento fiscal (`vIPI`), enquanto frete e despesas continuam integrando o valor total e a base de cálculo de ICMS.

**Architecture:** Modificar a camada de extração (`NFeXmlExtractor` e `SpedFiscalExtractor`) e o espelho no frontend (`xml.ts`, `sped.ts`) para que o campo que alimenta a coluna de IPI receba estritamente o `vIPI` destacado. Remover do pipeline (`pipeline_service.py`) e do motor de decisão (`parcial_decision.py`) qualquer inferência artificial de IPI como diferença entre valor total e base de cálculo. Validar em testes unitários e de integração E2E com as planilhas oficiais de Antecipação Parcial, Antecipação Tributária e DIFAL.

**Tech Stack:** Python 3.12+, FastAPI, SQLAlchemy, openpyxl, pytest, TypeScript (frontend/src/lib/localProcessing).

**Spec:** Alinhamento técnico via `/grill-me` em 2026-10-14, definindo que a coluna de IPI deve conter exclusivamente `vIPI` (sem frete nem outras despesas), sem inferência artificial quando o IPI for ausente/zerado, mantendo o frete compondo `v_total` e `base_calculo`.

## Global Constraints

- O valor do frete (`vFrete`) e outras despesas acessórias (`vSeg`, `vOutro`) devem continuar compondo o Valor Total (`v_total`) do item e da nota fiscal.
- A Base de Cálculo do ICMS (`base_calculo`) extraída da nota (`<vBC>`) é preservada; quando ausente ou zerada, a base de cálculo da mercadoria é apurada como `v_total - v_ipi` (preservando o frete na base tributável do ICMS e subtraindo apenas o IPI).
- A coluna de IPI da planilha (`ipi_despesas` / `IPI`) deve conter estritamente `vIPI` (zero se não houver IPI destacado).
- Nenhuma migração de schema de banco de dados é necessária, mantendo o atributo existente `ipi_despesas` com retrocompatibilidade para todos os templates ativos.
- Toda a suíte existente de testes do repositório deve permanecer 100% aprovada (`pytest`).

## Review Focus

1. Nota com frete destacado (`vFrete > 0`), sem IPI (`vIPI == 0`): a coluna de IPI na planilha deve ser `0.00`, e `v_total` deve incluir o frete.
2. Nota com frete (`vFrete > 0`) e IPI (`vIPI > 0`): a coluna de IPI deve receber exatamente `vIPI`, sem somar o frete.
3. Nota com base de cálculo zerada/Simples Nacional: a base de cálculo recomposta deve ser `v_total - v_ipi`, mantendo o frete na base tributável.
4. Remoção da heurística de inferência: nota onde `v_total > base_calculo` sem IPI destacado NÃO deve preencher a diferença na coluna de IPI.
5. Fórmulas de planilha Excel: em `modelo_padrao_antecipacao_parcial.xlsx`, a fórmula `=E4-G4` (`V.TOTAL - IPI`) resulta exatamente na base de cálculo da nota (`5150.00` em vez de `5000.00`), eliminando o abatimento indevido do frete.

---

### Task 1: Correção na Extração de XML e SPED Fiscal (Backend)

**Files:**
- Modify: `app/services/extraction/nfe_xml_extractor.py:155-245`
- Modify: `app/services/extraction/sped_fiscal_extractor.py:145-160, 380-415`
- Modify: `tests/test_camada4_extracao.py:20-30`
- Create: `tests/test_frete_ipi_extracao.py`

**Interfaces:**
- Consumes: XML da NF-e com tags `<vFrete>`, `<vSeg>`, `<vOutro>`, `<vIPI>`, `<vBC>`, `<vNF>`, e linhas C100/C170 do SPED Fiscal.
- Produces: `ExtractedItemNF.ipi_despesas` contendo estritamente `v_ipi` (sem somar `v_frete`, `v_seg`, `v_outro`), e `v_total` contendo a soma integral do item.

- [ ] **Step 1: Escrever os testes com falha para a extração isolada de IPI e Frete**

Criar `tests/test_frete_ipi_extracao.py`:
```python
from decimal import Decimal
from app.services.extraction.nfe_xml_extractor import NFeXmlExtractor

def test_xml_extractor_keeps_frete_out_of_ipi():
    xml = """<?xml version="1.0" encoding="UTF-8"?>
    <nfeProc xmlns="http://www.portalfiscal.inf.br/nfe">
      <NFe>
        <infNFe Id="NFe35260198765432000180550010000001231000000123">
          <ide><nNF>123</nNF><serie>1</serie><dhEmi>2026-01-10T10:00:00-03:00</dhEmi></ide>
          <emit><CNPJ>98765432000180</CNPJ><enderEmit><UF>SP</UF></enderEmit><CRT>3</CRT></emit>
          <dest><CNPJ>12345678000195</CNPJ><enderDest><UF>BA</UF></enderDest></dest>
          <det nItem="1">
            <prod>
              <NCM>84713012</NCM><CFOP>6102</CFOP><xProd>ITEM TESTE</xProd>
              <vProd>1000.00</vProd><vFrete>100.00</vFrete><vSeg>0.00</vSeg><vOutro>50.00</vOutro><vDesc>0.00</vDesc>
            </prod>
            <imposto>
              <ICMS><ICMS00><orig>0</orig><CST>00</CST><vBC>1150.00</vBC><pICMS>12.00</pICMS><vICMS>138.00</vICMS></ICMS00></ICMS>
              <IPI><IPITrib><vIPI>50.00</vIPI></IPITrib></IPI>
            </imposto>
          </det>
          <total><ICMSTot><vBC>1150.00</vBC><vICMS>138.00</vICMS><vProd>1000.00</vProd><vFrete>100.00</vFrete><vSeg>0.00</vSeg><vOutro>50.00</vOutro><vIPI>50.00</vIPI><vNF>1200.00</vNF></ICMSTot></total>
        </infNFe>
      </NFe>
    </nfeProc>"""
    extractor = NFeXmlExtractor()
    data = extractor.extract(xml.encode("utf-8"))
    assert len(data.itens) == 1
    item = data.itens[0]
    assert item.v_total == Decimal("1200.00")
    assert item.base_calculo == Decimal("1150.00")
    # IPI deve ser estritamente 50.00, NÃO 200.00 (50 IPI + 100 Frete + 50 Outro)
    assert item.ipi_despesas == Decimal("50.00")
```

- [ ] **Step 2: Executar o teste e verificar falha**

Run: `pytest tests/test_frete_ipi_extracao.py -v`
Expected: FAIL (`assert Decimal('200.00') == Decimal('50.00')`)

- [ ] **Step 3: Ajustar a extração em `nfe_xml_extractor.py` e `sped_fiscal_extractor.py`**

Em `app/services/extraction/nfe_xml_extractor.py`:
- Separar `v_despesas = v_frete + v_seg + v_outro`.
- Manter `v_total_item = v_prod + v_despesas + v_ipi - v_desc`.
- Definir `ipi_despesas = v_ipi` (apenas IPI).
- Caso `v_bc_item == Decimal("0.00")`, recompor como `v_total_item - v_ipi`.

Em `app/services/extraction/sped_fiscal_extractor.py`:
- Em C100 sem C170: definir `ipi_despesas = current_c100["v_ipi_nota"]`.
- Em C170: definir `ipi_despesas_item = vl_ipi` (sem inferência por diferença `v_total - vl_bc_icms`).

Atualizar a asserção histórica em `tests/test_camada4_extracao.py:27` para refletir `assert item.ipi_despesas == Decimal("250.00")`.

- [ ] **Step 4: Executar os testes de extração e verificar aprovação**

Run: `pytest tests/test_frete_ipi_extracao.py tests/test_camada4_extracao.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/services/extraction/nfe_xml_extractor.py app/services/extraction/sped_fiscal_extractor.py tests/test_frete_ipi_extracao.py tests/test_camada4_extracao.py
git commit -m "fix(extraction): atribuir estritamente vIPI ao campo de IPI excluindo frete e despesas"
```

---

### Task 2: Saneamento no Pipeline Fiscal e Motor de Decisão Parcial

**Files:**
- Modify: `app/services/pipeline_service.py:590-600`
- Modify: `app/services/rules_engine/parcial_decision.py:125-136`
- Create: `tests/test_pipeline_frete_ipi.py`

**Interfaces:**
- Consumes: `ExtractedItemNF.ipi_despesas`, `ExtractedItemNF.v_total`, `ExtractedItemNF.base_calculo`.
- Produces: `NotaFiscalProcessada.ipi_despesas` com o valor fiel de `v_ipi` sem heurística de soma retroativa.

- [ ] **Step 1: Escrever teste com falha para nota com frete sem IPI no Pipeline**

Criar `tests/test_pipeline_frete_ipi.py`:
```python
from decimal import Decimal
from datetime import date
from app.models.empresa import Empresa
from app.models.perfil_regras import PerfilRegras
from app.models.regra_aliquota import RegraAliquotaDestino
from app.models.solicitacao import Solicitacao
from app.models.template_xlsx import TemplateXlsx
from app.services.pipeline_service import ProcessingPipelineService
from app.core.seeds import seed_default_templates

def test_pipeline_frete_not_mapped_to_ipi(db_session):
    seed_default_templates(db_session)
    template = db_session.query(TemplateXlsx).filter(TemplateXlsx.tipo == "antecipacao_parcial", TemplateXlsx.ativo == True).first()
    perfil = PerfilRegras(nome="Perfil Teste Frete")
    db_session.add(perfil)
    db_session.commit()
    db_session.add(RegraAliquotaDestino(perfil_regras_id=perfil.id, uf="BA", aliquota=Decimal("0.2050"), descricao="BA"))
    empresa = Empresa(razao_social="EMPRESA TESTE", cnpj="12345678000195", uf="BA", perfil_regras_id=perfil.id)
    db_session.add(empresa)
    db_session.commit()

    # XML com vProd 1000, Frete 100, Base 1100, Total 1100, IPI 0
    xml = """<?xml version="1.0" encoding="UTF-8"?>
    <nfeProc xmlns="http://www.portalfiscal.inf.br/nfe">
      <NFe>
        <infNFe Id="NFe35260198765432000180550010000009991000000999">
          <ide><nNF>999</nNF><serie>1</serie><dhEmi>2026-01-15T10:00:00-03:00</dhEmi></ide>
          <emit><CNPJ>98765432000180</CNPJ><enderEmit><UF>SP</UF></enderEmit><CRT>3</CRT></emit>
          <dest><CNPJ>12345678000195</CNPJ><enderDest><UF>BA</UF></enderDest></dest>
          <det nItem="1">
            <prod>
              <NCM>84713012</NCM><CFOP>6102</CFOP><xProd>TESTE FRETE</xProd>
              <vProd>1000.00</vProd><vFrete>100.00</vFrete><vSeg>0.00</vSeg><vOutro>0.00</vOutro><vDesc>0.00</vDesc>
            </prod>
            <imposto>
              <ICMS><ICMS00><orig>0</orig><CST>00</CST><vBC>1100.00</vBC><pICMS>12.00</pICMS><vICMS>132.00</vICMS></ICMS00></ICMS>
            </imposto>
          </det>
          <total><ICMSTot><vBC>1100.00</vBC><vICMS>132.00</vICMS><vProd>1000.00</vProd><vFrete>100.00</vFrete><vSeg>0.00</vSeg><vOutro>0.00</vOutro><vIPI>0.00</vIPI><vNF>1100.00</vNF></ICMSTot></total>
        </infNFe>
      </NFe>
    </nfeProc>""".encode("utf-8")

    solicitacao = Solicitacao(empresa_id=empresa.id, periodo_inicio=date(2026, 1, 1), periodo_fim=date(2026, 1, 31), tipo_planilha="antecipacao_parcial", template_id=template.id, status="pendente")
    db_session.add(solicitacao)
    db_session.commit()

    service = ProcessingPipelineService(db_session)
    res = service.process_solicitacao(solicitacao.id, xml_files_bytes=[("999.xml", xml)])
    assert res.status == "concluido"
    nota = res.notas_processadas[0]
    assert nota.v_total == Decimal("1100.00")
    assert nota.base_calculo == Decimal("1100.00")
    assert nota.ipi_despesas == Decimal("0.00")
```

- [ ] **Step 2: Executar o teste para verificar o comportamento**

Run: `pytest tests/test_pipeline_frete_ipi.py -v`

- [ ] **Step 3: Remover a heurística de inferência em `pipeline_service.py` e `parcial_decision.py`**

Em `app/services/pipeline_service.py:593-598`:
Remover o bloco `elif v_bc_grupo > Decimal("0.00") and v_total_grupo > v_bc_grupo and ipi_despesas_grupo == Decimal("0.00"): ipi_despesas_grupo = v_total_grupo - v_bc_grupo`.

Em `app/services/rules_engine/parcial_decision.py:121-136`:
Remover o bloco correspondente em `preparar_valores_item`.

- [ ] **Step 4: Executar o teste e garantir aprovação**

Run: `pytest tests/test_pipeline_frete_ipi.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/services/pipeline_service.py app/services/rules_engine/parcial_decision.py tests/test_pipeline_frete_ipi.py
git commit -m "fix(pipeline): remover inferencia indevida de IPI e manter campo fiel ao vIPI destacado"
```

---

### Task 3: Atualização do Processamento Local no Frontend

**Files:**
- Modify: `frontend/src/lib/localProcessing/xml.ts:115-130`
- Modify: `frontend/src/lib/localProcessing/sped.ts:135-140, 275-290`
- Modify: `frontend/src/lib/localProcessing/processor.ts:455-465, 510-520`

**Interfaces:**
- Consumes: Extração de XML e SPED local no navegador.
- Produces: `ipiDespesas: vIpi` e `baseCalculo: vTotal - vIpi` (quando a base de cálculo for zerada).

- [ ] **Step 1: Atualizar `xml.ts` no frontend**

Em `frontend/src/lib/localProcessing/xml.ts`:
- Definir `const ipiDespesas = vIpi;` (em vez de somar `vFrete + vSeg + vOutro`).
- Manter `const vTotal = vProd + vFrete + vSeg + vOutro + vIpi - vDesc;`.
- Ajustar recomposição de base se zerada: `if (baseCalculo <= 0) baseCalculo = Math.max(0, vTotal - vIpi);`.

- [ ] **Step 2: Atualizar `sped.ts` no frontend**

Em `frontend/src/lib/localProcessing/sped.ts`:
- Em C100 sem C170: `ipiDespesas: current.vIpiNota`.
- Em C170: `ipiDespesas = vIpi` (remover fallback `vTotal - vBcIcms`).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/localProcessing/xml.ts frontend/src/lib/localProcessing/sped.ts frontend/src/lib/localProcessing/processor.ts
git commit -m "fix(frontend): alinhar processamento local para atribuir exclusivamente vIPI a ipiDespesas"
```

---

### Task 4: Validação E2E com Planilhas Oficiais (Parcial, Tributária, DIFAL) e Regressão Global

**Files:**
- Modify: `tests/test_official_template.py:120-135`
- Create: `tests/test_frete_ipi_planilhas_e2e.py`

**Interfaces:**
- Consumes: Arquivos XLSX gerados pelo `ProcessingPipelineService` para os templates de Antecipação Parcial, Antecipação Tributária e DIFAL.
- Produces: Verificação das células da planilha gerada:
  - Coluna IPI (`G` na Parcial e Tributária, `F` no DIFAL) preenchida com `vIPI` puro.
  - Coluna Base de Cálculo calculada corretamente conforme as fórmulas do modelo.

- [ ] **Step 1: Ajustar `tests/test_official_template.py`**

Em `tests/test_official_template.py:126`:
- Atualizar a asserção da célula G4 de `400.0` para `250.0` (`vIPI` da nota fixture).
- Adicionar asserção de que a fórmula `=E4-G4` gera `5150.00` (`5400 - 250`), igualando com exatidão a Base de Cálculo `<vBC>` da NF-e.

- [ ] **Step 2: Criar teste E2E abrangente em `tests/test_frete_ipi_planilhas_e2e.py`**

Testar preenchimento real para:
1. `antecipacao_parcial`: NF com frete e IPI -> Coluna G tem apenas IPI (`250.00`).
2. `antecipacao_tributaria`: NF com frete e sem IPI -> Coluna G tem `0.00`.
3. `difal`: NF com frete e sem IPI -> Coluna F tem `0.00`, sem duplicar o frete no cálculo.

- [ ] **Step 3: Executar a suíte de testes de templates e E2E**

Run: `pytest tests/test_official_template.py tests/test_frete_ipi_planilhas_e2e.py -v`
Expected: PASS

- [ ] **Step 4: Executar a suíte completa de regressão do repositório**

Run: `pytest`
Expected: PASS (todos os 407 testes aprovados)

- [ ] **Step 5: Commit**

```bash
git add tests/test_official_template.py tests/test_frete_ipi_planilhas_e2e.py
git commit -m "test(e2e): assegurar celula de IPI livre de frete em planilhas oficiais e validar regressao total"
```
