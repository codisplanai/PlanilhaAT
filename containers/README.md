# Container image policy

PlanilhaAT production builds and deployments do not reference third-party container registries directly.

Owned GHCR packages:

- `ghcr.io/codisplanai/planilhaat-base-node:22-alpine` — frontend build base.
- `ghcr.io/codisplanai/planilhaat-base-python:3.12-slim` — backend runtime base.
- `ghcr.io/codisplanai/planilhaat-postgres:16-alpine` — optional local PostgreSQL service.
- `ghcr.io/codisplanai/planilhaat:<version>` — application image.

`.github/workflows/container-bases.yml` is the only workflow allowed to import third-party base/service images. Application Dockerfiles consume the GHCR packages above.

If Redis, MySQL, RabbitMQ, MinIO or another container dependency is introduced later, add its wrapper Dockerfile and package to `container-bases.yml` before using it in `compose.yaml` or an application Dockerfile.

This policy applies to container images. SaaS APIs such as Supabase are external services, not container image dependencies, and are configured through runtime environment variables.
