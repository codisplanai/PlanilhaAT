#!/bin/bash
set -e

# ==============================================================================
# Script de Deploy e Configuração Automática - Planilha AT no CloudPanel
# ==============================================================================

APP_DIR="/home/codisplan-planaut/htdocs/planaut.codisplan.com.br"
USER_NAME="codisplan-planaut"

echo "=== 1. Entrando no diretório da aplicação ==="
cd "$APP_DIR"

echo "=== 2. Configurando arquivo de ambiente (.env) ==="
if [ ! -f ".env" ]; then
    echo "Criando .env de produção com credenciais do Supabase..."
    cat << 'EOF' > .env
APP_NAME=PlanAut-Backend
APP_ENV=production
DEBUG=False
ENABLE_LOCAL_AUTH=True
CORS_ORIGINS=https://planaut.codisplan.com.br,http://localhost:3000

DATABASE_URL=postgresql://postgres.isgszwbbtbsnedhlckqj:MRVViIN6GjShtXab@aws-0-sa-east-1.pooler.supabase.com:5432/postgres
SUPABASE_URL=https://isgszwbbtbsnedhlckqj.supabase.co
SUPABASE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlzZ3N6d2JidGJzbmVkaGxja3FqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgxODA4MTYsImV4cCI6MjEwMzc1NjgxNn0.5iPaZwHkpf8uLOZixOLWiR2iRfzl1mXJu8dqKIrOrmM
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlzZ3N6d2JidGJzbmVkaGxja3FqIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4ODE4MDgxNiwiZXhwIjoyMTAzNzU2ODE2fQ.EzHWwcuuGH0WHlOMV-bS6FHXkyXbxAapxFEQxzC6dso
SUPABASE_JWT_SECRET=98f5200e-9285-4cbd-9f56-550eb1d143bb

SUPABASE_STORAGE_BUCKET_TEMPLATES=templates
SUPABASE_STORAGE_BUCKET_OUTPUTS=outputs

STORAGE_DIR=./storage
TEMPLATES_DIR=./storage/templates
OUTPUTS_DIR=./storage/outputs
UPLOADS_DIR=./storage/uploads
EOF
    chown $USER_NAME:$USER_NAME .env
    chmod 600 .env
fi

echo "=== 3. Configurando ambiente Python (venv) ==="
if [ ! -d "venv" ]; then
    python3 -m venv venv
fi
source venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt

echo "=== 4. Verificando Node.js e instalando se necessário ==="
if ! command -v node &> /dev/null; then
    echo "Instalando Node.js 20 LTS..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt-get install -y nodejs
fi

echo "=== 5. Compilando o Frontend (Vite) ==="
cd frontend
npm install
npm run build
cd ..

echo "=== 6. Garantindo diretórios de storage ==="
mkdir -p storage/templates storage/outputs storage/uploads
chown -R $USER_NAME:$USER_NAME storage

echo "=== 7. Configurando serviço Systemd para o Backend FastAPI ==="
sudo tee /etc/systemd/system/planilha-at.service > /dev/null <<EOF
[Unit]
Description=Planilha AT - Backend FastAPI
After=network.target

[Service]
User=$USER_NAME
Group=$USER_NAME
WorkingDirectory=$APP_DIR
Environment="PATH=$APP_DIR/venv/bin:/usr/local/bin:/usr/bin"
ExecStart=$APP_DIR/venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000 --workers 4
Restart=always
RestartSec=5
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable planilha-at
sudo systemctl restart planilha-at

echo "=== 8. Verificando status do serviço ==="
sudo systemctl status planilha-at --no-pager

echo ""
echo "======================================================================"
echo "✅ Instalação e inicialização concluídas com sucesso!"
echo "O Backend está rodando em 127.0.0.1:8000 com 4 workers."
echo "O Frontend compilado está em: $APP_DIR/frontend/dist"
echo "======================================================================"
