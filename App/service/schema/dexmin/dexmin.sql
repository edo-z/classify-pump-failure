-- ============================================================================
-- DEXMIN — Configuration Schema | MySQL 8.0.16+ / 8.4
-- Fresh database schema. NOT an in-place migration script.
-- Design decisions: Q1–Q16 (all locked).
--
-- DATABASE = configuration values and equipment identity.
-- TYPESCRIPT = mathematical equations, comparisons, windows, and state.
--
-- 3 retained master tables: pumps, parameter_definitions, failure_definitions
-- 1 configuration catalog: config_parameter_definitions
-- 4 independent value tables: pump_config, flowhead_config, vfd_config,
--                             global_config
--
-- The old failure_config table is deliberately NOT created. For an existing
-- DB, migrate existing values and validate consumers before dropping it.
--
-- NOTE: no DB triggers, rule interpreter, telemetry persistence, or history.
-- ============================================================================

CREATE DATABASE IF NOT EXISTS `dexmin`
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE `dexmin`;

-- 1. Registered pump is the mandatory root of resolution.
-- Equipment identity is authoritative here, NOT in incoming telemetry.
-- The units of flowhead_capacity are L/s (e.g. 500.00).
CREATE TABLE IF NOT EXISTS `pumps` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `dex_pump_id` VARCHAR(64) NOT NULL,
    `flowhead_capacity` DECIMAL(12,2) DEFAULT NULL,
    `vsd_type_id` INT UNSIGNED DEFAULT NULL,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uq_pumps_dex_pump_id` (`dex_pump_id`),
    CONSTRAINT `chk_pumps_flowhead` CHECK (
      `flowhead_capacity` IS NULL OR `flowhead_capacity` > 0
    ),
    CONSTRAINT `chk_pumps_vsd_type` CHECK (
      `vsd_type_id` IS NULL OR `vsd_type_id` > 0
    )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. Existing TELEMETRY parameter dictionary; not the config dictionary.
CREATE TABLE IF NOT EXISTS `parameter_definitions` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `parameter` VARCHAR(100) NOT NULL,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uq_telemetry_parameter` (`parameter`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. Existing failure catalog (8 failures + NORMAL).
CREATE TABLE IF NOT EXISTS `failure_definitions` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `failure` VARCHAR(100) NOT NULL,
    `name` VARCHAR(150) NOT NULL,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uq_failure_code` (`failure`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO `failure_definitions` (`failure`, `name`) VALUES
    ('pompa_tersangkut_sampah', 'Pompa Tersangkut Sampah'),
    ('turbulensi',              'Turbulensi'),
    ('banyak_sampah',           'Banyak Sampah'),
    ('unbalance',               'Unbalance Arus'),
    ('undervoltage',            'Undervoltage'),
    ('overvoltage',             'Overvoltage'),
    ('dry_run',                 'Dry Run'),
    ('panel_overheat',          'Panel Overheat'),
    ('normal',                  'Normal');

-- 4. CONFIGURATION parameter dictionary (separate from telemetry).
-- 'failure_id' NULL = shared parameter, NOT NULL = failure-specific parameter.
-- 'fallback_scope' fixes the equipment-specific lookup path:
--   FLOWHEAD => PUMP > FLOWHEAD > GLOBAL
--   VFD      => PUMP > VFD > GLOBAL
--   GLOBAL   => PUMP > GLOBAL
-- The same parameter code is shared across relevant trouble types.
-- Only numeric values are modeled in this iteration (setpoints/thresholds).
-- Application MUST enforce bounds and INTEGER semantics before writes;
-- ConfigurationProvider MUST revalidate values read from DB.
CREATE TABLE IF NOT EXISTS `config_parameter_definitions` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `code` VARCHAR(100) NOT NULL,
    `failure_id` BIGINT UNSIGNED DEFAULT NULL,
    `fallback_scope` ENUM('FLOWHEAD','VFD','GLOBAL') NOT NULL,
    `value_kind` ENUM('DECIMAL','INTEGER') NOT NULL DEFAULT 'DECIMAL',
    `unit` VARCHAR(24) NOT NULL,
    `min_value` DECIMAL(18,6) NOT NULL,
    `max_value` DECIMAL(18,6) NOT NULL,
    `description` VARCHAR(255) DEFAULT NULL,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uq_config_parameter_code` (`code`),
    UNIQUE KEY `uq_config_parameter_id_scope` (`id`, `fallback_scope`),
    KEY `idx_config_param_failure` (`failure_id`),
    CONSTRAINT `fk_config_parameter_failure`
      FOREIGN KEY (`failure_id`) REFERENCES `failure_definitions` (`id`),
    CONSTRAINT `chk_config_parameter_bounds` CHECK (`min_value` <= `max_value`),
    CONSTRAINT `chk_config_parameter_integer_bounds` CHECK (
      `value_kind` <> 'INTEGER' OR (
        `min_value` = FLOOR(`min_value`) AND
        `max_value` = FLOOR(`max_value`)
      )
    )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- 5. Pump-specific sparse overrides. One value per (pump, parameter).
CREATE TABLE IF NOT EXISTS `pump_config` (
    `pump_id` BIGINT UNSIGNED NOT NULL,
    `parameter_id` BIGINT UNSIGNED NOT NULL,
    `numeric_value` DECIMAL(18,6) NOT NULL,
    `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`pump_id`, `parameter_id`),
    KEY `idx_pump_config_parameter` (`parameter_id`),
    CONSTRAINT `fk_pump_config_pump` FOREIGN KEY (`pump_id`)
      REFERENCES `pumps` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_pump_config_parameter` FOREIGN KEY (`parameter_id`)
      REFERENCES `config_parameter_definitions` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 6. Flowhead-specific defaults (no flowheads master table per Q3/Q6).
-- Fixed fallback_scope + composite FK prohibit VFD/GLOBAL-only parameters.
CREATE TABLE IF NOT EXISTS `flowhead_config` (
    `flowhead_capacity` DECIMAL(12,2) NOT NULL,
    `parameter_id` BIGINT UNSIGNED NOT NULL,
    `fallback_scope` ENUM('FLOWHEAD','VFD','GLOBAL') NOT NULL DEFAULT 'FLOWHEAD',
    `numeric_value` DECIMAL(18,6) NOT NULL,
    `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`flowhead_capacity`, `parameter_id`),
    KEY `idx_flowhead_config_parameter_scope` (`parameter_id`, `fallback_scope`),
    CONSTRAINT `chk_flowhead_config_identity` CHECK (`flowhead_capacity` > 0),
    CONSTRAINT `chk_flowhead_config_scope` CHECK (`fallback_scope` = 'FLOWHEAD'),
    CONSTRAINT `fk_flowhead_config_parameter_scope`
      FOREIGN KEY (`parameter_id`, `fallback_scope`)
      REFERENCES `config_parameter_definitions` (`id`, `fallback_scope`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 7. VFD-specific defaults (no VFD master table per Q3/Q6).
CREATE TABLE IF NOT EXISTS `vfd_config` (
    `vsd_type_id` INT UNSIGNED NOT NULL,
    `parameter_id` BIGINT UNSIGNED NOT NULL,
    `fallback_scope` ENUM('FLOWHEAD','VFD','GLOBAL') NOT NULL DEFAULT 'VFD',
    `numeric_value` DECIMAL(18,6) NOT NULL,
    `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`vsd_type_id`, `parameter_id`),
    KEY `idx_vfd_config_parameter_scope` (`parameter_id`, `fallback_scope`),
    CONSTRAINT `chk_vfd_config_identity` CHECK (`vsd_type_id` > 0),
    CONSTRAINT `chk_vfd_config_scope` CHECK (`fallback_scope` = 'VFD'),
    CONSTRAINT `fk_vfd_config_parameter_scope`
      FOREIGN KEY (`parameter_id`, `fallback_scope`)
      REFERENCES `config_parameter_definitions` (`id`, `fallback_scope`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 8. Global fallback defaults. Missing values are ALLOWED (Q14): do not
-- invent zero or silently use a hidden TypeScript/JSON default.
CREATE TABLE IF NOT EXISTS `global_config` (
    `parameter_id` BIGINT UNSIGNED NOT NULL,
    `numeric_value` DECIMAL(18,6) NOT NULL,
    `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`parameter_id`),
    CONSTRAINT `fk_global_config_parameter` FOREIGN KEY (`parameter_id`)
      REFERENCES `config_parameter_definitions` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- ENGINEERING NOTES (not enforced by DDL alone)
-- ============================================================================
-- Q5: Unregistered dex_pump_id => reject classification; no global fallback.
-- Q8: Select by parameter: PUMP > relevant equipment > GLOBAL.
-- Q12: Composite PRIMARY KEYs prevent duplicate values within each scope.
-- Q13: Conflicting incoming Flowhead/VFD metadata: log mismatch externally;
--      do not allow telemetry to override pumps attributes.
-- Q14: Unknown parameter value at all levels => only dependent trouble types
--      become "Belum Dapat Di Klasifikasi"; DB connectivity errors differ.
-- Q15: Cross-table min/max and INTEGER-vs-DECIMAL validations are NOT
--      expressible with MySQL CHECK. Enforce at the configuration write API
--      and independently during ConfigurationProvider reads. Run strict SQL mode.
-- Q16: Read registered pump + all configs within one REPEATABLE READ snapshot,
--      then construct an immutable Typed Configuration for one evaluation.
-- No seed values are invented: populate catalog codes, engineering limits,
-- actual pump identities and scope-specific values from verified engine specs.
-- ============================================================================