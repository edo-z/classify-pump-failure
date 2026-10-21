# 02 — Susunan Sistem

> Refactor 2026-10-19: backend Python dirampingkan menjadi **engine + API stateless**.
> Pipeline CSV/storage, CLI, dan DB ingest Python dihapus.
> Cutover 2026-10-20: implementasi berpindah ke **Node.js (TypeScript + Fastify)**;
> kode Python dihapus, perilakunya dibekukan sebagai fixture golden + differential.
> Detail migrasi: `20`.

## Struktur Program Backend

```
backend-node/src/
  server.ts                 # Titik masuk layanan web (Fastify)
  middleware/apiKey.ts      # Gerbang X-API-Key (exact-match exempt + timing-safe)
  api/
    classify.ts             # POST /classify (kontrak stabil)
    profileSetpoints.ts     # Baca/ubah acuan tiap pompa (merge semantics)
  engine/
    engine.ts               # Aturan penilaian (orkestrator)
    support.ts              # T_A MA30/CMA_n, freq_eq_2dp, helper
    evaluator.ts            # 8 aturan + panel/unbalance/voltage
    evidence.ts             # Trailing 31 pasca-gap
    models.ts               # Bentuk data masuk & keluar
    profiles.ts             # Kapasitas per profil
    setpoints.ts            # override > profil
    configuration-resolver.ts
    service.ts              # Factory getEngine()
    rules.json              # Batas tiap ukuran pompa + aturan tegangan
    pump_profiles.json      # Profil 500 / 3000 / 5000 lps
    profile_setpoints.json# Frekuensi / kecepatan / torsi per profil
  util/                     # format Python, timestamp ber-zona, JSON
```

## Struktur Tampilan (Frontend) — library, tidak dilayani

> Takedown 2026-10-20: app Next.js tidak lagi berjalan. Hostname publik
> `classify.aldozeno.my.id` dilayani **landing statis** (`landing/serve.mjs`).
> Kode `frontend/` disimpan utuh sebagai library/referensi dan dapat
> dihidupkan kembali lewat unit `classify-pump-frontend` (lihat `16`).

```
frontend/src/app/
  api.ts                  # Panggil layanan (/api/*)
  replay.ts               # 16 sinyal file, tampung, gambar
  page.tsx                # Alih → /documents
  documents/page.tsx      # Penilaian kelompok + pindai + grafik file
  chat/page.tsx           # Chat asisten Dexmin (SSE)
  admin/page.tsx          # Ubah acuan tiap profil
landing/
  index.html              # Halaman publik: lembar diagnosis + kontrak API
  styles.css · app.js     # Tampilan, pemilih kasus, widget status
  build-data.mjs          # Generate data.json dari rules + golden suite
  data.json               # 9 contoh diagnosis + 8 aturan (generated)
  build-rules.mjs         # Generate aturan.html semua tier + contoh (butuh deps backend)
  aturan.template.html    # Kerangka halaman aturan
  aturan.html             # Aturan & contoh 500/3000/5000 lps (generated)
  serve.mjs               # Static server stdlib (:3030)
```

> `/aturan` menyajikan aturan mentah dan contoh 500/3000/5000 lps; CI menjaga
> `aturan.html` tetap sinkron lewat `node build-rules.mjs --check`.
>
> Endpoint lama `/documents`, `/normalization`, `/telemetry`, `/classification/*`
> sudah dihapus. Halaman `/documents` (bila app dihidupkan lagi) akan gagal
> sampai frontend disesuaikan.

## Modul & Tanggung Jawab

| Modul | Peran | Batasan |
|-------|-------|---------|
| `classification` | Data → hasil (pembacaan terakhir; data hilang = tidak terdeteksi + catatan) | Tidak tahu tampilan/disk/DB |
| `api/classify` | Penghubung web single-shot | Tidak mengandung logika aturan |
| `api/profile_setpoints` | Baca/ubah acuan profil | Tidak mengandung logika aturan |
| `service.ts` | Factory `getEngine()` | Tanpa CSV/FS/MySQL; tanpa duplikasi rumus |

## Diagram Komponen

```mermaid
flowchart TB
    subgraph Backend
      API[POST /classify]
      Settings[/profile-setpoints/]
      Engine[Mesin Aturan]
    end
    subgraph Klien
      BE[Tim BE / MQTT mapper]
    end
    BE --> API --> Engine
    Settings --> Engine
```

Keterangan sederhana: JSON readings → aturan penilaian → jawaban JSON.
