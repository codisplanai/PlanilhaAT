# PlanilhaAT deployment architecture

## Official release flow

```text
feature/* | fix/* | refactor/* | ci/* | ...
                    |
                    | PR -> static validation only
                    v
                 develop
                    |
                    | full tests + production frontend build
                    | GHCR development image (no GitHub Release)
                    v
          PR release(patch|minor|major)
                    |
                    v
                  main
                    |
                    +--> refresh owned GHCR base/service images
                    +--> full tests + PWA validation
                    +--> release image + SBOM + provenance
                    +--> anonymous/public GHCR pull check
                    +--> immutable digest deploy
                    +--> healthcheck / automatic rollback on failure
                    +--> Git tag + GitHub Release + release notes/assets
```

PR validation deliberately does **not** run a Docker build or `npm run build`. Build work happens only after changes reach `develop` and during an actual release.

## Semantic versioning

The release PR must be `develop -> main` and use exactly one of:

```text
release(patch): description
release(minor): description
release(major): description
```

If no `vX.Y.Z` tag exists, the first release is always `1.0.0`.

```text
1.0.0 --patch--> 1.0.1
1.0.1 --minor--> 1.1.0
1.1.0 --patch--> 1.1.1
1.1.1 --major--> 2.0.0
```

Git tags are the stable-version source of truth. `develop` publishes prerelease-style application versions such as `1.0.0-develop.245.1` but never increments the stable version.

## GHCR image ownership policy

Release builds use only project-owned container images:

```text
ghcr.io/codisplanai/planilhaat-base-node:22-alpine
ghcr.io/codisplanai/planilhaat-base-python:3.12-slim
ghcr.io/codisplanai/planilhaat-postgres:16-alpine
ghcr.io/codisplanai/planilhaat:<semver>
```

Only `.github/workflows/container-bases.yml` imports upstream Docker images. If Redis/MySQL/RabbitMQ/MinIO or another container service becomes a real dependency, add its wrapper/package to that workflow before using it anywhere else.

Supabase remains a runtime SaaS dependency and is configured with environment variables; it is not a single external image that can be mirrored without replacing the service architecture.

## First-publication GHCR visibility

GitHub Container Registry packages are private when first published. The release workflow creates/checks all packages and deliberately blocks deployment unless anonymous pulls work for:

- `planilhaat`
- `planilhaat-base-node`
- `planilhaat-base-python`
- `planilhaat-postgres`

One-time action after their first publication: open each package's **Package settings -> Change visibility -> Public**, then re-run the failed jobs. The VPS then needs no GHCR login.

## Release tags

For release `1.1.1`:

```text
ghcr.io/codisplanai/planilhaat:latest
ghcr.io/codisplanai/planilhaat:1.1.1
ghcr.io/codisplanai/planilhaat:1.1
ghcr.io/codisplanai/planilhaat:1
ghcr.io/codisplanai/planilhaat:release-sha-<merge-sha>
```

Production deploys by immutable digest (`ghcr.io/...@sha256:...`), not by mutable tag.

## GitHub Environment `production`

Secrets:

- `DEPLOY_HOST`
- `DEPLOY_USER`
- `DEPLOY_PORT` (optional, defaults to `22`)
- `DEPLOY_SSH_KEY`
- `DEPLOY_KNOWN_HOSTS`

Variable:

- `DEPLOY_PATH=/opt/planilhaat`

## Docker CLI / VPS

Bootstrap Ubuntu/Debian:

```bash
sudo bash deploy/bootstrap-vps.sh
```

Prepare `/opt/planilhaat/.env` from `.env.example`. Real secrets stay only in the host/stack manager.

Manual stable deployment:

```bash
PLANAUT_IMAGE=ghcr.io/codisplanai/planilhaat:1.0.0 docker compose pull app
PLANAUT_IMAGE=ghcr.io/codisplanai/planilhaat:1.0.0 docker compose --profile tools run --rm migrate
PLANAUT_IMAGE=ghcr.io/codisplanai/planilhaat:1.0.0 docker compose up -d app
```

Normal production releases are deployed by GitHub Actions using an immutable image digest and healthcheck/rollback.

## Portainer / Dockge / CloudPanel

- Portainer: see `deploy/portainer/README.md`.
- Dockge: see `deploy/dockge/README.md`.
- CloudPanel: use `deploy/cloudpanel/vhost.conf.example` for reverse proxy/TLS to `http://127.0.0.1:8000`.

The PWA requires HTTPS outside localhost, so CloudPanel TLS should be active before production validation.

## Optional local PostgreSQL

With profile `local-db`:

```env
DATABASE_URL=postgresql://planilhaat:CHANGE_ME@postgres:5432/planilhaat
POSTGRES_PASSWORD=CHANGE_ME
```

```bash
docker compose --profile local-db up -d
```

## Cleanup policy

Every hour `maintenance.yml`:

- deletes caches associated with closed PRs;
- deletes ephemeral Actions caches older than 2 hours outside `main`/`develop`;
- deletes stale develop/untagged application package versions older than 2 hours while retaining the newest development image;
- deletes stale untagged Node/Python/PostgreSQL GHCR versions older than 2 hours.

Stable SemVer releases are preserved for audit and rollback. After a healthy VPS deploy, dangling local Docker images older than `PRUNE_AFTER_HOURS` (default 2) are pruned.
