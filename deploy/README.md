# PlanAut deployment architecture

## Arquitetura oficial

```text
feature/* | fix/* | refactor/* | ci/* | ...
                    |
                    | PR -> validação estática (SEM Docker build/release)
                    v
                 develop
                    |
                    +--> testes completos
                    +--> build frontend/PWA
                    +--> GHCR :develop
                    +--> GitHub Actions -> Vercel Preview
                    |                     planaut.dev.codisplan.com.br
                    |
                    v
          PR release(patch|minor|major)
                    |
                    v
                  main
                    |
                    +--> SemVer
                    +--> testes completos + PWA
                    +--> imagem release GHCR + SBOM + provenance
                    +--> validação de pull público GHCR
                    +--> Docker deploy por digest + healthcheck/rollback
                    +--> Git tag + GitHub Release
                    +--> workflow_run bem-sucedido
                              |
                              v
                      GitHub Actions -> Vercel Production
                                        planaut.codisplan.com.br
```

A Vercel **não controla o fluxo de release**. GitHub Actions é o orquestrador. O workflow usa Vercel CLI autenticado por secrets do GitHub para executar `vercel pull`, `vercel build` e `vercel deploy --prebuilt`.

## Frontend Vercel + backend Docker

A Vercel hospeda somente o frontend/PWA. O FastAPI permanece em Docker porque a aplicação suporta uploads maiores do que o limite de payload de funções serverless da Vercel.

Domínios planejados:

```text
Frontend production:  https://planaut.codisplan.com.br
Frontend development: https://planaut.dev.codisplan.com.br
Backend production:   https://api.planaut.codisplan.com.br
Backend development:  https://api.planaut.dev.codisplan.com.br
```

O frontend recebe `VITE_API_URL` por ambiente Vercel. Não exponha `DATABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET` ou senhas no Vite.

## Variáveis GitHub para Vercel

Secrets usados pelo workflow:

```text
VERCEL_TOKEN
VERCEL_ORG_ID
VERCEL_PROJECT_ID
```

Repository/Environment variables:

```text
VERCEL_DEPLOY_ENABLED=true
VERCEL_PRODUCTION_DOMAIN=planaut.codisplan.com.br
VERCEL_DEVELOPMENT_DOMAIN=planaut.dev.codisplan.com.br
```

Enquanto `VERCEL_DEPLOY_ENABLED` não for `true`, os jobs Vercel ficam deliberadamente desabilitados.

## Variáveis no projeto Vercel

Production:

```env
VITE_API_URL=https://api.planaut.codisplan.com.br
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_ANON_PUBLIC_KEY
```

Preview com filtro para branch `develop`:

```env
VITE_API_URL=https://api.planaut.dev.codisplan.com.br
VITE_SUPABASE_URL=https://YOUR_DEV_PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_DEV_ANON_PUBLIC_KEY
```

`vercel pull --environment=preview --git-branch=develop` baixa exatamente as variáveis específicas da branch antes do build de desenvolvimento. Production usa `vercel pull --environment=production`.

## Semantic versioning

O PR de release deve ser `develop -> main`:

```text
release(patch): descrição
release(minor): descrição
release(major): descrição
```

Se ainda não existir `vX.Y.Z`, a primeira release é `1.0.0`.

```text
1.0.0 --patch--> 1.0.1
1.0.1 --minor--> 1.1.0
1.1.0 --patch--> 1.1.1
1.1.1 --major--> 2.0.0
```

`develop` nunca incrementa a versão estável. Exemplo de versão de desenvolvimento:

```text
1.1.1-develop.248.1
```

## Política GHCR para imagens-base

A aplicação usa apenas bases controladas no namespace GHCR do projeto:

```text
ghcr.io/codisplanai/planilhaat-base-node:22-alpine
ghcr.io/codisplanai/planilhaat-base-python:3.12-slim
ghcr.io/codisplanai/planilhaat-postgres:16-alpine
ghcr.io/codisplanai/planilhaat:<semver|develop>
```

As imagens-base **não são reconstruídas em todo push de `develop` nem em toda release**.

`.github/workflows/container-bases.yml` calcula um fingerprint usando:

```text
package/tag + digest da imagem upstream + SHA256 do Dockerfile wrapper
```

O build/push ocorre somente quando:

- a imagem local ainda não existe;
- o Dockerfile/base/tag mudou;
- o digest da upstream mudou;
- o workflow foi executado manualmente com `force=true`.

Existe uma verificação semanal de upstream. Se não houver mudança de digest, o build é ignorado.

