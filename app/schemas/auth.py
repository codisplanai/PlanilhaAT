from pydantic import BaseModel, Field, validator
from typing import Optional, Any

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
    role: Optional[str] = "operador"

    class Config:
        orm_mode = True

class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut
