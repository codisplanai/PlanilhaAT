# Deploy Docker + GHCR

## Fluxo oficial

O projeto usa duas branches permanentes:

```text
feature/*, fix/*, refactor/*, chore/*, docs/*, test/*, ci/*, perf/*
                         ↓ PR
                      develop
                         ↓ PR release(...)
                       main
                         ↓
                GHCR release + VPS
```

### PR para develop

**Branch**

```text
feature/nome-da-feature
fix/nome-da-correcao
refactor/nome-da-refatoracao
chore/nome
ci/nome
```

**Título**

```text
feat(auth): adicionar autenticação
fix(api): corrigir timeout
refactor(fiscal): separar regras de cálculo
ci(ghcr): ajustar validação de imagens
```

**Descrição**

Use `.github/PULL_REQUEST_TEMPLATE.md` e mantenha obrigatoriamente as seções `## Descrição` e `## Branch`.

O workflow `pr-validation.yml` não gera imagem, não executa Vite build e não cria release. Ele valida:

- título, descrição e origem/destino da branch;
- sintaxe e indentação Python;
- lint + typecheck TypeScript sem emissão de arquivos;
- sintaxe Bash;
- sintaxe do `compose.yaml`.

### develop

Depois do merge do PR em `develop`, `develop-image.yml` executa os testes completos e publica uma imagem de desenvolvimento no GHCR.

Exemplo, considerando a última release estável `1.1.1`:

```text
ghcr.io/ORG/REPO:develop
ghcr.io/ORG/REPO:develop-1.1.1
ghcr.io/ORG/REPO:develop-1.1.1-r245.1
ghcr.io/ORG/REPO:dev-sha-a1b2c3d4e5f6
```

A versão exposta pela aplicação fica no formato SemVer com build metadata, por exemplo:

```text
1.1.1+develop.245.1
```

`develop` nunca cria GitHub Release e nunca incrementa a versão estável.

## PR develop -> main

A `main` aceita release somente a partir de `develop`.

Use um dos títulos:

```text
release(patch): correções da versão
release(minor): nova funcionalidade compatível
release(major): alteração incompatível
```

O merge dispara `release.yml`.

### SemVer automático

Se ainda não existir nenhuma tag SemVer, a primeira release será:

```text
1.0.0
```

Depois:

```text
1.0.0 --patch--> 1.0.1
1.0.1 --minor--> 1.1.0
1.1.0 --patch--> 1.1.1
1.1.1 --major--> 2.0.0
```

Um incremento `minor` zera o componente `patch`; um incremento `major` zera `minor` e `patch`.

## Imagens de release

Para `1.1.1`, o GHCR recebe aliases:

```text
ghcr.io/ORG/REPO:latest
ghcr.io/ORG/REPO:1.1.1
ghcr.io/ORG/REPO:1.1
ghcr.io/ORG/REPO:1
ghcr.io/ORG/REPO:release-sha-<merge_commit_sha>
```

O deployment não usa uma tag mutável. O workflow envia para a VPS a referência imutável por digest:

```text
ghcr.io/ORG/REPO@sha256:...
```

Depois do healthcheck positivo, o workflow cria a tag Git `v1.1.1` e a GitHub Release correspondente.

## GHCR público

O Container Registry permite pull anônimo quando o pacote é Public. Depois da primeira publicação, altere a visibilidade do pacote para **Public** nas configurações do GitHub Packages.

A VPS não precisa guardar token do GHCR para fazer pull da imagem pública.

## Manutenção automática

`maintenance.yml` roda a cada hora.

Ele executa três políticas:

1. quando um PR é fechado, remove o cache do GitHub Actions associado ao PR;
2. remove caches efêmeros fora de `main`/`develop` que não são acessados há mais de 2 horas;
3. remove versões GHCR `develop-*`, `dev-sha-*` e untagged com mais de 2 horas, preservando sempre a imagem de desenvolvimento mais recente.

Versões de release SemVer (`1`, `1.1`, `1.1.1`, `latest`, `release-sha-*`) são preservadas e não entram nessa limpeza.

Na VPS, após um deploy saudável, `deploy.sh` remove imagens dangling não utilizadas com idade superior a `PRUNE_AFTER_HOURS` (padrão `2`) e tenta remover a referência da imagem anterior se ela não estiver mais em uso.

## Secrets e Variables do GitHub

No Environment `production`, configure:

- Secret `DEPLOY_HOST`: host/IP da VPS;
- Secret `DEPLOY_USER`: usuário SSH com acesso ao Docker;
- Secret `DEPLOY_PORT`: porta SSH, opcional, padrão `22`;
- Secret `DEPLOY_SSH_KEY`: chave privada SSH exclusiva do deploy;
- Secret `DEPLOY_KNOWN_HOSTS`: host key confiável da VPS;
- Variable `DEPLOY_PATH`: opcional, padrão `/opt/planaut`.

Os workflows usam `GITHUB_TOKEN` para publicar e manter o pacote GHCR associado ao repositório.

## Preparar a VPS

Em Ubuntu/Debian:

```bash
sudo bash deploy/bootstrap-vps.sh
```

Depois:

```bash
sudo mkdir -p /opt/planaut/deploy
sudo chown -R "$USER":"$USER" /opt/planaut
cd /opt/planaut
cp .env.example .env
nano .env
```

O `.env` real existe somente na VPS e nunca deve ser commitado.

## Primeiro deploy manual

```bash
cd /opt/planaut
PLANAUT_IMAGE=ghcr.io/ORG/REPO:latest docker compose pull app migrate
PLANAUT_IMAGE=ghcr.io/ORG/REPO:latest docker compose --profile tools run --rm migrate
PLANAUT_IMAGE=ghcr.io/ORG/REPO:latest docker compose up -d app
```

Depois da configuração inicial, produção é atualizada somente pelo merge do PR `develop -> main`.

## Reverse proxy

CloudPanel/Nginx deve apontar para:

```text
http://127.0.0.1:8000
```

Não exponha a porta `8000` diretamente na internet.
