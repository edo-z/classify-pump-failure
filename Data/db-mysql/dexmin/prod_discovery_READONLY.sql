-- prod_discovery_READONLY.sql — validasi read-only production MySQL 8.4.x.
-- SELURUH FILE HANYA SELECT. Jalankan dengan user hak SELECT saja
-- (proteksi utama; JANGAN pakai user tulis). Jangan menaruh password
-- di kode, log, atau percakapan — via env CLASSIFICATION_DB_*.
-- Tujuan: mengunci CLASSIFICATION_DB_KEYMAP, FLOWHEAD_PROFILE_MAP,
-- INGEST_INTERVAL_S, dan INGEST_FRESHNESS_S dari BUKTI, bukan tebakan.
--
-- Cara pakai: mysql -h HOST -u READONLY_USER -p dexmin
--             < Data/db-mysql/dexmin/prod_discovery_READONLY.sql
--
-- =====================================================================
-- Q1 — parameter_definitions.key aktual vs field SensorReading.
-- Output dipakai mengunci CLASSIFICATION_DB_KEYMAP final
-- (key yang tak terpetakan = diabaikan worker + warning).
-- =====================================================================
SELECT `key`, COUNT(*) AS n
  FROM parameter_definitions
 GROUP BY `key`
 ORDER BY `key`;

-- =====================================================================
-- Q2 — flowheads.type_flowhead aktual vs profil 500/3000/5000 L/s.
-- Output dipakai mengunci FLOWHEAD_PROFILE_MAP (exact + digit eksak).
-- Tipe di luar 3 profil = pompa dilewati worker (unmapped_flowhead).
-- =====================================================================
SELECT type_flowhead,
       COUNT(*) AS n_flowheads,
       MIN(references_kw_value) AS min_kw,
       MAX(references_kw_value) AS max_kw,
       MIN(references_ampere_value) AS min_amp,
       MAX(references_ampere_value) AS max_amp
  FROM flowheads
 GROUP BY type_flowhead
 ORDER BY type_flowhead;

-- =====================================================================
-- Q3 — umur + kelengkapan snapshot pump_realtimes (SNAPSHOT, bukan LAG).
-- KOREKSI: pump_realtimes hanya menyimpan nilai realtime TERBARU per
-- parameter, BUKAN histori perubahan — LAG(updated_at) tidak valid di
-- sini. Query ini hanya menjawab: seberapa baru data terakhir dan
-- seberapa lengkap parameter per pompa.
-- KOREKSI 2: bila ada baris historis ganda per parameter, agregat WAJIB
-- di atas SATU baris terbaru per (pump, parameter) — CTE `latest`
-- (ROW_NUMBER, didukung 8.0 & 8.4). Tanpa ini MIN/MAX mencampur histori
-- dengan snapshot kini. Cerminan logika reader worker (latest-per-key).
-- Cadence SEBENARNYA diukur dengan Q3b (baca ulang + bandingkan).
-- =====================================================================
WITH latest AS (
  SELECT pump_id, parameter_definition_id, value, updated_at
    FROM (
      SELECT pump_id, parameter_definition_id, value, updated_at,
             ROW_NUMBER() OVER (
               PARTITION BY pump_id, parameter_definition_id
               ORDER BY updated_at DESC, id DESC
             ) AS rn
        FROM pump_realtimes
    ) t
   WHERE rn = 1
)
SELECT p.id AS pump_id,
       COUNT(l.parameter_definition_id) AS n_params,
       MIN(l.updated_at) AS oldest_param,
       MAX(l.updated_at) AS newest_param,
       TIMESTAMPDIFF(
           SECOND, MIN(l.updated_at), MAX(l.updated_at)
       ) AS spread_seconds,
       TIMESTAMPDIFF(
           SECOND, MAX(l.updated_at), NOW()
       ) AS freshest_staleness_s,
       TIMESTAMPDIFF(
           SECOND, MIN(l.updated_at), NOW()
       ) AS stalest_staleness_s
  FROM pumps p
  LEFT JOIN latest l ON l.pump_id = p.id
 GROUP BY p.id
 ORDER BY p.id;

-- Q3b — ukur cadence dengan DUA pembacaan read-only berselang N detik.
-- Jalankan query di bawah, tunggu N detik (mis. 60), jalankan lagi,
-- bandingkan newest_param per pump_id:
--   tidak berubah  -> interval update > N (atau sensor mati)
--   berubah        -> selisih = batas atas cadence
-- Ulangi dengan N berbeda untuk mempersempit. Tabel histori
-- (mis. pump_logs_test, bila terbukti menyimpan sampel production)
-- boleh dipakai sebagai pembanding, BUKAN sebagai sumber interval
-- sebelum terbukti.
SELECT p.id AS pump_id,
       MAX(pr.updated_at) AS newest_param,
       NOW() AS observed_at
  FROM pumps p
  LEFT JOIN pump_realtimes pr ON pr.pump_id = p.id
 GROUP BY p.id
 ORDER BY p.id;

-- =====================================================================
-- Q4 — cakupan worker: pompa ber-flowhead valid (yang akan di-poll)
-- vs total pompa. Pompa tanpa flowhead dilewati by-design.
-- =====================================================================
SELECT COUNT(*) AS total_pumps,
       SUM(CASE WHEN p.flowhead_id IS NOT NULL THEN 1 ELSE 0 END)
           AS pumps_with_flowhead,
       SUM(CASE WHEN p.flowhead_id IS NULL THEN 1 ELSE 0 END)
           AS pumps_skipped_no_flowhead
  FROM pumps p;

