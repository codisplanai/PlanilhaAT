# Indústria só DIFAL, DIFAL Antecipado (Simples) e DIFAL retroativa (Regime Normal) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Empresa com atividade "indústria" gera apenas DIFAL (uso/consumo e ativo). Simples Nacional ganha a planilha "DIFAL — Pago Antecipadamente". Regime Normal passa a aceitar na DIFAL notas de uso/consumo/ativo emitidas antes do período, desde que escrituradas no SPED do período.

**Architecture:** As regras entram nos **dois motores**, como em todos os commits recentes: o pipeline Python (`app/services/pipeline_service.py` + `pipeline_analysis.py`) e o processamento local no navegador (`frontend/src/lib/localProcessing/processor.ts` + `rules.ts`), que é o caminho usado pela tela Nova Solicitação. A empresa ganha a coluna `atividade` (`comercio` | `industria`). O tipo novo `difal_antecipado` reaproveita o calculador, o template e o modelo RP-158 da DIFAL.

**Tech Stack:** Python 3.12, FastAPI, SQLAlchemy, Alembic, pytest; React + TypeScript, testes `node --test` (`npm test` em `frontend/`).

**Spec:** Alinhamento na conversa de 2026-11-04 (perguntas e respostas abaixo, resumidas em Global Constraints). Não há documento de spec separado.

## Global Constraints

- Atividade da empresa: campo `atividade`, valores exatos `"comercio"` (padrão) e `"industria"`. Empresas existentes ficam `"comercio"`.
- Indústria **não** gera Parcial (nenhuma das 4 variantes) nem Tributária (nenhuma das 2). Itens que iriam para elas vão para **itens excluídos** com `tipo_exclusao = "industria_sem_antecipacao"` e motivo exato: `Empresa industrial: não recolhe Antecipação Parcial nem Tributária (apenas DIFAL de uso/consumo e ativo imobilizado).`
- Uso/consumo/ativo é identificado: (a) pelo CFOP de entrada do SPED (`2556`, `2407`, `2551` e sufixos `556/407/551`, via `is_cfop_uso_consumo_ativo` / `isUsoConsumoAtivo`, que já existem); (b) por bonificação/amostra/outras entradas (`910/911/949`) confirmadas como uso/consumo no diálogo. Os dados fiscais continuam vindo do XML quando ele existe (`enrich_sped_with_xml` / `enrichSpedWithXml`, sem mudanças).
- Diálogo de bonificação: continua disparando para os sufixos `910/911/949`. Na indústria as opções passam a ser **"Uso/Consumo (DIFAL)"** e **"Ignorar"**. O contrato da decisão continua `Record<string, boolean>`: `false` = DIFAL, `true` = não é uso/consumo. Na indústria, `true` gera item excluído (`tipo_exclusao = "industria_sem_antecipacao"`) com motivo exato: `Bonificação/amostra/outras entradas (CFOP {cfop}) não confirmada como uso/consumo pelo usuário (empresa industrial).`
- Novo tipo `difal_antecipado`: modelo `RP-158`, nome curto `DIFAL-Antecipado`, rótulo `DIFAL — Pago Antecipadamente (Simples Nacional)`, mesmo calculador e mesmo mapeamento/template da DIFAL. A data de entrada sai sempre vazia (igual aos outros "Antecipado"), e a A.ORI fica vazia sem destaque (igual à DIFAL).
- Roteamento DIFAL Antecipado: `destino == difal` **e** `pago_antecipadamente` (há fonte de entradas, mas a nota não tem entrada comprovada) **e** empresa optante pelo Simples Nacional → `difal_antecipado`. Regime Normal continua indo para `difal`, como hoje.
- DIFAL retroativa: empresa **não** optante pelo Simples, nota vinda do SPED (`origem_extracao == "sped"`) e data de emissão **anterior** a `periodo_inicio` → a nota não é descartada pelo filtro de período. Mas só os itens cujo destino final é `difal` entram; os demais itens são pulados. Emissão posterior a `periodo_fim` continua descartada. No Simples, nada muda (a nota segue descartada por período).
- Nota retroativa sem nenhum item de DIFAL: vai para notas ignoradas com a mesma mensagem de "fora do período" de hoje. Com itens de DIFAL e algum item pulado: um aviso por nota, com texto exato `Nota emitida antes do período ({dd/mm/aaaa}) com entrada no SPED do período: apenas itens de DIFAL (uso/consumo e ativo) foram considerados.`
- Sem planilha gerada e todos os excluídos do tipo indústria: mensagem exata `Nenhuma planilha gerada: empresa industrial sem itens de uso/consumo ou ativo imobilizado (DIFAL)`.
- Fora de escopo (sem mudança): roteamento por CFOP da Planilha Auxiliar de Entradas; DIFAL de Regime Normal sem entrada comprovada (continua indo para a `difal` normal); modo legado (`tipo_planilha` explícito).
- Migrations: a próxima é `022`; o revision id precisa caber em `varchar(32)` (ver commit ff8c298).

