# 15 — FMEA Hasil Test Tahap 2 + Analisa RCEA

Tanggal: 2026-10-07. Unit: **19/19 PASSED** (`backend/tests`, 0.26s).
E2E 2026-10-07: G8 MQTT live **ALL PASS**; Playwright **7/7 PASSED** (rerun penuh).
Skala: S Severity 1-10, O Occurrence sisa 1-10, D Detection 1-10 (10 = tak terdeteksi). RPN = S×O×D.
RCEA = Root Cause + Effects Analysis (akar + dampak + aksi).

> Amendemen 2026-10-10: jalur live/MQTT/replay/dummy dihapus total (kode +
> endpoint + uji + halaman). Baris F1, F6–F8 di bawah adalah **arsip historis**
> 2026-10-07; kontrol penggantinya ada di §4. Penilaian FMEA pasca-hapus ada di §5.

## 1. FMEA per area uji (urut RPN sisa tertinggi)

| # | Area / Test | Hasil | Failure mode yang dicegah | S | O | D | RPN | Status |
|---|---|---|---|---|---|---|---|---|
| F1 | E2E broker + Playwright **dieksekusi 2026-10-07** | — | Alarm live hilang / UI salah render lolos ke produksi | 9 | 2 | 3 | **54** | TERKUNCI (G8 ALL PASS, Playwright 7/7; sisa flaky paralel → RCEA-1b) |
| F2 | Konkurensi namespace engine (`test_engine_concurrency.py`, 3 test) | 3/3 hijau | Counter bocor antar-site (bug F2 lama) | 9 | 1 | 2 | **18** | TERKUNCI (exact-count 8 thread, reset, classify paralel A–D) |
| F3 | Turbulensi 31 kontigu (4 test + parametrized 500/3000) | hijau | `NO_MATCH` palsu / false alarm aliran | 9 | 1 | 2 | **18** | TERKUNCI |
| F4 | Voltage boundary (3 test + parametrized 500/3000, ambang dari rules) | hijau | Salah vonis under/over (matikan pompa sia-sia) | 9 | 1 | 2 | **18** | TERKUNCI |
| F5 | DRY_RUN 2 desimal (3 test + parametrized 500/3000, ref dinamis) | hijau | `dry_run` salah karena rounding float | 9 | 1 | 2 | **18** | TERKUNCI |
| F6 | Setpoint resolver + wiring 3 jalur (`test_setpoints_priority` + `test_setpoint_wiring`) | 6/6 hijau | Setpoint salah level → misdiagnosis massal | 9 | 1 | 1 | **9** | TERKUNCI |
| F7 | Evidence gap fixed/adaptive (4 test) | 4/4 hijau | `run ≠ scan ≠ live` untuk data sama | 8 | 2 | 2 | **32** | TERKUNCI |
| F8 | Smoke `/health` + `/mqtt/status` (2 test) | 2/2 hijau | Monitoring buta (MQTT mati dikira normal) | 7 | 2 | 2 | **28** | TERKUNCI |

\* F2: isolasi namespace dibuktikan smoke manual tahap P0-2 (counter A/B terpisah), belum jadi pytest.

## 2. RCEA top-3

### RCEA-1 — F1 (RPN 432→54): E2E live + UI dieksekusi 2026-10-07

Hasil: `scripts/e2e_mqtt_live.py` **ALL G8 PASS** (under 355 MATCH, 360 boundary bersih,
over 420 MATCH, unbalance, CONFIG_REQUIRED 999, heartbeat 15s, fan-out 2 klien);
Playwright **7/7 PASSED** pada rerun penuh (`ui-voltage` T1–T5, `ui-all-rules` T1–T2).
Infra: broker `eclipse-mosquitto:2` via docker :1883, backend venv baru
(`backend/venv`, sesuai `run.sh` + spec), frontend `next start` :3030 (prod build),
Chromium headless-shell.

Temuan env saat eksekusi (diperbaiki saat itu juga):
1. `backend/venv` tidak ada (spec hardcode path tsb) → dibuatkan venv asli + `venv/` ditambah ke `.gitignore`.
2. Seed `aldo_pump_logs_2.csv` tidak ada di repo → di-seed via API dari fixture (rekomendasi: jadikan fixture seed permanen).
3. Spec pakai topik lama `dex/vsd/dc/*` di helper publish — mapper masih menerima (alias kompatibel), tapi disarankan migrasi ke topik kanonis.

### RCEA-1b — sisa flaky paralel (RPN 54): T3/T5 sempat merah, hijau saat isolasi & rerun
- **Efek:** sinyal palsu di CI (pekerja paralel berebut site 96 + broker yang sama).
- **5 Whys:** (1) Mengapa gagal berjamaah? worker paralel publish ke site 96 bersamaan.
(2) Mengapa site sama? kedua spec hardcode site 96. (3) Mengapa sensitif? SSE/assert timing 11–30s + state global.
(4) Mengapa tak deterministik? lolos isolasi, lolos rerun penuh. (5) Akar: tidak ada isolasi site antar-worker.
- **Korektif:** jalankan E2E serial (`--workers=1`) bila flaky muncul.
- **Preventif:** parameterisasi site per-worker (mis. site 96/97/98) + seed fixture masuk repo.

