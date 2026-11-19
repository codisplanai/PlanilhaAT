# FCP (Fundo de Combate à Pobreza): configuração no Perfil de Regras, motor de cálculo e aba separada na Antecipação Tributária

Data: 2026-11-19
Status: aprovado em brainstorming, aguardando revisão da spec

## Problema

O FCP (Fundo de Combate à Pobreza — na Bahia também chamado de FECP ou Funcep, Lei nº 7.014/1996, art. 16-A) aplica um adicional de alíquota do ICMS de **2%** sobre produtos supérfluos, incluindo grande parte do setor de bebidas na Bahia:

| Categoria de bebida (BA) | ICMS base | Adicional FCP | Carga efetiva total |
|---|---|---|---|
| Bebidas alcoólicas em geral (cervejas, chopes, vinhos, destilados etc.) | 25,00% | + 2,00% | 27,00% |
| Cervejas e chopes sem álcool | 20,50% | + 2,00% | 22,50% |
| Refrigerantes, isotônicos e bebidas energéticas | 20,50% | + 2,00% | 22,50% |
| Demais bebidas fora da lista (ex.: água mineral comum, sucos naturais) | 20,50% | 0,00% | 20,50% |

O sistema atual possui três lacunas para atender essa regra de ponta a ponta:

1. **Cadastro de FCP ausente no Perfil de Regras:** não há campo ou seção dedicada para configurar o adicional de FCP separado da alíquota base de ICMS, com filtro por NCM/prefixo, termos de descrição e exceções.
2. **Exceções Tributárias por NCM restritas a 8 dígitos:** `regras_aliquotas_destino` exige NCM completo de 8 dígitos na API (`clean_ncm`) e no formulário (`PerfisRegrasModals.tsx` / `usePerfisRegrasPage.ts`), impedindo cadastrar por posição/prefixo (ex.: `2203` a 25% para cervejas).
3. **Separação vs. soma por regime na apuração e planilha:**
   - Para empresas do **Regime Normal**, os 2% do FCP na **Antecipação Tributária** devem ser apurados em uma **planilha (aba) separada** (`MM-AAAA FCP`) com a mesma Base ST e `A.ORI = 0%`, mantendo a aba principal na alíquota base (`25%` ou `20,5%`) para não misturar guias de DAE.
   - Para empresas optantes pelo **Simples Nacional**, os 2% somam diretamente na `A.DST` (resultando em `27%` ou `22,5%`), sem aba separada.

## Decisões

Decisões fechadas em brainstorming antes desta especificação:

| # | Decisão | Consequência |
|---|---|---|
| D1 | **Seção dedicada "FCP" no Perfil de Regras** | Espelha o modelo de *Reduções por Produto* (`uf`, `ncm` 4–8 dígitos, `termos_inclusao`, `termos_exclusao`, `aliquota` % FCP, `excecoes` por descrição exata e `aplicar_com_termo_acordo`), mantendo a alíquota base de ICMS nas regras de alíquota existentes. |
| D2 | **Incidência em Tributária, Parcial e DIFAL** | Qualquer item elegível que casar uma regra de FCP do perfil aplica o adicional na apuração de Antecipação Tributária, Antecipação Parcial e DIFAL (incluindo modalidades `_antecipado` e `_simples`). |
| D3 | **Entrega na AT Regime Normal em segunda aba do mesmo `.xlsx`** | Gera a aba `{MM}-{AAAA} FCP` dentro do mesmo arquivo `.xlsx` da Antecipação Tributária (`antecipacao_tributaria` e `antecipacao_tributaria_antecipado`), seguindo o padrão histórico do modelo RP-151 (`04-2026` + `04-2026 FCP`). A aba só é criada quando há ao menos uma linha com FCP. |
| D4 | **Roteamento automático por regime da empresa (sem switch)** | Na Antecipação Tributária: `optante_simples_nacional = False` → FCP vai para a aba `{MM}-{AAAA} FCP`; `optante_simples_nacional = True` → `% FCP` soma direto na `A.DST` (ex.: `25% + 2% = 27%`). Na Parcial e no DIFAL (Normal e Simples), `% FCP` soma sempre direto na `A.DST`. |
| D5 | **Cálculo na aba `{MM}-{AAAA} FCP`** | Mesma Base ST da aba principal (`(V.TOTAL + IPI) * (1 + MVA)` com redução de base quando aplicável), com `A.DST = % FCP` (ex.: `2%`), `A.ORI = 0%` (sem crédito de origem) e `VR. PG. = 0`. `VR.DEVIDO = Base ST × % FCP`. |
| D6 | **Prefixos em Exceções por NCM + Preset opcional Bebidas BA** | `Exceções Tributárias por NCM` passa a aceitar prefixos de 4 a 8 dígitos (vence o mais específico). A seção FCP inicia vazia em todo perfil, aceita cópia entre perfis (`CopiarRegrasButton`) e oferece botão opcional idempotente **"Carregar padrão Bebidas BA (2%)"**, que popula as regras de FCP 2% e as exceções base de 25% na BA (`2203`, `2204`, `2205`, `2206`, `2208`). |
| D7 | **Precedência com Termo de Acordo** | Por padrão o FCP soma por cima da `A.DST` resolvida (padrão UF, exceção NCM, termo de acordo ou redução por produto). Cada regra de FCP possui `aplicar_com_termo_acordo` (padrão `true`); quando `false` e a empresa possui `termo_acordo` ativo, a regra é ignorada para aquela empresa. |
| D8 | **CT-e acompanha FCP das NF-es originárias (AT)** | Na Antecipação Tributária, o CT-e rateia proporcionalmente a parcela de itens com FCP das NF-es originárias: no Regime Normal gera linha proporcional do CT-e na aba `{MM}-{AAAA} FCP` (`A.DST = % FCP`, `A.ORI = 0%`, mesma `MVA`/`Redução`); no Simples Nacional desdobra proporcionalmente somando `% FCP` na `A.DST` da parcela com FCP. |
| D9 | **Totais separados na UI** | `SolicitacaoSaida.total_valor_devido` mantém apenas o ICMS da AT (sem somar FCP separado). O card de resultado/histórico exibe o total de FCP logo abaixo (`FCP (aba MM-AAAA FCP): R$ X,XX`), e a tabela de conferência de notas indica o `%` e o valor de FCP do item. |

