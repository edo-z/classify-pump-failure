-- 04_pump_classification_config.sql — operating setpoint + reference override per pompa.
-- Kompatibel MySQL 8.x (validasi utama 8.4.x). Idempotent.
-- Prasyarat: tabel `pumps` sudah ada. Jalankan di `dexmin`.
-- SENGAJA TANPA SEED: tidak ada record = gunakan konfigurasi default
-- (flowheads / profil). Jangan membuat record yang belum diperlukan.
--
-- Semantik fallback per kolom (untuk configuration_resolver Fase 2):
--   tidak ada record      -> gunakan default (flowheads reference / profil setpoint)
--   kolom NULL            -> fallback per kolom tersebut
--   ada nilai non-NULL    -> override spesifik pompa tersebut
--
-- Contoh Pompa 12 (profil 3000_lps, default 38 Hz) yang di-set 40 Hz:
--   pump_id=12, operating_freq_hz=40, kolom lain NULL
--   -> frekuensi 40 Hz, sisanya mewarisi default.
--
-- Tabel ini HANYA menyimpan operating setpoint + reference override.
-- Threshold PTS (10 Hz, 110%, 100 RPM) dan DRY_RUN (70%) tetap milik
-- rules.json; persamaan klasifikasi tetap tanggung jawab Classification Engine.
-- Tanpa kolom prioritas. Tanpa trigger DB.

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
    FOREIGN KEY (`pump_id`)
    REFERENCES `pumps` (`id`)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
