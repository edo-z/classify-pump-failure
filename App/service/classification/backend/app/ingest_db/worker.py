"""DB ingest worker — satu proses, satu loop poll (tanpa debounce/event).

Per tick: untuk tiap pompa ber-flowhead:
  snapshot -> mapping -> freshness gate -> buffer(dedup) -> resolve
  -> engine.classify(rule_config) -> sink 9 raw -> commit.

Pompa yang gagal (tak terpetakan / basi / error) dilewati dengan log
tanpa menggagalkan tick pompa lain. Tidak menulis pump_classifications.
"""

from __future__ import annotations

import json
import logging
import os
import time
from typing import Any

from app.classification.evidence import (
    EVIDENCE_MAXLEN,
    LIVE_GAP_THRESHOLD_MS,
    build_trailing_evidence,
)
from app.classification.service import get_engine
from app.classification.tier_refs import load_tier_refs
from app.ingest_db import buffer as buffer_mod
from app.ingest_db import db as db_mod
from app.ingest_db import freshness as freshness_mod
from app.ingest_db import mapping as mapping_mod
from app.ingest_db import reader as reader_mod
from app.ingest_db import resolve as resolve_mod
from app.ingest_db import sink as sink_mod

logger = logging.getLogger(__name__)


class Worker:
    def __init__(
        self,
        interval_seconds: float = 5.0,
        freshness_seconds: float | None = None,
    ):
        self.interval_seconds = interval_seconds
        # Default: 2x interval (bukan cadence terkunci — dedup yang menjaga).
        self.freshness_seconds = (
            freshness_seconds
            if freshness_seconds is not None
            else interval_seconds * 2
        )
        self.buffer = buffer_mod.RingBuffer(maxlen=EVIDENCE_MAXLEN)
        self.key_mapping = mapping_mod.load_key_mapping()
        self.tier_refs = load_tier_refs()
        self._engine = None

    @property
    def engine(self):
        if self._engine is None:
            self._engine = get_engine()
        return self._engine

    def poll_once(self, conn, dry_run: bool = False) -> dict[str, Any]:
        """Satu tick lintas pompa. Return statistik tick.

        dry_run=True: kontrak validasi read-only production —
          SELECT → DIIZINKAN, klasifikasi → DIJALANKAN,
          bangun 9 raw rows → DIJALANKAN (dihitung, tidak ditulis),
          INSERT/UPDATE/DELETE/executemany-tulis/COMMIT → DILARANG
          (rollback eksplisit sebagai pengaman ganda).
        Proteksi utama tetap user DB hak SELECT saja; flag ini lapis
        aplikasi. Password tidak pernah dicatat di log/statistik.
        """
        stats: dict[str, Any] = {
            "pumps_seen": 0,
            "pumps_evaluated": 0,
            "rows_written": 0,
            "rows_would_write": 0,
            "dry_run": dry_run,
            "skipped": [],
            "sample_effective_config": None,
        }
        all_rows: list[dict[str, Any]] = []
        for snap in reader_mod.read_pump_snapshots(conn):
            stats["pumps_seen"] += 1
            try:
                rows, skip_reason = self._evaluate_snapshot(conn, snap)
            except Exception as exc:
                logger.warning("pump %s skipped: %s", snap.pump_id, exc)
                stats["skipped"].append((snap.pump_id, "error"))
                continue
            if skip_reason is not None:
                stats["skipped"].append((snap.pump_id, skip_reason))
                continue
            if rows:
                all_rows.extend(rows)
        if all_rows:
            if dry_run:
                # Pengaman ganda: tidak ada executemany tulis, tidak ada
                # commit — kembalikan transaksi bila ada yang terbuka.
                conn.rollback()
                stats["rows_would_write"] = len(all_rows)
                stats["pumps_evaluated"] = len(
                    {r["pump_id"] for r in all_rows}
                )
                try:
                    first_payload = json.loads(all_rows[0]["raw_data"])
                    stats["sample_effective_config"] = first_payload.get(
                        "effective_config"
                    )
                except (ValueError, KeyError, TypeError):
                    stats["sample_effective_config"] = None
            else:
                # Gerbang tulis: izin eksplisit + database dalam allowlist.
                db_mod.require_write_allowed(conn, "insert raw_classifications")
                sink_mod.insert_rows(conn, all_rows)
                conn.commit()
                stats["rows_written"] = len(all_rows)
                stats["pumps_evaluated"] = len(
                    {r["pump_id"] for r in all_rows}
                )
        elif dry_run:
            conn.rollback()
        return stats

    def _evaluate_snapshot(self, conn, snap) -> tuple[list[dict] | None, str | None]:
        """Kembalikan (rows, skip_reason). rows None + reason str = dilewati."""
        usable, evaluated_at, usable_samples = freshness_mod.gate(
            snap.params, self.freshness_seconds
        )
        if not usable or evaluated_at is None:
            return None, "stale_or_empty"
        reading = mapping_mod.to_sensor_reading(
            usable_samples, evaluated_at, self.key_mapping
        )
        if not self.buffer.append(snap.pump_id, evaluated_at, reading):
            return None, "duplicate"  # duplikat event-time: bukan sampel baru
        trail = self.buffer.trailing(snap.pump_id)
        evidence = build_trailing_evidence(
            trail, len(trail) - 1, LIVE_GAP_THRESHOLD_MS, EVIDENCE_MAXLEN
        )
        if not evidence:
            return None, "no_evidence"
        resolved = resolve_mod.resolve_pump_inputs(
            pump_id=snap.pump_id,
            flowhead_type=snap.flowhead_type,
            flowhead_power_kw=snap.flowhead_power_kw,
            flowhead_current_a=snap.flowhead_current_a,
            config_row=snap.config_row,
            tier_refs=self.tier_refs,
        )
        if resolved is None:
            return None, "unmapped_flowhead"
        _profile_id, pump_config, setpoint, refs, provenance = resolved
        result = self.engine.classify(
            readings=evidence,
            pump_config=pump_config,
            operating_setpoint=setpoint,
            trigger_namespace=f"site:{snap.namespace}",
            rule_config=refs,
        )
        effective_config = {
            "refs": {"power_kw": refs.power_kw, "current_a": refs.current_a},
            "setpoint": {
                "frequency_hz": setpoint.frequency,
                "rpm": setpoint.rpm,
                "torque": setpoint.torque,
            },
            "provenance": provenance,
        }
        # Kelengkapan dari sampel yang benar-benar dievaluasi (terakhir).
        # Field hilang -> tick incomplete, normal tidak auto-TRUE.
        last = evidence[-1]
        missing = [
            f
            for f in sink_mod.SENSOR_FIELDS
            if getattr(last, f, None) is None
        ]
        return (
            sink_mod.build_rows(
                result,
                pump_id=snap.pump_id,
                evaluated_at=evaluated_at,
                effective_config=effective_config,
                missing_fields=missing,
            ),
            None,
        )


def run_once(dry_run: bool = False, **db_overrides) -> dict[str, Any]:
    """Satu tick (dipakai CLI --once/--dry-run, cron, dan e2e)."""
    worker = Worker(
        interval_seconds=float(os.getenv("INGEST_INTERVAL_S", "5")),
        freshness_seconds=(
            float(os.getenv("INGEST_FRESHNESS_S"))
            if os.getenv("INGEST_FRESHNESS_S")
            else None
        ),
    )
    conn = db_mod.connect(**db_overrides)
    try:
        return worker.poll_once(conn, dry_run=dry_run)
    finally:
        conn.close()


def run_forever() -> None:
    """Loop poll sampai KeyboardInterrupt (systemd)."""
    interval = float(os.getenv("INGEST_INTERVAL_S", "5"))
    worker = Worker(interval_seconds=interval)
    logger.info("db ingest worker started (interval=%ss)", interval)
    while True:
        try:
            conn = db_mod.connect()
            try:
                stats = worker.poll_once(conn)
            finally:
                conn.close()
            logger.info("tick: %s", stats)
        except KeyboardInterrupt:
            logger.info("db ingest worker stopped")
            return
        except Exception as exc:
            logger.warning("tick failed: %s", exc)
        time.sleep(interval)