## Review Focus

1. **Nota retroativa com itens mistos (2556 + 2102) no Regime Normal**: só o item 2556 entra na DIFAL; o item 2102 não vira Parcial e não é contado como "CFOP sem regra". → teste `test_retroativa_mista_so_difal` (Task 3) e `retroativa mista mantém apenas DIFAL` (Task 5).
2. **Bonificação retroativa no Regime Normal**: o diálogo precisa listá-la (a pré-análise hoje filtra por período), senão a nota some sem decisão. → `test_pre_analise_inclui_bonificacao_retroativa_regime_normal` (Task 3) e `pré-análise lista bonificação retroativa no Regime Normal` (Task 5).
3. **Indústria com nota mista (2556 + 2102) dentro do período**: gera a DIFAL do item 2556, e o 2102 vai para os excluídos; a solicitação não pode falhar com "nenhuma NF-e válida". → `test_industria_nota_mista` (Task 4) e `indústria: nota mista gera DIFAL e exclui revenda` (Task 6).
4. **Simples com nota retroativa de uso/consumo no SPED**: continua ignorada (não pode entrar na `difal` nem na `difal_antecipado`). → `test_simples_nao_aceita_retroativa` (Task 3) e `Simples não aceita DIFAL retroativa` (Task 5).
5. **Indústria com política "revenda → Tributária" no perfil** (`revenda_tributaria_config`): o redirecionamento para Tributária não pode escapar da exclusão de indústria. → `test_industria_ignora_politica_revenda_tributaria` (Task 4) e `indústria: política passo a passo não gera Tributária` (Task 6).

---

### Task 1: Atividade da empresa (backend)

**Files:**
- Modify: `app/constants.py` (adicionar `ATIVIDADE_COMERCIO`, `ATIVIDADE_INDUSTRIA`, `ATIVIDADES_EMPRESA`)
- Modify: `app/models/empresa.py` (coluna + check constraint)
- Create: `alembic/versions/022_empresa_atividade.py`
- Modify: `app/schemas/empresa.py` (`EmpresaBase`, `EmpresaUpdate`)
- Modify: `app/api/endpoints/empresas.py:40` e `:89` (create/update repassam o campo)
- Modify: `app/api/endpoints/processamento_local.py:96` (`_serialize_empresa`) e `app/schemas/local_processing.py:80` (`LocalEmpresaOut`)
- Test: `tests/test_empresa_atividade.py`

**Interfaces:**
- Produces: `ATIVIDADE_COMERCIO: Final = "comercio"`, `ATIVIDADE_INDUSTRIA: Final = "industria"`, `ATIVIDADES_EMPRESA = (ATIVIDADE_COMERCIO, ATIVIDADE_INDUSTRIA)`; `Empresa.atividade: str` (NOT NULL, default `"comercio"`); `LocalEmpresaOut.atividade: str`; contexto local `empresa.atividade`.

