-- 03_pump_classifications.sql — event operasional berdurasi (lifecycle failure saja).
-- Kompatibel MySQL 8.x (validasi utama 8.4.x). Idempotent.
-- Prasyarat: tabel `pumps` dan `failure_categories` sudah ada. Jalankan di `dexmin`.
--
-- Baris di sini dibuat oleh debounce/persistence worker (BUKAN trigger DB):
--   TRUE  + persistence terpenuhi -> 1 event (started_at terisi, ended_at NULL = masih berlangsung).
--   FALSE                      -> tidak pernah jadi event.
--   normal                     -> direkam di raw, TIDAK PERNAH jadi event.
--
-- ended_at NULL = event masih berlangsung; terisi saat kembali normal / event selesai.
-- TANPA kolom evidence: detail teknis tetap di raw_classifications.raw_data,
-- tabel ini hanya lifecycle (tidak ada duplikasi data). Tanpa kolom prioritas.

CREATE TABLE IF NOT EXISTS `pump_classifications` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,

  `pump_id` bigint unsigned NOT NULL,
  `failure_category_id` bigint unsigned NOT NULL,

  `namespace` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,

  `started_at` datetime NOT NULL,
  `ended_at` datetime DEFAULT NULL,

  `trigger_count` int unsigned NOT NULL DEFAULT 1,

  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (`id`),

  KEY `idx_event_pump_started` (`pump_id`, `started_at`),
  KEY `idx_event_category_started` (`failure_category_id`, `started_at`),

  CONSTRAINT `pump_classifications_pump_fk`
    FOREIGN KEY (`pump_id`)
    REFERENCES `pumps` (`id`)
    ON DELETE CASCADE,

  CONSTRAINT `pump_classifications_category_fk`
    FOREIGN KEY (`failure_category_id`)
    REFERENCES `failure_categories` (`id`)
    ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
