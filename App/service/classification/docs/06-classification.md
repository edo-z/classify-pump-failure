# 06 — Aturan Penilaian Gangguan

## Cara Menilai

Setiap pembacaan sensor **terakhir** dinilai langsung apa adanya — bukan rata-rata beberapa pembacaan. Tiga ukuran pompa (`500` / `3000` / `5000`) memakai batas yang berbeda-beda untuk daya, arus, dan torsi.

- Hanya penilaian **turbulensi** yang melihat ke belakang: ia membandingkan arus sekarang dengan **referensi adaptif (MA30 bila histori ≥30, CMA_n bila histori tipis)**.
- Gangguan lain hanya melihat **pembacaan terakhir**.
- **Pompa tersangkut sampah** diputuskan langsung begitu polanya cocok — tanpa menunggu bukti berulang.

Aturan mainnya sederhana:

- **Banyak sampah, turbulensi, dry run:** semua syarat wajib terpenuhi.
- **Pompa tersangkut sampah:** syarat frekuensi wajib, plus minimal 3 dari 4 syarat lainnya.
- **Data hilang = tidak terdeteksi**, disertai catatan keterangan. Tidak ada status “dilewati”.

## Sembilan Jenis Gangguan

`pompa_tersangkut_sampah`, `turbulensi`, `banyak_sampah`, `unbalance`, `undervoltage`, `overvoltage`, `dry_run` (dulu bernama `low_water_menyala`), `panel_overheat`, dan `normal` (sehat).

## Cara Membaca Syarat

- `≥` = sama dengan atau lebih, `≤` = sama dengan atau kurang, `<` / `>` = ketat (angka pas tidak ikut).
- Syarat frekuensi terhadap setpoint bersifat **inklusif**: frekuensi **sama dengan** setpoint ikut dihitung untuk banyak sampah.
- Selebihnya tertulis eksplisit per gangguan di bawah.

## BANYAK_SAMPAH — Keempat Syarat Wajib

Pompa dinyatakan banyak sampah bila **semua** syarat ini terpenuhi pada pembacaan terakhir:

1. **Frekuensi** sama dengan atau di bawah setpoint operasi.
2. **Daya** ≥ batas pompa (`75` / `250` / `400` kW).
3. **Arus** ≥ batas pompa (`157` / `517` / `867` A).
4. **Torsi** ≥ `90%` — batas **global** untuk semua ukuran pompa, bukan torsi acuan per pompa (`70/80/90%`).

Tidak memakai kecepatan putar (RPM). Bila ada data yang hilang, syaratnya tidak terpenuhi → **tidak terdeteksi**.

**Bedanya dengan pompa tersangkut sampah:** yang ini memakai batas frekuensi tetap `≤ 10 Hz` dan cukup 3 dari 4 syarat lain; banyak sampah membandingkan frekuensi dengan **setpoint** dan mewajibkan **semua** 4 syarat.

**Bedanya dengan turbulensi:** turbulensi wajib melihat penyimpangan arus terhadap referensi adaptif (MA30/CMA); banyak sampah tidak.

## UNBALANCE — Satu Fasa Menyimpang 10% Sudah Cukup

Hitung rata-rata arus tiga fasa. Lalu hitung penyimpangan tiap fasa terhadap rata-ratanya sendiri, dalam persen.

> Bila **salah satu** fasa menyimpang **10% atau lebih**, pompa dianggap **unbalance**.
> Contoh: rata-rata 110 A dengan fasa 100/100/130 A → penyimpangan terbesar sekitar 15% → **unbalance**.

Tanda `+` artinya fasa di bawah rata-rata, `-` artinya di atas. Penilaian memakai pembacaan terakhir; bila ada fasa yang datanya hilang atau nol → **tidak terdeteksi**.

## UNDERVOLTAGE & OVERVOLTAGE — Batas Tegangan Global

Tegangan yang dimaksud adalah tegangan masukan (AC), sama untuk semua pompa:

- **Undervoltage:** tegangan **di bawah 360 V** (360 pas → normal).
- **Overvoltage:** tegangan **di atas 410 V** (410 pas → normal).
- Rentang normal: **360–410 V**.
- Tegangan hilang → **tidak terdeteksi** + catatan keterangan.

## PANEL_OVERHEAT — Suhu 60 °C atau Lebih

> Panel dianggap **panas** bila **salah satu** suhu ini **≥ 60 °C**: suhu ruang panel, suhu papan kontrol, atau suhu inverter.

