# 20 — Migrasi Klasifikasi Python → Node.js

> 5R Rawat — dokumen payung migrasi. Refactor Python (2026-10-19) menjadikan
> backend Python **engine independen**: lepas dari pipeline CSV, storage, CLI,
> dan DB ingest. Cutover 2026-10-20: backend Node.js mengambil alih `:3031` dan
> **kode Python dihapus**; perilakunya dibekukan sebagai fixture golden +
> differential. Tag rollback: `pre-python-removal`.
>
> Amendemen 2026-10-21: frontend Next.js dan unit `classify-pump-frontend`
> dihapus; referensi frontend di bawah adalah arsip historis.

## Ringkasan Keputusan

- **Satu engine, satu algoritma.** Tidak boleh ada dua implementasi rumus yang berbeda.
- Perilaku Python dibekukan menjadi **golden fixtures** (`backend-node/test/golden/`)
  dan **differential oracle** (`backend-node/test/differential/frozen.json`,
  400 kasus + respons Python) sebagai kontrak kesetaraan.
- Kontrak integrasi aktif: `POST /classify`, `/profile-setpoints`, `GET /health`.
- Schema MySQL 7 tabel (`07-storage.md`, `dexmin.sql`) **tetap** kontrak
  arsitektur DEXMIN; yang dihapus hanyalah *implementasi* ingestion Python.

## Arsitektur Python (ARSIP — dihapus 2026-10-20)

> Bagian ini disimpan sebagai rujukan historis. Kode berada di tag git
> `pre-python-removal`.

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
│       ├── service.py              # factory get_engine() → padanan engineFactory.ts
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

## Arsitektur Node.js (aktif)

```text
backend-node/            # produksi :3031 (systemd classify-pump-node)
├── src/
│   ├── engine/          # padanan app/classification/ Python
│   │   ├── engine.ts        # RulesEngine
│   │   ├── evaluator.ts     # 8 aturan (persamaan identik)
│   │   ├── evidence.ts      # trailing 31 pasca-gap
│   │   ├── support.ts       # MA30/CMA_n, freq eq 2dp
│   │   └── rules.json       # SALINAN identik (hash sama)
│   ├── api/             # /classify, /profile-setpoints, /health
│   ├── middleware/      # API-key gate (exact exempt + timing-safe)
│   ├── util/            # format Python, timestamp ber-zona, JSON
│   ├── ingest/          # DB ingestion MySQL (fase terpisah, pengganti ingest_db)
│   └── server.ts
└── test/
    ├── unit/            # engine, evidence, format, timestamp, setpoints, kontrak API
    ├── golden/          # 25 pasangan fixture dari Python
    └── differential/    # frozen.json (400 kasus + respons Python) + frozen.test.ts
```

**Status fase 1:** port selesai dengan prinsip **Full Compatibility First** —
Node mereproduksi envelope Python secara persis (termasuk `evidence_size`,
`pump_id`, `limitations`, `evaluation_status`, `rule_evaluations`, dan
`matched_conditions`). Penyederhanaan kontrak adalah fase terpisah dan belum
dieksekusi.

**Status fase 5 (cutover 2026-10-20):** Node mengambil alih `:3031`,
`classify-pump-node` enabled, dan **kode Python dihapus** (tag
`pre-python-removal`). Oracle kesetaraan kini **beku**: 25 golden + 400 kasus
differential di `test/differential/frozen.json`, dijalankan `npm test`. Temuan
FMEA S1–S6 sudah diremediasi (lihat `15-test-fmea-rcea.md` §7.4). Sisa
keputusan: aktivasi `CLASSIFICATION_API_KEY` (butuh injeksi key di FE/tunnel).

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

## Kontrak Fase 1: Identik dengan Python

Fase 1 memakai **Full Compatibility First**: respons Node identik dengan Python.
Kesetaraan diuji dengan **deep-equality penuh** atas seluruh JSON (bukan subset
semantik), termasuk string `matched_conditions`. Tidak ada transformasi respons
pada fase ini.

Penyederhanaan kontrak di bawah adalah usulan **fase lanjutan** dan belum
dieksekusi; bila dijalankan, ia harus lewat transformasi respons yang
eksplisit/teruji — bukan dengan mengubah engine.

| Field | Python & Node fase 1 | Usulan fase lanjutan |
|---|---|---|
| envelope | `{profile_id, namespace, evidence_size, classification}` | `{profile_id, namespace, classification}` |
| `classification.pump_id` | ada (= `capacity_lps`, mis. 5000) | **tidak ada** |
| `classification.limitations` | ada | **tidak ada** |
| `classification.evaluation_status` | ada | **tidak ada** |
| `classification.rule_evaluations` | ada (8 entri) | **tidak ada** |
| `classification.sensor_snapshot` | 9+ kunci | subset (mis. 4 kunci) |
| `evidence_size` | ada | **tidak ada** |
| `matched_conditions` | string teknis (mis. `DR_C: output_power=...`) | label manusia |
| `trouble_type`, `matched_rules[].trouble_type`, `.total_conditions`, `readings_count` | ada | sama |

Respons Python aktual disimpan **utuh** di `*.expected.json` dan menjadi oracle
paritas fase 1.

## Pemetaan Golden Fixtures

Lokasi: `backend-node/test/golden/` (25 skenario; `*.input.json` + `*.expected.json`).
Dibangkitkan sekali dari engine Python (sebelum refactor) via generator Python
(`tests/golden/generate.py`, kini ada di tag `pre-python-removal`).
**Tidak** pernah ditulis ulang oleh regression test.

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
- Urutan evaluasi (menentukan `trouble_type` = match pertama): tier (PTS → Turbulensi → Banyak Sampah → Dry Run) → panel → unbalance → undervoltage → overvoltage.

## Acceptance Criteria Node.js

Migrasi dinyatakan setara bila:

- Untuk **seluruh 25 golden fixture**, respons Node **sama persis** dengan Python
  (deep equality atas JSON penuh), mencakup:
  - `profile_id`, `namespace`, `evidence_size`;
  - `classification.pump_id`, `timestamp` (offset zona waktu dipertahankan),
    `trouble_type`, `readings_count`, `evaluation_status`;
  - `matched_rules` beserta urutan dan string `matched_conditions`;
  - `rule_evaluations` (urutan evaluasi, capability, evaluation, missing, conditions);
  - `sensor_snapshot` dan `limitations`.
- Differential oracle beku (`test/differential/frozen.json`, 400 kasus acak
  deterministik + respons Python) dicocokkan Node dengan 0 selisih — berjalan
  tanpa runtime Python.
- Tiga berkas `rules.json`/`pump_profiles.json`/`profile_setpoints.json` disalin **identik** (hash sama).
- Endpoint Node.js: `POST /classify` + `GET /health` + `/profile-setpoints` berfungsi dengan kontrak input sama.
- Perbedaan `matched_conditions` string diverifikasi via pemetaan, bukan ditebak.

## Di Luar Scope Tahap Ini

- Frontend (endpoint lama `/documents`, `/normalization`, `/telemetry`, `/classification/*` dihapus → permintaan akan gagal; lihat `11-frontend.md`).
- DB ingestion Node.js (pengganti `ingest_db`) pada tahap migrasi.
- Perubahan DB production.
