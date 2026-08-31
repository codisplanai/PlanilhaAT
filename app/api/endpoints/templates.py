import json
from typing import List, Optional, Dict, Any
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import get_current_user, require_admin
from app.models.profile import Profile
from app.models.template_xlsx import TemplateXlsx
from app.schemas.template_xlsx import TemplateXlsxOut, TemplateMapping
from app.services.templates_admin.template_manager import TemplateManager
from app.api.persistence import get_by_id_or_404

router = APIRouter(prefix="/templates", tags=["Administração de Templates Excel"])

@router.post("/upload", response_model=TemplateXlsxOut, status_code=status.HTTP_201_CREATED)
async def upload_template(
    tipo: str = Form(..., description="antecipacao_parcial, antecipacao_tributaria ou difal"),
    mapeamento_json: str = Form(..., description="String JSON contendo {start_row, columns: {v_total: 'A', ...}}"),
    observacoes: Optional[str] = Form(None),
    promover_ativo: bool = Form(False),
    file: UploadFile = File(..., description="Arquivo .xlsx modelo"),
    admin_user: Profile = Depends(require_admin),
    db: Session = Depends(get_db)
):
    if not file.filename.endswith(".xlsx"):
        raise HTTPException(status_code=400, detail="O arquivo deve ser uma planilha Excel com extensão .xlsx")

    try:
        mapeamento = json.loads(mapeamento_json)
    except Exception:
        raise HTTPException(status_code=422, detail="O campo 'mapeamento_json' deve ser um JSON válido.")

    file_bytes = await file.read()
    if len(file_bytes) == 0:
        raise HTTPException(status_code=400, detail="O arquivo enviado está vazio.")

    try:
        novo_template = TemplateManager.upload_new_template_version(
            db=db,
            tipo=tipo,
            file_bytes=file_bytes,
            filename=file.filename,
            mapeamento=mapeamento,
            observacoes=observacoes,
            promover_ativo=promover_ativo
        )
        return novo_template
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.get("/ativos-resumo")
def listar_templates_ativos_resumo(
    db: Session = Depends(get_db),
    current_user: Profile = Depends(get_current_user)
) -> List[Dict[str, Any]]:
    """Retorna resumo dos templates ativos para exibição em banners aos operadores."""
    ativos = db.query(TemplateXlsx).filter(TemplateXlsx.ativo == True).order_by(TemplateXlsx.tipo).all()
    return [
        {
            "id": t.id,
            "tipo": t.tipo,
            "versao": t.versao,
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
    return query.order_by(TemplateXlsx.tipo, TemplateXlsx.versao.desc()).all()

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
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
