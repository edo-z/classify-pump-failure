---
name: Pump Classification PoC
description: Ruang kontrol yang tenang untuk teknisi pompa — klasifikasi gangguan plus asisten Dexmin.
colors:
  signal-blue: "#2563eb"
  signal-blue-deep: "#1d4ed8"
  signal-blue-ink: "#1e40af"
  signal-wash: "#eff6ff"
  signal-line: "#bfdbfe"
  control-paper: "#f0f2f5"
  surface: "#ffffff"
  ink: "#111827"
  ink-soft: "#374151"
  muted: "#6b7280"
  faint: "#9ca3af"
  line: "#e5e7eb"
  line-strong: "#d1d5db"
  fill-quiet: "#f9fafb"
  fill-quieter: "#f3f4f6"
  ok: "#16a34a"
  ok-wash: "#dcfce7"
  warn: "#d97706"
  warn-wash: "#fffbeb"
  danger: "#dc2626"
  danger-wash: "#fee2e2"
  console: "#1f2937"
typography:
  headline:
    fontFamily: "Inter, Arial, Helvetica, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 800
    lineHeight: 1.2
  title:
    fontFamily: "Inter, Arial, Helvetica, sans-serif"
    fontSize: "1rem"
    fontWeight: 700
    lineHeight: 1.3
  body:
    fontFamily: "Inter, Arial, Helvetica, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.55
  label:
    fontFamily: "Inter, Arial, Helvetica, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 600
    lineHeight: 1.4
  eyebrow:
    fontFamily: "Inter, Arial, Helvetica, sans-serif"
    fontSize: "0.65rem"
    fontWeight: 600
    letterSpacing: "0.05em"
rounded:
  pill: "999px"
  card: "12px"
  control: "8px"
  chat: "14px"
  caret: "2px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
components:
  button-primary:
    backgroundColor: "{colors.signal-blue}"
    textColor: "{colors.surface}"
    rounded: "{rounded.control}"
    padding: "0.55rem 1.1rem"
  button-primary-hover:
    backgroundColor: "{colors.signal-blue-deep}"
    textColor: "{colors.surface}"
    rounded: "{rounded.control}"
    padding: "0.55rem 1.1rem"
  button-ghost:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink-soft}"
    rounded: "{rounded.control}"
    padding: "0.55rem 1.1rem"
  nav-item-active:
    backgroundColor: "{colors.signal-wash}"
    textColor: "{colors.signal-blue}"
    rounded: "{rounded.control}"
    padding: "0.75rem 1rem"
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.card}"
    padding: "1.5rem"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "0.5rem"
  chip:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink-soft}"
    rounded: "{rounded.pill}"
    padding: "0.45rem 0.9rem"
---

# Design System: Pump Classification PoC

## Overview

**Creative North Star: "Ruang Kontrol Tenang"**

Sistem ini adalah ruang kontrol yang tenang untuk teknisi pompa: satu aksen biru yang jarang bicara, permukaan datar berlapis nada, dan tipografi tunggal yang presisi. Tidak ada dekorasi yang meminta perhatian; setiap piksel melayani keterbacaan data dan kecepatan keputusan. Kepribadiannya profesional dan tertahan — pantas untuk alat kerja lapangan, bukan etalase.

**Key Characteristics:**
- Satu aksen, dipakai hemat (status, aksi primer, tautan aktif).
- Datar secara default; kedalaman hanya sebagai respons status.
- Tanpa ikon; identitas ditegakkan lewat monogram inisial dan kata.
- Gerak kecil dan fungsional (kedip kursor, titik mengetik), selalu hormat `prefers-reduced-motion`.

## Colors

Satu biru sinyal di atas kertas ruang kontrol netral; merah/kuning/hijau hanya untuk status.

