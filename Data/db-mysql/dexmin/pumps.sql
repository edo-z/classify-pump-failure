-- pumps.sql — stub identitas pompa (dev).
-- Kompatibel MySQL 8.x. Idempotent.
-- Stub minimal untuk lingkungan dev: production `pumps` memiliki banyak
-- kolom lain (lihat Data/db-mysql/dexpump/dexpump.sql legacy); di sini
-- hanya yang dibutuhkan worker: `id` + relasi opsional `flowhead_id`
-- (tanpa FK karena tabel `flowheads` tak ada di dev; FK penuh dibuat
-- saat `flowheads` tersedia). Terapkan PALING AWAL (target FK).
CREATE TABLE IF NOT EXISTS `pumps` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `flowhead_id` bigint unsigned DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
