# Gestão de Usuários — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que um admin (Contador Sênior) crie, liste e ative/desative usuários pela interface, sem editar código ou banco à mão.

**Architecture:** O backend é o único que fala com o Supabase Auth, usando a `service_role` key. Criar um usuário é uma operação em dois sistemas (Supabase Auth + tabela `profiles`), com compensação explícita se a segunda etapa falhar. Nenhuma tabela nova: reusa o model `Profile`.

**Tech Stack:** FastAPI, SQLAlchemy, Pydantic v1, pytest, React + TypeScript, react-hook-form + zod, axios, Tailwind.

**Spec:** `docs/superpowers/specs/2026-09-01-gestao-usuarios-design.md`

## Global Constraints

- Pydantic **v1** (`from pydantic import BaseModel, Field, validator`; `class Config: orm_mode = True`). Não usar sintaxe v2.
- Senha: mínimo **8** caracteres. Nunca retornada em resposta nem escrita em log.
- `nome`: máximo **255** caracteres (espelha `profiles.nome`).
- E-mail normalizado com `.strip().lower()` no schema.
- `cargo` derivado do papel: `admin` → `"Contador Sênior"`, `operador` → `"Analista Fiscal"`.
- Mensagens de erro voltadas ao usuário em português.
- Rodar a suíte com `.venv/Scripts/python.exe -m pytest`.
- Não fazer `git push` — apenas commits locais.

---

### Task 1: Schemas e wrapper da Admin API

**Files:**
- Create: `app/schemas/usuario.py`
- Create: `app/services/supabase_admin.py`
- Test: `tests/test_usuarios_schema.py`

**Interfaces:**
- Consumes: `app.core.config.settings`
- Produces:
  - `CARGO_POR_ROLE: dict[str, str]`
  - `UsuarioCreate` com campos `nome, email, password, role` e propriedade `cargo -> str`
  - `UsuarioOut` (`id, nome, email, cargo, role, ativo, criado_em`), `orm_mode`
  - `UsuarioStatusUpdate` com campo `ativo: bool`
  - `SupabaseAdminNaoConfigurado(RuntimeError)`
  - `SupabaseAdminService.is_configured() -> bool`
  - `SupabaseAdminService.create_user(email: str, password: str, nome: str) -> str` (retorna o UUID)
  - `SupabaseAdminService.delete_user(user_id: str) -> None`

- [ ] **Step 1: Write the failing test**

Create `tests/test_usuarios_schema.py`:

```python
import pytest
from pydantic import ValidationError

from app.schemas.usuario import UsuarioCreate
from app.services.supabase_admin import SupabaseAdminService


def test_email_e_normalizado():
    payload = UsuarioCreate(
        nome="Maria Souza", email="  Maria@Codisplan.COM ",
        password="senhaforte1", role="operador",
    )
    assert payload.email == "maria@codisplan.com"


def test_cargo_derivado_do_papel():
    admin = UsuarioCreate(nome="A", email="a@x.com", password="senhaforte1", role="admin")
    operador = UsuarioCreate(nome="O", email="o@x.com", password="senhaforte1", role="operador")
    assert admin.cargo == "Contador Sênior"
    assert operador.cargo == "Analista Fiscal"


def test_senha_curta_e_rejeitada():
    with pytest.raises(ValidationError):
        UsuarioCreate(nome="A", email="a@x.com", password="curta1", role="operador")


def test_nome_acima_de_255_e_rejeitado():
    with pytest.raises(ValidationError):
        UsuarioCreate(nome="x" * 256, email="a@x.com", password="senhaforte1", role="operador")


def test_papel_invalido_e_rejeitado():
    with pytest.raises(ValidationError):
        UsuarioCreate(nome="A", email="a@x.com", password="senhaforte1", role="superadmin")


def test_is_configured_falso_sem_chave(monkeypatch):
    from app.core.config import settings
    monkeypatch.setattr(settings, "SUPABASE_SERVICE_ROLE_KEY", None)
    assert SupabaseAdminService.is_configured() is False
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/Scripts/python.exe -m pytest tests/test_usuarios_schema.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.schemas.usuario'`

- [ ] **Step 3: Create `app/schemas/usuario.py`**

