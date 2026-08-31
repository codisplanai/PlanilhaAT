# Code Review — 31/08/2026

## Escopo

Revisão dos commits mais recentes da `main`, 8 arquivos no total:

| Commit | Descrição |
|---|---|
| `dbf2568` | fix: corrigir erro 500 no processamento de SPED e serialização UUID |
| `a4bb7a5` | fix: garantir coluna configuracoes_extras em perfis_regras |

Suíte de testes no momento da revisão: **93 passed, 1 skipped**. Nenhum dos defeitos
abaixo é coberto pelos testes existentes — todos passam com os bugs presentes.

## Resumo

| # | Severidade | Arquivo | Defeito |
|---|---|---|---|
| 1 | **Crítica** | `frontend/src/api/templates.ts:30` | Upload de template envia JSON em vez de multipart; o arquivo é descartado |
| 2 | **Crítica** | `frontend/src/api/solicitacoes.ts:35` | Mesmo defeito em `processar()`; XMLs, SPED e planilha são descartados |
| 3 | **Alta** | `template_manager.py:151` | Fallback sobrescreve `arquivo_path` no banco e destrói a chave do Supabase |
| 4 | **Alta** | `template_manager.py:148` | `db.commit()` em getter de leitura quebra o rollback do pipeline |
| 5 | **Média** | `app/main.py:100` | Handler global devolve `str(exc)` ao cliente, vazando SQL e caminhos |
| 6 | **Média** | `app/main.py:49` | ALTERs compartilham uma transação e a falha é silenciada |
| 7 | **Média** | `template_utils.py:130` | Recuperação de mês só roda quando o ano falta; grava na aba errada |

---

## 1 e 2 — Upload multipart quebrado (Crítica)

`dbf2568` removeu o header explícito `Content-Type: multipart/form-data` das duas
chamadas que enviam `FormData`:

```diff
-    const { data } = await apiClient.post<TemplateXlsx>('/templates/upload', formData, {
-      headers: { 'Content-Type': 'multipart/form-data' },
-    });
+    const { data } = await apiClient.post<TemplateXlsx>('/templates/upload', formData);
```

