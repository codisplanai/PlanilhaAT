# Alíquotas reduzidas: termo de acordo por empresa e redução por produto

Data: 2026-09-03
Status: aprovado, aguardando plano de implementação

## Problema

A alíquota de destino (A.DST) hoje é resolvida por dois níveis: exceção por
`(perfil, UF, NCM)` e padrão por `(perfil, UF)`. Dois casos reais não cabem
nesse modelo:

1. **Termo de acordo / regime especial.** Uma empresa específica tem uma carga
   efetiva diferente das demais do mesmo estado (ex.: 12,06% em vez de 18%).
   Hoje só seria possível criando um perfil de regras dedicado àquela empresa,
   o que duplica todas as regras de UF, NCM e CFOP e transforma qualquer
   mudança de alíquota geral em edição manual de N perfis.

2. **Redução por produto.** Um documento oficial lista NCMs com alíquota
   reduzida (ex.: 12,00%), mas o enquadramento depende também da **descrição**
   do produto: o mesmo NCM comporta mercadorias que se enquadram e mercadorias
   que não. NCM sozinho é insuficiente, e o índice único atual
   (`uq_perfil_uf_ncm_normalizado`) impede duas regras para o mesmo NCM.

## Decisões

Tomadas em brainstorming antes deste documento:

| # | Decisão | Consequência |
|---|---|---|
| 1 | Precedência **produto > empresa > padrão da UF** | Três níveis; o termo de acordo é o piso geral da empresa |
| 2 | **Determinístico**, sem decisão em tempo de processamento | Produto não cadastrado usa a alíquota normal; nada é perguntado no meio do pipeline |
| 3 | Chave do cadastro: **NCM + termos da descrição, com exceções** | Uma regra cobre o volume; exceções tratam o caso raro |
| 4 | **Sem vigência agora**, com espaço reservado no schema | Colunas `vigencia_*` existem no banco mas não são expostas |

Decisão adicional derivada da #4: as colunas de vigência **não aparecem na API
nem na tela**. Um campo exposto que não filtra nada é pior do que campo
nenhum — o usuário preencheria acreditando que funciona.

## Não faz parte deste escopo

- Filtro por vigência no cálculo (schema preparado, comportamento não
  implementado).
- Exceções por código do fornecedor (`cProd` / `COD_ITEM`). Ficam de fora:
  exigiriam extrair campos hoje descartados e não funcionam em SPED
  consolidado. Exceção é por descrição exata.
- Redução de base de cálculo como conceito separado. `Débito = V.Total × A.DST`
  (`antecipacao_parcial.py:24`), então a redução é representada como uma A.DST
  efetiva menor sobre o valor cheio — aritmeticamente equivalente e sem tocar a
  camada de cálculo.
- Refactor das seções existentes de `PerfisRegras/index.tsx`.
- Endpoint de simulação (`POST /regras-reducao-produto/simular`), que permitiria
  testar um termo contra uma descrição sem processar um mês inteiro. Cortado
  para reduzir o primeiro entregável; a conferência de um termo recém-cadastrado
  passa a depender de rodar uma solicitação e olhar `origem_a_dst` em
  `metadados_extras`. Candidato natural a v2.

## Arquitetura

Três níveis de resolução, cada um com sua própria tabela e responsabilidade:

| Nível | Tabela | Escopo | Vence |
|---|---|---|---|
| 1 | `regras_reducao_produto` (+ `excecoes_reducao_produto`) | perfil | níveis 2 e 3 |
| 2 | `regras_aliquotas_empresa` | empresa | nível 3 |
| 3 | `regras_aliquotas_destino` (**existente, intocada**) | perfil | — |

`regras_aliquotas_destino` não recebe coluna, índice nem migração de dados. O
nível 3 é o código atual sem alteração: **quem não cadastrar nada tem o
comportamento de hoje, bit a bit.**

A lista de reduções é **por perfil**, não por empresa — ela vem de um documento
oficial do estado e é a mesma para todos os contribuintes daquele perfil. O que
é da empresa é apenas o termo de acordo.

## Modelo de dados

Migração `alembic/versions/010_aliquotas_reduzidas.py`,
`down_revision = "009_integrity_constraints"`.

