import hashlib
import os

import pytest

from app.core.config import settings
from app.core.exceptions import ValidationException
from app.models.template_xlsx import TemplateXlsx
from app.services.supabase_storage import SupabaseStorageService
from app.services.templates_admin.template_manager import TemplateManager


def _template(tipo: str, versao: int, arquivo_path: str, payload: bytes, ativo: bool = False) -> TemplateXlsx:
    return TemplateXlsx(
        tipo=tipo,
        versao=versao,
        arquivo_path=arquivo_path,
        arquivo_hash=hashlib.sha256(payload).hexdigest(),
        mapeamento_campos={"start_row": 4, "columns": {"numero_nota": "A"}},
        ativo=ativo,
    )


def test_difal_nao_cai_em_modelo_antigo_quando_versao_oficial_sumiu(tmp_path, monkeypatch):
    uploaded = b"arquivo-oficial-novo"
    old_bundled = b"modelo-antigo-empacotado"

    bundled_dir = tmp_path / "bundled"
    runtime_dir = tmp_path / "runtime"
    bundled_dir.mkdir()
    runtime_dir.mkdir()
    (bundled_dir / "modelo_padrao_difal.xlsx").write_bytes(old_bundled)

    monkeypatch.setattr(settings, "BUNDLED_TEMPLATES_DIR", str(bundled_dir))
    monkeypatch.setattr(settings, "TEMPLATES_DIR", str(runtime_dir))
    monkeypatch.setattr(SupabaseStorageService, "download_file", lambda bucket, path: None)

    template = _template(
        "difal",
        2,
        str(runtime_dir / "template_difal_v2_12345678.xlsx"),
        uploaded,
        ativo=True,
    )

    with pytest.raises(ValidationException, match="não utilizará outra versão"):
        TemplateManager.resolve_template_path(template)


def test_tributaria_rejeita_arquivo_persistido_com_hash_divergente(tmp_path, monkeypatch):
    expected = b"tributaria-oficial"
    wrong = b"tributaria-de-outra-versao"
    runtime_dir = tmp_path / "runtime"
    runtime_dir.mkdir()

    monkeypatch.setattr(settings, "TEMPLATES_DIR", str(runtime_dir))
    monkeypatch.setattr(SupabaseStorageService, "download_file", lambda bucket, path: wrong)

    template = _template(
        "antecipacao_tributaria",
        4,
        str(runtime_dir / "template_antecipacao_tributaria_v4_12345678.xlsx"),
        expected,
        ativo=True,
    )

    with pytest.raises(ValidationException, match="não corresponde ao hash"):
        TemplateManager.resolve_template_path(template)


def test_promocao_difal_em_vercel_exige_original_persistido(db_session, tmp_path, monkeypatch):
    payload = b"nova-versao-difal"
    template = _template(
        "difal",
        5,
        str(tmp_path / "template_difal_v5_12345678.xlsx"),
        payload,
        ativo=False,
    )
    db_session.add(template)
    db_session.commit()
    db_session.refresh(template)

    monkeypatch.setenv("VERCEL", "1")
    monkeypatch.setattr(SupabaseStorageService, "download_file", lambda bucket, path: None)

    with pytest.raises(ValidationException, match="não possui o arquivo original"):
        TemplateManager.promote_version(db_session, template.id)

    db_session.refresh(template)
    assert template.ativo is False


def test_parcial_mantem_resolucao_existente_sem_regra_estrita(tmp_path, monkeypatch):
    bundled_dir = tmp_path / "bundled"
    runtime_dir = tmp_path / "runtime"
    bundled_dir.mkdir()
    runtime_dir.mkdir()
    bundled_path = bundled_dir / "modelo_padrao_antecipacao_parcial.xlsx"
    bundled_path.write_bytes(b"parcial-existente")

    monkeypatch.setattr(settings, "BUNDLED_TEMPLATES_DIR", str(bundled_dir))
    monkeypatch.setattr(settings, "TEMPLATES_DIR", str(runtime_dir))
    monkeypatch.setattr(SupabaseStorageService, "download_file", lambda bucket, path: None)

    template = _template(
        "antecipacao_parcial",
        3,
        str(runtime_dir / "arquivo-ausente.xlsx"),
        b"hash-diferente-nao-importa-para-parcial",
        ativo=True,
    )

    resolved = TemplateManager.resolve_template_path(template)
    assert resolved == str(bundled_path)