## Fora de escopo

- Alterar a regra do DIFAL que força `apenas_padrao_uf=True` para a alíquota base de ICMS (`aliquota_resolver.py` / `rules.ts`): o FCP continua sendo avaliado pelo NCM/descrição do item e somado sobre a `A.DST` padrão da UF do DIFAL.
- Criar novos valores em `TIPOS_PLANILHA` ou exigir upload de um template específico de FCP: a aba FCP é clonada da aba selecionada do template ativo de `antecipacao_tributaria` / `antecipacao_tributaria_antecipado`.
- Filtro por vigência (`vigencia_inicio`/`vigencia_fim`) nas regras de FCP.
- Novas colunas nas tabelas `notas_fiscais_processadas` ou `solicitacoes_saidas`: toda a rastreabilidade do FCP é persistida em `NotaFiscalProcessada.metadados_extras`.
- Preenchimento automático de preset Bebidas BA em migração de dados: o cadastro inicia vazio por perfil e é carregado sob demanda pelo botão ou manualmente.

## Modelo de dados e Migração

Migração `alembic/versions/028_regras_fcp_produto.py`, com `down_revision = "027_template_empresa_id"`.

### Tabela `regras_fcp_produto`

Modelada em `app/models/regra_fcp_produto.py` (`RegraFcpProduto`) e registrada em `app/models/__init__.py` e `app/models/perfil_regras.py` (`regras_fcp_produto` com `cascade="all, delete-orphan"`):

| Coluna | Tipo | Restrições |
|---|---|---|
| `id` | Integer | PK, autoincrement |
| `perfil_regras_id` | Integer | FK → `perfis_regras.id`, `ON DELETE CASCADE`, `NOT NULL`, indexed |
| `uf` | String(2) | `NOT NULL`, default `'BA'`, server_default `'BA'` |
| `ncm` | String(8) | `NOT NULL`, indexed (4 a 8 dígitos numéricos) |
| `termos_inclusao` | JSON (`list[str]`) | `NOT NULL`, default `[]` |
| `termos_exclusao` | JSON (`list[str]`) | `NOT NULL`, default `[]` |
| `aliquota` | Numeric(6, 4) | `NOT NULL` (ex.: `0.0200` para 2%) |
| `aplicar_com_termo_acordo` | Boolean | `NOT NULL`, default `True`, server_default `true` |
| `descricao` | String(255) | `NULL` |
| `criado_em` / `atualizado_em` | DateTime | `NOT NULL`, `utcnow_naive` |

Constraints e índices:

- `Index("ix_fcp_perfil_uf_ncm", "perfil_regras_id", "uf", "ncm")`
- `CheckConstraint("aliquota > 0 AND aliquota <= 1", name="ck_fcp_aliquota_intervalo")`
- `CheckConstraint("uf = upper(uf) AND length(uf) = 2", name="ck_fcp_uf")`
- Sem índice único em `(perfil_regras_id, uf, ncm)`: o mesmo NCM pode ter regras distintas com termos diferentes (ex.: `22029900` para refrigerantes/energéticos vs. outra exceção). A duplicata literal é validada na API.

### Tabela `excecoes_fcp_produto`

Modelada em `app/models/regra_fcp_produto.py` (`ExcecaoFcpProduto`):

| Coluna | Tipo | Restrições |
|---|---|---|
| `id` | Integer | PK, autoincrement |
| `regra_fcp_id` | Integer | FK → `regras_fcp_produto.id`, `ON DELETE CASCADE`, `NOT NULL`, indexed |
| `descricao_exata` | String(255) | `NOT NULL`, normalizada via `normalizar()` |
| `enquadrado` | Boolean | `NOT NULL` |
| `observacao` | String(255) | `NULL` |
| `criado_em` / `atualizado_em` | DateTime | `NOT NULL`, `utcnow_naive` |

Constraint: `UniqueConstraint("regra_fcp_id", "descricao_exata", name="uq_excecao_fcp_regra_descricao")`.

### Relaxamento de prefixos em `regras_aliquotas_destino`

A coluna `regras_aliquotas_destino.ncm` já é `String(8)` e o índice `uq_perfil_uf_ncm_normalizado` usa `coalesce(ncm, '')`, portanto não exige alteração de tabela nem migração de banco.

- `app/schemas/validators.py`: adicionar `clean_ncm_prefixo_opcional(v: Optional[str]) -> Optional[str]` (retorna `None` se vazio/nulo; caso contrário remove não-dígitos, exige 4 a 8 dígitos e rejeita todo zerado `0000...`).
- `app/schemas/regra_aliquota.py`: usar `clean_ncm_prefixo_opcional` nos validadores de `ncm` de `RegraAliquotaBase` e `RegraAliquotaUpdate`.

