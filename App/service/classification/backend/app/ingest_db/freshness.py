"""Freshness gate: tolak snapshot basi sebelum jadi SensorReading.

pump_realtimes menyimpan SATU baris per parameter dengan updated_at
masing-masing — "latest value" SQL belum tentu satu measurement cycle.
Parameter usable bila:  max(updated_at) - updated_at <= limit.
Bukan logic klasifikasi: hanya memastikan worker tidak memasukkan
nilai lama sebagai bagian snapshot baru.
"""

from __future__ import annotations

from datetime import datetime


def gate(
    samples: list,
    limit_seconds: float,
) -> tuple[bool, datetime | None, list]:
    """Kembalikan (usable, evaluated_at, usable_samples).

    evaluated_at = MAX(updated_at terpakai) = event-time snapshot.
    Kosong / ada updated_at None / selisih > limit -> tidak usable.
    """
    if not samples:
        return False, None, []
    stamps = []
    for s in samples:
        ts = s.get("updated_at") if isinstance(s, dict) else getattr(s, "updated_at", None)
        if ts is None:
            return False, None, []
        stamps.append(ts)
    latest = max(stamps)
    usable = [
        s
        for s, ts in zip(samples, stamps)
        if (latest - ts).total_seconds() <= limit_seconds
    ]
    if len(usable) != len(samples):
        return False, None, []
    return True, latest, usable
