from typing import Any, Optional
from pydantic import BaseModel, Field, validator

from app.constants import ROLE_OPERADOR
from app.schemas.validators import clean_email


class LoginRequest(BaseModel):
    email: str = Field(..., min_length=3, max_length=254)
    password: str = Field(..., min_length=1, max_length=256)

    @validator("email")
    def validate_email(cls, value: str) -> str:
        return clean_email(value)

    class Config:
        extra = "forbid"

class UserOut(BaseModel):
    id: Any
    nome: str
    email: str
    cargo: str
    role: Optional[str] = ROLE_OPERADOR

    class Config:
        orm_mode = True

class TokenResponse(BaseModel):
    """Resposta de login e de renovação.

    O ``refresh_token`` nunca aparece aqui: ele viaja exclusivamente no cookie
    httpOnly, fora do alcance do JavaScript. ``expires_in`` permite ao cliente
    renovar antes de expirar, em vez de descobrir pelo primeiro 401.
    """

    access_token: str
    token_type: str = "bearer"
    expires_in: Optional[int] = None
    user: UserOut


class AlterarSenhaRequest(BaseModel):
    senha_atual: str = Field(..., min_length=1, max_length=256, description="Senha atual do usuário")
    nova_senha: str = Field(..., min_length=6, max_length=128, description="Nova senha de acesso (mínimo 6 caracteres)")

    @validator("nova_senha")
    def validate_nova_senha(cls, value: str) -> str:
        if len(value.strip()) < 6:
            raise ValueError("A nova senha deve conter no mínimo 6 caracteres.")
        return value

    class Config:
        extra = "forbid"