### `regras_reducao_produto`

| Coluna | Tipo | Restrições |
|---|---|---|
| `id` | Integer | PK, autoincrement |
| `perfil_regras_id` | Integer | FK → `perfis_regras`, ON DELETE CASCADE, NOT NULL, indexed |
| `ncm` | String(8) | NOT NULL, indexed |
| `termos_inclusao` | JSON `list[str]` | NOT NULL, não pode ser lista vazia |
| `termos_exclusao` | JSON `list[str]` | NOT NULL, default `[]` |
| `aliquota` | Numeric(6,4) | NOT NULL, CHECK entre 0 e 1 |
| `descricao` | String(255) | NULL — rótulo humano ("Vergalhões — Decreto 12.345") |
| `vigencia_inicio` | Date | NULL, reservado |
| `vigencia_fim` | Date | NULL, reservado |
| `criado_em` / `atualizado_em` | DateTime | NOT NULL |

**Sem índice único em `(perfil_regras_id, ncm)`**, intencionalmente: o mesmo NCM
precisa comportar mais de uma regra (ex.: `7214.20` com "vergalhão" a 12% e
"barra chata" a 18%). A unicidade validada na API é duplicata literal — mesmo
perfil, mesmo NCM, mesmo conjunto de `termos_inclusao` normalizado.

Índice de busca em `(perfil_regras_id, ncm)`.

### `excecoes_reducao_produto`

| Coluna | Tipo | Restrições |
|---|---|---|
| `id` | Integer | PK, autoincrement |
| `regra_reducao_id` | Integer | FK → `regras_reducao_produto`, ON DELETE CASCADE, NOT NULL, indexed |
| `descricao_exata` | String(255) | NOT NULL, gravada já normalizada |
| `enquadrado` | Boolean | NOT NULL |
| `observacao` | String(255) | NULL |
| `criado_em` / `atualizado_em` | DateTime | NOT NULL |

Único em `(regra_reducao_id, descricao_exata)`.

Os dois sentidos de `enquadrado` são necessários:

- `False` — o item casa os termos mas não se enquadra (`"VERGALHAO DE COBRE"`).
- `True` — o item se enquadra mas nenhum termo razoável o pegaria (`"VG CA50 10.0"`).

Como a exceção é consultada antes dos termos, ela funciona como escape para
qualquer erro de matching sem exigir alteração numa regra que já atende
corretamente os demais itens.

### `regras_aliquotas_empresa`

| Coluna | Tipo | Restrições |
|---|---|---|
| `id` | Integer | PK, autoincrement |
| `empresa_id` | Integer | FK → `empresas`, ON DELETE CASCADE, NOT NULL, **único** |
| `aliquota` | Numeric(6,4) | NOT NULL, CHECK entre 0 e 1 |
| `descricao` | String(255) | NULL — "Termo de Acordo nº 123/2025" |
| `vigencia_inicio` | Date | NULL, reservado |
| `vigencia_fim` | Date | NULL, reservado |
| `criado_em` / `atualizado_em` | DateTime | NOT NULL |

**Sem coluna `uf`**: na tabela de perfil a UF existe porque um perfil serve
empresas de estados diferentes; aqui o escopo já é uma empresa, que tem uma UF
só em `empresas.uf`. Repetir criaria fonte de divergência.

O único em `empresa_id` significa "uma empresa tem no máximo um termo de
acordo". Ligar vigência no futuro exige trocá-lo por
`(empresa_id, vigencia_inicio)` — migração trivial, sem tocar dados. Foi
preferido travar agora a aceitar duas linhas sem regra de desempate.

### Relacionamentos

- `PerfilRegras.regras_reducao_produto` — lista, `cascade="all, delete-orphan"`
- `RegraReducaoProduto.excecoes` — lista, `cascade="all, delete-orphan"`
- `Empresa.regras_aliquotas_empresa` — lista (não 1:1, já pensando na
  vigência), `cascade="all, delete-orphan"`

## Matching de descrição

Módulo novo `app/services/rules_engine/descricao_matcher.py`: funções puras,
sem banco, testáveis isoladamente.

