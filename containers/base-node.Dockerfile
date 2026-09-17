# syntax=docker/dockerfile:1.7
ARG UPSTREAM_IMAGE=node:22-alpine
FROM ${UPSTREAM_IMAGE}
LABEL org.opencontainers.image.title="PlanilhaAT Node build base" \
      org.opencontainers.image.description="Local GHCR mirror/wrapper for the Node image used to build PlanilhaAT" \
      org.opencontainers.image.source="https://github.com/codisplanai/PlanilhaAT"
