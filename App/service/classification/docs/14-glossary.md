# 14 — Daftar Istilah (Berlaku Tetap)

Istilah-istilah berikut berlaku tetap untuk seluruh layanan klasifikasi, baik untuk laporan ke luar maupun catatan internal.

## Istilah Laporan (Keluar)

| Istilah | Bentuk | Arti |
|---------|--------|------|
| **pemicu** | daftar teks | Syarat-syarat yang terpenuhi dan memicu jenis gangguan. Bentuk: `"nama_data nilai_aktual pembanding batas"` |
| **trouble_type** | teks | Jenis gangguan yang terdeteksi (atau `normal` bila tidak ada yang cocok) |
| **pump_id** | teks | Identitas pompa |
| **timestamp** | teks | Waktu kejadian (format waktu universal UTC), yaitu waktu data — bukan waktu penilaian |

### Aturan Penulisan `pemicu`

- Selalu berupa daftar, walau hanya 1 syarat → `["…"]`, bukan `"…"`.
- Urutannya mengikuti urutan penilaian sistem (bukan abjad).
- Bila hasilnya `normal` → `pemicu: []` (daftar kosong).
- Nama data memakai nama baku, misalnya `ambient_temperature`.

### Contoh Laporan Keluar

```json
{
  "pump_id": "96",
  "trouble_type": "panel_overheat",
  "timestamp": "2026-09-17T12:00:00Z",
  "pemicu": [
    "ambient_temperature 65.0 >= 60.0",
    "control_board_temperature 65.0 >= 60.0"
  ]
}
```

## Istilah Internal (Catatan Sistem)

Bagian ini menjelaskan catatan internal sistem — **tidak dikirim ke luar**, hanya untuk log dan pemeriksaan.

### Sembilan Jenis Gangguan

| Nama | Kelompok |
|------|----------|
| `pompa_tersangkut_sampah` | Gangguan pompa |
| `turbulensi` | Gangguan pompa |
| `banyak_sampah` | Gangguan pompa |
| `dry_run` | Gangguan pompa |
| `low_water_menyala` | Nama lama `dry_run` (tetap didukung) |
| `unbalance` | Gangguan pompa (arus) |
| `undervoltage` | Gangguan pompa (tegangan) |
| `overvoltage` | Gangguan pompa (tegangan) |
| `panel_overheat` | Gangguan panel |
| `normal` | Tidak ada gangguan |

### Hasil Penilaian — Isi Laporan Sistem

| Isi | Arti |
|-------|------|
| `pump_id` | Nomor pompa |
| `timestamp` | Waktu dari pembacaan terakhir |
| `trouble_type` | Salah satu notifikasi aktif (atau `normal` bila tidak ada). Urutan teknis, bukan prioritas bahaya. |
| `matched_rules` | Semua pola gangguan yang terpenuhi |
| `sensor_snapshot` | Ringkasan angka sensor terakhir |
| `readings_count` | Jumlah pembacaan yang dinilai |
| `limitations` | Catatan keterangan: penilaian yang tidak bisa dijalankan penuh. **Internal saja.** |
| `evaluation_status` | Kelengkapan data: lengkap / tidak cukup. **Internal saja.** |
| `rule_evaluations` | Rincian penilaian tiap jenis gangguan (audit). **Internal saja.** |

### Bukti Positif (Syarat yang Terpenuhi)

| Isi | Arti |
|-------|------|
| `trouble_type` | Jenis gangguan yang terdeteksi |
| `matched_conditions` | Syarat yang terpenuhi → menjadi **`pemicu`** di laporan keluar |
| `total_conditions` | Jumlah syarat yang diperiksa (termasuk yang tidak terpenuhi) |

### Audit Tiap Jenis Gangguan

| Isi | Arti |
|-------|------|
| `trouble_type` | Jenis gangguan yang dinilai |
| `capability_status` | `siap dinilai` = datanya ada; `aturan tidak berlaku` = kesalahan konfigurasi |
| `evaluation` | **terdeteksi** / **tidak terdeteksi** (kosong hanya bila aturan tidak berlaku) |
| `missing_requirements` | Data yang tidak ada |
| `matched_conditions` | Syarat yang terpenuhi |
| `total_conditions` | Jumlah syarat |

### Status Kelengkapan Data