### Normalização

Aplicada à descrição do item e aos termos cadastrados, na gravação e na
leitura:

1. `unicodedata.normalize("NFKD", texto)` e descarte de marcas combinantes
2. maiúsculas
3. `re.sub(r"[^A-Z0-9]+", " ", s)`
4. `strip()`

```
"Vergalhão CA-50 10,0mm"  →  "VERGALHAO CA 50 10 0MM"
```

Pontuação virando espaço é o que faz `"VERG. CA50"` e `"VERG CA50"`
convergirem.

### Casamento por token

Substring simples é armadilha: `"ferro"` casaria `"FERROVIARIO"`, `"aco"`
casaria `"ACOLCHOADO"`. O termo casa como **sequência de tokens completos**,
implementada como regex montado a partir dos tokens do termo com fronteiras
`(?<![A-Z0-9])` e `(?![A-Z0-9])`.

Sufixo `*` no fim do termo remove a fronteira final, permitindo prefixo:

| Termo | Casa | Não casa |
|---|---|---|
| `vergalhao` | `VERGALHAO CA 50` | `VERGALHOES CA 50` |
| `vergalh*` | `VERGALHAO`, `VERGALHOES` | `VERGA` |
| `verg ca` | `VERG CA 50 10MM` | `VERG 10MM CA` |

O wildcard explícito foi preferido a um stemmer: o usuário controla e consegue
prever o resultado.

## Algoritmo de resolução

```
resolve_a_dst(perfil_regras_id, uf, ncm=None, descricao=None, empresa_id=None)
    -> ResolucaoAliquota

NÍVEL 1 — Redução por produto (escopo perfil)
  se descricao ausente ................................. → NÍVEL 2
  regras ← regras_reducao_produto WHERE perfil = ? AND ncm = ?
  se vazio ............................................. → NÍVEL 2
  desc ← normalizar(descricao)
  se desc vazia ........................................ → NÍVEL 2

  1a. exceções (mais específico vence)
      exc ← exceções dessas regras com descricao_exata == desc
      mais de uma exc .................................. → CONFLITO
      exc e exc.enquadrado ............................. → alíquota da regra pai
      exc e não exc.enquadrado ......................... → NÍVEL 2

  1b. termos
      candidatas ← regras onde algum termo_inclusao casa
                            e nenhum termo_exclusao casa
      exatamente 1 ..................................... → alíquota da candidata
      nenhuma .......................................... → NÍVEL 2
      mais de 1 ........................................ → CONFLITO

NÍVEL 2 — Termo de acordo (escopo empresa)
  se empresa_id ausente ................................ → NÍVEL 3
  regra ← regras_aliquotas_empresa WHERE empresa_id = ?
  se encontrada ........................................ → alíquota

NÍVEL 3 — Comportamento atual, sem alteração
  (perfil, uf, ncm) → (perfil, uf, NULL) → RuleResolutionException
```

### Assinatura

A ordem posicional atual `(perfil_regras_id, uf, ncm)` é preservada e os
parâmetros novos entram no fim, opcionais. Chamadas posicionais existentes
continuam válidas; sem `descricao` e `empresa_id` os níveis 1 e 2 são pulados e
o comportamento é o de hoje.

O resolver não conhece `descricao_confiavel` — recebe apenas `descricao`, que
vem `None` quando a origem não é confiável. A filtragem acontece no call site
do pipeline, o que mantém o resolver com uma responsabilidade só.

### Retorno

Breaking, mas contido a um call site em produção
(`pipeline_service.py:247`) e três asserts em `test_camada5_rules_engine.py`:

```python
class ResolucaoAliquota:
    aliquota: Decimal
    origem: str    # "reducao_produto:12" | "excecao:5" | "termo_acordo:3"
                   # | "regra_ncm:7" | "padrao_uf:2"
    detalhe: str   # "Redução por produto: Vergalhões — Decreto 12.345"
```

Com três níveis, saber qual alíquota saiu sem saber de onde inviabiliza a
conferência fiscal. Foi preferido um método só com retorno rico a dois métodos
paralelos que divergem com o tempo.

### Conflito

