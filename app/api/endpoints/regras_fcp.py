from decimal import Decimal
from typing import Iterable, List, Optional, Tuple

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session, selectinload

from app.api.persistence import commit_and_refresh, delete_and_commit, get_by_id_or_404, save_changes
from app.core.database import get_db
from app.core.security import get_current_user
from app.models.perfil_regras import PerfilRegras
from app.models.regra_aliquota import RegraAliquotaDestino
from app.models.regra_fcp_produto import ExcecaoFcpProduto, RegraFcpProduto
from app.schemas.regra_fcp_produto import (
    ExcecaoFcpCreate,
    ExcecaoFcpOut,
    PresetBebidasBaResultado,
    RegraFcpCreate,
    RegraFcpOut,
    RegraFcpUpdate,
)
from app.schemas.validators import normalizar_termos

router = APIRouter(
    prefix="/regras-fcp",
    tags=["Regras de FCP (NCM + Descrição)"],
    dependencies=[Depends(get_current_user)],
)

PRESET_BEBIDAS_BA_FCP = (
    {
        "ncm": "2203",
        "termos_inclusao": [],
        "termos_exclusao": [],
        "descricao": "FCP 2% — Cervejas de malte (Lei BA 7.014/96, art. 16-A)",
    },
    {
        "ncm": "2204",
        "termos_inclusao": [],
        "termos_exclusao": [],
        "descricao": "FCP 2% — Vinhos de uvas frescas (Lei BA 7.014/96, art. 16-A)",
    },
    {
        "ncm": "2205",
        "termos_inclusao": [],
        "termos_exclusao": [],
        "descricao": "FCP 2% — Vermutes e vinhos aromatizados (Lei BA 7.014/96, art. 16-A)",
    },
    {
        "ncm": "2206",
        "termos_inclusao": [],
        "termos_exclusao": [],
        "descricao": "FCP 2% — Outras bebidas fermentadas (Lei BA 7.014/96, art. 16-A)",
    },
    {
        "ncm": "2208",
        "termos_inclusao": [],
        "termos_exclusao": [],
        "descricao": "FCP 2% — Aguardentes, destilados e licores (Lei BA 7.014/96, art. 16-A)",
    },
    {
        "ncm": "22029100",
        "termos_inclusao": [],
        "termos_exclusao": [],
        "descricao": "FCP 2% — Cervejas e chopes sem álcool (Lei BA 7.014/96, art. 16-A)",
    },
    {
        "ncm": "22021000",
        "termos_inclusao": [
            "refrigerant*", "refri", "cola", "guarana", "soda", "tonica", "isoton*",
            "energetic*", "energy", "gatorade", "powerade", "red bull", "monster",
            "tnt", "fanta", "sprite", "pepsi", "coca", "schweppes",
        ],
        "termos_exclusao": ["agua mineral"],
        "descricao": "FCP 2% — Refrigerantes, isotônicos e energéticos (NCM 2202.10.00)",
    },
    {
        "ncm": "22029900",
        "termos_inclusao": [
            "refrigerant*", "isoton*", "hidroeletrolit*", "energetic*", "energy",
            "gatorade", "powerade", "red bull", "monster", "tnt",
            "chopp sem alcool", "chope sem alcool",
        ],
        "termos_exclusao": ["agua mineral", "suco natural", "polpa", "agua de coco"],
        "descricao": "FCP 2% — Demais refrigerantes, isotônicos, energéticos e chopes sem álcool (NCM 2202.99.00)",
    },
)

PRESET_BEBIDAS_BA_ALIQUOTAS = (
    {"ncm": "2203", "descricao": "Bebidas alcoólicas — Cervejas de malte (ICMS base BA 25%)"},
    {"ncm": "2204", "descricao": "Bebidas alcoólicas — Vinhos (ICMS base BA 25%)"},
    {"ncm": "2205", "descricao": "Bebidas alcoólicas — Vermutes (ICMS base BA 25%)"},
    {"ncm": "2206", "descricao": "Bebidas alcoólicas — Outras bebidas fermentadas (ICMS base BA 25%)"},
    {"ncm": "2208", "descricao": "Bebidas alcoólicas — Destilados, aguardentes e licores (ICMS base BA 25%)"},
)


