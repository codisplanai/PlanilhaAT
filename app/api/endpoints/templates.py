import json
from typing import List, Optional, Dict, Any
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, status
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import get_current_user, require_admin
from app.models.profile import Profile
from app.models.template_xlsx import TemplateXlsx
from app.schemas.template_xlsx import (
    TemplateMapping,
    TemplateSelectionConfigOut,
    TemplateSelectionConfigUpdate,
    TemplateXlsxOut,
)
from app.services.templates_admin.template_manager import TemplateManager
from app.api.persistence import get_by_id_or_404
from app.core.config import settings
from app.core.exceptions import PlanilhaATException
from app.constants import TIPOS_PLANILHA

router = APIRouter(prefix="/templates", tags=["Administração de Templates Excel"])

@router.post("/upload", response_model=TemplateXlsxOut, status_code=status.HTTP_201_CREATED)
async def upload_template(
    tipo: str = Form(..., description="antecipacao_parcial, antecipacao_tributaria ou difal"),
    mapeamento_json: str = Form(..., description="String JSON contendo {start_row, columns: {v_total: 'A', ...}}"),
    capacidade_linhas: Optional[int] = Form(
        None,
        ge=1,
        description="Capacidade máxima de linhas de dados do modelo. Obrigatório nos novos cadastros feitos pela interface.",
    ),
    observacoes: Optional[str] = Form(None),
    promover_ativo: bool = Form(False),
    file: UploadFile = File(..., description="Arquivo .xlsx modelo"),
    admin_user: Profile = Depends(require_admin),
    db: Session = Depends(get_db)
):
    if not file.filename or not file.filename.lower().endswith(".xlsx"):
        raise HTTPException(status_code=400, detail="O arquivo deve ser uma planilha Excel com extensão .xlsx")

    try:
        mapeamento = json.loads(mapeamento_json)
    except Exception:
        raise HTTPException(status_code=422, detail="O campo 'mapeamento_json' deve ser um JSON válido.")

    file_bytes = await file.read(settings.MAX_UPLOAD_FILE_BYTES + 1)
    if len(file_bytes) == 0:
        raise HTTPException(status_code=400, detail="O arquivo enviado está vazio.")
    if len(file_bytes) > settings.MAX_UPLOAD_FILE_BYTES:
        raise HTTPException(status_code=413, detail="O arquivo excede o tamanho permitido.")

    try:
        novo_template = TemplateManager.upload_new_template_version(
            db=db,
            tipo=tipo,
            file_bytes=file_bytes,
            filename=file.filename,
            mapeamento=mapeamento,
            capacidade_linhas=capacidade_linhas,
            observacoes=observacoes,
            promover_ativo=promover_ativo
        )
        return novo_template
    except PlanilhaATException as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message)

@router.get("/ativos-resumo")
def listar_templates_ativos_resumo(
    db: Session = Depends(get_db),
    current_user: Profile = Depends(get_current_user)
) -> List[Dict[str, Any]]:
    """Retorna resumo dos templates ativos para exibição em banners aos operadores."""
    ativos = (
        db.query(TemplateXlsx)
        .filter(TemplateXlsx.ativo == True)
        .order_by(
            TemplateXlsx.tipo,
            TemplateXlsx.capacidade_linhas.is_(None),
            TemplateXlsx.capacidade_linhas,
            TemplateXlsx.versao.desc(),
        )
        .all()
    )
    return [
        {
            "id": t.id,
            "tipo": t.tipo,
            "versao": t.versao,
            "capacidade_linhas": t.capacidade_linhas,
            "criado_em": t.criado_em.isoformat() if t.criado_em else None,
            "observacoes": t.observacoes
        }
        for t in ativos
    ]

@router.get("", response_model=List[TemplateXlsxOut])
def listar_templates(
    tipo: Optional[str] = None,
    ativo: Optional[bool] = None,
    db: Session = Depends(get_db),
    current_user: Profile = Depends(get_current_user)
):
    query = db.query(TemplateXlsx)
    if tipo:
        query = query.filter(TemplateXlsx.tipo == tipo.strip().lower())
    if ativo is not None:
        query = query.filter(TemplateXlsx.ativo == ativo)
    return query.order_by(
        TemplateXlsx.tipo,
        TemplateXlsx.capacidade_linhas.is_(None),
        TemplateXlsx.capacidade_linhas,
        TemplateXlsx.versao.desc(),
    ).all()

@router.get(
    "/configuracoes-selecao",
    response_model=List[TemplateSelectionConfigOut],
)
def listar_configuracoes_selecao(
    db: Session = Depends(get_db),
    current_user: Profile = Depends(get_current_user),
):
    return [
        {
            "tipo": tipo,
            "margem_seguranca_linhas": TemplateManager.get_safety_margin(db, tipo),
        }
        for tipo in TIPOS_PLANILHA
    ]


@router.put(
    "/configuracoes-selecao/{tipo}",
    response_model=TemplateSelectionConfigOut,
)
def atualizar_configuracao_selecao(
    tipo: str,
    payload: TemplateSelectionConfigUpdate,
    admin_user: Profile = Depends(require_admin),
    db: Session = Depends(get_db),
):
    try:
        margin = TemplateManager.set_safety_margin(
            db,
            tipo,
            payload.margem_seguranca_linhas,
        )
        return {
            "tipo": tipo.strip().lower(),
            "margem_seguranca_linhas": margin,
        }
    except PlanilhaATException as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message)


@router.get("/{id}/arquivo")
def baixar_template_para_processamento_local(
    id: int,
    db: Session = Depends(get_db),
    current_user: Profile = Depends(get_current_user),
):
    template = get_by_id_or_404(db, TemplateXlsx, id, "Template não encontrado.")
    try:
        resolved_path = TemplateManager.resolve_template_path(template)
    except PlanilhaATException as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message)

    return FileResponse(
        path=resolved_path,
        filename=(
            f"template_{template.tipo}_cap{template.capacidade_linhas}_v{template.versao}.xlsx"
            if template.capacidade_linhas
            else f"template_{template.tipo}_v{template.versao}.xlsx"
        ),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={
            "Cache-Control": "private, no-store",
            "ETag": f'"sha256-{template.arquivo_hash}"',
            "X-Template-Id": str(template.id),
            "X-Template-Version": str(template.versao),
            "X-Template-Capacity": str(template.capacidade_linhas or ""),
        },
    )


@router.get("/{id}", response_model=TemplateXlsxOut)
def obter_template(
    id: int,
    db: Session = Depends(get_db),
    current_user: Profile = Depends(get_current_user)
):
    return get_by_id_or_404(db, TemplateXlsx, id, "Template não encontrado.")

@router.post("/{id}/promover", response_model=TemplateXlsxOut)
def promover_template(
    id: int,
    admin_user: Profile = Depends(require_admin),
    db: Session = Depends(get_db)
):
    try:
        return TemplateManager.promote_version(db, id)
    except PlanilhaATException as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message)