- [ ] **Step 1: Write the failing tests** em `tests/test_empresa_atividade.py`, usando o fixture `client` e o padrão de criação de empresa dos testes existentes:
  - `test_empresa_criada_sem_atividade_fica_comercio`: POST sem `atividade` → resposta `atividade == "comercio"`.
  - `test_empresa_industria_persistida_e_editavel`: POST `atividade="industria"` → `"industria"`; PUT/PATCH `atividade="comercio"` → `"comercio"`.
  - `test_atividade_invalida_rejeitada`: `atividade="servico"` → 422.
  - `test_contexto_local_expoe_atividade`: GET do contexto de processamento local da empresa → `context["empresa"]["atividade"] == "industria"`.
- [ ] **Step 2: Run** `pytest tests/test_empresa_atividade.py -v`. Expected: FAIL (campo inexistente / extra fields not permitted).
- [ ] **Step 3: Implement.** Coluna `atividade = Column(String(20), nullable=False, default="comercio", server_default="comercio")` com `CheckConstraint("atividade IN ('comercio', 'industria')", name="ck_empresa_atividade")`. Migration `022_empresa_atividade` (revises `021_valor_pago_st`), no mesmo estilo idempotente da `019_a_ori_fixa_parcial.py` (`batch_alter_table`, checa a coluna antes, downgrade remove constraint e coluna). Schema: `atividade: str = ATIVIDADE_COMERCIO` em `EmpresaBase` e `Optional[str] = None` em `EmpresaUpdate`, com validator `strip().lower()` que rejeita valores fora de `ATIVIDADES_EMPRESA` com a mensagem `"Atividade inválida (use 'comercio' ou 'industria')"`.
- [ ] **Step 4: Run** `pytest tests/test_empresa_atividade.py -v` e depois `pytest -q`. Expected: PASS, sem regressões.
- [ ] **Step 5: Commit** `feat(empresa): adiciona atividade comercio/industria`.

### Task 2: Tipo de planilha `difal_antecipado` (backend)

**Files:**
- Modify: `app/constants.py` (`DIFAL_ANTECIPADO: Final = "difal_antecipado"`, incluído em `TIPOS_PLANILHA`; **não** entra em `TIPOS_PLANILHA_LEGADO` nem em `DESTINOS_CFOP`)
- Modify: `app/services/calculation/factory.py` (`DIFAL_ANTECIPADO: DifalCalculator()`)
- Modify: `app/services/pipeline_helpers.py:244-262` (`MODELO_OFICIAL_POR_TIPO["difal_antecipado"] = "RP-158"`, `TIPO_PLANILHA_CURTO["difal_antecipado"] = "DIFAL-Antecipado"`)
- Modify: `app/services/pipeline_outputs.py:61-66` (data de entrada vazia também para `DIFAL_ANTECIPADO`) e `:96-100` (regra da A.ORI vazia vale para `difal` e `difal_antecipado`)
- Modify: `app/services/templates_admin/template_manager.py:23` (lista de tipos)
- Modify: `app/core/seeds.py` (bloco "5. DIFAL Antecipado": sobe `DEFAULT_DIFAL_TEMPLATE_PATH` com `DEFAULT_DIFAL_MAPPING`, `tipo="difal_antecipado"`, `filename="modelo_padrao_difal_antecipado.xlsx"`, observações `"Modelo oficial de DIFAL — Pago Antecipadamente (RP-158)"`, somente se não houver template ativo do tipo)
- Test: `tests/test_spreadsheet_filename.py`, `tests/test_difal_template.py`, `tests/test_official_template.py`

**Interfaces:**
- Consumes: nada das outras tasks.
- Produces: constante `DIFAL_ANTECIPADO`; `CalculatorFactory.get_calculator("difal_antecipado")` devolve um `DifalCalculator`; template ativo semeado.

- [ ] **Step 1: Write the failing tests:**
  - `test_spreadsheet_filename.py`: `resolve_modelo_planilha("difal_antecipado") == "RP-158"`, `resolve_tipo_curto("difal_antecipado") == "DIFAL-Antecipado"`.
  - `test_difal_template.py::test_difal_antecipado_usa_calculo_difal`: o mesmo input dá o mesmo `debito/credito/valor_devido` em `get_calculator("difal")` e em `get_calculator("difal_antecipado")`.
  - `test_difal_template.py::test_difal_antecipado_linha_sem_data_entrada_e_a_ori_vazia`: `processed_note_to_row` de uma `NotaFiscalProcessada(destino_planilha="difal_antecipado", data_entrada=date(2026,1,20), origem_data_entrada="sped_fiscal", a_ori=0, metadados_extras={"a_ori_destacada": False})` → `row["data_entrada"] is None` e `row["a_ori"] is None`.
  - `test_official_template.py::test_seed_cria_template_difal_antecipado`: depois de `seed_default_templates(db)`, existe um `TemplateXlsx(tipo="difal_antecipado", ativo=True)` com `mapeamento_campos == DEFAULT_DIFAL_MAPPING`.
