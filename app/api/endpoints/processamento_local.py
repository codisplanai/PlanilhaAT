import json
import logging
from decimal import Decimal
from typing import Any, Dict

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session, joinedload

from app.core.database import get_db
from app.core.security import get_current_user, is_admin_or_senior
from app.models.empresa import Empresa
from app.models.nota_fiscal import NotaFiscalProcessada
from app.models.perfil_regras import PerfilRegras
from app.models.profile import Profile
from app.models.regra_aliquota import RegraAliquotaDestino
from app.models.regra_cfop import RegraCfopDestino
from app.models.regra_exclusao_parcial import RegraExclusaoParcial
from app.models.regra_reclassificacao_cfop import RegraReclassificacaoCfop
from app.models.regra_reducao_produto import RegraReducaoProduto
from app.models.solicitacao import Solicitacao
from app.models.solicitacao_saida import SolicitacaoSaida
from app.models.template_xlsx import TemplateXlsx
from app.schemas.local_processing import LocalProcessingContextOut, LocalProcessingResultIn
from app.schemas.solicitacao import SolicitacaoOut
from app.services.rules_engine.mva_resolver import MvaResolver
from app.services.templates_admin.template_manager import TemplateManager
from app.constants import TIPOS_PLANILHA

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/processamento-local", tags=["Processamento Fiscal Local"])

_FORBIDDEN_RAW_KEYS = {
    "arquivo_bytes",
    "arquivo_conteudo",
    "base64",
    "bytes",
    "content",
    "conteudo",
    "file_content",
    "raw_file",
    "sped",
    "xml",
    "xml_content",
}

_FILE_METADATA_KEYS = {"arquivo", "file"}


def _serialize_decimal(value: Any) -> Any:
    if isinstance(value, Decimal):
        return float(value)
    return value


def _reject_raw_file_payload(value: Any, path: str = "payload") -> None:
    if isinstance(value, dict):
        for key, nested in value.items():
            normalized = str(key).strip().lower()
            if normalized in _FILE_METADATA_KEYS:
                if not isinstance(nested, str) or not nested.strip() or len(nested) > 512:
                    raise HTTPException(
                        status_code=422,
                        detail=f"Metadado de arquivo inválido em {path}.{key}.",
                    )
                if any(marker in nested for marker in ("<NFe", "<nfeProc", "|0000|", "\x00", "\r", "\n")):
                    raise HTTPException(
                        status_code=422,
                        detail=f"Conteúdo bruto de arquivo não permitido em {path}.{key}.",
                    )
                continue
            if normalized in _FORBIDDEN_RAW_KEYS:
                raise HTTPException(
                    status_code=422,
                    detail=f"Conteúdo bruto de arquivo não permitido em {path}.{key}.",
                )
            _reject_raw_file_payload(nested, f"{path}.{key}")
    elif isinstance(value, list):
        for index, nested in enumerate(value):
            _reject_raw_file_payload(nested, f"{path}[{index}]")
    elif isinstance(value, str) and len(value) > 65536:
        raise HTTPException(
            status_code=422,
            detail=f"Texto excessivamente grande em {path}. Conteúdo bruto de arquivo não é aceito.",
        )


def _authorize_request(solicitacao: Solicitacao, current_user: Profile) -> None:
    if not is_admin_or_senior(current_user) and str(solicitacao.usuario_id or "") != str(current_user.id):
        raise HTTPException(status_code=403, detail="Você não tem permissão para acessar esta solicitação.")


def _serialize_empresa(empresa: Empresa) -> Dict[str, Any]:
    termo = empresa.termo_acordo
    return {
        "id": empresa.id,
        "razao_social": empresa.razao_social,
        "cnpj": empresa.cnpj,
        "inscricao_estadual": empresa.inscricao_estadual,
        "uf": empresa.uf,
        "perfil_regras_id": empresa.perfil_regras_id,
        "optante_simples_nacional": bool(empresa.optante_simples_nacional),
        "termo_acordo": (
            {
                "id": termo.id,
                "aliquota": _serialize_decimal(termo.aliquota),
                "descricao": termo.descricao,
            }
            if termo
            else None
        ),
    }


def _serialize_reducao(regra: RegraReducaoProduto) -> Dict[str, Any]:
    return {
        "id": regra.id,
        "perfil_regras_id": regra.perfil_regras_id,
        "ncm": regra.ncm,
        "termos_inclusao": regra.termos_inclusao or [],
        "termos_exclusao": regra.termos_exclusao or [],
        "aliquota": _serialize_decimal(regra.aliquota),
        "descricao": regra.descricao,
        "excecoes": [
            {
                "id": excecao.id,
                "descricao_exata": excecao.descricao_exata,
                "enquadrado": bool(excecao.enquadrado),
                "observacao": excecao.observacao,
            }
            for excecao in regra.excecoes
        ],
    }


