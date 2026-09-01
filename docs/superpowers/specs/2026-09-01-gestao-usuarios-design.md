# Gestão de usuários pelo Contador Sênior

**Data:** 2026-09-01
**Status:** revisado após code review; pré-requisito de segurança resolvido;
pronto para o plano de implementação

## Problema

O PlanAut não tem gestão de usuários. Os cargos e papéis vêm de um mapa fixo
no código (`LOCAL_USERS_FALLBACK`, em `app/core/security.py`), e criar ou
promover alguém exige editar código ou o banco à mão.

Essa ausência não é teórica: em 2026-09-01 a conta `admin@codisplan.com`
aparecia como Analista Fiscal porque o provisionamento gravava
`cargo="Analista Fiscal"`/`role="operador"` fixos, e nenhum fluxo do sistema
era capaz de corrigir isso depois.

## Escopo

Ciclo de vida essencial, operado por um admin já autenticado:

- criar usuário
- listar usuários
- ativar / desativar usuário

**Fora de escopo:** editar nome/cargo, promover ou rebaixar papel de conta
existente, redefinir senha, excluir de verdade.

## PRÉ-REQUISITO — RESOLVIDO EM 2026-09-01

`ENABLE_LOCAL_AUTH=false` foi definido no ambiente de Production da Vercel e
o deploy aplicado. Verificado contra produção: `admin@codisplan.com` com
`123456` e `admin123` agora retorna 401, enquanto as senhas reais do Supabase
seguem funcionando — inclusive as dos dois botões de acesso rápido da tela de
login, que não regrediram.

O registro do problema fica abaixo, porque explica por que a seção de
Segurança deste design é confiável.

Esta funcionalidade não deve ir para produção enquanto o fallback de
autenticação local estiver ativo lá.

`ENABLE_LOCAL_AUTH` vale `True` por padrão (`app/core/config.py:14`) e não é
sobrescrito na Vercel. Quando o Supabase recusa a senha, o login cai em
`USERS_DB` (`app/api/endpoints/auth.py`), que aceita senhas fixas como
`123456` e `admin123` para `admin@codisplan.com` e devolve `role="admin"`.

Consequência direta para este design: **`require_admin` é contornável hoje**.
Toda a seção de Segurança abaixo se apoia nele, e estas rotas novas usam a
`service_role` key para criar contas no Supabase Auth. Publicar a gestão de
usuários sobre um controle contornável transforma uma senha fraca conhecida em
capacidade de criar contas administrativas.

**Correção exigida antes do deploy:** definir `ENABLE_LOCAL_AUTH=false` no
ambiente de produção da Vercel, mantendo o fallback apenas em
desenvolvimento. É mudança de variável de ambiente, sem alteração de código.

## Decisões tomadas

| Decisão | Escolha | Motivo |
|---|---|---|
| Senha inicial | O admin digita | Escolha do usuário. A alternativa recomendada era o sistema gerar uma senha forte; o trade-off (senhas fracas, admin conhece a senha de todos) foi apresentado e aceito. |
| Papel na criação | Admin escolhe entre `operador` e `admin` | Torna a funcionalidade autossuficiente; sem isso, promover alguém continuaria exigindo intervenção manual. |
| `cargo` | Derivado do papel | `admin` → "Contador Sênior", `operador` → "Analista Fiscal". Mantém consistência com o resto do sistema. |
| Desativação | `ativo = false` | Preserva o histórico de solicitações do usuário. |
| Tabela | Reusa `profiles` | Nenhuma tabela nova. |

## Arquitetura

O backend é o único componente que fala com o Supabase Auth, usando a
`service_role` key. Duas alternativas foram descartadas:

- **Criar apenas em `profiles`** — as senhas vivem no Supabase Auth; o usuário
  não conseguiria autenticar.
- **Frontend falando direto com o Supabase** — exigiria a `service_role` no
  navegador e contraria a regra registrada em `docs/supabase_schema.sql`: "O
  frontend usa exclusivamente a API FastAPI."

### Componentes novos

| Arquivo | Responsabilidade |
|---|---|
| `app/api/endpoints/usuarios.py` | Rotas HTTP |
| `app/schemas/usuario.py` | `UsuarioCreate`, `UsuarioOut`, `UsuarioStatusUpdate` |
| `app/services/supabase_admin.py` | Wrapper da Admin API (criar e apagar usuário) |
| `frontend/src/api/usuarios.ts` | Cliente HTTP |
| `frontend/src/pages/Usuarios/index.tsx` | Tela de listagem + modal de criação |

### Arquivos existentes que precisam ser alterados

Registrar o router exige **duas** listas mantidas à mão. Omitir a segunda
deixa `/usuarios` como o único recurso sem o alias legado que todos os outros
têm:

| Arquivo | Alteração |
|---|---|
| `app/api/router.py` | `include_router(usuarios_router)` sob `/api/v1` |
| `app/main.py` | incluir na lista do alias legado `/v1` |
| `frontend/src/App.tsx` | rota `/usuarios` dentro de `AdminRoute` |
| `frontend/src/components/layout/Sidebar.tsx` | item na ÁREA ADMINISTRATIVA |

