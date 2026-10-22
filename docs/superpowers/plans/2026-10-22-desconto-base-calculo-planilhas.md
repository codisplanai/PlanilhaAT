# Desconto Comercial no Valor Total e Base de Cálculo das Planilhas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Garantir que descontos destacados em documentos fiscais (XML NF-e e SPED Fiscal) sejam abatidos tanto do Valor Total quanto da Base de Cálculo nas planilhas de Antecipação Tributária, Antecipação Parcial e DIFAL, em ambos os motores de processamento (frontend/local e backend/Python).

**Architecture:** O processamento fiscal calcula a base econômica líquida do item (`vProd + vFrete + vSeg + vOutro - vDesc`). Quando a fonte fiscal traz uma Base de Cálculo bruta (sem abater o desconto comercial incondicional) ou maior que a base líquida da mercadoria, a base é ajustada deduzindo o desconto; caso o emitente já tenha destacado a base líquida de desconto, o valor é mantido para evitar desconto em duplicidade. A dedução ocorre tanto no nível do item quanto na totalização/desdobramento de grupos nas planilhas.

**Tech Stack:** TypeScript (Frontend SPA, Vitest), Python 3.15 (FastAPI, Pytest, OpenPyXL).

**Spec:** Alinhamento via `/grill-me` em 22/10/2026:
- Quando houver desconto destacado na NF-e (ex: `vProd = 8.268,00`, `vDesc = 992,16`, `vNF = 7.275,84`), tanto `V.TOTAL` quanto `B.CÁLCULO` na planilha devem ser preenchidos com o valor líquido pós-desconto (`7.275,84`).
- Prevenção de duplicidade: se o XML/SPED já trouxe `vBC` líquido, preserva; se trouxe `vBC` bruto ou sem desconto deduzido, abate o desconto.
- Multi-itens: dedução aplicada item a item via `vDesc` para refletir fidedignamente os desdobramentos de alíquota/destino.
- Escopo completo: Antecipação Tributária, Antecipação Parcial, DIFAL, em processamento local e backend.

## Global Constraints

- Nunca deduzir o desconto duas vezes se a tag `vBC` do XML ou do SPED já estiver abatida.
- Não alterar o valor do IPI nem das despesas acessórias; o desconto comercial abate mercadoria e base de cálculo de ICMS.
- Manter compatibilidade com notas sem desconto (`vDesc == 0`), onde o comportamento atual permanece estritamente idêntico.
- Garantir paridade 100% de comportamento e resultados entre o processamento local (TypeScript) e o processamento backend (Python).

## Review Focus

1. **Nota com 1 item com desconto e vBC bruto no XML:** `vProd = 8268.00`, `vDesc = 992.16`, `vNF = 7275.84`, `vBC = 8268.00` -> `v_total = 7275.84` e `base_calculo = 7275.84`.
2. **Nota com vBC já deduzido no XML:** `vProd = 1000.00`, `vDesc = 100.00`, `vNF = 900.00`, `vBC = 900.00` -> `base_calculo = 900.00` (não vira 800.00).
3. **Nota do Simples Nacional ou CST 60 (sem vBC no XML):** `vProd = 5000.00`, `vDesc = 500.00`, `vNF = 4500.00`, `vBC = 0.00` -> `v_total = 4500.00` e `base_calculo = 4500.00`.
4. **Nota com múltiplos itens e desdobramento:** cada grupo/subitem abate exatamente o `vDesc` dos seus itens constitutivos.
5. **SPED Fiscal C100/C170/C190 com desconto e fusão XML+SPED:** a base de cálculo importada ou enriquecida reflete o valor líquido pós-desconto.

---

### Task 1: [Domain & Schemas] Modelagem de campos de desconto no Frontend e Backend

**Files:**
- Modify: `frontend/src/lib/localProcessing/domain.ts:1-45`
- Modify: `app/services/extraction/base.py:15-55`
- Test: `frontend/tests/descontoBaseCalculo.test.ts`
- Test: `tests/test_desconto_base_calculo.py`

