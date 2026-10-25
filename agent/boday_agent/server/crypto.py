from __future__ import annotations

import base64
import os

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

_VERSION = 1
_NONCE_LEN = 12
_TAG_LEN = 16


class DecryptError(Exception):
    def __init__(self) -> None:
        super().__init__("ciphertext rejected")


class Encryptor:
    def __init__(self, key: bytes):
        if len(key) != 32:
            raise ValueError("key must be 32 bytes")
        self._aes = AESGCM(key)

    def encrypt(self, plaintext: str, *, user_id: str) -> str:
        nonce = os.urandom(_NONCE_LEN)
        sealed = self._aes.encrypt(nonce, plaintext.encode(), user_id.encode())
        blob = bytes([_VERSION]) + nonce + sealed
        return base64.b64encode(blob).decode("ascii")

    def decrypt(self, ciphertext: str, *, user_id: str) -> str:
        try:
            raw = base64.b64decode(ciphertext, validate=True)
            if len(raw) < 1 + _NONCE_LEN + _TAG_LEN or raw[0] != _VERSION:
                raise ValueError("bad blob")
            nonce = raw[1 : 1 + _NONCE_LEN]
            sealed = raw[1 + _NONCE_LEN :]
            plain = self._aes.decrypt(nonce, sealed, user_id.encode())
            return plain.decode()
        except Exception:
            raise DecryptError() from None


def encryptor_from_b64(value: str) -> Encryptor:
    key = base64.b64decode(value, validate=True)
    return Encryptor(key)
