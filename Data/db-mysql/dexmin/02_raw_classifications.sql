-- 02_raw_classifications.sql — audit log SEMUA evaluasi engine (trigger maupun tidak).
-- Kompatibel MySQL 8.x (validasi utama 8.4.x). Idempotent.
-- Prasyarat: tabel `pumps` dan `failure_categories` sudah ada. Jalankan di `dexmin`.
--
-- Bentuk audit paling transparan: 1 pump x 1 tick evaluasi = 9 baris
-- (satu per failure_category, termasuk `normal` dan yang tidak trigger).
--
--   evaluated_at = MAX(updated_at parameter snapshot yang dipakai) [event-time],
--                  BUKAN NOW(). Freshness gate + dedup event-time dikerjakan
--                  DB ingest worker sebelum INSERT (bukan logic engine).
--   created_at   = kapan hasil classification masuk database [ingestion-time].
--   is_triggered : 1 = MATCH, 0 = NO_MATCH.
--   raw_data     : {evaluation_status, sensor_snapshot, reference,
--                   matched_conditions[], total_conditions, missing_requirements[]}.
--                   TANPA score — rasio matched/total hanya field di JSON.
--
-- Database menyimpan hasil, TIDAK mengambil alih logic classification
-- (tidak ada trigger DB yang membuat event dari raw).

CREATE TABLE IF NOT EXISTS `raw_classifications` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,

  `pump_id` bigint unsigned NOT NULL,
  `failure_category_id` bigint unsigned NOT NULL,

  `namespace` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,

  `evaluated_at` datetime NOT NULL,

  `is_triggered` tinyint(1) NOT NULL DEFAULT 0,

  `raw_data` json DEFAULT NULL,

  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (`id`),

  KEY `idx_raw_pump_time` (`pump_id`, `evaluated_at`),
  KEY `idx_raw_category_time` (`failure_category_id`, `evaluated_at`),
  KEY `idx_raw_triggered` (`is_triggered`),

  CONSTRAINT `raw_classifications_pump_fk`
    FOREIGN KEY (`pump_id`)
    REFERENCES `pumps` (`id`)
    ON DELETE CASCADE,

  CONSTRAINT `raw_classifications_category_fk`
    FOREIGN KEY (`failure_category_id`)
    REFERENCES `failure_categories` (`id`)
    ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
