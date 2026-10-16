-- raw_classifications.sql — audit log SEMUA evaluasi engine.
-- Kompatibel MySQL 8.x. Idempotent. Prasyarat: `pumps` sudah ada.
-- 1 pump x 1 tick = 9 baris (8 RuleEvaluation + sintesis `normal`).
-- evaluated_at = event-time (diisi worker, penentu dedup); is_triggered:
-- 1 = MATCH; incomplete tercatat apa adanya, BUKAN auto-normal.
-- failure_type ENUM (DB menolak string liar); tanpa master kategori,
-- tanpa namespace, tanpa created_at (slim 08).
CREATE TABLE IF NOT EXISTS `raw_classifications` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `pump_id` bigint unsigned NOT NULL,
  `failure_type` enum('banyak_sampah','dry_run','normal','overvoltage','panel_overheat','pompa_tersangkut_sampah','turbulensi','unbalance','undervoltage') COLLATE utf8mb4_unicode_ci NOT NULL,
  `evaluated_at` datetime NOT NULL,
  `is_triggered` tinyint(1) NOT NULL DEFAULT '0',
  `raw_data` json DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_raw_pump_time` (`pump_id`,`evaluated_at`),
  KEY `idx_raw_triggered` (`is_triggered`),
  KEY `idx_raw_type_time` (`failure_type`,`evaluated_at`),
  CONSTRAINT `raw_classifications_pump_fk` FOREIGN KEY (`pump_id`) REFERENCES `pumps` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
