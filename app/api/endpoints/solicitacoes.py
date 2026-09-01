import os
import io
import zipfile
import logging
import tempfile
from pathlib import Path
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, status
from fastapi.responses import FileResponse, StreamingResponse
from starlette.concurrency import run_in_threadpool
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import get_current_user
from app.core.exceptions import PlanilhaATException
from app.core.config import settings
from app.models.profile import Profile
from app.models.solicitacao import Solicitacao
from app.models.empresa import Empresa
from app.models.nota_fiscal import NotaFiscalProcessada
from app.models.template_xlsx import TemplateXlsx
from app.schemas.solicitacao import SolicitacaoCreate, SolicitacaoListOut, SolicitacaoOut
from app.schemas.nota_fiscal import NotaFiscalProcessadaOut, NotaFiscalDataEntradaUpdate
from app.services.pipeline_service import ProcessingPipelineService
from app.services.templates_admin.template_manager import TemplateManager
from app.services.supabase_storage import SupabaseStorageService
from app.api.upload_utils import has_upload, read_optional_upload, read_xml_uploads
from app.api.persistence import commit_and_refresh, get_by_id_or_404

router = APIRouter(prefix="/solicitacoes", tags=["Solicitações de Processamento"])
logger = logging.getLogger(__name__)


def _authorize_solicitacao(solicitacao: Solicitacao, current_user: Profile) -> None:
    if current_user.role != "admin" and str(solicitacao.usuario_id or "") != str(current_user.id):
        raise HTTPException(status_code=403, detail="Você não tem permissão para acessar esta solicitação.")


def _mark_processing_error(db: Session, solicitacao_id: str, message: str) -> None:
    db.rollback()
    solicitacao = db.get(Solicitacao, solicitacao_id)
    if solicitacao and solicitacao.status != "concluido":
        solicitacao.status = "erro"
        solicitacao.mensagem_erro = message[:2000]
        db.commit()


def _resolve_output_file(raw_path: str) -> Optional[str]:
    if raw_path and os.path.isfile(raw_path):
        return raw_path
    filename = os.path.basename((raw_path or "").replace("\\", "/"))
    if not filename:
        return None
    content = SupabaseStorageService.download_file(settings.SUPABASE_STORAGE_BUCKET_OUTPUTS, filename)
    if content is None:
        return None
    os.makedirs(settings.OUTPUTS_DIR, exist_ok=True)
    destination = os.path.join(settings.OUTPUTS_DIR, filename)
    descriptor, temporary_path = tempfile.mkstemp(prefix="download_", dir=settings.OUTPUTS_DIR)
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(content)
        os.replace(temporary_path, destination)
    finally:
        if os.path.exists(temporary_path):
            os.remove(temporary_path)
    return destination

@router.post("", response_model=SolicitacaoOut, status_code=status.HTTP_201_CREATED)
def criar_solicitacao(
    payload: SolicitacaoCreate,
    db: Session = Depends(get_db),
    current_user: Profile = Depends(get_current_user)
):
    empresa = db.query(Empresa).filter(Empresa.id == payload.empresa_id).first()
    if not empresa:
        raise HTTPException(status_code=404, detail="Empresa não encontrada.")
    if not empresa.ativo:
        raise HTTPException(status_code=409, detail="A empresa está inativa e não pode receber novas solicitações.")

    # Fluxo legado: tipo_planilha explícito -> resolve o template único daquele tipo.
    # Fluxo padrão: tipo_planilha omitido -> roteamento automático por CFOP, cada
    # planilha aplicável resolve seu próprio template durante o processamento.
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
        status="pendente"
    )
    db.add(solicitacao)
    return commit_and_refresh(db, solicitacao)

