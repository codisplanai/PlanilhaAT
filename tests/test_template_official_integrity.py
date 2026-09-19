import hashlib
import io

import openpyxl
import pytest

from app.core.config import settings
from app.core.exceptions import ValidationException
from app.models.template_xlsx import TemplateXlsx
from app.services.supabase_storage import SupabaseStorageService
from app.services.templates_admin.template_manager import TemplateManager


def _template(
    tipo: str,
    versao: int,
    arquivo_path: str,
    payload: bytes,
    ativo: bool = False,
    persistir_blob: bool = False,
) -> TemplateXlsx:
    return TemplateXlsx(
        tipo=tipo,
        versao=versao,
        arquivo_path=arquivo_path,
        arquivo_hash=hashlib.sha256(payload).hexdigest(),
        arquivo_blob=payload if persistir_blob else None,
        mapeamento_campos={"start_row": 4, "columns": {"numero_nota": "A"}},
        ativo=ativo,
    )


def _xlsx_bytes() -> bytes:
    buffer = io.BytesIO()
    workbook = openpyxl.Workbook()
    sheet = workbook.active
    sheet.title = "SETEMBRO"
    sheet["A1"] = "MODELO OFICIAL"
    workbook.save(buffer)
    workbook.close()
    return buffer.getvalue()


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

    monkeypatch.setattr(SupabaseStorageService, "download_file", lambda bucket, path: None)

    with pytest.raises(ValidationException, match="não está disponível"):
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


def test_upload_difal_persiste_bytes_no_banco_e_recupera_sem_storage(db_session, tmp_path, monkeypatch):
    payload = _xlsx_bytes()
    runtime_dir = tmp_path / "runtime"
    runtime_dir.mkdir()

    monkeypatch.setattr(settings, "TEMPLATES_DIR", str(runtime_dir))
    monkeypatch.setattr(SupabaseStorageService, "is_configured", lambda: False)
    monkeypatch.setattr(SupabaseStorageService, "download_file", lambda bucket, path: None)

    template = TemplateManager.upload_new_template_version(
        db=db_session,
        tipo="difal",
        file_bytes=payload,
        filename="difal-oficial.xlsx",
        mapeamento={"start_row": 4, "columns": {"numero_nota": "A"}},
        promover_ativo=True,
    )

    assert bytes(template.arquivo_blob) == payload

    local_path = runtime_dir / template.arquivo_path.replace("\\", "/").split("/")[-1]
    if local_path.exists():
        local_path.unlink()

    resolved = TemplateManager.resolve_template_path(template)
    assert open(resolved, "rb").read() == payload
    assert hashlib.sha256(open(resolved, "rb").read()).hexdigest() == template.arquivo_hash


def test_promocao_difal_aceita_blob_persistido_sem_service_role(db_session, tmp_path, monkeypatch):
    payload = _xlsx_bytes()
    runtime_dir = tmp_path / "runtime"
    runtime_dir.mkdir()

    monkeypatch.setattr(settings, "TEMPLATES_DIR", str(runtime_dir))
    monkeypatch.setattr(SupabaseStorageService, "download_file", lambda bucket, path: None)

    template = _template(
        "difal",
        6,
        str(runtime_dir / "template_difal_v6_blob.xlsx"),
        payload,
        ativo=False,
        persistir_blob=True,
    )
    db_session.add(template)
    db_session.commit()
    db_session.refresh(template)

    promoted = TemplateManager.promote_version(db_session, template.id)
    assert promoted.ativo is True
