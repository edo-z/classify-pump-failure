-- ============================================================================
-- DEXMIN — Configuration Database (Readable SQL)
-- MySQL 8.0.16+ / MySQL 8.4 | Database baru, BUKAN skrip migrasi
--
-- DATABASE   : identitas equipment, master gangguan, referensi, pengaturan runtime
-- TYPESCRIPT : definisi kode parameter, satuan yang valid, rumus, dan state
--
-- 6 tabel: pumps, parameter_definitions, failure_definitions,
--          flowhead_config, vsd_config, runtime_config
--
-- Konvensi nama: unique_*, reference_*, check_*, index_*
-- Kapasitas Flowhead dan nilai runtime: bilangan bulat.
-- Nilai setpoint/threshold Flowhead dan VFD: maksimal 2 angka desimal.
-- Faktor Dry Run 0.667 tetap tepat jika ditulis 66.70 dengan unit '%'
-- lalu ConfigurationProvider mengonversi 66.70 / 100 = 0.667.
-- ============================================================================

CREATE DATABASE IF NOT EXISTS `dexmin`
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE `dexmin`;

-- 1. Identitas pompa (wajib dicari sebelum membaca konfigurasi).
CREATE TABLE IF NOT EXISTS `pumps` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `pumpId` VARCHAR(64) NOT NULL,
    `flowhead_capacity` INT UNSIGNED DEFAULT NULL,
    `vsd_type_id` INT UNSIGNED DEFAULT NULL,

    PRIMARY KEY (`id`),
    UNIQUE KEY `unique_pumps_pump_id` (`pumpId`),

    CONSTRAINT `check_pumps_flowhead_capacity_positive`
        CHECK (`flowhead_capacity` IS NULL OR `flowhead_capacity` > 0),
    CONSTRAINT `check_pumps_vsd_type_positive`
        CHECK (`vsd_type_id` IS NULL OR `vsd_type_id` > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. Kamus nama parameter telemetry, bukan data hasil sensor.
CREATE TABLE IF NOT EXISTS `parameter_definitions` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `parameter` VARCHAR(100) NOT NULL,
    `unit` VARCHAR(24) DEFAULT NULL,

    PRIMARY KEY (`id`),
    UNIQUE KEY `unique_telemetry_parameter` (`parameter`),

    CONSTRAINT `check_telemetry_parameter_not_empty`
        CHECK (CHAR_LENGTH(TRIM(`parameter`)) > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. Kamus 8 jenis gangguan + NORMAL.
CREATE TABLE IF NOT EXISTS `failure_definitions` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `failure` VARCHAR(100) NOT NULL,
    `name` VARCHAR(150) NOT NULL,

    PRIMARY KEY (`id`),
    UNIQUE KEY `unique_failure_code` (`failure`),

    CONSTRAINT `check_failure_code_not_empty`
        CHECK (CHAR_LENGTH(TRIM(`failure`)) > 0),
    CONSTRAINT `check_failure_name_not_empty`
        CHECK (CHAR_LENGTH(TRIM(`name`)) > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4. Nilai konfigurasi berdasarkan kapasitas Flowhead (L/s).
-- failure_id NULL berarti parameter bersama (shared).
-- turbulensi_window dikelola dalam runtime_config, bukan tabel ini.
CREATE TABLE IF NOT EXISTS `flowhead_config` (
    `flowhead_capacity` INT UNSIGNED NOT NULL,
    `code` VARCHAR(100) NOT NULL,
    `failure_id` BIGINT UNSIGNED DEFAULT NULL,
    `numeric_value` DECIMAL(18,2) NOT NULL,
    `unit` VARCHAR(24) NOT NULL,
    `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (`flowhead_capacity`, `code`),
    INDEX `index_flowhead_failure_id` (`failure_id`),

    CONSTRAINT `reference_flowhead_failure_definition`
        FOREIGN KEY (`failure_id`) REFERENCES `failure_definitions` (`id`),
    CONSTRAINT `check_flowhead_capacity_positive`
        CHECK (`flowhead_capacity` > 0),
    CONSTRAINT `check_flowhead_code_not_empty`
        CHECK (CHAR_LENGTH(TRIM(`code`)) > 0),
    CONSTRAINT `check_flowhead_unit_not_empty`
        CHECK (CHAR_LENGTH(TRIM(`unit`)) > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 5. Nilai konfigurasi berdasarkan tipe VFD.
CREATE TABLE IF NOT EXISTS `vsd_config` (
    `vsd_type_id` INT UNSIGNED NOT NULL,
    `code` VARCHAR(100) NOT NULL,
    `failure_id` BIGINT UNSIGNED DEFAULT NULL,
    `numeric_value` DECIMAL(18,2) NOT NULL,
    `unit` VARCHAR(24) NOT NULL,
    `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (`vsd_type_id`, `code`),
    INDEX `index_vfd_failure_id` (`failure_id`),

    CONSTRAINT `reference_vfd_failure_definition`
        FOREIGN KEY (`failure_id`) REFERENCES `failure_definitions` (`id`),
    CONSTRAINT `check_vfd_type_positive`
        CHECK (`vsd_type_id` > 0),
    CONSTRAINT `check_vfd_code_not_empty`
        CHECK (CHAR_LENGTH(TRIM(`code`)) > 0),
    CONSTRAINT `check_vfd_unit_not_empty`
        CHECK (CHAR_LENGTH(TRIM(`unit`)) > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 6. Kebijakan runtime yang dapat diedit melalui database.
-- Kedua parameter aktif saat ini bersifat bilangan bulat positif.
CREATE TABLE IF NOT EXISTS `runtime_config` (
    `code` VARCHAR(100) NOT NULL,
    `numeric_value` INT UNSIGNED NOT NULL,
    `unit` VARCHAR(24) NOT NULL,
    `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (`code`),

    CONSTRAINT `check_runtime_value_positive`
        CHECK (`numeric_value` > 0),
    CONSTRAINT `check_runtime_code_not_empty`
        CHECK (CHAR_LENGTH(TRIM(`code`)) > 0),
    CONSTRAINT `check_runtime_unit_not_empty`
        CHECK (CHAR_LENGTH(TRIM(`unit`)) > 0),
    CONSTRAINT `check_runtime_known_units`
        CHECK (
            (`code` = 'stagnation_limit' AND `unit` = 'count') OR
            (`code` = 'turbulensi_window' AND `unit` = 'samples')
        )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- DATA MASTER / NILAI RUNTIME YANG TELAH DISEPAKATI (AMAN DIJALANKAN ULANG)
-- ============================================================================

INSERT IGNORE INTO `failure_definitions` (`failure`, `name`) VALUES
    ('pompa_tersangkut_sampah', 'Pompa Tersangkut Sampah'),
    ('turbulensi', 'Turbulensi'),
    ('banyak_sampah', 'Banyak Sampah'),
    ('unbalance', 'Unbalance Arus'),
    ('undervoltage', 'Undervoltage'),
    ('overvoltage', 'Overvoltage'),
    ('dry_run', 'Dry Run'),
    ('panel_overheat', 'Panel Overheat'),
    ('normal', 'Normal');

INSERT IGNORE INTO `parameter_definitions` (`parameter`, `unit`) VALUES
    ('motor_speed', 'RPM'),
    ('output_frequency', 'Hz'),
    ('motor_current', 'A'),
    ('motor_torque', '%'),
    ('output_power', 'kW'),
    ('hours_run', 'h'),
    ('output_voltage', 'V'),
    ('ambient_temperature', '°C'),
    ('control_board_temperature', '°C'),
    ('inverter_temperature', '°C'),
    ('input_voltage', 'V'),
    ('flux_actual', NULL),
    ('motor_estimated_temperature', '°C'),
    ('arus_rms_u', 'A'),
    ('arus_rms_v', 'A'),
    ('arus_rms_w', 'A');

INSERT IGNORE INTO `runtime_config` (`code`, `numeric_value`, `unit`) VALUES
    ('stagnation_limit', 5, 'count'),
    ('turbulensi_window', 30, 'samples');

-- ============================================================================
-- CATATAN INTEGRASI
-- ============================================================================
-- 1. Unknown pumpId => reject; jangan fallback ke equipment telemetry.
-- 2. Pump identity -> flowhead_config / vsd_config; tidak ada override/global.
-- 3. Tidak ada config_parameter_definitions; TypeScript wajib memvalidasi
--    code, unit, failure_id, range nilai sebelum insert/update dan saat baca.
-- 4. Nilai konfigurasi yang tidak ada => readiness hanya gangguan terkait.
-- 5. Baca pump, flowhead, VFD, runtime dalam consistent DB snapshot.
-- 6. Konversi dry_run_power_factor: 66.70 % -> 0.667; current: 64 % -> 0.64.
-- 7. Perubahan ukuran turbulensi_window harus sesuai kebijakan MA/CMA.
-- 8. CREATE TABLE IF NOT EXISTS tidak memigrasikan tabel yang sudah ada.
-- 9. Script INSERT flowhead/vfd yang masih menggunakan DECIMAL capacity
--    perlu diselaraskan dengan flowhead_capacity INT UNSIGNED bila relevan.
-- ============================================================================
