"""C3 — Prioritas setpoint tunggal: override > profil (FMEA F8)."""

import pytest

from app.classification.setpoints import resolve_effective_setpoint


def test_priority_order():
    sp = resolve_effective_setpoint("5000_lps", override_freq=43)
    assert sp.frequency == 43
    sp = resolve_effective_setpoint("5000_lps")
    assert sp.frequency == 40.0  # profil 5000_lps
    assert sp.rpm == 990
    assert sp.torque == 90


def test_reject_nonpositive_and_invalid():
    sp = resolve_effective_setpoint("5000_lps", override_freq=0)
    assert sp.frequency == 40.0
    sp = resolve_effective_setpoint("5000_lps", override_freq="abc")
    assert sp.frequency == 40.0


def test_unknown_profile_raises():
    with pytest.raises(KeyError):
        resolve_effective_setpoint("nope_lps")
