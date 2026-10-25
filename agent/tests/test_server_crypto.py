import base64

import pytest

from boday_agent.server.crypto import DecryptError, Encryptor, encryptor_from_b64


def test_round_trip_is_bound_to_the_user_and_not_deterministic():
    enc = Encryptor(b"k" * 32)
    a = enc.encrypt("sk-ant-example", user_id="user-a")
    b = enc.encrypt("sk-ant-example", user_id="user-a")
    assert a != b
    assert enc.decrypt(a, user_id="user-a") == "sk-ant-example"
    assert "sk-ant-example" not in a


def test_wrong_user_tamper_and_version_fail_closed():
    enc = Encryptor(b"k" * 32)
    token = enc.encrypt("sk-ant-example", user_id="user-a")
    with pytest.raises(DecryptError, match="ciphertext rejected"):
        enc.decrypt(token, user_id="user-b")
    raw = bytearray(base64.b64decode(token))
    raw[-1] ^= 1
    with pytest.raises(DecryptError):
        enc.decrypt(base64.b64encode(bytes(raw)).decode(), user_id="user-a")
    raw = bytearray(base64.b64decode(token))
    raw[0] = 2
    with pytest.raises(DecryptError):
        enc.decrypt(base64.b64encode(bytes(raw)).decode(), user_id="user-a")


def test_key_length():
    with pytest.raises(ValueError):
        Encryptor(b"short")
    assert isinstance(encryptor_from_b64(base64.b64encode(b"k" * 32).decode()), Encryptor)