@router.post("/{id}/processar", response_model=SolicitacaoOut)
async def processar_solicitacao(
    id: str,
    files: Optional[List[UploadFile]] = File(None, description="Arquivos XML de NF-e a serem processados"),
    sped_file: Optional[UploadFile] = File(None, description="Arquivo opcional do SPED Fiscal EFD ICMS/IPI (.txt)"),
    planilha_entradas: Optional[UploadFile] = File(None, description="Planilha opcional de datas de entrada do sistema contábil (.xls/.xlsx)"),
    db: Session = Depends(get_db),
    current_user: Profile = Depends(get_current_user)
):
    solicitacao = get_by_id_or_404(db, Solicitacao, id, "Solicitação não encontrada.")
    _authorize_solicitacao(solicitacao, current_user)

    # Validar se ao menos uma fonte foi fornecida
    tem_xmls = any(has_upload(file) for file in files or [])
    tem_sped = has_upload(sped_file)

    if not tem_xmls and not tem_sped:
        raise HTTPException(status_code=400, detail="Envie os arquivos XML de NF-e ou um arquivo SPED Fiscal (.txt) para processamento.")

    service = ProcessingPipelineService(db)
    try:
        xml_files_bytes = await read_xml_uploads(files)
        sped_bytes, sped_filename = await read_optional_upload(sped_file, allowed_suffixes={".txt"})
        planilha_bytes, planilha_filename = await read_optional_upload(
            planilha_entradas,
            allowed_suffixes={".xls", ".xlsx"},
        )
        total_received = sum(len(content) for _, content in xml_files_bytes)
        total_received += len(sped_bytes or b"") + len(planilha_bytes or b"")
        if total_received > settings.MAX_UPLOAD_TOTAL_BYTES:
            raise HTTPException(status_code=413, detail="O conjunto de arquivos excede o tamanho total permitido.")
        solicitacao_atualizada = await run_in_threadpool(
            service.process_solicitacao,
            solicitacao_id=id,
            xml_files_bytes=xml_files_bytes if xml_files_bytes else None,
            sped_file_bytes=sped_bytes,
            sped_filename=sped_filename,
            planilha_entradas_bytes=planilha_bytes,
            planilha_entradas_filename=planilha_filename,
        )
        return solicitacao_atualizada
    except PlanilhaATException as exc:
        # Mantém o contrato histórico do endpoint de processamento: falhas do
        # arquivo/regra são erros de requisição, com mensagem de domínio segura.
        _mark_processing_error(db, id, exc.message)
        raise HTTPException(status_code=400, detail=exc.message)
    except HTTPException as exc:
        _mark_processing_error(db, id, str(exc.detail))
        raise
    except Exception:
        logger.exception("Falha inesperada ao processar solicitação %s", id)
        _mark_processing_error(db, id, "Falha interna ao processar os arquivos.")
        raise HTTPException(status_code=500, detail="Falha inesperada ao processar a solicitação.")

@router.patch("/{id}/notas/{nota_id}/data-entrada", response_model=NotaFiscalProcessadaOut)
def atualizar_data_entrada_nota(
    id: str,
    nota_id: str,
    payload: NotaFiscalDataEntradaUpdate,
    db: Session = Depends(get_db),
    current_user: Profile = Depends(get_current_user)
):
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
    try:
        ProcessingPipelineService(db).regenerate_outputs(solicitacao)
    except PlanilhaATException as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message)
    except Exception:
        logger.exception("Falha ao regenerar saídas da solicitação %s", id)
        raise HTTPException(status_code=500, detail="Não foi possível atualizar as planilhas geradas.")
    db.refresh(nota)
    return nota

@router.get("", response_model=List[SolicitacaoListOut])
def listar_solicitacoes(
    empresa_id: Optional[int] = None,
    status_filter: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: Profile = Depends(get_current_user)
):
    query = db.query(Solicitacao)

    # Filtragem por permissão de usuário (Operador vê apenas o seu histórico; Adm vê tudo)
    if current_user.role != "admin":
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
    current_user: Profile = Depends(get_current_user)
):
    solicitacao = get_by_id_or_404(db, Solicitacao, id, "Solicitação não encontrada.")
    _authorize_solicitacao(solicitacao, current_user)
    return solicitacao