**Interfaces:**
- Consumes: Tipos de itens extraídos em TypeScript e dataclasses em Python.
- Produces: `vDesc` em `ExtractedItem` / `vDescNota` em `ExtractedNote`; `v_desc` em `ExtractedItemNF` / `v_desc_nota` em `ExtractedNFData`.

- [ ] **Step 1: Escrever testes unitários iniciais que falham por falta dos campos de desconto estruturados**

```typescript
// frontend/tests/descontoBaseCalculo.test.ts
import { describe, it, expect } from 'vitest';
import { ExtractedItem, ExtractedNote } from '../src/lib/localProcessing/domain';

describe('Tipagem de Desconto no Domínio', () => {
  it('permite armazenar vDesc no item e vDescNota na nota', () => {
    const item: Partial<ExtractedItem> = { vItem: 8268, vDesc: 992.16 };
    expect(item.vDesc).toBe(992.16);
  });
});
```

```python
# tests/test_desconto_base_calculo.py
from decimal import Decimal
from app.services.extraction.base import ExtractedItemNF, ExtractedNFData

def test_dataclasses_suportam_v_desc():
    item = ExtractedItemNF(
        item_numero=1, ncm="12345678", cest="", cfop="6102",
        descricao="Teste", v_item=Decimal("8268.00"), v_total=Decimal("7275.84"),
        base_calculo=Decimal("7275.84"), ipi_despesas=Decimal("0.00"),
        a_ori=Decimal("0.12"), p_cred_sn=Decimal("0.00"), v_icms=Decimal("873.10"),
        v_desc=Decimal("992.16")
    )
    assert item.v_desc == Decimal("992.16")
```

- [ ] **Step 2: Executar testes para verificar a falha**

Run: `npm --prefix frontend test -- frontend/tests/descontoBaseCalculo.test.ts --run` e `pytest tests/test_desconto_base_calculo.py -v`
Expected: FAIL (campos `vDesc` ou `v_desc` não reconhecidos).

- [ ] **Step 3: Implementar campos nas interfaces TypeScript e dataclasses Python**

Adicionar `vDesc?: number` em `ExtractedItem` e `vDescNota?: number` em `ExtractedNote` (`domain.ts`).
Adicionar `v_desc: Decimal = Decimal("0.00")` em `ExtractedItemNF` e `v_desc_nota: Decimal = Decimal("0.00")` em `ExtractedNFData` (`base.py`).

- [ ] **Step 4: Executar testes para verificar que passam**

Run: `npm --prefix frontend test -- frontend/tests/descontoBaseCalculo.test.ts --run` e `pytest tests/test_desconto_base_calculo.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/localProcessing/domain.ts app/services/extraction/base.py frontend/tests/descontoBaseCalculo.test.ts tests/test_desconto_base_calculo.py
git commit -m "feat(domain): adicionar campos de desconto vDesc nos modelos de extracao frontend e backend"
```

---

### Task 2: [Frontend Local Processing] Ajuste de Base de Cálculo com Desconto na Extração XML e SPED

**Files:**
- Modify: `frontend/src/lib/localProcessing/xml.ts:115-185`
- Modify: `frontend/src/lib/localProcessing/sped.ts:120-305`
- Modify: `frontend/src/lib/localProcessing/sources.ts:30-65`
- Test: `frontend/tests/descontoBaseCalculo.test.ts`

**Interfaces:**
- Consumes: XML DOM NFe (`vProd`, `vDesc`, `vBC`, `vNF`) e registros SPED (C100, C170, C190).
- Produces: `ExtractedNote` e `ExtractedItem` com `baseCalculo` líquido de desconto quando a fonte informar base bruta.

- [ ] **Step 1: Escrever testes unitários que cobrem a dedução na extração XML e SPED**