SELECT p.id AS pump_id,
       fh.type_flowhead AS flowhead_type
  FROM pumps p
  INNER JOIN flowheads fh ON fh.id = p.flowhead_id
 ORDER BY p.id
 LIMIT 50;

-- =====================================================================
-- Q5 — matriks kelengkapan per pompa x parameter RELEVAN engine saja
-- (bukan seluruh parameter MySQL). Key di bawah = DEFAULT_KEY_MAPPING
-- worker (app/ingest_db/mapping.py); key di luar daftar ini diabaikan
-- worker by-design. Setelah Q1 jalan, coret key yang ternyata tak ada
-- di production dan tambahkan key prod yang belum terpetakan.
--
-- Dua kesegaran sekaligus (keduanya WAJIB dibaca bersama):
--   absolut (staleness_s vs NOW): seberapa lama data terakhir.
--   relatif (spread per pompa di Q5b): apakah timestamp antarparameter
--     satu snapshot masih dalam satu batas. Parameter bisa SAMA-SAMA
--     lama tetapi konsisten — itu tetap DITOLAK freshness gate bila
--     absolutnya basi; jangan hanya lihat relatif.
--
-- Kebutuhan sensor per famili (untuk menilai evaluability dari matriks):
--   PTS/TURBULENSI/BANYAK_SAMPAH/DRY_RUN: frequency, power, current,
--     torque (+rpm untuk PTS; + histori 31 untuk TURBULENSI T_A).
--   PANEL_OVERHEAT: ambient/control_board/inverter temperature.
--   UNDERVOLTAGE/OVERVOLTAGE: input_voltage.
--   UNBALANCE: arus_rms_u/v/w.
-- Segar belum berarti semua rule evaluable — cocokkan dengan daftar ini.
--
-- Agregat di atas CTE `latest` (satu baris terbaru per parameter):
-- staleness_s = umur data TERBARU parameter tersebut (absolut vs NOW).
-- =====================================================================
WITH latest AS (
  SELECT pump_id, parameter_definition_id, value, updated_at
    FROM (
      SELECT pump_id, parameter_definition_id, value, updated_at,
             ROW_NUMBER() OVER (
               PARTITION BY pump_id, parameter_definition_id
               ORDER BY updated_at DESC, id DESC
             ) AS rn
        FROM pump_realtimes
    ) t
   WHERE rn = 1
)
SELECT p.id AS pump_id,
       pd.`key` AS param_key,
       MAX(l.updated_at) AS latest,
       TIMESTAMPDIFF(SECOND, MAX(l.updated_at), NOW()) AS staleness_s
  FROM pumps p
  INNER JOIN flowheads fh ON fh.id = p.flowhead_id
  CROSS JOIN parameter_definitions pd
  LEFT JOIN latest l
    ON l.pump_id = p.id
   AND l.parameter_definition_id = pd.id
 WHERE pd.`key` IN (
       'motor_speed', 'rpm',
       'output_frequency', 'frequency', 'frekuensi',
       'motor_current', 'current', 'arus',
       'motor_torque', 'torque', 'torsi',
       'output_power', 'power', 'daya',
       'hours_run', 'output_voltage',
       'ambient_temperature', 'control_board_temperature',
       'inverter_temperature', 'input_voltage', 'flux_actual',
       'motor_estimated_temperature',
       'arus_rms_u', 'arus_rms_v', 'arus_rms_w'
       )
 GROUP BY p.id, pd.`key`
 ORDER BY p.id, pd.`key`;

-- Q5b — ringkasan relatif per pompa: sebaran timestamp DALAM snapshot
-- (MAX-MIN antarparameter) + kebasi-an. Dibaca bersama:
--   freshest_staleness_s = umur data PALING BARU (vs NOW).
--   stalest_staleness_s  = umur data PALING BASI (vs NOW) — inilah
--     "max" yang benar; versi lama memakai MAX(updated_at) sehingga
--     justru menunjukkan umur data terbaru. Di atas CTE `latest`.
-- Bandingkan spread dengan batas freshness worker.
WITH latest AS (
  SELECT pump_id, parameter_definition_id, value, updated_at
    FROM (
      SELECT pump_id, parameter_definition_id, value, updated_at,
             ROW_NUMBER() OVER (
               PARTITION BY pump_id, parameter_definition_id
               ORDER BY updated_at DESC, id DESC
             ) AS rn
        FROM pump_realtimes
    ) t
   WHERE rn = 1
)
SELECT p.id AS pump_id,
       COUNT(l.parameter_definition_id) AS n_params_present,
       MIN(l.updated_at) AS oldest_param,
       MAX(l.updated_at) AS newest_param,
       TIMESTAMPDIFF(SECOND, MIN(l.updated_at), MAX(l.updated_at))
           AS spread_seconds,
       TIMESTAMPDIFF(SECOND, MAX(l.updated_at), NOW())
           AS freshest_staleness_s,
       TIMESTAMPDIFF(SECOND, MIN(l.updated_at), NOW())
           AS stalest_staleness_s
  FROM pumps p
  INNER JOIN flowheads fh ON fh.id = p.flowhead_id
  LEFT JOIN latest l ON l.pump_id = p.id
 GROUP BY p.id
 ORDER BY p.id;
