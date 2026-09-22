import logging
import secrets
from typing import Optional

import httpx
from fastapi import APIRouter, Cookie, Depends, Header, HTTPException, Request, Response, status
from sqlalchemy.orm import Session

from app.core.config import settings
from app.constants import CARGO_POR_ROLE, ROLE_OPERADOR
from app.core.database import get_db
from app.core.security import (
    ACTIVE_DEV_TOKENS,
    LOCAL_REFRESH_TOKENS,
    LOCAL_USERS_FALLBACK,
    get_current_user as security_get_current_user,
    known_account_profile,
    reconcile_known_account,
)
from app.models.profile import Profile
from app.schemas.auth import AlterarSenhaRequest, LoginRequest, TokenResponse, UserOut
from app.services.supabase_admin import SupabaseAdminService

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/auth", tags=["Autenticação"])

# Teto do cache de tokens do fallback local (só ativo com ENABLE_LOCAL_AUTH).
MAX_ACTIVE_DEV_TOKENS = 512

REFRESH_COOKIE_NAME = "planaut_refresh"
# Restringe o envio do cookie às três rotas que precisam dele; ele não
# acompanha as requisições de negócio.
REFRESH_COOKIE_PATH = "/api/v1/auth"
REFRESH_COOKIE_MAX_AGE = 30 * 24 * 60 * 60


def _cookie_is_secure(request: Request) -> bool:
    """``Secure`` só sob https, senão o cookie nunca retorna em dev/testes.

    O esquema é lido de ``X-Forwarded-Proto`` quando presente: atrás do proxy
    da Vercel a aplicação enxerga http mesmo em uma conexão https.
    """
    encaminhado = request.headers.get("x-forwarded-proto", "")
    esquema = encaminhado.split(",")[0].strip() or request.url.scheme
    return esquema == "https"


def _set_refresh_cookie(response: Response, request: Request, token: str) -> None:
    response.set_cookie(
        REFRESH_COOKIE_NAME,
        token,
        max_age=REFRESH_COOKIE_MAX_AGE,
        path=REFRESH_COOKIE_PATH,
        httponly=True,
        secure=_cookie_is_secure(request),
        samesite="lax",
    )


def _clear_refresh_cookie(response: Response) -> None:
    response.delete_cookie(REFRESH_COOKIE_NAME, path=REFRESH_COOKIE_PATH)


def _sessao_encerrada(detail: str, status_code: int = status.HTTP_401_UNAUTHORIZED) -> HTTPException:
    """Erro que também apaga o cookie.

    Cookies gravados no ``Response`` injetado se perdem quando a rota levanta
    exceção, então o cabeçalho de expiração vai junto do próprio erro. Sem
    isso, o navegador reenviaria para sempre um cookie já inválido.
    """
    expirado = Response()
    _clear_refresh_cookie(expirado)
    return HTTPException(
        status_code=status_code,
        detail=detail,
        headers={"set-cookie": expirado.headers["set-cookie"]},
    )

USERS_DB = {
    "admin@contabilidade.com": {
        **LOCAL_USERS_FALLBACK["admin@contabilidade.com"],
        "valid_passwords": {"admin", "123456", "fiscal", "admin123"},
        "password": "admin",
    },
    "admin@codisplan.com": {
        **LOCAL_USERS_FALLBACK["admin@codisplan.com"],
        "valid_passwords": {"admin", "codisplan", "123456", "fiscal", "admin123"},
        "password": "admin",
    },
    "operador@contabilidade.com": {
        **LOCAL_USERS_FALLBACK["operador@contabilidade.com"],
        "valid_passwords": {"fiscal", "operador", "admin", "123456"},
        "password": "fiscal",
    },
}


def _user_out(profile: Profile) -> UserOut:
    return UserOut(
        id=str(profile.id),
        nome=profile.nome,
        email=profile.email,
        cargo=profile.cargo,
        role=profile.role,
    )


