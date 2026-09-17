#!/usr/bin/env bash
set -Eeuo pipefail

# Executar como root em Ubuntu ou Debian recente.
# Instala Docker Engine + Buildx + Compose Plugin pelo repositorio oficial Docker.

if [[ "${EUID}" -ne 0 ]]; then
  echo "Execute como root: sudo bash deploy/bootstrap-vps.sh"
  exit 1
fi

apt-get update
apt-get install -y ca-certificates curl

. /etc/os-release
case "${ID}" in
  ubuntu|debian) DOCKER_DISTRO="${ID}" ;;
  *)
    echo "Distribuicao nao suportada automaticamente: ${ID}. Instale Docker Engine/Compose pela documentacao oficial."
    exit 1
    ;;
esac

install -m 0755 -d /etc/apt/keyrings
curl -fsSL "https://download.docker.com/linux/${DOCKER_DISTRO}/gpg" -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc

echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/${DOCKER_DISTRO} ${VERSION_CODENAME} stable" \
  > /etc/apt/sources.list.d/docker.list

apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
systemctl enable --now docker

DEPLOY_USER="${SUDO_USER:-}"
if [[ -n "$DEPLOY_USER" && "$DEPLOY_USER" != "root" ]]; then
  usermod -aG docker "$DEPLOY_USER"
  echo "Usuario '$DEPLOY_USER' adicionado ao grupo docker. Saia e entre novamente na sessao SSH para aplicar o grupo."
fi

mkdir -p /opt/planaut
if [[ -n "$DEPLOY_USER" && "$DEPLOY_USER" != "root" ]]; then
  chown -R "$DEPLOY_USER":"$DEPLOY_USER" /opt/planaut
else
  chmod 755 /opt/planaut
fi

echo "Docker instalado. Copie compose.yaml e .env para /opt/planaut antes do primeiro deploy."
docker --version
docker compose version