### Contrato de `NotaFiscalProcessada.metadados_extras`

Quando um item (ou linha de CT-e) tiver FCP resolvido (`fcp > 0`), são gravados os seguintes campos em `metadados_extras`:

- `a_dst_base`: string decimal da `A.DST` antes do FCP (ex.: `"0.2500"`).
- `fcp_aliquota`: string decimal do FCP aplicado (ex.: `"0.0200"`), ou `None` quando não houver FCP.
- `fcp_origem`: `"fcp_produto:<id>"` ou `"excecao_fcp:<id>"` (ou `None`).
- `fcp_detalhe`: descrição legível da regra/exceção aplicada (ou `None`).
- `fcp_separado`: booleano (`True` quando apurado na aba `{MM}-{AAAA} FCP` na AT/AT-Antecipado do Regime Normal; `False` quando somado diretamente à `A.DST`).
- `fcp_base_st`: string decimal arredondada em 2 casas da Base ST usada no cálculo do FCP separado (quando `fcp_separado = True`).
- `fcp_valor_devido`: string decimal arredondada em 2 casas de `round_currency(base_st * fcp_aliquota)` (quando `fcp_separado = True`).

Quando `fcp_separado = True`:

- Os campos da linha persistida (`a_dst_resolvida`, `debito`, `credito`, `valor_devido`) mantêm **exclusivamente** os valores da aba principal de ICMS AT (`a_dst = a_dst_base`, com seu respectivo crédito e débito), garantindo que `SolicitacaoSaida.total_valor_devido` represente somente o DAE de ICMS AT e que `regenerate()` reconstrua tanto a aba principal quanto a aba `{MM}-{AAAA} FCP` a partir de `NotaFiscalProcessada`.
- Quando `fcp_separado = False` (AT Simples Nacional, Antecipação Parcial ou DIFAL), `a_dst_resolvida` já é `a_dst_base + fcp_aliquota`, e `debito`, `credito` e `valor_devido` refletem a alíquota total somada.

## Contratos de API, Preset Bebidas BA e Cópia entre perfis

### Schemas e Endpoints `/api/v1/regras-fcp`

- `app/schemas/regra_fcp_produto.py`:
  - `ExcecaoFcpCreate`, `ExcecaoFcpOut` (espelho de `ExcecaoReducaoCreate` / `ExcecaoReducaoOut`).
  - `RegraFcpBase`, `RegraFcpCreate`, `RegraFcpUpdate`, `RegraFcpOut`:
    - `perfil_regras_id: int`
    - `uf: str` (default `"BA"`, validada via `clean_uf`)
    - `ncm: str` (validada via `clean_ncm_prefixo_obrigatorio`)
    - `termos_inclusao: List[str]` (normalizada via `normalizar_termos`)
    - `termos_exclusao: List[str]` (normalizada via `normalizar_termos`)
    - `aliquota: Decimal` (validada via `normalizar_aliquota`, e deve ser `> 0` e `<= 1`)
    - `aplicar_com_termo_acordo: bool = True`
    - `descricao: Optional[str]`
  - `PresetBebidasBaResultado`: `{fcp_criadas: int, fcp_ignoradas: int, aliquotas_criadas: int, aliquotas_ignoradas: int}`.
- `app/api/endpoints/regras_fcp.py` (registrado em `app/api/router.py`, protegido com `Depends(get_current_user)`):
  - `GET /regras-fcp?perfil_id=&uf=&ncm=` (com `selectinload(RegraFcpProduto.excecoes)`)
  - `GET /regras-fcp/{id}`
  - `POST /regras-fcp` → HTTP 201; retorna HTTP 409 em duplicata literal (mesmo `perfil_regras_id`, `uf`, `ncm` e `sorted(termos_inclusao)`).
  - `PUT /regras-fcp/{id}` → atualiza campos e valida conflito literal (HTTP 409).
  - `DELETE /regras-fcp/{id}` → HTTP 204.
  - `POST /regras-fcp/{id}/excecoes` → normaliza `descricao_exata`, retorna HTTP 201 ou HTTP 409 se já existir para a regra.
  - `DELETE /regras-fcp/{id}/excecoes/{excecao_id}` → HTTP 204.
  - `POST /regras-fcp/preset-bebidas-ba?perfil_regras_id=` → popula de forma idempotente as regras FCP 2% e as exceções base 25% BA abaixo, retornando `PresetBebidasBaResultado`.

### Preset "Carregar padrão Bebidas BA (2%)"

Para `uf = "BA"` e `aplicar_com_termo_acordo = True` (pulando qualquer regra cuja chave de duplicidade já exista no perfil):

**Regras de FCP (`aliquota = 0.0200`):**

