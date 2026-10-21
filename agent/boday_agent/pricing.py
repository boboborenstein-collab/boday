from __future__ import annotations

from typing import NamedTuple

from boday_agent.providers.base import Usage


class ModelPrice(NamedTuple):
    input: float
    output: float
    cache_read: float
    cache_write: float


# USD per 1M tokens. Exact model IDs, never date-suffixed.
PRICES: dict[str, ModelPrice] = {
    "claude-haiku-5-5": ModelPrice(0.10, 0.50, 0.01, 0.125),
    "claude-sonnet-5-5": ModelPrice(2.00, 10.00, 0.20, 2.50),
    "claude-opus-5-5": ModelPrice(4.00, 20.00, 0.20, 5.00),
}


def cost_usd(model: str, usage: Usage) -> tuple[float, bool]:
    price = PRICES.get(model)
    if price is None:
        return (0.0, False)
    cost = (
        usage.input_tokens * price.input
        + usage.output_tokens * price.output
        + usage.cache_read_tokens * price.cache_read
        + usage.cache_write_tokens * price.cache_write
    ) / 1_000_000
    return (cost, True)
