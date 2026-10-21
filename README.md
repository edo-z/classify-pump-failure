# Classify Pump Failure

Klasifikasi gangguan pompa (penggerak/VSD dan panel) dari data sensor file CSV: 9 hasil (`pompa_tersangkut_sampah`, `turbulensi`, `banyak_sampah`, `unbalance`, `undervoltage`, `overvoltage`, `dry_run`, `panel_overheat`, `normal`) dari satu mesin aturan yang sama, plus asisten chat Dexmin untuk analisis.

## Struktur

```
App/service/classification/
  backend-node/  # Node.js (TypeScript + Fastify) :3031 — klasifikasi single-shot BE (/classify)
  landing/       # Halaman publik statis :3030 (diagnosis, aturan, status API)
  frontend/      # Library Next.js (app dinonaktifkan; kode disimpan utuh)
  docs/          # 01-overview … 20-migrasi-nodejs (arsitektur, kontrak, operasi, FMEA)
Data/        # CSV mentah + metadata/normalized (contoh: aldo_pump_logs_2.csv)
Docs/        # Manual pompa (ATV610, ACS580/ACQ580, D32)
PRODUCT.md   # Tujuan produk • DESIGN.md — sistem desain "Ruang Kontrol Tenang"
```

> Backend Python (FastAPI) dihapus pada cutover 2026-10-20; perilakunya dibekukan
> sebagai fixture golden + differential (`docs/20-migrasi-nodejs.md`).
> App frontend di-takedown pada 2026-10-20; hostname publik menyajikan landing.

## Jalan cepat (lokal)

```bash
# backend
cd App/service/classification
./run.sh   # node backend-node/src/server.ts → :3031

# landing (build-rules memakai engine backend-node)
cd landing && node build-rules.mjs && node build-data.mjs && node serve.mjs   # :3030

# frontend (library; opsional untuk pengembangan UI)
cd frontend && bun install && bun run dev
```

Env kanonis: `App/service/classification/backend-node/.env.example` (jangan commit `.env` asli).

## Untuk tim BE (integrasi klasifikasi)

Satu endpoint stabil, stateless, tanpa CSV: `POST /classify` — kirim `{profile_id, namespace, readings[1..40]}` → terima `{trouble_type, matched_rules, sensor_snapshot, limitations, evaluation_status}`. Wajib header `X-API-Key` bila `CLASSIFICATION_API_KEY` di-set. Panduan lengkap + contoh curl/Python/fetch: **`App/service/classification/docs/18-integrasi.md`**.

## Ritual mutu

```bash
# backend
cd App/service/classification/backend-node
npm ci && npm run typecheck && npm test
# landing
cd App/service/classification/landing
node --check serve.mjs && node --check app.js \
  && node --check build-rules.mjs && node build-rules.mjs --check \
  && node build-data.mjs --check
# frontend (library)
cd App/service/classification/frontend
bun run typecheck && bun run check:deadcode && bun run build
bunx playwright test e2e/chat.spec.ts
```

## Operasi

Systemd user: `classify-pump-node` (:3031), `classify-pump-landing` (:3030), `classify-pump-frontend` (disabled — library), `classify-pump-tunnel` (Cloudflare). Detail: `docs/16-deploy-cloudflare.md`. Cek sehat: `GET /health` → `{status, rules_exists, rules_loaded, rules_error, setpoints_exists, setpoints_loaded, setpoints_error}`.