| NCM | `termos_inclusao` | `termos_exclusao` | Descrição |
|---|---|---|---|
| `2203` | `[]` | `[]` | FCP 2% — Cervejas de malte (Lei BA 7.014/96, art. 16-A) |
| `2204` | `[]` | `[]` | FCP 2% — Vinhos de uvas frescas (Lei BA 7.014/96, art. 16-A) |
| `2205` | `[]` | `[]` | FCP 2% — Vermutes e vinhos aromatizados (Lei BA 7.014/96, art. 16-A) |
| `2206` | `[]` | `[]` | FCP 2% — Outras bebidas fermentadas (Lei BA 7.014/96, art. 16-A) |
| `2208` | `[]` | `[]` | FCP 2% — Aguardentes, destilados e licores (Lei BA 7.014/96, art. 16-A) |
| `22029100` | `[]` | `[]` | FCP 2% — Cervejas e chopes sem álcool (Lei BA 7.014/96, art. 16-A) |
| `22021000` | `["refrigerant*", "refri", "cola", "guarana", "soda", "tonica", "isoton*", "energetic*", "energy", "gatorade", "powerade", "red bull", "monster", "tnt", "fanta", "sprite", "pepsi", "coca", "schweppes"]` | `["agua mineral"]` | FCP 2% — Refrigerantes, isotônicos e energéticos (NCM 2202.10.00) |
| `22029900` | `["refrigerant*", "isoton*", "hidroeletrolit*", "energetic*", "energy", "gatorade", "powerade", "red bull", "monster", "tnt", "chopp sem alcool", "chope sem alcool"]` | `["agua mineral", "suco natural", "polpa", "agua de coco"]` | FCP 2% — Demais refrigerantes, isotônicos, energéticos e chopes sem álcool (NCM 2202.99.00) |

**Exceções base de ICMS (`regras_aliquotas_destino`, `uf = "BA"`, `aliquota = 0.2500`):**

| NCM | Descrição |
|---|---|
| `2203` | Bebidas alcoólicas — Cervejas de malte (ICMS base BA 25%) |
| `2204` | Bebidas alcoólicas — Vinhos (ICMS base BA 25%) |
| `2205` | Bebidas alcoólicas — Vermutes (ICMS base BA 25%) |
| `2206` | Bebidas alcoólicas — Outras bebidas fermentadas (ICMS base BA 25%) |
| `2208` | Bebidas alcoólicas — Destilados, aguardentes e licores (ICMS base BA 25%) |

### Cópia, Duplicação e Contexto do Processamento Local

- `app/services/copia_regras.py` e `app/schemas/perfil_regras.py`: incluir `"fcp"` em `SECOES` e na validação de `PerfilRegrasCopiarRegras.secao`:
  - Relação: `"regras_fcp_produto"`, modelo `RegraFcpProduto`, chave de duplicidade `lambda r: (r.uf, r.ncm, _termos(r.termos_inclusao))`.
  - `clonar_regras_perfil` e `copiar_regras` já clonam `regra.excecoes` quando presente o atributo `excecoes`, mantendo atomicidade na duplicação de perfil e cópia seletiva/em lote.
- `app/api/endpoints/processamento_local.py`, `app/schemas/local_processing.py` (`LocalRegraFcpOut`, `LocalExcecaoFcpOut`, campo `regras_fcp` em `LocalProcessingContextOut`) e `frontend/src/types/localProcessing.ts`: incluir `regras_fcp` carregadas com `joinedload(RegraFcpProduto.excecoes)` no payload de `/api/v1/processamento-local/contexto`.

## Motor de regras, Pipeline e CT-e (Paridade Python + TypeScript)

Toda alteração no motor fiscal deve ser implementada de forma idêntica em Python (`app/services/`) e em TypeScript (`frontend/src/lib/localProcessing/`).

### 1. Exceções por NCM com prefixo (Nível 3a de `A.DST`)

Em `AliquotaResolver._nivel_padrao` (`app/services/rules_engine/aliquota_resolver.py`) e `resolveStandardDestinationRate` (`frontend/src/lib/localProcessing/rules.ts`):

- Normalizar `clean_ncm` removendo não-dígitos.
- Buscar todas as regras de `RegraAliquotaDestino` da `(perfil_regras_id, uf)` cujo `ncm` não vazio satisfaça `clean_ncm.startswith(regra.ncm)`.
- Se houver correspondências, escolher a de maior `len(regra.ncm)` (ex.: `22030000` vence `2203`, que vence `padrao_uf`). Como `uq_perfil_uf_ncm_normalizado` impede duas regras com mesmo `(perfil, uf, ncm)`, o desempate por maior comprimento é sempre único.
- Na ausência de regra com `ncm`, cair para a regra padrão da UF (`ncm IS NULL`).

### 2. Resolução de FCP (`resolve_fcp`)

Em `AliquotaResolver.resolve_fcp` (`aliquota_resolver.py`, carregando `self._fcp_perfil` em `preload`) e `resolveFcp` (`rules.ts`):

- Entrada: `(perfil_regras_id, uf, ncm, descricao, empresa_tem_termo_acordo)`.
- Filtrar regras do perfil onde `regra.uf == clean_uf` e `clean_ncm.startswith(regra.ncm)` (exigindo `len(clean_ncm) >= 4` e não todo zerado, igual a `_regras_reducao`).
- Se `empresa_tem_termo_acordo` for verdadeiro, descartar regras com `aplicar_com_termo_acordo == False`.
- Aplicar exatamente a mesma precedência de `_nivel_reducao_produto`:
  1. **Exceção por descrição exata** (`descricao` confiável e normalizada):
     - Se houver mais de uma exceção `enquadrado=True` → `_resolver_colisao` (mesmo `% FCP` aplica e gera aviso de cadastro; valores diferentes lançam `RuleResolutionException` / `Error`).
     - Se houver uma exceção `enquadrado=True` → retorna `ResolucaoAliquota(aliquota=regra.aliquota, origem=f"excecao_fcp:{exc.id}", detalhe=...)`.
     - Regras com exceção `enquadrado=False` para aquela descrição são removidas dos passos seguintes.
  2. **Regras com `termos_inclusao`** (quando há `descricao` confiável):
     - Casa qualquer termo de inclusão e nenhum de exclusão → escolhe as de maior `len(regra.ncm)`; havendo mais de uma de mesmo tamanho → colisão (aviso se mesmo valor, erro explícito se valores diferentes).
  3. **Regras genéricas (`termos_inclusao == []`)**:
     - Exclui se algum termo de `termos_exclusao` casar com a `descricao` confiável → escolhe maior `len(regra.ncm)`; havendo mais de uma → colisão (aviso se mesmo valor, erro se valores diferentes).
