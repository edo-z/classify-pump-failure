# 12 — Daftar Antarmuka (API)

Alamat dasar `http://127.0.0.1:3031` lewat penerus `/api/*`. Dokumentasi interaktif di `GET /docs`.

CORS backend: `allow_origins=["*"]` dengan `allow_credentials=False` (browser tidak kirim kredensial), `allow_methods/headers=["*"]`.

> Catatan: contoh JSON di bawah **tetap teknis** untuk kebutuhan integrator — hanya penjelasan di sekitarnya yang memakai bahasa operasional.

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
{ "service": "Pump Trouble Classification", "interfaces": { "documents":"/documents", "normalization":"/normalization", "classification":"/classification", "health":"/health", "docs":"/docs" } }
```

## File & Data Siap Nilai

### Unggah file — `POST /documents/upload?filename=aldo.csv` isi `raw csv`

```json
{ "document_id":"aldo.csv", "filename":"aldo.csv", "status":"LOADED", "row_count":51257 }
```

Galat: `400` nama salah, `409` sudah ada, `413` upload >50MB (`MAX_UPLOAD_BYTES=50*1024*1024`, dicek `Content-Length` + body), `415` format tidak didukung.

### Lihat / hapus file — `GET /documents`, `GET /documents/{id}`, `DELETE /documents/{id}`

### Seragamkan — `POST /normalization/{id}`, `GET /normalization/{id}?preview_limit&research_limit`

Ringkasan berisi nilai terkecil/terbesar/rata-rata per kolom, 1000 contoh merata.

### Siapkan data — `POST /telemetry/{id}`, `GET /telemetry/{id}`

```json
{ "document_id":"aldo.csv", "status":"PARTIAL", "raw_row_count":51257, "samples":[{ "timestamp":"2026-09-16T15:00:00+07:00", "motor_speed":1442 }] }
```

## Penilaian Kelompok

### Nilai murni per-sampel — `POST /classification/run`

```json
// request
{ "document_id":"aldo.csv", "profile_id":"5000_lps", "setpoint_freq": 46.1 }
// response ClassificationPipelineResult
{
  "document_id":"aldo.csv", "profile_id":"5000_lps", "document_status":"NORMALIZED",
  "source_row_count":51257, "timestamped_row_count":51257,
  "classification": { "pump_id":5000, "timestamp":"...", "trouble_type":"undervoltage", "matched_rules":[...], "sensor_snapshot":{...}, "readings_count":13, "limitations":["arus motor tidak ada: catatan turbulensi (data hilang = tidak terdeteksi)"], "evaluation_status":"FULL", "rule_evaluations":[...] }
}
```

Murni per-sampel: pembacaan terakhir + evidensi trailing (gap >10 dtk memutus histori).

Pompa tersangkut sampah langsung diputuskan bila frekuensi ≤ 10 Hz dan minimal 3 dari 4 syarat lain (tanpa menunggu bukti berulang); turbulensi wajib keempat syarat — frekuensi di bawah setpoint, daya cukup, arus menyimpang ≥ 10 A dari rata-rata 30 sebelumnya, torsi ≥ 90%.

### Pindai file — `GET /classification/scan/{id}?profile_id=5000_lps`

```json
{
  "document_id":"aldo.csv","profile_id":"5000_lps",
  "total_points":51257,"failure_count":48912,
  "points":[{ "source_row":2, "timestamp":"2026-06-12T14:33:56", "cursor":0, "trouble_type":"undervoltage", "is_failure":true, "evaluation_status":"FULL", "readings_count":1, "evidence_size":1, "matched_rules":[], "sensor_snapshot":{}, "limitations":[] }]
}
```

Murni per-sampel, selalu full-resolution: tiap sampel dinilai dengan evidensi trailingnya (gap >10 dtk memutus histori); tiap pembacaan suhu ≥ 60 °C langsung menjadi titik gangguan; titik gangguan = points dengan `is_failure: true` (tidak ada array `failures` terpisah); daerah gangguan di grafik hanya mengelompokkan yang bukan `normal`.

## Acuan Pompa

### Lihat & ubah — `GET /profile-setpoints`, `PUT /profile-setpoints/{id}` `{frequency_hz,rpm,torque}` (torsi dalam %)

```json
{ "500_lps": {"frequency_hz":35,"rpm":900,"torque":70}, "5000_lps": {"frequency_hz":40,"rpm":990,"torque":90} }
```

Torsi dalam persen; batas torsi gangguan `110/90/50%`.

## Galat Umum

`400` nama file salah, `404` file tidak ditemukan, `409` dokumen sudah ada, `413` upload >50MB, `415` format tak didukung, `422` dataset tak didukung / tanpa waktu / profile tak dikenal.
