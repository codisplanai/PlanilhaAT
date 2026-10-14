# Identificação de Alíquota Interestadual para Fornecedores do Simples Nacional Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Identificar e aplicar automaticamente a alíquota de ICMS de origem (A.ORI) em operações interestaduais com fornecedores optantes pelo Simples Nacional que não destacam alíquotas em suas notas, baseando-se na tabela interestadual de alíquotas (Resoluções do Senado Federal nº 22/1989 e 13/2012) para todos os cálculos e planilhas do sistema (Antecipação Parcial, Antecipação Tributária e DIFAL).

**Architecture:** Criação do módulo determinístico `InterstateRateResolver` no motor de regras para mapear alíquotas interestaduais (4%, 7%, 12%); enriquecimento dos extratores XML e SPED para capturar origem da mercadoria e detectar fornecedores Simples Nacional; e integração no `pipeline_service.py` para inferir A.ORI quando não destacada, registrar avisos de auditoria e garantir créditos e débitos precisos nas planilhas e no banco de dados.

**Tech Stack:** Python 3.12+, FastAPI, SQLAlchemy, Pydantic, pytest.

**Spec:** Alinhamento via `/grill-me` registrado na conversa em 2026-10-14 cobrindo escopo unificado (Parcial, ST, DIFAL), regras das Resoluções 22/1989 e 13/2012 (4% importados, 7% Sul/Sudeste -> N/NE/CO/ES, 12% demais), ativação apenas quando não houver destaque, identificação em XML e SPED C170 com propagação por CNPJ, e transparência via avisos de auditoria e metadados.

## Global Constraints

- Alíquotas retornadas devem ser instâncias de `Decimal` normalizadas (ex: `Decimal("0.04")`, `Decimal("0.07")`, `Decimal("0.12")`).
- Apenas operações interestaduais (`uf_fornecedor != uf_empresa_dest`) disparam a inferência da tabela.
- Se a nota/item trouxer alíquota/crédito expressamente destacado (`a_ori > 0`), a alíquota destacada deve ser respeitada e mantida.
- Estados do Grupo Sul/Sudeste (7% para N/NE/CO/ES): `SP`, `RJ`, `MG`, `PR`, `SC`, `RS`. O Espírito Santo (`ES`) recebe tratamento equivalente a Norte/Nordeste conforme ADCT art. 34 § 3º.
- Produtos importados (origem `1`, `2`, `3` ou `8`) utilizam alíquota de `0.04` (4%) independentemente das UFs de origem e destino.

## Review Focus

1. **Fornecedor com múltiplos itens onde um é nacional e outro é importado**: o item nacional de SP -> BA deve receber 7% e o item importado (origem 1) deve receber 4%.
2. **Fornecedor Simples Nacional que destacou crédito (`pCredSN = 2.5%`)**: a alíquota `0.025` deve ser mantida, não sendo sobrescrita pela interestadual de 7% ou 12%.
3. **Operação interna estadual com Simples Nacional (ex: BA -> BA)**: a tabela interestadual não deve atuar, e a validação do pipeline de operação interna deve prevalecer.
4. **SPED Fiscal puro sem XML**: notas com itens no C170 escriturados com CSOSN típico do Simples (ex: 102, 500) devem ativar o flag de Simples e aplicar a alíquota interestadual se `a_ori == 0`.
5. **DIFAL com fornecedor do Simples**: o cálculo de DIFAL com `aliq_simples = "S"` deve usar a alíquota interestadual inferida em vez de zero, gerando `base_st * (dst_rate - ori_rate)` correto.

---

### Task 1: Módulo Resolvedor de Alíquota Interestadual (`InterstateRateResolver`)

**Files:**
- Create: `app/services/rules_engine/interstate_rate_resolver.py`
- Test: `tests/test_interstate_rate_resolver.py`

**Interfaces:**
- Consumes: UFs de origem e destino (`str`), origem da mercadoria opcional (`str` ou `int`).
- Produces: `InterstateRateResolver.resolve_rate(uf_origem: str, uf_destino: str, origem_mercadoria: Optional[Union[str, int]] = None) -> Decimal`

