# Gestão de usuários pelo Contador Sênior

**Data:** 2026-09-01
**Status:** aprovado, aguardando plano de implementação

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

## Decisões tomadas

| Decisão | Escolha | Motivo |
|---|---|---|
| Senha inicial | O admin digita | Escolha do usuário. A alternativa recomendada era o sistema gerar uma senha forte; o trade-off (senhas fracas, admin conhece a senha de todos) foi apresentado e aceito. |
| Papel na criação | Admin escolhe entre `operador` e `admin` | Torna a funcionalidade autossuficiente; sem isso, promover alguém continuaria exigindo intervenção manual. |
| `cargo` | Derivado do papel | `admin` → "Contador Sênior", `operador` → "Analista Fiscal". Mantém consistência com o resto do sistema. |
| Desativação | `ativo = false` | Já bloqueia o login no código existente e preserva o histórico de solicitações do usuário. |
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
| `app/api/endpoints/usuarios.py` | Rotas HTTP, todas atrás de `require_admin` |
| `app/schemas/usuario.py` | `UsuarioCreate`, `UsuarioOut`, `UsuarioStatusUpdate` |
| `app/services/supabase_admin.py` | Wrapper da Admin API (criar e apagar usuário) |
| `frontend/src/api/usuarios.ts` | Cliente HTTP |
| `frontend/src/pages/Usuarios/index.tsx` | Tela de listagem + modal de criação |

`app/services/supabase_admin.py` existe para isolar a dependência HTTP externa:
os testes mockam esse módulo em vez de mockar `httpx` espalhado pelo endpoint.

### Endpoints

Todos com `dependencies=[Depends(require_admin)]`, seguindo o padrão de
`app/api/endpoints/empresas.py`.

| Método | Rota | Retorno |
|---|---|---|
| POST | `/api/v1/usuarios` | 201 `UsuarioOut` |
| GET | `/api/v1/usuarios` | 200 `List[UsuarioOut]` |
| PATCH | `/api/v1/usuarios/{id}/status` | 200 `UsuarioOut` |

`UsuarioOut` nunca inclui senha.

`GET /usuarios` retorna **todos** os perfis, ativos e inativos, ordenados por
nome. Omitir os inativos tornaria impossível reativar alguém pela tela.

## Fluxo de criação

1. Valida que o e-mail não existe em `profiles` → senão 400.
2. Cria no Supabase Auth com `email_confirm=true`, para o usuário poder entrar
   sem depender de SMTP configurado. Se o Supabase recusar (e-mail já existente
   lá, senha rejeitada pela política do projeto, serviço fora do ar), nada é
   gravado em `profiles` e o erro do Supabase é traduzido para uma mensagem
   legível — 400 para recusa de validação, 503 para indisponibilidade.
3. O trigger `on_auth_user_created` dispara e insere a linha em `profiles` com
   os defaults (`Analista Fiscal` / `operador`).
4. O backend grava `nome`, `cargo` e `role` escolhidos, como **upsert**:
   atualiza se a linha existir, insere se não. Não depender do timing do
   trigger mantém o fluxo correto mesmo se o trigger for alterado ou removido.
5. **Compensação:** se o passo 4 falhar, o usuário recém-criado é apagado no
   Supabase Auth. Sem isso sobraria uma conta órfã capaz de autenticar como
   operador — uma conta que o admin acredita não ter sido criada.

O passo 5 é a razão de `supabase_admin.py` expor também `delete_user`.

## Segurança

- Todas as rotas exigem `role == "admin"`, via `require_admin`.
- A `service_role` key permanece no servidor; nunca é enviada ao frontend.
- **O admin não pode desativar a própria conta.** Sem essa trava, um admin
  único se trancaria para fora do sistema sem caminho de volta pela interface.
- Senha mínima de 8 caracteres para contas criadas por esta tela.
- A senha nunca é retornada em resposta nem escrita em log.
- `profiles.email` já é `UNIQUE`; a validação do passo 1 existe para dar erro
  legível antes de chamar o Supabase.

## Interação com o mapa fixo

`reconcile_known_account()` reaplica `cargo`/`role` a cada login para os
e-mails presentes em `LOCAL_USERS_FALLBACK`. Usuários criados por esta tela não
estão nesse mapa, então não há conflito.

A função **não** toca em `ativo`, então desativar qualquer conta — inclusive
uma do mapa fixo — funciona normalmente.

**Limite conhecido:** as contas do mapa fixo não poderiam ser rebaixadas por
uma futura tela de edição de papel, porque a reconciliação as promoveria de
volta no login seguinte. Resolver isso significa tornar o banco a autoridade e
reduzir o mapa fixo ao bootstrap inicial. Fora do escopo atual; registrado
para quando a edição de papéis entrar.

## Frontend

Rota `/usuarios`, envolvida em `AdminRoute`, com entrada na seção ÁREA
ADMINISTRATIVA da `Sidebar`.

- Tabela: nome, e-mail, cargo, papel, status.
- Botão "Novo Usuário" abre modal com react-hook-form + zod, seguindo o padrão
  de `pages/Login/index.tsx`.
- Toggle ativo/inativo por linha; desabilitado na linha do próprio usuário
  logado, espelhando a trava do backend.

A validação de senha do zod espelha o mínimo de 8 caracteres do backend, mas o
backend valida de forma independente — a checagem do cliente é conveniência,
não controle de segurança.

## Testes

TDD: cada caso abaixo é escrito e falha antes da implementação. A Admin API do
Supabase é mockada, como já feito em `tests/test_auth.py`.

| Caso | Esperado |
|---|---|
| Operador chama qualquer rota de usuários | 403 |
| Admin cria operador | 201, `cargo="Analista Fiscal"`, `role="operador"` |
| Admin cria admin | 201, `cargo="Contador Sênior"`, `role="admin"` |
| E-mail já cadastrado | 400, Supabase não é chamado |
| Senha com menos de 8 caracteres | 422 |
| Passo 4 falha | Usuário apagado no Supabase Auth; nenhum perfil órfão |
| Login de usuário desativado | 403 |
| Admin desativa a própria conta | 400 |
| Resposta de criação | Nunca contém a senha |

## Critérios de aceite

- Um admin cria um usuário pela interface e essa pessoa consegue fazer login
  com a senha definida, aparecendo com o cargo correto.
- Um usuário desativado pela interface não consegue mais entrar.
- Um operador não alcança nenhuma das rotas nem a página.
- A suíte completa continua passando.
