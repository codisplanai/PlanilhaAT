# syntax=docker/dockerfile:1.7
ARG UPSTREAM_IMAGE=postgres:16-alpine
FROM ${UPSTREAM_IMAGE}
LABEL org.opencontainers.image.title="PlanilhaAT PostgreSQL service image" \
      org.opencontainers.image.description="Local GHCR mirror/wrapper for optional self-hosted PostgreSQL" \
      org.opencontainers.image.source="https://github.com/codisplanai/PlanilhaAT"