- [ ] **Step 1: Write the failing tests in `tests/test_interstate_rate_resolver.py`**

```python
from decimal import Decimal
import pytest
from app.services.rules_engine.interstate_rate_resolver import InterstateRateResolver

@pytest.mark.parametrize("uf_origem,uf_destino,origem_mercadoria,expected", [
    # Sul/Sudeste -> Norte/Nordeste/CO/ES = 7%
    ("SP", "BA", "0", Decimal("0.07")),
    ("RJ", "PE", None, Decimal("0.07")),
    ("PR", "ES", "0", Decimal("0.07")),
    ("RS", "GO", "0", Decimal("0.07")),
    ("MG", "AM", "0", Decimal("0.07")),
    ("SC", "MT", "0", Decimal("0.07")),
    # Sul/Sudeste -> Sul/Sudeste = 12%
    ("SP", "RJ", "0", Decimal("0.12")),
    ("PR", "SP", "0", Decimal("0.12")),
    ("RS", "SC", "0", Decimal("0.12")),
    # N/NE/CO/ES -> Qualquer UF = 12%
    ("BA", "SP", "0", Decimal("0.12")),
    ("PE", "BA", "0", Decimal("0.12")),
    ("GO", "MG", "0", Decimal("0.12")),
    ("AM", "RS", "0", Decimal("0.12")),
    ("ES", "RJ", "0", Decimal("0.12")),
    ("ES", "BA", "0", Decimal("0.12")),
    # Importados (Res. Senado 13/2012: origens 1, 2, 3, 8) = 4%
    ("SP", "BA", "1", Decimal("0.04")),
    ("RJ", "SP", "2", Decimal("0.04")),
    ("BA", "PE", "3", Decimal("0.04")),
    ("MG", "GO", "8", Decimal("0.04")),
    ("PR", "CE", 1, Decimal("0.04")),
])
def test_interstate_rate_resolution(uf_origem, uf_destino, origem_mercadoria, expected):
    rate = InterstateRateResolver.resolve_rate(
        uf_origem=uf_origem,
        uf_destino=uf_destino,
        origem_mercadoria=origem_mercadoria
    )
    assert rate == expected
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_interstate_rate_resolver.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.services.rules_engine.interstate_rate_resolver'`

- [ ] **Step 3: Implement `InterstateRateResolver` in `app/services/rules_engine/interstate_rate_resolver.py`**

Implementar:
- Constantes dos grupos de UF:
  - `SUL_SUDESTE_ORIGEM_7 = {"SP", "RJ", "MG", "PR", "SC", "RS"}` (sem `ES`)
  - `ORIGENS_IMPORTADAS = {"1", "2", "3", "8"}`
- Método `@classmethod resolve_rate(cls, uf_origem: str, uf_destino: str, origem_mercadoria: Optional[Union[str, int]] = None) -> Decimal`:
  - Normalizar UFs em maiúsculas sem espaços.
  - Se `origem_mercadoria` estiver presente e seu primeiro caractere pertencer a `ORIGENS_IMPORTADAS`, retornar `Decimal("0.04")`.
  - Se `uf_origem in SUL_SUDESTE_ORIGEM_7` e `uf_destino not in SUL_SUDESTE_ORIGEM_7`, retornar `Decimal("0.07")`.
  - Caso contrário, retornar `Decimal("0.12")`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_interstate_rate_resolver.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/services/rules_engine/interstate_rate_resolver.py tests/test_interstate_rate_resolver.py
