import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import APIRouter, Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import inspect, text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

import app.models  # noqa: F401 - registra os modelos no metadata do SQLAlchemy
from app.api.endpoints.auth import router as auth_router
from app.api.endpoints.empresas import router as empresas_router
from app.api.endpoints.perfis_regras import router as perfis_regras_router
from app.api.endpoints.regras_aliquotas import router as regras_aliquotas_router
from app.api.endpoints.regras_cfop import router as regras_cfop_router
from app.api.endpoints.solicitacoes import router as solicitacoes_router
from app.api.endpoints.templates import router as templates_router
from app.api.endpoints.usuarios import router as usuarios_router
from app.api.router import api_router
from app.core.config import settings
from app.core.database import Base, SessionLocal, engine, get_db
from app.core.exceptions import PlanilhaATException
from app.core.seeds import seed_default_cfop_rules, seed_default_templates

logger = logging.getLogger("app")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # Em produção, o esquema pertence ao Alembic. Mutá-lo no boot causava
    # corridas entre instâncias serverless e escondia migrações incompletas.
    if settings.AUTO_CREATE_SCHEMA:
        Base.metadata.create_all(bind=engine)

    if settings.SEED_DEFAULTS:
        db = SessionLocal()
        try:
            seed_default_templates(db)
            seed_default_cfop_rules(db)
        finally:
            db.close()
    yield


app = FastAPI(
    title=settings.APP_NAME,
    description=(
        "Backend para automação de cálculo de antecipação tributária, "
        "DIFAL e preenchimento de planilhas Excel preservando fórmulas."
    ),
    version="1.0.0",
    docs_url="/docs",
    openapi_url="/openapi.json",
    lifespan=lifespan,
)


@app.middleware("http")
async def vercel_path_normalizer(request: Request, call_next):
    matched_path = request.headers.get("x-matched-path") or request.headers.get("x-vercel-matched-path")
    if matched_path and request.scope.get("path") in {"/api/index.py", "/api"}:
        request.scope["path"] = matched_path
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    response.headers.setdefault("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
    return response


app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials="*" not in settings.cors_origins,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)
app.add_middleware(GZipMiddleware, minimum_size=1000)


@app.exception_handler(PlanilhaATException)
async def planilha_at_exception_handler(_request: Request, exc: PlanilhaATException):
    return JSONResponse(status_code=exc.status_code, content={"detail": exc.message})


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.error("Erro não tratado na rota %s", request.url.path, exc_info=exc)
    detail = str(exc) if settings.DEBUG else "Erro interno do servidor ao processar a solicitação."
    return JSONResponse(status_code=500, content={"detail": detail})


app.include_router(api_router)

# Alias mantido para integrações legadas.
v1_router = APIRouter(prefix="/v1")
for router in (
    auth_router,
    perfis_regras_router,
    empresas_router,
    regras_aliquotas_router,
    regras_cfop_router,
    templates_router,
    solicitacoes_router,
    usuarios_router,
):
    v1_router.include_router(router)
app.include_router(v1_router)


@app.get("/api/health")
@app.get("/api")
def health(db: Session = Depends(get_db)):
    required_tables = {
        "profiles",
        "perfis_regras",
        "empresas",
        "regras_aliquotas_destino",
        "regras_cfop_destino",
        "templates_xlsx",
        "solicitacoes",
        "solicitacoes_saidas",
        "notas_fiscais_processadas",
    }
    if not settings.AUTO_CREATE_SCHEMA:
        required_tables.add("alembic_version")
    try:
        db.execute(text("SELECT 1"))
        missing = required_tables - set(inspect(db.get_bind()).get_table_names())
    except SQLAlchemyError:
        logger.exception("Health check não conseguiu consultar o banco")
        raise HTTPException(status_code=503, detail="Banco de dados indisponível.")
    if missing:
        logger.error("Esquema incompleto; tabelas ausentes: %s", sorted(missing))
        raise HTTPException(status_code=503, detail="Banco de dados não está migrado.")
    return {"status": "online", "app": settings.APP_NAME, "docs": "/docs"}


dist_dir = Path(__file__).resolve().parent.parent / "frontend" / "dist"
if dist_dir.exists():
    assets_dir = dist_dir / "assets"
    if assets_dir.exists():
        app.mount("/assets", StaticFiles(directory=str(assets_dir)), name="assets")

    @app.get("/")
    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str = ""):
        if full_path and (
            full_path.startswith(("api/", "v1/"))
            or full_path in {"docs", "redoc", "openapi.json"}
        ):
            raise HTTPException(status_code=404, detail="Not Found")

        requested_file = (dist_dir / full_path).resolve()
        if full_path and requested_file.is_relative_to(dist_dir) and requested_file.is_file():
            return FileResponse(str(requested_file))

        index_file = dist_dir / "index.html"
        if index_file.exists():
            return FileResponse(str(index_file))
        return {"status": "online", "app": settings.APP_NAME}
