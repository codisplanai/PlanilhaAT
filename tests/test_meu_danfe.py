"""Regressões da integração de NF-e com Meu DANFE, sem acesso à rede."""
import base64

import pytest

from app.core.config import settings
from app.services import meu_danfe as danfe


CHAVE = "29" + "1" * 42
XML = f'<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe"><NFe><infNFe Id="NFe{CHAVE}"><ide><mod>55</mod></ide></infNFe></NFe></nfeProc>'
PDF = b"%PDF-1.7\n1 0 obj\nendobj\n%%EOF"


class FakeResponse:
    def __init__(self, status=200, payload=None):
        self.status_code = status
        self.payload = payload

    def json(self):
        return self.payload


class FakeClient:
    def __init__(self, responses):
        self.responses = iter(responses)
        self.calls = []

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def request(self, method, url, **kwargs):
        self.calls.append((method, url, kwargs))
        return next(self.responses)


def pdf_response():
    return FakeResponse(payload={
        "name": f"NFE-{CHAVE}.pdf",
        "type": "NFE",
        "format": "BASE64",
        "data": base64.b64encode(PDF).decode("ascii"),
    })


def fake_api(monkeypatch, responses):
    monkeypatch.setattr(settings, "MEUDANFE_API_KEY", "private-test-credential")
    fake = FakeClient(responses)
    monkeypatch.setattr(danfe.httpx, "Client", lambda **_kwargs: fake)
    return fake


def test_xml_conversion_uses_original_xml_without_lookup(monkeypatch):
    fake = fake_api(monkeypatch, [pdf_response()])
    assert danfe.get_danfe_pdf(chave=CHAVE, xml=XML, buscar_por_chave=False) == PDF
    assert len(fake.calls) == 1
    method, url, options = fake.calls[0]
    assert method == "POST" and url.endswith("/fd/convert/xml-to-da")
    assert options["headers"]["Api-Key"] == "private-test-credential"
    assert b"infNFe" in options["content"]
    assert options["headers"]["Content-Type"] == "text/plain"


def test_access_key_cached_by_provider_does_not_initiate_paid_lookup(monkeypatch):
    fake = fake_api(monkeypatch, [pdf_response()])
    assert danfe.get_danfe_pdf(chave=CHAVE, xml=None, buscar_por_chave=False) == PDF
    assert [method for method, _, _ in fake.calls] == ["GET"]


def test_absent_key_requires_paid_lookup_authorization(monkeypatch):
    fake = fake_api(monkeypatch, [FakeResponse(status=404)])
    with pytest.raises(danfe.DanfeServiceError) as exc:
        danfe.get_danfe_pdf(chave=CHAVE, xml=None, buscar_por_chave=False)
    assert exc.value.status_code == 404
    assert [method for method, _, _ in fake.calls] == ["GET"]


def test_authorized_lookup_returns_pending_status_without_retry_spam(monkeypatch):
    fake = fake_api(monkeypatch, [
        FakeResponse(status=404),
        FakeResponse(payload={"status": "WAITING"}),
    ])
    with pytest.raises(danfe.DanfeServiceError) as exc:
        danfe.get_danfe_pdf(chave=CHAVE, xml=None, buscar_por_chave=True)
    assert exc.value.status_code == 409
    assert [method for method, _, _ in fake.calls] == ["GET", "PUT"]


def test_authorized_lookup_can_return_pdf(monkeypatch):
    fake = fake_api(monkeypatch, [
        FakeResponse(status=404),
        FakeResponse(payload={"status": "OK"}),
        pdf_response(),
    ])
    assert danfe.get_danfe_pdf(chave=CHAVE, xml=None, buscar_por_chave=True) == PDF
    assert [method for method, _, _ in fake.calls] == ["GET", "PUT", "GET"]


def test_invalid_xml_not_sent_to_vendor(monkeypatch):
    fake = fake_api(monkeypatch, [])
    wrong_xml = XML.replace(CHAVE, "28" + "2" * 42)
    with pytest.raises(danfe.DanfeServiceError) as exc:
        danfe.get_danfe_pdf(chave=CHAVE, xml=wrong_xml, buscar_por_chave=False)
    assert exc.value.status_code == 422
    assert not fake.calls


def test_malformed_pdf_is_rejected(monkeypatch):
    fake_api(monkeypatch, [FakeResponse(payload={
        "name": "invalid.pdf", "type": "NFE", "format": "BASE64",
        "data": base64.b64encode(b"not pdf").decode("ascii"),
    })])
    with pytest.raises(danfe.DanfeServiceError) as exc:
        danfe.get_danfe_pdf(chave=CHAVE, xml=XML, buscar_por_chave=False)
    assert exc.value.status_code == 502


def test_no_api_key_is_safe_failure(monkeypatch):
    monkeypatch.setattr(settings, "MEUDANFE_API_KEY", None)
    with pytest.raises(danfe.DanfeServiceError) as exc:
        danfe.get_danfe_pdf(chave=CHAVE, xml=None, buscar_por_chave=False)
    assert exc.value.status_code == 503
    assert "MEUDANFE_API_KEY" in str(exc.value)