Dinilai dari pembacaan terakhir tiap suhu (bukan rata-rata). Tiap pembacaan yang panas langsung menjadi titik gangguan. Suhu yang datanya hilang dianggap tidak panas.

## TURBULENSI — Empat Syarat + Riwayat Arus

Pompa dinyatakan turbulensi bila **semua** syarat ini terpenuhi:

1. **Frekuensi** di bawah setpoint operasi (ketat, `<`).
2. **Daya** ≥ batas pompa (`75` / `250` / `400` kW).
3. **Arus menyimpang** ≥ `10 A` dari referensi adaptif: rata-rata 30 pembacaan sebelumnya bila histori ≥30 (`MA30`), atau rata-rata seadanya (`CMA_n`, 1 ≤ n < 30) bila histori tipis. Contoh: rata-rata 150 A + arus sekarang 163 A (selisih 13) → terpenuhi; selisih tepat 10 → terpenuhi; selisih 7 → tidak.
4. **Torsi** ≥ `90%`.

Tidak memakai RPM. Referensi arus selalu trailing (tidak termasuk pembacaan sekarang). Bila riwayat terputus (kesenjangan data) → penilaian mulai lagi dari awal; bila **tanpa histori sama sekali** atau arus kosong → syarat tidak terpenuhi → **tidak terdeteksi**. Alasan tercatat di `limitations` (lihat contoh hasil); status capability tetap **siap dinilai** — tidak ada status capability khusus untuk riwayat kurang. Kondisi match mencatat referensi yang dipakai (`vs MA30…` atau `vs CMAn…`).

### Kenapa rata-rata + deviasi (bukan angka mati)

1. **Arus tak punya angka mati lintas tier.** 500 A bisa normal di 5000_lps tapi janggal di 500_lps — maka yang dinilai bukan arusnya, melainkan **penyimpangannya dari kebiasaan** (`|A_i − A_ref| ≥ 10`). Tiga syarat lain (frekuensi, daya, torsi) satuannya baku, jadi bisa absolut.
2. **Rata-rata harus trailing.** Arus yang sedang dinilai tidak boleh ikut menghitung rata-rata — kalau ikut, lompatannya sendiri menarik rata-rata ke arahnya dan menyamarkan deviasi (termometer yang ikut panas).
3. **Kenapa 30.** Kompromi: cukup banyak untuk meredam noise sesaat, cukup sedikit untuk masih mewakili kondisi sekarang (±2,5 menit operasi); pas juga dengan jendela evidence 31 (30 + 1).
4. **Kenapa ada CMA.** Saat histori tipis (pompa baru nyala, habis gap), baseline seadanya lebih berguna daripada menolak menilai — dengan tradeoff yang diakui: vonis dari sedikit data lebih berisik. Karena itu setiap match mencatat `vs MA30…` / `vs CMAn…` agar kualitas vonis bisa diaudit.
5. **Catatan ambang.** `10 A` absolut di semua tier: sensitif di tier besar (±1% dari 850 A), kasar di tier kecil. Bila turbulensi terlalu sering MATCH di 5000_lps, tersangka pertamanya ambang ini — kandidat perbaikan: ambang relatif/persentase atau per-tier.

**Pantauan langsung:** data arus belum dikirim lewat jalur pantauan, sehingga turbulensi selalu **tidak terdeteksi** sampai datanya tersedia. Inilah pembeda turbulensi dari banyak sampah.

## POMPA_TERSANGKUT_SAMPAH — Frekuensi Rendah + Beban Tinggi

Pompa dinyatakan tersangkut sampah bila:

1. **Frekuensi ≤ 10 Hz** (wajib), **dan**
2. Minimal **3 dari 4** syarat ini: daya ≥ batas pompa (`75`/`250`/`400` kW), arus ≥ batas pompa (`157`/`517`/`867` A), torsi ≥ `110%` (**absolut**, bukan torsi acuan per pompa), kecepatan ≥ `100` RPM (**absolut**, bukan kecepatan acuan per pompa).

Dinilai dari pembacaan terakhir, tanpa rata-rata, tanpa menunggu bukti berulang — sekali pola cocok langsung diputuskan. Torsi dalam persen (`%`).

## DRY_RUN — Pompa Jalan Tanpa Beban

Pompa dinyatakan dry run (jalan kering / tanpa beban air) bila **dua tingkat** ini terpenuhi: `DryRun = DR_F ∧ DR_C` dengan `DR_C = DR_KW ∧ DR_A ∧ DR_T` (semua wajib, AND):

