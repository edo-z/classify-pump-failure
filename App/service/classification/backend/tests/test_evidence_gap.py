"""C1+C2 — Kontrak evidence tunggal (FMEA F3)."""

from datetime import timedelta

from app.classification.evidence import (
    EVIDENCE_MAXLEN,
    LIVE_GAP_THRESHOLD_MS,
    build_trailing_evidence,
    compute_adaptive_gap_threshold_ms,
    gap_exceeded,
)

from .conftest import make_reading, series_1s


def test_maxlen_is_31(base_ts):
    assert EVIDENCE_MAXLEN == 31
    assert LIVE_GAP_THRESHOLD_MS == 10000


def test_fixed_gap_cuts_trail(base_ts):
    readings = series_1s(base_ts, 32)
    # Tanpa gap: trail penuh 31 dari 32.
    assert len(build_trailing_evidence(readings, 31, 10000)) == 31
    # Sisip gap 11s sebelum sampel terakhir.
    gapped = list(readings)
    gapped[31] = make_reading(base_ts + timedelta(seconds=30 + 11))
    trail = build_trailing_evidence(gapped, 31, 10000)
    assert len(trail) == 1


def test_gap_boundary_ms(base_ts):
    assert gap_exceeded(base_ts, base_ts + timedelta(milliseconds=10000), 10000) is False
    assert gap_exceeded(base_ts, base_ts + timedelta(milliseconds=10001), 10000) is True


def test_adaptive_threshold():
    assert compute_adaptive_gap_threshold_ms([0, 1000, 2000, 3000]) == 2000
    assert compute_adaptive_gap_threshold_ms([0, 1000, 3000]) == 3000
    assert compute_adaptive_gap_threshold_ms([0]) == 0
    assert compute_adaptive_gap_threshold_ms([1000, 1000, 1000]) == 0