```python
from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel, Field, validator

CARGO_POR_ROLE = {
    "admin": "Contador Sênior",
    "operador": "Analista Fiscal",
}


class UsuarioCreate(BaseModel):
    nome: str = Field(..., min_length=1, max_length=255, example="Maria Souza")
    email: str = Field(..., min_length=3, max_length=254, example="maria@codisplan.com")
    password: str = Field(..., min_length=8, max_length=256)
    role: str = Field("operador", example="operador")

    @validator("email")
    def validar_email(cls, value: str) -> str:
        clean = value.strip().lower()
        if clean.count("@") != 1 or clean.startswith("@") or clean.endswith("@"):
            raise ValueError("E-mail inválido")
        return clean

    @validator("nome")
    def validar_nome(cls, value: str) -> str:
        clean = value.strip()
        if not clean:
            raise ValueError("Nome é obrigatório")
        return clean

    @validator("role")
    def validar_role(cls, value: str) -> str:
        clean = value.strip().lower()
        if clean not in CARGO_POR_ROLE:
            raise ValueError("Papel deve ser 'admin' ou 'operador'")
        return clean

    @property
    def cargo(self) -> str:
        return CARGO_POR_ROLE[self.role]

    class Config:
        extra = "forbid"


class UsuarioOut(BaseModel):
    id: Any
    nome: str
    email: str
    cargo: str
    role: str
    ativo: bool
    criado_em: Optional[datetime] = None

    class Config:
        orm_mode = True


class UsuarioStatusUpdate(BaseModel):
    ativo: bool

    class Config:
        extra = "forbid"
```

- [ ] **Step 4: Create `app/services/supabase_admin.py`**

Espelha a forma de `app/services/supabase_storage.py` (`is_configured` / `_get_headers`).

```python
"""Wrapper da Admin API do Supabase Auth.

Isolar a dependência HTTP aqui permite que os testes de endpoint mockem este
módulo em vez de remendar ``httpx`` dentro do endpoint.
"""

import logging
from typing import Dict

import httpx
from fastapi import HTTPException

from app.core.config import settings

logger = logging.getLogger(__name__)


class SupabaseAdminNaoConfigurado(RuntimeError):
    """SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY ausentes."""


class SupabaseAdminService:
    @classmethod
    def is_configured(cls) -> bool:
        return bool(settings.SUPABASE_URL and settings.SUPABASE_SERVICE_ROLE_KEY)

    @classmethod
    def _get_headers(cls) -> Dict[str, str]:
        key = settings.SUPABASE_SERVICE_ROLE_KEY
        return {
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
        }

    @classmethod
    def _base_url(cls) -> str:
        return f"{settings.SUPABASE_URL.rstrip('/')}/auth/v1/admin/users"

    @classmethod
    def create_user(cls, email: str, password: str, nome: str) -> str:
        if not cls.is_configured():
            raise SupabaseAdminNaoConfigurado()

        payload = {
            "email": email,
            "password": password,
            "email_confirm": True,
            "user_metadata": {"nome": nome},
        }
        try:
            with httpx.Client(timeout=15.0) as client:
                response = client.post(
                    cls._base_url(), json=payload, headers=cls._get_headers()
                )
        except httpx.HTTPError as exc:
            logger.warning("Supabase Auth indisponível ao criar usuário: %s", exc)
            raise HTTPException(
                status_code=503,
                detail="Serviço de autenticação temporariamente indisponível.",
            )

        if response.status_code in (200, 201):
            user_id = (response.json() or {}).get("id")
            if not user_id:
                raise HTTPException(
                    status_code=502,
                    detail="Resposta inválida do serviço de autenticação.",
                )
            return str(user_id)

        if response.status_code >= 500:
            raise HTTPException(
                status_code=503,
                detail="Serviço de autenticação temporariamente indisponível.",
            )

        raise HTTPException(status_code=400, detail=cls._mensagem_de_erro(response))

    @classmethod
    def delete_user(cls, user_id: str) -> None:
        """Usado apenas na compensação; nunca propaga erro para não mascarar a falha original."""
        if not cls.is_configured():
            return
        try:
            with httpx.Client(timeout=15.0) as client:
                client.delete(
                    f"{cls._base_url()}/{user_id}", headers=cls._get_headers()
                )
        except httpx.HTTPError:
            logger.exception("Falha ao remover usuário %s no Supabase Auth", user_id)

    @staticmethod
    def _mensagem_de_erro(response: httpx.Response) -> str:
        generica = "Não foi possível criar o usuário no serviço de autenticação."
        try:
            corpo = response.json() or {}
        except ValueError:
            return generica
        return str(
            corpo.get("msg")
            or corpo.get("error_description")
            or corpo.get("message")
            or generica
        )
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `.venv/Scripts/python.exe -m pytest tests/test_usuarios_schema.py -v`
Expected: 6 passed

- [ ] **Step 6: Commit**

```bash
git add app/schemas/usuario.py app/services/supabase_admin.py tests/test_usuarios_schema.py
git commit -m "feat(usuarios): schemas e wrapper da Admin API do Supabase"
```

---

### Task 2: Endpoint de criação e registro do router

**Files:**
- Create: `app/api/endpoints/usuarios.py`
- Modify: `app/api/router.py`
- Modify: `app/main.py` (lista do alias legado `/v1`)
- Test: `tests/test_usuarios.py`

**Interfaces:**
- Consumes: tudo o que a Task 1 produz; `require_admin`, `LOCAL_USERS_FALLBACK` de `app.core.security`; `get_by_id_or_404` de `app.api.persistence`
- Produces:
  - `router` (prefixo `/usuarios`)
  - `POST /api/v1/usuarios -> 201 UsuarioOut`
  - `_desfazer_criacao(db: Session, user_id: str) -> None`

**Nota sobre o mock:** os testes remendam `SupabaseAdminService` **dentro do módulo do endpoint**. Isso diverge de propósito de `tests/test_auth.py`, que remenda `httpx`; seguir aquele precedente anularia a razão de o wrapper existir.

- [ ] **Step 1: Write the failing test**

Create `tests/test_usuarios.py`:

```python
import pytest