@router.get("/{id}/download")
def download_planilha(
    id: str,
    tipo: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: Profile = Depends(get_current_user)
):
    solicitacao = get_by_id_or_404(db, Solicitacao, id, "Solicitação não encontrada.")
    _authorize_solicitacao(solicitacao, current_user)

    if solicitacao.status != "concluido":
        raise HTTPException(status_code=400, detail="Esta solicitação ainda não foi concluída com sucesso.")

    saidas_com_arquivo = [s for s in solicitacao.saidas if s.arquivo_path]

    # Requisição de um tipo específico (ex: ?tipo=antecipacao_tributaria)
    if tipo:
        saida = next((s for s in saidas_com_arquivo if s.tipo == tipo.strip().lower()), None)
        if not saida:
            raise HTTPException(status_code=404, detail=f"Nenhuma planilha do tipo '{tipo}' foi gerada para esta solicitação.")
        resolved_path = _resolve_output_file(saida.arquivo_path)
        if not resolved_path:
            raise HTTPException(status_code=404, detail="Arquivo de planilha gerado não foi encontrado no servidor.")
        return FileResponse(
            path=resolved_path,
            filename=os.path.basename(resolved_path),
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        )

    # Sem tipo especificado: fluxo legado com 1 único arquivo de saída
    if not saidas_com_arquivo:
        resolved_path = _resolve_output_file(solicitacao.arquivo_saida_path or "")
        if not resolved_path:
            raise HTTPException(status_code=404, detail="Nenhum arquivo de planilha foi encontrado para esta solicitação.")
        return FileResponse(
            path=resolved_path,
            filename=os.path.basename(resolved_path),
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        )

    # Exatamente 1 planilha gerada: devolve o arquivo direto
    if len(saidas_com_arquivo) == 1:
        saida = saidas_com_arquivo[0]
        resolved_path = _resolve_output_file(saida.arquivo_path)
        if not resolved_path:
            raise HTTPException(status_code=404, detail="Arquivo de planilha gerado não foi encontrado no servidor.")
        return FileResponse(
            path=resolved_path,
            filename=os.path.basename(resolved_path),
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        )

    # Múltiplas planilhas geradas: empacota tudo em um .zip
    buffer = io.BytesIO()
    archived_files = 0
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        for saida in saidas_com_arquivo:
            resolved_path = _resolve_output_file(saida.arquivo_path)
            if resolved_path:
                zf.write(resolved_path, arcname=os.path.basename(resolved_path))
                archived_files += 1
    if archived_files == 0:
        raise HTTPException(status_code=404, detail="Nenhum arquivo de planilha está disponível.")
    buffer.seek(0)

    competencia = solicitacao.periodo_inicio.strftime("%Y%m")
    zip_filename = f"planilhas_{solicitacao.empresa.cnpj}_{competencia}.zip"
    return StreamingResponse(
        buffer,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{zip_filename}"'}
    )


@router.delete("/{id}", status_code=status.HTTP_204_NO_CONTENT)
def excluir_solicitacao(
    id: str,
    db: Session = Depends(get_db),
    current_user: Profile = Depends(get_current_user)
):
    solicitacao = get_by_id_or_404(db, Solicitacao, id, "Solicitação não encontrada.")
    _authorize_solicitacao(solicitacao, current_user)

    # Limpeza dos arquivos gerados no disco local
    arquivos_para_remover = []
    if solicitacao.arquivo_saida_path:
        arquivos_para_remover.append(solicitacao.arquivo_saida_path)

    for saida in solicitacao.saidas or []:
        if saida.arquivo_path:
            arquivos_para_remover.append(saida.arquivo_path)

    output_root = Path(settings.OUTPUTS_DIR).resolve()
    for arq_path in set(arquivos_para_remover):
        filename = os.path.basename((arq_path or "").replace("\\", "/"))
        if filename:
            SupabaseStorageService.delete_file(settings.SUPABASE_STORAGE_BUCKET_OUTPUTS, filename)
        resolved_path = Path(arq_path).resolve() if arq_path else None
        if resolved_path and resolved_path.is_relative_to(output_root) and resolved_path.is_file():
            try:
                resolved_path.unlink()
            except OSError:
                logger.warning("Não foi possível remover a saída %s", filename, exc_info=True)

    db.delete(solicitacao)
    db.commit()
    return None
