from fastapi.middleware.cors import CORSMiddleware
from fastapi import FastAPI, APIRouter, Request
from fastapi.responses import JSONResponse
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

@app.on_event("startup")
def on_startup():
    Base.metadata.create_all(bind=engine)
    
    # Garantir coluna usuario_id caso banco sqlite já existisse
    try:
        with engine.begin() as conn:
            inspector = sa.inspect(conn)
            if 'solicitacoes' in inspector.get_table_names():
                columns = [c['name'] for c in inspector.get_columns('solicitacoes')]
                if 'usuario_id' not in columns:
                    conn.execute(sa.text("ALTER TABLE solicitacoes ADD COLUMN usuario_id VARCHAR(36)"))
    except Exception:
        pass

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