Duas regras casando o mesmo item é erro de cadastro, não caso de negócio. Não
se escolhe a menor nem a primeira: o processamento **falha**, com
`RuleResolutionException`.

A mensagem é parte do requisito, não detalhe de implementação. Precisa conter,
em texto corrido e em português:

- **o item** que disparou o conflito — NCM e descrição como veio na nota;
- **as regras que colidiram** — id, rótulo (`descricao`), alíquota e os termos
  de inclusão que casaram, para cada uma;
- **a instrução** de cadastrar uma exceção com aquela descrição exata, dizendo
  em qual das regras.

Modelo:

```
Conflito de regras de redução no item "VERGALHAO BARRA CHATA 10MM"
(NCM 72142000, NF-e 1234).

Duas regras casaram o mesmo item:
  #12 "Vergalhões — Decreto 12.345" (12,00%) — casou o termo "vergalh*"
  #15 "Barras chatas" (18,00%) — casou o termo "barra chata"

Cadastre uma exceção com a descrição exata deste item na regra que deve
prevalecer, para que o sistema saiba qual aplicar.
```

Falhar em vez de escolher é deliberado: aplicar a alíquota errada em silêncio
gera passivo fiscal que só aparece em fiscalização. A mensagem só chega ao
usuário por causa da correção do handler descrita em *Correções incluídas* —
sem ela, este aviso apareceria como "Falha interna ao processar os arquivos".

O mesmo vale para exceções: o índice único é por
`(regra_reducao_id, descricao_exata)`, então duas regras do mesmo NCM podem
carregar a mesma `descricao_exata`. Se mais de uma exceção casar, é conflito —
inclusive quando concordam em `enquadrado`, porque a alíquota da regra pai
seria ambígua.

### Cache por solicitação

`preload(perfil_regras_id, empresa_id)` carrega as regras dos três níveis em
memória uma vez, no início do processamento. Os três níveis passam a resolver
sem tocar o banco. O resolver é chamado item a item dentro do loop de notas e
hoje já faz uma query por item; sem o preload, três níveis multiplicariam isso.

## Descrição confiável

`ExtractedItemNF` ganha `descricao_confiavel: bool = True`.

O SPED gera descrições **sintéticas não vazias** quando não há dados de item:

- `sped_fiscal_extractor.py:130` — `"Item Analítico C190 #1 (CFOP 2102)"`
- `sped_fiscal_extractor.py:144` — `"NF-e 123 (Consolidado SPED)"`

Normalizadas, viram texto real que o matcher avaliaria como se fosse descrição
de produto. Os dois pontos passam a marcar `descricao_confiavel=False`, e o
resolver pula o nível 1 nesse caso. Marcar na origem do dado é mais honesto do
que inferir por heurística de string depois.

## NCM sentinela

`sped_fiscal_extractor.py:320` usa `"00000000"` quando o item não consta no
registro 0200. É ausência de dado, não NCM. O cadastro de
`regras_reducao_produto` rejeita `00000000` — do contrário, uma regra nele
capturaria tudo o que o SPED não conseguiu identificar.

## Integração no pipeline

Em `app/services/pipeline_service.py`, antes do loop de notas (linha 151):

```python
self.resolver.preload(empresa.perfil_regras_id, empresa.id)
```

No call site (linha 247):

```python
resolucao = self.resolver.resolve_a_dst(
    perfil_regras_id=empresa.perfil_regras_id,
    uf=empresa.uf,
    ncm=item.ncm,
    descricao=item.descricao if item.descricao_confiavel else None,
    empresa_id=empresa.id,
)
a_dst = resolucao.aliquota
```

**A chave de agrupamento (linha 255) não muda.** Incluir `origem` nela faria uma
nota se desdobrar em linhas extras quando duas origens diferentes produzissem a
mesma alíquota numérica, alterando a estrutura da planilha por um motivo
invisível ao contador. Invariante preservada: **a estrutura de linhas da
planilha gerada é idêntica à de hoje.**

O grupo grava as origens distintas em `metadados_extras` de
`NotaFiscalProcessada` — campo que já existe, portanto auditoria sem migração:

