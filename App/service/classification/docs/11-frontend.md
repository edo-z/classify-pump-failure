# 11 — Tampilan Landing

> 2026-10-21: aplikasi Next.js, direktori `frontend/`, dan unit
> `classify-pump-frontend` dihapus. Hostname publik
> `classify.aldozeno.my.id` hanya menyajikan **landing statis** (`landing/`).

## Halaman

- `/` — lembar diagnosis: pemilih kasus, bukti, dan kontrak API.
- `/aturan` — aturan mentah serta contoh 500/3000/5000 lps.
- `/data.json` — 9 contoh diagnosis + 8 aturan, hasil generate.
- `/healthz` — status server landing.

## Berkas

- `index.html` — halaman diagnosis.
- `aturan.template.html` → `aturan.html` — halaman aturan (generated).
- `styles.css`, `app.js` — tampilan dan interaksi diagnosis.
- `serve.mjs` — server statis stdlib, allowlist route, `:3030`.
- `build-data.mjs`, `build-rules.mjs` — generator data dan aturan.

## Aturan Tampilan

- Statis, tanpa framework; `/aturan` tidak memakai JavaScript klien.
- Mobile-first: tabel menjadi kartu berlabel pada lebar ≤640px.
- Print-friendly: tabel tidak overflow dan `details` sumber tetap terbaca.
- Warna dan tipografi mengikuti `DESIGN.md`.

## Update

```bash
cd App/service/classification/landing
node build-rules.mjs && node build-data.mjs
node build-rules.mjs --check && node build-data.mjs --check
systemctl --user restart classify-pump-landing
```