```typescript
// frontend/tests/descontoBaseCalculo.test.ts
import { parseNfeXml } from '../src/lib/localProcessing/xml';

describe('Extração XML com Desconto', () => {
  it('ajusta baseCalculo para valor líquido quando XML traz vBC bruto com desconto', () => {
    const xml = `
      <NFe xmlns="http://www.portalfiscal.inf.br/nfe">
        <infNFe Id="NFe35260000000000000000550010000012341000012345">
          <ide><nNF>1234</nNF><serie>1</serie><dhEmi>2026-04-10T10:00:00-03:00</dhEmi></ide>
          <emit><CNPJ>11111111000191</CNPJ><CRT>3</CRT><enderEmit><UF>SP</UF></enderEmit></emit>
          <dest><CNPJ>22222222000192</dest><enderDest><UF>BA</UF></enderDest></dest>
          <total><ICMSTot><vBC>8268.00</vBC><vICMS>992.16</vICMS><vProd>8268.00</vProd><vDesc>992.16</vDesc><vNF>7275.84</vNF></ICMSTot></total>
          <det nItem="1">
            <prod><cProd>1</cProd><xProd>MERCADORIA</xProd><NCM>84189900</NCM><CFOP>6102</CFOP><vProd>8268.00</vProd><vDesc>992.16</vDesc></prod>
            <imposto><ICMS><ICMS00><orig>0</orig><CST>00</CST><vBC>8268.00</vBC><pICMS>12.00</pICMS><vICMS>992.16</vICMS></ICMS00></imposto></det>
        </infNFe>
      </NFe>`;
    const note = parseNfeXml(xml, 'teste.xml');
    expect(note.vTotalNota).toBe(7275.84);
    expect(note.vDescNota).toBe(992.16);
    expect(note.itens[0].vTotal).toBe(7275.84);
    expect(note.itens[0].baseCalculo).toBe(7275.84);
  });

  it('não reduz em duplicidade se o XML já enviou vBC líquido com o desconto abatido', () => {
    const xml = `
      <NFe xmlns="http://www.portalfiscal.inf.br/nfe">
        <infNFe Id="NFe35260000000000000000550010000012341000012346">
          <ide><nNF>1235</nNF><serie>1</serie><dhEmi>2026-04-10T10:00:00-03:00</dhEmi></ide>
          <emit><CNPJ>11111111000191</CNPJ><CRT>3</CRT><enderEmit><UF>SP</UF></enderEmit></emit>
          <dest><CNPJ>22222222000192</dest><enderDest><UF>BA</UF></enderDest></dest>
          <total><ICMSTot><vBC>900.00</vBC><vICMS>108.00</vICMS><vProd>1000.00</vProd><vDesc>100.00</vDesc><vNF>900.00</vNF></ICMSTot></total>
          <det nItem="1">
            <prod><cProd>1</cProd><xProd>MERCADORIA</xProd><NCM>84189900</NCM><CFOP>6102</CFOP><vProd>1000.00</vProd><vDesc>100.00</vDesc></prod>
            <imposto><ICMS><ICMS00><orig>0</orig><CST>00</CST><vBC>900.00</vBC><pICMS>12.00</pICMS><vICMS>108.00</vICMS></ICMS00></imposto></det>
        </infNFe>
      </NFe>`;
    const note = parseNfeXml(xml, 'teste_ja_liquido.xml');
    expect(note.itens[0].baseCalculo).toBe(900.00);
  });
});
```

- [ ] **Step 2: Executar testes para verificar que falham**

Run: `npm --prefix frontend test -- frontend/tests/descontoBaseCalculo.test.ts --run`
Expected: FAIL (o primeiro teste espera `baseCalculo: 7275.84`, mas recebe `8268.00`).

- [ ] **Step 3: Implementar ajuste de desconto em `xml.ts`, `sped.ts` e `sources.ts`**

Em `xml.ts`:
- Extrair `vDescNota = number(icmsTot, 'vDesc')`.
- No item: calcular `baseSemIpi = Math.max(0, vProd + vDespesas - vDesc)`.
- Se `baseCalculo > baseSemIpi` e `vDesc > 0`, ajustar `baseCalculo = Math.max(0, baseCalculo - vDesc)`.
- Em nota de 1 item com `vBcNota`: se `vDescNota > 0 && vBcNota > (vTotalNota - itens[0].ipiDespesas)`, ajustar `itens[0].baseCalculo = Math.max(0, vBcNota - vDescNota)`.
- Preencher `vDesc` no item e `vDescNota` na nota.

Em `sped.ts`:
- Extrair `vDesc` de C100 e C170; ajustar `baseCalculo` caso exceda `vTotal - vIpi` na presença de desconto.