def _ensure_local_profile(db: Session, user: dict) -> Profile:
    profile = db.query(Profile).filter(
        (Profile.id == str(user["id"])) | (Profile.email == user["email"])
    ).first()
    if not profile:
        profile = Profile(
            id=str(user["id"]),
            email=user["email"],
            nome=user["nome"],
            cargo=user["cargo"],
            role=user["role"],
            ativo=True,
        )
        try:
            db.add(profile)
            db.commit()
            db.refresh(profile)
        except Exception:
            db.rollback()
            logger.warning("Perfil mantido em memória para ambiente local de desenvolvimento")
            profile = Profile(
                id=str(user["id"]),
                email=user["email"],
                nome=user["nome"],
                cargo=user["cargo"],
                role=user["role"],
                ativo=True,
            )
    elif reconcile_known_account(profile):
        try:
            db.commit()
            db.refresh(profile)
        except Exception:
            db.rollback()
            logger.warning("Falha ao realinhar perfil institucional local", exc_info=True)
    if not profile.ativo:
        raise HTTPException(status_code=403, detail="Conta de usuário inativa.")
    return profile



@router.post("/login", response_model=TokenResponse)
def login(
    payload: LoginRequest,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
):
    email = payload.email.strip().lower()

    if settings.SUPABASE_URL and settings.SUPABASE_KEY:
        auth_url = f"{settings.SUPABASE_URL.rstrip('/')}/auth/v1/token?grant_type=password"
        headers = {"apikey": settings.SUPABASE_KEY, "Content-Type": "application/json"}
        try:
            with httpx.Client(timeout=10.0) as client:
                # Nome próprio: ``response`` é o objeto injetado pelo FastAPI,
                # usado para gravar o cookie de sessão.
                resposta_auth = client.post(
                    auth_url,
                    json={"email": email, "password": payload.password},
                    headers=headers,
                )
        except httpx.HTTPError as exc:
            logger.warning("Supabase Auth indisponível: %s", exc)
            if not settings.local_auth_enabled:
                raise HTTPException(
                    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                    detail="Serviço de autenticação temporariamente indisponível.",
                )
        else:
            if resposta_auth.status_code == 200:
                data = resposta_auth.json()
                sb_user = data.get("user") or {}
                user_id = sb_user.get("id")
                token = data.get("access_token")
                if not user_id or not token:
                    raise HTTPException(status_code=502, detail="Resposta inválida do serviço de autenticação.")

                profile = db.query(Profile).filter(Profile.id == str(user_id)).first()
                account = known_account_profile(email) or {}
                if not profile:
                    metadata = sb_user.get("user_metadata") or {}
                    nome = account.get("nome") or metadata.get("nome") or email.split("@", 1)[0]
                    profile = Profile(
                        id=str(user_id),
                        email=email,
                        nome=str(nome)[:255],
                        cargo=account.get("cargo", CARGO_POR_ROLE[ROLE_OPERADOR]),
                        role=account.get("role", ROLE_OPERADOR),
                    )
                    db.add(profile)
                    try:
                        db.commit()
                        db.refresh(profile)
                    except Exception:
                        db.rollback()
                        logger.exception("Falha ao provisionar perfil autenticado")
                        raise HTTPException(status_code=500, detail="Não foi possível preparar o usuário.")
                elif reconcile_known_account(profile):
                    try:
                        db.commit()
                        db.refresh(profile)
                    except Exception:
                        db.rollback()
                        logger.exception("Falha ao realinhar perfil institucional")

                if not profile.ativo:
                    raise HTTPException(status_code=403, detail="Conta de usuário inativa.")

                refresh_token = data.get("refresh_token")
                if refresh_token:
                    _set_refresh_cookie(response, request, str(refresh_token))
                return TokenResponse(
                    access_token=token,
                    token_type="bearer",
                    expires_in=data.get("expires_in"),
                    user=_user_out(profile),
                )

            if not settings.local_auth_enabled:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="E-mail ou senha incorretos. Verifique suas credenciais de acesso.",
                )

    if not settings.local_auth_enabled:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Nenhum provedor de autenticação está disponível.",
        )

    user = USERS_DB.get(email)
    valid_passwords = user.get("valid_passwords", {user["password"]}) if user else set()
    if not user or not any(secrets.compare_digest(p, payload.password) for p in valid_passwords):
        raise HTTPException(status_code=401, detail="E-mail ou senha incorretos. Verifique suas credenciais de acesso.")

    profile = _ensure_local_profile(db, user)
    token = _emitir_token_local(str(profile.id))
    _set_refresh_cookie(response, request, _emitir_refresh_local(str(profile.id)))
    return TokenResponse(
        access_token=token,
        token_type="bearer",
        expires_in=None,
        user=_user_out(profile),
    )


