-- pump_classifications.sql — event operasional berdurasi (lifecycle saja).
-- Kompatibel MySQL 8.x. Idempotent. Prasyarat: `pumps` sudah ada.
-- Baris dibuat debounce worker (BUKAN trigger DB); normal tak pernah
-- jadi event; ended_at NULL = masih berlangsung. TANPA evidence
-- (detail di raw_data). DITUNDA penggunaannya (diskusi internal).
CREATE TABLE IF NOT EXISTS `pump_classifications` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `pump_id` bigint unsigned NOT NULL,
  `failure_type` enum('banyak_sampah','dry_run','normal','overvoltage','panel_overheat','pompa_tersangkut_sampah','turbulensi','unbalance','undervoltage') COLLATE utf8mb4_unicode_ci NOT NULL,
  `started_at` datetime NOT NULL,
  `ended_at` datetime DEFAULT NULL,
  `trigger_count` int unsigned NOT NULL DEFAULT '1',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_event_pump_started` (`pump_id`,`started_at`),
  KEY `idx_event_type_started` (`failure_type`,`started_at`),
  CONSTRAINT `pump_classifications_pump_fk` FOREIGN KEY (`pump_id`) REFERENCES `pumps` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