- [ ] **Step 2: Run** `pytest tests/test_spreadsheet_filename.py tests/test_difal_template.py tests/test_official_template.py -v`. Expected: FAIL.
- [ ] **Step 3: Implement** os pontos listados em Files.
- [ ] **Step 4: Run** os mesmos testes e depois `pytest -q`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(difal): adiciona tipo de planilha difal_antecipado (RP-158)`.

### Task 3: Pipeline Python — DIFAL Antecipado (Simples) e DIFAL retroativa (Regime Normal)

**Files:**
- Modify: `app/services/pipeline_helpers.py` (novo helper)
- Modify: `app/services/pipeline_service.py:237-251` (filtro de período), `:394-403` (roteamento antecipado), `:641-652` (nota sem grupos), `:764-781` (data de entrada vazia para `DIFAL_ANTECIPADO`)
- Modify: `app/services/pipeline_analysis.py:32-54` (`_eligible_notes`)
- Modify: `tests/conftest.py` (`build_xml_nfe` ganha `mes: str = "01"` e `crt: Optional[str] = None`; novo `build_sped_entradas(notas: list[dict]) -> bytes`, no layout de `_SPED_JANEIRO_COM_NF901`, com período 01–31/01/2026 e uma linha C100+C170 por nota (chaves `numero`, `chave`, `dt_doc` `ddmmaaaa`, `dt_entrada` `ddmmaaaa`, `valor`, `itens: list[(cfop, valor)]`); `cenario_janeiro._montar` ganha `simples: bool = False` e `atividade: str = "comercio"`, repassados à `Empresa`)
- Test: `tests/test_difal_retroativa_e_antecipado.py`

**Interfaces:**
- Consumes: `DIFAL_ANTECIPADO` (Task 2).
- Produces: `aceita_difal_retroativa(nf: ExtractedNFData, optante_simples: bool, periodo_inicio: date) -> bool` em `pipeline_helpers.py` (True sse `not optante_simples`, `nf.origem_extracao == "sped"` e `nf.data_emissao.date() < periodo_inicio`). Também usado por `PipelinePreAnalyzer._eligible_notes`.

- [ ] **Step 1: Write the failing tests** em `tests/test_difal_retroativa_e_antecipado.py` (solicitação de jan/2026; `cenario_janeiro(tipos=("antecipacao_parcial", "antecipacao_parcial_antecipado", "antecipacao_parcial_simples", "antecipacao_parcial_antecipado_simples", "difal", "difal_antecipado"), ...)`):
  - `test_regime_normal_aceita_uso_consumo_retroativo`: SPED com a NF 950 emitida em 15/12/2025, entrada em 05/01/2026, item `2556`, mais o XML (mes="12", cfop 6102) → nota processada com `destino_planilha == "difal"`, `data_entrada == date(2026,1,5)`, e a nota **não** aparece em `notas_ignoradas`.
  - `test_retroativa_mista_so_difal`: mesma nota com itens `2556` (500,00) e `2102` (300,00) → uma única nota processada `difal` com `v_total == Decimal("500.00")`; nenhuma `antecipacao_parcial*`; `cfops_sem_regra` vazio; `avisos_avaliacao` contém o texto exato do aviso de retroativa com `15/12/2025`.
  - `test_retroativa_sem_difal_continua_ignorada`: nota retroativa só com `2102` → em `notas_ignoradas`, com motivo contendo `fora do período informado`.
  - `test_simples_nao_aceita_retroativa`: o cenário do primeiro teste com `simples=True` → a nota fica em `notas_ignoradas` (período) e não há saída `difal` nem `difal_antecipado`.
  - `test_simples_bonificacao_sem_entrada_vai_para_difal_antecipado`: `simples=True`, SPED só com a NF 901, XML da NF 960 (cfop `6911`, dia 25, fora do SPED), `decisoes_bonificacao={CHAVE_960: False}` → a NF 960 sai com `destino_planilha == "difal_antecipado"` e `data_entrada is None`, e `{s.tipo for s in res.saidas}` contém `"difal_antecipado"`.
  - `test_regime_normal_bonificacao_sem_entrada_continua_difal`: o mesmo cenário com `simples=False` → `destino_planilha == "difal"`.
  - `test_pre_analise_inclui_bonificacao_retroativa_regime_normal`: `pre_analisar` com SPED contendo uma NF emitida em 20/12/2025, entrada em jan, item `2911` → `notas_bonificacao` contém a chave dela; o mesmo cenário com `simples=True` → não contém.
- [ ] **Step 2: Run** `pytest tests/test_difal_retroativa_e_antecipado.py -v`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Filtro de período: calcular `retroativa = not is_within_period(...) and aceita_difal_retroativa(nf_data, empresa.optante_simples_nacional, solicitacao.periodo_inicio)`. Só descartar a nota (como hoje) quando ela está fora do período e não é retroativa.
  - No laço de itens, logo antes do bloco `if modo_legado:`: se `retroativa and destino_item != DIFAL` → incrementar o contador local `itens_retroativos_pulados` e `continue`. Esse caminho não passa por `cfops_sem_regra`. Para o item "sem destino", o `continue` atual já cobre; num item retroativo, não contar o CFOP sem regra.
  - Roteamento antecipado, junto das linhas 394-397: `elif destino_item == DIFAL and pago_antecipadamente and empresa.optante_simples_nacional: destino_item = DIFAL_ANTECIPADO`.
  - O resolvedor de A.DST, o cálculo e a A.ORI tratam `DIFAL_ANTECIPADO` como `DIFAL`: em todo lugar que compara `== DIFAL` nas linhas 473, 495, 522, 722 e 845, usar `in (DIFAL, DIFAL_ANTECIPADO)`.
  - Data de entrada efetiva/origem vazias também para `DIFAL_ANTECIPADO` (linhas 764-781).
  - `if not grupos:` com `retroativa` → `notas_ignoradas` com a mensagem de período existente (mesmo texto das linhas 240-249). Com grupos, `retroativa` e `itens_retroativos_pulados > 0` → o aviso exato de Global Constraints.
  - `_eligible_notes`: aceitar a nota se estiver dentro do período **ou** se `aceita_difal_retroativa(note, empresa.optante_simples_nacional, solicitacao.periodo_inicio)`.
- [ ] **Step 4: Run** `pytest tests/test_difal_retroativa_e_antecipado.py tests/test_pago_antecipadamente.py tests/test_bonificacao_amostra_pipeline.py -v` e depois `pytest -q`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(difal): difal antecipado no simples e notas retroativas no regime normal`.

