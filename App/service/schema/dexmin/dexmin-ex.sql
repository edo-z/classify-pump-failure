-- ============================================================================
-- DEXMIN — Example Configuration Resolution (READ-ONLY)
-- MySQL 8.0.16+ / 8.4. Assumes dexmin_configuration_schema.sql exists.
-- Set the DEX identity before testing. Change '34' to a registered ID.
-- This is a reference for ConfigurationProvider, not a runtime SQL contract.
-- ============================================================================
USE `dexmin`;
SET @dex_pump_id := '34';

SET TRANSACTION ISOLATION LEVEL REPEATABLE READ;
START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY;

WITH
pump_context AS (
  SELECT `id`, `flowhead_capacity`, `vsd_type_id`
  FROM `pumps`
  WHERE `dex_pump_id` = @dex_pump_id
),
candidates AS (
  SELECT c.`parameter_id`, c.`numeric_value`, 'PUMP' AS `source_scope`, 1 AS `priority`
  FROM `pump_config` c
  JOIN pump_context p ON p.`id` = c.`pump_id`

  UNION ALL
  SELECT c.`parameter_id`, c.`numeric_value`, 'FLOWHEAD', 2
  FROM `flowhead_config` c
  JOIN pump_context p ON p.`flowhead_capacity` = c.`flowhead_capacity`

  UNION ALL
  SELECT c.`parameter_id`, c.`numeric_value`, 'VFD', 2
  FROM `vfd_config` c
  JOIN pump_context p ON p.`vsd_type_id` = c.`vsd_type_id`

  UNION ALL
  SELECT c.`parameter_id`, c.`numeric_value`, 'GLOBAL', 3
  FROM `global_config` c
  JOIN pump_context p ON TRUE  -- prevents global fallback for unknown Pump
),
ranked AS (
  SELECT `parameter_id`, `numeric_value`, `source_scope`,
         ROW_NUMBER() OVER (
           PARTITION BY `parameter_id` ORDER BY `priority`
         ) AS `position`
  FROM candidates
)
SELECT p.`id` AS `pump_id`, d.`code`, d.`failure_id`,
       d.`fallback_scope`, d.`value_kind`, d.`unit`,
       r.`numeric_value`, r.`source_scope`
FROM pump_context p
CROSS JOIN `config_parameter_definitions` d
LEFT JOIN ranked r ON r.`parameter_id` = d.`id` AND r.`position` = 1
ORDER BY d.`code`;

COMMIT;

-- Empty result: pump is not registered OR catalog has no parameters.
-- The provider must distinguish these cases with a registered-pump check
-- performed within the SAME snapshot (not a second independent transaction).
-- A row with numeric_value IS NULL means NO CONFIGURED VALUE (Q14).
-- Follow the snapshot rule for every classification, including when updates
-- occur concurrently. Do not fetch each parameter in separate transactions.
