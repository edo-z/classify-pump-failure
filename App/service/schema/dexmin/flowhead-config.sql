-- DEXMIN / flowhead_config — penyesuaian skema terbaru (tanpa parameter_id)
-- MySQL 8.0.16+ / 8.4
-- Sumber: tabel gangguan Flowhead 500 / 3000 / 5000 L/s milik pengguna,
-- ditambah faktor Dry Run yang sudah disepakati di spesifikasi matematis.
-- Target: flowhead_config(flowhead_capacity, code, failure_id, numeric_value, unit)
-- 42 baris = 14 code x 3 kapasitas. UPSERT: menimpa baris yang cocok.
--
-- TIDAK dimasukkan: 5 parameter SHARED ('Sesuai data di Admin') yang
-- nilainya belum diberikan. turbulensi_window=30 dikelola dalam
-- runtime_config sesuai keputusan terbaru, bukan di flowhead_config.
--
-- PERHATIAN:
-- * Faktor Dry Run disimpan sebagai PERSEN demi batas 2 desimal:
--     dry_run_power_factor   = 66.70 % -> ratio 0.667 (dibagi 100 di TS)
--     dry_run_current_factor = 64.00 % -> ratio 0.64  (dibagi 100 di TS)
--   Provider WAJIB melakukan konversi ini; jangan langsung memperlakukan
--   66.70 atau 64.00 sebagai pengali ratio.
-- * Gambar sumber menyebut daya Dry Run <50/<166/<266 kW, yang TIDAK
--   sama persis dengan hasil faktor 0.667 x ref PTS tiap kapasitas.
--   Ketentuan ini belum terselesaikan; SQL hanya menyimpan faktor yang
--   disepakati, tidak menyimpan threshold absolut sebagai nilai baru.
-- * Gambar sumber menyebut PTS frekuensi <10 dan RPM <100, sedangkan
--   evaluator pernah dilaporkan memakai <=10 dan RPM >=100.
--   SQL menyimpan ANGKA, bukan operator. Jangan menganggap isu ini selesai.
-- * Kondisi turbulensi 'fluktuatif +/-20 A' dipetakan sebagai deviasi 20 A;
--   makna mathematical area tetap mengikuti implementasi TypeScript.
-- * Pastikan master failure_definitions sudah terisi sebelum eksekusi.

USE `dexmin`;

START TRANSACTION;

INSERT INTO `flowhead_config`
    (`flowhead_capacity`, `code`, `failure_id`, `numeric_value`, `unit`)
SELECT
    src.flowhead_capacity,
    src.code,
    fd.id,
    src.numeric_value,
    src.unit