Mudanças em `requirements.txt` ou `frontend/package-lock.json` recompõem **a imagem da aplicação**, não as imagens-base Python/Node, porque essas dependências pertencem à camada da aplicação. Se futuramente uma dependência for promovida para uma imagem-base própria, sua definição deve entrar no mesmo mecanismo de fingerprint.

Se Redis, MySQL, RabbitMQ, MinIO ou outro serviço virar dependência real, primeiro crie uma imagem wrapper no GHCR `codisplanai`; somente depois referencie-a no `compose.yaml`.

## Compose: uma única porta publicada

`compose.yaml` publica somente:

```text
127.0.0.1:${PLANAUT_PORT}:8000
```

PostgreSQL, migrations e demais serviços permanecem exclusivamente na rede Docker interna.

Produção padrão:

```env
PLANAUT_PORT=8000
PLANAUT_BIND_ADDRESS=127.0.0.1
```

Se production e development estiverem em servidores diferentes, ambos podem usar `8000`. Se estiverem simultaneamente no mesmo host, o kernel não permite dois processos escutando o mesmo `IP:porta`; nesse caso cada stack continua expondo apenas **uma** porta, mas uma delas precisa usar outro loopback port (por exemplo `8001`).

## Docker CLI

```bash
cp .env.example .env
# preencher secrets reais

docker compose pull app
docker compose up -d app
```

Com PostgreSQL local opcional:

```bash
docker compose --profile local-db up -d
```

O PostgreSQL local não publica `5432` no host.

## CloudPanel

CloudPanel permanece responsável por DNS/virtual host/Let's Encrypt e reverse proxy.

Produção do backend:

```text
api.planaut.codisplan.com.br -> http://127.0.0.1:8000
```

Development, se estiver no mesmo servidor e usar `PLANAUT_PORT=8001`:

```text
api.planaut.dev.codisplan.com.br -> http://127.0.0.1:8001
```

Use `deploy/cloudpanel/vhost.conf.example` como bloco-base.

## Portainer

Crie uma Stack usando o `compose.yaml` do repositório e cole as variáveis de `.env.example` no Environment da Stack. Não adicione portas ao PostgreSQL. Para produção use `PLANAUT_IMAGE=ghcr.io/codisplanai/planilhaat:<versão>` ou o digest imutável fornecido pela release.

## Dockge

Crie a stack a partir do mesmo `compose.yaml`, copie o `.env.example` para o `.env` gerenciado pelo Dockge e preencha os secrets. O Compose não contém configuração específica de plataforma, portanto a mesma definição é usada por Docker CLI, Dockge e Portainer.

## Deploy Docker via GitHub Actions

Environment `production` no GitHub:

Secrets:

```text
DEPLOY_HOST
DEPLOY_USER
DEPLOY_PORT
DEPLOY_SSH_KEY
DEPLOY_KNOWN_HOSTS
```

Variables:

```text
production:  DEPLOY_PATH=/opt/planaut-production
development: DEPLOY_PATH=/opt/planaut-development
```

O workflow implanta uma tag candidata exclusiva e legível (`release-candidate-X.Y.Z-rN.M`), valida o healthcheck público e só então promove exatamente essa imagem para `production`, `latest` e aliases SemVer. O script de deploy executa Alembic, aguarda o healthcheck do container e tenta rollback para a imagem anterior em caso de falha.

## Primeira configuração necessária

Antes do primeiro deployment automático completo:

1. GHCR: os pacotes já devem estar públicos para pull anônimo.
2. VPS/CloudPanel: executar `deploy/bootstrap-vps.sh`, criar o `.env` real em `/opt/planaut-production` e, se usado, em `/opt/planaut-development`, e configurar os secrets SSH do GitHub.
3. DNS backend: apontar `api.planaut.codisplan.com.br` e, se usado, `api.planaut.dev.codisplan.com.br` para o servidor CloudPanel.
4. Vercel: criar/vincular o projeto do frontend e adicionar os dois domínios frontend.
5. Vercel: configurar as variáveis Production e Preview/`develop`.
6. GitHub: cadastrar `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` e depois definir `VERCEL_DEPLOY_ENABLED=true`.

O arquivo `vercel.env.example` documenta os nomes exatos.

## Cleanup

`maintenance.yml` remove caches efêmeros e imagens development/untagged antigas conforme a política definida. Tags SemVer permanecem para auditoria e rollback. Imagens-base atuais não são apagadas/rebuildadas por pushes normais da aplicação.
