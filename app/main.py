import os
from fastapi.middleware.cors import CORSMiddleware
from fastapi import FastAPI, APIRouter, Request, HTTPException
from fastapi.responses import JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles
import sqlalchemy as sa

import app.models  # noqa: F401 - registra os modelos no metadata do SQLAlchemy
from app.api.router import api_router
from app.api.endpoints.auth import router as auth_router
from app.api.endpoints.empresas import router as empresas_router
from app.api.endpoints.perfis_regras import router as perfis_regras_router
from app.api.endpoints.regras_aliquotas import router as regras_aliquotas_router
from app.api.endpoints.regras_cfop import router as regras_cfop_router
from app.api.endpoints.templates import router as templates_router
from app.api.endpoints.solicitacoes import router as solicitacoes_router
from app.core.config import settings
from app.core.database import Base, SessionLocal, engine
from app.core.exceptions import PlanilhaATException
from app.core.seeds import seed_default_cfop_rules, seed_default_templates

app = FastAPI(
    title=settings.APP_NAME,
    description="Backend para automação de cálculo de antecipação tributária, DIFAL e preenchimento de planilhas Excel preservando fórmulas.",
    version="1.0.0",
    docs_url="/docs",
    openapi_url="/openapi.json"
)

# Middleware para normalizar caminhos de requisição reescritos pela Vercel
@app.middleware("http")
async def vercel_path_normalizer(request: Request, call_next):
    matched_path = request.headers.get("x-matched-path") or request.headers.get("x-vercel-matched-path")
    if matched_path and request.scope.get("path") in ["/api/index.py", "/api"]:
        request.scope["path"] = matched_path
    response = await call_next(request)
    return response

# create_all nao altera tabelas ja existentes: colunas adicionadas depois que o banco
# foi criado precisam ser aplicadas explicitamente.
COLUNAS_ESPERADAS = [
    ("solicitacoes", "usuario_id", "VARCHAR(36)"),
    ("perfis_regras", "configuracoes_extras", "JSON NOT NULL DEFAULT '{}'"),
]


def garantir_colunas_ausentes(bind):
    """Adiciona em bancos antigos as colunas declaradas nos modelos que ainda nao existem."""
    import logging
    logger = logging.getLogger("app")
    inspector = sa.inspect(bind)
    tabelas = set(inspector.get_table_names())
    for tabela, coluna, definicao in COLUNAS_ESPERADAS:
        if tabela not in tabelas:
            continue
        try:
            existentes = {c["name"] for c in inspector.get_columns(tabela)}
            if coluna not in existentes:
                with bind.begin() as conn:
                    conn.execute(sa.text(f"ALTER TABLE {tabela} ADD COLUMN {coluna} {definicao}"))
                logger.info(f"Coluna '{coluna}' adicionada com sucesso à tabela '{tabela}'.")
        except Exception as e:
            logger.warning(f"Erro ao verificar/adicionar coluna '{coluna}' na tabela '{tabela}': {e}")


@app.on_event("startup")
def on_startup():
    Base.metadata.create_all(bind=engine)
    
    # Garantir colunas que o modelo declara mas que faltam em bancos ja existentes
    try:
        garantir_colunas_ausentes(engine)
    except Exception as e:
        import logging
        logging.getLogger("app").warning(f"Erro geral no startup ao garantir colunas: {e}")

    db = SessionLocal()
    try:
        seed_default_templates(db)
        seed_default_cfop_rules(db)
    finally:
        db.close()

# Middleware CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Exception handler customizado para exceções de domínio
@app.exception_handler(PlanilhaATException)
async def planilha_at_exception_handler(request: Request, exc: PlanilhaATException):
    return JSONResponse(
        status_code=exc.status_code,
        content={"detail": exc.message}
    )

@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    import logging
    logging.getLogger("app").error(f"Erro não tratado na rota {request.url}: {exc}", exc_info=True)
    detail_msg = str(exc) if settings.DEBUG else "Erro interno do servidor ao processar a solicitação."
    return JSONResponse(
        status_code=500,
        content={"detail": detail_msg}
    )

# Registra rotas em /api/v1
app.include_router(api_router)

# Registra também em /v1 como alias de segurança para ambientes serverless
v1_router = APIRouter(prefix="/v1")
v1_router.include_router(auth_router)
v1_router.include_router(perfis_regras_router)
v1_router.include_router(empresas_router)
v1_router.include_router(regras_aliquotas_router)
v1_router.include_router(regras_cfop_router)
v1_router.include_router(templates_router)
v1_router.include_router(solicitacoes_router)
app.include_router(v1_router)

@app.get("/api/health")
@app.get("/api")
def health():
    return {
        "status": "online",
        "app": settings.APP_NAME,
        "docs": "/docs"
    }

# Servir Frontend SPA estático caso Python seja chamado para rotas web
dist_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "frontend", "dist")
if os.path.exists(dist_dir):
    assets_dir = os.path.join(dist_dir, "assets")
    if os.path.exists(assets_dir):
        app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")

    @app.get("/")
    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str = ""):
        if full_path and (full_path.startswith("api/") or full_path == "docs" or full_path == "openapi.json" or full_path.startswith("v1/")):
            raise HTTPException(status_code=404, detail="Not Found")
        
        file_path = os.path.join(dist_dir, full_path)
        if full_path and os.path.isfile(file_path):
            return FileResponse(file_path)
        
        index_file = os.path.join(dist_dir, "index.html")
        if os.path.exists(index_file):
            return FileResponse(index_file)
        
        return {"status": "online", "app": settings.APP_NAME}