- Se nenhuma regra casar, retorna `None`.

### 3. Aplicação no Pipeline (`pipeline_service.py` e `processor.ts`)

Para cada item após resolver `a_dst` base (`resolucao` / `effectiveADst`):

1. Avaliar `resolucao_fcp = resolve_fcp(...)` (respeitando `item.descricao_confiavel` e `empresa.termo_acordo is not None`). Emitir `avisos_avaliacao` caso `resolucao_fcp.aviso` esteja presente.
2. Definir `fcp_aliquota = resolucao_fcp.aliquota` (ou `Decimal("0.00")` / `0`).
3. Definir modo de aplicação:
   - `is_tributaria_regime_normal = (destino_item in DESTINOS_TRIBUTARIA) and (not empresa.optante_simples_nacional)`
   - Se `fcp_aliquota > 0` e `is_tributaria_regime_normal`:
     - `fcp_separado_item = fcp_aliquota` (para compor a `GrupoKey` / `groupKey`).
     - `a_dst_principal = a_dst_base` (mantém 25% ou 20,5% na aba principal).
   - Se `fcp_aliquota > 0` e **não** `is_tributaria_regime_normal` (AT Simples Nacional, Parcial ou DIFAL):
     - `fcp_separado_item = None`.
     - `a_dst_principal = a_dst_base + fcp_aliquota` (ex.: `25% + 2% = 27%`, `20,5% + 2% = 22,5%`).
4. **Interação com outras regras:**
   - **Grupo de consolidação (`GrupoKey` / `groupKey`):** inclui `(destino, a_ori, a_dst_principal, mva, [convenio_52_91_applied em TS], reducao, fcp_separado_aliquota)`. Assim, itens com FCP e sem FCP na mesma NF-e de AT Regime Normal nunca se fundem na mesma linha.
   - **Condição Numérica de Alíquotas Iguais (Parcial):** executada após `a_dst_principal = a_dst_base + fcp_aliquota`. Se um item tinha `A.ORI = 12%` e `A.DST base = 12%`, mas recebeu `+2% FCP` (`A.DST = 14%`), ele não será excluído por alíquotas iguais.
   - **Limitar A.ORI a 10%:** continua olhando `origem` da alíquota base (`reducao_produto:`, `excecao:`, `termo_acordo:`) antes/independentemente do FCP; se `A.ORI == a_dst_principal`, dispensa o limite conforme regra existente.
   - **Convênio ICMS 52/91 (TS):** se o item casar com uma regra de FCP, o `% FCP` soma sobre a `aDst` resultante do convênio na Parcial/DIFAL.
   - **`SanityChecker.validate_numeric_values`:** valida `0 <= a_dst_principal <= 1` e `0 <= fcp_separado <= 1`.
5. **Cálculo e geração da linha FCP na consolidação (AT Regime Normal):**
   - Calcula normalmente a linha principal com `a_dst_principal`.
   - Se `destino in DESTINOS_TRIBUTARIA`, `calculate()` não gerou imposto positivo e o grupo foi descartado (ex.: `exclude_st_tributaria_note`, `mva_pendente`, ou em TS quando `valor_pago` / ICMS ST cobre o imposto e `valorDevido <= 0`), não gera linha nem metadado de FCP separado.
   - Caso contrário, se `fcp_separado_aliquota > 0`:
     - Calcula `fcp_calc = AntecipacaoTributariaCalculator.calculate(..., a_ori=0, a_dst=fcp_separado_aliquota, valor_pago=0)` (mesmos `v_total`, `base_calculo`, `ipi_despesas`, `mva` e `reducao` do grupo).
     - Grava em `NotaFiscalProcessada.metadados_extras`: `a_dst_base`, `fcp_aliquota`, `fcp_origem`, `fcp_detalhe`, `fcp_separado=True`, `fcp_base_st=fcp_calc.detalhes["base_st"]`, `fcp_valor_devido=str(fcp_calc.valor_devido)`.
     - Adiciona linha paralela em `fcp_rows_por_destino[destino_grupo]` (mesmos dados da linha principal, porém `a_dst = fcp_separado_aliquota`, `a_ori = Decimal("0.00")`, `debito = fcp_calc.debito`, `credito = Decimal("0.00")`, `valor_devido = fcp_calc.valor_devido`, `valor_pago = Decimal("0.00")`).

### 4. CT-e (`pipeline_cte.py` e `cteProcessing.ts`)

1. **`avaliar_nfe_para_cte` / `evaluateNfeForCte`:**
   - Além dos campos atuais de cada candidato AT (`mva`, `reducao`, `a_dst`, `mva_grupo`, `mva_fonte`), registra `v_total: item.v_total`, `fcp: fcp_aliquota` (resolvido via `resolve_fcp`), `fcp_origem` e `fcp_detalhe`.
