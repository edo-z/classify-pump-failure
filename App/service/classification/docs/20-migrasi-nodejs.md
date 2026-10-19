# 20 — Migrasi Klasifikasi Python → Node.js

> 5R Rawat — dokumen payung migrasi. Refactor Python (2026-10-19) menjadikan
> backend Python **engine independen**: lepas dari pipeline CSV, storage, CLI,
> dan DB ingest. Pekerjaan backend Node.js dibangun pada tahap berikutnya.

## Ringkasan Keputusan

- **Satu engine, satu algoritma.** Tidak boleh ada dua implementasi rumus yang berbeda.
- Perilaku Python dibekukan menjadi **golden fixtures** (`backend/tests/golden/`)
  sebagai kontrak kesetaraan.
- Kontrak integrasi aktif setelah refactor: `POST /classify`,
  `/profile-setpoints`, `GET /health`.
- Schema MySQL 7 tabel (`07-storage.md`, `dexmin.sql`) **tetap** kontrak
  arsitektur DEXMIN; yang dihapus hanyalah *implementasi* ingestion Python.

## Arsitektur Python Setelah Refactor

```text
backend/
├── app/
│   ├── main.py                     # FastAPI: /classify, /profile-setpoints, /health
│   ├── api_key.py                  # middleware X-API-Key
│   ├── api/
│   │   ├── classify.py            # kontrak stabil single-shot
│   │   └── profile_setpoints.py    # acuan per profil
│   └── classification/             # ENGINE (yang dimigrasikan)
│       ├── engine.py               # orkestrator RulesEngine
│       ├── engine_support.py       # T_A (MA30/CMA_n), freq_eq_2dp, helper
│       ├── evaluator.py            # 8 aturan + panel/unbalance/voltage
│       ├── evidence.py             # trailing 31 pasca-gap
│       ├── models.py               # model Pydantic
│       ├── profiles.py             # capacity_lps per profil
│       ├── setpoints.py            # resolve override > profil
│       ├── configuration_resolver.py
│       ├── service.py              # factory get_engine() → engineFactory.js
│       ├── rules.json              # ambang & aturan (sumber tunggal)
│       ├── pump_profiles.json      # profil 500/3000/5000
│       └── profile_setpoints.json  # setpoint default per profil
├── tests/                          # termasuk tests/golden/ (oracle)
├── requirements.txt
└── README.md
```

Yang **dihapus** dari Python: `app/data_pipeline/`, `app/cli/`, `app/ingest_db/`,
router `documents`/`normalization`/`telemetry`/`classification`, dan
`app/classification/tier_refs.py`.

## Target Arsitektur Node.js (usulan)

```text
backend-node/            # atau packages/classification-engine
├── src/
│   ├── engine/          # padanan app/classification/
│   │   ├── engine.js        # engineFactory
│   │   ├── evaluator.js     # 8 aturan (persamaan identik)
│   │   ├── evidence.js      # trailing 31 pasca-gap
│   │   ├── support.js       # MA30/CMA_n, freq eq 2dp
│   │   └── rules.json       # SALINAN identik (hash sama)
│   ├── api/             # /classify, /profile-setpoints, /health
│   ├── ingest/          # DB ingestion MySQL (tahap migrasi, pengganti ingest_db)
│   └── server.js
└── test/
    └── golden/          # mengonsumsi tests/golden milik Python
```

## Kontrak JSON Input

Identik dengan `/classify` (lihat `18-integrasi.md`): `profile_id`,
`setpoint_freq` (opsional), `namespace`, `readings` (1–40, urut bebas,
`timestamp` wajib ber-zona waktu).

## Kontrak JSON Output — Target Node.js

```json
{
  "profile_id": "3000_lps",
  "namespace": "12",
  "classification": {
    "trouble_type": "dry_run",
    "timestamp": "2026-10-19T10:00:00+07:00",
    "matched_rules": [
      {
        "trouble_type": "dry_run",
        "matched_conditions": [
          "Frekuensi sesuai setpoint",
          "Daya di bawah batas dry run",
          "Arus di bawah batas dry run",
          "Torsi di bawah 70%"
        ],
        "total_conditions": 4
      }
    ],
    "sensor_snapshot": {
      "output_frequency": 38.0,
      "output_power": 150.0,
      "motor_current": 300.0,
      "motor_torque": 60.0
    },
    "readings_count": 1
  }
}
```

## Perbedaan Kontrak: Aktual (Python) vs Target (Node.js)

Perbedaan ini **disengaja** dan harus ditangani lewat transformasi respons yang
eksplisit/teruji — bukan dengan mengubah engine.

| Field | Aktual `/classify` | Target migrasi |
|---|---|---|
| envelope | `{profile_id, namespace, rules_version, evidence_size, classification}` | `{profile_id, namespace, classification}` |
| `classification.pump_id` | ada (= `capacity_lps`, mis. 5000) | **tidak ada** |
| `classification.limitations` | ada | **tidak ada** |
| `classification.evaluation_status` | ada | **tidak ada** |
| `classification.rule_evaluations` | ada (8 entri) | **tidak ada** |
| `classification.sensor_snapshot` | 9+ kunci | subset (mis. 4 kunci) |
| `rules_version` | ada | **tidak ada** |
| `evidence_size` | ada | **tidak ada** |
| `matched_conditions` | string teknis (mis. `DR_C: output_power=...`) | label manusia |
| `trouble_type`, `matched_rules[].trouble_type`, `.total_conditions`, `readings_count` | ada | sama |

