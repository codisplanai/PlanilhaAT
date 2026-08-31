from fastapi import APIRouter

from app.api.endpoints.auth import router as auth_router
from app.api.endpoints.empresas import router as empresas_router
from app.api.endpoints.perfis_regras import router as perfis_regras_router
from app.api.endpoints.regras_aliquotas import router as regras_aliquotas_router
from app.api.endpoints.regras_cfop import router as regras_cfop_router
from app.api.endpoints.templates import router as templates_router
from app.api.endpoints.solicitacoes import router as solicitacoes_router

api_router = APIRouter(prefix="/api/v1")

api_router.include_router(auth_router)
api_router.include_router(perfis_regras_router)
api_router.include_router(empresas_router)
api_router.include_router(regras_aliquotas_router)
api_router.include_router(regras_cfop_router)
api_router.include_router(templates_router)
api_router.include_router(solicitacoes_router)
