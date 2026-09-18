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
                    +--> GHCR :develop (artefato para uso manual)
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
                    +--> imagem candidata GHCR
                    +--> Vercel Production + healthcheck
                    +--> aliases GHCR estáveis
                    +--> Git tag + GitHub Release
```

A Vercel é o **único destino de deployment automatizado**. GitHub Actions valida a aplicação, cria uma imagem candidata GHCR, exige que o deployment Vercel Production e seu healthcheck terminem com sucesso e somente depois publica os aliases GHCR estáveis, a Git tag e a GitHub Release. CloudPanel, Docker Compose, Dockge e Portainer são alternativas exclusivamente manuais e não participam de nenhum workflow, gate ou Action.

## Vercel full-stack em projeto único

O projeto Vercel `planaut` publica frontend e FastAPI no mesmo deployment.

```text
Production:  https://planaut.codisplan.com.br
Development: https://planaut.dev.codisplan.com.br

/api/*        -> FastAPI
/v1/*         -> FastAPI (alias legado)
/docs         -> FastAPI
/openapi.json -> FastAPI
/*            -> React/Vite
```

`VITE_API_URL` não é usado no deployment Vercel: o frontend chama `/api/v1` no mesmo domínio. Isso elimina DNS/CORS e um segundo projeto apenas para a API.

Os secrets privados do backend (`DATABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`) nunca recebem prefixo `VITE_`.

> Limite de upload: Vercel Functions limita payloads HTTP a 4,5 MB. Os endpoints atuais de XML/SPED/template ainda aceitam limites maiores no backend Docker; no runtime Vercel, arquivos maiores precisam migrar para upload direto ao Storage antes de serem processados. O deployment full-stack não deve ser interpretado como aumento desse limite da plataforma.

## Variáveis GitHub para Vercel

Secrets obrigatórios por GitHub Environment para o deployment full-stack:

```text
VERCEL_TOKEN
DATABASE_URL
SUPABASE_SERVICE_ROLE_KEY
```

Configuração pública do frontend:

```text
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
```

Variables usadas pelo workflow:

```text
VERCEL_SCOPE=codisplan
VERCEL_PROJECT_NAME=planaut
VERCEL_PRODUCTION_DOMAIN=planaut.codisplan.com.br
VERCEL_DEVELOPMENT_DOMAIN=planaut.dev.codisplan.com.br
CORS_ORIGINS=https://planaut.codisplan.com.br,https://planaut.dev.codisplan.com.br
```

O projeto Vercel é vinculado/criado pela própria CLI no primeiro run configurado; `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` e `VERCEL_DEPLOY_ENABLED` não são requisitos do fluxo atual.

## Variáveis no projeto Vercel

O workflow injeta as variáveis necessárias durante build/deploy. `VITE_API_URL` é forçada para vazio, ativando o fallback same-origin `/api/v1`.

O backend recebe em runtime `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_KEY`, `SUPABASE_SERVICE_ROLE_KEY` e, quando configurado, `SUPABASE_JWT_SECRET`.

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

## Deployments manuais

Os diretórios `deploy/cloudpanel`, `deploy/dockge`, `deploy/portainer`, o `compose.yaml` raiz e os scripts em `deploy/` são entregáveis prontos para operação manual.

Eles **não são executados, validados como gate, enviados por SSH nem acionados por GitHub Actions**. O operador escolhe quando e onde usar esses pacotes.

## Primeira configuração necessária para o deployment automatizado

Para Vercel Preview/Production:

1. configurar `VERCEL_TOKEN`, `DATABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` nos GitHub Environments;
2. configurar `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` por ambiente;
3. manter `planaut.codisplan.com.br` e `planaut.dev.codisplan.com.br` como aliases do projeto único `planaut`;
4. não configurar `VITE_API_URL` no Vercel automatizado;
5. manter CloudPanel/Docker/Dockge/Portainer apenas para implantação manual quando necessário.

O arquivo `vercel.env.example` documenta os nomes exatos.

## Cleanup

`maintenance.yml` remove caches efêmeros e imagens development/untagged antigas conforme a política definida. Tags SemVer permanecem para auditoria e rollback. Imagens-base atuais não são apagadas/rebuildadas por pushes normais da aplicação.