from app.models.profile import Profile

NOVO_UUID = "11111111-2222-3333-4444-555555555555"


@pytest.fixture
def supabase_admin_fake(monkeypatch):
    """Substitui a Admin API. Registra as chamadas para as asserções."""
    from app.api.endpoints import usuarios as usuarios_module

    chamadas = {"create": [], "delete": []}

    def fake_create(email, password, nome):
        chamadas["create"].append({"email": email, "password": password, "nome": nome})
        return NOVO_UUID

    def fake_delete(user_id):
        chamadas["delete"].append(user_id)

    monkeypatch.setattr(
        usuarios_module.SupabaseAdminService, "create_user", staticmethod(fake_create)
    )
    monkeypatch.setattr(
        usuarios_module.SupabaseAdminService, "delete_user", staticmethod(fake_delete)
    )
    return chamadas


@pytest.fixture
def client_operador(client):
    """Mesmo TestClient, autenticado como operador."""
    res = client.post("/api/v1/auth/login", json={
        "email": "operador@contabilidade.com", "password": "fiscal",
    })
    assert res.status_code == 200, res.text
    client.headers["Authorization"] = f"Bearer {res.json()['access_token']}"
    return client


def test_operador_nao_cria_usuario(client_operador, supabase_admin_fake):
    res = client_operador.post("/api/v1/usuarios", json={
        "nome": "Maria", "email": "maria@codisplan.com",
        "password": "senhaforte1", "role": "operador",
    })
    assert res.status_code == 403
    assert supabase_admin_fake["create"] == []


def test_admin_cria_operador(client, db_session, supabase_admin_fake):
    res = client.post("/api/v1/usuarios", json={
        "nome": "Maria Souza", "email": "maria@codisplan.com",
        "password": "senhaforte1", "role": "operador",
    })
    assert res.status_code == 201, res.text
    corpo = res.json()
    assert corpo["cargo"] == "Analista Fiscal"
    assert corpo["role"] == "operador"
    assert corpo["ativo"] is True
    assert "password" not in corpo

    perfil = db_session.query(Profile).filter(Profile.id == NOVO_UUID).first()
    assert perfil is not None
    assert perfil.nome == "Maria Souza"
    assert perfil.cargo == "Analista Fiscal"


def test_admin_cria_admin(client, supabase_admin_fake):
    res = client.post("/api/v1/usuarios", json={
        "nome": "Joana", "email": "joana@codisplan.com",
        "password": "senhaforte1", "role": "admin",
    })
    assert res.status_code == 201, res.text
    assert res.json()["cargo"] == "Contador Sênior"
    assert res.json()["role"] == "admin"


def test_email_duplicado_nao_chama_supabase(client, db_session, supabase_admin_fake):
    db_session.add(Profile(
        id="99999999-9999-9999-9999-999999999999", email="maria@codisplan.com",
        nome="Maria", cargo="Analista Fiscal", role="operador", ativo=True,
    ))
    db_session.commit()

    res = client.post("/api/v1/usuarios", json={
        "nome": "Outra Maria", "email": "maria@codisplan.com",
        "password": "senhaforte1", "role": "operador",
    })
    assert res.status_code == 400
    assert supabase_admin_fake["create"] == []


def test_email_maiusculo_colide_com_registro_existente(client, db_session, supabase_admin_fake):
    db_session.add(Profile(
        id="99999999-9999-9999-9999-999999999999", email="maria@codisplan.com",
        nome="Maria", cargo="Analista Fiscal", role="operador", ativo=True,
    ))
    db_session.commit()

    res = client.post("/api/v1/usuarios", json={
        "nome": "Maria", "email": "Maria@Codisplan.COM",
        "password": "senhaforte1", "role": "operador",
    })
    assert res.status_code == 400
    assert supabase_admin_fake["create"] == []