### RCEA-1c — temuan sampingan: Next dev-mode tak terhidrasi di env ini
- Gejala: `next dev` SSR tampil tapi efek/klik mati total (select kosong, upload disabled,
tombol tak mengubah state), tanpa error konsol; `next start` (prod build) normal.
- Akar kemungkinan: Turbopack dev + env ini (bukan bug aplikasi — tsc bersih, prod 7/7).
- **Preventif:** jalankan E2E melawan `next start` (prod build); catat di CI (job FE sudah pakai `typecheck`; tambah job E2E prod bila runner tersedia).

### RCEA-2 — F2 (RPN 216→18): test konkurensi ditulis 2026-10-07, TERKUNCI

`backend/tests/test_engine_concurrency.py`: hammer 8 thread × 250 update di 2 namespace
dengan CT raksasa (cap tak bisa sembunyikan lost-update) → hitungan persis per namespace,
namespace lain + legacy kosong tersentuh nol; reset concorrent → 0; classify paralel
4 namespace tanpa error. Aturan "setiap `count_trigger>1` baru wajib test konkurensi" tetap berlaku.

### RCEA-3 — F4/F5 (RPN 54→18): parametrized tier ditulis 2026-10-07, TERKUNCI

`backend/tests/test_engine_tiers.py` (2 profil × 3 test): ambang voltage dibaca dari
`capability_rules` (`threshold_v`), ref DRY dari rule POMPA se-tier (`0.667/0.64`),
T_KW + window/threshold T_A dari rule TURBULENSI se-tier, setpoint via
`resolve_effective_setpoint` (jalur produksi). Perubahan `rules.json` kini otomatis
menguji ulang — total suite **28/28 hijau**.

## 3. Tindak lanjut (masuk tahap 1 / backlog)
1. E2E live + Playwright saat infra siap → update tabel F1 jadi TERKUNCI.
2. `test_engine_concurrency.py` → kunci F2.
3. Parametrize tier 500/3000 (C4–C6) → tekan F4/F5 di bawah 30.
4. Frontend `replay.ts` gap formula → samakan uji dengan `compute_adaptive_gap_threshold_ms` (cegah drift browser vs backend).

## 4. Kontrol pengganti pasca-hapus (2026-10-10)

| Uji | Hasil |
|---|---|
| `pytest backend/tests` | **30/30 hijau** (0.30s) |
| `tsc --noEmit` | hijau (exit 0) |
| `knip --include files,dependencies` | bersih, tanpa sisa |
| `next build` | hijau; rute tinggal `/`, `/admin`, `/chat`, `/documents` |
| `rg` residu `mqtt|realtime|paho|1883|dex/vsd` di `backend/app|tests`, `frontend/src` | kosong |
| E2E Playwright | T1 dokumen (41 titik→8 kegagalan + assert API scan), T1/T2 voltage, T4 admin, chat — uji live/MQTT (T2 all-rules, T3/T5 voltage) dihapus bersama fiturnya |

## 5. FMEA residual pasca-hapus (2026-10-10, smoke live :3039)

Smoke: 6 endpoint hapus (`/mqtt/*`, `/realtime/*`) → **404**; alur
upload 201 → normalize/telemetry/run/scan/setpoints 200 → delete 200
(`run` = `dry_run/FULL`, `scan` = 3 titik/1 gagal); `/health` = `ok` tanpa key mqtt.

| # | Failure mode sisa | S | O | D | RPN | Status |
|---|---|---|---|---|---|---|
| N1 | Import modul terhapus tertinggal → boot gagal | 9 | 1 | 1 | **9** | TERKENDALI (grep + pytest + smoke boot) |
| N2 | Signature resolver tak cocok (`override` saja) | 8 | 1 | 1 | **8** | TERKENDALI (priority + wiring hijau) |
| N3 | Cek operasional lama (`mqtt_connected`, mosquitto) | 5 | 3 | 3 | **45** | TERKENDALI 2026-10-10 (restart prod: `/health` publik `ok` tanpa key mqtt; docs/16 updated) |
| N4 | Bookmark `/realtime` lama → 404 | 3 | 4 | 2 | **24** | DITERIMA (by design) |
| N5 | Coverage E2E live hilang | 6 | 2 | 4 | **48** | DITERIMA (disengaja; batch + chat coverage tetap) |
| N6 | CMA turbulensi: vonis dari histori tipis (false alarm naik) | 8 | 3 | 2 | **48** | TERKENDALI 2026-10-10 (rules 1.1; 5 uji CMA baru: CMA5/CMA1/boundary/zero-history + `ref_kind` di audit; contract test kunci `rules_version`) |