def _emitir_token_local(profile_id: str) -> str:
    token = f"pat_{secrets.token_hex(32)}"
    # Cada login guardava mais um token para sempre. Como o mapa vive em
    # memória e nada o esvazia, o descarte dos mais antigos evita crescimento
    # ilimitado em processos de desenvolvimento longos.
    while len(ACTIVE_DEV_TOKENS) >= MAX_ACTIVE_DEV_TOKENS:
        ACTIVE_DEV_TOKENS.pop(next(iter(ACTIVE_DEV_TOKENS)), None)
    ACTIVE_DEV_TOKENS[token] = {"id": profile_id}
    return token


def _emitir_refresh_local(profile_id: str) -> str:
    refresh = f"patr_{secrets.token_hex(32)}"
    while len(LOCAL_REFRESH_TOKENS) >= MAX_ACTIVE_DEV_TOKENS:
        LOCAL_REFRESH_TOKENS.pop(next(iter(LOCAL_REFRESH_TOKENS)), None)
    LOCAL_REFRESH_TOKENS[refresh] = profile_id
    return refresh


@router.post("/refresh", response_model=TokenResponse)
def refresh(
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
    planaut_refresh: Optional[str] = Cookie(None),
):
    """Troca o refresh token do cookie por um novo access token.

    Não exige ``Authorization``: o motivo de existir é justamente o access
    token já ter expirado.
    """
    if not planaut_refresh:
        raise _sessao_encerrada("Sessão não encontrada. Faça login novamente.")

    if settings.local_auth_enabled and planaut_refresh in LOCAL_REFRESH_TOKENS:
        profile_id = LOCAL_REFRESH_TOKENS.pop(planaut_refresh)
        profile = _perfil_ativo_para_renovacao(db, profile_id)
        _set_refresh_cookie(response, request, _emitir_refresh_local(str(profile.id)))
        return TokenResponse(
            access_token=_emitir_token_local(str(profile.id)),
            token_type="bearer",
            expires_in=None,
            user=_user_out(profile),
        )

    if not (settings.SUPABASE_URL and settings.SUPABASE_KEY):
        raise _sessao_encerrada("Sessão não encontrada. Faça login novamente.")

    auth_url = f"{settings.SUPABASE_URL.rstrip('/')}/auth/v1/token?grant_type=refresh_token"
    headers = {"apikey": settings.SUPABASE_KEY, "Content-Type": "application/json"}
    try:
        with httpx.Client(timeout=10.0) as client:
            renovacao = client.post(
                auth_url,
                json={"refresh_token": planaut_refresh},
                headers=headers,
            )
    except httpx.HTTPError as exc:
        logger.warning("Supabase Auth indisponível ao renovar sessão: %s", exc)
        # Instabilidade de rede não é sessão inválida: manter o cookie deixa a
        # próxima tentativa funcionar sem obrigar um novo login.
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Serviço de autenticação temporariamente indisponível.",
        )

    if renovacao.status_code != 200:
        raise _sessao_encerrada("Sessão expirada. Faça login novamente.")

    dados = renovacao.json()
    novo_access = dados.get("access_token")
    usuario = dados.get("user") or {}
    user_id = usuario.get("id")
    if not novo_access or not user_id:
        raise _sessao_encerrada("Resposta inválida do serviço de autenticação.")

    profile = _perfil_ativo_para_renovacao(db, str(user_id))

    novo_refresh = dados.get("refresh_token")
    if novo_refresh:
        # O Supabase rotaciona o refresh a cada uso e invalida o anterior:
        # manter o antigo faria a renovação seguinte ser recusada como reuso.
        _set_refresh_cookie(response, request, str(novo_refresh))
    return TokenResponse(
        access_token=novo_access,
        token_type="bearer",
        expires_in=dados.get("expires_in"),
        user=_user_out(profile),
    )


