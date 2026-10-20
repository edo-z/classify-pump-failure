# 16 — Deploy Cloudflare Tunnel `classify-pump` (live 2026-10-07; backend Node & landing 2026-10-20)

Mapping: `classify.aldozeno.my.id` → `localhost:3030` (**landing statis**),
`class-api.aldozeno.my.id` → `localhost:3031` (backend Node.js, 1 proses).
Mesin 24/7 + linger aktif.

## Komponen
- `~/.cloudflared/config.yml` (tunnel `classify-pump`, catch-all 404)
- `backend-node/.env.example` → `CLASSIFICATION_API_KEY` (JANGAN commit `.env` asli)
- `landing/` → halaman publik statis (`index.html`, `styles.css`, `app.js`, `serve.mjs`)
- `landing/data.json` → 9 contoh diagnosis + 8 aturan, digenerate dari golden suite backend
  (`node build-data.mjs`; `--check` memastikan tidak drift)
- systemd user:
  - `classify-pump-node` (`:3031`)
  - `classify-pump-landing` (static `:3030`)
  - `classify-pump-frontend` (**disabled** — app Next disimpan sebagai library)
  - `classify-pump-tunnel`

## Operasi
- Status: `systemctl --user status classify-pump-{node,landing,frontend,tunnel}`
- Log: `journalctl --user -u classify-pump-tunnel -f`
- Restart: `systemctl --user restart classify-pump-{node,landing}`
- Rollback landing → app: `systemctl --user stop classify-pump-landing`,
  `systemctl --user enable --now classify-pump-frontend` (tunnel tidak berubah)
- Update landing: ubah file di `landing/`; bila data/aturan berubah, jalankan
  `cd landing && node build-data.mjs`, lalu `systemctl --user restart classify-pump-landing`
- Cek sinkron data: `cd landing && node build-data.mjs --check`
- Frontend app (bila dihidupkan lagi): `bun run build` di `frontend/`,
  lalu restart `classify-pump-frontend`
- Unit frontend: `SuccessExitStatus=143 SIGTERM` (stop saat restart bukan failure)

## Akses: PUBLIK penuh, tanpa Access (diputuskan 2026-10-07)

Tidak ada policy Zero Trust; kedua hostname terbuka internet. Endpoint sensitif
yang ikut terbuka (backend tanpa auth bawaan):
- `PUT /profile-setpoints/*` (mengubah acuan klasifikasi semua site)
- `POST /classify` (bila `CLASSIFICATION_API_KEY` kosong)
Bila kelak perlu proteksi, opsi termurah: isi `CLASSIFICATION_API_KEY`.
Catatan refactor 2026-10-19: endpoint dokumen/upload/telemetry/classification
sudah dihapus (lihat `12` dan `20`).

## Verifikasi penerimaan
- `GET https://classify.aldozeno.my.id/` → 200 `text/html` (landing), judul
  “DEXMIN — Klasifikasi Gangguan Pompa”
- `GET https://classify.aldozeno.my.id/data.json` → 9 kasus, 8 aturan
- `GET https://classify.aldozeno.my.id/healthz` → `{"status":"ok","service":"landing"}`
- `GET https://class-api.aldozeno.my.id/health` → `ok`
- `POST https://class-api.aldozeno.my.id/classify` → 200
