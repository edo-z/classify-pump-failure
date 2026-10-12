# 08 — Kondisi per Pompa

> ARSIP — jalur live/MQTT dihapus 2026-10-10. Berlaku hanya untuk `run/scan/v1`, lihat `19`. Dokumen ini disimpan sebagai historis.

## Isi Kondisi

```json
{
  "site_id": "96",
  "profile_id": "5000_lps",
  "status": "READY",
  "message_count": 42,
  "last_update": "2026-09-16T15:00:00+07:00",
  "last_receive": "2026-09-16T15:00:00.120Z",
  "fields": {
    "output_frequency": { "value": 49.8, "timestamp": "2026-09-16T15:00:00+07:00", "receive_timestamp": "2026-09-16T15:00:00.120Z", "age_seconds": 12.3 },
    "input_voltage": { "value": 378.2, "timestamp": "2026-09-16T15:00:01+07:00", "receive_timestamp": "2026-09-16T15:00:01.110Z", "age_seconds": 11.3 }
  },
  "control_sp": { "value": 40.2, "timestamp": "2026-09-16T14:59:00+07:00", "receive_timestamp": "...", "age_seconds": 72.3 },
  "evidence_size": 1,
  "field_count": 13,
  "gap_count": 2,
  "last_classification": { "...ClassificationResult..." },
  "last_classification_timestamp": "2026-09-16T15:00:01+07:00",
  "last_sensor_snapshot": { "output_frequency": 49.8, "input_voltage": 378.2 }
}
```

- Tiap kanal sensor menyimpan nilai + waktu kejadian + waktu terima.
- Setpoint frekuensi tidak kedaluwarsa.
- `last_update` = waktu kejadian pemicu, `last_receive` = waktu terima di server.

## Aturan Pembaruan

- Kosong → data dihapus (bukan 0).
- Data lebih lama → dibuang (urutan waktu dijaga).
- Sama → diganti, lebih baru → diperbarui.
- Profil pompa dibaca dari daftar dan bisa diubah saat berjalan; tidak ada ukuran bawaan otomatis.

## Status

- Pompa terdaftar → **siap**.
- Pompa belum terdaftar → **butuh konfigurasi**: datanya tetap diterima, penilaiannya tidak dijalankan, hasil terakhir kosong, aliran tetap memberi status — dan otomatis siap begitu daftar ditambah.

## Statistik Kedinamisan Data

Endpoint statistik per pompa menampilkan, per kanal: jumlah contoh, jeda tengah (median), jeda 95%, jeda terbesar, dan jumlah kesenjangan — plus total pesan dan total kesenjangan.

```json
{
  "site_id": "96",
  "cadence": {
    "output_frequency": { "sample_count": 120, "median_interval_ms": 2504, "p95_interval_ms": 19158, "max_interval_ms": 19158, "gap_count": 1 },
    "input_voltage": { "sample_count": 1, "median_interval_ms": null, "p95_interval_ms": null, "max_interval_ms": null, "gap_count": 0 }
  },
  "message_count": 120,
  "gap_count": 1
}
```

Kesenjangan dihitung bila jeda > 10 detik. Pengamatan minimal 10 menit, dianjurkan 30 menit. Umur data hanya untuk pantauan, bukan batas kedaluwarsa.

## Ringkasan & Penilaian

Ringkasan menggabungkan semua kanal + setpoint + hasil penilaian terakhir. Bukti 4 data + jendela 30 detik + jeda 10 detik dikelola saat penilaian.
