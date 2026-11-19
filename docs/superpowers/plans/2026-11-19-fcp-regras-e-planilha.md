# FCP (Fundo de Combate à Pobreza) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar cadastro dedicado de FCP no Perfil de Regras (com preset opcional Bebidas BA e prefixos em Exceções por NCM), apuração de FCP com paridade nos motores Python e TypeScript (incluindo CT-e), geração de segunda aba `{MM}-{AAAA} FCP` na Antecipação Tributária de Regime Normal e exibição dos totais separados na UI.

**Architecture:** Espelha o padrão já existente de `RegraReducaoProduto` com tabelas dedicadas (`regras_fcp_produto` + `excecoes_fcp_produto`), mantém rastreabilidade sem alterar schema de `notas_fiscais_processadas`/`solicitacoes_saidas` via `metadados_extras`, e entrega paridade completa entre o pipeline servidor Python (`app/services/`) e o motor local no navegador (`frontend/src/lib/localProcessing/`). Na Antecipação Tributária de Regime Normal, o Excel clona a aba do template RP-151 antes do preenchimento para criar `{MM}-{AAAA} FCP` preservando fórmulas e logos.

**Tech Stack:** Python 3.12, FastAPI, SQLAlchemy, Alembic, openpyxl, pytest; React 19, TypeScript 6, TanStack Query, Zod, OOXML/ZIP nativo, `node --experimental-strip-types --test`, oxlint, Vite.

