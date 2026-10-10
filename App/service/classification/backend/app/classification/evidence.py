"""Single source of truth untuk semantik evidence event-time (FMEA F3, 5R Rawat).

Kontrak:
- EVIDENCE_MAXLEN = 31 (30 histori + current untuk T_A MA30)
- gap event-time memutus histori (tidak dicampur antar rezim)
- readings harus terurut timestamp menaik untuk build_trailing
- gap_policy: "fixed" (10s) atau "adaptive" (median*2)
"""

from __future__ import annotations

import logging
from datetime import datetime

logger = logging.getLogger(__name__)

EVIDENCE_MAXLEN = 31
LIVE_GAP_THRESHOLD_MS = 10000


def gap_exceeded(prev_ts: datetime, curr_ts: datetime, threshold_ms: float) -> bool:
    """True jika delta event-time > threshold. Gagal hitung -> False + log."""
    try:
        delta_ms = (curr_ts.timestamp() - prev_ts.timestamp()) * 1000
        return delta_ms > threshold_ms
    except Exception as exc:
        logger.debug("gap check failed: %s", exc)
        return False


def should_reset_on_gap(prev_ts: datetime, curr_ts: datetime, threshold_ms: float = LIVE_GAP_THRESHOLD_MS) -> bool:
    return gap_exceeded(prev_ts, curr_ts, threshold_ms)


def build_trailing_evidence(
    sorted_readings,
    idx: int,
    gap_threshold_ms: float = LIVE_GAP_THRESHOLD_MS,
    maxlen: int = EVIDENCE_MAXLEN,
):
    """Evidensi trailing ala live: mundur max `maxlen`, berhenti saat gap.

    Sama seperti live (deque maxlen 31 + clear saat delta > threshold):
    histori terputus pada kesenjangan, engine hanya menerima bukti pasca-gap.
    readings harus sudah terurut timestamp menaik.
    """
    trail = [sorted_readings[idx]]
    for j in range(idx - 1, max(-1, idx - maxlen), -1):
        try:
            delta_ms = (
                sorted_readings[j + 1].timestamp.timestamp()
                - sorted_readings[j].timestamp.timestamp()
            ) * 1000
        except Exception as exc:
            logger.debug("evidence trail timestamp read failed idx=%d: %s", j, exc)
            break
        if delta_ms > gap_threshold_ms:
            break
        trail.append(sorted_readings[j])
    trail.reverse()
    return trail


def compute_adaptive_gap_threshold_ms(sorted_epoch_ms: list[float]) -> float:
    """median(interval)*2, sama dengan logika replay_service + replay.ts.

    Dipindah ke sini agar replay backend/frontend memakai satu rumus.
    <2 sampel atau median<=0 -> 0 (tidak ada gap detection).
    """
    if len(sorted_epoch_ms) < 2:
        return 0
    intervals = [b - a for a, b in zip(sorted_epoch_ms, sorted_epoch_ms[1:])]
    intervals.sort()
    n = len(intervals)
    if n % 2 == 1:
        median = intervals[n // 2]
    else:
        median = (intervals[n // 2 - 1] + intervals[n // 2]) / 2
    return median * 2 if median > 0 else 0
