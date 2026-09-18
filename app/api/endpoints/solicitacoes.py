from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api.persistence import commit_and_refresh, get_by_id_or_404
from app.constants import ROLE_ADMIN, STATUS_PENDENTE
from app.core.database import get_db
from app.core.security import get_current_user
from app.models.empresa import Empresa
from app.models.nota_fiscal import NotaFiscalProcessada
from app.models.profile import Profile
from app.models.solicitacao import Solicitacao
from app.models.template_xlsx import TemplateXlsx
from app.schemas.nota_fiscal import NotaFiscalDataEntradaUpdate, NotaFiscalProcessadaOut
from app.schemas.solicitacao import SolicitacaoCreate, SolicitacaoListOut, SolicitacaoOut
from app.services.templates_admin.template_manager import TemplateManager

router = APIRouter(prefix="/solicitacoes", tags=["Solicitações de Processamento"])


def _authorize_solicitacao(solicitacao: Solicitacao, current_user: Profile) -> None:
    if current_user.role != ROLE_ADMIN and str(solicitacao.usuario_id or "") != str(current_user.id):
        raise HTTPException(status_code=403, detail="Você não tem permissão para acessar esta solicitação.")


@router.post("", response_model=SolicitacaoOut, status_code=status.HTTP_201_CREATED)
def criar_solicitacao(
    payload: SolicitacaoCreate,
    db: Session = Depends(get_db),
    current_user: Profile = Depends(get_current_user),
):
    """Cria apenas o registro estruturado da solicitação.

    Arquivos fiscais nunca são recebidos por esta API. XML, ZIP, SPED e planilhas
    auxiliares são processados exclusivamente no navegador.
    """
    empresa = db.query(Empresa).filter(Empresa.id == payload.empresa_id).first()
    if not empresa:
        raise HTTPException(status_code=404, detail="Empresa não encontrada.")
    if not empresa.ativo:
        raise HTTPException(status_code=409, detail="A empresa está inativa e não pode receber novas solicitações.")

    template_id = payload.template_id
    if template_id and not payload.tipo_planilha:
        raise HTTPException(status_code=422, detail="template_id só pode ser usado junto com tipo_planilha.")
    if payload.tipo_planilha and not template_id:
        template = TemplateManager.get_active_template(db, payload.tipo_planilha)
        template_id = template.id
    elif payload.tipo_planilha and template_id:
        template = db.query(TemplateXlsx).filter(TemplateXlsx.id == template_id).first()
        if not template:
            raise HTTPException(status_code=404, detail="Template informado não encontrado.")
        if template.tipo != payload.tipo_planilha:
            raise HTTPException(status_code=422, detail="O template não pertence ao tipo de planilha informado.")

    solicitacao = Solicitacao(
        empresa_id=payload.empresa_id,
        usuario_id=current_user.id,
        periodo_inicio=payload.periodo_inicio,
        periodo_fim=payload.periodo_fim,
        tipo_planilha=payload.tipo_planilha or "multi",
        template_id=template_id,
        status=STATUS_PENDENTE,
    )
    db.add(solicitacao)
    return commit_and_refresh(db, solicitacao)


@router.patch("/{id}/notas/{nota_id}/data-entrada", response_model=NotaFiscalProcessadaOut)
def atualizar_data_entrada_nota(
    id: str,
    nota_id: str,
    payload: NotaFiscalDataEntradaUpdate,
    db: Session = Depends(get_db),
    current_user: Profile = Depends(get_current_user),
):
    """Atualiza somente o histórico estruturado.

    A planilha local não é regenerada no servidor. Se a data mudar, o navegador
    deve invalidar qualquer artefato local já gerado para evitar download obsoleto.
    """
    solicitacao = get_by_id_or_404(db, Solicitacao, id, "Solicitação não encontrada.")
    _authorize_solicitacao(solicitacao, current_user)
    nota = (
        db.query(NotaFiscalProcessada)
        .filter(NotaFiscalProcessada.id == nota_id, NotaFiscalProcessada.solicitacao_id == id)
        .first()
    )
    if not nota:
        raise HTTPException(status_code=404, detail="Nota fiscal não encontrada nesta solicitação.")

    nota.data_entrada = payload.data_entrada
    nota.origem_data_entrada = "manual"
    db.commit()
    db.refresh(nota)
    return nota


@router.get("", response_model=List[SolicitacaoListOut])
def listar_solicitacoes(
    empresa_id: Optional[int] = None,
    status_filter: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: Profile = Depends(get_current_user),
):
    query = db.query(Solicitacao)

    if current_user.role != ROLE_ADMIN:
        query = query.filter(Solicitacao.usuario_id == current_user.id)

    if empresa_id:
        query = query.filter(Solicitacao.empresa_id == empresa_id)
    if status_filter:
        query = query.filter(Solicitacao.status == status_filter)
    return query.order_by(Solicitacao.criado_em.desc()).all()


@router.get("/{id}", response_model=SolicitacaoOut)
def obter_solicitacao(
    id: str,
    db: Session = Depends(get_db),
    current_user: Profile = Depends(get_current_user),
):
    solicitacao = get_by_id_or_404(db, Solicitacao, id, "Solicitação não encontrada.")
    _authorize_solicitacao(solicitacao, current_user)
    return solicitacao


@router.delete("/{id}", status_code=status.HTTP_204_NO_CONTENT)
def excluir_solicitacao(
    id: str,
    db: Session = Depends(get_db),
    current_user: Profile = Depends(get_current_user),
):
    """Exclui apenas histórico estruturado.

    Artefatos XLSX/ZIP ficam no IndexedDB do navegador e são removidos pelo
    cliente. Arquivos fiscais originais nunca são persistidos pelo servidor.
    """
    solicitacao = get_by_id_or_404(db, Solicitacao, id, "Solicitação não encontrada.")
    _authorize_solicitacao(solicitacao, current_user)
    db.delete(solicitacao)
    db.commit()
    return None
