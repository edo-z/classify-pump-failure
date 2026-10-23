-- ============================================================================
-- DEXMIN - FINAL DATABASE SCHEMA (7 TABEL + 1 STRUCTURE ONLY)
-- MySQL 8.0 / 8.4 | Dev / database baru
-- ============================================================================
-- TUJUAN
--   1. Sumber data pompa       : flowheads, pumps, parameter_definitions,
--                              pump_realtimes
--   2. Pengaturan klasifikasi  : classification_config
--   3. Jenis gangguan         : failure_types
--   4. Riwayat gangguan       : pump_classifications (belum diaktifkan)
--   5. Riwayat telemetry      : pump_telemetry_history (structure only)
--
-- KEPUTUSAN DESAIN
--   - Tidak menggunakan raw_classifications atau failure_categories.
--   - Referensi daya/arus hanya ada pada classification_config.
--   - operating_torque menggunakan satuan persen (%).
--   - Normal adalah kondisi engine, BUKAN jenis gangguan di failure_types.
--   - Rumus klasifikasi tetap di aplikasi, bukan di database.
--   - Tidak ada trigger atau debounce dalam file ini.
--   - pumps.dex_pump_id = external DEX identity (NOT NULL, UNIQUE)
--   - pumps.flowhead_id = nullable until authoritative assignment
--   - pump_realtimes = latest state per pump+parameter (enforced by unique key)
--   - pump_telemetry_history = append-only historian (structure only, no writes this phase)
--
-- PERHATIAN
--   - Ditujukan untuk schema baru/kosong atau audit rancangan.
--   - CREATE TABLE IF NOT EXISTS TIDAK memigrasikan struktur tabel lama.
--   - JANGAN jalankan langsung pada database eksisting tanpa audit/migrasi.
--   - Tidak ada DROP, DELETE, atau penghapusan data dalam file ini.
-- ============================================================================

CREATE DATABASE IF NOT EXISTS `dexmin`
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE `dexmin`;

