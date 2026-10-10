# 11 — Tampilan

## Halaman

- `/` → pindah ke `/documents`.
- `/documents` penilaian kelompok & pemindaian + grafik file.
- `/chat` chat asisten Dexmin (SSE).
- `/admin` ubah acuan tiap ukuran pompa.

## Halaman Dokumen

- Pilih file + profil + rentang/langkah + unggah + siapkan data + nilai file ini (pindai).
- Grafik file: 16 kolom padat + rentang `1 jam – 1 tahun` + 3 grafik kecil kelompok.

## Hasil Penilaian

- **Utama:** jenis gangguan, kelengkapan data, waktu, bukti + syarat terpenuhi + catatan keterangan.
- **Rincian:** tabel penilaian tiap gangguan + data hilang + ringkasan sensor.
- Titik gangguan → daerah berwarna di grafik + tanda titik.

## Admin

- Profil 500/3000/5000, isi frekuensi/kecepatan/torsi → simpan atomik.

## Preset Sinyal per Trouble (keputusan produk #1: Opsi B)

Preset `turbulensi`, `banyak_sampah`, `dry_run` sengaja identik
(`outputFrequency, frequencySetpoint, outputPower, motorCurrent, motorTorque`)
karena kelimanya memang input ketiga rumus tersebut. Diskriminasi visual
dilakukan via badge + tabel + `markArea`, bukan via preset berbeda.
