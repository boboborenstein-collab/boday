from __future__ import annotations

import ipaddress
import socket
import threading
from collections.abc import Callable
from dataclasses import dataclass
from urllib.parse import urlsplit

import httpcore
import httpx

_NAT64 = (
    ipaddress.ip_network("64:ff9b::/96"),
    ipaddress.ip_network("64:ff9b:1::/48"),
)


class UrlRejected(Exception):
    def __init__(self) -> None:
        super().__init__("url rejected")


class ResponseTooLarge(Exception):
    def __init__(self) -> None:
        super().__init__("response too large")


@dataclass(frozen=True)
class PinnedUrl:
    base_url: str
    host: str
    port: int
    ip: str


def check_base_url(
    url: str,
    *,
    resolve: Callable[[str], list[str]],
    resolve_timeout_s: float = 2.0,
) -> PinnedUrl:
    try:
        parts = urlsplit(url)
        port = parts.port
    except ValueError:
        raise UrlRejected() from None
    if parts.scheme != "https" or parts.username is not None or parts.password is not None:
        raise UrlRejected()
    host = parts.hostname
    if not host or host.lower() == "metadata.google.internal" or host.isdigit():
        raise UrlRejected()
    if _is_ip(host):
        ips = [host]
    else:
        ips = _resolve(host, resolve, resolve_timeout_s)
    if not ips or any(not _allowed(ip) for ip in ips):
        raise UrlRejected()
    base_url = url[:-1] if url.endswith("/") else url
    return PinnedUrl(base_url=base_url, host=host, port=port or 443, ip=ips[0])


def default_resolve(host: str) -> list[str]:
    infos = socket.getaddrinfo(host, None, type=socket.SOCK_STREAM)
    return [item[4][0].split("%", 1)[0] for item in infos]


class _CappedStream(httpx.SyncByteStream):
    def __init__(self, inner: httpx.SyncByteStream, max_bytes: int):
        self._inner = inner
        self._max_bytes = max_bytes

    def __iter__(self):
        total = 0
        for chunk in self._inner:
            total += len(chunk)
            if total > self._max_bytes:
                raise ResponseTooLarge()
            yield chunk

    def close(self) -> None:
        self._inner.close()


class CappedTransport(httpx.BaseTransport):
    def __init__(self, inner: httpx.BaseTransport, max_bytes: int = 2_097_152):
        self._inner = inner
        self._max_bytes = max_bytes

    def handle_request(self, request: httpx.Request) -> httpx.Response:
        # Count plaintext bytes. A gzip body is decoded by httpx after this
        # transport returns, so a compressed bomb would skip the cap.
        request.headers["accept-encoding"] = "identity"
        response = self._inner.handle_request(request)
        encoding = (response.headers.get("content-encoding") or "identity").strip().lower()
        if encoding not in ("", "identity"):
            response.close()
            raise ResponseTooLarge()
        length = _content_length(response)
        if length is not None and length > self._max_bytes:
            response.close()
            raise ResponseTooLarge()
        response.stream = _CappedStream(response.stream, self._max_bytes)
        return response

    def close(self) -> None:
        self._inner.close()


class PinnedBackend(httpcore.NetworkBackend):
    def __init__(self, pinned: PinnedUrl):
        self.pinned = pinned
        self._inner = httpcore.SyncBackend()

    def connect_tcp(
        self,
        host: str,
        port: int,
        timeout: float | None = None,
        local_address: str | None = None,
        socket_options=None,
    ):
        if host != self.pinned.host or port != self.pinned.port:
            raise UrlRejected()
        return self._inner.connect_tcp(
            self.pinned.ip,
            port,
            timeout,
            local_address,
            socket_options,
        )

    def connect_unix_socket(self, path: str, timeout: float | None = None, socket_options=None):
        raise UrlRejected()

    def sleep(self, seconds: float) -> None:
        self._inner.sleep(seconds)


class PinnedHTTPTransport(httpx.HTTPTransport):
    def __init__(self, pinned: PinnedUrl):
        super().__init__()
        discarded = self._pool
        self._pool = httpcore.ConnectionPool(
            ssl_context=httpx.create_ssl_context(),
            network_backend=PinnedBackend(pinned),
        )
        discarded.close()


def pinning_transport(
    pinned: PinnedUrl,
    *,
    max_response_bytes: int = 2_097_152,
) -> httpx.BaseTransport:
    return CappedTransport(PinnedHTTPTransport(pinned), max_response_bytes)


def _is_ip(host: str) -> bool:
    try:
        ipaddress.ip_address(host)
    except ValueError:
        return False
    return True


def _resolve(host: str, resolve: Callable[[str], list[str]], timeout_s: float) -> list[str]:
    box: dict = {}

    def run() -> None:
        try:
            box["ips"] = resolve(host)
        except Exception as exc:
            box["err"] = exc

    thread = threading.Thread(target=run, daemon=True)
    thread.start()
    thread.join(timeout_s)
    if thread.is_alive() or "err" in box or not isinstance(box.get("ips"), list):
        raise UrlRejected()
    return box["ips"]


def _allowed(ip: object) -> bool:
    if not isinstance(ip, str):
        return False
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return False
    return all(_public(item) for item in _subjects(addr))


def _subjects(addr: ipaddress.IPv4Address | ipaddress.IPv6Address):
    if isinstance(addr, ipaddress.IPv4Address):
        return (addr,)
    if addr.ipv4_mapped is not None:
        return (addr.ipv4_mapped,)
    if addr.sixtofour is not None:
        return (addr.sixtofour,)
    if addr.teredo is not None:
        return addr.teredo
    packed = addr.packed
    for network in _NAT64:
        if addr in network:
            return (ipaddress.IPv4Address(packed[-4:]),)
    return (addr,)


def _public(addr: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    return bool(addr.is_global) and not bool(addr.is_multicast)


def _content_length(response: httpx.Response) -> int | None:
    raw = response.headers.get("content-length")
    if raw is None:
        return None
    try:
        return int(raw)
    except ValueError:
        return None
