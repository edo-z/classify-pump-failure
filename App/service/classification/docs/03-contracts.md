# 03 — Perjanjian Data

## Kebijakan Penamaan (5R/Rapi)

- **Tanpa prefix versi pada URL.** Satu jalur kanonis `POST /classify`; tidak
  ada `/v1`, `/v2`, dst. Bila kelak perlu perubahan breaking, tambahkan versi
  secara eksplisit saat itu juga, bukan sekarang.
- **Tanpa versi aturan di respons.** Envelope `/classify` **tidak** membawa
  `rules_version`; versi `rules.json` tetap metadata internal dan tak
  diekspos lewat API. Perubahan aturan dikomunikasikan lewat catatan rilis.
- **Nama tipe** memakai prefiks domain `Classify*` (mis. `ClassifyRequest`,
  `ClassifyResponse`, `ClassifyReading`) di backend maupun klien.

## Kolom Sensor Kanonis (16 kolom)

Payload `readings` (jalur `/classify`) memakai nama baku berikut. Kolom yang tidak ada dibiarkan kosong (`null`) — tidak pernah diisi nol.

| Kolom | Data |
|-------|------|
| `motor_speed` | Kecepatan motor (RPM) |
| `output_frequency` | Frekuensi keluaran (Hz) |
| `motor_current` | Arus motor (A) |
| `motor_torque` | Torsi motor (%) |
| `output_power` | Daya keluaran (kW) |
| `hours_run` | Jam jalan |
| `output_voltage` | Tegangan keluaran (V) |
| `ambient_temperature` | Suhu ruang panel (°C) |
| `control_board_temperature` | Suhu papan kontrol (°C) |
| `inverter_temperature` | Suhu inverter (°C) |
| `input_voltage` | Tegangan masuk (V) |
| `flux_actual` | Fluks aktual |
| `motor_estimated_temperature` | Estimasi suhu motor (°C) |
| `arus_rms_u` | Arus RMS fasa U (A) |
| `arus_rms_v` | Arus RMS fasa V (A) |
| `arus_rms_w` | Arus RMS fasa W (A) |

Setpoint frekuensi bukan kolom sensor — berasal dari override per-analisis atau acuan profil (`profile_setpoints.json`).

## Baris Siap Nilai

Tiap baris (`TelemetrySample`) membawa `timestamp`, status normalisasi (`COMPLETE`/`PARTIAL`), daftar `missing_fields` dan `invalid_fields`. Waktu kejadian mengikuti `timestamp` baris, bukan waktu sistem menerimanya.

## Status

- Status kelengkapan penilaian: **data lengkap** atau **data tidak cukup**.
- Tiap jenis gangguan: hasilnya **terdeteksi** atau **tidak terdeteksi**; bila datanya hilang, hasilnya **tidak terdeteksi** disertai catatan keterangan.