```json
{
  "origem_a_dst": ["reducao_produto:12"],
  "detalhe_a_dst": "Redução por produto: Vergalhões — Decreto 12.345"
}
```

## API

```
POST   /regras-reducao-produto                       (admin)
GET    /regras-reducao-produto?perfil_id=&ncm=
GET    /regras-reducao-produto/{id}
PUT    /regras-reducao-produto/{id}                  (admin)
DELETE /regras-reducao-produto/{id}                  (admin)

POST   /regras-reducao-produto/{id}/excecoes         (admin)
DELETE /regras-reducao-produto/{id}/excecoes/{eid}   (admin)

PUT    /empresas/{id}/termo-acordo                   (admin, upsert)
DELETE /empresas/{id}/termo-acordo                   (admin)
```

O router novo carrega `dependencies=[Depends(get_current_user)]` e as rotas de
escrita acrescentam `Depends(require_admin)`, seguindo
`endpoints/regras_aliquotas.py`. Leitura fica disponível a qualquer usuário
autenticado.

O termo de acordo é pendurado em `/empresas/{id}` em vez de ganhar router
próprio, refletindo a cardinalidade 1:1: o frontend não rastreia id separado
nem gerencia lista, e o objeto vem embutido em `EmpresaOut`. Se a vigência
transformar isso em histórico, o endpoint singular vira coleção — alterar
endpoint é mais barato que alterar dados.

## Frontend

- `frontend/src/types/regraReducao.ts` — tipos
- `frontend/src/api/regrasReducao.ts` — usa o `createCrudApi` existente
- `frontend/src/api/queryKeys.ts` — entrada `regrasReducaoProduto(perfilId)`
- `frontend/src/pages/PerfisRegras/ReducaoProdutoSection.tsx` + hook próprio
- `frontend/src/pages/Empresas/` — bloco "Termo de Acordo" no formulário
  (alíquota + identificação do termo, opcional)

A seção nova nasce como componente próprio porque
`PerfisRegras/index.tsx` já tem 642 linhas, 3 Cards e 3 Modals; uma quarta
seção inline chegaria a ~900 linhas. As três seções existentes ficam como
estão.

### Texto que deixa de ser verdade

`PerfisRegras/index.tsx:271` intitula a seção de NCM como *"Exceções
Tributárias por NCM (Prioridade Máxima)"*. Com a redução por produto acima
dela, o rótulo passa a mentir. Títulos e subtítulos das seções são reescritos
para refletir a ordem real: produto → empresa → NCM → padrão da UF.

## Correções incluídas

Problemas no código existente que este trabalho atravessa:

1. **Mensagem de erro engolida.** `pipeline_service.py:502` faz
   `str(exc) if isinstance(exc, ValidationException) else "Falha interna ao
   processar os arquivos."`. `RuleResolutionException` herda de
   `PlanilhaATException`, não de `ValidationException` — então a mensagem
   explicativa do resolver nunca chega ao usuário hoje. O `isinstance` passa a
   testar `PlanilhaATException`, mantendo genérica apenas a exceção realmente
   inesperada. Este design adiciona novas falhas pelo mesmo caminho.

2. **Validador duplicado.** A conversão de `12.06` para `0.1206` está repetida
   em `schemas/regra_aliquota.py:36` e `:79`. Com dois schemas novos precisando
   do mesmo comportamento, seriam quatro cópias. Extraído para helper
   compartilhado, consumido pelos quatro.

## Validações

**Cadastro (422):** `termos_inclusao` vazio; NCM fora de 8 dígitos; NCM
`00000000`; alíquota fora de `[0,1]` após a conversão de percentual.

**Duplicata (409):** mesmo perfil + NCM + mesmo conjunto de `termos_inclusao`
normalizado, seguindo o padrão de `regras_aliquotas.py:96`.

**Runtime:** conflito de regras sobe como `RuleResolutionException`.

## Casos-limite

