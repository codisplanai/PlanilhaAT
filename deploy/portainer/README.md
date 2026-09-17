# Portainer deployment

Use the root `compose.yaml` as the Portainer Stack source.

1. Create a Stack named `planilhaat`.
2. Use the repository `compose.yaml` or paste it into the Web editor.
3. Import variables from `.env.example` and replace placeholders/secrets.
4. Keep `BIND_ADDRESS=127.0.0.1` when CloudPanel/Nginx runs on the same host.
5. Set `PLANAUT_IMAGE=ghcr.io/codisplanai/planilhaat:<stable-version>` for manual deployments. GitHub Actions deploys the immutable digest.
6. Deploy the stack.

The application container can run Alembic at startup for one-click Stack updates. The `migrate` service remains available under the `tools` profile.

For local PostgreSQL, enable profile `local-db`, set a strong `POSTGRES_PASSWORD`, and use `DATABASE_URL=postgresql://planilhaat:PASSWORD@postgres:5432/planilhaat`.

The PostgreSQL service uses `ghcr.io/codisplanai/planilhaat-postgres:16-alpine`, not Docker Hub.
