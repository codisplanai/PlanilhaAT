# Dockge deployment

The root `compose.yaml` can be used directly as a Dockge stack.

Recommended stack directory:

```text
/opt/stacks/planilhaat/
  compose.yaml
  .env
```

Copy `.env.example` to `.env`, configure production values, then create/import the stack in Dockge. Leave `BIND_ADDRESS=127.0.0.1` when CloudPanel is the public reverse proxy.

Normal start/update:

```bash
docker compose pull
docker compose up -d
```

Local PostgreSQL profile:

```bash
docker compose --profile local-db up -d
```

The app image and optional PostgreSQL image are pulled from the public `codisplanai` GHCR namespace.
