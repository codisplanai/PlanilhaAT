"""Integração do DANFE com a API v2 do Meu DANFE.

Somente chamadas explícitas de consulta. A Api-Key nunca é enviada ao navegador.
O provedor armazena NF-es convertidas e pode cobrar por pesquisas de chave.
"""
import base64
import binascii
import logging
import re
from xml.etree import ElementTree

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)
_BASE_URL = "https://api.meudanfe.com.br/v2"
_MAX_XML_BYTES = 20 * 1024 * 1024
_MAX_PDF_BYTES = 15 * 1024 * 1024
_KEY_RE = re.compile(r"^[0-9]{44}$")


class DanfeServiceError(Exception):
    def __init__(self, message: str, status_code: int = 502):
        super().__init__(message)
        self.status_code = status_code


def validate_access_key(chave: str) -> str:
    chave = chave.strip()
    if not _KEY_RE.fullmatch(chave):
        raise DanfeServiceError("Informe uma chave de acesso de NF-e com 44 dígitos.", 422)
    return chave


def validate_xml_for_note(xml: str, chave: str) -> bytes:
    data = xml.encode("utf-8")
    if not data or len(data) > _MAX_XML_BYTES:
        raise DanfeServiceError("XML vazio ou maior que 20 MB.", 413)
    if "<!DOCTYPE" in xml.upper() or "<!ENTITY" in xml.upper():
        raise DanfeServiceError("O XML contém declarações não permitidas.", 422)
    try:
        document = ElementTree.fromstring(data)
    except ElementTree.ParseError:
        raise DanfeServiceError("XML da NF-e inválido.", 422) from None
    info = next((node for node in document.iter() if node.tag.split("}")[-1] == "infNFe"), None)
    if info is None:
        raise DanfeServiceError("O arquivo não contém uma NF-e.", 422)
    found_key = (info.attrib.get("Id") or "").removeprefix("NFe")
    if found_key != chave:
        raise DanfeServiceError("A chave informada não corresponde ao XML selecionado.", 422)
    ide = next((node for node in info if node.tag.split("}")[-1] == "ide"), None)
    model = None if ide is None else next(
        (node.text for node in ide if node.tag.split("}")[-1] == "mod"), None
    )
    if model != "55":
        raise DanfeServiceError("A visualização aceita somente NF-e modelo 55.", 422)
    return data


def _pdf_from_response(response: httpx.Response) -> bytes:
    try:
        payload = response.json()
        if not isinstance(payload, dict) or payload.get("format") != "BASE64":
            raise ValueError("Formato inesperado")
        encoded = payload.get("data")
        if not isinstance(encoded, str) or len(encoded) > (_MAX_PDF_BYTES * 4 // 3 + 4):
            raise ValueError("PDF ausente ou muito grande")
        pdf = base64.b64decode(encoded, validate=True)
        if not pdf.startswith(b"%PDF-") or len(pdf) > _MAX_PDF_BYTES:
            raise ValueError("Conteúdo não é um PDF válido")
        return pdf
    except (ValueError, TypeError, binascii.Error):
        raise DanfeServiceError("O Meu DANFE retornou um PDF inválido.", 502) from None


def _request(client: httpx.Client, method: str, path: str, **kwargs) -> httpx.Response:
    try:
        response = client.request(method, _BASE_URL + path, **kwargs)
    except httpx.TimeoutException:
        raise DanfeServiceError("O Meu DANFE demorou para responder. Tente novamente.", 504) from None
    except httpx.HTTPError:
        logger.warning("Falha de conexão com Meu DANFE", exc_info=False)
        raise DanfeServiceError("Serviço Meu DANFE indisponível. Tente novamente.", 503) from None

    if response.status_code in (401, 403):
        raise DanfeServiceError("A chave de integração do Meu DANFE não foi aceita. Avise o administrador.", 503)
    if response.status_code == 402:
        raise DanfeServiceError("Saldo insuficiente no Meu DANFE para consultar esta NF-e.", 402)
    if response.status_code == 429:
        raise DanfeServiceError("Limite de consultas do Meu DANFE atingido. Tente mais tarde.", 429)
    if response.status_code >= 500:
        raise DanfeServiceError("O Meu DANFE apresentou uma falha ao gerar o documento.", 502)
    if response.status_code >= 400 and response.status_code != 404:
        raise DanfeServiceError("O Meu DANFE não conseguiu processar a NF-e informada.", 422)
    return response


def get_danfe_pdf(*, chave: str, xml: str | None, buscar_por_chave: bool) -> bytes:
    validate_access_key(chave)
    api_key = (settings.MEUDANFE_API_KEY or "").strip()
    if not api_key:
        raise DanfeServiceError(
            "Integração não configurada. O administrador deve definir MEUDANFE_API_KEY no servidor.",
            503,
        )
    headers = {"Api-Key": api_key, "Accept": "application/json"}
    # Não registrar XML, chaves de acesso nem os headers que contêm credenciais.
    with httpx.Client(timeout=httpx.Timeout(25.0, connect=8.0), follow_redirects=False) as client:
        if xml is not None:
            data = validate_xml_for_note(xml, chave)
            result = _request(
                client, "POST", "/fd/convert/xml-to-da",
                headers={**headers, "Content-Type": "text/plain"},
                content=data,
            )
            return _pdf_from_response(result)

        result = _request(client, "GET", f"/fd/get/da/{chave}", headers=headers)
        if result.status_code == 200:
            return _pdf_from_response(result)
        if not buscar_por_chave:
            raise DanfeServiceError(
                "NF-e ainda não cadastrada no Meu DANFE. Autorize a busca pela chave para continuar.",
                404,
            )

        # Buscar uma chave ainda não cadastrada pode custar R$ 0,03.
        result = _request(client, "PUT", f"/fd/add/{chave}", headers=headers)
        if result.status_code == 404:
            raise DanfeServiceError("NF-e não encontrada pelo Meu DANFE.", 404)
        try:
            status = result.json().get("status")
        except (ValueError, AttributeError):
            raise DanfeServiceError("Resposta inválida do Meu DANFE ao consultar a chave.", 502) from None
        if status in ("WAITING", "SEARCHING"):
            raise DanfeServiceError(
                "Busca iniciada no Meu DANFE. Aguarde alguns segundos e clique novamente em Visualizar DANFE.",
                409,
            )
        if status == "NOT_FOUND":
            raise DanfeServiceError("NF-e não localizada pelo Meu DANFE.", 404)
        if status != "OK":
            raise DanfeServiceError("O Meu DANFE não conseguiu localizar a NF-e.", 502)

        response = _request(client, "GET", f"/fd/get/da/{chave}", headers=headers)
        if response.status_code == 404:
            raise DanfeServiceError("PDF ainda em processamento. Tente novamente em alguns segundos.", 409)
        return _pdf_from_response(response)
