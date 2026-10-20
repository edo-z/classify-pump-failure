# 13 — Panduan Operasional

## Menjalankan

```bash
# backend (Node.js + Fastify) — :3031
cd App/service/classification && ./run.sh
# atau langsung:
cd App/service/classification/backend-node && npm start

# tampilan
bun run dev   # 3030 teruskan /api/* → 127.0.0.1:3031
```

Runtime opsional: `HOST` (default `127.0.0.1`), `PORT` (default `3031`).
Konfigurasi aktif: `backend-node/.env.example` hanya berisi `CLASSIFICATION_API_KEY` (kosong = DEV terbuka; isi di produksi).

## Penyimpanan (MySQL)

Skema 7 tabel, relasi, seed gangguan, dan contoh query: `07-storage.md`. Sumber tunggal DDL: `Data/db-mysql/dexmin/dexmin.sql`. Schema dipertahankan sebagai kontrak arsitektur; implementasi ingestion Python (`app/ingest_db/`) **dihapus** pada refactor 2026-10-19. Ingestion Node.js dibangun pada tahap migrasi (`20-migrasi-nodejs.md`), termasuk pemakaian `CLASSIFICATION_DB_*`. Tidak ada perubahan pada database production.

Backend produksi jalan via systemd (`classify-pump-node.service`, Restart=always). Jangan start manual via nohup — kalah balapan port:

```bash
systemctl --user restart classify-pump-node
journalctl --user -u classify-pump-node --since "10 minutes ago"
```

Endpoint lama `/documents`, `/normalization`, `/telemetry`, `/classification/*` sudah dihapus (refactor 2026-10-19); hanya `POST /classify`, `GET/PUT /profile-setpoints`, dan `GET /health` yang tersisa.

## Cek Kesehatan

```bash
curl -fsS http://127.0.0.1:3031/health | jq
# {status: ok|degraded, rules_exists, rules_loaded, rules_error,
#  setpoints_exists, setpoints_loaded, setpoints_error}
```

Status `degraded` bila file aturan rusak (schema tanpa `tiers`) atau file setpoint tidak bisa di-parse — health jujur, tidak selalu `ok`.

CORS backend: `allow_origins=["*"]` dengan `allow_credentials=False`, `allow_methods/headers=["*"]`.

Batas body request 2MB (Fastify; lebih dari itu `413`).

## Mengelola Acuan

Lewat halaman admin atau langsung:

```bash
curl -fsS http://127.0.0.1:3031/profile-setpoints | jq
curl -fsS -X PUT http://127.0.0.1:3031/profile-setpoints/5000_lps -H 'Content-Type: application/json' -d '{"frequency_hz":42,"rpm":1000,"torque":95}' | jq
```

PUT bersifat **merge**: field yang tidak dikirim dipertahankan; kirim `null` eksplisit untuk menghapus satu field. Nilai harus finite dan ≥ 0 (`422` bila tidak).

## Level Catatan

Salah nilai → catatan ringan per data; tak terduga → catatan lengkap.
