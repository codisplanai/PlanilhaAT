"""Visualização sob demanda do DANFE, sem armazenamento no backend."""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field

from app.core.security import get_current_user
from app.models.profile import Profile
from app.services.meu_danfe import DanfeServiceError, get_danfe_pdf

router = APIRouter(prefix="/danfe", tags=["Consulta de DANFE"])


class DanfeRequest(BaseModel):
    chave_acesso: str = Field(..., min_length=44, max_length=44)
    xml: Optional[str] = None
    buscar_por_chave: bool = False


@router.post("/pdf", response_class=Response, responses={200: {"content": {"application/pdf": {}}}})
def visualizar_danfe(
    payload: DanfeRequest,
    _current_user: Profile = Depends(get_current_user),
):
    """Converte XML enviado com consentimento ou consulta chave sob demanda.

    Não persiste documentos, não expõe API Key e não retorna JSON com base64.
    """
    try:
        pdf = get_danfe_pdf(
            chave=payload.chave_acesso,
            xml=payload.xml,
            buscar_por_chave=payload.buscar_por_chave,
        )
    except DanfeServiceError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from None
    return Response(
        pdf,
        media_type="application/pdf",
        headers={
            "Cache-Control": "no-store, private",
            "Content-Disposition": 'inline; filename="danfe.pdf"',
            "X-Content-Type-Options": "nosniff",
        },
    )