### Task 4: Pipeline Python — Indústria só DIFAL

**Files:**
- Modify: `app/constants.py` (`TIPO_EXCLUSAO_INDUSTRIA: Final = "industria_sem_antecipacao"`)
- Modify: `app/services/pipeline_service.py:345-358` (decisão de bonificação) e o trecho logo após `:399-403` (exclusão de indústria)
- Modify: `app/services/pipeline_helpers.py:178-195` (`no_output_message`)
- Modify: `app/services/rules_engine/parcial_decision.py:43` (comentário do `tipo_exclusao`)
- Test: `tests/test_industria_somente_difal.py`

**Interfaces:**
- Consumes: `ATIVIDADE_INDUSTRIA` (Task 1); `DIFAL_ANTECIPADO` (Task 2); fixtures `build_sped_entradas` e `cenario_janeiro(atividade=...)` (Task 3).
- Produces: `TIPO_EXCLUSAO_INDUSTRIA`; `no_output_message` reconhece o novo tipo.

- [ ] **Step 1: Write the failing tests** em `tests/test_industria_somente_difal.py` (`atividade="industria"`):
  - `test_industria_revenda_vai_para_excluidos`: XML+SPED da NF 901 (`2102`) → nenhuma saída gerada; `itens_excluidos[0]["tipo_exclusao"] == "industria_sem_antecipacao"` com o motivo exato; a mensagem da solicitação é a de indústria de Global Constraints.
  - `test_industria_nota_mista`: itens `2556` + `2102` → uma nota `difal` (só o valor do 2556) e um item excluído de indústria.
  - `test_industria_tributaria_vai_para_excluidos`: item `2403` → excluído de indústria, e nenhuma `antecipacao_tributaria*`.
  - `test_industria_bonificacao_confirmada_vai_para_difal`: XML `6911` + `decisoes_bonificacao={chave: False}` → `difal`.
  - `test_industria_bonificacao_negada_vai_para_excluidos`: `{chave: True}` → excluído com o motivo exato de bonificação negada, contendo o CFOP do item.
  - `test_industria_ignora_politica_revenda_tributaria`: perfil com a política "revenda → Tributária" ativa para o CNPJ (montar `configuracoes_extras` como em `tests/test_passo_a_passo_pipeline.py`) e item `2102` → excluído de indústria, sem `antecipacao_tributaria`.
  - `test_comercio_inalterado`: o primeiro cenário com `atividade="comercio"` → `antecipacao_parcial`, como hoje.
