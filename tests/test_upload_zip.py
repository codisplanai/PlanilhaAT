import io
import zipfile
import pytest
from fastapi import HTTPException
from app.api.upload_utils import _read_xml_archive
from app.core.config import settings
from tests.conftest import CHAVE_NF901, CHAVE_NF902, build_xml_nfe


def _create_zip(files_dict: dict) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for name, data in files_dict.items():
            z.writestr(name, data)
    buf.seek(0)
    return buf.read()


def test_processar_com_arquivo_zip(client, cenario_janeiro):
    """Testa o processamento enviando um arquivo .zip contendo múltiplos XMLs."""
    sol = cenario_janeiro()

    xml1 = build_xml_nfe("901", CHAVE_NF901, "1000.00", "10")
    xml2 = build_xml_nfe("902", CHAVE_NF902, "2000.00", "15")

    zip_bytes = _create_zip({
        "pasta/901.xml": xml1,
        "902.xml": xml2,
        "leia-me.txt": b"instrucoes",
    })

    files = [
        ("files", ("lote_nfe.zip", zip_bytes, "application/zip"))
    ]

    response = client.post(f"/api/v1/solicitacoes/{sol.id}/processar", files=files)
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["status"] == "concluido"
    assert len(data["saidas"]) >= 1


def test_processar_com_zip_e_xml_avulso(client, cenario_janeiro):
    """Testa envio conjunto de um .zip e um .xml avulso."""
    sol = cenario_janeiro()

    xml1 = build_xml_nfe("901", CHAVE_NF901, "1000.00", "10")
    xml2 = build_xml_nfe("902", CHAVE_NF902, "2000.00", "15")

    zip_bytes = _create_zip({"901.xml": xml1})

    files = [
        ("files", ("lote.zip", zip_bytes, "application/zip")),
        ("files", ("902.xml", xml2, "application/xml")),
    ]

    response = client.post(f"/api/v1/solicitacoes/{sol.id}/processar", files=files)
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["status"] == "concluido"


def test_zip_sem_arquivos_xml_rejeita(client, cenario_janeiro):
    """Um arquivo ZIP sem nenhum XML deve ser rejeitado com mensagem explicativa."""
    sol = cenario_janeiro()

    zip_bytes = _create_zip({
        "arquivo.pdf": b"%PDF-1.4...",
        "planilha.xlsx": b"PK...",
    })

    files = [
        ("files", ("lote_vazio.zip", zip_bytes, "application/zip"))
    ]

    response = client.post(f"/api/v1/solicitacoes/{sol.id}/processar", files=files)
    assert response.status_code == 400
    assert "não contém nenhum arquivo XML" in response.json()["detail"]


def test_zip_corrompido_rejeita(client, cenario_janeiro):
    """Um arquivo com extensão .zip corrompido deve ser rejeitado."""
    sol = cenario_janeiro()

    files = [
        ("files", ("corrompido.zip", b"nao-sou-um-zip-valido", "application/zip"))
    ]

    response = client.post(f"/api/v1/solicitacoes/{sol.id}/processar", files=files)
    assert response.status_code == 400
    assert "inválido ou corrompido" in response.json()["detail"]


def test_zip_bomb_rejeitado_antes_de_descompactar(monkeypatch):
    content = b"A" * 10_000
    zip_bytes = _create_zip({"compactado.xml": content})
    monkeypatch.setattr(settings, "MAX_ZIP_COMPRESSION_RATIO", 2)
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as archive:
        with pytest.raises(HTTPException) as exc_info:
            _read_xml_archive(archive)
    assert exc_info.value.status_code == 413
