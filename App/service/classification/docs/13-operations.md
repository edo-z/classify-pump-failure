# 13 — Panduan Operasional

## Menjalankan

```bash
PYTHONPATH=. venv/bin/python -m uvicorn app.main:app --host 0.0.0.0 --port 3031  # 3031
# tampilan
bun run dev   # 3030 teruskan /api/* → 127.0.0.1:3031
```

Pengaturan penyimpanan default portabel via `_default_data_dir`: `$XDG_DATA_HOME/agent-maintenance/<name>`, fallback `~/Documents/Agent-Maintenance/Data/<name>`; ENV tetap menang bila di-set. Kanonis: `backend/.env.example`:

```
CLASSIFICATION_INPUT_DIR=/home/aldo/Documents/Agent-Maintenance/Data/classification-input
CLASSIFICATION_NORMALIZED_DIR=/home/aldo/Documents/Agent-Maintenance/Data/classification-normalized
```

Data tersimpan: file mentah, info file, dan data siap nilai. Hapus file memindahkan semuanya ke `.trash/` (bisa dikembalikan manual), bukan unlink permanen — insiden 2026-10-12.

## Penyimpanan (MySQL)

Skema 7 tabel, relasi, seed gangguan, dan contoh query: `07-storage.md`. Sumber tunggal DDL: `Data/db-mysql/dexmin/dexmin.sql`. Koneksi via `CLASSIFICATION_DB_HOST/PORT/USER/PASSWORD/NAME` (default `127.0.0.1:3306`, db `dexmin`) di `backend/.env.example`.

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
