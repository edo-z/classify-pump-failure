# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Teknisi lapangan pompa. Mereka memantau kondisi pompa (penggerak/VSD dan panel) di lapangan, menindaklanjuti gangguan yang terdeteksi, dan bertanya-jawab dengan asisten Dexmin untuk menganalisis kondisi — sering dari perangkat bergerak dan kadang dari jaringan terbatas (tunnel/CDN).

## Product Purpose

Mengubah data sensor mentah pompa menjadi keputusan operasional yang bisa ditindaklanjuti teknisi: klasifikasi gangguan yang konsisten dari file/batch plus asisten chat Dexmin yang membantu analisis. Sukses = teknisi terbantu Dexmin dalam memahami dan menindaklanjuti kondisi pompa.

## Positioning

Satu mesin aturan yang sama menilai semua jalur data (tidak ada penilaian ganda yang bertentangan), digabung dengan asisten berpengetahuan RAG (Neo4j + Dexmin) yang menjelaskan hasil dalam bahasa teknisi.

## Operating Context

- Alur kerja: unggah CSV → siapkan data → pindai klasifikasi → lihat grafik per-sinyal + tabel kegagalan; atau chat dengan Dexmin (dengan/tanpa konteks dokumen).
- Lingkungan: frontend Next.js (:3030, production di belakang tunnel Cloudflare), backend klasifikasi FastAPI (:3031), model AI SSE (:4100, loopback saja), Neo4j.
- Ritual mutu: typecheck + knip + build hijau, E2E Playwright sebelum deploy.

## Capabilities and Constraints

- Klasifikasi 9 hasil: `pompa_tersangkut_sampah`, `turbulensi`, `banyak_sampah`, `unbalance`, `undervoltage`, `overvoltage`, `dry_run` (nama lama `low_water_menyala`), `panel_overheat`, `normal`.
- Ambang teknis lestari: undervoltage < 360 V, overvoltage > 410 V, panel overheat ≥ 60 °C, unbalance ≥ 10%, pompa tersangkut diputuskan langsung (frekuensi ≤ 10 Hz + minimal 3 dari 4 tanda lain).
- Data kosong tidak pernah diisi nol; waktu kejadian mengikuti data, bukan waktu terima.
- Chat: frontend hanya menampilkan; penilaian tugas model. Riwayat 10 turn di memori browser, dikirim ulang tiap turn (LLM stateless). SSE tanpa gzip (`compress: false`).
- Kontrak LLM: `delta {text}` → `done {session_id, model, model_actual, usage, reasoning_preview, ...}` → `error {message}`; semua kunci baru nullable.

## Brand Commitments

- Bahasa antarmuka: Indonesia.
- Gaya visual: profesional, tanpa ikon (monogram inisial bila perlu avatar), terang saja (tanpa mode gelap).
- Nama lestari: "Dexmin" (asisten), "Pump Classification PoC".

## Evidence on Hand

- Dataset: `Data/classification-input/raw/aldo_pump_logs_2.csv` (+ metadata/normalized).
- Dokumen manual pompa: `Docs/` (ATV610, ACS580/ACQ580, D32).
- E2E: `App/service/classification/frontend/e2e/` (chat, all-rules, voltage).
- API reference: `App/service/classification/docs/12-api-reference.md`.

## Product Principles

1. Satu aturan untuk semua jalur — tidak ada dua kebenaran.
2. Jujur soal data — kosong dilaporkan hilang, garis patah di grafik, tidak ada smoothing yang menyesatkan.
3. Teknisi dulu — setiap tampilan harus menjawab "lalu saya harus apa?" dalam sekali pandang.
4. Stabilitas eksplisit — stream ditutup bersih saat error, coba-lagi manual, tanpa zombie.
5. Bukti di atas klaim — setiap perubahan dikunci typecheck, detector, E2E, dan smoke test terukur.
