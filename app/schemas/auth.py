from pydantic import BaseModel
from typing import Optional, Union, Any

class LoginRequest(BaseModel):
    email: str
    password: str

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
