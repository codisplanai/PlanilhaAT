from pathlib import Path

from app.services.local_files import (
    atomic_write,
    read_bytes_if_exists,
    remove_file_if_exists,
    safe_file_within,
)


def test_atomic_write_substitui_conteudo_sem_deixar_temporario(tmp_path: Path):
    destination = tmp_path / "outputs" / "planilha.xlsx"
    destination.parent.mkdir()
    destination.write_bytes(b"conteudo-antigo")

    result = atomic_write(destination, b"conteudo-novo", prefix="teste_")

    assert result == str(destination)
    assert destination.read_bytes() == b"conteudo-novo"
    assert list(destination.parent.glob("teste_*")) == []


def test_safe_file_within_aceita_apenas_arquivo_da_raiz(tmp_path: Path):
    root = tmp_path / "outputs"
    root.mkdir()
    inside = root / "resultado.xlsx"
    inside.write_bytes(b"xlsx")
    outside = tmp_path / "fora.xlsx"
    outside.write_bytes(b"xlsx")

    assert safe_file_within(root, inside) == inside.resolve()
    assert safe_file_within(root, outside) is None
    assert safe_file_within(root, root / "inexistente.xlsx") is None
    assert safe_file_within(root, None) is None


def test_leitura_e_remocao_sao_idempotentes(tmp_path: Path):
    artifact = tmp_path / "artifact.bin"
    artifact.write_bytes(b"dados")

    assert read_bytes_if_exists(artifact) == b"dados"
    remove_file_if_exists(artifact)
    remove_file_if_exists(artifact)

    assert read_bytes_if_exists(artifact) is None