-- 1. Jenis / kapasitas pompa; referensi klasifikasi tidak disimpan di sini.
CREATE TABLE IF NOT EXISTS `flowheads` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `type_flowhead` VARCHAR(100) NOT NULL,
    PRIMARY KEY (`id`),
    KEY `idx_flowheads_type` (`type_flowhead`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. Identitas pompa: external DEX identity + optional flowhead.
CREATE TABLE IF NOT EXISTS `pumps` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `dex_pump_id` VARCHAR(64) NOT NULL,
    `flowhead_id` BIGINT UNSIGNED DEFAULT NULL,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uq_pumps_dex_pump_id` (`dex_pump_id`),
    KEY `idx_pumps_flowhead` (`flowhead_id`),
    CONSTRAINT `fk_pumps_flowhead`
        FOREIGN KEY (`flowhead_id`) REFERENCES `flowheads` (`id`)
        ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. Kamus parameter telemetry, misalnya motor_current, output_frequency.
CREATE TABLE IF NOT EXISTS `parameter_definitions` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `key` VARCHAR(100) NOT NULL,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uq_parameter_definitions_key` (`key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4. Pembacaan sensor. Satu baris per pompa+parameter (latest state).
--    Unique key enforces single latest row per pump+parameter.
--    updated_at tracks the event timestamp (normalized to UTC).
--    NULL pada value berarti data tidak tersedia, BUKAN nilai nol.
CREATE TABLE IF NOT EXISTS `pump_realtimes` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `pump_id` BIGINT UNSIGNED NOT NULL,
    `parameter_definition_id` BIGINT UNSIGNED NOT NULL,
    `value` VARCHAR(255) DEFAULT NULL,
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`),
    UNIQUE KEY `uq_pump_realtime_parameter` (`pump_id`, `parameter_definition_id`),
    KEY `idx_realtime_parameter` (`parameter_definition_id`),
    CONSTRAINT `fk_realtime_pump`
        FOREIGN KEY (`pump_id`) REFERENCES `pumps` (`id`)
        ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT `fk_realtime_parameter`
        FOREIGN KEY (`parameter_definition_id`) REFERENCES `parameter_definitions` (`id`)
        ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 5. Semua reference dan operating setpoint klasifikasi per pompa.
--    Satu pompa maksimum satu konfigurasi; NULL berarti fallback ke profil
--    bawaan engine (BUKAN ke kolom reference di flowheads).
CREATE TABLE IF NOT EXISTS `classification_config` (
    `pump_id` BIGINT UNSIGNED NOT NULL,
    `operating_freq_hz` DECIMAL(8,2) DEFAULT NULL,
    `operating_rpm` DECIMAL(8,2) DEFAULT NULL,
    `operating_torque` DECIMAL(8,2) DEFAULT NULL, -- satuan: persen (%)
    `ref_power_kw` DECIMAL(10,3) DEFAULT NULL,
    `ref_current_a` DECIMAL(10,2) DEFAULT NULL,
    `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`pump_id`),
    CONSTRAINT `fk_classification_config_pump`
        FOREIGN KEY (`pump_id`) REFERENCES `pumps` (`id`)
        ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 6. Master jenis gangguan (8 jenis, telah disepakati).
--    `failure` = identitas kode untuk Classification Engine (kecocokan TroubleType).
--    `name`    = label tampilan aplikasi.
--    Kondisi Normal TIDAK dimasukkan karena bukan jenis gangguan.
CREATE TABLE IF NOT EXISTS `failure_types` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `failure` VARCHAR(100) NOT NULL,
    `name` VARCHAR(150) NOT NULL,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uq_failure_types_failure` (`failure`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Seed idempotent: aman dijalankan ulang.
INSERT INTO `failure_types` (`failure`, `name`) VALUES
    ('pompa_tersangkut_sampah', 'Pompa Tersangkut Sampah'),
    ('turbulensi',              'Turbulensi'),
    ('banyak_sampah',           'Banyak Sampah'),
    ('unbalance',               'Unbalance Arus'),
    ('undervoltage',            'Undervoltage'),
    ('overvoltage',             'Overvoltage'),
    ('dry_run',                 'Dry Run'),
    ('panel_overheat',          'Panel Overheat')
ON DUPLICATE KEY UPDATE `name` = VALUES(`name`);

-- 7. Riwayat gangguan per pompa. STRUKTUR SAJA: mekanisme pencatatan
--    gangguan belum diaktifkan sampai pembahasan internal selesai.
--    ended_at NULL berarti gangguan masih berlangsung.
CREATE TABLE IF NOT EXISTS `pump_classifications` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `pump_id` BIGINT UNSIGNED NOT NULL,
    `type_failure` BIGINT UNSIGNED NOT NULL,
    `started_at` DATETIME NOT NULL,
    `ended_at` DATETIME DEFAULT NULL,
    `trigger_count` INT UNSIGNED NOT NULL DEFAULT 1,
    PRIMARY KEY (`id`),
    KEY `idx_pump_classifications_pump` (`pump_id`, `started_at`),
    KEY `idx_pump_classifications_failure` (`type_failure`),
    CONSTRAINT `fk_pump_classifications_pump`
        FOREIGN KEY (`pump_id`) REFERENCES `pumps` (`id`)
        ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT `fk_pump_classifications_failure`
        FOREIGN KEY (`type_failure`) REFERENCES `failure_types` (`id`)
        ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 8. Riwayat telemetry per pompa. STRUCTURE ONLY: tidak ditulis pada phase ini.
--    Append-only historian untuk RCA, trends, analytics, model training, replay.
--    Dibedakan dari pump_realtimes (latest state) agar semantik jelas:
--      pump_realtimes         -> what is happening now
--      pump_telemetry_history -> what happened before
CREATE TABLE IF NOT EXISTS `pump_telemetry_history` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `pump_id` BIGINT UNSIGNED NOT NULL,
    `parameter_definition_id` BIGINT UNSIGNED NOT NULL,
    `value` VARCHAR(255) DEFAULT NULL,
    `recorded_at` DATETIME(3) NOT NULL,
    PRIMARY KEY (`id`),
    KEY `idx_history_pump_time` (`pump_id`, `recorded_at`),
    KEY `idx_history_parameter` (`parameter_definition_id`),
    CONSTRAINT `fk_history_pump`
        FOREIGN KEY (`pump_id`) REFERENCES `pumps` (`id`)
        ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT `fk_history_parameter`
        FOREIGN KEY (`parameter_definition_id`) REFERENCES `parameter_definitions` (`id`)
        ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;