# Baseline Smoke Test Ingest-Only — Live `dexmin` (2026-10-16)

Cakupan: worker membaca telemetry MySQL, menjalankan klasifikasi,
menulis `raw_classifications`, mencegah duplikat. Ingest-only:
tanpa debounce, tanpa `pump_classifications`, tanpa ubah rumus,
tanpa production.

## 1. Expected vs Actual

| Gerbang | Expected | Actual | Status |
|---|---|---|---|
| Precheck struktur | 5 tabel migrasi, 0 baris operasional | 5 tabel, 0/0/0/0/9 | Lulus |
| Dry-run live (0 pompa) | `seen=0`, 0 tulis (ekspektasi: `1146 flowheads` karena tanpa telemetry) | `1146`, raw tetap 0 | Lulus (jujur: koneksi OK, klasifikasi tak terjadi) |
| Fixture | stub 3 tabel + pompa 900012 (A lengkap) / 900013 (B pincang) | sesuai, tercatat | Lulus |
| Smoke poll 1 (t0) | 18 baris | 18 | Lulus |
| Smoke poll 2 (t0+5s) | 36 total | 36 | Lulus |
| Smoke poll 3 (ts sama, proses sama) | tetap 36 + alasan `duplicate` | 36 + `[(900012,'duplicate'),(900013,'duplicate')]` | Lulus |
| A dry_run | MATCH ×2 | 2 | Lulus |
| A normal | FALSE | 0 | Lulus |
| B normal | FALSE + `incomplete=TRUE`, `motor_torque` di missing | sesuai | Lulus |
| Cleanup | hanya baris smoke + drop 3 stub | after ≡ before (data) | Lulus |
| Suite | hijau | **76 passed** | Lulus |

Identitas smoke: range ID `900012/900013` (worker menulis
`namespace=str(pump_id)`; format namespace tak diubah agar scope tetap).

## 2. FMEA residual (RPN = S×O×D, setelah kontrol)

| Risiko | S | O | D | RPN | Kontrol yang terbukti |
|---|---|---|---|---|---|
| F4 dedup gagal | 7 | 2 | 4 | 56→**28** | satu sesi + asersi 36-tetap + alasan skip |
| F2 fixture salah | 6 | 3 | 3 | 54→**27** | skenario A/B terkunci + asersi per-slug |
| F5 incomplete tak tercatat | 8 | 2 | 3 | 48→**24** | asersi `incomplete` + `missing_fields` |
| F1 write bocor dry-run | 9 | 2 | 2 | 36→**18** | test anti-tulis + rollback + default SELECT-only |
| F3 salah target DB | 9 | 1 | 4 | 36→**18** | gate `WRITE_ENABLED` + allowlist + stop-tanpa-hapus |
| F6 scratch tak dibersihkan | 4 | 2 | 5 | 40→**20** | cleanup eksplisit + snapshot identik |

F3 tetap safety-critical (S=9): tak ada insiden; satu-satunya tulis live
adalah smoke di atas, dengan izin sementara yang sudah dicabut
(default `WRITE_ENABLED=false`, tanpa env tersisa).

## 3. Delta schema resmi vs before

Satu-satunya: `pumps.flowhead_id BIGINT UNSIGNED NULL` —
dipertahankan RESMI (adendum `Data/db-mysql/dexmin/05_pump_flowhead_link.sql`).
Alasan: dibutuhkan JOIN reader (`reader.py:52`), production `pumps`
memilikinya, 0 baris saat diterapkan. Live akhir: 5 tabel migrasi,
0 baris operasional, 9 seed kategori.

## 4. Yang belum dibuktikan (blokir berikutnya)

Klasifikasi atas telemetry operasional lapangan (butuh akses read-only
8.4.x): discovery Q1–Q5, dry-run 1–2 pompa, MA/CMA 31-sampel penuh.
Debounce/event, migrasi production, admin API/UI: di luar scope.
