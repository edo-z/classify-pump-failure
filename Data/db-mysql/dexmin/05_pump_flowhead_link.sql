-- 05_pump_flowhead_link.sql — ADENDUM: relasi pumps -> flowheads.
-- Kompatibel MySQL 8.x (validasi utama 8.4.x).
-- Status: SUDAH DITERAPKAN di live dexmin pada 2026-10-16
-- (smoke test ingest-only). File ini dokumentasi + replayability.
--
-- Konteks: stub pumps Opsi B awal hanya berkolom `id`. DB ingest
-- worker (app/ingest_db/reader.py) me-resolve profil via
-- pumps.flowhead_id -> flowheads.type_flowhead, dan tabel production
-- `pumps` memang memiliki kolom ini (lihat dexmpump.sql legacy).
-- Kolom dipertahankan RESMI (keputusan review smoke test), bukan
-- artefak sementara. Nullable, tanpa FK, 0 baris saat diterapkan.
--
-- CATATAN IDEMPOTENSI: MySQL tidak mendukung ADD COLUMN IF NOT EXISTS.
-- Periksa dulu: SHOW COLUMNS FROM pumps LIKE 'flowhead_id';
-- lewati file ini bila kolom sudah ada. Jangan dijalankan ulang
-- membabi-buta (error 1060 = kolom sudah ada = kondisi yang benar).
ALTER TABLE `pumps`
  ADD COLUMN `flowhead_id` BIGINT UNSIGNED NULL AFTER `id`;