2. **Emissão para Regime Normal (`not empresa.optante_simples_nacional`):**
   - Linha principal do CT-e na aba principal AT permanece idêntica (`a_dst` padrão da UF, `ratio_trib = 1` se todos os itens das NF-es são AT, senão `soma_trib / v_total_nfes`).
   - Agrupa os candidatos AT com `fcp > 0` por `fcp`:
     - Para cada `fcp > 0`, calcula `soma_fcp = sum(cand["v_total"] for cand in candidatos_fcp)`.
     - `ratio_fcp = 1` se todos os itens de todas as NF-es originárias do CT-e forem AT com exatamente aquele `fcp`; caso contrário `min(1, soma_fcp / v_total_nfes)`.
     - `v_total_cte_fcp = cte.v_total_cte` (se `ratio_fcp == 1`) ou `round_currency(cte.v_total_cte * ratio_fcp)`.
     - Herda `max_mva` e `reducao` dentre os `candidatos_fcp`.
     - Calcula `fcp_calc = AntecipacaoTributariaCalculator.calculate(v_total=v_total_cte_fcp, base_calculo=v_bc_cte_fcp, ipi_despesas=0, a_ori=0, a_dst=fcp, mva=max_mva_fcp, reducao=reducao_fcp, valor_pago=0)`.
     - Emite linha em `fcp_rows_por_destino[destino_trib]` com `a_dst = fcp`, `a_ori = 0`, `debito = fcp_calc.debito`, `credito = 0`, `valor_devido = fcp_calc.valor_devido`.
     - Para garantir reconstrução fiel na regeneração (`regenerate`), quando houver exatamente 1 faixa de `fcp > 0` vinculada ao CT-e, seus metadados (`fcp_separado=True`, `fcp_aliquota`, `fcp_base_st`, `fcp_valor_devido`, `fcp_cte_v_total`, `fcp_cte_mva`, `fcp_cte_reducao`, `fcp_percentual_rateio`) são gravados em `metadados_extras` da `NotaFiscalProcessada` do CT-e. Se um mesmo CT-e cobrir NF-e com múltiplas alíquotas distintas de FCP (`> 0`), `metadados_extras["fcp_parcelas"]` armazena a lista de parcelas para regeneração exata de todas as linhas na aba FCP.
3. **Emissão para Simples Nacional (`empresa.optante_simples_nacional`):**
   - Agrupa `all_candidates` de AT por `fcp` (`0` para itens sem FCP, `> 0` para itens com FCP).
   - Se existir apenas 1 grupo (todos sem FCP ou todos com o mesmo FCP): emite 1 linha de CT-e usando `a_dst = a_dst_padrao + fcp` e registra `fcp_aliquota` nos metadados quando `fcp > 0`.
   - Se existir mais de 1 grupo (NF-e originária mista com parte sem FCP e parte com FCP): emite 1 linha proporcional por grupo (`ratio_grupo`, `a_dst = a_dst_padrao + fcp_grupo`, `max_mva` e `reducao` do grupo).

## Geração Excel, Regeneração e Preencher Datas de Entrada

### 1. Python (`TemplateFiller` e `PipelineOutputService`)

- **`TemplateFiller.fill_template(..., fcp_rows: Optional[List[Dict[str, Any]]] = None)`** (`app/services/excel/template_filler.py`):
  - Abre o workbook, extrai `original_formula_map = FormulaGuard.extract_formula_map(workbook)` e seleciona `worksheet, month, year = select_worksheet(...)`.
  - Quando `fcp_rows` for não vazio:
    - Clona `fcp_worksheet = workbook.copy_worksheet(worksheet)` **antes** de preencher os dados de `worksheet` e **antes** de remover as demais abas.
    - Garante preservação das imagens/logo em ambas as abas (`worksheet` e `fcp_worksheet`).
    - Define o título da aba FCP: `f"{month:02d}-{year} FCP"` (quando `month` e `year` estiverem definidos; caso contrário `f"{original_title} FCP"`).
  - Ao preencher qualquer aba (`worksheet` ou `fcp_worksheet`), após escrever as `N` linhas em `start_row .. start_row + N - 1`, limpar os valores das colunas mapeadas (exceto `item_index` e células com fórmula) nas linhas residuais do template a partir de `start_row + N` até o fim da grade de dados do modelo, evitando que linhas de exemplo pré-existentes (como ocorre no `modelo_padrao_antecipacao_tributaria.xlsx`) permaneçam visíveis na aba gerada ou clonada.
  - Remove as demais abas (`sheet not in {worksheet, fcp_worksheet}`).
  - Valida integridade de fórmulas no `FormulaGuard.verify_wb_integrity(expected_formula_map, workbook)` incluindo tanto `worksheet.title` quanto `fcp_worksheet.title` (ambas mapeadas contra `original_formula_map[original_title]`).
