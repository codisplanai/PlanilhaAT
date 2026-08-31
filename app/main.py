import os
from fastapi.middleware.cors import CORSMiddleware
from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles
import sqlalchemy as sa

import app.models  # noqa: F401 - registra os modelos no metadata do SQLAlchemy
from app.api.router import api_router
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

app.include_router(api_router)

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
        if full_path and (full_path.startswith("api/") or full_path == "docs" or full_path == "openapi.json"):
            raise HTTPException(status_code=404, detail="Not Found")
        
        file_path = os.path.join(dist_dir, full_path)
        if full_path and os.path.isfile(file_path):
            return FileResponse(file_path)
        
        index_file = os.path.join(dist_dir, "index.html")
        if os.path.exists(index_file):
            return FileResponse(index_file)
        
        return {"status": "online", "app": settings.APP_NAME}