## 6. Amendemen 2026-10-11 — ekspansi e2e agentic (tester-army/e2e, model 9router/hermes)

Suite `frontend/tests-e2e/`: **10/10 hijau** (`readiness` 4, `reliability` 3,
`documents` 1, `five-s` 2). Playwright `e2e/` tak tersentuh; kedua runner hidup
berdampingan. Lokasi config: `frontend/e2e.config.ts` (bun; deps `e2e`, `ai@^7`,
`@ai-sdk/openai-compatible`, `@e2e-dev/web`, `zod`).

### 6.1 Settings optimal (diterapkan)

| Setting | Nilai | Alasan |
|---|---|---|
| `workers` | `1` | RCEA-1b: paralel berebut state global → flaky |
| `retries` | `1` | Retry murah (mereplay cache) |
| `cache` | `read-write` lokal (CI otomatis `read-only`) | Run ulang replay tanpa model call |
| `trace` / `video` | default (`retain-on-failure` / `off`) | Trace = sumber RCA; video on-demand |
| `app` | tanpa `command`, url `:3030` | Nempel systemd prod (RCEA-1c: lawan `next start`, bukan `next dev`) |
| `agents.default` | hermes + `context` kosakata app + `maxSteps/maxModelCalls: 12` + `judgmentTimeout: 120_000` | Cap biaya; hermes lambat di layar 200+ node (RCEA-5) |
| tag | `readiness`, `reliability`, `5s` | Run selektif (`--tag 5s`) |

### 6.2 FMEA suite agentic (urut RPN awal tertinggi)

| # | Failure mode | S/O/D | RPN | Mitigasi → RPN sisa | Status |
|---|---|---|---|---|---|
| E1 | Vonis 5S model false-positive gugurkan run | 5/6/5 | **150** | Gerbang = `expect` keras; penilaian report-only (`console.log` + triase §6.3) → 3/4/2 = **24** | TERKENDALI (terbukti: 3 temuan run-1 tertriase, run-2/3 hijau) |
| E5 | Interferensi run paralel (RCEA-1b terulang) | 7/5/4 | **140** | `workers: 1` → 5/2/2 = **20** | TERKENDALI |
| E3 | `responseFormat` tak didukung 9router/hermes (extract tanpa schema enforcement) | 5/6/4 | **120** | Skema sederhana + assert struktural + repair round bawaan → 4/4/3 = **48** | DIPANTAU (warning AI SDK tiap run) |
| E4 | Chat live bergantung stream `:4100` | 6/4/4 | **96** | five-s/chat hanya kirim + cek bubble user (tak tunggu stream) → 4/3/3 = **36** | TERKENDALI |
| E2 | `extract` STEP_TIMEOUT 30s (hermes lambat) | 4/7/3 | **84** | `judgmentTimeout: 120_000` → 3/3/2 = **18** | TERKENDALI (RCEA-5) |
| E7 | Cache replay basi | 5/3/5 | **75** | `--strict-cache` di CI (nanti) + `e2e cache clear` manual → 4/2/3 = **24** | DIPANTAU |
| E6 | Kuota 9router habis (`MODEL_PROVIDER_FAILED`) | 6/3/2 | **36** | Readiness+reliability 0-call; cache menekan panggilan → 6/2/2 = **24** | DIPANTAU |

### 6.3 RCEA-4 — triase 3 temuan 5S `/documents` (run-1, model)

1. "tombol unggah mati" → **BUKAN temuan**: `disabled={!file || uploading}` = by design (Seiketsu/disiplin). False positive model.
2. "label tombol unggah ganda" (label "Upload CSV" vs tombol "Upload") → pola standar label+aksi. **DITERIMA**.
3. "gaya label kartu beda dari preset dan tabel" → kabur, tanpa bukti node. **DITOLAK** (tak dapat diuji).
- Observasi sampingan (faktual, dari trace): console warning preload CSS `06fnbfe4aoybx.css` tak terpakai di `/documents`. Seiso minor. **DIPANTAU**.

### 6.4 RCEA-5 — `extract` STEP_TIMEOUT (E2, RPN 84→18)

- **5 Whys:** (1) Mengapa timeout? 1 model call >30s. (2) Mengapa lama? layar 206 node + 151 opsi dropdown. (3) Mengapa default 30s? `judgmentTimeout` default agent. (4) Mengapa tak terlihat di wiring? wiring hanya `generateText` (tanpa observasi layar). (5) Akar: budget judgment tak disesuaikan ke model lambat.
- **Korektif:** `judgmentTimeout: 120_000` di `agents.default`.
- **Preventif:** aturan "model baru wajib uji extract di layar terberat dulu" + catat warning `responseFormat` (E3) sebagai sinyal D.