- **`PipelineOutputService`** (`app/services/pipeline_outputs.py`):
  - `generate(..., fcp_rows_by_destination: Optional[Mapping[str, List[Dict[str, Any]]]] = None)`:
    - Para `antecipacao_tributaria` e `antecipacao_tributaria_antecipado`, calcula `fcp_rows` e seleciona o template usando `required_rows = max(len(rows), len(fcp_rows))`.
    - Passa `fcp_rows=fcp_rows` para `TemplateFiller.fill_template`.
  - `regenerate(solicitacao)`:
    - Ao reconstruir saídas de `antecipacao_tributaria` e `antecipacao_tributaria_antecipado`, extrai as linhas FCP diretamente das `NotaFiscalProcessada` daquele destino com `metadados_extras.get("fcp_separado") is True` (suportando também `fcp_parcelas` em CT-e), preservando `data_entrada` atualizada, ordenação `nfe_sort_key` e gravando a aba `{MM}-{AAAA} FCP`.

### 2. TypeScript no Browser (`xlsx.ts` e `processor.ts`)

- **`fillTemplateLocally(templateBytes, template, rows, header, fcpRows?)`** (`frontend/src/lib/localProcessing/xlsx.ts`):
  - Lê o XML original da aba selecionada (`selected.path`) **antes** de gravar as linhas principais.
  - Se `fcpRows?.length`:
    - Cria cópia do XML original da aba selecionada em `xl/worksheets/sheet{nextIdx}.xml` (e duplica `xl/worksheets/_rels/{sheetFile}.rels` se existir, preservando desenhos/logos da aba).
    - Registra a nova aba em `xl/workbook.xml` (`<sheet name="{MM}-{AAAA} FCP" sheetId="{nextId}" r:id="{nextRelId}"/>`), o relacionamento em `xl/_rels/workbook.xml.rels` e o `<Override>` em `[Content_Types].xml`.
    - Preenche cabeçalho (`headerCell`) e linhas de `fcpRows` na aba clonada, e limpa valores não-fórmula das colunas de dados mapeadas (exceto `item_index` e células com `<f>`) nas linhas excedentes após `startRow + count`.
  - Renomeia a aba principal no `workbook.xml` para `{MM}-{AAAA}` quando aplicável (mesmo critério de `template_filler.py`).
  - Generaliza `keepOnlyPeriodSheetVisible` para manter visíveis todas as abas geradas (`[selected, fcpSheet]` quando há FCP, ou `[selected]` caso contrário) e oculta apenas as demais.
- **`generateOutputArtifacts`** (`frontend/src/lib/localProcessing/processor.ts`):
  - Recebe `fcpRowsByDestination`, ordena via `sortRowsByEntryAndNumber`, escolhe template com `Math.max(rows.length, fcpRows.length)` e repassa `fcpRows` para `fillTemplateLocally`.

### 3. Preencher Datas de Entrada em Planilhas Prontas (`entryDateFiller.ts`)

Em `frontend/src/lib/localProcessing/entryDateFiller.ts`:

- Quando o arquivo `.xlsx` possuir uma aba principal visível e uma segunda aba visível cujo nome termine com ` FCP` (case-insensitive), `fillAndReorderEntryDatesInXlsx` processa e reordena **ambas** as abas no mesmo arquivo `.xlsx`, mantendo as datas de entrada e a ordem sincronizadas entre a aba principal e a aba `{MM}-{AAAA} FCP`.

## Interface Frontend

### 1. Perfis de Regras (`PerfisRegras`)

- **Tipos e API:** `frontend/src/types/regraFcp.ts`, `frontend/src/api/regrasFcp.ts` e chave `regrasFcp: (perfilId?: number) => ['regras-fcp', perfilId] as const` em `frontend/src/api/queryKeys.ts`. Atualizar `CopiarRegrasSecao` em `frontend/src/types/perfil.ts` e `REGRAS_QUERY_PREFIXES` em `CopiarRegrasButton.tsx` para incluir `'fcp'`.
- **Nova seção `FcpSection.tsx` + `useFcpSection.ts`:**
  - Adicionada na seção `Alíquota de destino (A.DST)` em `frontend/src/pages/PerfisRegras/index.tsx` (`SectionKey` `'fcp'` em `SECTION_KEYS`), como `Card` colapsável.
  - Tabela de regras: `UF`, `NCM / Prefixo`, `Termos de inclusão`, `Termos de exclusão`, `% FCP`, `Termo de Acordo` (`Sim` / `Não`), `Descrição`, `Exceções por descrição` e `Ações` (copiar, editar, excluir).
  - Header com `CopiarRegrasButton` (`secao="fcp"`), botão **"Carregar padrão Bebidas BA (2%)"** (com modal/confirmação simples e banner de resultado mostrando regras FCP e exceções 25% inseridas/existentes, invalidando `regrasFcp` e `regrasAliquotas`) e botão **"Nova regra FCP"**.
  - Modal criar/editar regra FCP: `UF` (padrão `BA`), `NCM ou prefixo (4 a 8 dígitos)`, `Termos de inclusão`, `Termos de exclusão`, `Alíquota FCP (%)` (padrão `2,00`), checkbox **"Aplicar quando empresa tiver Termo de Acordo"** (marcado por padrão) e `Descrição`.
  - Modal de exceção por descrição exata (`Enquadrado no FCP` / `Fora do FCP`).
- **Exceções Tributárias por NCM com prefixo:**
  - Atualizar `ExcecoesNcmCard` (`AliquotasSectionCards.tsx`), `PerfisRegrasModals.tsx` e `regraSchema` em `usePerfisRegrasPage.ts` para aceitar NCM de **4 a 8 dígitos** (placeholder `Ex: 2203 ou 84713012`, helper text explicando que o prefixo mais específico vence).

### 2. Resultado da Solicitação e Histórico (`ReviewAndResultStep.tsx` e `SolicitacaoDetalheModal.tsx`)

