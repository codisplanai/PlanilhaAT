"""Leitura e validação dos arquivos recebidos pela camada HTTP."""

import io
import os
import zipfile
from typing import Optional, Sequence

from fastapi import HTTPException, UploadFile


def has_upload(upload: Optional[UploadFile]) -> bool:
    return bool(upload and upload.filename)


async def read_xml_uploads(
    files: Optional[Sequence[UploadFile]],
) -> list[tuple[str, bytes]]:
    xml_files: list[tuple[str, bytes]] = []

    for upload in files or []:
        if not upload.filename:
            continue

        filename = upload.filename
        lower_name = filename.lower()
        content = await upload.read()

        if lower_name.endswith(".xml"):
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
        xml_files.extend(extracted)

    return xml_files


def _read_xml_archive(archive: zipfile.ZipFile) -> list[tuple[str, bytes]]:
    extracted: list[tuple[str, bytes]] = []
    for member in archive.infolist():
        if member.is_dir():
            continue

        basename = os.path.basename(member.filename)
        if "__MACOSX" in member.filename or basename.startswith("."):
            continue
        if basename.lower().endswith(".xml"):
            extracted.append((basename, archive.read(member)))
    return extracted


async def read_optional_upload(
    upload: Optional[UploadFile],
) -> tuple[Optional[bytes], Optional[str]]:
    if not has_upload(upload):
        return None, None
    return await upload.read(), upload.filename
