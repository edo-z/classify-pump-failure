-- ============================================================================
-- DEXMIN - Isi vfd_config untuk vsd_type_id 1 dan 2
-- Kompatibel dengan dexmin_schema_final_6_tabel.sql (tanpa parameter_id).
-- Data sumber:
--   - Input Voltage pada tabel pengguna: minimum 360 V, maksimum 410 V.
--   - Unbalance 10%: spesifikasi matematika DEXMIN yang telah disepakati,
--     bukan angka eksplisit di gambar tabel VFD.
--
-- Hanya 3 parameter untuk setiap tipe, total 6 baris.
-- Panel Overheat BELUM dimasukkan: gambar mencantumkan beberapa batas suhu
-- berbeda (ambient/control board/inverter), sedangkan field engine yang
-- dilaporkan hanya panelOverheatThresholdC tunggal.
-- Tidak menambahkan motor current, output power, motor speed, atau nilai lain
-- yang bergantung pada kapasitas Flowhead ke tabel VFD.
--
-- UPSERT memperbarui baris dengan pasangan (vsd_type_id, code) yang sama.
-- Pastikan failure_definitions sudah berisi unbalance, undervoltage,
-- dan overvoltage sebelum eksekusi.
-- ============================================================================

USE `dexmin`;

-- Cek terlebih dahulu bahwa master gangguan tersedia (harus 3 baris).
SELECT `id`, `failure`, `name`
FROM `failure_definitions`
WHERE `failure` IN ('unbalance', 'undervoltage', 'overvoltage')
ORDER BY `failure`;

START TRANSACTION;

INSERT INTO `vfd_config`
    (`vsd_type_id`, `code`, `failure_id`, `numeric_value`, `unit`)
SELECT
    src.`vsd_type_id`,
    src.`code`,
    fd.`id`,
    src.`numeric_value`,
    src.`unit`
FROM (
    SELECT 1 AS `vsd_type_id`, 'Treshold Unbalance' AS `code`,
           'unbalance' AS `failure_code`, 10.00 AS `numeric_value`, '%' AS `unit`
    UNION ALL SELECT 1, 'Treshold Undervoltage', 'undervoltage', 360.00, 'V'
    UNION ALL SELECT 1, 'Treshold Overvoltage',  'overvoltage',  410.00, 'V'
    UNION ALL SELECT 2, 'Treshold Unbalance', 'unbalance', 10.00, '%'
    UNION ALL SELECT 2, 'Treshold Undervoltage', 'undervoltage', 360.00, 'V'
    UNION ALL SELECT 2, 'Treshold Overvoltage',  'overvoltage',  410.00, 'V'
) AS src
INNER JOIN `failure_definitions` AS fd
    ON fd.`failure` = src.`failure_code`
WHERE 1 = 1
ON DUPLICATE KEY UPDATE
    `failure_id` = VALUES(`failure_id`),
    `numeric_value` = VALUES(`numeric_value`),
    `unit` = VALUES(`unit`);

-- Sebelum COMMIT: masing-masing tipe harus memiliki 3 parameter di bawah.
SELECT
    `vsd_type_id`,
    COUNT(*) AS `jumlah_parameter`
FROM `vfd_config`
WHERE `vsd_type_id` IN (1, 2)
  AND `code` IN (
      'Treshold Unbalance',
      'Treshold Undervoltage',
      'Treshold Overvoltage'
  )
GROUP BY `vsd_type_id`
ORDER BY `vsd_type_id`;

COMMIT;

-- Hasil akhir dari 6 konfigurasi yang diisikan.
SELECT
    vc.`vsd_type_id`,
    fd.`failure`,
    vc.`code`,
    vc.`numeric_value`,
    vc.`unit`
FROM `vfd_config` AS vc
LEFT JOIN `failure_definitions` AS fd
    ON fd.`id` = vc.`failure_id`
WHERE vc.`vsd_type_id` IN (1, 2)
  AND vc.`code` IN (
      'Treshold Unbalance',
      'Treshold Undervoltage',
      'Treshold Overvoltage'
  )
ORDER BY vc.`vsd_type_id`, vc.`code`;