Sem o header explícito, prevalece o default da instância em
[`client.ts:6`](../frontend/src/api/client.ts#L6), que é `application/json`. O
`transformRequest` do axios 1.x tem um caminho específico para isso: quando o corpo é
`FormData` **e** o Content-Type é JSON, ele faz `JSON.stringify(formDataToJSON(data))`.
Objetos `File` não são serializáveis em JSON e viram `{}`.

Verificado executando o axios 1.19.0 instalado no projeto:

```text
COM default application/json (estado atual):
  Content-Type -> application/json
  body -> "{\"file\":{},\"tipo\":\"antecipacao_parcial\"}"

SEM Content-Type default:
  Content-Type -> undefined  (axios define multipart/form-data; boundary=... no envio)
  body -> [FormData intacto]
```

**Impacto:** o upload de template e o disparo de processamento — o fluxo principal do
sistema — não funcionam. O backend recebe um corpo JSON sem arquivo e responde 422.

**Correção recomendada:** remover o `Content-Type: application/json` default de
`client.ts`. O axios já define `application/json` sozinho para objetos comuns e
`multipart/form-data` com boundary para `FormData`; o default fixo é justamente o que
impede a detecção correta. Restaurar os headers explícitos nas duas chamadas também
resolve, mas deixa a armadilha de pé para a próxima chamada com `FormData`.

---

## 3 — Fallback destrói o caminho do template (Alta)

[`template_manager.py:150-154`](../app/services/templates_admin/template_manager.py#L150)

```python
default_local_path = os.path.join(settings.TEMPLATES_DIR, f"modelo_padrao_{clean_tipo}.xlsx")
if os.path.exists(default_local_path):
    template.arquivo_path = default_local_path
    db.commit()
```

O `arquivo_path` armazenado também é a origem da chave do objeto no Supabase, algumas
linhas acima: `filename = os.path.basename(template.arquivo_path)`. Ao gravar
`modelo_padrao_{tipo}.xlsx` de forma permanente, o nome original é perdido.

**Impacto:** uma única falha transitória do Supabase num cold start basta para que o
template real nunca mais seja localizado — o download seguinte passa a procurar a chave
errada. Pior: o registro mantém o `mapeamento_campos` original apontando para uma
planilha diferente, então o resultado sai silenciosamente errado em vez de falhar.

**Correção recomendada:** resolver o caminho local em memória e não persistir o
fallback. Se o caminho físico precisar mesmo ser cacheado, guardar a chave do objeto
numa coluna própria, separada do caminho em disco.

---

## 4 — `db.commit()` em caminho de leitura (Alta)

`get_active_template()` é um getter, mas comita ([linhas 148 e 154](../app/services/templates_admin/template_manager.py#L148)).
Ele é chamado no meio do pipeline, em
[`pipeline_service.py:535`](../app/services/pipeline_service.py#L535), depois de vários
`self.db.add(saida)` ainda pendentes.

**Impacto:** o commit do getter persiste notas e saídas parciais que ainda não deviam
existir. Quando o processamento falha adiante, o `self.db.rollback()` do handler
([linha 582](../app/services/pipeline_service.py#L582)) não desfaz mais nada — sobram
linhas órfãs sob uma solicitação marcada como `STATUS_ERRO`.

**Correção recomendada:** tirar o `commit()` do getter. Quem controla a transação é o
pipeline; um caminho de leitura não deve decidir o ponto de commit de quem o chamou.

---

## 5 — Handler global vaza detalhes internos (Média)

[`app/main.py:94-101`](../app/main.py#L94)

```python
return JSONResponse(
    status_code=500,
    content={"detail": f"Erro interno do servidor: {str(exc)}"}
)
```

Para erros de SQLAlchemy, `str(exc)` traz a instrução SQL completa, os parâmetros
vinculados e caminhos de arquivo. Foi exatamente assim que o erro de
`perfis_regras.configuracoes_extras` apareceu: o `SELECT ... FROM perfis_regras` inteiro
devolvido ao cliente.

**Impacto:** exposição de estrutura interna do banco e do sistema de arquivos para
qualquer cliente que provoque um 500.

**Correção recomendada:** o handler já registra o traceback no log do servidor, que é o
lugar certo. Devolver ao cliente uma mensagem genérica, opcionalmente com um id de
correlação para casar com a entrada de log.

---

## 6 — Guard de colunas: transação única e falha silenciada (Média)

[`app/main.py:47-57`](../app/main.py#L47) — introduzido em `a4bb7a5`.

Todos os `ALTER TABLE` rodam dentro de um único `bind.begin()`. Em Postgres o DDL é
transacional, então uma falha na coluna de `perfis_regras` desfaz também o ALTER de
`solicitacoes.usuario_id` que já havia funcionado. O chamador envolve tudo em
`except Exception: pass`, de modo que nada é registrado.

**Impacto:** reintroduz exatamente a classe de erro 500 que o commit se propôs a
corrigir, e sem deixar rastro para diagnóstico.

**Correção recomendada:** uma transação por coluna e log da falha em vez de `pass`.

---

## 7 — Recuperação de mês na aba errada (Média)

[`template_utils.py:130-134`](../app/services/excel/template_utils.py#L130)

```python
if not year and "competencia" in header_info:
    ...
    if month is None and len(parts) == 2 and parts[0].isdigit():
        month = int(parts[0])
```

A recuperação do mês a partir de `competencia` está aninhada dentro da condição
`if not year`. Quando o `header_info` traz um ano válido mas nenhum mês utilizável, o
bloco inteiro é pulado e `month` permanece `None`.

**Impacto:** `select_worksheet` cai no `return workbook.active`
([linha 69](../app/services/excel/template_utils.py#L69)) e a gravação vai para a aba
ativa da planilha, não para a aba do mês correto.

**Correção recomendada:** desaninhar a recuperação do mês — ela deve rodar sempre que
`month` estiver ausente, independentemente do ano.

---

## Observações sistêmicas

**Os testes não alcançam essa classe de defeito.** As suítes montam SQLite novo via
`create_all()` e não exercitam o cliente HTTP do frontend. Os sete defeitos convivem com
93 testes verdes. Os pontos mais expostos hoje — serialização do axios, transações do
pipeline e recuperação de template — não têm cobertura.

**Alembic está dormente.** Há 7 migrations versionadas e nenhuma aplicada: a tabela
`alembic_version` não existe no banco de produção. O schema real diverge das migrations
(a tabela `perfis_regras` tem uma coluna `ativo` que não existe no modelo nem na
migration `001`). Enquanto o schema for gerido por `create_all()` mais remendos de
startup, o drift volta. O guard do item 6 é paliativo, não solução de fundo.

**Commits de correção têm introduzido regressões.** `dbf2568` corrigiu um 500 no SPED e
quebrou, no mesmo commit, os dois uploads do sistema. Vale rodar o fluxo de upload
manualmente antes de publicar mudanças no cliente HTTP, já que nenhum teste cobre isso.