def _serialize_reclassificacao(regra: RegraReclassificacaoCfop) -> Dict[str, Any]:
    return {
        "id": regra.id,
        "perfil_regras_id": regra.perfil_regras_id,
        "ncm": regra.ncm,
        "cfop_origem_sufixo": regra.cfop_origem_sufixo,
        "cfop_destino_sufixo": regra.cfop_destino_sufixo,
        "termos_inclusao": regra.termos_inclusao or [],
        "termos_exclusao": regra.termos_exclusao or [],
        "descricao": regra.descricao,
        "excecoes": [
            {
                "id": excecao.id,
                "descricao_exata": excecao.descricao_exata,
                "aplicar": bool(excecao.aplicar),
                "observacao": excecao.observacao,
            }
            for excecao in regra.excecoes
        ],
    }


def _build_context_payload(
    *,
    db: Session,
    empresa: Empresa,
    perfil: PerfilRegras,
    aliquotas: list[RegraAliquotaDestino],
    regras_cfop: list[RegraCfopDestino],
    reducoes: list[RegraReducaoProduto],
    reclassificacoes: list[RegraReclassificacaoCfop],
    exclusoes: list[RegraExclusaoParcial],
    templates: list[TemplateXlsx],
) -> Dict[str, Any]:
    return {
        "empresa": _serialize_empresa(empresa),
        "perfil": {
            "id": perfil.id,
            "nome": perfil.nome,
            "descricao": perfil.descricao,
            "configuracoes_extras": perfil.configuracoes_extras or {},
        },
        "regras_aliquotas": [
            {
                "id": regra.id,
                "perfil_regras_id": regra.perfil_regras_id,
                "uf": regra.uf,
                "ncm": regra.ncm,
                "aliquota": _serialize_decimal(regra.aliquota),
                "descricao": regra.descricao,
                "parametros_extras": regra.parametros_extras or {},
            }
            for regra in aliquotas
        ],
        "regras_cfop": [
            {
                "id": regra.id,
                "perfil_regras_id": regra.perfil_regras_id,
                "cfop_sufixo": regra.cfop_sufixo,
                "destino": regra.destino,
                "descricao": regra.descricao,
            }
            for regra in regras_cfop
        ],
        "regras_reducao": [_serialize_reducao(regra) for regra in reducoes],
        "regras_reclassificacao": [
            _serialize_reclassificacao(regra) for regra in reclassificacoes
        ],
        "regras_exclusao_parcial": [
            {
                "id": regra.id,
                "perfil_regras_id": regra.perfil_regras_id,
                "uf": regra.uf,
                "ncm": regra.ncm,
                "descricao": regra.descricao,
                "termos_obrigatorios": regra.termos_obrigatorios or [],
                "motivo": regra.motivo,
                "ativo": bool(regra.ativo),
            }
            for regra in exclusoes
        ],
        "margens_seguranca_templates": {
            tipo: TemplateManager.get_safety_margin(db, tipo)
            for tipo in TIPOS_PLANILHA
        },
        "templates_ativos": [
            {
                "id": template.id,
                "tipo": template.tipo,
                "versao": template.versao,
                "capacidade_linhas": template.capacidade_linhas,
                "arquivo_hash": template.arquivo_hash,
                "mapeamento_campos": template.mapeamento_campos,
                "observacoes": template.observacoes,
            }
            for template in templates
        ],
        "mva_anexo": MvaResolver._load_anexo_entries(),
    }


