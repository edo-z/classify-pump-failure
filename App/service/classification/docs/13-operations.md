# 13 — Panduan Operasional

## Menjalankan

```bash
PYTHONPATH=. venv/bin/python -m uvicorn app.main:app --host 0.0.0.0 --port 3031  # 3031
# tampilan
bun run dev   # 3030 teruskan /api/* → 127.0.0.1:3031
```

Konfigurasi aktif: `backend/.env.example` hanya berisi `CLASSIFICATION_API_KEY` (kosong = DEV terbuka; isi di produksi).

## Penyimpanan (MySQL)

Skema 7 tabel, relasi, seed gangguan, dan contoh query: `07-storage.md`. Sumber tunggal DDL: `Data/db-mysql/dexmin/dexmin.sql`. Schema dipertahankan sebagai kontrak arsitektur; implementasi ingestion Python (`app/ingest_db/`) **dihapus** pada refactor 2026-10-19. Ingestion Node.js dibangun pada tahap migrasi (`20-migrasi-nodejs.md`), termasuk pemakaian `CLASSIFICATION_DB_*`. Tidak ada perubahan pada database production.

Backend produksi jalan via systemd (`classify-pump-backend.service`, Restart=always). Jangan start manual via nohup — kalah balapan port. Restart resmi + audit hapus:

```bash
systemctl --user restart classify-pump-backend
journalctl --user -u classify-pump-backend --since "10 minutes ago" | grep -i delete
# INFO app.api.documents: DELETE /documents/X.csv -> 200|409
```

Hapus saat dokumen sedang dianalisis (telemetry/normalisasi/run/scan) ditolak `409`. pytest memakai folder tmp (`conftest.py`), tak pernah menyentuh data asli.

## Cek Kesehatan

```bash
curl -fsS http://127.0.0.1:3031/health | jq
# {status: ok|degraded, rules_exists, rules_loaded, rules_error}
```

Status `degraded` bila file aturan hilang/rusak (schema tanpa `tiers`) — health jujur, tidak selalu `ok`.

CORS backend: `allow_origins=["*"]` dengan `allow_credentials=False`, `allow_methods/headers=["*"]`.

Upload dibatasi 50MB (`413` bila lebih).

## Mengelola Acuan

Lewat halaman admin atau langsung:

```bash
curl -fsS http://127.0.0.1:3031/profile-setpoints | jq
curl -fsS -X PUT http://127.0.0.1:3031/profile-setpoints/5000_lps -H 'Content-Type: application/json' -d '{"frequency_hz":42,"rpm":1000,"torque":95}' | jq
```

## Level Catatan

Salah nilai → catatan ringan per data; tak terduga → catatan lengkap.