Respons Python aktual disimpan **utuh** di `*.expected.json` (termasuk field yang
akan dihilangkan). Kesetaraan diuji pada level semantik, lihat bagian Acceptance.

## Pemetaan Golden Fixtures

Lokasi: `backend/tests/golden/` (25 skenario; `*.input.json` + `*.expected.json`).
Dibangkitkan sekali dari engine Python (sebelum refactor) via
`tests/golden/generate.py --write`. **Tidak** pernah ditulis ulang oleh regression test.

| # | Skenario | Cakupan |
|---|---|---|
| 01 | `normal` | kondisi sehat |
| 02–08 | `pompa_tersangkut_sampah`, `banyak_sampah`, `dry_run`, `unbalance`, `undervoltage`, `overvoltage`, `panel_overheat` | delapan jenis gangguan |
| 09 | `turbulensi_ma30` | referensi MA30 (30 histori) |
| 10 | `turbulensi_cma10` | referensi CMA_n (histori tipis) |
| 11 | `turbulensi_insufficient` | data tidak cukup (T_A) |
| 12 | `turbulensi_gap_gt_10s` | jeda > 10 dtk memutus histori |
| 13–14 | `voltage_boundary_360/410` | batas tegangan (strict) |
| 15 | `banyak_sampah_boundary` | batas inklusif (≥) |
| 16 | `dry_run_torque_boundary_70` | batas torsi (strict <) |
| 17 | `dry_run_freq_rounding_2dp` | pembulatan 2 desimal (ROUND_HALF_UP) |
| 18 | `dry_run_boundary_freq_40_01` | di luar kesetaraan 2 desimal |
| 19 | `panel_overheat_boundary_60` | batas suhu (≥ 60) |
| 20 | `multi_unbalance_undervoltage` | multi-gangguan |
| 21 | `pts_quorum_2of4` | kuorum PTS |
| 22 | `unbalance_null_phase` | fasa arus NULL |
| 23–24 | `tier500/`tier3000`_banyak_sampah` | variasi tier/referensi |
| 25 | `missing_sensor_data` | banyak sensor kosong |

## Aturan Matematika yang Wajib Dipertahankan

Referensi per tier: `500`→75 kW/157 A, `3000`→250/517, `5000`→400/867.
Setpoint default: `500_lps`=46.1 Hz, `3000_lps`=38.0 Hz, `5000_lps`=40.0 Hz.

1. **Pompa Tersangkut Sampah** — `freq ≤ 10` **dan** ≥ 3 dari 4: `power ≥ ref`, `current ≥ ref`, `torque ≥ 110%`, `speed ≥ 100`.
2. **Turbulensi** — `freq < setpoint` ∧ `power ≥ ref` ∧ `|A − A_ref| ≥ 10` ∧ `torque ≥ 90%`. `A_ref` = `CMA_n` bila `1 ≤ n < 30`, `MA30` bila `n ≥ 30`; **pembacaan yang dinilai tidak ikut** menghitung referensi.
3. **Banyak Sampah** — `freq ≤ setpoint` ∧ `power ≥ ref` ∧ `current ≥ ref` ∧ `torque ≥ 90%`.
4. **Dry Run** — `freq == setpoint` (kesetaraan 2 desimal, ROUND_HALF_UP) ∧ `power ≤ 0.667·ref` ∧ `current ≤ 0.64·ref` ∧ `torque < 70%`.
5. **Unbalance** — `Ri=(U+V+W)/3`; `Eu=(Ri−U)/U·100`, `Ev`, `Ew`; MATCH bila **salah satu** `|E| ≥ 10%`. Fasa NULL → capability tidak terpenuhi (bukan MATCH).
6. **Undervoltage** — `input_voltage < 360`.
7. **Overvoltage** — `input_voltage > 410`.
8. **Panel Overheat** — salah satu dari `ambient_temperature`, `control_board_temperature`, `inverter_temperature` `≥ 60`.

**Normal** = tidak ada pola yang cocok — hasil klasifikasi, **bukan** jenis gangguan.

Aturan histori/evidensi:
- Ambil maksimum **31** sampel evidensi.
- **Jeda > 10 detik** (event-time) memutus histori.
- Urutan evaluasi (menentukan `trouble_type` = match pertama): tier (PTS → Dry Run → Turbulensi → Banyak Sampah) → panel → unbalance → undervoltage → overvoltage.

## Acceptance Criteria Node.js

Migrasi dinyatakan setara bila:

- Untuk **seluruh 25 golden fixture**, Node.js menghasilkan kesetaraan semantik dengan Python:
  - `trouble_type` sama;
  - himpunan `trouble_type` pada `matched_rules` sama;
  - `total_conditions` tiap rule sama;
  - `readings_count` sama;
  - `sensor_snapshot` (nilai sensor) sama pada kunci yang dipertahankan target;
  - `evaluation_status`/`limitations` Python dipetakan secara eksplisit (boleh di luar payload target).
- Transformasi respons aktual→target diuji terpisah (test transformasi eksplisit).
- Tiga berkas `rules.json`/`pump_profiles.json`/`profile_setpoints.json` disalin **identik** (hash sama).
- Endpoint Node.js: `POST /classify` + `GET /health` berfungsi dengan kontrak input sama.
- Perbedaan `matched_conditions` string diverifikasi via pemetaan, bukan ditebak.

## Di Luar Scope Tahap Ini

- Frontend (endpoint lama `/documents`, `/normalization`, `/telemetry`, `/classification/*` dihapus → permintaan akan gagal; lihat `11-frontend.md`).
- DB ingestion Node.js (pengganti `ingest_db`) pada tahap migrasi.
- Perubahan DB production.
