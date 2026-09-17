# syntax=docker/dockerfile:1.7
ARG UPSTREAM_IMAGE=python:3.12-slim
FROM ${UPSTREAM_IMAGE}
LABEL org.opencontainers.image.title="PlanilhaAT Python runtime base" \
      org.opencontainers.image.description="Local GHCR mirror/wrapper for the Python image used by PlanilhaAT" \
      org.opencontainers.image.source="https://github.com/codisplanai/PlanilhaAT"