Em `sources.ts`:
- Propagar `vDescNota` e `vDesc` durante a união de fontes.

- [ ] **Step 4: Executar testes para verificar que passam**

Run: `npm --prefix frontend test -- frontend/tests/descontoBaseCalculo.test.ts --run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/localProcessing/xml.ts frontend/src/lib/localProcessing/sped.ts frontend/src/lib/localProcessing/sources.ts frontend/tests/descontoBaseCalculo.test.ts
git commit -m "fix(local-processing): ajustar baseCalculo deduzindo desconto na extracao xml e sped"
```

---

### Task 3: [Frontend Processor] Totalização e Mapeamento para Planilhas no Processamento Local

**Files:**
- Modify: `frontend/src/lib/localProcessing/processor.ts:675-760`
- Test: `frontend/tests/descontoBaseCalculo.test.ts`

**Interfaces:**
- Consumes: Itens agrupados por destino/alíquotas com bases ajustadas.
- Produces: `processed` rows contendo `v_total` e `base_calculo` ambos líquidos de desconto para preenchimento de `V.TOTAL` e `B.CÁLCULO`.

- [ ] **Step 1: Escrever teste de processamento local completo para geração de linhas com desconto**

```typescript
// Adicionar em frontend/tests/descontoBaseCalculo.test.ts
import { processLocalFiles } from '../src/lib/localProcessing/processor';
// Testar que processLocalFiles com a nota de R$ 8.268,00 e desconto R$ 992,16
// gera linha com v_total = 7275.84 e base_calculo = 7275.84 tanto em Antecipação Tributária quanto Parcial e DIFAL.
```

- [ ] **Step 2: Executar teste para verificar falha ou validação de agrupamento**

Run: `npm --prefix frontend test -- frontend/tests/descontoBaseCalculo.test.ts --run`
Expected: FAIL se `processor.ts` reatribuir `note.vBcNota` bruto em `base`.

- [ ] **Step 3: Ajustar cálculo de base de grupo em `processor.ts`**

Em `processor.ts`:
- Quando `useNoteTotal && note.vBcNota > 0`: verificar se `note.vBcNota > (vTotal - ipi)` e `(note.vDescNota ?? 0) > 0`. Se for, abater `note.vDescNota` ou limitar a `vTotal - ipi`.
- Quando agrupar itens somados: `group.items.reduce((sum, item) => sum + item.baseCalculo, 0)` já virá com cada item líquido.

- [ ] **Step 4: Executar suite de testes do frontend para garantir regressão zero**

Run: `npm --prefix frontend test -- --run`
Expected: PASS (todos os 118+ testes passando).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/localProcessing/processor.ts frontend/tests/descontoBaseCalculo.test.ts
git commit -m "fix(processor): garantir que base_calculo em useNoteTotal e agrupamentos abata desconto comercial"
```

---

### Task 4: [Backend Extraction] Ajuste de Base de Cálculo com Desconto em Python

**Files:**
- Modify: `app/services/extraction/nfe_xml_extractor.py:155-275`
- Modify: `app/services/extraction/sped_fiscal_extractor.py:110-170,380-440`
- Modify: `app/services/pipeline_helpers.py:55-115`
- Test: `tests/test_desconto_base_calculo.py`

**Interfaces:**
- Consumes: Elementos XML `prod/vDesc`, `ICMSTot/vDesc`, `ICMS/vBC` e linhas SPED.
- Produces: `ExtractedNFData` com `v_desc_nota` e `ExtractedItemNF` com `base_calculo` líquido de desconto.

- [ ] **Step 1: Escrever testes unitários em pytest para extração XML no backend**

```python
# Adicionar em tests/test_desconto_base_calculo.py
from decimal import Decimal
from app.services.extraction.nfe_xml_extractor import NFeXMLExtractor

