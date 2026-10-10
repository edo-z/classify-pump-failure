"""F6 — Wiring setpoint jalur dokumen (bukan cuma resolver murni).

Probe: DRY_RUN hanya MATCH bila output_frequency == setpoint (2dp) dengan
DR_C penuh (tier 5000: K<=266.8, A<=554.88, T<70). F=45.0 hanya MATCH bila
jalur meneruskan setpoint 45.0; fallback profil (40.0) → NO DRY_RUN.
"""

from datetime import datetime, timezone

from app.classification.models import TroubleType
from app.data_pipeline.models import TelemetryDataset, TelemetrySample


def _dry_fields(freq: float) -> dict:
    return {
        "motor_speed": 990.0,
        "output_frequency": freq,
        "motor_current": 246.0,
        "motor_torque": 40.0,
        "output_power": 111.0,
        "input_voltage": 380.0,
        "ambient_temperature": 30.0,
        "control_board_temperature": 40.0,
        "inverter_temperature": 45.0,
    }


def _telemetry_sample(freq: float, ts: datetime) -> TelemetrySample:
    return TelemetrySample.model_validate({
        "document_id": "t-f6-doc",
        "source_row": 2,
        "timestamp": ts,
        "normalization_status": "COMPLETE",
        **_dry_fields(freq),
    })


def _dataset(freq: float, ts: datetime) -> TelemetryDataset:
    from app.data_pipeline.models import NormalizationSchemaInspection

    return TelemetryDataset(
        document_id="t-f6-doc",
        filename="t-f6-doc.csv",
        schema_inspection=NormalizationSchemaInspection(
            schema_name="PUMP_TELEMETRY", supported=True),
        raw_row_count=1,
        complete_row_count=1,
        partial_row_count=0,
        status="NORMALIZED",
        samples=[_telemetry_sample(freq, ts)],
    )


def test_document_override_wiring(engine, base_ts):
    from app.classification.service import classify_telemetry_dataset

    res = classify_telemetry_dataset(
        _dataset(45.0, base_ts), "5000_lps", engine, setpoint_freq=45.0)
    assert res.classification.trouble_type == TroubleType.DRY_RUN
    res = classify_telemetry_dataset(
        _dataset(45.0, base_ts), "5000_lps", engine, setpoint_freq=None)
    assert res.classification.trouble_type != TroubleType.DRY_RUN
