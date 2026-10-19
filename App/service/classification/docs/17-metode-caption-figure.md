# 17 — Caption Metode Baku untuk Figure (siap salin ke paper)

## Caption ID (panjang)
> Grafik deret-waktu telemetri pompa per sinyal (frekuensi Hz, arus A, daya kW,
> torsi %, suhu °C, tegangan V). Downsampling adaptif min-max preserving dengan
> budget = 2×lebar piksel (800–6000 titik); mode render (RAW/ADAPTIVE) tertera
> pada bar status. Celah >2×median interval digambar putus dan diberi label
> "gap: sensor mati, tidak ada data" (tanpa interpolasi, tanpa smoothing).
> Garis putus menandai ambang klasifikasi dari `rules.json`: PTS F≤10 Hz,
> undervoltage <360 V, overvoltage >410 V, panel ≥60 °C, serta ambang DRY per-tier
> (0,667×/0,64× referensi tier).
> Area berwarna = interval gangguan hasil klasifikasi; simbol pembeda per tipe
> (segitiga/lingkaran/kotak/diamond/pin) agar terbaca grayscale.

## Caption EN (panjang)
> Pump telemetry time series per signal (frequency Hz, current A, power kW,
> torque %, temperature °C, voltage V). Adaptive min-max-preserving downsampling
> with budget = 2× pixel width (800–6000 points); render mode (RAW/ADAPTIVE)
> shown in the status bar. Gaps >2× median interval are drawn broken and labelled
> "gap: sensor offline, no data" (no interpolation, no smoothing). Dashed lines
> mark classification thresholds from `rules.json`: PTS F≤10 Hz, undervoltage
> <360 V, overvoltage >410 V, panel ≥60 °C, and per-tier DRY thresholds
> (0.667×/0.64× tier reference). Shaded bands are
> classified trouble intervals; per-type symbols keep them readable in grayscale.

## Versi pendek (keterangan gambar 1 baris)
> ID: `Deret telemetri (adaptive min-max, budget 2×px; gap = sensor mati; garis putus = ambang rules.json).`
> EN: `Telemetry series (adaptive min-max, 2×px budget; gaps = sensor offline; dashed = rules.json thresholds).`

## Audit buta warna 2026-10-07 (simulasi Machado 2009, ambang delta-E 10)
- Pasangan tersempit: turbulensi–undervoltage 24,9 (normal) / **6,9 (deuteranopia)** / 10,4 (protanopia).
- Kandidat ungu untuk turbulensi semuanya lebih buruk (min 2,1–8,8; ruang ungu sudah jenuh oleh `inputVoltage`/`arusRmsW`/`panel_overheat`).
- Keputusan: **pertahankan `#0891b2`**; pembeda mengandalkan simbol (roundRect vs triangle) + label teks + mode monokrom (`Mode cetak` di UI: hitam + pola solid/dashed/dotted per sinyal).
