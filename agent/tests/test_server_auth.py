import json

import httpx
import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import ec, rsa
from jwt.algorithms import ECAlgorithm, RSAAlgorithm

from boday_agent.server.auth import AuthError, TokenVerifier, User, cached_jwks, is_owner

# The plan's HS256 fixtures use a short secret. PyJWT 2.15 warns; the check is still real.
pytestmark = pytest.mark.filterwarnings("ignore::jwt.warnings.InsecureKeyLengthWarning")


def _hs(secret, **claims):
    body = {
        "sub": "user-1",
        "aud": "authenticated",
        "email": "bobo.borenstein@gmail.com",
        "exp": 9999999999,
        **claims,
    }
    return "Bearer " + jwt.encode(body, secret, algorithm="HS256")


def test_hs256_round_trip_and_owner_check():
    v = TokenVerifier(hs256_secret="test-secret", jwks_get=None)
    user = v.verify(_hs("test-secret"))
    assert user.id == "user-1" and is_owner(user, "bobo.borenstein@gmail.com")
    assert is_owner(User(id="user-1", email=None), "bobo.borenstein@gmail.com") is False
    assert is_owner(user, "Bobo.Borenstein@gmail.com") is False


def test_rejects_expired_audience_none_and_wrong_secret():
    v = TokenVerifier(hs256_secret="test-secret", jwks_get=None, now=lambda: 1_000)
    with pytest.raises(AuthError):
        v.verify(_hs("test-secret", exp=500))
    with pytest.raises(AuthError):
        v.verify(_hs("test-secret", aud="anon"))
    with pytest.raises(AuthError):
        v.verify(
            "Bearer "
            + jwt.encode(
                {"sub": "u", "aud": "authenticated", "exp": 9999999999},
                "",
                algorithm="none",
            )
        )
    with pytest.raises(AuthError):
        v.verify(_hs("other-secret"))
    with pytest.raises(AuthError):
        v.verify(None)
    with pytest.raises(AuthError):
        v.verify(_hs("test-secret", sub=""))


ISSUER = "https://example.supabase.co/auth/v1"


def _jwks_token(private_key, algorithm, kid, **claims):
    body = {
        "sub": "user-9",
        "aud": "authenticated",
        "email": "a@b.c",
        "exp": 9999999999,
        "iss": ISSUER,
        **claims,
    }
    return "Bearer " + jwt.encode(body, private_key, algorithm=algorithm, headers={"kid": kid})


def test_jwks_mode_accepts_es256_and_rs256_and_rejects_hs256():
    ec_key = ec.generate_private_key(ec.SECP256R1())
    ec_jwk = {**json.loads(ECAlgorithm.to_jwk(ec_key.public_key())), "kid": "ec1", "alg": "ES256"}
    rsa_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    rsa_jwk = {
        **json.loads(RSAAlgorithm.to_jwk(rsa_key.public_key())),
        "kid": "rs1",
        "alg": "RS256",
    }
    v = TokenVerifier(
        hs256_secret="test-secret",
        jwks_get=lambda: {"keys": [ec_jwk, rsa_jwk]},
        issuer=ISSUER,
    )
    assert v.verify(_jwks_token(ec_key, "ES256", "ec1")).id == "user-9"
    assert v.verify(_jwks_token(rsa_key, "RS256", "rs1")).id == "user-9"
    with pytest.raises(AuthError):
        v.verify(_hs("test-secret", iss=ISSUER))
    with pytest.raises(AuthError):
        v.verify(_jwks_token(ec_key, "ES256", "unknown-kid"))
    with pytest.raises(AuthError):
        v.verify(_jwks_token(ec_key, "ES256", "ec1", iss="https://evil.example/auth/v1"))


def test_cached_jwks_keeps_the_last_good_copy():
    calls = []
    clock = [0.0]

    def get(url, timeout):
        calls.append(url)
        if len(calls) == 2:
            raise httpx.ConnectError("down")
        return httpx.Response(
            200,
            json={"keys": [{"kid": str(len(calls))}]},
            request=httpx.Request("GET", url),
        )

    jwks = cached_jwks(
        "https://example.supabase.co/jwks",
        ttl_s=600,
        get=get,
        clock=lambda: clock[0],
    )
    assert jwks()["keys"][0]["kid"] == "1"
    assert jwks()["keys"][0]["kid"] == "1" and len(calls) == 1
    clock[0] = 601.0
    assert jwks()["keys"][0]["kid"] == "1" and len(calls) == 2
    jwks.refresh()
    assert jwks()["keys"][0]["kid"] == "3"