def _chave_fcp(uf: str, ncm: str, termos_inclusao: Optional[Iterable[str]]) -> Tuple[str, str, Tuple[str, ...]]:
    return (uf.strip().upper(), ncm, tuple(sorted(normalizar_termos(list(termos_inclusao or [])))))


def _garantir_sem_conflito(
    db: Session,
    perfil_id: int,
    uf: str,
    ncm: str,
    termos_inclusao: Optional[List[str]],
    ignorar_id: Optional[int] = None,
) -> None:
    """Impede duplicata literal (mesmo perfil, UF, NCM e conjunto de termos_inclusao)."""
    query = db.query(RegraFcpProduto).filter(
        RegraFcpProduto.perfil_regras_id == perfil_id,
        RegraFcpProduto.uf == uf,
        RegraFcpProduto.ncm == ncm,
    )
    if ignorar_id is not None:
        query = query.filter(RegraFcpProduto.id != ignorar_id)
    alvo = _chave_fcp(uf, ncm, termos_inclusao)
    if any(_chave_fcp(r.uf, r.ncm, r.termos_inclusao) == alvo for r in query.all()):
        raise HTTPException(
            status_code=409,
            detail=f"Já existe uma regra FCP para UF '{uf}' e NCM '{ncm}' com estes mesmos termos de inclusão.",
        )


@router.post("/preset-bebidas-ba", response_model=PresetBebidasBaResultado)
def aplicar_preset_bebidas_ba(perfil_regras_id: int, db: Session = Depends(get_db)):
    get_by_id_or_404(db, PerfilRegras, perfil_regras_id, "Perfil de regras não encontrado.")

    existentes_fcp = {
        _chave_fcp(r.uf, r.ncm, r.termos_inclusao)
        for r in db.query(RegraFcpProduto).filter(
            RegraFcpProduto.perfil_regras_id == perfil_regras_id,
            RegraFcpProduto.uf == "BA",
        ).all()
    }
    fcp_criadas = fcp_ignoradas = 0
    for item in PRESET_BEBIDAS_BA_FCP:
        chave = _chave_fcp("BA", item["ncm"], item["termos_inclusao"])
        if chave in existentes_fcp:
            fcp_ignoradas += 1
            continue
        db.add(
            RegraFcpProduto(
                perfil_regras_id=perfil_regras_id,
                uf="BA",
                ncm=item["ncm"],
                termos_inclusao=normalizar_termos(item["termos_inclusao"]),
                termos_exclusao=normalizar_termos(item["termos_exclusao"]),
                aliquota=Decimal("0.0200"),
                aplicar_com_termo_acordo=True,
                descricao=item["descricao"],
            )
        )
        existentes_fcp.add(chave)
        fcp_criadas += 1

    existentes_aliquotas = {
        r.ncm or ""
        for r in db.query(RegraAliquotaDestino).filter(
            RegraAliquotaDestino.perfil_regras_id == perfil_regras_id,
            RegraAliquotaDestino.uf == "BA",
        ).all()
    }
    aliquotas_criadas = aliquotas_ignoradas = 0
    for item in PRESET_BEBIDAS_BA_ALIQUOTAS:
        if item["ncm"] in existentes_aliquotas:
            aliquotas_ignoradas += 1
            continue
        db.add(
            RegraAliquotaDestino(
                perfil_regras_id=perfil_regras_id,
                uf="BA",
                ncm=item["ncm"],
                aliquota=Decimal("0.2500"),
                descricao=item["descricao"],
                parametros_extras={},
            )
        )
        existentes_aliquotas.add(item["ncm"])
        aliquotas_criadas += 1

    if fcp_criadas or aliquotas_criadas:
        save_changes(db)

    return PresetBebidasBaResultado(
        fcp_criadas=fcp_criadas,
        fcp_ignoradas=fcp_ignoradas,
        aliquotas_criadas=aliquotas_criadas,
        aliquotas_ignoradas=aliquotas_ignoradas,
    )


@router.post("", response_model=RegraFcpOut, status_code=status.HTTP_201_CREATED)
def criar_regra_fcp(payload: RegraFcpCreate, db: Session = Depends(get_db)):
    get_by_id_or_404(db, PerfilRegras, payload.perfil_regras_id, "Perfil de regras não encontrado.")
    _garantir_sem_conflito(db, payload.perfil_regras_id, payload.uf, payload.ncm, payload.termos_inclusao)

    regra = RegraFcpProduto(
        perfil_regras_id=payload.perfil_regras_id,
        uf=payload.uf,
        ncm=payload.ncm,
        termos_inclusao=payload.termos_inclusao,
        termos_exclusao=payload.termos_exclusao,
        aliquota=payload.aliquota,
        aplicar_com_termo_acordo=payload.aplicar_com_termo_acordo,
        descricao=payload.descricao,
    )
    db.add(regra)
    return commit_and_refresh(db, regra)


