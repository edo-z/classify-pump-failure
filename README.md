# Classify Pump Failure

Klasifikasi gangguan pompa (penggerak/VSD dan panel) dari data sensor file CSV: 9 hasil (`pompa_tersangkut_sampah`, `turbulensi`, `banyak_sampah`, `unbalance`, `undervoltage`, `overvoltage`, `dry_run`, `panel_overheat`, `normal`) dari satu mesin aturan yang sama, plus asisten chat Dexmin untuk analisis.

## Struktur

```
App/service/classification/
  backend/   # FastAPI :3031 — klasifikasi single-shot BE (/classify)
  frontend/  # Next.js :3030 — dokumen, chat Dexmin, admin setpoint
  docs/      # 01-overview … 18-integrasi (arsitektur, kontrak, operasi, FMEA)
Data/        # CSV mentah + metadata/normalized (contoh: aldo_pump_logs_2.csv)
Docs/        # Manual pompa (ATV610, ACS580/ACQ580, D32)
PRODUCT.md   # Tujuan produk • DESIGN.md — sistem desain "Ruang Kontrol Tenang"
```

## Jalan cepat (lokal)

```bash
# backend
cd App/service/classification/backend
PYTHONPATH=. venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 3031

# frontend
cd ../frontend
bun install && bun run dev   # :3030, teruskan /api/* → :3031
```

Env kanonis: `backend/.env.example` (jangan commit `.env` asli).

## Untuk tim BE (integrasi klasifikasi)

Satu endpoint stabil, stateless, tanpa CSV: `POST /classify` — kirim `{profile_id, namespace, readings[1..40]}` → terima `{trouble_type, matched_rules, sensor_snapshot, limitations, evaluation_status}`. Wajib header `X-API-Key` bila `CLASSIFICATION_API_KEY` di-set. Panduan lengkap + contoh curl/Python/fetch: **`App/service/classification/docs/18-integrasi.md`** (skema interaktif: `/docs`).

## Ritual mutu

```bash
# backend
PYTHONPATH=. venv/bin/python -m pytest tests/ -q
# frontend
bun run typecheck && bun run check:deadcode && bun run build
bunx playwright test e2e/chat.spec.ts
```

## Operasi

Systemd user: `classify-pump-backend`, `classify-pump-frontend`, `classify-pump-tunnel` (Cloudflare). Detail: `docs/16-deploy-cloudflare.md`. Cek sehat: `GET /health` → `{status, rules_exists, rules_loaded, rules_error}`.
