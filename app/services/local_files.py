"""Operações locais seguras para artefatos gerados pela aplicação."""

import os
import tempfile
from pathlib import Path
from typing import Optional, Union


PathLike = Union[str, os.PathLike[str]]


def atomic_write(path: PathLike, content: bytes, *, prefix: str = "artifact_") -> str:
    """Grava bytes no mesmo volume e promove o arquivo de forma atômica."""
    destination = Path(path)
    destination.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_path = tempfile.mkstemp(
        prefix=prefix,
        suffix=destination.suffix,
        dir=str(destination.parent),
    )
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(content)
        os.replace(temporary_path, destination)
    finally:
        if os.path.exists(temporary_path):
            os.remove(temporary_path)
    return str(destination)


def read_bytes_if_exists(path: PathLike) -> Optional[bytes]:
    candidate = Path(path)
    if not candidate.is_file():
        return None
    return candidate.read_bytes()


def remove_file_if_exists(path: PathLike) -> None:
    candidate = Path(path)
    if candidate.is_file():
        candidate.unlink()


def safe_file_within(root: PathLike, raw_path: Optional[PathLike]) -> Optional[Path]:
    """Resolve um arquivo somente quando ele permanece dentro da raiz informada."""
    if not raw_path:
        return None
    root_path = Path(root).resolve()
    candidate = Path(raw_path).resolve()
    if candidate.is_relative_to(root_path) and candidate.is_file():
        return candidate
    return None
