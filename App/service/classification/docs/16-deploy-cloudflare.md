# 16 — Deploy Cloudflare Tunnel `classify-pump` (live 2026-10-07)

Mapping: `classify.aldozeno.my.id` → `localhost:3030` (frontend),
`class-api.aldozeno.my.id` → `localhost:3031` (backend, uvicorn workers 1).
Mesin 24/7 + linger aktif.

## Komponen
- `~/.cloudflared/config.yml` (tunnel `classify-pump`, catch-all 404)
- `backend/.env` (JANGAN commit; `CLASSIFICATION_API_KEY`)
- systemd user: `classify-pump-backend`, `classify-pump-frontend`
  (`CLASSIFICATION_BACKEND_URL=http://127.0.0.1:3031`), `classify-pump-tunnel`

## Operasi
- Status: `systemctl --user status classify-pump-{backend,frontend,tunnel}`
- Log: `journalctl --user -u classify-pump-tunnel -f`
- Restart: `systemctl --user restart classify-pump-{backend,frontend}`
- Rollback: `systemctl --user stop classify-pump-tunnel` (lokal tetap jalan)
- Frontend rebuild setelah update kode: `bun run build` di `frontend/`,
  lalu restart `classify-pump-frontend`
- Unit frontend: `SuccessExitStatus=143 SIGTERM` (stop saat restart bukan failure)

## Akses: PUBLIK penuh, tanpa Access (diputuskan 2026-10-07)

Tidak ada policy Zero Trust; kedua hostname terbuka internet. Endpoint sensitif
yang ikut terbuka (backend tanpa auth bawaan):
- `PUT /profile-setpoints/*` (mengubah acuan klasifikasi semua site)
- `POST /v1/classify` (bila `CLASSIFICATION_API_KEY` kosong)
Bila kelak perlu proteksi, opsi termurah: isi `CLASSIFICATION_API_KEY`.
Catatan refactor 2026-10-19: endpoint dokumen/upload/telemetry/classification
sudah dihapus (lihat `12` dan `20`).

## Verifikasi penerimaan
- `GET https://class-api.aldozeno.my.id/health` → `ok`
- `GET https://classify.aldozeno.my.id/documents` → 200 (halaman; API lama 404)
- `POST https://class-api.aldozeno.my.id/v1/classify` → 200
