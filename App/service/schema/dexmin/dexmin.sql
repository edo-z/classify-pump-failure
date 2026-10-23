-- ============================================================================
-- DEXMIN - FINAL DATABASE SCHEMA (4 TABEL)
-- MySQL 8.0 / 8.4 | Dev / database baru
-- ============================================================================
-- TUJUAN
--   1. Sumber data pompa       : pumps, parameter_definitions
--   2. Konfigurasi failure     : failure_config, failure_definitions
--
-- KEPUTUSAN DESAIN
--   - Tidak menggunakan flowheads (profil engine dari file profile_setpoints.json)
--   - Tidak menggunakan pump_realtimes (persistence dinonaktifkan)
--   - Tidak menggunakan pump_classifications / pump_telemetry_history (belum diaktifkan)
--   - Rumus klasifikasi tetap di aplikasi, bukan di database
--   - Tidak ada trigger atau debounce dalam file ini
--   - pumps.dex_pump_id = external DEX identity (NOT NULL, UNIQUE)
-- ============================================================================

CREATE DATABASE IF NOT EXISTS `dexmin`
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE `dexmin`;

-- 1. Identitas pompa: external DEX identity (tanpa flowhead_id).
CREATE TABLE IF NOT EXISTS `pumps` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `dex_pump_id` VARCHAR(64) NOT NULL,
    PRIMARY KEY (`id`),
    UNIQUE KEY `pumps` (`dex_pump_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. Kamus parameter telemetry, misalnya motor_current, output_frequency.
CREATE TABLE IF NOT EXISTS `parameter_definitions` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `parameter` VARCHAR(100) NOT NULL,
    PRIMARY KEY (`id`),
    UNIQUE KEY `parameter_definitions` (`parameter`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. Konfigurasi failure per pompa.
--    Satu pompa maksimum satu konfigurasi; NULL berarti fallback ke profil
--    bawaan engine.
CREATE TABLE IF NOT EXISTS `failure_config` (
    `pump_id` BIGINT UNSIGNED NOT NULL,
    `operating_freq_hz` DECIMAL(8,2) DEFAULT NULL,
    `operating_rpm` DECIMAL(8,2) DEFAULT NULL,
    `operating_torque` DECIMAL(8,2) DEFAULT NULL, -- satuan: persen (%)
    `ref_power_kw` DECIMAL(10,3) DEFAULT NULL,
    `ref_current_a` DECIMAL(10,2) DEFAULT NULL,
    `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`pump_id`),
    CONSTRAINT `failure_config`
        FOREIGN KEY (`pump_id`) REFERENCES `pumps` (`id`)
        ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4. Master jenis gangguan (8 jenis gangguan + Normal).
--    `failure` = identitas kode untuk Classification Engine (kecocokan TroubleType).
--    `name`    = label tampilan aplikasi.
CREATE TABLE IF NOT EXISTS `failure_definitions` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `failure` VARCHAR(100) NOT NULL,
    `name` VARCHAR(150) NOT NULL,
    PRIMARY KEY (`id`),
    UNIQUE KEY `failure_types` (`failure`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Seed idempotent: aman dijalankan ulang.
INSERT INTO `failure_definitions` (`failure`, `name`) VALUES
    ('pompa_tersangkut_sampah', 'Pompa Tersangkut Sampah'),
    ('turbulensi',              'Turbulensi'),
    ('banyak_sampah',           'Banyak Sampah'),
    ('unbalance',               'Unbalance Arus'),
    ('undervoltage',            'Undervoltage'),
    ('overvoltage',             'Overvoltage'),
    ('dry_run',                 'Dry Run'),
    ('panel_overheat',          'Panel Overheat'),
    ('normal',                  'Normal')
ON DUPLICATE KEY UPDATE `name` = VALUES(`name`);