def test_xml_extractor_abate_desconto_quando_vbc_vem_bruto():
    xml_content = b"""<NFe xmlns="http://www.portalfiscal.inf.br/nfe">
      <infNFe Id="NFe35260000000000000000550010000012341000012345">
        <ide><nNF>1234</nNF><serie>1</serie><dhEmi>2026-04-10T10:00:00-03:00</dhEmi></ide>
        <emit><CNPJ>11111111000191</CNPJ><CRT>3</CRT><enderEmit><UF>SP</UF></enderEmit></emit>
        <dest><CNPJ>22222222000192</dest><enderDest><UF>BA</UF></enderDest></dest>
        <total><ICMSTot><vBC>8268.00</vBC><vICMS>992.16</vICMS><vProd>8268.00</vProd><vDesc>992.16</vDesc><vNF>7275.84</vNF></ICMSTot></total>
        <det nItem="1">
          <prod><cProd>1</cProd><xProd>MERCADORIA</xProd><NCM>84189900</NCM><CFOP>6102</CFOP><vProd>8268.00</vProd><vDesc>992.16</vDesc></prod>
          <imposto><ICMS><ICMS00><orig>0</orig><CST>00</CST><vBC>8268.00</vBC><pICMS>12.00</pICMS><vICMS>992.16</vICMS></ICMS00></imposto></det>
      </infNFe>
    </NFe>"""
    extractor = NFeXMLExtractor()
    data = extractor.extract(xml_content, "nota.xml")
    assert data.v_total_nota == Decimal("7275.84")
    assert data.v_desc_nota == Decimal("992.16")
    assert data.itens[0].v_total == Decimal("7275.84")
    assert data.itens[0].base_calculo == Decimal("7275.84")

def test_xml_extractor_preserva_vbc_quando_ja_veio_liquido():
    xml_content = b"""<NFe xmlns="http://www.portalfiscal.inf.br/nfe">
      <infNFe Id="NFe35260000000000000000550010000012341000012346">
        <ide><nNF>1235</nNF><serie>1</serie><dhEmi>2026-04-10T10:00:00-03:00</dhEmi></ide>
        <emit><CNPJ>11111111000191</CNPJ><CRT>3</CRT><enderEmit><UF>SP</UF></enderEmit></emit>
        <dest><CNPJ>22222222000192</dest><enderDest><UF>BA</UF></enderDest></dest>
        <total><ICMSTot><vBC>900.00</vBC><vICMS>108.00</vICMS><vProd>1000.00</vProd><vDesc>100.00</vDesc><vNF>900.00</vNF></ICMSTot></total>
        <det nItem="1">
          <prod><cProd>1</cProd><xProd>MERCADORIA</xProd><NCM>84189900</NCM><CFOP>6102</CFOP><vProd>1000.00</vProd><vDesc>100.00</vDesc></prod>
          <imposto><ICMS><ICMS00><orig>0</orig><CST>00</CST><vBC>900.00</vBC><pICMS>12.00</pICMS><vICMS>108.00</vICMS></ICMS00></imposto></det>
      </infNFe>
    </NFe>"""
    extractor = NFeXMLExtractor()
    data = extractor.extract(xml_content, "nota_liquida.xml")
    assert data.itens[0].base_calculo == Decimal("900.00")
```

- [ ] **Step 2: Executar testes para verificar a falha**

Run: `pytest tests/test_desconto_base_calculo.py -v`
Expected: FAIL (retorna 8268.00 no primeiro teste).

- [ ] **Step 3: Implementar dedução de desconto na extração backend**

Em `nfe_xml_extractor.py`:
- Extrair `v_desc_nota = self._get_decimal(icms_tot, "vDesc")`.
- Para cada item: se `v_bc_item > (v_prod + v_despesas - v_desc)` e `v_desc > 0`, ajustar `v_bc_item = max(Decimal("0.00"), v_bc_item - v_desc)`.
- Se 1 item: ajustar `itens[0].base_calculo` deduzindo `v_desc_nota` se `v_bc_nota > (v_total_nota - itens[0].ipi_despesas)`.
- Preencher `v_desc` em `ExtractedItemNF` e `v_desc_nota` em `ExtractedNFData`.

Em `pipeline_helpers.py` e `sped_fiscal_extractor.py`:
- Propagar `v_desc_nota` e `v_desc` no enriquecimento e ajustar bases brutas do SPED quando houver desconto.

- [ ] **Step 4: Executar testes para verificar que passam**

Run: `pytest tests/test_desconto_base_calculo.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/services/extraction/nfe_xml_extractor.py app/services/extraction/sped_fiscal_extractor.py app/services/pipeline_helpers.py tests/test_desconto_base_calculo.py
git commit -m "fix(extraction): abater desconto comercial da base_calculo na extracao backend"
```

---

### Task 5: [Backend Pipeline Service] Agrupamento e Preenchimento de Planilhas no Pipeline

**Files:**
- Modify: `app/services/pipeline_service.py:645-670`
- Test: `tests/test_desconto_base_calculo.py`

**Interfaces:**
- Consumes: Grupos de notas com bases líquidas.
- Produces: Linhas para templates Excel com `v_total` e `base_calculo` ambos líquidos de desconto.

- [ ] **Step 1: Escrever teste de pipeline para preenchimento de planilha com desconto**

```python
# Adicionar em tests/test_desconto_base_calculo.py
def test_pipeline_preenche_v_total_e_base_calculo_liquidos(tmp_path):
    # Executa o pipeline com uma NF-e que possui desconto e verifica que na linha gerada
    # para a planilha o v_total == 7275.84 e base_calculo == 7275.84.
