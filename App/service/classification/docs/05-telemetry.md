# 05 — Data Sensor

## Kanal Data Pembacaan

| Data | Nama di File | Kanal | Keterangan |
|-------|-----------|-------|------------|
| `timestamp` | `Start Time (WIB)` | — | Waktu |
| `motor_speed` | `Motor Speed used` | `ms` | Kecepatan (RPM) |
| `output_frequency` | `Output Frekuensi` | `rf` | Frekuensi (Hz) |
| `motor_current` | `Motor current` | — | Arus (selalu kosong lewat jalur pantauan → `turbulensi` selalu **tidak terdeteksi** disertai catatan; syarat arusnya = menyimpang ≥ 10 A dari rata-rata 30 sebelumnya, butuh 31 data) |
| `motor_torque` | `Motor torque` | `t` | Torsi dalam persen (batas `110/90/50%`) |
| `output_power` | `Output power` | `p` | Daya (kW) |
| `hours_run` | `Hours run` | — | Kosong via pantauan |
| `output_voltage` | `Output voltage` | — | Kosong |
| `ambient_temperature` | `Ambient temperature` | `at` | Suhu ruang (°C) |
| `control_board_temperature` | `Control board temperature` | `bt` | Suhu papan (°C) |
| `inverter_temperature` | `Inverter temperature` | `it` | Suhu inverter (°C) |
| `input_voltage` | — | `dc` | Tegangan masukan AC (V) |
| `flux_actual` | — | — | Kosong |
| `motor_estimated_temperature` | `Motor Estimated Temperature` | `mt` | Estimasi suhu motor (°C) |
| `arus_rms_u` | `Arus RMS U` | `cu` | Arus fasa U (A) |
| `arus_rms_v` | `Arus RMS V` | `cv` | Arus fasa V (A) |
| `arus_rms_w` | `Arus RMS W` | `cw` | Arus fasa W (A) |

Tanda `vsd_fault`, `pump_fault`, dan sejenisnya ada tetapi tidak dipakai penilaian langsung.

## Penyeragaman File

- 8 kolom wajib + 3 kolom arus fasa opsional dikenali dari nama kolom file.
- Sel kosong / tulisan `null` → dianggap kosong; angka tidak wajar ditolak; waktu dibaca dari format baku.
- Status file: **lengkap** bila semua kolom wajib ada, **sebagian** bila ada yang kosong/tidak valid, **skema tak didukung** bila kolom wajib hilang.

## Skema Lite 5 Kolom (File Harian)

File harian (mis. `pucang tgl27.csv`) memakai header ringkas dan angka koma-desimal Indonesia:

| Data | Nama di File Lite | Keterangan |
|-------|-------------------|------------|
| `timestamp` | `Timestamp WIB` | Waktu (`2026-09-27 15:14:44`, jam boleh 1-digit) |
| `output_frequency` | `Frequency (Hz)` | Frekuensi (Hz), koma-desimal `"2,25"` → `2.25` |
| `motor_current` | `Motor Current (A)` | Arus (A) |
| `output_power` | `Power (kW)` | Daya (kW) |
| `motor_torque` | `Torque` | Torsi dalam persen, sama seperti skema penuh |

Skema terdeteksi sebagai `PUMP_TELEMETRY_LITE`; kolom kanonikal di luar varian (kecepatan, tegangan, suhu, arus fasa) tercatat sebagai data hilang per baris — maka `unbalance`, `undervoltage`/`overvoltage`, dan `panel_overheat` selalu **tidak terdeteksi**, sedangkan `turbulensi`, `banyak_sampah`, `pompa_tersangkut_sampah`, dan `dry_run` tetap bisa dinilai.

## Contoh Data Siap Nilai

```json
{
  "document_id": "aldo_pump_logs_2.csv",
  "status": "PARTIAL",
  "samples": [
    {
      "timestamp": "2026-09-16T15:00:00+07:00",
      "motor_speed": 1442,
      "output_frequency": 49.8,
      "motor_current": 612,
      "motor_torque": 42.1,
      "output_power": 18.5,
      "input_voltage": 390.0,
      "arus_rms_u": 98.2,
      "ambient_temperature": 33.5,
      "motor_estimated_temperature": 28.0
    }
  ]
}
```

Torsi dalam persen (batas `110/90/50%`). Data pantauan langsung disusun dari kondisi tiap pompa pada waktu pemicu, dengan `motor_current/hours_run/output_voltage/flux_actual` selalu kosong.

## Arti Data Kosong

Tidak pernah diganti `0` bila kosong — data kosong berarti syarat terkait **tidak terdeteksi**, disertai catatan keterangan.

## Pemetaan Nama Kolom File

`DC Voltage → input_voltage`, `Flux Actual → flux_actual`, `Motor Current → motor_current`, dan seterusnya — dikenali dari nama kolomnya.
