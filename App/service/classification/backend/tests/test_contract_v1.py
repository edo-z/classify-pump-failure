"""C8 — Kontrak v1 stabil untuk tim BE (apps/web, non-Python).

Mengunci: bentuk request/response /v1/classify, rules_version,
evidence trimming server-side, namespace isolation, dan gate API-key.
"""

from fastapi.testclient import TestClient

from app.main import app


def _window(n=5, freq=40.0, start_ts="2026-06-12T14:33:56+07:00"):
    from datetime import datetime, timedelta

    base = datetime.fromisoformat(start_ts)
    return [
        {
            "timestamp": (base + timedelta(seconds=5 * i)).isoformat(),
            "motor_speed": 990.0,
            "output_frequency": freq,
            "motor_current": 246.0,
            "motor_torque": 40.0,
            "output_power": 111.0,
            "input_voltage": 380.0,
            "ambient_temperature": 30.0,
            "control_board_temperature": 40.0,
            "inverter_temperature": 45.0,
        }
        for i in range(n)
    ]


def _post(client, body, headers=None):
    return client.post("/v1/classify", json=body, headers=headers or {})


def test_v1_happy_path_shape():
    c = TestClient(app)
    r = _post(c, {
        "profile_id": "5000_lps",
        "setpoint_freq": 40.0,
        "namespace": "96",
        "readings": _window(),
    })
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["profile_id"] == "5000_lps"
    assert body["namespace"] == "96"
    assert body["rules_version"] == "1.0"
    assert body["evidence_size"] == 5
    cls = body["classification"]
    assert cls["trouble_type"] in (
        "pompa_tersangkut_sampah", "turbulensi", "banyak_sampah",
        "unbalance", "undervoltage", "overvoltage", "dry_run",
        "panel_overheat", "normal",
    )
    assert isinstance(cls["matched_rules"], list)
    assert isinstance(cls["sensor_snapshot"], dict)
    assert isinstance(cls["limitations"], list)
    assert cls["evaluation_status"] in ("FULL", "PARTIAL", "INSUFFICIENT_DATA")


def test_v1_evidence_trimmed_server_side():
    c = TestClient(app)
    r = _post(c, {
        "profile_id": "5000_lps",
        "namespace": "96",
        "readings": _window(n=40),
    })
    assert r.status_code == 200, r.text
    assert r.json()["evidence_size"] <= 31


def test_v1_gap_resets_evidence():
    c = TestClient(app)
    w = _window(n=3)
    # Sisipkan gap 1 jam sebelum 2 sampel terakhir
    w[1]["timestamp"] = "2026-06-12T15:33:56+07:00"
    w[2]["timestamp"] = "2026-06-12T15:34:01+07:00"
    r = _post(c, {"profile_id": "5000_lps", "namespace": "96", "readings": w})
    assert r.status_code == 200, r.text
    assert r.json()["evidence_size"] == 2


def test_v1_rejects():
    c = TestClient(app)
    ok = {"profile_id": "5000_lps", "namespace": "96", "readings": _window()}
    assert _post(c, {**ok, "readings": []}).status_code == 422
    assert _post(c, {**ok, "readings": _window(n=41)}).status_code == 422
    naive = _window()
    naive[0]["timestamp"] = "2026-06-12T14:33:56"
    assert _post(c, {**ok, "readings": naive}).status_code == 422
    unknown = dict(ok, profile_id="nope_lps")
    assert _post(c, unknown).status_code == 404


def test_v1_api_key_gate(monkeypatch):
    import app.api_key as keymod

    c = TestClient(app)
    body = {"profile_id": "5000_lps", "namespace": "96", "readings": _window()}
    # Tanpa key di env: terbuka
    monkeypatch.delenv("CLASSIFICATION_API_KEY", raising=False)
    assert _post(c, body).status_code == 200
    # Dengan key: tanpa header -> 401, salah -> 401, benar -> 200
    monkeypatch.setenv("CLASSIFICATION_API_KEY", "be-secret-1")
    assert _post(c, body).status_code == 401
    assert _post(c, body, {"X-API-Key": "salah"}).status_code == 401
    assert _post(c, body, {"X-API-Key": "be-secret-1"}).status_code == 200
    # Health tetap terbuka
    assert c.get("/health").status_code == 200
    monkeypatch.delenv("CLASSIFICATION_API_KEY", raising=False)
