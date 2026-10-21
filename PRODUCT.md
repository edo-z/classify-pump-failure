# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Teknisi lapangan pompa. Mereka memantau kondisi pompa (penggerak/VSD dan panel), menindaklanjuti gangguan yang terdeteksi, dan memeriksa bukti klasifikasi — sering dari perangkat bergerak dan kadang dari jaringan terbatas (tunnel/CDN).

## Product Purpose

Mengubah data sensor mentah pompa menjadi keputusan operasional yang bisa ditindaklanjuti teknisi: klasifikasi gangguan yang konsisten lewat landing statis dan API. Sukses = teknisi dapat memahami dan menindaklanjuti kondisi pompa dari satu sumber aturan.

## Positioning

Satu mesin aturan yang sama menilai semua data dan menampilkan ambang, contoh, serta bukti yang dapat diperiksa — tanpa penilaian ganda yang bertentangan.

## Operating Context

- Alur kerja: pilih contoh diagnosis di landing atau kirim `readings` ke `POST /classify`, lalu baca `trouble_type`, `matched_rules`, `sensor_snapshot`, dan `limitations`.
- Lingkungan: landing statis (`:3030`, di belakang tunnel Cloudflare) dan backend Node.js (`:3031`). Tidak ada aplikasi Next.js, chat, atau RAG.
- Ritual mutu: typecheck + backend tests + landing smoke + pemeriksaan generator sebelum deploy.

## Capabilities and Constraints

- Klasifikasi 9 hasil: `pompa_tersangkut_sampah`, `turbulensi`, `banyak_sampah`, `unbalance`, `undervoltage`, `overvoltage`, `dry_run` (nama lama `low_water_menyala`), `panel_overheat`, `normal`.
- Ambang teknis lestari: undervoltage < 360 V, overvoltage > 410 V, panel overheat ≥ 60 °C, unbalance ≥ 10%, pompa tersangkut diputuskan langsung (frekuensi ≤ 10 Hz + minimal 3 dari 4 tanda lain).
- Data kosong tidak pernah diisi nol; waktu kejadian mengikuti data, bukan waktu terima.
- Landing: `/` diagnosis, `/aturan` aturan mentah + contoh 500/3000/5000 lps, `/data.json` data contoh, `/healthz` status.
- `/aturan` statis dan print-friendly; tabel menjadi kartu berlabel pada layar sempit.

## Brand Commitments

- Bahasa antarmuka: Indonesia.
- Gaya visual: profesional, tanpa ikon, terang saja (tanpa mode gelap).
- Nama lestari: "Dexmin", "Pump Classification PoC".

## Evidence on Hand

- Dataset: `Data/classification-input/raw/aldo_pump_logs_2.csv` (+ metadata/normalized).
- Dokumen manual pompa: `Docs/` (ATV610, ACS580/ACQ580, D32).
- Backend: golden suite + 400 kasus differential di `App/service/classification/backend-node/test/`.
- Landing: smoke test CI + generator `--check` untuk `data.json` dan `aturan.html`.
- API reference: `App/service/classification/docs/12-api-reference.md`.

## Product Principles

1. Satu aturan untuk semua jalur — tidak ada dua kebenaran.
2. Jujur soal data — kosong dilaporkan hilang, tidak ada smoothing yang menyesatkan.
3. Teknisi dulu — setiap tampilan harus menjawab "lalu saya harus apa?" dalam sekali pandang.
4. Ringkas dan tahan print — informasi penting tetap terbaca di layar sempit dan kertas.
5. Bukti di atas klaim — setiap perubahan dikunci typecheck, detector, test, dan smoke test terukur.