def test_email_do_mapa_fixo_e_recusado(client, supabase_admin_fake):
    res = client.post("/api/v1/usuarios", json={
        "nome": "Falso Operador", "email": "operador@contabilidade.com",
        "password": "senhaforte1", "role": "admin",
    })
    assert res.status_code == 400
    assert supabase_admin_fake["create"] == []


def test_senha_curta_e_recusada(client, supabase_admin_fake):
    res = client.post("/api/v1/usuarios", json={
        "nome": "Maria", "email": "maria@codisplan.com",
        "password": "curta1", "role": "operador",
    })
    assert res.status_code == 422
    assert supabase_admin_fake["create"] == []


def test_nome_longo_e_recusado(client, supabase_admin_fake):
    res = client.post("/api/v1/usuarios", json={
        "nome": "x" * 256, "email": "maria@codisplan.com",
        "password": "senhaforte1", "role": "operador",
    })
    assert res.status_code == 422
    assert supabase_admin_fake["create"] == []


def test_falha_ao_gravar_perfil_desfaz_criacao(client, db_session, supabase_admin_fake, monkeypatch):
    from app.api.endpoints import usuarios as usuarios_module

    def explode(*args, **kwargs):
        raise RuntimeError("falha simulada ao gravar")

    monkeypatch.setattr(usuarios_module, "_gravar_perfil", explode)

    res = client.post("/api/v1/usuarios", json={
        "nome": "Maria", "email": "maria@codisplan.com",
        "password": "senhaforte1", "role": "operador",
    })
    assert res.status_code == 500
    assert supabase_admin_fake["delete"] == [NOVO_UUID]
    assert db_session.query(Profile).filter(Profile.id == NOVO_UUID).first() is None