- **Cards de saída (`ReviewAndResultStep.tsx`):**
  - Calcular `totalFcpSeparado` por `saida.tipo` somando `Number(n.metadados_extras?.fcp_valor_devido ?? 0)` (e eventuais `fcp_parcelas` de CT-e) nas `notas_processadas` daquele destino com `metadados_extras?.fcp_separado === true`.
  - Manter o `Valor Devido` do card exibindo apenas `saida.total_valor_devido` (ICMS AT). Quando `totalFcpSeparado > 0`, renderizar logo abaixo uma linha destacada: `FCP (aba {MM}-{AAAA} FCP): {formatCurrency(totalFcpSeparado)}`.
- **Conferência de Notas (`ReviewAndResultStep.tsx` e `SolicitacaoDetalheModal.tsx`):**
  - Quando `item.metadados_extras?.fcp_aliquota` for positivo:
    - Se `fcp_separado === true`: exibir badge discreto `+2% FCP (aba FCP)` abaixo de `A.DST` e o valor `FCP: R$ X,XX` abaixo de `Valor Devido`.
    - Se `fcp_separado === false`: exibir indicação `(inclui +2% FCP)` abaixo de `A.DST`.
  - Em `SolicitacaoDetalheModal.tsx`, incluir o total de FCP separado como destaque secundário informativo no resumo quando houver FCP separado, sem alterar o card de `Valor Devido Total` do ICMS AT.

## Estratégia de testes e verificação

### Backend (`pytest`)

1. **Migração e schema:** verificar criação das tabelas `regras_fcp_produto` e `excecoes_fcp_produto` em `028_regras_fcp_produto.py` e checagens de `CheckConstraint`.
2. **CRUD, preset e cópia (`tests/test_regras_fcp_api.py`):**
   - CRUD completo de regras FCP e exceções por descrição exata (incluindo conflito 409).
   - `POST /api/v1/regras-fcp/preset-bebidas-ba` idempotente (cria 8 regras FCP + 5 exceções 25% na primeira chamada; 0 criadas e contagem ignoradas na segunda).
   - Cópia de seção `"fcp"` via `/perfis-regras/{id}/copiar-regras` e duplicação de perfil preservando regras FCP + exceções.
   - `Exceções Tributárias por NCM` aceitando prefixos de 4–8 dígitos (`2203`) e desempate pelo mais específico (`22030000` vence `2203`).
3. **Motor de regras (`tests/test_fcp_resolver.py`):**
   - Precedência de FCP: exceção exata (`True`/`False`) > termos inclusão/exclusão > genérica por maior prefixo NCM; filtragem por UF; comportamento com `descricao_confiavel=False`.
   - Flag `aplicar_com_termo_acordo`: soma quando `True`, ignora quando `False` e empresa tem `termo_acordo`.
   - Colisão de regras FCP: aviso quando valores iguais, `RuleResolutionException` quando valores divergem.
4. **Pipeline, CT-e e Excel (`tests/test_fcp_pipeline.py`):**
   - **AT Regime Normal:** bebida alcoólica (base `25%` + FCP `2%`) e refrigerante (`20,5%` + FCP `2%`) geram aba principal `{MM}-{AAAA}` com alíquota base e aba `{MM}-{AAAA} FCP` no mesmo `.xlsx` com `A.DST = 2%`, `A.ORI = 0%`, mesma MVA/Redução e `FormulaGuard` válido em ambas as abas; água mineral (`22011000`) fica só na aba principal com `20,5%` sem ir para aba FCP.
   - **AT Simples Nacional:** bebidas com FCP somam direto na `A.DST` (`27%` / `22,5%`), sem aba FCP.
   - **AT sem itens com FCP:** nenhuma aba FCP criada.
   - **Antecipação Parcial e DIFAL (Normal e Simples):** somam `% FCP` na `A.DST`; interação correta com `Condição Numérica de Alíquotas Iguais` (`12%` vs `12% + 2% = 14%` não exclui).
   - **CT-e na AT:** NF-e mista (bebida com FCP + mercadoria sem FCP) gera linha proporcional do CT-e na aba FCP (Regime Normal) e desdobramento proporcional no Simples Nacional.
   - **Regeneração:** atualizar data de entrada manualmente em solicitação AT Regime Normal com FCP regenera o `.xlsx` preservando as duas abas atualizadas e ordenadas.

### Frontend (`npm test`, `npm run lint`, `npm run build`)

- Testes em `frontend/tests/` cobrindo paridade completa do motor TypeScript:
  - `resolveStandardDestinationRate` com prefixos NCM de 4–8 dígitos.
  - `resolveFcp` (exceções, termos, prefixos, `aplicar_com_termo_acordo`, colisão).
  - `processor.ts` (AT Normal gerando `fcpRows` separadas e metadados, AT Simples somando `27%`/`22,5%`, Parcial, DIFAL).
  - `cteProcessing.ts` (CT-e AT Normal com aba FCP e CT-e AT Simples misto).
  - `xlsx.ts` (`fillTemplateLocally` criando segunda aba `{MM}-{AAAA} FCP` válida em XML/ZIP, mantendo imagens/fórmulas e visibilidade de ambas as abas, limpando células de exemplo residuais).
  - `entryDateFiller.ts` (preenchendo e reordenando simultaneamente aba principal e aba `* FCP`).
- Verificação estática obrigatória: `npm run lint` e `npm run build`.