- Tidak ada penilaian yang bisa dijalankan → **data tidak cukup**.
- Ada penilaian yang bisa dijalankan → **data lengkap**.
- Aturan yang konfigurasinya salah tidak dihitung.

Daerah gangguan di grafik (`failureAreas`) hanya menyaring hasil yang bukan `normal`.

### Data Sensor Masuk

Nama kolom di file: `Start Time (WIB)`, `Motor Speed used`, `Output Frekuensi`, `Motor current` (A), `Motor torque` (`%` persen 0–100+), `Ambient temperature`, `Arus RMS U/V/W`, dan lain-lain.

- `motor_current` selalu kosong lewat jalur pantauan (tidak ada pengirimnya) → `turbulensi` selalu **tidak terdeteksi** disertai catatan.
- `hours_run`, `output_voltage`, `flux_actual` juga kosong.
- `input_voltage` → dipakai untuk `undervoltage` / `overvoltage` (tegangan masukan AC, `<360` / `>410`).
- `motor_torque` dalam `%` — batas `110/90/50%`.

### Status Pantauan per Pompa

> ARSIP — jalur live/MQTT dihapus 2026-10-10. Berlaku hanya untuk `run/scan/v1`, lihat `19`. Bagian di bawah ini sisa historis, bukan perilaku aktif.

Tiap pompa menyimpan di memori:

| Isi | Arti |
|-------|------|
| Nilai sensor | 12 kanal sensor + nilai dan waktunya |
| Setpoint kontrol | Frekuensi setpoint dari pengirim |
| Bukti 4 data | Jendela 4 pembacaan terakhir (30 detik, jeda 10 detik) |
| Hasil terakhir | Hasil penilaian terakhir |
| Status | Siap / butuh konfigurasi (bila profil pompa belum dipilih) |

Aturan pembaruan tiap kanal data:
- Data lebih lama dari yang tersimpan → dibuang.
- Data sama waktunya → diganti.
- Data lebih baru → diperbarui.
- Nilai kosong tidak pernah diisi nol.

### Acuan Tiap Pompa

| Pompa | Kapasitas | Frekuensi | Kecepatan | Torsi |
|-----------|----------|-----------|-----|--------|
| `500_lps` | 500 lps | 35 Hz | 900 | 70 % |
| `3000_lps` | 3000 lps | 38 Hz | 950 | 80 % |
| `5000_lps` | 5000 lps | 40 Hz | 990 | 90 % |

### Panel Panas — Salah Satu Suhu Cukup

Panel dianggap panas bila salah satu suhu ≥ 60 °C:

```
suhu ruang panel ≥ 60 ATAU suhu papan kontrol ≥ 60 ATAU suhu inverter ≥ 60
```

Dinilai dari pembacaan terakhir, tanpa dirata-rata.

### Pompa Tersangkut Sampah — Langsung Diputuskan

`pompa_tersangkut_sampah` = pola PTS (frekuensi ≤ 10 Hz dan minimal 3 dari 4 syarat lain, torsi dalam `%`) — **langsung diputuskan** begitu pola cocok, tanpa menunggu bukti berulang dan tanpa catatan tertunda.

Fasilitas “bukti berulang” tetap tersedia di sistem untuk pola lain yang membutuhkannya — saat ini **tidak ada** pola yang memakainya, sehingga semua langsung diputuskan; hasil tidak cocok langsung **tidak terdeteksi**.

### Gangguan Lain — Pembacaan Terakhir

Penilaian memakai pembacaan terakhir tiap kanal. Pemindaian file memakai potongan 1 menit, langkah 1.

## Pemetaan Internal → Laporan Keluar

| Catatan internal | Laporan keluar | Keterangan |
|----------------------|---------------------|------|
| Syarat yang terpenuhi | `pemicu` | Bentuk `nama_data nilai pembanding batas` |
| Jenis gangguan | `trouble_type` | Teks |
| Nomor pompa | `pump_id` | Teks |
| Waktu | `timestamp` | Waktu universal UTC |
| Catatan keterangan | — | **Disembunyikan** (log internal) |
| Status kelengkapan | — | **Disembunyikan** (log internal) |
| Audit per gangguan | — | **Disembunyikan** (log internal) |
| Ringkasan sensor | — | **Disembunyikan** (log internal) |
| Jumlah syarat | — | **Disembunyikan** (laporan hanya menampilkan syarat yang terpenuhi) |