```

- [ ] **Step 2: Executar teste para verificar falha ou necessidade de ajuste no pipeline**

Run: `pytest tests/test_desconto_base_calculo.py::test_pipeline_preenche_v_total_e_base_calculo_liquidos -v`
Expected: FAIL se `pipeline_service.py` reatribuir `v_bc_nota` bruto quando `usar_total_nota` for True.

- [ ] **Step 3: Ajustar `pipeline_service.py` linhas 648-660**

Em `pipeline_service.py`:
- Quando `usar_total_nota`:
  Se `nf_data.v_bc_nota > 0`:
    `base_maxima = v_total_grupo - ipi_despesas_grupo`
    Se `nf_data.v_desc_nota > 0 and nf_data.v_bc_nota > base_maxima`:
      `v_bc_grupo = max(Decimal("0.00"), nf_data.v_bc_nota - nf_data.v_desc_nota)`
    Senão:
      `v_bc_grupo = nf_data.v_bc_nota`
  Senão:
    `v_bc_grupo = sum(it.base_calculo for it in itens_objs)`

- [ ] **Step 4: Executar testes de pipeline para verificar aprovação**

Run: `pytest tests/test_desconto_base_calculo.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/services/pipeline_service.py tests/test_desconto_base_calculo.py
git commit -m "fix(pipeline): abater desconto comercial de v_bc_grupo em usar_total_nota"
```

---

### Task 6: [E2E & Regressão] Verificação de Ponta a Ponta e Suite de Regressão

**Files:**
- Test: `frontend/tests/descontoBaseCalculo.test.ts`
- Test: `tests/test_desconto_base_calculo.py`

**Interfaces:**
- Consumes: Todos os cenários (Antecipação Tributária, Antecipação Parcial, DIFAL, Simples Nacional, multi-itens desdobrados).
- Produces: Validação completa sem regressões em nenhum módulo fiscal existente.

- [ ] **Step 1: Escrever testes cobrindo múltiplos itens, desdobramentos e Simples Nacional com desconto**

Testar cenários de borda:
1. Dois itens: Item 1 com desconto, Item 2 sem desconto, desdobrados para destinos diferentes.
2. Nota de fornecedor do Simples Nacional com desconto destacado na tag `vDesc`.
3. Preenchimento real de template XLSX (Antecipação Tributária e Antecipação Parcial) conferindo colunas E (`V.TOTAL`) e F (`B.CÁLCULO`).

- [ ] **Step 2: Executar todos os testes do backend**

Run: `pytest -v`
Expected: Todos os testes existentes do backend passam sem falhas.

- [ ] **Step 3: Executar todos os testes do frontend**

Run: `npm --prefix frontend test -- --run`
Expected: Todos os 118+ testes do frontend passam sem falhas.

- [ ] **Step 4: Commit**

```bash
git add frontend/tests/descontoBaseCalculo.test.ts tests/test_desconto_base_calculo.py
git commit -m "test: adicionar testes e2e e cenarios de borda para desconto comercial em planilhas"
```
