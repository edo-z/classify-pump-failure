"""Kontrak GET /classification/tier-refs (keputusan produk #3)."""

from app.classification.tier_refs import load_tier_refs


def test_tier_refs_match_rules():
    refs = load_tier_refs()
    assert set(refs.tiers) == {"500", "3000", "5000"}
    t5000 = refs.tiers["5000"]
    assert (t5000.kw_ref, t5000.amp_ref) == (400.0, 867.0)
    assert t5000.dr_kw == 400.0 * 0.667
    assert t5000.dr_amp == 867.0 * 0.64
    assert t5000.t_kw == 400.0
    assert (t5000.t_window, t5000.t_threshold) == (30, 10.0)
    assert refs.tiers["500"].kw_ref == 75.0
    assert refs.tiers["3000"].kw_ref == 250.0
    assert (refs.capabilities.undervoltage_v, refs.capabilities.overvoltage_v) == (360.0, 410.0)
    assert refs.capabilities.unbalance_pct == 10.0
    assert refs.capabilities.panel_overheat_c == 60.0


def test_tier_refs_endpoint():
    from fastapi.testclient import TestClient

    from app.main import app

    r = TestClient(app).get("/classification/tier-refs")
    assert r.status_code == 200
    body = r.json()
    assert body["tiers"]["5000"]["dr_kw"] == 400.0 * 0.667
    assert body["capabilities"]["undervoltage_v"] == 360.0
