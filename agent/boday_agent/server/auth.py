from __future__ import annotations

import time
from collections.abc import Callable

import httpx
import jwt
from pydantic import BaseModel

_JWKS_ALGS = ("ES256", "RS256")


class User(BaseModel):
    id: str
    email: str | None = None


class AuthError(Exception):
    def __init__(self) -> None:
        super().__init__("unauthorized")


def is_owner(user: User, admin_email: str) -> bool:
    return user.email == admin_email


class TokenVerifier:
    def __init__(
        self,
        *,
        hs256_secret: str | None,
        jwks_get: Callable[[], dict] | None,
        issuer: str | None = None,
        now: Callable[[], int] | None = None,
    ):
        if jwks_get is None and not hs256_secret:
            raise ValueError("JWT verification is not configured")
        self.hs256_secret = hs256_secret
        self.jwks_get = jwks_get
        self.issuer = issuer
        self.now = now or (lambda: int(time.time()))

    def verify(self, header_value: str | None) -> User:
        try:
            token = _bearer_token(header_value)
            if self.jwks_get is not None:
                payload = self._decode_jwks(token)
            else:
                payload = jwt.decode(
                    token,
                    self.hs256_secret,
                    algorithms=["HS256"],
                    audience="authenticated",
                    issuer=self.issuer,
                    options={"verify_exp": False},
                )
            return _user(payload, self.now())
        except AuthError:
            raise
        except Exception:
            raise AuthError() from None

    def _decode_jwks(self, token: str) -> dict:
        header = jwt.get_unverified_header(token)
        alg = header.get("alg")
        if alg not in _JWKS_ALGS:
            raise AuthError()
        kid = header.get("kid")
        if not isinstance(kid, str) or not kid:
            raise AuthError()
        key = self._key_for(kid)
        if key is None:
            raise AuthError()
        return jwt.decode(
            token,
            key,
            algorithms=[alg],
            audience="authenticated",
            issuer=self.issuer,
            options={"verify_exp": False},
        )

    def _key_for(self, kid: str):
        assert self.jwks_get is not None
        key = _find_key(self.jwks_get(), kid)
        if key is not None:
            return key
        refresh = getattr(self.jwks_get, "refresh", None)
        if refresh is None:
            return None
        return _find_key(refresh(), kid)


def cached_jwks(
    url: str,
    *,
    ttl_s: float = 600,
    min_interval_s: float = 30,
    timeout_s: float = 3.0,
    get=None,
    clock: Callable[[], float] = time.monotonic,
) -> Callable[[], dict]:
    # "tried" is the last fetch attempt, failed or not. Attempts are at least
    # min_interval_s apart, so junk kids or a Supabase outage cannot turn each
    # request into a JWKS fetch.
    state: dict = {"data": None, "at": None, "tried": None}
    fetch = get or httpx.get

    def load() -> dict:
        now = clock()
        tried = state["tried"]
        if tried is not None and now - tried < min_interval_s:
            if state["data"] is None:
                raise AuthError()
            return state["data"]
        state["tried"] = now
        try:
            response = fetch(url, timeout=timeout_s)
            response.raise_for_status()
            data = response.json()
            if not isinstance(data, dict):
                raise ValueError("jwks was not an object")
        except Exception:
            if state["data"] is None:
                raise AuthError() from None
            return state["data"]
        state["data"] = data
        state["at"] = now
        return data

    def jwks() -> dict:
        cached = state["data"]
        fetched_at = state["at"]
        if cached is None or fetched_at is None or clock() - fetched_at >= ttl_s:
            return load()
        return cached

    def refresh() -> dict:
        return load()

    jwks.refresh = refresh  # type: ignore[attr-defined]
    return jwks


def _bearer_token(header_value: str | None) -> str:
    if not isinstance(header_value, str) or not header_value.startswith("Bearer "):
        raise AuthError()
    token = header_value[len("Bearer ") :]
    if not token or any(ch.isspace() for ch in token):
        raise AuthError()
    return token


def _user(payload: dict, now_s: int) -> User:
    sub = payload.get("sub")
    if not isinstance(sub, str) or not sub:
        raise AuthError()
    if payload.get("aud") != "authenticated":
        raise AuthError()
    exp = payload.get("exp")
    if isinstance(exp, bool) or not isinstance(exp, int | float) or exp <= now_s:
        raise AuthError()
    email = payload.get("email")
    if email is not None and not isinstance(email, str):
        raise AuthError()
    return User(id=sub, email=email)


def _find_key(jwks: dict, kid: str):
    keys = jwks.get("keys") if isinstance(jwks, dict) else None
    if not isinstance(keys, list):
        return None
    for entry in keys:
        if isinstance(entry, dict) and entry.get("kid") == kid:
            return jwt.PyJWK(entry).key
    return None