1. **DR_F — Frekuensi** `=` setpoint operasi (`46,1` / `38` / `40` Hz) dalam **raw 2 desimal** (tanpa normalisasi; `46.104→46.10` lolos terhadap `46.10`, `46.106→46.11` tidak).
2. **DR_KW — Daya** ≤ `0,667 ×` acuan daya (`50,025` / `166,75` / `266,8` kW).
3. **DR_A — Arus** ≤ `0,64 ×` acuan arus (`100,48` / `330,88` / `554,88` A).
4. **DR_T — Torsi** `< 70`.

Keputusan per-sampel terakhir: `freq_sustain: 1`, jadi sekali keempatnya terpenuhi langsung **dry run**, tanpa buffer tambahan.

Contoh pompa 500: frekuensi `46.10 == 46.10` + daya `20 ≤ 50,025` + arus `40 ≤ 100,48` + torsi `40 < 70` → **dry run**. Batas torsi: `69,9` lolos, `70` tidak. Bila salah satu meleset (misal frekuensi `0` saat pompa mati, atau `30 ≠ 46,1`) → tidak.

## Hasil Penilaian

Setiap jenis gangguan dinilai satu per satu: **terdeteksi** atau **tidak terdeteksi**. Bila tidak ada yang terdeteksi → hasilnya `normal`.

Klasifikasi bersifat seperti notifikasi/bunyi: semua yang terdeteksi tercatat di `matched_rules` dan sama pentingnya — tidak ada pemenang, tidak ada prioritas bahaya. `trouble_type` hanya salah satu yang aktif (yang dicek duluan secara teknis: tier → panel → unbalance → voltage), bukan juara.

Semua pola langsung diputuskan 1x (`count_trigger: 1`). Hasil scan tidak disimpan dan dihitung ulang tiap pindai. Bahasa sederhana: lihat `19`.

Status kelengkapan data: **data lengkap** bila ada penilaian yang bisa dijalankan, **data tidak cukup** bila tidak ada sama sekali.

## Nilai Acuan (Setpoint)

Setiap pompa punya nilai acuan operasi: frekuensi, kecepatan, dan torsi (dalam persen). Nilai ini untuk **setpoint operasi**, bukan batas BS/PTS — batas torsi BS (`90%`) dan PTS (`110%` + `100` RPM) bersifat **absolut dan sama untuk semua pompa**. Bila setpoint tidak valid (nol atau kosong) → syarat terkait **tidak terdeteksi**.

Untuk pompa yang beroperasi di luar standar tier, sistem mendukung **setpoint override** (per-situs di registry atau per-analisis di dokumen/replay). Override ini akan menggantikan frekuensi acuan profil namun tetap menggunakan RPM dan torsi dari profil tersebut.

## Contoh Hasil Aktual

```json
{
  "pump_id": 5000,
  "timestamp": "2026-09-16T15:23:17.550346Z",
  "trouble_type": "undervoltage",
  "matched_rules": [
    { "trouble_type": "undervoltage", "matched_conditions": ["input_voltage 355.00 < 360.00"], "total_conditions": 1 }
  ],
  "sensor_snapshot": {
    "output_frequency": 49.8,
    "motor_current": 612.0,
    "input_voltage": 355.0
  },
  "readings_count": 1,
  "limitations": [
    "TURBULENSI T_A insufficient_history: need_30_got_0 (need 30 prev, A=612.0)"
  ],
  "evaluation_status": "FULL",
  "rule_evaluations": [
    { "trouble_type": "undervoltage", "capability_status": "READY", "evaluation": "MATCH", "missing_requirements": [], "matched_conditions": ["input_voltage 355.00 < 360.00"], "total_conditions": 1 },
    { "trouble_type": "turbulensi", "capability_status": "READY", "evaluation": "NO_MATCH", "missing_requirements": [], "matched_conditions": [], "total_conditions": 4 },
    { "trouble_type": "unbalance", "capability_status": "READY", "evaluation": "NO_MATCH", "missing_requirements": [], "matched_conditions": [], "total_conditions": 1 }
  ]
}
```

## Konfigurasi Batas per Pompa

Batas tiap ukuran pompa (torsi dalam `%`): pompa 500 → frekuensi `46,1 Hz`, kecepatan `900`, torsi `70%`; pompa 3000 → `38 Hz`, `950`, `80%`; pompa 5000 → `40 Hz`, `990`, `90%`. Dapat diubah saat sistem berjalan tanpa restart. Nilai ini adalah **acuan operasi/setpoint** — bukan batas BS (`90%`) maupun PTS (`110%`, `100` RPM).
