# Classification Backend (FastAPI)

Entry: `app/main.py` (`FastAPI app`).
Run: `uvicorn app.main:app --port 3031`.
Port: API `3031`, frontend `3030`.
Env kanonis: `backend/.env.example` (`CLASSIFICATION_API_KEY`).
Health: `GET /health` → `{status ok|degraded, rules_exists, rules_loaded, rules_error}`.
Klasifikasi tim BE: `POST /classify` (single-shot, stateless; lihat `docs/18-integrasi.md`).
Acuan profil: `GET/PUT /profile-setpoints`.
Auth: header `X-API-Key` bila `CLASSIFICATION_API_KEY` di-set (401 bila salah).
Evidence: `app/classification/evidence.py` (trailing 31, gap 10s).
Setpoint: `setpoints.resolve_effective_setpoint` (override > profil).
Test: `venv/bin/python -m pytest -q` (termasuk golden fixtures `tests/golden/`).
Migrasi Node.js: `docs/20-migrasi-nodejs.md`.

> Refactor 2026-10-19: `data_pipeline`, `cli`, `ingest_db`, serta endpoint
> dokumen/normalisasi/telemetry/classification dihapus. Engine kini independen.