@router.get("/contexto", response_model=LocalProcessingContextOut)
def obter_contexto_processamento_local(
    empresa_id: int,
    db: Session = Depends(get_db),
    current_user: Profile = Depends(get_current_user),
):
    empresa = (
        db.query(Empresa)
        .options(joinedload(Empresa.perfil_regras), joinedload(Empresa.regras_aliquotas_empresa))
        .filter(Empresa.id == empresa_id)
        .first()
    )
    if not empresa:
        raise HTTPException(status_code=404, detail="Empresa não encontrada.")
    if not empresa.ativo:
        raise HTTPException(status_code=409, detail="A empresa está inativa.")

    perfil = empresa.perfil_regras
    if perfil is None:
        raise HTTPException(status_code=409, detail="A empresa não possui perfil de regras configurado.")

    aliquotas = (
        db.query(RegraAliquotaDestino)
        .filter(RegraAliquotaDestino.perfil_regras_id == perfil.id)
        .all()
    )
    regras_cfop = (
        db.query(RegraCfopDestino)
        .filter(
            (RegraCfopDestino.perfil_regras_id == perfil.id)
            | (RegraCfopDestino.perfil_regras_id.is_(None))
        )
        .all()
    )
    reducoes = (
        db.query(RegraReducaoProduto)
        .options(joinedload(RegraReducaoProduto.excecoes))
        .filter(RegraReducaoProduto.perfil_regras_id == perfil.id)
        .all()
    )
    reclassificacoes = (
        db.query(RegraReclassificacaoCfop)
        .options(joinedload(RegraReclassificacaoCfop.excecoes))
        .filter(RegraReclassificacaoCfop.perfil_regras_id == perfil.id)
        .all()
    )
    exclusoes = (
        db.query(RegraExclusaoParcial)
        .filter(
            RegraExclusaoParcial.perfil_regras_id == perfil.id,
            RegraExclusaoParcial.ativo.is_(True),
        )
        .all()
    )
    templates = (
        db.query(TemplateXlsx)
        .filter(TemplateXlsx.ativo.is_(True))
        .order_by(
            TemplateXlsx.tipo,
            TemplateXlsx.capacidade_linhas.is_(None),
            TemplateXlsx.capacidade_linhas,
            TemplateXlsx.versao.desc(),
        )
        .all()
    )

    return _build_context_payload(
        db=db,
        empresa=empresa,
        perfil=perfil,
        aliquotas=aliquotas,
        regras_cfop=regras_cfop,
        reducoes=reducoes,
        reclassificacoes=reclassificacoes,
        exclusoes=exclusoes,
        templates=templates,
    )


@router.post("/solicitacoes/{id}/resultado", response_model=SolicitacaoOut)
def registrar_resultado_processamento_local(
    id: str,
    payload: LocalProcessingResultIn,
    db: Session = Depends(get_db),
    current_user: Profile = Depends(get_current_user),
):
    solicitacao = db.get(Solicitacao, id)
    if not solicitacao:
        raise HTTPException(status_code=404, detail="Solicitação não encontrada.")
    _authorize_request(solicitacao, current_user)

    raw = payload.dict()
    if len(json.dumps(raw, ensure_ascii=False, default=str)) > 8 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Resultado estruturado excede o limite permitido.")
    _reject_raw_file_payload(raw)

    db.query(NotaFiscalProcessada).filter(
        NotaFiscalProcessada.solicitacao_id == id
    ).delete(synchronize_session=False)
    db.query(SolicitacaoSaida).filter(
        SolicitacaoSaida.solicitacao_id == id
    ).delete(synchronize_session=False)

    for note in payload.notas_processadas:
        values = note.dict()
        for field in (
            "v_total",
            "base_calculo",
            "ipi_despesas",
            "a_ori",
            "a_dst_resolvida",
            "debito",
            "credito",
            "valor_devido",
        ):
            values[field] = Decimal(str(values[field]))
        db.add(NotaFiscalProcessada(solicitacao_id=id, **values))

    for output in payload.saidas:
        values = output.dict()
        values["total_valor_devido"] = Decimal(str(values["total_valor_devido"]))
        db.add(
            SolicitacaoSaida(
                solicitacao_id=id,
                arquivo_path=None,
                **values,
            )
        )

    solicitacao.status = "concluido"
    solicitacao.mensagem_erro = payload.mensagem
    solicitacao.arquivo_saida_path = None
    solicitacao.total_notas_processadas = len(payload.notas_processadas)
    solicitacao.notas_ignoradas = payload.notas_ignoradas
    solicitacao.itens_excluidos = payload.itens_excluidos
    solicitacao.avisos_avaliacao = payload.avisos_avaliacao
    solicitacao.cfops_sem_regra = payload.cfops_sem_regra

    # O registro é uma única transação: um lote inteiro de notas é gravado de
    # uma vez. Sem tratar a falha, uma violação de restrição virava HTTP 500 com
    # o erro cru do banco no corpo e deixava a solicitação presa em "pendente".
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail=(
                "O resultado enviado conflita com os dados já registrados para esta "
                "solicitação. Gere a planilha novamente."
            ),
        )
    except SQLAlchemyError:
        db.rollback()
        logger.exception("Falha ao registrar o resultado da solicitação %s", id)
        raise HTTPException(
            status_code=500,
            detail="Não foi possível registrar o resultado do processamento.",
        )
    db.refresh(solicitacao)
    return solicitacao
