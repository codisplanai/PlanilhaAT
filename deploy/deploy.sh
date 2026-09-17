#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="${APP_DIR:-/opt/planaut}"
IMAGE="${1:-${PLANAUT_IMAGE:-}}"
PRUNE_AFTER_HOURS="${PRUNE_AFTER_HOURS:-2}"

if [[ -z "$IMAGE" ]]; then
  echo "Usage: $0 ghcr.io/codisplanai/planilhaat:<readable-tag>"
  exit 2
fi

if [[ ! "$PRUNE_AFTER_HOURS" =~ ^[0-9]+$ ]]; then
  echo "ERROR: PRUNE_AFTER_HOURS must be an integer."
  exit 2
fi

cd "$APP_DIR"

if [[ ! -f .env ]]; then
  echo "ERROR: $APP_DIR/.env does not exist. Copy .env.example to .env and configure production secrets."
  exit 2
fi

export PLANAUT_IMAGE="$IMAGE"

previous_container_id="$(docker compose ps -q app 2>/dev/null || true)"
previous_image=""
if [[ -n "$previous_container_id" ]]; then
  previous_image="$(docker inspect --format='{{.Config.Image}}' "$previous_container_id" 2>/dev/null || true)"
fi

rollback() {
  if [[ -z "$previous_image" || "$previous_image" == "$PLANAUT_IMAGE" ]]; then
    echo "No previous application image is available for automatic rollback." >&2
    return 0
  fi

  echo "Rolling back to previous image: $previous_image" >&2
  export PLANAUT_IMAGE="$previous_image"
  docker compose up -d --no-deps app || true
}

show_logs_and_fail() {
  docker compose logs --tail=250 app || true
  rollback
  exit 1
}

printf '==> Pull release image: %s\n' "$PLANAUT_IMAGE"
docker compose pull app

printf '==> Apply Alembic migrations\n'
docker compose --profile tools run --rm migrate

# The explicit migration above is authoritative for GitHub-driven deploys.
# Portainer/Dockge can keep RUN_MIGRATIONS_ON_START=true for one-click stacks.
export RUN_MIGRATIONS_ON_START=false

printf '==> Update application container\n'
docker compose up -d --no-deps app

printf '==> Wait for healthcheck\n'
for attempt in {1..45}; do
  current_container_id="$(docker compose ps -q app 2>/dev/null || true)"
  status=""
  if [[ -n "$current_container_id" ]]; then
    status="$(docker inspect --format='{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$current_container_id" 2>/dev/null || true)"
  fi

  if [[ "$status" == "healthy" ]]; then
    echo "Deploy completed: $IMAGE"
    docker image prune -f --filter "until=${PRUNE_AFTER_HOURS}h" >/dev/null 2>&1 || true

    if [[ -n "$previous_image" && "$previous_image" != "$IMAGE" ]]; then
      docker image rm "$previous_image" >/dev/null 2>&1 || true
    fi

    exit 0
  fi

  if [[ "$status" == "unhealthy" || "$status" == "exited" || "$status" == "dead" ]]; then
    echo "ERROR: application container became $status" >&2
    show_logs_and_fail
  fi

  echo "Health status: ${status:-starting} (${attempt}/45)"
  sleep 2
done

echo "ERROR: timed out waiting for application healthcheck" >&2
show_logs_and_fail