git commit -m "feat(rules_engine): adicionar InterstateRateResolver para alíquotas interestaduais"
```

---

### Task 2: Extração de Origem da Mercadoria e Detecção do Simples Nacional nos Extratores

**Files:**
- Modify: `app/services/extraction/base.py`
- Modify: `app/services/extraction/nfe_xml_extractor.py`
- Modify: `app/services/extraction/sped_fiscal_extractor.py`
- Test: `tests/test_extraction_simples_origem.py`

**Interfaces:**
- Consumes: Dados XML e SPED.
- Produces: `ExtractedItemNF.origem_mercadoria: Optional[str]`, `ExtractedItemNF.csosn: Optional[str]`, `ExtractedNFData.raw_metadata["fornecedor_simples_nacional"]: bool`.

- [ ] **Step 1: Write the failing tests in `tests/test_extraction_simples_origem.py`**

Testar que:
1. XML com `<emit><CRT>1</CRT>` e item `<ICMSSN102><orig>2</orig><CSOSN>102</CSOSN></ICMSSN102>` extrai `origem_mercadoria == "2"`, `csosn == "102"` e `raw_metadata["crt"] == "1"`.
2. SPED com C170 tendo CST/CSOSN `102` extrai `origem_mercadoria == "1"`, `csosn == "102"` e marca `fornecedor_simples_nacional == True`.
3. Propagação de Simples no lote SPED para o mesmo CNPJ quando uma nota possui CSOSN.

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_extraction_simples_origem.py -v`
Expected: FAIL

- [ ] **Step 3: Implement changes in `base.py`, `nfe_xml_extractor.py`, and `sped_fiscal_extractor.py`**

1. Em `app/services/extraction/base.py`:
   - Adicionar em `ExtractedItemNF`:
     ```python
     origem_mercadoria: Optional[str] = None
     csosn: Optional[str] = None
     ```
2. Em `app/services/extraction/nfe_xml_extractor.py`:
   - No loop de `icms_group`, capturar `<orig>` e `<CSOSN>`.
   - Preencher `origem_mercadoria` e `csosn` no `ExtractedItemNF`.
3. Em `app/services/extraction/sped_fiscal_extractor.py`:
   - No registro C170, extrair o campo 10 (`CST_ICMS`).
   - Se possuir 3 dígitos e iniciar com dígitos do Simples (`101`, `102`, `103`, `201`, `202`, `203`, `300`, `400`, `500`, `900`):
     - Marcar item com `csosn` correspondente.
     - Se o código tiver origem embutida ou campo auxiliar, salvar `origem_mercadoria`.
     - Marcar `current_c100["fornecedor_simples"] = True`.
   - Propagar o flag de Simples Nacional para o mesmo `cnpj_emitente` entre todas as notas extraídas no SPED.

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_extraction_simples_origem.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/services/extraction/base.py app/services/extraction/nfe_xml_extractor.py app/services/extraction/sped_fiscal_extractor.py tests/test_extraction_simples_origem.py
git commit -m "feat(extraction): extrair origem da mercadoria e detectar Simples Nacional no XML e SPED"
```

---

### Task 3: Integração no Pipeline Fiscal (Inferência de A.ORI, Auditoria e Cálculos)

**Files:**
- Modify: `app/services/pipeline_service.py`
- Modify: `app/services/pipeline_helpers.py`
- Test: `tests/test_pipeline_simples_aliquota_interestadual.py`

**Interfaces:**
- Consumes: `InterstateRateResolver`, `ExtractedItemNF.origem_mercadoria`, `nf_data.raw_metadata["crt"]` / `fornecedor_simples_nacional`.
- Produces: `a_ori` inferido para cálculo, aviso em `avisos_avaliacao`, metadados `a_ori_inferida_simples: True`, e integração com `DifalCalculator`, `AntecipacaoParcialCalculator` e `AntecipacaoTributariaCalculator`.

- [ ] **Step 1: Write the failing tests in `tests/test_pipeline_simples_aliquota_interestadual.py`**

Testar que:
1. Nota interestadual de fornecedor Simples Nacional (CRT 1, SP -> BA) sem destaque (`a_ori == 0`):
   - Recebe `a_ori == Decimal("0.07")`.
   - Gera aviso em `avisos_avaliacao` informando a inferência de 7% pela tabela interestadual.
   - Metadados gravam `a_ori_inferida_simples == True`.
   - Em Antecipação Parcial, o crédito é calculado com base em 7% (`base * 0.07`).
2. Nota interestadual Simples com produto importado (origem `1`, SP -> BA) sem destaque:
   - Recebe `a_ori == Decimal("0.04")`.
3. Nota interestadual de PE -> BA (Norte/Nordeste) sem destaque:
   - Recebe `a_ori == Decimal("0.12")`.
4. Nota do Simples com destaque explícito (`a_ori == Decimal("0.025")`):
   - Mantém `a_ori == Decimal("0.025")` sem sobrescrever e sem gerar aviso de inferência.
5. Em DIFAL: nota do Simples sem destaque usa `a_ori` inferido de 7% ou 12% no cálculo `base_st * (a_dst - a_ori)`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_pipeline_simples_aliquota_interestadual.py -v`
Expected: FAIL