### `supabase_admin.py`

Espelha a forma de `app/services/supabase_storage.py`, que já resolve este
mesmo problema: `is_configured()` e `_get_headers()`.

`SUPABASE_SERVICE_ROLE_KEY` é `Optional[str] = None`. Sem o guard, o wrapper
enviaria `Bearer None`, receberia 401 e o erro seria reportado como "serviço
fora do ar" — o admin caçaria uma indisponibilidade inexistente em vez de uma
variável de ambiente faltando. Configuração ausente deve falhar com erro
próprio e distinto.

### Endpoints

| Método | Rota | Retorno |
|---|---|---|
| POST | `/api/v1/usuarios` | 201 `UsuarioOut` |
| GET | `/api/v1/usuarios` | 200 `List[UsuarioOut]` |
| PATCH | `/api/v1/usuarios/{id}/status` | 200 `UsuarioOut`, 404 se o id não existir |

`UsuarioOut` nunca inclui senha.

`GET /usuarios` retorna **todos** os perfis, ativos e inativos, ordenados por
nome. Omitir os inativos tornaria impossível reativar alguém pela tela.

**Como declarar a autorização:** POST e GET usam
`dependencies=[Depends(require_admin)]`, como em `empresas.py`. O PATCH **não
pode** usar essa forma: o FastAPI descarta o valor retornado por dependências
declaradas em `dependencies=[...]`, e o handler precisa do `Profile` do
chamador para comparar com o `id` do caminho. O PATCH recebe
`current_user: Profile = Depends(require_admin)` como parâmetro do handler.
Seguir a forma de `dependencies=[...]` no PATCH torna a trava de
autodesativação impossível de implementar.

O 404 usa `get_by_id_or_404` de `app/api/persistence.py`, já usado por
`empresas.py`. Sem isso, um id desconhecido gera `AttributeError` em `None` e
vira 500.

## Fluxo de criação

O e-mail é normalizado com `.strip().lower()` no schema, como já fazem
`app/api/endpoints/auth.py` e `known_account_profile`. Sem isso,
`Admin@Codisplan.com` escapa da checagem do passo 1 e grava um segundo
registro que o login trata como conta distinta.

1. **Rejeita e-mails do mapa fixo.** Se o e-mail estiver em
   `LOCAL_USERS_FALLBACK`, retorna 400. Sem essa trava, num banco novo o admin
   consegue criar `operador@contabilidade.com` como admin, receber 201, e no
   primeiro login `reconcile_known_account` rebaixa a conta em silêncio — um
   admin que vira operador no dia seguinte, sem erro em lugar nenhum.
2. Valida que o e-mail não existe em `profiles` → senão 400.
3. Cria no Supabase Auth com `email_confirm=true`, para o usuário poder entrar
   sem depender de SMTP configurado. O `nome` escolhido vai também em
   `user_metadata`, para que o trigger e o backend gravem o mesmo valor. Se o
   Supabase recusar, nada é gravado em `profiles`: 400 para recusa de
   validação, 503 para indisponibilidade, e erro distinto para configuração
   ausente.
4. O trigger `on_auth_user_created` dispara e insere a linha em `profiles`.
5. O backend grava `nome`, `cargo` e `role` escolhidos, como **upsert**:
   atualiza se a linha existir, insere se não.
6. **Compensação:** se o passo 5 falhar, apaga o usuário no Supabase Auth **e
   a linha de `profiles` explicitamente**, na mesma operação.

Sobre o passo 6: `docs/supabase_schema.sql` declara
`id REFERENCES auth.users(id) ON DELETE CASCADE`, e essa FK está presente no
banco de produção atual (verificado). Mas
`alembic/versions/008_supabase_profiles_and_user_ownership.py` cria `profiles`
sem FK alguma, e `docs/SUPABASE_RECONCILIATION.md` manda bancos existentes
usarem `alembic stamp`. Num banco assim, confiar no cascade deixa um perfil
órfão: um "Analista Fiscal" fantasma que aparece na listagem, não consegue
autenticar, e bloqueia para sempre a recriação daquele e-mail, porque
`profiles.email` é UNIQUE. Apagar explicitamente custa uma linha e não depende
de qual caminho criou o banco.

`nome` tem `max_length=255` no schema, espelhando `profiles.nome`. Sem o
limite, um nome longo passa no passo 3 e estoura no passo 5, disparando a
compensação destrutiva e devolvendo 500 em vez de um 422 de campo.

## Segurança

- POST e GET exigem `role == "admin"` via `require_admin`; o PATCH idem, na
  forma de parâmetro descrita acima.
- A `service_role` key permanece no servidor; nunca é enviada ao frontend.
- **O admin não pode desativar a própria conta.** Sem essa trava, um admin
  único se trancaria para fora do sistema sem caminho de volta pela interface.
- Senha mínima de 8 caracteres para contas criadas por esta tela.
- A senha nunca é retornada em resposta nem escrita em log.

### Limite da desativação

