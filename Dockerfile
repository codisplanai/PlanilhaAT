# syntax=docker/dockerfile:1.7

# IMPORTANT:
# Application builds consume only GHCR-owned base images. The upstream Docker Hub
# images are imported into GHCR by .github/workflows/container-bases.yml.
ARG NODE_BASE_IMAGE=ghcr.io/codisplanai/planilhaat-base-node:22-alpine
ARG PYTHON_BASE_IMAGE=ghcr.io/codisplanai/planilhaat-base-python:3.12-slim

FROM ${NODE_BASE_IMAGE} AS frontend-builder
WORKDIR /build/frontend

COPY frontend/package.json frontend/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci

COPY frontend/ ./
RUN npm run build


FROM ${PYTHON_BASE_IMAGE} AS runtime

ARG APP_VERSION=development

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1 \
    APP_ENV=production \
    DEBUG=False \
    ENABLE_LOCAL_AUTH=False \
    AUTO_CREATE_SCHEMA=False \
    SEED_DEFAULTS=False \
    RUN_MIGRATIONS_ON_START=True \
    WAIT_FOR_DATABASE=True \
    DATABASE_WAIT_ATTEMPTS=30 \
    DATABASE_WAIT_INTERVAL_SECONDS=2 \
    APP_VERSION=${APP_VERSION}

WORKDIR /app

RUN groupadd --system --gid 10001 planaut \
    && useradd --system --uid 10001 --gid planaut --home-dir /app --shell /usr/sbin/nologin planaut

COPY requirements.txt ./
RUN pip install --upgrade pip \
    && pip install -r requirements.txt

COPY alembic.ini ./
COPY alembic/ ./alembic/
COPY app/ ./app/
COPY storage/data/ ./storage/data/
COPY storage/templates/ ./bundled_templates/
COPY deploy/container-entrypoint.sh /usr/local/bin/planaut-entrypoint
COPY --from=frontend-builder /build/frontend/dist ./frontend/dist

RUN chmod 0555 /usr/local/bin/planaut-entrypoint \
    && mkdir -p ./storage/templates ./storage/outputs ./storage/uploads \
    && chown -R planaut:planaut /app

USER planaut

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=3).read()" || exit 1

ENTRYPOINT ["/usr/local/bin/planaut-entrypoint"]
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "2", "--proxy-headers", "--forwarded-allow-ips=*"]
