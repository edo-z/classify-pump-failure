# 16 — Deploy Cloudflare Tunnel `classify-pump` (live 2026-10-07)

Mapping: `classify.aldozeno.my.id` → `localhost:3030` (frontend),
`class-api.aldozeno.my.id` → `localhost:3031` (backend, uvicorn workers 1).
Mesin 24/7 + linger aktif.

## Komponen
- `~/.cloudflared/config.yml` (tunnel `classify-pump`, catch-all 404)
- `backend/.env` (JANGAN commit; storage dirs)
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
- `POST /documents/upload`, `DELETE /documents/*`
Bila kelak perlu proteksi, opsi termurah: API-key header di backend.

## Verifikasi penerimaan
- `GET https://class-api.aldozeno.my.id/health` → `ok`
- `GET https://classify.aldozeno.my.id/documents` → 200
- Upload CSV → 201 (batas 50MB)
