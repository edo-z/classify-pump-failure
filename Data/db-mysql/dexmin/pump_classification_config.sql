-- pump_classification_config.sql — operating setpoint + reference
-- override per pompa. Kompatibel MySQL 8.x. Idempotent.
-- Prasyarat: `pumps` sudah ada. SENGAJA TANPA SEED: tanpa record =
-- default (flowheads/profil); kolom NULL = fallback per kolom.
-- Threshold milik rules.json; persamaan milik engine.
CREATE TABLE IF NOT EXISTS `pump_classification_config` (
  `pump_id` bigint unsigned NOT NULL,
  `operating_freq_hz` decimal(8,2) DEFAULT NULL,
  `operating_rpm` decimal(8,2) DEFAULT NULL,
  `operating_torque_pct` decimal(8,2) DEFAULT NULL,
  `ref_power_kw` decimal(10,3) DEFAULT NULL,
  `ref_current_a` decimal(10,2) DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`pump_id`),
  CONSTRAINT `pump_classification_config_pump_fk`
    FOREIGN KEY (`pump_id`) REFERENCES `pumps` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