@router.get("", response_model=List[RegraFcpOut])
def listar_regras_fcp(
    perfil_id: Optional[int] = None,
    uf: Optional[str] = None,
    ncm: Optional[str] = None,
    db: Session = Depends(get_db),
):
    query = db.query(RegraFcpProduto).options(selectinload(RegraFcpProduto.excecoes))
    if perfil_id is not None:
        query = query.filter(RegraFcpProduto.perfil_regras_id == perfil_id)
    if uf:
        query = query.filter(RegraFcpProduto.uf == uf.strip().upper())
    if ncm:
        query = query.filter(RegraFcpProduto.ncm == ncm.strip())
    return query.order_by(RegraFcpProduto.uf, RegraFcpProduto.ncm, RegraFcpProduto.id).all()


@router.get("/{id}", response_model=RegraFcpOut)
def obter_regra_fcp(id: int, db: Session = Depends(get_db)):
    return get_by_id_or_404(db, RegraFcpProduto, id, "Regra de FCP não encontrada.")


@router.put("/{id}", response_model=RegraFcpOut)
def atualizar_regra_fcp(id: int, payload: RegraFcpUpdate, db: Session = Depends(get_db)):
    regra = get_by_id_or_404(db, RegraFcpProduto, id, "Regra de FCP não encontrada.")

    uf_efetiva = payload.uf if payload.uf is not None else regra.uf
    ncm_efetivo = payload.ncm if payload.ncm is not None else regra.ncm
    termos_efetivos = payload.termos_inclusao if payload.termos_inclusao is not None else regra.termos_inclusao
    _garantir_sem_conflito(db, regra.perfil_regras_id, uf_efetiva, ncm_efetivo, termos_efetivos, ignorar_id=id)

    if payload.uf is not None:
        regra.uf = payload.uf
    if payload.ncm is not None:
        regra.ncm = payload.ncm
    if payload.termos_inclusao is not None:
        regra.termos_inclusao = payload.termos_inclusao
    if payload.termos_exclusao is not None:
        regra.termos_exclusao = payload.termos_exclusao
    if payload.aliquota is not None:
        regra.aliquota = payload.aliquota
    if payload.aplicar_com_termo_acordo is not None:
        regra.aplicar_com_termo_acordo = payload.aplicar_com_termo_acordo
    if "descricao" in payload.__fields_set__:
        regra.descricao = payload.descricao

    return commit_and_refresh(db, regra)


@router.delete("/{id}", status_code=status.HTTP_204_NO_CONTENT)
def deletar_regra_fcp(id: int, db: Session = Depends(get_db)):
    regra = get_by_id_or_404(db, RegraFcpProduto, id, "Regra de FCP não encontrada.")
    delete_and_commit(db, regra)


@router.post("/{id}/excecoes", response_model=ExcecaoFcpOut, status_code=status.HTTP_201_CREATED)
def criar_excecao_fcp(id: int, payload: ExcecaoFcpCreate, db: Session = Depends(get_db)):
    regra = get_by_id_or_404(db, RegraFcpProduto, id, "Regra de FCP não encontrada.")
    excecao = ExcecaoFcpProduto(
        regra_fcp_id=regra.id,
        descricao_exata=payload.descricao_exata,
        enquadrado=payload.enquadrado,
        observacao=payload.observacao,
    )
    db.add(excecao)
    return commit_and_refresh(
        db, excecao, conflict_detail="Já existe uma exceção com esta descrição nesta regra."
    )


@router.delete("/{id}/excecoes/{excecao_id}", status_code=status.HTTP_204_NO_CONTENT)
def deletar_excecao_fcp(id: int, excecao_id: int, db: Session = Depends(get_db)):
    excecao = get_by_id_or_404(db, ExcecaoFcpProduto, excecao_id, "Exceção não encontrada.")
    if excecao.regra_fcp_id != id:
        raise HTTPException(status_code=404, detail="Exceção não pertence a esta regra.")
    delete_and_commit(db, excecao)
