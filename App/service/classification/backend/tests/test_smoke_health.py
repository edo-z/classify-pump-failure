"""C7 — Smoke API: /health jujur (rules klasifikasi)."""

from fastapi.testclient import TestClient

from app.main import app


def test_health_shape_and_honest_status():
    c = TestClient(app)
    r = c.get("/health")
    assert r.status_code == 200
    body = r.json()
    for key in ("status", "rules_exists", "rules_loaded", "rules_error"):
        assert key in body, f"missing {key}"
    assert body["rules_loaded"] is True
    assert body["status"] == "ok"
