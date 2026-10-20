from __future__ import annotations

import httpx

from .base import Provider


def select_provider(
    local,
    fallback: Provider,
    *,
    health_timeout_s: float = 2.0,
    transport: httpx.BaseTransport | None = None,
) -> tuple[Provider, str]:
    """Pick the local OpenAI-compatible endpoint when it answers, else the fallback."""
    url = f"{local.base_url.rstrip('/')}/models"
    try:
        with httpx.Client(transport=transport, timeout=health_timeout_s) as client:
            response = client.get(url, headers=local.headers())
    except Exception as exc:
        return fallback, f"auto: local unreachable ({type(exc).__name__}) → fallback"
    if response.status_code != 200:
        reason = f"auto: local unreachable (HTTP {response.status_code}) → fallback"
        return fallback, reason
    return local, "auto: local reachable"
