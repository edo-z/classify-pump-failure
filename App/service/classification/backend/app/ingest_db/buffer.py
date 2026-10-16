"""Ring buffer 31 sampel per pompa (in-memory).

Polling boleh sering, tetapi buffer hanya menerima snapshot BARU:
append dilakukan hanya bila evaluated_at > evaluated_at terakhir
pompa tersebut (dedup event-time). Tanpa ini, duplikat measurement
masuk buffer dan MA/CMA (mis. TURBULENSI T_A) salah secara temporal.

Single-worker deployment constraint: buffer hidup di memori proses
worker. Bila nanti scale-out, pindahkan ke Redis/DB tanpa menyentuh
engine.
"""

from __future__ import annotations

from collections import deque
from datetime import datetime


class RingBuffer:
    def __init__(self, maxlen: int = 31):
        self._maxlen = maxlen
        self._readings: dict[int, deque] = {}
        self._last_ts: dict[int, datetime] = {}

    def append(self, pump_id: int, evaluated_at: datetime, reading) -> bool:
        """Tambahkan bila event-time lebih baru. Return True bila diterima."""
        last = self._last_ts.get(pump_id)
        if last is not None and evaluated_at <= last:
            return False
        buf = self._readings.get(pump_id)
        if buf is None:
            buf = deque(maxlen=self._maxlen)
            self._readings[pump_id] = buf
        buf.append(reading)
        self._last_ts[pump_id] = evaluated_at
        return True

    def trailing(self, pump_id: int) -> list:
        return list(self._readings.get(pump_id, []))

    def last_ts(self, pump_id: int) -> datetime | None:
        return self._last_ts.get(pump_id)
