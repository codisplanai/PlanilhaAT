#!/bin/bash
set -e

# ==============================================================================
# Script de Atualização Rápida - Planilha AT no CloudPanel
# ==============================================================================

APP_DIR="/home/codisplan-planaut/htdocs/planaut.codisplan.com.br"
USER_NAME="codisplan-planaut"

echo "=== 1. Entrando no diretório da aplicação ==="
cd "$APP_DIR"

echo "=== 2. Puxando as atualizações do GitHub ==="
git pull origin main

echo "=== 3. Atualizando dependências Python ==="
source venv/bin/activate
pip install -r requirements.txt

echo "=== 4. Recompilando o Frontend ==="
cd frontend
npm install
npm run build
cd ..

echo "=== 5. Reiniciando o serviço Backend ==="
sudo systemctl restart planilha-at
sudo systemctl status planilha-at --no-pager

echo ""
echo "======================================================================"
echo "✅ Aplicação atualizada com sucesso no VPS!"
echo "======================================================================"