| Situação | Resultado |
|---|---|
| NCM sem regra de redução | nível 2 |
| Descrição ausente ou não confiável | nível 2 |
| Termos não casam | nível 2 |
| Termo de exclusão casa | regra descartada; demais regras do NCM ainda avaliadas |
| Exceção `enquadrado=False` | nível 2, mesmo com termos casando |
| Exceção `enquadrado=True` | aplica a redução, mesmo sem termo casar |
| Duas regras casam o mesmo item | `RuleResolutionException` nomeando as duas |
| Duas exceções casam a mesma descrição | `RuleResolutionException` |
| Empresa sem termo de acordo | nível 3 |
| Nada cadastrado | idêntico ao comportamento atual |

## Testes

Escritos antes da implementação.

**`tests/test_descricao_matcher.py`** *(novo, sem banco)* — normalização de
acento, pontuação, caixa e espaços; fronteira de token (`"ferro"` não casa
`"FERROVIARIO"`, `"aco"` não casa `"ACOLCHOADO"`); wildcard (`"vergalh*"` casa
`VERGALHAO` e `VERGALHOES`, não casa `VERGA`); multi-token (`"verg ca"` casa
contíguo, não disperso).

**`tests/test_camada5_rules_engine.py`** *(estendido)* — o caso central:
empresa com termo de acordo de 12,06% e NCM com redução para 12,00%; item
vergalhão sai 12,00%, item não-vergalhão do mesmo NCM sai 12,06%. Mais: termo
de acordo vencendo o padrão da UF; exceção nos dois sentidos; termo de
exclusão; descrição não confiável caindo para o nível 2. Os três asserts atuais
continuam passando, como regressão de que nada mudou para quem não cadastra.

O conflito ganha teste próprio sobre o **conteúdo** da mensagem, já que ela é
requisito: a exceção levantada precisa citar a descrição do item, os ids das
duas regras e a palavra "exceção". Mais um teste de que a mensagem sobrevive
até `solicitacao.mensagem_erro` em vez de virar "Falha interna" — é o par
natural da correção do handler.

**`tests/test_reducao_produto_pipeline.py`** *(novo, ponta a ponta)* — XML com
dois itens de mesmo NCM e descrições diferentes produz duas linhas com
alíquotas diferentes; SPED consolidado não aplica redução; `metadados_extras`
grava a origem correta.

**`tests/test_camada1_config.py`** *(estendido)* — seguindo
`test_criar_regras_aliquotas_padrao_e_excecao` (linha 33): CRUD das tabelas
novas, validações de cadastro e upsert de `/empresas/{id}/termo-acordo`.

## Arquivos

**Novos**

```
alembic/versions/010_aliquotas_reduzidas.py
app/models/regra_reducao_produto.py           RegraReducaoProduto, ExcecaoReducaoProduto
app/models/regra_aliquota_empresa.py          RegraAliquotaEmpresa
app/schemas/regra_reducao_produto.py
app/schemas/regra_aliquota_empresa.py
app/api/endpoints/regras_reducao_produto.py
app/services/rules_engine/descricao_matcher.py
tests/test_descricao_matcher.py
tests/test_reducao_produto_pipeline.py
frontend/src/types/regraReducao.ts
frontend/src/api/regrasReducao.ts
frontend/src/pages/PerfisRegras/ReducaoProdutoSection.tsx
frontend/src/pages/PerfisRegras/useReducaoProdutoSection.ts
```

**Modificados**

```
app/models/__init__.py                    registro dos modelos novos
app/models/perfil_regras.py               relacionamento
app/models/empresa.py                     relacionamento
app/schemas/regra_aliquota.py             extração do validador compartilhado
app/schemas/empresa.py                    termo de acordo em EmpresaOut
app/api/router.py                         registro do router novo
app/api/endpoints/empresas.py             PUT/DELETE termo-acordo
app/services/extraction/base.py           descricao_confiavel
app/services/extraction/sped_fiscal_extractor.py   marca descrições sintéticas
app/services/rules_engine/aliquota_resolver.py     três níveis, preload, retorno
app/services/pipeline_service.py          preload, call site, handler de erro
tests/test_camada1_config.py
tests/test_camada5_rules_engine.py
frontend/src/api/queryKeys.ts
frontend/src/pages/PerfisRegras/index.tsx          nova seção, títulos corrigidos
frontend/src/pages/Empresas/index.tsx              bloco termo de acordo
```
