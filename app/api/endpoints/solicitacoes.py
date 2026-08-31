import os
import io
import zipfile
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, status
from fastapi.responses import FileResponse, StreamingResponse
from sqlalchemy.orm import Session
from sqlalchemy import or_

from app.core.database import get_db
from app.core.security import get_optional_user
from app.models.profile import Profile
from app.models.solicitacao import Solicitacao
from app.models.empresa import Empresa
from app.models.nota_fiscal import NotaFiscalProcessada
from app.schemas.solicitacao import SolicitacaoCreate, SolicitacaoOut
from app.schemas.nota_fiscal import NotaFiscalProcessadaOut, NotaFiscalDataEntradaUpdate
from app.services.pipeline_service import ProcessingPipelineService
from app.services.templates_admin.template_manager import TemplateManager
from app.api.upload_utils import has_upload, read_optional_upload, read_xml_uploads
from app.api.persistence import commit_and_refresh, get_by_id_or_404

router = APIRouter(prefix="/solicitacoes", tags=["Solicitações de Processamento"])

@router.post("", response_model=SolicitacaoOut, status_code=status.HTTP_201_CREATED)
def criar_solicitacao(
    payload: SolicitacaoCreate,
    db: Session = Depends(get_db),
    current_user: Optional[Profile] = Depends(get_optional_user)
):
    empresa = db.query(Empresa).filter(Empresa.id == payload.empresa_id).first()
    if not empresa:
        raise HTTPException(status_code=404, detail="Empresa não encontrada.")

    # Fluxo legado: tipo_planilha explícito -> resolve o template único daquele tipo.
    # Fluxo padrão: tipo_planilha omitido -> roteamento automático por CFOP, cada
    # planilha aplicável resolve seu próprio template durante o processamento.
    template_id = payload.template_id
    if payload.tipo_planilha and not template_id:
        template = TemplateManager.get_active_template(db, payload.tipo_planilha)
        template_id = template.id

    solicitacao = Solicitacao(
        empresa_id=payload.empresa_id,
        usuario_id=current_user.id if current_user else None,
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
    current_user: Optional[Profile] = Depends(get_optional_user)
):
    solicitacao = get_by_id_or_404(db, Solicitacao, id, "Solicitação não encontrada.")

    # Se usuário for operador e não for dono da solicitação, bloqueia
    if current_user and current_user.role != "admin" and current_user.cargo.strip().lower() not in ["contador sênior", "contador senior"]:
        if solicitacao.usuario_id and solicitacao.usuario_id != current_user.id:
            raise HTTPException(status_code=403, detail="Você não tem permissão para processar a solicitação de outro usuário.")

    # Validar se ao menos uma fonte foi fornecida
    tem_xmls = any(has_upload(file) for file in files or [])
    tem_sped = has_upload(sped_file)

    if not tem_xmls and not tem_sped:
        raise HTTPException(status_code=400, detail="Envie os arquivos XML de NF-e ou um arquivo SPED Fiscal (.txt) para processamento.")

    xml_files_bytes = await read_xml_uploads(files)
    sped_bytes, sped_filename = await read_optional_upload(sped_file)
    planilha_bytes, planilha_filename = await read_optional_upload(planilha_entradas)

    service = ProcessingPipelineService(db)
    try:
        solicitacao_atualizada = service.process_solicitacao(
            solicitacao_id=id,
            xml_files_bytes=xml_files_bytes if xml_files_bytes else None,
            sped_file_bytes=sped_bytes,
            sped_filename=sped_filename,
            planilha_entradas_bytes=planilha_bytes,
            planilha_entradas_filename=planilha_filename
        )
        return solicitacao_atualizada
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.patch("/{id}/notas/{nota_id}/data-entrada", response_model=NotaFiscalProcessadaOut)
def atualizar_data_entrada_nota(
    id: str,
    nota_id: str,
    payload: NotaFiscalDataEntradaUpdate,
    db: Session = Depends(get_db),
    current_user: Optional[Profile] = Depends(get_optional_user)
):
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

