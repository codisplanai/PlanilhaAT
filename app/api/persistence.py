"""Operações de persistência comuns à camada de endpoints."""

from typing import Any, Type, TypeVar

from fastapi import HTTPException
from sqlalchemy.orm import Session


ModelT = TypeVar("ModelT")


def get_by_id_or_404(
    db: Session,
    model: Type[ModelT],
    entity_id: Any,
    detail: str,
) -> ModelT:
    entity = db.get(model, entity_id)
    if entity is None:
        raise HTTPException(status_code=404, detail=detail)
    return entity


def commit_and_refresh(db: Session, entity: ModelT) -> ModelT:
    db.commit()
    db.refresh(entity)
    return entity


def delete_and_commit(db: Session, entity: Any) -> None:
    db.delete(entity)
    db.commit()