**Spec:** [2026-11-19-fcp-regras-e-planilha-design.md](file:///c:/Users/Rodrigo/.antigravity-ide/Planilha%20AT/docs/superpowers/specs/2026-11-19-fcp-regras-e-planilha-design.md)

## Global Constraints

- Migração Alembic: `alembic/versions/028_regras_fcp_produto.py`, `revision = "028_regras_fcp_produto"` (`<= 32` chars), `down_revision = "027_template_empresa_id"`, idempotente verificando tabelas/índices antes de criar.
- Tabelas novas: `regras_fcp_produto` (`uf` `String(2)` default `'BA'`, `ncm` `String(8)` 4–8 dígitos, `termos_inclusao` JSON, `termos_exclusao` JSON, `aliquota` `Numeric(6, 4)` com check `aliquota > 0 AND aliquota <= 1`, `aplicar_com_termo_acordo` `Boolean` default `True`, `descricao` `String(255)`, índice `ix_fcp_perfil_uf_ncm`) e `excecoes_fcp_produto` (`regra_fcp_id`, `descricao_exata` normalizada via `normalizar()`, `enquadrado` `Boolean`, `observacao` `String(255)`, unique `uq_excecao_fcp_regra_descricao`).
- Sem alterar schema de `notas_fiscais_processadas` nem `solicitacoes_saidas`; chaves exatas em `metadados_extras`: `a_dst_base`, `fcp_aliquota`, `fcp_origem` (`"fcp_produto:<id>"` | `"excecao_fcp:<id>"`), `fcp_detalhe`, `fcp_separado` (`bool`), `fcp_base_st`, `fcp_valor_devido` (e para CT-e: `fcp_cte_v_total`, `fcp_cte_mva`, `fcp_cte_reducao`, `fcp_percentual_rateio`, `fcp_parcelas`).
- `regras_aliquotas_destino.ncm` (já `String(8)`): aceitar `None` ou prefixo 4–8 dígitos não zerado; nível 3a casa maior `len(ncm)` com fallback para padrão UF.
- Roteamento automático por regime (sem switch): AT e AT-Antecipado Regime Normal → aba `{MM}-{AAAA} FCP` no mesmo `.xlsx` (`A.DST = % FCP`, `A.ORI = 0%`, `VR.PG. = 0`, mesma Base ST com MVA/Redução; aba omitida se 0 linhas FCP); AT/AT-Antecipado Simples Nacional, Antecipação Parcial (4 variantes) e DIFAL (2 variantes) → soma `% FCP` direto em `A.DST`.
- Precedência com Termo de Acordo: se `empresa.termo_acordo` ativo e regra tem `aplicar_com_termo_acordo = False`, ignora a regra de FCP; caso contrário aplica por cima da `A.DST` resolvida.
- Não alterar `apenas_padrao_uf=True` do DIFAL para base ICMS; não criar novo tipo em `TIPOS_PLANILHA`; não implementar vigência.
- Preset Bebidas BA (`POST /api/v1/regras-fcp/preset-bebidas-ba?perfil_regras_id=`): idempotente, insere exatamente as 8 regras FCP `0.0200` UF `BA` (`2203`, `2204`, `2205`, `2206`, `2208`, `22029100`, `22021000` com inclusão/exclusão da spec, `22029900` com inclusão/exclusão da spec) e 5 exceções base `0.2500` UF `BA` (`2203`, `2204`, `2205`, `2206`, `2208`).
- `SolicitacaoSaida.total_valor_devido` mantém apenas ICMS AT (nunca soma FCP separado).
- Paridade estrita entre Python (`app/services/`) e TypeScript (`frontend/src/lib/localProcessing/`).

## Review Focus

1. **Template RP-151 oficial com linhas de exemplo pré-preenchidas** (`storage/templates/modelo_padrao_antecipacao_tributaria.xlsx` tem dados nas linhas 4–6): ao gerar aba principal ou aba `{MM}-{AAAA} FCP` com menos linhas que os exemplos, células mapeadas residuais (exceto `item_index` e fórmulas) precisam ser limpas para não poluir `=SUM(...)`. → `test_aba_fcp_limpa_linhas_exemplo_residuais_do_template` (Task 4) e `fillTemplateLocally limpa linhas residuais na aba principal e na aba FCP` (Task 6).
2. **NF-e mista na AT Regime Normal com mesma alíquota base** (ex.: refrigerante `20,5% + 2% FCP` e água mineral `20,5%` sem FCP): sem `fcp_separado` na `GrupoKey`/`groupKey`, os dois itens se fundiriam e inflariam a Base ST na aba FCP (quebrando também `regenerate`). → `test_at_regime_normal_nfe_mista_mesma_aliquota_base_separa_grupos` (Task 5) e `AT Regime Normal separa grupos de mesma aliquota base quando apenas um item tem FCP` (Task 7).
3. **Grupo AT Regime Normal excluído por ICMS ST destacado cobrir o imposto (`valorDevido <= 0`)**: não pode vazar linha órfã na aba `{MM}-{AAAA} FCP` nem somar FCP na UI. → `AT Regime Normal excluida por ST pago nao gera aba FCP` (Task 7).
4. **SPED consolidado sem C170 (`descricao_confiavel = False`)**: regra genérica de NCM sem termos (ex.: `2203`) deve aplicar FCP 2%, enquanto regra condicionada a termos de inclusão (`22021000`) não pode casar sem descrição confiável. → `test_fcp_sem_descricao_confiavel_casa_generica_mas_nao_regra_com_termos` (Task 3) e `resolveFcp sem descricao confiavel casa regra generica e ignora regra com termos` (Task 6).
5. **Preencher Datas de Entrada em planilha AT já gerada com 2 abas (`04-2026` + `04-2026 FCP`)**: atualizar apenas a primeira aba deixaria datas faltando ou fora de ordem na aba FCP. → `fillAndReorderEntryDatesInXlsx sincroniza aba principal e aba FCP` (Task 7).

---

### Task 1: Modelo de dados, Migração `028_regras_fcp_produto` e prefixos em Exceções por NCM

**Files:**
- Create: `app/models/regra_fcp_produto.py`
- Create: `alembic/versions/028_regras_fcp_produto.py`
- Modify: `app/models/perfil_regras.py:17-28`
- Modify: `app/models/__init__.py:1-33`
- Modify: `app/schemas/validators.py:12-45`
- Modify: `app/schemas/regra_aliquota.py:1-64`
- Test: `tests/test_fcp_schema_e_prefixo.py`

**Interfaces:**
- Consumes: `Base` (`app/core/database.py`), `utcnow_naive` (`app/core/time.py`), `clean_ncm_prefixo_obrigatorio` (`app/schemas/validators.py`).
- Produces: `RegraFcpProduto`, `ExcecaoFcpProduto`, `PerfilRegras.regras_fcp_produto`, `clean_ncm_prefixo_opcional(v: Optional[str]) -> Optional[str]`, migração `028_regras_fcp_produto` (`down_revision = "027_template_empresa_id"`).

- [ ] **Step 1: Write the failing tests** em `tests/test_fcp_schema_e_prefixo.py`:
  - `test_migration_028_upgrade_e_downgrade`: executa `alembic upgrade head` e `downgrade 027_template_empresa_id` em SQLite temporário (`tmp_path`), verificando criação/remoção das tabelas `regras_fcp_produto` e `excecoes_fcp_produto` e do índice `ix_fcp_perfil_uf_ncm`.
  - `test_constraints_regras_e_excecoes_fcp`: em `db_session`, `RegraFcpProduto` rejeita `aliquota=Decimal("0")` (`ck_fcp_aliquota_intervalo`), rejeita `uf="ba"` (`ck_fcp_uf`), e `ExcecaoFcpProduto` rejeita segunda exceção com mesmo `(regra_fcp_id, descricao_exata)` (`uq_excecao_fcp_regra_descricao`).
  - `test_api_regras_aliquotas_aceita_prefixo_4_a_8_digitos_e_rejeita_invalido`: via `client`, `POST /api/v1/regras-aliquotas` aceita `ncm="2203"` (201), `ncm="2202.91"` → `"220291"` (201), `ncm="22029100"` (201), `ncm=None` (201) e rejeita `"220"` e `"00000000"` com 422.
- [ ] **Step 2: Run** `.\.venv\Scripts\pytest tests/test_fcp_schema_e_prefixo.py -v`. Expected: FAIL (`ImportError: No module named 'app.models.regra_fcp_produto'` / 422 para `"2203"`).
- [ ] **Step 3: Implement** modelos, migração `028_regras_fcp_produto.py` (usando `sa.inspect(bind)` para idempotência), `clean_ncm_prefixo_opcional(v: Optional[str]) -> Optional[str]` em `app/schemas/validators.py` e ligação em `app/schemas/regra_aliquota.py`, `app/models/perfil_regras.py` e `app/models/__init__.py`.
- [ ] **Step 4: Run** `.\.venv\Scripts\pytest tests/test_fcp_schema_e_prefixo.py -v` e `.\.venv\Scripts\pytest tests/test_schema_lifecycle.py -v`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(fcp): adicionar modelo, migracao 028 e prefixos de NCM em aliquotas`.

---

### Task 2: API `/api/v1/regras-fcp`, Preset Bebidas BA, Cópia entre perfis e Contexto Local

**Files:**
- Create: `app/schemas/regra_fcp_produto.py`
- Create: `app/api/endpoints/regras_fcp.py`
- Modify: `app/api/router.py:1-41`
- Modify: `app/services/copia_regras.py:1-50`
- Modify: `app/schemas/perfil_regras.py:282-295`
- Modify: `app/schemas/local_processing.py:118-220`
- Modify: `app/api/endpoints/processamento_local.py:19-317`
- Test: `tests/test_regras_fcp_api.py`

**Interfaces:**
- Consumes: Task 1 (`RegraFcpProduto`, `ExcecaoFcpProduto`, `PerfilRegras.regras_fcp_produto`) e `app/schemas/validators.py` (`clean_ncm_prefixo_obrigatorio`, `normalizar_aliquota`, `normalizar_termos`, `clean_uf`).
- Produces:
  - Router `/api/v1/regras-fcp` (`GET`, `GET /{id}`, `POST`, `PUT /{id}`, `DELETE /{id}`, `POST /{id}/excecoes`, `DELETE /{id}/excecoes/{excecao_id}`, `POST /preset-bebidas-ba?perfil_regras_id=`).
  - `PRESET_BEBIDAS_BA_FCP` (8 itens exatos da spec) e `PRESET_BEBIDAS_BA_ALIQUOTAS` (5 itens `2203`, `2204`, `2205`, `2206`, `2208` a `0.2500`).
  - Seção `"fcp"` em `SECOES` (`app/services/copia_regras.py`) com chave `lambda r: (r.uf, r.ncm, _termos(r.termos_inclusao))`, e `"fcp"` aceita em `PerfilRegrasCopiarRegras.validate_secao`.
  - `LocalExcecaoFcpOut`, `LocalRegraFcpOut` e `LocalProcessingContextOut.regras_fcp: List[LocalRegraFcpOut]`.

- [ ] **Step 1: Write the failing tests** em `tests/test_regras_fcp_api.py`:
  - `test_crud_regra_fcp_e_conflito_literal`: `POST /api/v1/regras-fcp` normaliza `uf="ba"` → `"BA"`, `aliquota=2` → `0.02`, `termos_inclusao`/`termos_exclusao`; segundo POST com mesmo `(perfil, uf, ncm, sorted(termos_inclusao))` retorna 409; `aliquota=0` retorna 422; `GET ?perfil_id=`, `PUT /{id}` e `DELETE /{id}` funcionam; sem token retorna 401.
  - `test_excecoes_fcp_crud_e_duplicata`: `POST /api/v1/regras-fcp/{id}/excecoes` normaliza `descricao_exata`, segundo POST com mesma descrição retorna 409, `DELETE` com `regra_id` errado retorna 404 e correto retorna 204.
  - `test_preset_bebidas_ba_idempotente`: 1ª chamada `POST /api/v1/regras-fcp/preset-bebidas-ba?perfil_regras_id={id}` retorna `{"fcp_criadas": 8, "fcp_ignoradas": 0, "aliquotas_criadas": 5, "aliquotas_ignoradas": 0}` e cria os NCMs/termos exatos da spec; 2ª chamada retorna `{"fcp_criadas": 0, "fcp_ignoradas": 8, "aliquotas_criadas": 0, "aliquotas_ignoradas": 5}`.
  - `test_copiar_e_duplicar_regras_fcp_com_excecoes`: `POST /api/v1/perfis-regras/{id}/copiar-regras` com `secao="fcp"` clona regras + exceções para outro perfil ignorando já existentes; `POST /api/v1/perfis-regras/{id}/duplicar` preserva `regras_fcp_produto` e suas exceções.
  - `test_contexto_processamento_local_expoe_regras_fcp`: `GET /api/v1/processamento-local/contexto?empresa_id={id}` retorna `regras_fcp` com `uf`, `ncm`, `aliquota`, `aplicar_com_termo_acordo`, `termos_inclusao`, `termos_exclusao` e `excecoes`.
- [ ] **Step 2: Run** `.\.venv\Scripts\pytest tests/test_regras_fcp_api.py -v`. Expected: FAIL (404 Not Found).
- [ ] **Step 3: Implement** schemas, endpoints, registro em `router.py`, `SECOES["fcp"]` em `copia_regras.py`, validação `"fcp"` em `perfil_regras.py` e exposição em `local_processing.py` + `processamento_local.py`.
- [ ] **Step 4: Run** `.\.venv\Scripts\pytest tests/test_regras_fcp_api.py tests/test_copiar_regras_perfis.py tests/test_duplicar_perfil.py -v`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(fcp): adicionar API regras-fcp, preset Bebidas BA, copia e contexto local`.

---

### Task 3: Motor de Regras Python (`AliquotaResolver` — prefixo NCM nível 3a + `resolve_fcp`)

**Files:**
- Modify: `app/services/rules_engine/aliquota_resolver.py:1-509`
- Test: `tests/test_fcp_resolver.py`

**Interfaces:**
- Consumes: Task 1 (`RegraFcpProduto`, `ExcecaoFcpProduto`).
- Produces:
  - `AliquotaResolver.preload(self, perfil_regras_id: int, empresa_id: Optional[int] = None) -> None` carregando também `self._fcp_perfil: Optional[List[RegraFcpProduto]]` (com `selectinload(RegraFcpProduto.excecoes)`).
  - `AliquotaResolver._nivel_padrao(...)` selecionando `RegraAliquotaDestino` por maior `len(regra.ncm)` onde `clean_ncm.startswith(regra.ncm)`, mantendo fallback para padrão da UF.
  - `AliquotaResolver.resolve_fcp(self, perfil_regras_id: int, uf: str, ncm: Optional[str] = None, descricao: Optional[str] = None, empresa_tem_termo_acordo: bool = False) -> Optional[ResolucaoAliquota]`.

- [ ] **Step 1: Write the failing tests** em `tests/test_fcp_resolver.py`:
  - `test_nivel_padrao_casa_prefixo_ncm_mais_especifico`: com padrão BA `20,5%`, regra `2203` (`25%`) e regra `22030000` (`27%`), `resolve_a_dst` para `22030000` retorna `0.27`, para `22039900` retorna `0.25` e para `22011000` retorna `0.205`.
  - `test_fcp_precedencia_excecao_termos_generica_e_filtro_uf`: exceção `enquadrado=False` bloqueia regra mesmo casando termos; exceção `enquadrado=True` aplica `origem="excecao_fcp:<id>"`; termos de inclusão/exclusão respeitam `22021000` (refrigerante casa, água mineral excluída); regra de `SE` não casa empresa da `BA`.
  - `test_fcp_sem_descricao_confiavel_casa_generica_mas_nao_regra_com_termos`: `descricao=None` para NCM `22030000` (regra genérica `2203`) retorna `0.02`; `descricao=None` para NCM `22021000` (regra apenas com `termos_inclusao`) retorna `None`.
  - `test_fcp_respeita_aplicar_com_termo_acordo`: com `aplicar_com_termo_acordo=False`, `empresa_tem_termo_acordo=True` retorna `None` e `False` retorna `0.02`; com `aplicar_com_termo_acordo=True`, ambos retornam `0.02`.
  - `test_fcp_colisao_mesmo_valor_gera_aviso_e_divergente_lanca_excecao`: duas regras de mesma especificidade com `0.02` retornam `ResolucaoAliquota` com `aviso` preenchido; com `0.02` e `0.04` lançam `RuleResolutionException`.
- [ ] **Step 2: Run** `.\.venv\Scripts\pytest tests/test_fcp_resolver.py -v`. Expected: FAIL.
- [ ] **Step 3: Implement** matching por prefixo em `_nivel_padrao`, preload e `resolve_fcp` em `app/services/rules_engine/aliquota_resolver.py`, reutilizando a lógica de exceção/termos/genérica/colisão de `_nivel_reducao_produto` sem duplicar algoritmos.
- [ ] **Step 4: Run** `.\.venv\Scripts\pytest tests/test_fcp_resolver.py tests/test_camada5_rules_engine.py tests/test_reducao_produto_pipeline.py -v`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(fcp): suportar prefixos NCM e resolve_fcp no AliquotaResolver`.

---

### Task 4: Excel Python 2 abas (`TemplateFiller`, `FormulaGuard` e `PipelineOutputService`)

**Files:**
- Modify: `app/services/excel/template_filler.py:19-134`
- Modify: `app/services/pipeline_outputs.py:73-358`
- Test: `tests/test_fcp_template_filler.py`

**Interfaces:**
- Consumes: Contrato `metadados_extras` da spec (`a_dst_base`, `fcp_aliquota`, `fcp_separado`, `fcp_valor_devido`, `fcp_cte_v_total`, `fcp_cte_mva`, `fcp_cte_reducao`, `fcp_parcelas`).
- Produces:
  - `TemplateFiller.fill_template(cls, template_path: str, mapping: Dict[str, Any], rows_data: List[Dict[str, Any]], output_path: str, header_info: Optional[Dict[str, Any]] = None, fcp_rows: Optional[List[Dict[str, Any]]] = None) -> str`
  - `processed_note_to_fcp_rows(note: NotaFiscalProcessada) -> List[Dict[str, Any]]`
  - `PipelineOutputService.generate(self, *, solicitacao, empresa, rows_by_destination, legacy_mode, legacy_template, header_info, fcp_rows_by_destination: Optional[Mapping[str, List[Dict[str, Any]]]] = None) -> GeneratedArtifacts`
  - `PipelineOutputService.regenerate(self, solicitacao: Solicitacao) -> None` reconstruindo aba `{MM}-{AAAA} FCP` para `DESTINOS_TRIBUTARIA`.

- [ ] **Step 1: Write the failing tests** em `tests/test_fcp_template_filler.py`:
  - `test_fill_template_gera_duas_abas_com_formulas_e_logo_intactos`: usando `storage/templates/modelo_padrao_antecipacao_tributaria.xlsx` e `DEFAULT_ANTECIPACAO_TRIBUTARIA_MAPPING`, chama `TemplateFiller.fill_template(..., rows_data=[row_principal], header_info=..., fcp_rows=[row_fcp])`; valida workbook resultante com abas `["05-2026", "05-2026 FCP"]`, fórmulas intactas nas duas abas, imagens preservadas nas duas abas, e células FCP (`J4 == 2`, `K4 == 0`, `S4 == 0`).
  - `test_aba_fcp_limpa_linhas_exemplo_residuais_do_template`: com apenas 1 linha em `rows_data` e 1 linha em `fcp_rows` sobre `modelo_padrao_antecipacao_tributaria.xlsx` (que traz exemplos em linhas 4–6), verifica que `D5`, `E5`, `H5`, `J5`, `H6`, `J6` estão `None` em ambas as abas, enquanto `N5`, `O5`, `Q5` e `E39:T39` (`=SUM(...)`) permanecem fórmulas intactas.
  - `test_fill_template_sem_fcp_rows_mantem_aba_unica`: com `fcp_rows=None` ou `[]`, o arquivo tem apenas 1 aba.
  - `test_processed_note_to_fcp_rows_suporta_nota_e_parcelas_cte`: valida reconstrução a partir de `NotaFiscalProcessada` normal com `fcp_separado=True` e de CT-e com `fcp_parcelas`, bem como `PipelineOutputService.regenerate` com `data_entrada` atualizada refletida nas duas abas.
- [ ] **Step 2: Run** `.\.venv\Scripts\pytest tests/test_fcp_template_filler.py -v`. Expected: FAIL (`TypeError: unexpected keyword argument 'fcp_rows'`).
- [ ] **Step 3: Implement** clonagem da aba antes do preenchimento, limpeza de células mapeadas residuais não-fórmula (exceto `item_index`) após `start_row + len(rows)`, transferência de imagens nas duas abas e verificação conjunta no `FormulaGuard` em `template_filler.py`; seleção de capacidade por `max(len(rows), len(fcp_rows))`, `processed_note_to_fcp_rows` e repasse em `generate`/`regenerate` em `pipeline_outputs.py`.
- [ ] **Step 4: Run** `.\.venv\Scripts\pytest tests/test_fcp_template_filler.py tests/test_camada8_excel_formulas.py tests/test_official_template.py tests/test_template_official_integrity.py -v`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(fcp): gerar aba MM-AAAA FCP e regeneracao no Excel Python`.

---

### Task 5: Pipeline Python + CT-e (`pipeline_service.py` e `pipeline_cte.py`)

**Files:**
- Modify: `app/services/pipeline_service.py:89-1283`
- Modify: `app/services/pipeline_cte.py:69-720`
- Test: `tests/test_fcp_pipeline.py`

**Interfaces:**
- Consumes: Task 3 (`AliquotaResolver.resolve_fcp`, `_nivel_padrao` com prefixo), Task 4 (`PipelineOutputService.generate(..., fcp_rows_by_destination=...)`, `regenerate`).
- Produces:
  - `GrupoKey = Tuple[str, Decimal, Decimal, Decimal, Optional[Decimal], Optional[Decimal]]` (`..., reducao, fcp_separado_aliquota`).
  - `NotaFiscalProcessada.metadados_extras` com chaves FCP da spec e `rows_por_destino` / `fcp_rows_por_destino` sincronizados em `pipeline_service.py` e `pipeline_cte.py`.

- [ ] **Step 1: Write the failing tests** em `tests/test_fcp_pipeline.py` (usando `DEFAULT_ANTECIPACAO_TRIBUTARIA_MAPPING` no cenário quando testar AT):
  - `test_at_regime_normal_bebidas_ba_gera_duas_abas_e_separa_fcp`: empresa Regime Normal BA com preset Bebidas BA; XML com cerveja `22030000` (CFOP `6403`, MVA > 0), refrigerante `22021000` (`"REFRIGERANTE COLA 2L"`, CFOP `6403`) e água mineral `22011000` (`"AGUA MINERAL 500ML"`, CFOP `6403`); verifica `NotaFiscalProcessada` (cerveja `a_dst_resolvida == 0.25`, `metadados_extras["fcp_separado"] is True`, `fcp_valor_devido` = `round_currency(base_st * 0.02)`; refri `a_dst_resolvida == 0.205`, `fcp_separado is True`; água `fcp_aliquota is None`), `SolicitacaoSaida.total_valor_devido` igual à soma apenas dos ICMS AT, e `.xlsx` com abas `"01-2026"` e `"01-2026 FCP"` (`A.ORI == 0` na aba FCP).
  - `test_at_regime_normal_nfe_mista_mesma_aliquota_base_separa_grupos`: mesma NF-e com refrigerante `22021000` (`20,5% + 2% FCP`) e água mineral `22011000` (`20,5%` sem FCP); gera 2 linhas na aba principal (ambas `20,5%`) e apenas 1 linha na aba FCP (valor apenas do refrigerante).
  - `test_at_antecipado_regime_normal_gera_aba_fcp_sem_data_entrada`: com SPED sem a NF-e, sai `antecipacao_tributaria_antecipado` com aba `{MM}-{AAAA} FCP` e `data_entrada is None` nas duas abas.
  - `test_at_simples_nacional_soma_fcp_na_a_dst_sem_aba_fcp`: empresa `optante_simples_nacional=True`, cerveja `22030000` sai com `a_dst_resolvida == Decimal("0.2700")`, refri `Decimal("0.2250")`, `fcp_separado is False`, e `.xlsx` com apenas 1 aba.
  - `test_parcial_e_difal_somam_fcp_e_respeitam_aliquotas_iguais_e_termo_acordo`: Parcial com `A.ORI=12%`, `A.DST base=12%`, `FCP=2%` e política de alíquotas iguais ativa não exclui item (`A.DST=14%`); regra com `aplicar_com_termo_acordo=False` é ignorada quando empresa tem termo de acordo; DIFAL (`6556`) soma `20,5% + 2% = 22,5%`.
  - `test_cte_at_acompanha_fcp_regime_normal_e_simples`: CT-e cobrindo NF-e mista (50% cerveja com FCP, 50% mercadoria sem FCP) gera linha proporcional do CT-e na aba FCP no Regime Normal e desdobro proporcional no Simples Nacional; após editar `data_entrada` e chamar `regenerate_outputs`, ambas as abas refletem a nova data.
- [ ] **Step 2: Run** `.\.venv\Scripts\pytest tests/test_fcp_pipeline.py -v`. Expected: FAIL.
- [ ] **Step 3: Implement** resolução de FCP, `GrupoKey`, metadados, `fcp_rows_por_destino` e suporte completo em `pipeline_service.py` e `pipeline_cte.py`.
- [ ] **Step 4: Run** `.\.venv\Scripts\pytest tests/test_fcp_pipeline.py tests/test_cte_pipeline.py tests/test_simples_nacional_pipeline.py -v`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(fcp): integrar FCP no pipeline Python e rateio de CT-e`.

---

### Task 6: Motor Local TypeScript — Tipos, Regras (`rules.ts`) e Excel 2 abas (`xlsx.ts`)

**Files:**
- Create: `frontend/src/types/regraFcp.ts`
- Modify: `frontend/src/types/localProcessing.ts:14-75`
- Modify: `frontend/src/lib/localProcessing/rules.ts:380-575`
- Modify: `frontend/src/lib/localProcessing/xlsx.ts:340-599`
- Test: `frontend/tests/fcpRulesAndXlsx.test.ts`

**Interfaces:**
- Consumes: Contrato JSON de `regras_fcp` (Task 2).
- Produces:
  - Tipos em `frontend/src/types/regraFcp.ts`: `ExcecaoFcp`, `RegraFcp`, `RegraFcpCreate`, `RegraFcpUpdate`, `ExcecaoFcpCreate`, `PresetBebidasBaResultado`.
  - `LocalProcessingContext.regras_fcp?: RegraFcp[]`.
  - `resolveStandardDestinationRate(context: LocalProcessingContext, item: ExtractedItem): TaxRateResolution` com casamento por maior prefixo NCM.
  - `resolveFcp(context: LocalProcessingContext, item: ExtractedItem): TaxRateResolution | null`.
  - `fillTemplateLocally(templateBytes: ArrayBuffer, template: LocalTemplateDescriptor, rows: LocalOutputRow[], header: TemplateHeaderInfo, fcpRows?: LocalOutputRow[]): Promise<ArrayBuffer>`.

- [ ] **Step 1: Write the failing tests** em `frontend/tests/fcpRulesAndXlsx.test.ts` (usando `installDomParserPolyfill()` e `modelo_padrao_antecipacao_tributaria.xlsx` real):
  - `resolveStandardDestinationRate casa prefixo NCM mais especifico`: `22030000` > `2203` > padrão UF.
  - `resolveFcp aplica excecao exata, termos, exclusao e aplicar_com_termo_acordo`: valida precedência, `aplicar_com_termo_acordo=false` com e sem `termo_acordo`, e colisão (aviso se igual, erro se diferente).
  - `resolveFcp sem descricao confiavel casa regra generica e ignora regra com termos`: `descricaoConfiavel: false` casa `2203` sem termos e ignora `22021000` com termos.
  - `fillTemplateLocally gera segunda aba MM-AAAA FCP preservando workbook, rels, desenhos e formulas`: valida com `readZip` + `workbookSheets` que existem `"05-2026"` e `"05-2026 FCP"` ambas não ocultas, cada uma com seu `.rels` se existir desenho, e valores FCP corretos (`A.DST=2`, `A.ORI=0`).
  - `fillTemplateLocally limpa linhas residuais na aba principal e na aba FCP`: preenchendo 1 linha sobre `modelo_padrao_antecipacao_tributaria.xlsx`, confirma linhas 5–6 limpas em colunas de dados sem destruir células `<f>` nem `=SUM(...)`.
- [ ] **Step 2: Run** `cd frontend; node --experimental-strip-types --test tests/fcpRulesAndXlsx.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `regraFcp.ts`, atualização de `localProcessing.ts`, prefixo NCM e `resolveFcp` em `rules.ts`, e clonagem de aba XML + limpeza residual + `keepOnlyPeriodSheetsVisible` em `xlsx.ts`.
- [ ] **Step 4: Run** `cd frontend; node --experimental-strip-types --test tests/fcpRulesAndXlsx.test.ts tests/reducaoProdutoConflito.test.ts tests/templateSheetSelection.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(fcp): adicionar resolveFcp, prefixos NCM e aba FCP no motor local TS`.

---

### Task 7: Motor Local TypeScript — Pipeline (`processor.ts`), CT-e (`cteProcessing.ts`) e Preencher Datas (`entryDateFiller.ts`)

**Files:**
- Modify: `frontend/src/lib/localProcessing/processor.ts:180-1313`
- Modify: `frontend/src/lib/localProcessing/cteProcessing.ts:41-633`
- Modify: `frontend/src/lib/localProcessing/entryDateFiller.ts:187-644`
- Test: `frontend/tests/fcpPipeline.test.ts`
- Test: `frontend/tests/entryDateFiller.test.ts`

**Interfaces:**
- Consumes: Task 6 (`resolveFcp`, `resolveStandardDestinationRate`, `fillTemplateLocally(..., fcpRows)`).
- Produces:
  - `groupKey(..., reducao, fcpSeparado: number | null = null)` e `fcpRowsByDestination` em `processor.ts`.
  - `TribCandidateForCte` estendido com `vTotal`, `fcp`, `fcpOrigem`, `fcpDetalhe`, mais geração proporcional em `cteProcessing.ts`.
  - `fillAndReorderEntryDatesInXlsx` sincronizando aba principal + aba `* FCP` visível quando presente.

- [ ] **Step 1: Write the failing tests** em `frontend/tests/fcpPipeline.test.ts` e `frontend/tests/entryDateFiller.test.ts`:
  - `AT Regime Normal bebidas BA gera segunda aba FCP e mantem total AT separado`: verifica `artifacts` (`totalValorDevido` só ICMS AT), `rowsByDestination` e leitura do `.xlsx` com `"01-2026"` e `"01-2026 FCP"`.
  - `AT Regime Normal separa grupos de mesma aliquota base quando apenas um item tem FCP`: refrigerante + água mineral na mesma NF-e geram 2 linhas principais e 1 linha FCP.
  - `AT Regime Normal excluida por ST pago nao gera aba FCP`: item de bebida com `vICMSST` cobrindo o imposto vai para `itensExcluidos` e não gera aba FCP nem `fcp_valor_devido`.
  - `AT Simples Nacional, Parcial (com Convenio 52/91 e aliquotas iguais) e DIFAL somam FCP na A.DST`: verifica `27%` / `22,5%` no Simples, Parcial `12% + 2% = 14%` não excluído, Convênio 52/91 + FCP e DIFAL `22,5%`.
  - `CT-e AT acompanha FCP no Regime Normal e no Simples Nacional`: NF-e mista gera linha proporcional na aba FCP (Regime Normal) e desdobro proporcional no Simples.
  - Em `entryDateFiller.test.ts`: `fillAndReorderEntryDatesInXlsx sincroniza aba principal e aba FCP` — workbook com abas `"01-2026"` e `"01-2026 FCP"` (ambas visíveis, uma nota sem data e outra preenchida pelo SPED); confirma ambas reordenadas e preenchidas igualmente no buffer retornado.
- [ ] **Step 2: Run** `cd frontend; node --experimental-strip-types --test tests/fcpPipeline.test.ts tests/entryDateFiller.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** as regras de FCP em `processor.ts` e `cteProcessing.ts` (em paridade exata com Task 5) e suporte multi-aba `* FCP` em `entryDateFiller.ts`.
- [ ] **Step 4: Run** `cd frontend; npm test`. Expected: PASS em toda a suíte TS.
- [ ] **Step 5: Commit** `feat(fcp): integrar FCP no processador local, CT-e e preenchimento de datas`.

---

### Task 8: Frontend — API e Seção FCP em `PerfisRegras` + Prefixos em Exceções por NCM

**Files:**
- Create: `frontend/src/api/regrasFcp.ts`
- Create: `frontend/src/pages/PerfisRegras/useFcpSection.ts`
- Create: `frontend/src/pages/PerfisRegras/FcpSection.tsx`
- Modify: `frontend/src/api/queryKeys.ts:1-18`
- Modify: `frontend/src/types/perfil.ts:74-93`
- Modify: `frontend/src/pages/PerfisRegras/CopiarRegrasButton.tsx:14-21`
- Modify: `frontend/src/pages/PerfisRegras/index.tsx:42-98,350-420`
- Modify: `frontend/src/pages/PerfisRegras/AliquotasSectionCards.tsx:177-238`
- Modify: `frontend/src/pages/PerfisRegras/PerfisRegrasModals.tsx:244-255`
- Modify: `frontend/src/pages/PerfisRegras/usePerfisRegrasPage.ts:24-36,373-405`

**Interfaces:**
- Consumes: Task 2 (`/api/v1/regras-fcp`, `/preset-bebidas-ba`, `secao="fcp"`), Task 6 (`frontend/src/types/regraFcp.ts`).
- Produces: `regrasFcpApi`, `queryKeys.regrasFcp`, `FcpSection`, seção `'fcp'` em `PerfisRegras/index.tsx`, validação Zod 4–8 dígitos em `Exceções por NCM`.

- [ ] **Step 1: Implementar camada de API e tipos auxiliares** (`regrasFcp.ts`, `queryKeys.ts`, `perfil.ts` com `'fcp'` em `CopiarRegrasSecao`, `CopiarRegrasButton.tsx` com `'regras-fcp'` em `REGRAS_QUERY_PREFIXES`).
- [ ] **Step 2: Implementar `useFcpSection.ts` e `FcpSection.tsx`** espelhando `ReducaoProdutoSection.tsx` com: coluna `UF`, `Termo de Acordo` (`Sim`/`Não`), `NCM / Prefixo`, `Termos de inclusão`, `Termos de exclusão`, `% FCP` (padrão `2,00`), `Descrição`, `Exceções por descrição`, `CopiarRegrasButton` (`secao="fcp"`), e botão **"Carregar padrão Bebidas BA (2%)"** com confirmação e feedback de contadores invalidando `queryKeys.regrasFcp` e `queryKeys.regrasAliquotas`.
- [ ] **Step 3: Integrar em `PerfisRegras/index.tsx`** (adicionar `'fcp'` em `SectionKey`, `SECTION_KEYS`, `collapsedSections` e renderizar `<FcpSection />` dentro da seção `Alíquota de destino (A.DST)`), e atualizar `AliquotasSectionCards.tsx`, `PerfisRegrasModals.tsx` e `usePerfisRegrasPage.ts` para aceitar prefixos NCM de 4 a 8 dígitos não zerados em `Exceções Tributárias por NCM`.
- [ ] **Step 4: Run** `cd frontend; npm run lint; npm run build`. Expected: 0 erros de lint e build limpo.
- [ ] **Step 5: Commit** `feat(fcp): adicionar secao FCP e prefixos NCM na tela Perfis de Regras`.

---

### Task 9: Frontend — Exibição de FCP separado em `ReviewAndResultStep` e `SolicitacaoDetalheModal`

**Files:**
- Create: `frontend/src/lib/fcpSummary.ts`
- Modify: `frontend/src/pages/NovaSolicitacao/ReviewAndResultStep.tsx:309-444`
- Modify: `frontend/src/pages/Historico/SolicitacaoDetalheModal.tsx:116-241`
- Modify: `frontend/src/pages/Historico/useHistoricoPage.ts:19-37,250-292`
- Test: `frontend/tests/fcpSummary.test.ts`

**Interfaces:**
- Consumes: Contrato `metadados_extras` gravado nas Tasks 5 e 7.
- Produces:
  - `getNotaFcpInfo(nota: Pick<NotaFiscalProcessada, 'metadados_extras'>): { aliquota: number | null; separado: boolean; valorDevido: number }`
  - `sumSeparatedFcpByDestination(notas: NotaFiscalProcessada[] | undefined, destino?: TipoPlanilha): number` (soma `fcp_valor_devido` quando `fcp_separado === true` e eventuais `fcp_parcelas` de CT-e).
  - Cards de saída e tabela de conferência em `ReviewAndResultStep.tsx` e `SolicitacaoDetalheModal.tsx` exibindo `FCP (aba {MM}-{AAAA} FCP): {formatCurrency(totalFcpSeparado)}` e badges `+X% FCP` sem somar no `total_valor_devido` do card AT.

- [ ] **Step 1: Write the failing tests** em `frontend/tests/fcpSummary.test.ts`:
  - `getNotaFcpInfo identifica FCP separado, FCP somado e ausencia de FCP`.
  - `sumSeparatedFcpByDestination soma notas e parcelas CT-e sem misturar FCP somado no Simples`.
- [ ] **Step 2: Run** `cd frontend; node --experimental-strip-types --test tests/fcpSummary.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `frontend/src/lib/fcpSummary.ts` e atualizar `ReviewAndResultStep.tsx`, `SolicitacaoDetalheModal.tsx` e `useHistoricoPage.ts`.
- [ ] **Step 4: Run** `cd frontend; node --experimental-strip-types --test tests/fcpSummary.test.ts; npm run lint; npm run build`. Expected: PASS e build sem erros.
- [ ] **Step 5: Commit** `feat(fcp): exibir totais e detalhamento do FCP no resultado e historico`.

---

### Task 10: Verificação completa end-to-end e regressão

**Files:**
- Verify only (sem edições novas, salvo correções pontuais se alguma verificação acusar falha)

- [ ] **Step 1: Run backend full test suite:** `.\.venv\Scripts\pytest -q`. Expected: todos os testes passando (0 falhas).
- [ ] **Step 2: Run frontend tests, lint and production build:**
  ```powershell
  Set-Location frontend
  npm test; if ($LASTEXITCODE -eq 0) { npm run lint }; if ($LASTEXITCODE -eq 0) { npm run build }
  ```
  Expected: todas as suítes `node --test` passando, 0 erros no `oxlint` e `tsc -b && vite build` concluindo sem erros.
- [ ] **Step 3: Check git status:** `git status -sb` limpo, todos os commits organizados por task.
