"""Leitura e validação dos arquivos recebidos pela camada HTTP."""

import io
import os
import zipfile
import hashlib
from typing import Optional, Sequence

from fastapi import HTTPException, UploadFile

from app.core.config import settings


def has_upload(upload: Optional[UploadFile]) -> bool:
    return bool(upload and upload.filename)


async def read_xml_uploads(
    files: Optional[Sequence[UploadFile]],
) -> list[tuple[str, bytes]]:
    xml_files: list[tuple[str, bytes]] = []
    seen_hashes: set[str] = set()
    total_bytes = 0

    for upload in files or []:
        if not upload.filename:
            continue

        filename = upload.filename
        lower_name = filename.lower()
        content = await _read_upload_limited(upload)
        total_bytes += len(content)
        _ensure_total_limit(total_bytes)

        if lower_name.endswith(".xml"):
            digest = hashlib.sha256(content).hexdigest()
            if digest not in seen_hashes:
                seen_hashes.add(digest)
                xml_files.append((filename, content))
            continue

        if not lower_name.endswith(".zip"):
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Arquivo '{filename}' não suportado. Envie arquivos .xml ou "
                    "pacotes .zip contendo os XMLs."
                ),
            )

        try:
            with zipfile.ZipFile(io.BytesIO(content)) as archive:
                extracted = _read_xml_archive(archive)
        except zipfile.BadZipFile as exc:
            raise HTTPException(
                status_code=400,
                detail=f"O arquivo '{filename}' é um arquivo ZIP inválido ou corrompido.",
            ) from exc

        if not extracted:
            raise HTTPException(
                status_code=400,
                detail=f"O arquivo ZIP '{filename}' não contém nenhum arquivo XML de NF-e.",
            )
        for extracted_name, extracted_content in extracted:
            total_bytes += len(extracted_content)
            _ensure_total_limit(total_bytes)
            digest = hashlib.sha256(extracted_content).hexdigest()
            if digest not in seen_hashes:
                seen_hashes.add(digest)
                xml_files.append((extracted_name, extracted_content))

    return xml_files


def _read_xml_archive(archive: zipfile.ZipFile) -> list[tuple[str, bytes]]:
    extracted: list[tuple[str, bytes]] = []
    members = archive.infolist()
    if len(members) > settings.MAX_ZIP_ENTRIES:
        raise HTTPException(status_code=413, detail="O arquivo ZIP contém itens demais.")

    xml_members = []
    uncompressed_total = 0
    for member in members:
        if member.is_dir():
            continue

        basename = os.path.basename(member.filename)
        if "__MACOSX" in member.filename or basename.startswith("."):
            continue
        if basename.lower().endswith(".xml"):
            if member.flag_bits & 0x1:
                raise HTTPException(status_code=400, detail="Arquivos ZIP protegidos por senha não são suportados.")
            if member.file_size > settings.MAX_UPLOAD_FILE_BYTES:
                raise HTTPException(status_code=413, detail=f"O XML '{basename}' excede o tamanho permitido.")
            ratio = member.file_size / max(member.compress_size, 1)
            if ratio > settings.MAX_ZIP_COMPRESSION_RATIO:
                raise HTTPException(status_code=413, detail=f"O XML compactado '{basename}' possui taxa de compressão insegura.")
            uncompressed_total += member.file_size
            if uncompressed_total > settings.MAX_ZIP_UNCOMPRESSED_BYTES:
                raise HTTPException(status_code=413, detail="O conteúdo descompactado excede o tamanho permitido.")
            xml_members.append((basename, member))

    for basename, member in xml_members:
        extracted.append((basename, archive.read(member)))
    return extracted


async def read_optional_upload(
    upload: Optional[UploadFile],
    *,
    allowed_suffixes: Optional[set[str]] = None,
) -> tuple[Optional[bytes], Optional[str]]:
    if not has_upload(upload):
        return None, None
    filename = upload.filename or ""
    suffix = os.path.splitext(filename)[1].lower()
    if allowed_suffixes and suffix not in allowed_suffixes:
        allowed = ", ".join(sorted(allowed_suffixes))
        raise HTTPException(status_code=400, detail=f"Arquivo '{filename}' não suportado. Extensões aceitas: {allowed}.")
    content = await _read_upload_limited(upload)
    return content, filename


async def _read_upload_limited(upload: UploadFile) -> bytes:
    content = await upload.read(settings.MAX_UPLOAD_FILE_BYTES + 1)
    if len(content) > settings.MAX_UPLOAD_FILE_BYTES:
        raise HTTPException(status_code=413, detail=f"O arquivo '{upload.filename}' excede o tamanho permitido.")
    if not content:
        raise HTTPException(status_code=400, detail=f"O arquivo '{upload.filename}' está vazio.")
    return content


def _ensure_total_limit(total_bytes: int) -> None:
    if total_bytes > settings.MAX_UPLOAD_TOTAL_BYTES:
        raise HTTPException(status_code=413, detail="O conjunto de arquivos excede o tamanho total permitido.")
