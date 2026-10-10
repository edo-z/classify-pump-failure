# Classification Backend (FastAPI)

Entry: `app/main.py` (`FastAPI app`).
Run: `uvicorn app.main:app --port 3031`.
Port: API `3031`, frontend `3030`.
Env kanonis: `backend/.env.example` (storage).
CLI: `python -m app.cli ingest|normalize|classify`.
Health: `GET /health` → `{status ok|degraded, rules_exists, rules_loaded, rules_error}`.
v1 tim BE: `POST /v1/classify` (single-shot, stateless; lihat `docs/18-integrasi.md`).
Auth: header `X-API-Key` bila `CLASSIFICATION_API_KEY` di-set (401 bila salah).
Evidence: `app/classification/evidence.py` (trailing 31, gap 10s).
Setpoint: `setpoints.resolve_effective_setpoint` (override > profil).
Upload limit: 50MB (`POST /documents/upload` → 413 bila lebih).
Test: `TestClient(app)` smoke `/health`.
