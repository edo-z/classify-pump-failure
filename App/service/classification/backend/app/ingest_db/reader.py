"""Reader snapshot realtime (read-only terhadap tabel production).

Sumber (production 8.4.x):
  pump_realtimes (pump_id, parameter_definition_id, value, updated_at)
  parameter_definitions (id, key, ...)
  pumps (id, flowhead_id, ...) -> flowheads (id, type_flowhead,
      references_kw_value, references_ampere_value, ...)
  pump_classification_config (boleh BELUM ADA — dianggap tanpa override)

Cakupan: hanya pumps yang punya flowhead (INNER JOIN). Pompa tanpa
flowhead dilewati dengan warning (tidak bisa dipetakan ke profil).
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

logger = logging.getLogger(__name__)


@dataclass
class ParamSample:
    key: str
    value: str | None
    updated_at: datetime | None


@dataclass
class PumpSnapshot:
    pump_id: int
    namespace: str
    flowhead_type: str | None
    flowhead_power_kw: float | None
    flowhead_current_a: float | None
    config_row: dict[str, Any] | None
    params: list[ParamSample] = field(default_factory=list)


_SNAPSHOT_SQL = """
SELECT p.id AS pump_id,
       fh.type_flowhead AS flowhead_type,
       fh.references_kw_value AS flowhead_power_kw,
       fh.references_ampere_value AS flowhead_current_a,
       pd.`key` AS param_key,
       pr.id AS rt_id,
       pr.value AS param_value,
       pr.updated_at AS param_updated_at
  FROM pumps p
  INNER JOIN flowheads fh ON fh.id = p.flowhead_id
  LEFT JOIN pump_realtimes pr ON pr.pump_id = p.id
  LEFT JOIN parameter_definitions pd ON pd.id = pr.parameter_definition_id
 ORDER BY p.id, pr.updated_at, pr.id
"""

_CONFIG_SQL = """
SELECT pump_id, operating_freq_hz, operating_rpm,
       operating_torque_pct, ref_power_kw, ref_current_a
  FROM pump_classification_config
"""


def _to_float(value: Any) -> float | None:
    try:
        return float(value) if value is not None else None
    except (TypeError, ValueError):
        return None


def read_pump_snapshots(conn) -> list[PumpSnapshot]:
    with conn.cursor() as cur:
        cur.execute(_SNAPSHOT_SQL)
        rows = cur.fetchall()

    config_by_pump: dict[int, dict] = {}
    try:
        with conn.cursor() as cur:
            cur.execute(_CONFIG_SQL)
            for row in cur.fetchall():
                config_by_pump[int(row["pump_id"])] = dict(row)
    except Exception as exc:
        # Tabel config Tahap 1 boleh belum ada (mis. production lama):
        # anggap semua pompa tanpa override, jangan gagalkan tick.
        logger.warning("pump_classification_config unreadable: %s", exc)

    snapshots: dict[int, PumpSnapshot] = {}
    # pump_realtimes boleh berisi baris lama per parameter (mis. pola
    # REPLACE/INSERT berkala): hanya baris TERBARU per (pump, key) yang
    # dipakai — ORDER BY di atas menjamin baris terbaru datang terakhir.
    latest_param: dict[tuple[int, str], ParamSample] = {}
    for row in rows:
        pump_id = int(row["pump_id"])
        snap = snapshots.get(pump_id)
        if snap is None:
            snap = PumpSnapshot(
                pump_id=pump_id,
                namespace=str(pump_id),
                flowhead_type=row.get("flowhead_type"),
                flowhead_power_kw=_to_float(row.get("flowhead_power_kw")),
                flowhead_current_a=_to_float(row.get("flowhead_current_a")),
                config_row=config_by_pump.get(pump_id),
            )
            snapshots[pump_id] = snap
        if row.get("param_key") is not None:
            latest_param[(pump_id, str(row["param_key"]))] = ParamSample(
                key=str(row["param_key"]),
                value=row.get("param_value"),
                updated_at=row.get("param_updated_at"),
            )
    for (pump_id, _key), sample in latest_param.items():
        snapshots[pump_id].params.append(sample)
    return list(snapshots.values())
