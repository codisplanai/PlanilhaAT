import xml.etree.ElementTree as ET
from datetime import datetime
from decimal import Decimal
from typing import Optional

from app.core.exceptions import ValidationException


def strip_tag(tag: str) -> str:
    """Remove namespace da tag XML."""
    if "}" in tag:
        return tag.split("}", 1)[1]
    return tag


def find_elem(parent: Optional[ET.Element], name: str) -> Optional[ET.Element]:
    """Busca elemento filho direto ignorando namespace."""
    if parent is None:
        return None
    for child in parent:
        if strip_tag(child.tag) == name:
            return child
    return None


def find_first_descendant(root: Optional[ET.Element], name: str) -> Optional[ET.Element]:
    """Busca o primeiro elemento descendente (inclusive o próprio root) ignorando namespace."""
    if root is None:
        return None
    for elem in root.iter():
        if strip_tag(elem.tag) == name:
            return elem
    return None


def get_text(parent: Optional[ET.Element], name: str, default: str = "") -> str:
    elem = find_elem(parent, name)
    if elem is not None and elem.text is not None:
        return elem.text.strip()
    return default


def get_decimal(parent: Optional[ET.Element], name: str, default: str = "0.00") -> Decimal:
    txt = get_text(parent, name, default)
    try:
        return Decimal(txt)
    except Exception:
        return Decimal(default)


def parse_xml_root(xml_content: bytes, doc_label: str = "NF-e") -> ET.Element:
    try:
        return ET.fromstring(xml_content)
    except Exception as e:
        raise ValidationException(f"Arquivo XML de {doc_label} inválido ou corrompido: {str(e)}")


def parse_sefaz_datetime(date_str: str, doc_label: str = "NF-e") -> datetime:
    """Parse de dhEmi (ISO com fuso) ou dEmi (YYYY-MM-DD)."""
    if not date_str:
        raise ValidationException(f"O XML da {doc_label} não informa a data de emissão obrigatória.")
    try:
        clean_str = date_str.replace("Z", "")
        if "+" in clean_str:
            clean_str = clean_str.split("+")[0]
        elif "-" in clean_str and clean_str.count("-") > 2:
            parts = clean_str.rsplit("-", 1)
            clean_str = parts[0]

        if "T" in clean_str:
            return datetime.fromisoformat(clean_str)
        return datetime.strptime(clean_str, "%Y-%m-%d")
    except (TypeError, ValueError):
        try:
            return datetime.strptime(date_str[:10], "%Y-%m-%d")
        except (TypeError, ValueError) as exc:
            raise ValidationException(f"Data de emissão inválida no XML: '{date_str}'.") from exc