`ativo = false` bloqueia o login **quando existe linha em `profiles`**. Há um
furo pré-existente: em `_load_active_profile` (`app/core/security.py`), se
nenhuma linha for encontrada e `local_auth_enabled` estiver ligado, a função
sintetiza um `Profile` com `ativo=True` fixo para qualquer id do mapa fixo,
sem consultar o valor gravado. Uma conta institucional desativada recuperaria
acesso caso sua linha se perdesse.

O pré-requisito de desligar `ENABLE_LOCAL_AUTH` em produção fecha esse furo
junto com o principal.

### Colisão de UUID no mapa fixo

`admin@contabilidade.com` e `admin@codisplan.com` compartilham o mesmo id
(`184e793c-...`) em `LOCAL_USERS_FALLBACK`. Como `profiles.id` é chave
primária, só pode existir uma linha para os dois, e `_ensure_local_profile`
casa por `id OR email` — quem logar primeiro fica dono da linha.

Efeito na tela: os dois admins institucionais aparecem como um só, e desativar
essa linha desativa ambos sem que a interface mostre isso. **Correção incluída
neste trabalho:** dar um id próprio a `admin@codisplan.com` no mapa. É uma
linha, e sem ela a listagem mente sobre quem existe.

## Interação com o mapa fixo

`reconcile_known_account()` reaplica `cargo`/`role` a cada login para os
e-mails do mapa. O passo 1 impede criar contas nesses e-mails, então não há
conflito. A função não toca em `ativo`, então desativar funciona.

**Limite conhecido:** as contas do mapa não poderiam ser rebaixadas por uma
futura tela de edição de papel — a reconciliação as promoveria de volta no
login seguinte. Resolver isso significa tornar o banco a autoridade e reduzir o
mapa ao bootstrap inicial. Fora do escopo atual.

## Frontend

Rota `/usuarios`, envolvida em `AdminRoute`, com entrada na ÁREA
ADMINISTRATIVA da `Sidebar`.

- Tabela: nome, e-mail, cargo, papel, status.
- Botão "Novo Usuário" abre modal com react-hook-form + zod, seguindo o padrão
  de `pages/Login/index.tsx`.
- Toggle ativo/inativo por linha; desabilitado na linha do próprio usuário
  logado, espelhando a trava do backend.

A validação do zod espelha as regras do backend, mas o backend valida de forma
independente — a checagem do cliente é conveniência, não controle de
segurança.

## Testes

TDD: cada caso é escrito e falha antes da implementação.

**Sobre o mock:** `tests/test_auth.py` faz `monkeypatch.setattr(auth_module.httpx, "Client", ...)`,
ou seja, remenda o `httpx` de dentro do módulo do endpoint. Esta
funcionalidade **diverge de propósito** desse precedente: os testes mockam
`supabase_admin`, que existe justamente para isolar a dependência HTTP. Seguir
o precedente anularia a razão de o módulo existir.

| Caso | Esperado |
|---|---|
| Operador chama qualquer rota de usuários | 403 |
| Admin cria operador | 201, `cargo="Analista Fiscal"`, `role="operador"` |
| Admin cria admin | 201, `cargo="Contador Sênior"`, `role="admin"` |
| E-mail já cadastrado | 400, Supabase não é chamado |
| E-mail presente em `LOCAL_USERS_FALLBACK` | 400, Supabase não é chamado |
| E-mail com maiúsculas | Normalizado; colide com o registro minúsculo existente |
| Senha com menos de 8 caracteres | 422 |
| `nome` acima de 255 caracteres | 422, Supabase não é chamado |
| Passo 5 falha | Usuário apagado no Supabase **e** perfil removido |
| `SUPABASE_SERVICE_ROLE_KEY` ausente | Erro de configuração distinto, não 503 |
| Listagem | Inclui usuários inativos |
| Reativar usuário inativo | 200, `ativo=true`, e o login volta a funcionar |
| Login de usuário desativado | 403 |
| Admin desativa a própria conta | 400 |
| PATCH com id inexistente | 404 |
| Resposta de criação | Nunca contém a senha |

As duas linhas de listagem e reativação existem porque o design argumenta
explicitamente por elas. Sem esses testes, uma implementação que filtre
`ativo == True` na listagem passa na suíte inteira e torna a reativação
impossível pela tela — exatamente o que o design diz estar evitando.

## Ponto contestado do review

O review apontou que `DATABASE_URL` é independente de `SUPABASE_URL` e cai em
SQLite por padrão, o que faria o perfil gravado desaparecer a cada cold start
na Vercel. O risco de configuração é real, mas o cenário descrito não é o
estado atual: `DATABASE_URL` está definido como secret de Production na Vercel
(verificado via `vercel env ls`). Não trato isso como falha de design; a
mitigação proporcional é um guard de startup que recuse subir com
`SUPABASE_URL` configurado e `DATABASE_URL` em SQLite — registrado como
melhoria separada, fora deste escopo.

## Critérios de aceite

- Um admin cria um usuário pela interface e essa pessoa consegue fazer login
  com a senha definida, aparecendo com o cargo correto.
- Um usuário desativado pela interface não consegue mais entrar, e voltar a
  ativá-lo restaura o acesso.
- Um operador não alcança nenhuma das rotas nem a página.
- A suíte completa continua passando.