@router.get("", response_model=List[SolicitacaoOut])
def listar_solicitacoes(
    empresa_id: Optional[int] = None,
    status_filter: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: Optional[Profile] = Depends(get_optional_user)
):
    query = db.query(Solicitacao)

    # Filtragem por permissão de usuário (Operador vê apenas o seu histórico; Adm vê tudo)
    if current_user and current_user.role != "admin" and current_user.cargo.strip().lower() not in ["contador sênior", "contador senior"]:
        query = query.filter(
            or_(
                Solicitacao.usuario_id == current_user.id,
                Solicitacao.usuario_id == None
            )
        )

    if empresa_id:
        query = query.filter(Solicitacao.empresa_id == empresa_id)
    if status_filter:
        query = query.filter(Solicitacao.status == status_filter)
    return query.order_by(Solicitacao.criado_em.desc()).all()

@router.get("/{id}", response_model=SolicitacaoOut)
def obter_solicitacao(
    id: str,
    db: Session = Depends(get_db),
    current_user: Optional[Profile] = Depends(get_optional_user)
):
    return get_by_id_or_404(db, Solicitacao, id, "Solicitação não encontrada.")

@router.get("/{id}/download")
def download_planilha(
    id: str,
    tipo: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: Optional[Profile] = Depends(get_optional_user)
):
    solicitacao = get_by_id_or_404(db, Solicitacao, id, "Solicitação não encontrada.")

    if solicitacao.status != "concluido":
        raise HTTPException(status_code=400, detail="Esta solicitação ainda não foi concluída com sucesso.")

    saidas_com_arquivo = [s for s in solicitacao.saidas if s.arquivo_path]

    # Requisição de um tipo específico (ex: ?tipo=antecipacao_tributaria)
    if tipo:
        saida = next((s for s in saidas_com_arquivo if s.tipo == tipo.strip().lower()), None)
        if not saida:
            raise HTTPException(status_code=404, detail=f"Nenhuma planilha do tipo '{tipo}' foi gerada para esta solicitação.")
        if not os.path.exists(saida.arquivo_path):
            raise HTTPException(status_code=404, detail="Arquivo de planilha gerado não foi encontrado no servidor.")
        return FileResponse(
            path=saida.arquivo_path,
            filename=os.path.basename(saida.arquivo_path),
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        )

    # Sem tipo especificado: fluxo legado com 1 único arquivo de saída
    if not saidas_com_arquivo:
        if not solicitacao.arquivo_saida_path or not os.path.exists(solicitacao.arquivo_saida_path):
            raise HTTPException(status_code=404, detail="Nenhum arquivo de planilha foi encontrado para esta solicitação.")
        return FileResponse(
            path=solicitacao.arquivo_saida_path,
            filename=os.path.basename(solicitacao.arquivo_saida_path),
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        )

    # Exatamente 1 planilha gerada: devolve o arquivo direto
    if len(saidas_com_arquivo) == 1:
        saida = saidas_com_arquivo[0]
        if not os.path.exists(saida.arquivo_path):
            raise HTTPException(status_code=404, detail="Arquivo de planilha gerado não foi encontrado no servidor.")
        return FileResponse(
            path=saida.arquivo_path,
            filename=os.path.basename(saida.arquivo_path),
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        )

    # Múltiplas planilhas geradas: empacota tudo em um .zip
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        for saida in saidas_com_arquivo:
            if os.path.exists(saida.arquivo_path):
                zf.write(saida.arquivo_path, arcname=os.path.basename(saida.arquivo_path))
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
    current_user: Optional[Profile] = Depends(get_optional_user)
):
    solicitacao = get_by_id_or_404(db, Solicitacao, id, "Solicitação não encontrada.")

    # Se usuário for operador e não for dono da solicitação, bloqueia
    if current_user and current_user.role != "admin" and current_user.cargo.strip().lower() not in ["contador sênior", "contador senior"]:
        if solicitacao.usuario_id and solicitacao.usuario_id != current_user.id:
            raise HTTPException(status_code=403, detail="Você não tem permissão para excluir a solicitação de outro usuário.")

    # Limpeza dos arquivos gerados no disco local
    arquivos_para_remover = []
    if solicitacao.arquivo_saida_path:
        arquivos_para_remover.append(solicitacao.arquivo_saida_path)

    for saida in solicitacao.saidas or []:
        if saida.arquivo_path:
            arquivos_para_remover.append(saida.arquivo_path)

    for arq_path in set(arquivos_para_remover):
        if arq_path and os.path.exists(arq_path):
            try:
                os.remove(arq_path)
            except Exception:
                pass

    db.delete(solicitacao)
    db.commit()
    return None
