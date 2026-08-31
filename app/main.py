from fastapi.middleware.cors import CORSMiddleware
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
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
