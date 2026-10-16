"""Mapping + freshness gate worker (tanpa MySQL)."""

from datetime import datetime, timedelta, timezone

from app.ingest_db import freshness as freshness_mod
from app.ingest_db import mapping as mapping_mod


def _sample(key, value, updated_at):
    return {"key": key, "value": value, "updated_at": updated_at}


def test_parse_decimal_variants():
    assert mapping_mod.parse_decimal("2,25") == 2.25
    assert mapping_mod.parse_decimal("1.234,56") == 1234.56
    assert mapping_mod.parse_decimal("38.0") == 38.0
    for token in ["", "NULL", "n/a", "-", "none"]:
        assert mapping_mod.parse_decimal(token) is None
    assert mapping_mod.parse_decimal("rusak") is None
    assert mapping_mod.parse_decimal(None) is None


def test_to_sensor_reading_uses_event_time_and_ignores_unknown():
    ts = datetime(2026, 10, 15, 15, 0, 5, tzinfo=timezone.utc)
    reading = mapping_mod.to_sensor_reading(
        [
            _sample("output_frequency", "38,0", ts),
            _sample("output_power", "150.5", ts),
            _sample("kolom_tak_dikenal", "999", ts),
        ],
        ts,
        {"output_frequency": "output_frequency", "output_power": "output_power"},
    )
    assert reading.timestamp == ts
    assert reading.output_frequency == 38.0
    assert reading.output_power == 150.5
    # Hilang = None, jangan 0.
    assert reading.motor_current is None


def test_freshness_gate_rejects_stale():
    base = datetime(2026, 10, 15, 15, 0, 5, tzinfo=timezone.utc)
    fresh = [_sample("a", "1", base), _sample("b", "2", base)]
    usable, latest, _ = freshness_mod.gate(fresh, 10.0)
    assert usable and latest == base
    stale = [
        _sample("a", "1", base),
        _sample("b", "2", base - timedelta(seconds=30)),
    ]
    usable, latest, _ = freshness_mod.gate(stale, 10.0)
    assert not usable and latest is None
    usable, _, _ = freshness_mod.gate([], 10.0)
    assert not usable
    usable, _, _ = freshness_mod.gate([_sample("a", "1", None)], 10.0)
    assert not usable
