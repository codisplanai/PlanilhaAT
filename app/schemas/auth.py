from pydantic import BaseModel, Field, validator
from typing import Optional, Any

from app.constants import ROLE_OPERADOR

class LoginRequest(BaseModel):
    email: str = Field(..., min_length=3, max_length=254)
    password: str = Field(..., min_length=1, max_length=256)

    @validator("email")
    def validate_email(cls, value: str) -> str:
        clean = value.strip().lower()
        if clean.count("@") != 1 or clean.startswith("@") or clean.endswith("@"):
            raise ValueError("E-mail inválido")
        return clean

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
    access_token: str
    token_type: str = "bearer"
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
