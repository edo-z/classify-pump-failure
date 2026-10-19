# 12 — Daftar Antarmuka (API)

Alamat dasar `http://127.0.0.1:3031` lewat penerus `/api/*`. Dokumentasi interaktif di `GET /docs`.

CORS backend: `allow_origins=["*"]` dengan `allow_credentials=False`, `allow_methods/headers=["*"]`.

> Refactor 2026-10-19: hanya endpoint di bawah yang aktif. Endpoint berbasis
> file/CSV dihapus (lihat bagian akhir). Target migrasi Node.js: `20-migrasi-nodejs.md`.

## Kesehatan & Akar

### Cek sehat — `GET /health`

```json
{
  "status": "ok",
  "rules_exists": true,
  "rules_loaded": true,
  "rules_error": null
}
```

`degraded` bila rules tidak loaded.

### Akar — `GET /`

```json
{
  "service": "Pump Trouble Classification",
  "interfaces": {
    "classify": "/classify",
    "profile_setpoints": "/profile-setpoints",
    "health": "/health",
    "docs": "/docs"
  }
}
```

## Klasifikasi Single-Shot (kontrak stabil tim BE)

`POST /classify` — stateless, tanpa CSV. Wajib header `X-API-Key` bila `CLASSIFICATION_API_KEY` di-set (401 bila salah). Lihat `18-integrasi.md` untuk panduan lengkap + contoh curl/Python/fetch.

```json
// request
{ "profile_id":"5000_lps", "setpoint_freq":40.0, "namespace":"96",
  "readings":[{ "timestamp":"2026-06-12T14:33:56+07:00", "output_frequency":40.0, "input_voltage":380.0 }] }
// response
{ "profile_id":"5000_lps", "namespace":"96", "rules_version":"1.1",
  "evidence_size":12, "classification":{...ClassificationResult...} }
```

Batas: 1–40 readings; timestamp wajib ber-zona waktu (422 bila naive); profil tak dikenal 404.

## Acuan Pompa

### Lihat & ubah — `GET /profile-setpoints`, `GET /profile-setpoints/{id}`, `PUT /profile-setpoints/{id}` `{frequency_hz,rpm,torque}` (torsi dalam %)

```json
{ "500_lps": {"frequency_hz":35,"rpm":900,"torque":70}, "5000_lps": {"frequency_hz":40,"rpm":990,"torque":90} }
```

## Rename (2026-10-19)

Penamaan `v1`/`V1` dihapus (tidak diperlukan) — URL tidak memakai prefix versi:

| Sebelum | Sesudah |
|---|---|
| `POST /v1/classify` | `POST /classify` |
| key JSON `"v1"` pada `GET /` | key `"classify"` |
| modul `app/api/v1.py`, tipe `V1*`, `tests/test_contract_v1.py` | `app/api/classify.py`, `Classify*`, `tests/test_contract.py` |

Kebijakan: `03-contracts.md` §Kebijakan Penamaan.

## Endpoint yang Dihapus (2026-10-19)

Perubahan ini bagian dari persiapan migrasi Node.js; **tidak** ada kontrak lama
yang dianggap masih aktif.

| Endpoint lama | Status |
|---|---|
| `POST /documents/upload`, `GET/DELETE /documents*` | Dihapus |
| `POST /normalization/{id}`, `GET /normalization/{id}` | Dihapus |
| `POST /telemetry/{id}`, `GET /telemetry/{id}` | Dihapus |
| `POST /classification/run` | Dihapus |
| `GET /classification/scan/{id}` | Dihapus |
| `GET /classification/tier-refs` | Dihapus |

## Galat Umum

`401` API key salah/hilang, `404` profil tak dikenal, `422` readings kosong/>40 / timestamp naive / tak ada sampel layak.