- [ ] **Step 2: Run** `pytest tests/test_industria_somente_difal.py -v`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - `is_industria = empresa.atividade == ATIVIDADE_INDUSTRIA`.
  - Na decisão de bonificação: se `is_industria and is_revenda is True` → `itens_excluidos.append(serialize_excluded_item(..., destino=ANTECIPACAO_PARCIAL, decisao=DecisaoExclusaoItem(excluido=True, tipo_exclusao=TIPO_EXCLUSAO_INDUSTRIA, motivo=<motivo de bonificação negada>, v_total=item.v_total, base_calculo=item.base_calculo, ipi_despesas=item.ipi_despesas, a_ori=item.a_ori)))` e `continue`.
  - Depois do mapeamento Simples (linha 403) e antes do `modo_legado`: se `is_industria and destino_item not in (DIFAL, DIFAL_ANTECIPADO)` → o mesmo `append`, com o motivo geral de indústria e `destino=destino_item`, e `continue`.
  - `no_output_message`: se todos os excluídos têm `tipo_exclusao == TIPO_EXCLUSAO_INDUSTRIA` → a mensagem de indústria. Os demais casos ficam como hoje.
- [ ] **Step 4: Run** `pytest tests/test_industria_somente_difal.py -v` e depois `pytest -q`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(industria): empresa industrial gera apenas difal`.

### Task 5: Processamento local (TS) — tipo novo, DIFAL Antecipado e retroativa

**Files:**
- Modify: `frontend/src/types/solicitacao.ts:70-79` (`TipoPlanilha` ganha `'difal_antecipado'`; `ItemExcluido.tipo_exclusao` ganha `'industria_sem_antecipacao'`)
- Modify: `frontend/src/types/empresa.ts` (`atividade?: 'comercio' | 'industria'` nos três tipos) e `frontend/src/types/localProcessing.ts:46-56` (incluir `'atividade'` no `Pick`)
- Modify: `frontend/src/constants/domain.ts` (rótulo, variante `'warning'` e rótulo curto para `difal_antecipado`)
- Modify: `frontend/src/lib/localProcessing/filename.ts` (`RP-158`, `DIFAL-Antecipado`)
- Modify: `frontend/src/lib/localProcessing/calculations.ts:73` e `:108` (`difal_antecipado` usa o ramo DIFAL)
- Modify: `frontend/src/lib/localProcessing/xlsx.ts:399-407` (`SINGLE_PERIOD_SHEET_TYPES`)
- Modify: `frontend/src/lib/localProcessing/rules.ts:39-47` (`routePaidEarlyDestination`) e `:250` (`resolveDestinationRate` trata `difal_antecipado` como `difal`)
- Modify: `frontend/src/lib/localProcessing/processor.ts` (`EARLY_DESTINATIONS`, `CONVENIO_52_91_DESTINATIONS`, `bonusPreAnalysis`, `convenio5291PreAnalysis`, filtro de período `:426-432`, laço de itens, `isDifal` `:580`, `aliqSimples` `:804`, `a_ori` da linha `:992`)
- Modify: `frontend/src/pages/AdminTemplates/useAdminTemplatesPage.ts:20-25` e `:66` (lista de tipos; `isDifal` cobre o tipo novo)
- Test: `frontend/tests/difalRetroativaAntecipado.test.ts`, `frontend/tests/filename.test.ts`

**Interfaces:**
- Consumes: contexto com `empresa.atividade` (Task 1).
- Produces: `routePaidEarlyDestination(destination: TipoPlanilha, paidEarly: boolean, isSimples = false): TipoPlanilha` (`'difal'` + `paidEarly` + `isSimples` → `'difal_antecipado'`; os demais casos ficam como hoje); `acceptsRetroactiveDifal(note: ExtractedNote, periodoInicio: string, isSimples: boolean): boolean` em `rules.ts` (`!isSimples && note.origemExtracao === 'sped' && note.dataEmissao.slice(0, 10) < periodoInicio`); `isDifalDestination(d: TipoPlanilha): boolean` em `rules.ts` (`d === 'difal' || d === 'difal_antecipado'`).

- [ ] **Step 1: Write the failing tests** em `frontend/tests/difalRetroativaAntecipado.test.ts`, chamando `processFiscalLocally` com SPED e XML sintéticos (padrão de `spedCfopOwnership.test.ts` e `difalRules.test.ts`; contexto com regra padrão BA 18% e templates ativos `difal`/`difal_antecipado`/`antecipacao_parcial*`), espelhando os testes da Task 3:
  - `Regime Normal aceita uso/consumo retroativo` → `rowsByDestination.difal` com 1 linha e a nota fora de `notasIgnoradas`.
  - `retroativa mista mantém apenas DIFAL` → só `difal`, com `v_total` do item 2556; `cfopsSemRegra` vazio; o aviso exato presente.
  - `retroativa sem DIFAL continua ignorada`.
  - `Simples não aceita DIFAL retroativa`.
  - `Simples: bonificação sem entrada vai para DIFAL Antecipado` (`bonusDecisions = { [chave]: false }`) → `rowsByDestination.difal_antecipado[0].data_entrada === null`.
  - `Regime Normal: bonificação sem entrada continua DIFAL`.
  - `pré-análise lista bonificação retroativa no Regime Normal` → o resultado sem `bonusDecisions` tem `preAnalysis.requer_decisao === true` com a nota listada; com `optante_simples_nacional: true`, não pausa por ela.
  - Em `filename.test.ts`: `resolveModeloPlanilha('difal_antecipado', null) === 'RP-158'` e `resolveTipoCurto('difal_antecipado') === 'DIFAL-Antecipado'`.
- [ ] **Step 2: Run** `cd frontend && npm test`. Expected: os testes novos FALHAM.
- [ ] **Step 3: Implement** com a mesma lógica da Task 3. Pontos específicos do TS:
  - `routePaidEarlyDestination` é chamado com `Boolean(context.empresa.optante_simples_nacional)`.
  - `bonusPreAnalysis` e `convenio5291PreAnalysis` trocam `!withinPeriod(...)` por `!withinPeriod(...) && !acceptsRetroactiveDifal(...)`.
  - Na nota retroativa, o item com destino final ≠ `difal` é pulado antes de `missingCfops`.
  - `isDifal`, `aliqSimples` e `a_ori` da linha usam `isDifalDestination`.
  - A mensagem de período do TS (linha 429) é reaproveitada para a retroativa sem DIFAL.
- [ ] **Step 4: Run** `cd frontend && npm test && npx tsc -b && npm run lint`. Expected: PASS, sem erros de tipo.
- [ ] **Step 5: Commit** `feat(local): difal antecipado e notas retroativas no processamento local`.

### Task 6: Processamento local (TS) — Indústria só DIFAL

**Files:**
- Modify: `frontend/src/lib/localProcessing/processor.ts:464-496` (decisão de bonificação e exclusão de indústria)
- Modify: `frontend/src/lib/localProcessing/rules.ts:~685` (`noOutputMessage`)
- Modify: `frontend/src/components/domain/ItensExcluidosSection.tsx` (contador e filtro `industria_sem_antecipacao`, com rótulo "Indústria")
- Test: `frontend/tests/industriaSomenteDifal.test.ts`

**Interfaces:**
- Consumes: `isDifalDestination` (Task 5); `context.empresa.atividade`.
- Produces: `isIndustria(context: LocalProcessingContext): boolean` em `rules.ts` (`context.empresa.atividade === 'industria'`).

- [ ] **Step 1: Write the failing tests** espelhando a Task 4: `indústria: revenda vai para excluídos` (inclui a mensagem exata de "sem planilha"), `indústria: nota mista gera DIFAL e exclui revenda`, `indústria: tributária vai para excluídos`, `indústria: bonificação confirmada vai para DIFAL`, `indústria: bonificação negada vai para excluídos` (motivo exato com o CFOP), `indústria: política passo a passo não gera Tributária`, `comércio inalterado`.
- [ ] **Step 2: Run** `cd frontend && npm test`. Expected: FAIL.
- [ ] **Step 3: Implement** com a mesma lógica da Task 4. A exclusão entra em `excluded` com os campos do padrão de `processor.ts:528-545` (`base` = `baseCalculo` ou `vTotal - ipiDespesas`) e é seguida de `continue`.
- [ ] **Step 4: Run** `cd frontend && npm test && npx tsc -b && npm run lint`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(local): empresa industrial gera apenas difal no processamento local`.

