from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime
from zoneinfo import ZoneInfo

from .models import Snapshot


@dataclass(frozen=True)
class Clock:
    now: datetime
    tz: ZoneInfo

    @property
    def local_now(self) -> datetime:
        return self.now.astimezone(self.tz)

    @property
    def today(self) -> date:
        return self.local_now.date()

    @property
    def today_str(self) -> str:
        return self.today.isoformat()

    @classmethod
    def from_snapshot(cls, snap: Snapshot) -> Clock:
        return cls(now=snap.now, tz=ZoneInfo(snap.timezone))