def _perfil_ativo_para_renovacao(db: Session, profile_id: str) -> Profile:
    """Relê o perfil a cada renovação.

    Sem isso, desativar uma conta só teria efeito quando o access token
    corrente expirasse — e a renovação o prorrogaria indefinidamente.
    """
    profile = db.query(Profile).filter(Profile.id == profile_id).first()
    if not profile:
        raise _sessao_encerrada(
            "Usuário autenticado sem perfil autorizado no sistema.",
            status_code=status.HTTP_403_FORBIDDEN,
        )
    if not profile.ativo:
        raise _sessao_encerrada(
            "Conta de usuário inativa. Contate o administrador.",
            status_code=status.HTTP_403_FORBIDDEN,
        )
    return profile


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(
    response: Response,
    authorization: Optional[str] = Header(None),
    planaut_refresh: Optional[str] = Cookie(None),
):
    if authorization and authorization.startswith("Bearer "):
        ACTIVE_DEV_TOKENS.pop(authorization.split(" ", 1)[1].strip(), None)
    if planaut_refresh:
        LOCAL_REFRESH_TOKENS.pop(planaut_refresh, None)
        _revogar_sessao_supabase(planaut_refresh)
    _clear_refresh_cookie(response)
    return None


def _revogar_sessao_supabase(refresh_token: str) -> None:
    """Encerra a sessão no Supabase para o refresh token deixar de valer.

    Apenas limpar o cookie deixaria o token ativo do lado do Supabase até
    expirar — quem já o tivesse copiado continuaria renovando.
    """
    if not (settings.SUPABASE_URL and settings.SUPABASE_KEY):
        return
    try:
        with httpx.Client(timeout=5.0) as client:
            client.post(
                f"{settings.SUPABASE_URL.rstrip('/')}/auth/v1/logout",
                json={"refresh_token": refresh_token},
                headers={
                    "apikey": settings.SUPABASE_KEY,
                    "Content-Type": "application/json",
                },
            )
    except httpx.HTTPError:
        # O logout local não pode falhar porque o Supabase está fora do ar.
        logger.warning("Não foi possível revogar a sessão no Supabase", exc_info=True)


@router.get("/me", response_model=UserOut)
def get_current_user(current_user: Profile = Depends(security_get_current_user)):
    return _user_out(current_user)


@router.post("/alterar-senha")
def alterar_senha(
    payload: AlterarSenhaRequest,
    current_user: Profile = Depends(security_get_current_user),
    db: Session = Depends(get_db),
):
    if not current_user.ativo:
        raise HTTPException(status_code=403, detail="Conta de usuário inativa.")

    if payload.nova_senha == payload.senha_atual:
        raise HTTPException(
            status_code=400,
            detail="A nova senha deve ser diferente da senha atual.",
        )

    email = current_user.email.strip().lower()

    if settings.SUPABASE_URL and settings.SUPABASE_KEY and SupabaseAdminService.is_configured():
        auth_url = f"{settings.SUPABASE_URL.rstrip('/')}/auth/v1/token?grant_type=password"
        headers = {"apikey": settings.SUPABASE_KEY, "Content-Type": "application/json"}
        try:
            with httpx.Client(timeout=10.0) as client:
                res_check = client.post(
                    auth_url,
                    json={"email": email, "password": payload.senha_atual},
                    headers=headers,
                )
        except httpx.HTTPError as exc:
            logger.warning("Supabase Auth indisponível: %s", exc)
            if not settings.local_auth_enabled:
                raise HTTPException(
                    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                    detail="Serviço de autenticação temporariamente indisponível.",
                )
        else:
            if res_check.status_code == 200:
                SupabaseAdminService.update_password(str(current_user.id), payload.nova_senha)
                return {"message": "Senha alterada com sucesso."}
            elif not settings.local_auth_enabled:
                raise HTTPException(
                    status_code=400,
                    detail="A senha atual informada está incorreta.",
                )

    if not settings.local_auth_enabled:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Nenhum provedor de autenticação está disponível.",
        )

    user = USERS_DB.get(email)
    valid_passwords = user.get("valid_passwords", {user["password"]}) if user else set()
    if not user or not any(secrets.compare_digest(p, payload.senha_atual) for p in valid_passwords):
        raise HTTPException(status_code=400, detail="A senha atual informada está incorreta.")

    user["password"] = payload.nova_senha
    user.setdefault("valid_passwords", set()).add(payload.nova_senha)
    return {"message": "Senha alterada com sucesso."}