### Task 7: Interface — cadastro da atividade e diálogo da indústria

**Files:**
- Modify: `frontend/src/pages/Empresas/useEmpresasPage.ts:26`, `:44`, `:145`, `:161` (`atividade: z.enum(['comercio', 'industria'])`, padrão `'comercio'`, carga e envio)
- Modify: `frontend/src/pages/Empresas/index.tsx:~453` (select "Atividade": Comércio / Indústria, ao lado do checkbox do Simples; badge "Indústria" na listagem `:241`)
- Modify: `frontend/src/components/ModalConfirmacaoBonificacao.tsx` (nova prop `industria?: boolean`)
- Modify: `frontend/src/pages/NovaSolicitacao/index.tsx:565` (`industria={selectedEmpresa?.atividade === 'industria'}`) e badge "Indústria" junto do badge do Simples (`:169`, `CompanySelectionStep.tsx:115`)

**Interfaces:**
- Consumes: `Empresa.atividade` (Tasks 1 e 5); o contrato de decisão `true` = não é uso/consumo (Global Constraints).

- [ ] **Step 1: Implement o modal.** Com `industria`:
  - Título: `Confirmação de Uso/Consumo (CFOP 6910, 6911, 6949)`.
  - Subtítulo: `Empresa industrial: confirme quais mercadorias são para uso/consumo ou ativo (DIFAL). As demais serão ignoradas.`
  - Botões: `Ignorar` (valor `true`) e `Uso/Consumo (DIFAL)` (valor `false`).
  - Ações em massa: `Marcar todas como Uso/Consumo (DIFAL)` / `Marcar todas como Ignorar`.
  - Rodapé: `{n} para uso/consumo (DIFAL) • {m} ignorada(s)`.
  - Sem a prop, o modal fica exatamente como hoje.
- [ ] **Step 2: Implement** o select do cadastro de empresas e os badges.
- [ ] **Step 3: Run** `cd frontend && npx tsc -b && npm run lint && npm test`. Expected: PASS.
- [ ] **Step 4: Verificar no app** (skill `run`): cadastrar uma empresa Indústria; processar SPED + XML com uma nota 6911 e conferir os textos do diálogo; confirmar uso/consumo → DIFAL gerada; marcar ignorar → item em "Itens excluídos", com o filtro "Indústria".
- [ ] **Step 5: Commit** `feat(ui): atividade da empresa e dialogo de uso/consumo para industria`.
