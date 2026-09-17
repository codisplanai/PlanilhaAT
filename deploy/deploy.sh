#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="${APP_DIR:-/opt/planaut}"
IMAGE="${1:-${PLANAUT_IMAGE:-}}"
PRUNE_AFTER_HOURS="${PRUNE_AFTER_HOURS:-2}"

if [[ -z "$IMAGE" ]]; then
  echo "Uso: PLANAUT_IMAGE=ghcr.io/org/repo:tag $0"
  echo "  ou: $0 ghcr.io/org/repo@sha256:digest"
  exit 2
fi

if [[ ! "$PRUNE_AFTER_HOURS" =~ ^[0-9]+$ ]]; then
  echo "ERRO: PRUNE_AFTER_HOURS precisa ser um número inteiro."
  exit 2
fi

cd "$APP_DIR"

if [[ ! -f .env ]]; then
  echo "ERRO: $APP_DIR/.env não existe. Copie .env.example para .env e configure os segredos."
  exit 2
fi

export PLANAUT_IMAGE="$IMAGE"

previous_image="$(docker inspect --format='{{.Config.Image}}' planaut-app 2>/dev/null || true)"

echo "==> Pull da imagem imutável: $PLANAUT_IMAGE"
docker compose pull app migrate

echo "==> Aplicando migrations Alembic"
docker compose --profile tools run --rm migrate

echo "==> Atualizando container da aplicação"
docker compose up -d --no-deps app

echo "==> Aguardando healthcheck"
for attempt in {1..30}; do
  status="$(docker inspect --format='{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' planaut-app 2>/dev/null || true)"
  if [[ "$status" == "healthy" ]]; then
    echo "Deploy concluído: $PLANAUT_IMAGE"

    # Remove apenas imagens não utilizadas/dangling antigas. A VPS não compila
    # a aplicação, portanto não há build cache do PlanAut para manter aqui.
    docker image prune -f --filter "until=${PRUNE_AFTER_HOURS}h" >/dev/null 2>&1 || true

    # Se a imagem anterior ficou sem uso, tenta removê-la. Nunca falha o deploy
    # caso ela ainda esteja referenciada por outro container/tag.
    if [[ -n "$previous_image" && "$previous_image" != "$PLANAUT_IMAGE" ]]; then
      docker image rm "$previous_image" >/dev/null 2>&1 || true
    fi

    exit 0
  fi

  if [[ "$status" == "unhealthy" || "$status" == "exited" || "$status" == "dead" ]]; then
    echo "ERRO: container ficou $status"
    docker compose logs --tail=200 app
    exit 1
  fi
  sleep 2
done

echo "ERRO: timeout aguardando healthcheck"
docker compose logs --tail=200 app
exit 1
