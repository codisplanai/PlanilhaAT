"""Operações de persistência comuns à camada de endpoints."""

from typing import Any, Type, TypeVar

import logging

from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session


ModelT = TypeVar("ModelT")
logger = logging.getLogger(__name__)


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


def commit_and_refresh(
    db: Session,
    entity: ModelT,
    conflict_detail: str = "Os dados informados conflitam com um registro existente.",
) -> ModelT:
    try:
        db.commit()
        db.refresh(entity)
        return entity
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail=conflict_detail)
    except SQLAlchemyError:
        db.rollback()
        logger.exception("Falha ao persistir %s", type(entity).__name__)
        raise HTTPException(status_code=500, detail="Não foi possível salvar o registro.")


def delete_and_commit(db: Session, entity: Any) -> None:
    try:
        db.delete(entity)
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail="O registro está em uso e não pode ser excluído.",
        )
    except SQLAlchemyError:
        db.rollback()
        logger.exception("Falha ao excluir %s", type(entity).__name__)
        raise HTTPException(status_code=500, detail="Não foi possível excluir o registro.")