def test_service_role_ausente_da_erro_de_configuracao(client, monkeypatch):
    from app.api.endpoints import usuarios as usuarios_module
    from app.services.supabase_admin import SupabaseAdminNaoConfigurado

    def sem_config(*args, **kwargs):
        raise SupabaseAdminNaoConfigurado()

    monkeypatch.setattr(
        usuarios_module.SupabaseAdminService, "create_user", staticmethod(sem_config)
    )

    res = client.post("/api/v1/usuarios", json={
        "nome": "Maria", "email": "maria@codisplan.com",
        "password": "senhaforte1", "role": "operador",
    })
    assert res.status_code == 500
    assert "SUPABASE_SERVICE_ROLE_KEY" in res.json()["detail"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/Scripts/python.exe -m pytest tests/test_usuarios.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.api.endpoints.usuarios'`

- [ ] **Step 3: Create `app/api/endpoints/usuarios.py`**

`_gravar_perfil` é uma função de módulo separada porque o teste de compensação a substitui para simular a falha do passo 5.

```python
import logging

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import LOCAL_USERS_FALLBACK, require_admin
from app.models.profile import Profile
from app.schemas.usuario import UsuarioCreate, UsuarioOut
from app.services.supabase_admin import (
    SupabaseAdminNaoConfigurado,
    SupabaseAdminService,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/usuarios", tags=["Usuários"])


def _gravar_perfil(db: Session, user_id: str, payload: UsuarioCreate) -> Profile:
    """Upsert do perfil: o trigger on_auth_user_created pode já ter criado a linha."""
    profile = db.query(Profile).filter(Profile.id == user_id).first()
    if profile is None:
        profile = Profile(id=user_id, email=payload.email)
        db.add(profile)
    profile.email = payload.email
    profile.nome = payload.nome
    profile.cargo = payload.cargo
    profile.role = payload.role
    profile.ativo = True
    db.commit()
    db.refresh(profile)
    return profile


def _desfazer_criacao(db: Session, user_id: str) -> None:
    """Remove a conta e o perfil sem depender de ON DELETE CASCADE.

    A FK com cascade existe em docs/supabase_schema.sql mas não em bancos
    criados pela migration 008, onde um perfil órfão bloquearia para sempre a
    recriação daquele e-mail (profiles.email é UNIQUE).
    """
    SupabaseAdminService.delete_user(user_id)
    try:
        orfao = db.query(Profile).filter(Profile.id == user_id).first()
        if orfao is not None:
            db.delete(orfao)
            db.commit()
    except Exception:
        db.rollback()
        logger.exception("Perfil órfão %s não pôde ser removido", user_id)


@router.post(
    "",
    response_model=UsuarioOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_admin)],
)
def criar_usuario(payload: UsuarioCreate, db: Session = Depends(get_db)):
    if payload.email in LOCAL_USERS_FALLBACK:
        raise HTTPException(
            status_code=400,
            detail=(
                "Este e-mail pertence a uma conta institucional fixa e não pode "
                "ser criado por aqui."
            ),
        )

    if db.query(Profile).filter(Profile.email == payload.email).first():
        raise HTTPException(
            status_code=400,
            detail=f"Já existe um usuário com o e-mail '{payload.email}'.",
        )

    try:
        user_id = SupabaseAdminService.create_user(
            email=payload.email, password=payload.password, nome=payload.nome
        )
    except SupabaseAdminNaoConfigurado:
        logger.error("SUPABASE_SERVICE_ROLE_KEY ausente; criação de usuários indisponível")
        raise HTTPException(
            status_code=500,
            detail=(
                "Criação de usuários indisponível: SUPABASE_SERVICE_ROLE_KEY "
                "não está configurada no servidor."
            ),
        )

    try:
        return _gravar_perfil(db, user_id, payload)
    except Exception:
        db.rollback()
        _desfazer_criacao(db, user_id)
        logger.exception("Falha ao gravar perfil; criação revertida")
        raise HTTPException(
            status_code=500,
            detail="Não foi possível concluir a criação do usuário.",
        )
```

- [ ] **Step 4: Register the router in `app/api/router.py`**

Adicionar o import junto aos outros e o `include_router` no fim da lista:

```python
from app.api.endpoints.usuarios import router as usuarios_router
```

```python
api_router.include_router(usuarios_router)
```

- [ ] **Step 5: Register the router in the legacy `/v1` alias in `app/main.py`**

Adicionar o import junto aos outros (linhas 15-21) e incluir `usuarios_router` na tupla das linhas 100-108, para que `/usuarios` não seja o único recurso sem o alias legado:

```python
from app.api.endpoints.usuarios import router as usuarios_router
```

```python
v1_router = APIRouter(prefix="/v1")
for router in (
    auth_router,
    perfis_regras_router,
    empresas_router,
    regras_aliquotas_router,
    regras_cfop_router,
    templates_router,
    solicitacoes_router,
    usuarios_router,
):
    v1_router.include_router(router)
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `.venv/Scripts/python.exe -m pytest tests/test_usuarios.py -v`
Expected: 10 passed

- [ ] **Step 7: Run the full suite for regressions**

Run: `.venv/Scripts/python.exe -m pytest -q`
Expected: todos passando (baseline: 101 passed, 1 skipped, mais os novos)

- [ ] **Step 8: Commit**

```bash
git add app/api/endpoints/usuarios.py app/api/router.py app/main.py tests/test_usuarios.py
git commit -m "feat(usuarios): endpoint de criacao com compensacao em falha parcial"
```

---

### Task 3: Listagem, ativação/desativação e correção da colisão de UUID

**Files:**
- Modify: `app/api/endpoints/usuarios.py`
- Modify: `app/core/security.py` (ids do `LOCAL_USERS_FALLBACK`)
- Test: `tests/test_usuarios.py` (append)

**Interfaces:**
- Consumes: `router` e `UsuarioOut` da Task 2; `UsuarioStatusUpdate` da Task 1
- Produces:
  - `GET /api/v1/usuarios -> 200 List[UsuarioOut]`
  - `PATCH /api/v1/usuarios/{usuario_id}/status -> 200 UsuarioOut`

- [ ] **Step 1: Write the failing test**

Append a `tests/test_usuarios.py`:

```python
def test_listagem_inclui_inativos(client, db_session, supabase_admin_fake):
    db_session.add(Profile(
        id="88888888-8888-8888-8888-888888888888", email="inativo@codisplan.com",
        nome="Ana Inativa", cargo="Analista Fiscal", role="operador", ativo=False,
    ))
    db_session.commit()

    res = client.get("/api/v1/usuarios")
    assert res.status_code == 200, res.text
    emails = [u["email"] for u in res.json()]
    assert "inativo@codisplan.com" in emails


def test_operador_nao_lista_usuarios(client_operador):
    assert client_operador.get("/api/v1/usuarios").status_code == 403


def test_perfil_inativo_e_bloqueado_no_acesso(client, db_session, supabase_admin_fake):
    """A desativação é aplicada em _load_active_profile, por onde passa toda
    requisição autenticada. Conferir só a flag no banco não provaria nada."""
    from fastapi import HTTPException

    from app.core.security import _load_active_profile

    criar = client.post("/api/v1/usuarios", json={
        "nome": "Maria", "email": "maria@codisplan.com",
        "password": "senhaforte1", "role": "operador",
    })
    assert criar.status_code == 201, criar.text

    res = client.patch(f"/api/v1/usuarios/{NOVO_UUID}/status", json={"ativo": False})
    assert res.status_code == 200, res.text
    assert res.json()["ativo"] is False

    with pytest.raises(HTTPException) as exc:
        _load_active_profile(db_session, NOVO_UUID)
    assert exc.value.status_code == 403


def test_reativar_usuario(client, db_session, supabase_admin_fake):
    db_session.add(Profile(
        id="88888888-8888-8888-8888-888888888888", email="inativo@codisplan.com",
        nome="Ana Inativa", cargo="Analista Fiscal", role="operador", ativo=False,
    ))
    db_session.commit()

    res = client.patch(
        "/api/v1/usuarios/88888888-8888-8888-8888-888888888888/status",
        json={"ativo": True},
    )
    assert res.status_code == 200, res.text
    assert res.json()["ativo"] is True


def test_admin_nao_desativa_a_si_mesmo(client, db_session):
    me = client.get("/api/v1/auth/me").json()
    res = client.patch(f"/api/v1/usuarios/{me['id']}/status", json={"ativo": False})
    assert res.status_code == 400
    assert "própria conta" in res.json()["detail"]


def test_patch_id_inexistente_da_404(client):
    res = client.patch(
        "/api/v1/usuarios/00000000-0000-0000-0000-000000000404/status",
        json={"ativo": False},
    )
    assert res.status_code == 404
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/Scripts/python.exe -m pytest tests/test_usuarios.py -v -k "listagem or desativar or reativar or si_mesmo or inexistente or nao_lista"`
Expected: FAIL com 405 Method Not Allowed / 404 (rotas não existem)

- [ ] **Step 3: Add the endpoints to `app/api/endpoints/usuarios.py`**

Acrescentar os imports que faltam no topo do arquivo:

```python
from typing import List

from app.api.persistence import get_by_id_or_404
from app.schemas.usuario import UsuarioCreate, UsuarioOut, UsuarioStatusUpdate
```

Acrescentar ao fim do arquivo:

```python
@router.get("", response_model=List[UsuarioOut], dependencies=[Depends(require_admin)])
def listar_usuarios(db: Session = Depends(get_db)):
    """Inclui inativos de propósito: sem eles seria impossível reativar alguém."""
    return db.query(Profile).order_by(Profile.nome).all()


@router.patch("/{usuario_id}/status", response_model=UsuarioOut)
def alterar_status(
    usuario_id: str,
    payload: UsuarioStatusUpdate,
    db: Session = Depends(get_db),
    current_user: Profile = Depends(require_admin),
):
    """``require_admin`` vem como parâmetro, não em ``dependencies=[...]``.

    O FastAPI descarta o retorno de dependências declaradas em
    ``dependencies=[...]``, e aqui o ``Profile`` do chamador é necessário para
    impedir a autodesativação.
    """
    if payload.ativo is False and str(usuario_id) == str(current_user.id):
        raise HTTPException(
            status_code=400,
            detail="Você não pode desativar a sua própria conta.",
        )

    profile = get_by_id_or_404(db, Profile, usuario_id, "Usuário não encontrado.")
    profile.ativo = payload.ativo
    db.commit()
    db.refresh(profile)
    return profile
```

- [ ] **Step 4: Fix the UUID collision in `app/core/security.py`**

`admin@contabilidade.com` e `admin@codisplan.com` compartilham `184e793c-50b7-4b57-ace1-c02b19649408`. Como `profiles.id` é chave primária, os dois nunca podem coexistir e a listagem mostraria um só. Usar os UUIDs reais do Supabase Auth onde existem.

Trocar o `"id"` das entradas de `LOCAL_USERS_FALLBACK`:

```python
    "admin@codisplan.com": {
        "id": "d7a327b5-7959-47ac-afc8-1850430f0b12",
        "nome": "Contador Responsável",
        "email": "admin@codisplan.com",
        "cargo": "Contador Sênior",
        "role": "admin",
    },
```

```python
    "operador@contabilidade.com": {
        "id": "53ce2b64-1c96-4be8-b232-cf6e4171ee23",
        "nome": "Operador Fiscal",
        "email": "operador@contabilidade.com",
        "cargo": "Analista Fiscal",
        "role": "operador",
    },
```

`admin@contabilidade.com` mantém `184e793c-50b7-4b57-ace1-c02b19649408` (não tem conta no Supabase Auth). `admin@admin.com` já usa o id real `e2a336a9-579e-472f-845b-cf3e91284c0b`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `.venv/Scripts/python.exe -m pytest tests/test_usuarios.py -v`
Expected: 16 passed

- [ ] **Step 6: Run the full suite for regressions**

Run: `.venv/Scripts/python.exe -m pytest -q`
Expected: todos passando. Atenção especial a `tests/test_auth.py` e `tests/test_supabase_rbac_history.py`, que dependem dos ids do mapa.

- [ ] **Step 7: Commit**

```bash
git add app/api/endpoints/usuarios.py app/core/security.py tests/test_usuarios.py
git commit -m "feat(usuarios): listagem e ativacao/desativacao; corrige colisao de UUID"
```

---

### Task 4: Tela de gestão de usuários

**Files:**
- Create: `frontend/src/types/usuario.ts`
- Create: `frontend/src/api/usuarios.ts`
- Create: `frontend/src/pages/Usuarios/index.tsx`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/components/layout/Sidebar.tsx`

**Interfaces:**
- Consumes: `POST/GET /usuarios` e `PATCH /usuarios/{id}/status` da Task 3; `apiClient` e `getErrorMessage` de `frontend/src/api/client.ts`
- Produces: `UsuariosPage` (default-free named export), rota `/usuarios`

- [ ] **Step 1: Create `frontend/src/types/usuario.ts`**

```typescript
export interface Usuario {
  id: string;
  nome: string;
  email: string;
  cargo: string;
  role: string;
  ativo: boolean;
  criado_em?: string | null;
}

export interface UsuarioCreatePayload {
  nome: string;
  email: string;
  password: string;
  role: 'admin' | 'operador';
}
```

- [ ] **Step 2: Create `frontend/src/api/usuarios.ts`**

```typescript
import { apiClient } from './client';
import type { Usuario, UsuarioCreatePayload } from '../types/usuario';

export const usuariosApi = {
  listar: async (): Promise<Usuario[]> => {
    const { data } = await apiClient.get<Usuario[]>('/usuarios');
    return data;
  },
  criar: async (payload: UsuarioCreatePayload): Promise<Usuario> => {
    const { data } = await apiClient.post<Usuario>('/usuarios', payload);
    return data;
  },
  alterarStatus: async (id: string, ativo: boolean): Promise<Usuario> => {
    const { data } = await apiClient.patch<Usuario>(`/usuarios/${id}/status`, { ativo });
    return data;
  },
};
```

- [ ] **Step 3: Create `frontend/src/pages/Usuarios/index.tsx`**

O `zod` espelha as regras do backend; o backend valida de forma independente.

```tsx
import React, { useCallback, useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { UserPlus, Users } from 'lucide-react';

import { usuariosApi } from '../../api/usuarios';
import { getErrorMessage } from '../../api/client';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Modal } from '../../components/ui/Modal';
import { PageHeader } from '../../components/layout/PageHeader';
import { ErrorAlert } from '../../components/feedback/ErrorAlert';
import type { Usuario } from '../../types/usuario';
import type { User } from '../../types/auth';

const usuarioSchema = z.object({
  nome: z.string().min(1, 'Informe o nome').max(255, 'Nome muito longo'),
  email: z.string().min(1, 'Informe o e-mail').email('Formato de e-mail inválido'),
  password: z.string().min(8, 'A senha deve ter ao menos 8 caracteres'),
  role: z.enum(['operador', 'admin']),
});

type UsuarioFormData = z.infer<typeof usuarioSchema>;

interface UsuariosPageProps {
  user: User | null;
}

export const UsuariosPage: React.FC<UsuariosPageProps> = ({ user }) => {
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [modalAberto, setModalAberto] = useState(false);
  const [salvando, setSalvando] = useState(false);

  const { register, handleSubmit, reset, formState: { errors } } = useForm<UsuarioFormData>({
    resolver: zodResolver(usuarioSchema),
    defaultValues: { nome: '', email: '', password: '', role: 'operador' },
  });

  const carregar = useCallback(async () => {
    try {
      setUsuarios(await usuariosApi.listar());
      setErro(null);
    } catch (err) {
      setErro(getErrorMessage(err));
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const onSubmit = async (data: UsuarioFormData) => {
    setSalvando(true);
    setErro(null);
    try {
      await usuariosApi.criar(data);
      setModalAberto(false);
      reset();
      await carregar();
    } catch (err) {
      setErro(getErrorMessage(err));
    } finally {
      setSalvando(false);
    }
  };

  const alternarStatus = async (alvo: Usuario) => {
    setErro(null);
    try {
      await usuariosApi.alterarStatus(alvo.id, !alvo.ativo);
      await carregar();
    } catch (err) {
      setErro(getErrorMessage(err));
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        icon={<Users className="w-5 h-5 text-amber-600" />}
        title="Gestão de Usuários"
        description="Criação de contas de acesso e controle de quem pode entrar no sistema"
        action={
          <Button leftIcon={<UserPlus className="w-4 h-4" />} onClick={() => setModalAberto(true)}>
            Novo Usuário
          </Button>
        }
      />

      {erro && <ErrorAlert message={erro} />}

      <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
            <tr>
              <th className="text-left px-4 py-3">Nome</th>
              <th className="text-left px-4 py-3">E-mail</th>
              <th className="text-left px-4 py-3">Cargo</th>
              <th className="text-left px-4 py-3">Status</th>
              <th className="text-right px-4 py-3">Ação</th>
            </tr>
          </thead>
          <tbody>
            {usuarios.map((u) => (
              <tr key={u.id} className="border-t border-slate-100">
                <td className="px-4 py-3 font-medium text-slate-800">{u.nome}</td>
                <td className="px-4 py-3 text-slate-600">{u.email}</td>
                <td className="px-4 py-3 text-slate-600">{u.cargo}</td>
                <td className="px-4 py-3">
                  <span className={u.ativo ? 'text-emerald-700' : 'text-slate-400'}>
                    {u.ativo ? 'Ativo' : 'Inativo'}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  <button
                    type="button"
                    onClick={() => void alternarStatus(u)}
                    disabled={u.id === user?.id}
                    title={u.id === user?.id ? 'Você não pode desativar a sua própria conta' : undefined}
                    className="text-xs font-semibold text-slate-600 hover:text-slate-900 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {u.ativo ? 'Desativar' : 'Ativar'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal isOpen={modalAberto} onClose={() => setModalAberto(false)} title="Novo Usuário">
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <Input label="Nome" {...register('nome')} error={errors.nome?.message} />
          <Input label="E-mail" type="email" {...register('email')} error={errors.email?.message} />
          <Input label="Senha inicial" type="password" {...register('password')} error={errors.password?.message} />
          <div>
            <label className="block text-xs font-bold uppercase tracking-wide text-slate-500 mb-1">
              Papel
            </label>
            <select {...register('role')} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm">
              <option value="operador">Operador — Analista Fiscal</option>
              <option value="admin">Admin — Contador Sênior</option>
            </select>
          </div>
          <Button type="submit" isLoading={salvando} className="w-full">
            {salvando ? 'Criando...' : 'Criar Usuário'}
          </Button>
        </form>
      </Modal>
    </div>
  );
};
```

- [ ] **Step 4: Add the route in `frontend/src/App.tsx`**

Importar a página junto dos outros imports lazy/estáticos e acrescentar a rota logo após a de `/templates`, dentro do mesmo `<Route>` pai:

```tsx
<Route
  path="/usuarios"
  element={
    <AdminRoute user={user}>
      <UsuariosPage user={user} />
    </AdminRoute>
  }
/>
```

- [ ] **Step 5: Add the sidebar entry in `frontend/src/components/layout/Sidebar.tsx`**

Acrescentar `Users` aos imports do `lucide-react` e um segundo `NavLink` dentro do `<nav className="space-y-1">` da Área Administrativa (linha ~111), depois do link de `/templates`:

```tsx
<NavLink
  to="/usuarios"
  onClick={onNavigate}
  className={({ isActive }) =>
    `flex items-center gap-3 px-3 py-2 rounded-lg text-xs font-semibold transition-all ${
      isActive
        ? 'bg-amber-50 text-amber-800 font-bold border-l-3 border-amber-600 shadow-xs'
        : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100/80'
    }`
  }
>
  <Users className="w-4 h-4 shrink-0 text-amber-600" />
  <span>Usuários</span>
</NavLink>
```

- [ ] **Step 6: Verify the build passes**

Run: `cd frontend && npm run build`
Expected: build sem erros de TypeScript

As props usadas acima foram conferidas contra os componentes reais:
`PageHeader` exige `icon` e usa `description` (não `subtitle`); `Button`
expõe `leftIcon` e `isLoading`; `Input` é `forwardRef` e aceita `label`/`error`,
por isso funciona com `{...register(...)}`; `Modal` usa `isOpen`/`onClose`/`title`.

- [ ] **Step 7: Run the full backend suite once more**

Run: `.venv/Scripts/python.exe -m pytest -q`
Expected: todos passando

- [ ] **Step 8: Commit**

```bash
git add frontend/src/types/usuario.ts frontend/src/api/usuarios.ts \
        frontend/src/pages/Usuarios/index.tsx frontend/src/App.tsx \
        frontend/src/components/layout/Sidebar.tsx
git commit -m "feat(usuarios): tela de gestao de usuarios na area administrativa"
```

---

## Verificação final (após as 4 tasks)

- [ ] Suíte completa passando: `.venv/Scripts/python.exe -m pytest -q`
- [ ] Build do frontend: `cd frontend && npm run build`
- [ ] Confirmar que `ENABLE_LOCAL_AUTH=false` segue definido no Production da Vercel — a spec trata isso como pré-requisito desta funcionalidade.
- [ ] Teste manual no navegador após o deploy: criar um operador, confirmar que ele loga, desativá-lo, confirmar que o login passa a falhar, reativá-lo.