- [ ] **Step 3: Implement pipeline logic in `app/services/pipeline_service.py`**

No loop de itens da nota (`pipeline_service.py`):
1. Determinar se o fornecedor é Simples Nacional:
   ```python
   crt_emit = (nf_data.raw_metadata.get("crt") or "").strip()
   is_fornecedor_simples = (
       crt_emit in ("1", "2")
       or bool(nf_data.raw_metadata.get("fornecedor_simples_nacional"))
       or any(it.csosn in CSOSNS_SIMPLES for it in nf_data.itens if it.csosn)
   )
   ```
2. Verificar se a operação é interestadual (`uf_fornecedor != uf_empresa_dest`).
3. Para cada item, se `is_fornecedor_simples and item.a_ori == Decimal("0.00")`:
   ```python
   a_ori_inferida = InterstateRateResolver.resolve_rate(
       uf_origem=uf_fornecedor,
       uf_destino=uf_empresa_dest,
       origem_mercadoria=item.origem_mercadoria
   )
   ```
   - Atualizar a alíquota de trabalho do item `a_ori = a_ori_inferida`.
   - Marcar rastreamento no grupo: `a_ori_inferida_simples = True`.
   - Adicionar aviso em `avisos_avaliacao`:
     `f"Item {item.item_numero}: Alíquota interestadual de {a_ori_inferida * 100:.0f}% aplicada automaticamente (fornecedor optante pelo Simples Nacional sem destaque de ICMS na origem {uf_fornecedor} -> {uf_empresa_dest})."`
4. Em metadados extras da `NotaFiscalProcessada`:
   - Gravar `"a_ori_inferida_simples": True` e `"a_ori_original": "0.00"`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_pipeline_simples_aliquota_interestadual.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/services/pipeline_service.py app/services/pipeline_helpers.py tests/test_pipeline_simples_aliquota_interestadual.py
git commit -m "feat(pipeline): aplicar alíquota interestadual para fornecedores do Simples sem destaque"
```

---

### Task 4: Verificação Ponta a Ponta e Validação de Regressão

**Files:**
- Modify: `tests/test_simples_nacional_pipeline.py`
- Modify: `tests/test_difal_template.py`

**Interfaces:**
- Consumes: Todo o pipeline fiscal e gerador de Excel.
- Produces: Testes end-to-end garantindo geração íntegra de planilhas e relatórios para todos os tipos de planilhas.

- [ ] **Step 1: Write integration tests for Antecipação Parcial, ST e DIFAL com Simples Nacional sem destaque**

Adicionar cenários em `tests/test_simples_nacional_pipeline.py`:
1. Cenário completo gerando planilha Excel com notas de Simples Nacional sem destaque de SP para BA.
2. Conferência de que a coluna `A.ORI` na planilha gerada contém `0.07` (7%) formatado.
3. Conferência de que os totais calculados de débito, crédito e valor devido refletem o crédito de 7%.

- [ ] **Step 2: Run all relevant test suites**

Run: `pytest tests/test_interstate_rate_resolver.py tests/test_extraction_simples_origem.py tests/test_pipeline_simples_aliquota_interestadual.py tests/test_simples_nacional_pipeline.py tests/test_difal_template.py -v`
Expected: Todos os testes passam (100% PASS).

- [ ] **Step 3: Run full test suite for regression check**

Run: `pytest`
Expected: Toda a suíte de testes do projeto passando sem quebras.

- [ ] **Step 4: Commit**

```bash
git add tests/test_simples_nacional_pipeline.py tests/test_difal_template.py
git commit -m "test(pipeline): adicionar cobertura e2e para alíquota interestadual Simples Nacional"
```
