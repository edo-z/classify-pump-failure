-- 01_failure_categories.sql — master vocabulary TroubleType (9 nilai, termasuk normal).
-- Kompatibel MySQL 8.x (validasi utama 8.4.x). Idempotent, aman dijalankan ulang.
-- Prasyarat: tidak ada (tabel mandiri). Jalankan di database `dexmin`.
--
-- Aturan semantik (ditegakkan di event worker, BUKAN via trigger DB):
--   normal -> boleh direkam di raw_classifications,
--             TIDAK PERNAH membuat baris di pump_classifications.
-- Tidak ada kolom prioritas: semua failure setara.
-- Seed memakai pola WHERE NOT EXISTS (bukan INSERT IGNORE) agar idempotent
-- terhadap slug yang sudah ada.

CREATE TABLE IF NOT EXISTS `failure_categories` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `slug` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `failure_categories_slug_unique` (`slug`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Seed 9 TroubleType yang dikenal backend classification engine.
INSERT INTO `failure_categories` (`slug`, `created_at`, `updated_at`)
SELECT 'banyak_sampah', NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM `failure_categories` WHERE `slug` = 'banyak_sampah');

INSERT INTO `failure_categories` (`slug`, `created_at`, `updated_at`)
SELECT 'dry_run', NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM `failure_categories` WHERE `slug` = 'dry_run');

INSERT INTO `failure_categories` (`slug`, `created_at`, `updated_at`)
SELECT 'normal', NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM `failure_categories` WHERE `slug` = 'normal');

INSERT INTO `failure_categories` (`slug`, `created_at`, `updated_at`)
SELECT 'overvoltage', NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM `failure_categories` WHERE `slug` = 'overvoltage');

INSERT INTO `failure_categories` (`slug`, `created_at`, `updated_at`)
SELECT 'panel_overheat', NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM `failure_categories` WHERE `slug` = 'panel_overheat');

INSERT INTO `failure_categories` (`slug`, `created_at`, `updated_at`)
SELECT 'pompa_tersangkut_sampah', NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM `failure_categories` WHERE `slug` = 'pompa_tersangkut_sampah');

INSERT INTO `failure_categories` (`slug`, `created_at`, `updated_at`)
SELECT 'turbulensi', NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM `failure_categories` WHERE `slug` = 'turbulensi');

INSERT INTO `failure_categories` (`slug`, `created_at`, `updated_at`)
SELECT 'unbalance', NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM `failure_categories` WHERE `slug` = 'unbalance');

INSERT INTO `failure_categories` (`slug`, `created_at`, `updated_at`)
SELECT 'undervoltage', NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM `failure_categories` WHERE `slug` = 'undervoltage');
