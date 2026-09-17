#!/usr/bin/env sh
set -eu

bool_true() {
  case "${1:-}" in
    1|true|TRUE|yes|YES|on|ON) return 0 ;;
    *) return 1 ;;
  esac
}

wait_for_database() {
  attempts="${DATABASE_WAIT_ATTEMPTS:-30}"
  interval="${DATABASE_WAIT_INTERVAL_SECONDS:-2}"
  current=1

  while [ "$current" -le "$attempts" ]; do
    if python - <<'PY'
from sqlalchemy import text
from app.core.database import engine

with engine.connect() as connection:
    connection.execute(text("SELECT 1"))
PY
    then
      echo "Database connection is ready."
      return 0
    fi

    echo "Database not ready (${current}/${attempts}); retrying in ${interval}s..."
    current=$((current + 1))
    sleep "$interval"
  done

  echo "ERROR: database did not become ready after ${attempts} attempts." >&2
  return 1
}

if bool_true "${WAIT_FOR_DATABASE:-true}"; then
  wait_for_database
fi

if bool_true "${RUN_MIGRATIONS_ON_START:-true}"; then
  echo "Applying Alembic migrations..."
  alembic upgrade head
fi

exec "$@"
