"""Generate golden fixtures for the Python classification engine.

Run ONCE before refactoring, from the backend directory:

    venv/bin/python tests/golden/generate.py --write

Without --write it only prints a summary. Regression tests never call this
module, so expected outputs are never regenerated automatically.

Each scenario is written as:
    <name>.input.json    -> request body for POST /classify
    <name>.expected.json -> full Python response (oracle)

The expected files intentionally keep every field produced by the current
engine (including fields that the Node.js target contract may drop).
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[2]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402

GOLDEN_DIR = Path(__file__).resolve().parent
BASE_TS = datetime(2026, 10, 19, 10, 0, 0, tzinfo=timezone(timedelta(hours=7)))


def reading(ts: datetime, **overrides) -> dict:
    base = {
        "timestamp": ts.isoformat(),
        "motor_speed": 990.0,
        "output_frequency": 39.0,
        "motor_current": 200.0,
        "motor_torque": 40.0,
        "output_power": 100.0,
        "input_voltage": 380.0,
        "ambient_temperature": 30.0,
        "control_board_temperature": 40.0,
        "inverter_temperature": 45.0,
        "arus_rms_u": 100.0,
        "arus_rms_v": 100.0,
        "arus_rms_w": 100.0,
    }
    base.update(overrides)
    return base


def series(n: int, **overrides) -> list[dict]:
    return [reading(BASE_TS + timedelta(seconds=i), **overrides) for i in range(n)]


def scenarios() -> dict[str, dict]:
    """All golden scenarios, keyed by fixture name."""

    def r5k(**overrides):
        return reading(BASE_TS, **overrides)

    data: dict[str, dict] = {}

    # --- eight trouble types (+ normal) ---
    data["01_normal"] = {
        "profile_id": "5000_lps",
        "namespace": "golden-normal",
        "setpoint_freq": None,
        "readings": [r5k()],
    }
    data["02_pompa_tersangkut_sampah"] = {
        "profile_id": "5000_lps",
        "namespace": "golden-pts",
        "setpoint_freq": None,
        "readings": [r5k(motor_speed=200.0, output_frequency=8.0,
                        motor_current=900.0, motor_torque=115.0,
                        output_power=450.0)],
    }
    data["03_banyak_sampah"] = {
        "profile_id": "5000_lps",
        "namespace": "golden-bs",
        "setpoint_freq": None,
        "readings": [r5k(output_frequency=39.0, motor_current=900.0,
                        motor_torque=95.0, output_power=450.0)],
    }
    data["04_dry_run"] = {
        "profile_id": "5000_lps",
        "namespace": "golden-dry",
        "setpoint_freq": None,
        "readings": [r5k(output_frequency=40.0, motor_current=300.0,
                        motor_torque=40.0, output_power=100.0)],
    }
    data["05_unbalance"] = {
        "profile_id": "5000_lps",
        "namespace": "golden-unbalance",
        "setpoint_freq": None,
        "readings": [r5k(arus_rms_u=100.0, arus_rms_v=100.0, arus_rms_w=140.0)],
    }
    data["06_undervoltage"] = {
        "profile_id": "5000_lps",
        "namespace": "golden-undervoltage",
        "setpoint_freq": None,
        "readings": [r5k(input_voltage=340.0)],
    }
    data["07_overvoltage"] = {
        "profile_id": "5000_lps",
        "namespace": "golden-overvoltage",
        "setpoint_freq": None,
        "readings": [r5k(input_voltage=415.0)],
    }
    data["08_panel_overheat"] = {
        "profile_id": "5000_lps",
        "namespace": "golden-panel",
        "setpoint_freq": None,
        "readings": [r5k(ambient_temperature=65.0)],
    }

    # --- T_A history: MA30, CMA_n, insufficient, gap > 10s ---
    turbulensi_base = {
        "output_frequency": 39.0,
        "motor_current": 550.0,
        "motor_torque": 95.0,
        "output_power": 450.0,
        "arus_rms_u": 200.0,
        "arus_rms_v": 200.0,
        "arus_rms_w": 200.0,
    }
    data["09_turbulensi_ma30"] = {
        "profile_id": "5000_lps",
        "namespace": "golden-turb-ma30",
        "setpoint_freq": None,
        "readings": series(30, **turbulensi_base)
        + [reading(BASE_TS + timedelta(seconds=30), **{**turbulensi_base, "motor_current": 615.0})],
    }
    data["10_turbulensi_cma10"] = {
        "profile_id": "5000_lps",
        "namespace": "golden-turb-cma10",
        "setpoint_freq": None,
        "readings": series(10, **turbulensi_base)
        + [reading(BASE_TS + timedelta(seconds=10), **{**turbulensi_base, "motor_current": 615.0})],
    }
    data["11_turbulensi_insufficient"] = {
        "profile_id": "5000_lps",
        "namespace": "golden-turb-insufficient",
        "setpoint_freq": None,
        "readings": [reading(BASE_TS, **{**turbulensi_base, "motor_current": 615.0})],
    }
    data["12_turbulensi_gap_gt_10s"] = {
        "profile_id": "5000_lps",
        "namespace": "golden-turb-gap",
        "setpoint_freq": None,
        "readings": series(30, **turbulensi_base)
        + [reading(BASE_TS + timedelta(seconds=60), **{**turbulensi_base, "motor_current": 615.0})],
    }

    # --- boundaries (strict vs inclusive) ---
    data["13_voltage_boundary_360"] = {
        "profile_id": "5000_lps",
        "namespace": "golden-v360",
        "setpoint_freq": None,
        "readings": [r5k(input_voltage=360.0)],
    }
    data["14_voltage_boundary_410"] = {
        "profile_id": "5000_lps",
        "namespace": "golden-v410",
        "setpoint_freq": None,
        "readings": [r5k(input_voltage=410.0)],
    }
    data["15_banyak_sampah_boundary"] = {
        "profile_id": "5000_lps",
        "namespace": "golden-bs-boundary",
        "setpoint_freq": None,
        "readings": [r5k(output_frequency=40.0, output_power=400.0,
                        motor_current=867.0, motor_torque=90.0)],
    }
    data["16_dry_run_torque_boundary_70"] = {
        "profile_id": "5000_lps",
        "namespace": "golden-dry-t70",
        "setpoint_freq": None,
        "readings": [r5k(output_frequency=40.0, output_power=100.0,
                        motor_current=300.0, motor_torque=70.0)],
    }
    data["17_dry_run_freq_rounding_2dp"] = {
        "profile_id": "5000_lps",
        "namespace": "golden-dry-round",
        "setpoint_freq": None,
        "readings": [r5k(output_frequency=40.004, output_power=100.0,
                        motor_current=300.0, motor_torque=40.0)],
    }
    data["18_dry_run_boundary_freq_40_01"] = {
        "profile_id": "5000_lps",
        "namespace": "golden-dry-f4001",
        "setpoint_freq": None,
        "readings": [r5k(output_frequency=40.01, output_power=100.0,
                        motor_current=300.0, motor_torque=40.0)],
    }
    data["19_panel_overheat_boundary_60"] = {
        "profile_id": "5000_lps",
        "namespace": "golden-panel-60",
        "setpoint_freq": None,
        "readings": [r5k(inverter_temperature=60.0)],
    }

    # --- multi-fault, quorum, missing/null data, tier variants ---
    data["20_multi_unbalance_undervoltage"] = {
        "profile_id": "5000_lps",
        "namespace": "golden-multi",
        "setpoint_freq": None,
        "readings": [r5k(input_voltage=340.0, arus_rms_u=100.0,
                        arus_rms_v=100.0, arus_rms_w=140.0)],
    }
    data["21_pts_quorum_2of4"] = {
        "profile_id": "5000_lps",
        "namespace": "golden-pts-2of4",
        "setpoint_freq": None,
        "readings": [r5k(motor_speed=50.0, output_frequency=8.0,
                        motor_current=900.0, motor_torque=40.0,
                        output_power=450.0)],
    }
    data["22_unbalance_null_phase"] = {
        "profile_id": "5000_lps",
        "namespace": "golden-unbalance-null",
        "setpoint_freq": None,
        "readings": [r5k(arus_rms_u=100.0, arus_rms_v=100.0, arus_rms_w=None)],
    }
    data["23_tier500_banyak_sampah"] = {
        "profile_id": "500_lps",
        "namespace": "golden-tier500",
        "setpoint_freq": None,
        "readings": [r5k(motor_speed=900.0, output_frequency=45.0,
                        motor_current=200.0, motor_torque=95.0,
                        output_power=100.0)],
    }
    data["24_tier3000_banyak_sampah"] = {
        "profile_id": "3000_lps",
        "namespace": "golden-tier3000",
        "setpoint_freq": None,
        "readings": [r5k(motor_speed=950.0, output_frequency=37.0,
                        motor_current=550.0, motor_torque=95.0,
                        output_power=260.0)],
    }
    data["25_missing_sensor_data"] = {
        "profile_id": "5000_lps",
        "namespace": "golden-missing",
        "setpoint_freq": None,
        "readings": [{
            "timestamp": BASE_TS.isoformat(),
            "output_frequency": None,
            "motor_current": None,
            "motor_torque": None,
            "output_power": None,
        }],
    }

    return data


def classify(client: TestClient, body: dict) -> dict:
    response = client.post("/classify", json=body)
    if response.status_code != 200:
        raise SystemExit(
            f"{body['namespace']}: HTTP {response.status_code} {response.text}"
        )
    return response.json()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--write",
        action="store_true",
        help="write fixtures; without this flag only a summary is printed",
    )
    args = parser.parse_args()

    client = TestClient(app)
    fixtures = scenarios()

    for name, body in fixtures.items():
        expected = classify(client, body)
        trouble = expected["classification"]["trouble_type"]
        print(f"{name}: {trouble}")
        if args.write:
            (GOLDEN_DIR / f"{name}.input.json").write_text(
                json.dumps(body, indent=2) + "\n", encoding="utf-8"
            )
            (GOLDEN_DIR / f"{name}.expected.json").write_text(
                json.dumps(expected, indent=2) + "\n", encoding="utf-8"
            )

    if not args.write:
        print("\nDry run: pass --write to create the fixture files.")
    else:
        print(f"\nWrote {len(fixtures)} scenarios to {GOLDEN_DIR}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
