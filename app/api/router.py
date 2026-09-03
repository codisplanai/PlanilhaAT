from fastapi import APIRouter

from app.api.endpoints.auth import router as auth_router
from app.api.endpoints.empresas import router as empresas_router
from app.api.endpoints.perfis_regras import router as perfis_regras_router
from app.api.endpoints.regras_aliquotas import router as regras_aliquotas_router
from app.api.endpoints.regras_reducao_produto import router as regras_reducao_produto_router
from app.api.endpoints.regras_cfop import router as regras_cfop_router
from app.api.endpoints.templates import router as templates_router
from app.api.endpoints.solicitacoes import router as solicitacoes_router
from app.api.endpoints.usuarios import router as usuarios_router

ROUTERS = (
    auth_router,
    perfis_regras_router,
    empresas_router,
    regras_aliquotas_router,
    regras_reducao_produto_router,
    regras_cfop_router,
    templates_router,
    solicitacoes_router,
    usuarios_router,
)


def include_registered_routers(parent: APIRouter) -> None:
    """Registra todas as rotas públicas em um prefixo de API."""
    for router in ROUTERS:
        parent.include_router(router)


api_router = APIRouter(prefix="/api/v1")
include_registered_routers(api_router)