### Primary
- **Biru Sinyal Kontrol** (#2563eb): satu-satunya aksen. Tombol primer, bubble user, tautan navigasi aktif, kursor streaming. Varian dalam: hover (#1d4ed8), tinta pekat (#1e40af), siraman (#eff6ff), garis (#bfdbfe).

### Neutral
- **Kertas Ruang Kontrol** (#f0f2f5): latar aplikasi.
- **Putih Permukaan** (#ffffff): kartu, sidebar, composer.
- **Tinta** (#111827): teks utama; **Tinta Lembut** (#374151): teks sekunder.
- **Abu Panel** (#6b7280 bisu, #9ca3af samar): keterangan, timestamp, meta.
- **Garis** (#e5e7eb), **Garis Tegas** (#d1d5db): pembatas dan bingkai kontrol.
- **Isian Sunyi** (#f9fafb) dan **Lebih Sunyi** (#f3f4f6): latar pasif dan pembeda seksi.
- **Konsol** (#1f2937): hanya avatar asisten — satu-satunya bidang gelap, menandai "mesin yang bicara".

### Status (bukan palet merek)
- **OK** (#16a34a) di atas siraman (#dcfce7); **Awas** (#d97706) di atas (#fffbeb); **Bahaya** (#dc2626) di atas (#fee2e2, garis #fca5a5).

### Named Rules
**The One Signal Rule.** Aksen biru dipakai pada ≤10% layar mana pun. Kelangkaannya adalah pesannya; bila semua biru, tidak ada yang penting.

## Typography

**Display Font:** Inter (dengan Arial, Helvetica) — satu-satunya keluarga di seluruh aplikasi.
**Body Font:** Inter (dengan Arial, Helvetica).
**Label/Mono Font:** tidak ada yang berbeda; `code` memakai warisan body.

**Character:** Netral teknis dan presisi; hierarki dibangun dari ukuran dan bobot, bukan dari pergantian font.

### Hierarchy
- **Headline** (800, 1.25rem, 1.2): judul halaman dashboard.
- **Title** (700, 1rem, 1.3): nama asisten, judul kartu.
- **Body** (400, 0.875rem, 1.55): isi chat, baris bukti, tabel.
- **Label** (600, 0.75rem, 1.4): label field, meta, timestamp.
- **Eyebrow** (600, 0.65rem, spasi 0.05em, uppercase): penanda seksi ("Analisis", "Asisten • Dexmin SSE").

### Named Rules
**The Single Family Rule.** Tidak ada font kedua tanpa keputusan eksplisit; keluhan "Inter overused" dari luar tidak berlaku di sini — keseragaman adalah fitur ruang kontrol.

## Layout

Model spasial: sidebar tetap 260px + konten cair (`padding` 1.5rem); halaman chat menyempit ke kolom tengah 768px penuh-tinggi (`100dvh`) dengan daftar pesan sebagai satu-satunya area scroll dan composer menempel di bawah. Ritme jarak 4/8/16/24px. Responsif: di bawah 900px sidebar menjadi laci geser; di bawah 640px bubble chat melebar hingga 92% dan tinggi kolom menyesuaikan viewport.

## Elevation & Depth

Datar secara default; kedalaman hanya sebagai respons status, bukan dekorasi.

### Shadow Vocabulary
- **Respons fokus** (`box-shadow: 0 0 0 4px rgba(22, 163, 74, 0.15)`): cincin fokus hijau pada kontrol grafik.
- **Jejak toast** (`box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18)`): satu-satunya bayangan angkat, khusus notifikasi melayang.
- **Sentuh kartu** (`box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05)`): nyaris tak terlihat, pemisah halus.

### Named Rules
**The Flat-By-Default Rule.** Permukaan diam itu datar; bayangan muncul hanya sebagai jawaban atas status (hover, fokus, toast).

## Shapes

Bahasa bentuk: pil untuk status dan pilihan (999px), kartu 12px, kontrol 8px, chat 14px dengan sudut tajam 4px di sisi pembicara pada bubble user (14px 14px 4px 14px). Bingkai 1px garis netral di mana-mana; tanpa clipping atau siluet khusus.

## Components

### Buttons
- **Character:** tertahan dan presisi; teks murni, tanpa ikon.
- **Shape:** sudut 8px (kontrol).
- **Primary:** Biru Sinyal Kontrol + putih, padding 0.55rem 1.1rem; hover Biru Dalam (#1d4ed8).
- **Ghost/Stop:** putih + Tinta Lembut, bingkai Garis Tegas.
- **Focus:** cincin respons fokus; **Disabled:** opacity 0.55.

### Chips (saran chat)
- **Style:** putih, teks Tinta Lembut, pil bingkai Garis Tegas.
- **State:** hover menjadi siraman biru + teks biru; disabled opacity 0.5.

### Cards / Containers
- **Corner Style:** lembut fungsional (12px).
- **Background:** Putih Permukaan di atas Kertas Ruang Kontrol.
- **Shadow Strategy:** lihat Elevation — datar saat diam.
- **Border:** 1px Garis/Abu Panel.
- **Internal Padding:** 1.5rem (kartu dashboard), 0.5–0.9rem (chat).

### Inputs / Fields
- **Style:** putih, bingkai Garis Tegas, sudut 8px; composer chat 14px dengan fokus biru pada bingkai wadah.
- **Focus:** pergeseran warna bingkai (bukan glow).
- **Error / Disabled:** banner Bahaya-siraman + tombol Coba lagi; input dikunci (disabled) hanya selama stream berjalan.

### Navigation
- Sidebar putih, item 0.9rem/500; hover abu sunyi + bingkai; aktif siraman biru + teks biru 700 + bilah aksen 3px di kiri. Mobile: laci geser dengan transisi 0.2s.

### Chat Thread (signature component)
- Kolom 768px; baris pesan flex dengan monogram 32px (D gelap untuk asisten, U biru untuk user); bubble user biru kanan; teks asisten polos kiri; footer meta 0.7rem Abu Panel + `<details>` penalaran tertutup; kursor streaming 8px biru berkedip; titik mengetik 3×7px.

## Do's and Don'ts

### Do:
- **Do** pakai Biru Sinyal Kontrol hanya untuk aksi primer, status, dan identitas pembicara user.
- **Do** tulis antarmuka dalam Bahasa Indonesia yang operasional ("Masih mencari referensi…", bukan kode error mentah).
- **Do** hormati `prefers-reduced-motion` pada setiap animasi baru.
- **Do** pertahankan rasio teks kecil (≥0.7rem) dan target sentuh yang lega pada tombol chat.

### Don't:
- **Don't** tambah keluarga font kedua atau ikon dekoratif — monogram inisial adalah pengganti avatar.
- **Don't** pakai gradien, glow, atau bayangan angkat di luar kosakata Elevation.
- **Don't** render nilai acak/unik (UUID, waktu-sekarang) ke HTML server — pemicu hidrasi #418.
- **Don't** gzip-kan SSE (`compress: false` lestari) atau menghaluskan garis grafik (`connectNulls: false`, tanpa fill).
- **Don't** kirim kolom tampil-saja (`at`) ke kontrak LLM; history hanya `{role, text}`.
