"""Buffer dedup + resolve flowhead worker (tanpa MySQL)."""

from datetime import datetime, timedelta, timezone

from app.ingest_db import buffer as buffer_mod
from app.ingest_db import resolve as resolve_mod


def _reading(ts):
    from .conftest import make_reading

    return make_reading(ts)


def test_buffer_accepts_only_newer_event_time():
    buf = buffer_mod.RingBuffer(maxlen=31)
    t0 = datetime(2026, 10, 15, 15, 0, 0, tzinfo=timezone.utc)
    assert buf.append(12, t0, _reading(t0)) is True
    # Polling ulang tanpa data baru: DITOLAK (bukan sampel baru).
    assert buf.append(12, t0, _reading(t0)) is False
    assert buf.append(12, t0 - timedelta(seconds=5), _reading(t0)) is False
    t1 = t0 + timedelta(seconds=5)
    assert buf.append(12, t1, _reading(t1)) is True
    assert len(buf.trailing(12)) == 2
    # Pompa lain independen.
    assert buf.append(13, t0, _reading(t0)) is True


def test_buffer_maxlen_31():
    buf = buffer_mod.RingBuffer(maxlen=31)
    t0 = datetime(2026, 10, 15, 15, 0, 0, tzinfo=timezone.utc)
    for i in range(40):
        buf.append(12, t0 + timedelta(seconds=i), _reading(t0))
    assert len(buf.trailing(12)) == 31


def test_flowhead_to_profile_exact_and_digits():
    assert resolve_mod.flowhead_to_profile("3000_lps") == "3000_lps"
    assert resolve_mod.flowhead_to_profile("500") == "500_lps"
    assert resolve_mod.flowhead_to_profile(" 5000 ") == "5000_lps"
    assert resolve_mod.flowhead_to_profile("tak_dikenal") is None
    assert resolve_mod.flowhead_to_profile(None) is None
    assert resolve_mod.flowhead_to_profile("") is None