FROM (
    SELECT 500 AS flowhead_capacity, 'pts_frequency_hz' AS code, 'pompa_tersangkut_sampah' AS failure_code, 10.00 AS numeric_value, 'Hz' AS unit
    UNION ALL SELECT 500, 'pts_power_ref_kw', 'pompa_tersangkut_sampah', 75.00, 'kW'
    UNION ALL SELECT 500, 'pts_current_ref_a', 'pompa_tersangkut_sampah', 157.00, 'A'
    UNION ALL SELECT 500, 'pts_torque_ref_pct', 'pompa_tersangkut_sampah', 110.00, '%'
    UNION ALL SELECT 500, 'pts_rpm_ref', 'pompa_tersangkut_sampah', 100.00, 'RPM'
    UNION ALL SELECT 500, 'turbulensi_power_ref_kw', 'turbulensi', 75.00, 'kW'
    UNION ALL SELECT 500, 'turbulensi_torque_ref_pct', 'turbulensi', 90.00, '%'
    UNION ALL SELECT 500, 'turbulensi_current_dev_threshold_a', 'turbulensi', 20.00, 'A'
    UNION ALL SELECT 500, 'banyak_sampah_power_ref_kw', 'banyak_sampah', 75.00, 'kW'
    UNION ALL SELECT 500, 'banyak_sampah_current_ref_a', 'banyak_sampah', 157.00, 'A'
    UNION ALL SELECT 500, 'banyak_sampah_torque_ref_pct', 'banyak_sampah', 90.00, '%'
    UNION ALL SELECT 500, 'dry_run_power_factor', 'dry_run', 66.70, '%'
    UNION ALL SELECT 500, 'dry_run_current_factor', 'dry_run', 64.00, '%'
    UNION ALL SELECT 500, 'dry_run_torque_threshold_pct', 'dry_run', 70.00, '%'
    UNION ALL SELECT 3000, 'pts_frequency_hz', 'pompa_tersangkut_sampah', 10.00, 'Hz'
    UNION ALL SELECT 3000, 'pts_power_ref_kw', 'pompa_tersangkut_sampah', 250.00, 'kW'
    UNION ALL SELECT 3000, 'pts_current_ref_a', 'pompa_tersangkut_sampah', 517.00, 'A'
    UNION ALL SELECT 3000, 'pts_torque_ref_pct', 'pompa_tersangkut_sampah', 110.00, '%'
    UNION ALL SELECT 3000, 'pts_rpm_ref', 'pompa_tersangkut_sampah', 100.00, 'RPM'
    UNION ALL SELECT 3000, 'turbulensi_power_ref_kw', 'turbulensi', 250.00, 'kW'
    UNION ALL SELECT 3000, 'turbulensi_torque_ref_pct', 'turbulensi', 90.00, '%'
    UNION ALL SELECT 3000, 'turbulensi_current_dev_threshold_a', 'turbulensi', 20.00, 'A'
    UNION ALL SELECT 3000, 'banyak_sampah_power_ref_kw', 'banyak_sampah', 250.00, 'kW'
    UNION ALL SELECT 3000, 'banyak_sampah_current_ref_a', 'banyak_sampah', 517.00, 'A'
    UNION ALL SELECT 3000, 'banyak_sampah_torque_ref_pct', 'banyak_sampah', 90.00, '%'
    UNION ALL SELECT 3000, 'dry_run_power_factor', 'dry_run', 66.70, '%'
    UNION ALL SELECT 3000, 'dry_run_current_factor', 'dry_run', 64.00, '%'
    UNION ALL SELECT 3000, 'dry_run_torque_threshold_pct', 'dry_run', 70.00, '%'
    UNION ALL SELECT 5000, 'pts_frequency_hz', 'pompa_tersangkut_sampah', 10.00, 'Hz'
    UNION ALL SELECT 5000, 'pts_power_ref_kw', 'pompa_tersangkut_sampah', 400.00, 'kW'
    UNION ALL SELECT 5000, 'pts_current_ref_a', 'pompa_tersangkut_sampah', 867.00, 'A'
    UNION ALL SELECT 5000, 'pts_torque_ref_pct', 'pompa_tersangkut_sampah', 110.00, '%'
    UNION ALL SELECT 5000, 'pts_rpm_ref', 'pompa_tersangkut_sampah', 100.00, 'RPM'
    UNION ALL SELECT 5000, 'turbulensi_power_ref_kw', 'turbulensi', 400.00, 'kW'
    UNION ALL SELECT 5000, 'turbulensi_torque_ref_pct', 'turbulensi', 90.00, '%'
    UNION ALL SELECT 5000, 'turbulensi_current_dev_threshold_a', 'turbulensi', 20.00, 'A'
    UNION ALL SELECT 5000, 'banyak_sampah_power_ref_kw', 'banyak_sampah', 400.00, 'kW'
    UNION ALL SELECT 5000, 'banyak_sampah_current_ref_a', 'banyak_sampah', 867.00, 'A'
    UNION ALL SELECT 5000, 'banyak_sampah_torque_ref_pct', 'banyak_sampah', 90.00, '%'
    UNION ALL SELECT 5000, 'dry_run_power_factor', 'dry_run', 66.70, '%'
    UNION ALL SELECT 5000, 'dry_run_current_factor', 'dry_run', 64.00, '%'
    UNION ALL SELECT 5000, 'dry_run_torque_threshold_pct', 'dry_run', 70.00, '%'
  ) AS src
INNER JOIN `failure_definitions` AS fd
    ON fd.failure = src.failure_code
WHERE 1 = 1
ON DUPLICATE KEY UPDATE
    `failure_id` = VALUES(`failure_id`),
    `numeric_value` = VALUES(`numeric_value`),
    `unit` = VALUES(`unit`);

-- Periksa jumlah di sini SEBELUM COMMIT; target 42 baris untuk kode berikut.
SELECT
    `flowhead_capacity`,
    COUNT(*) AS total_parameter
FROM `flowhead_config`
WHERE `flowhead_capacity` IN (500, 3000, 5000)
  AND `code` IN (
    'pts_frequency_hz', 'pts_power_ref_kw', 'pts_current_ref_a',
    'pts_torque_ref_pct', 'pts_rpm_ref',
    'turbulensi_power_ref_kw', 'turbulensi_torque_ref_pct',
    'turbulensi_current_dev_threshold_a',
    'banyak_sampah_power_ref_kw', 'banyak_sampah_current_ref_a',
    'banyak_sampah_torque_ref_pct',
    'dry_run_power_factor', 'dry_run_current_factor',
    'dry_run_torque_threshold_pct'
  )
GROUP BY `flowhead_capacity`
ORDER BY `flowhead_capacity`;

COMMIT;

-- Audit hasil lengkap:
SELECT
    fc.flowhead_capacity,
    fd.failure,
    fc.code,
    fc.numeric_value,
    fc.unit
FROM `flowhead_config` AS fc
LEFT JOIN `failure_definitions` AS fd ON fd.id = fc.failure_id
WHERE fc.flowhead_capacity IN (500, 3000, 5000)
ORDER BY fc.flowhead_capacity, fd.failure, fc.code;
