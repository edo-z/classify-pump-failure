from __future__ import annotations

import json
import logging
import threading
from pathlib import Path
from typing import Any

RULES_FILE = (
    Path(__file__).resolve().parent
    / "rules.json"
)

from app.classification import engine_support as support
from app.classification.evaluator import (
    evaluate_panel,
    evaluate_tier_rules,
    evaluate_unbalance,
    evaluate_voltage,
)
from app.classification.models import (
    OperatingSetpoint,
    ClassificationResult,
    MatchedRule,
    PumpConfig,
    RuleEvaluation,
    SensorReading,
    TroubleType,
    UnsupportedPumpConfigurationError,
)

logger = logging.getLogger(__name__)

# Re-export agar `from app.classification.engine import UnsupportedPumpConfigurationError`
# tetap berlaku setelah kelas pindah ke models.
__all__ = ["RULES_FILE", "RulesEngine", "UnsupportedPumpConfigurationError"]

class RulesEngine:
    """Load threshold rules from JSON and classify sensor readings.

    Stateful count_trigger (Opsi A): per-pump consecutive MATCH buffer.
    Engine raw per-sample (last reading), tapi POMPA_TERSANGKUT_SAMPAH/DRY_RUN
    punya cabang khusus per-sample. DRY_RUN dua tingkat: DryRun = DR_F ∧ DR_C,
    DR_C = DR_KW (kW<=0.667*ref) ∧ DR_A (A<=0.64*ref) ∧ DR_T (T<70);
    DR_F = kesetaraan raw 2 desimal F==sp + sustain M (anti-transien starting),
    keseluruhan di-buffer count_trigger N. TURBULENSI strict 4/4 dengan T_A trailing
    MA-30: |A_i - mean(A_{i-30}..A_{i-1})| >= threshold (default 10A).
    Opsi B mayoritas: AND dengan 5 kondisi -> 4/5, 6 kondisi -> 5/6
    (kapabilitas generic _match_rule). BANYAK_SAMPAH memakai strict 4/4
    (BS_F<=setpoint ∧ BS_kW ∧ BS_A ∧ BS_T). TURBULENSI memakai
    AND_STRICT_4_4.
    Tidak ada SKIPPED — hanya MATCH/NO_MATCH, NO_MATCH reset counter.
    Gap histori ditangani caller (evidence di-clear saat gap), engine menganggap
    readings yang diterima sudah kontigu event-time.
    """

    def __init__(self, rules_path: Path):
        self._rules_path = rules_path
        self._rules: dict[str, Any] = {}
        self._trigger_counters: dict[str, int] = {}
        self._lock = threading.Lock()
        self._load_rules()

    def _load_rules(self) -> None:
        try:
            with open(self._rules_path, "r", encoding="utf-8") as f:
                self._rules = json.load(f)
        except FileNotFoundError:
            logger.error("rules.json not found at %s", self._rules_path)
            raise
        except json.JSONDecodeError as exc:
            logger.error("rules.json corrupt at %s: %s", self._rules_path, exc)
            raise ValueError(f"Corrupt rules.json: {exc}") from exc
        if not isinstance(self._rules, dict) or "tiers" not in self._rules:
            logger.error("rules.json invalid schema at %s: missing 'tiers'", self._rules_path)
            raise ValueError(f"Invalid rules.json schema: missing 'tiers' at {self._rules_path}")

    def reload(self) -> None:
        self._load_rules()
        # clear stateful count_trigger on reload
        with self._lock:
            self._trigger_counters.clear()

    def clear_trigger_counters(self) -> None:
        """Reset all count_trigger buffers (per-pump). For tests / hot reload."""
        with self._lock:
            self._trigger_counters.clear()

    def get_trigger_counter(self, pump_id: int, trouble_name: str, namespace: str = "") -> int:
        """Inspect current counter for testing/debugging."""
        key = f"{namespace}:{pump_id}:{trouble_name}" if namespace else f"{pump_id}:{trouble_name}"
        with self._lock:
            return self._trigger_counters.get(key, 0)

    def _get_count_trigger(self, rule_def: dict) -> int:
        return support.get_count_trigger(rule_def)

    @staticmethod
    def _freq_eq_2dp(actual: float | None, sp: float | None) -> bool:
        return support.freq_eq_2dp(actual, sp)

    def _get_t_a_params(self, rule_def: dict) -> tuple[int, float]:
        return support.get_t_a_params(rule_def)

    def _compute_t_a(
        self, readings: list[SensorReading], window: int = 30, threshold: float = 10.0
    ) -> dict[str, Any]:
        return support.compute_t_a(readings, window, threshold)

    def _update_trigger_counter(
        self, pump_id: int, trouble_name: str, matched: bool, count_trigger: int, namespace: str = ""
    ) -> tuple[bool, int]:
        """Return (should_emit, current_count). NO_MATCH reset, no SKIPPED hold.

        Thread-safe via lock; namespace isolates counters per site/session/doc
        (FMEA F2) agar dua site kapasitas sama tidak saling menaikkan counter.
        """
        if count_trigger <= 1:
            return (matched, 1 if matched else 0)
        key = f"{namespace}:{pump_id}:{trouble_name}" if namespace else f"{pump_id}:{trouble_name}"
        with self._lock:
            cur = self._trigger_counters.get(key, 0)
            if not matched:
                if cur != 0:
                    self._trigger_counters[key] = 0
                return (False, 0)
            cur += 1
            # cap at count_trigger to keep emitting on continuous matches
            if cur >= count_trigger:
                self._trigger_counters[key] = count_trigger
                return (True, cur)
            self._trigger_counters[key] = cur
            return (False, cur)

    def classify(
        self,
        readings: list[SensorReading],
        pump_config: PumpConfig,
        operating_setpoint: OperatingSetpoint | None = None,
        trigger_namespace: str = "",
    ) -> ClassificationResult:
        if not readings:
            raise ValueError(
                "Classification requires at least one reading"
            )

        last_reading = readings[-1]

        operating_setpoint = (
            operating_setpoint
            or OperatingSetpoint()
        )

        agg = self._aggregate_readings(
            readings
        )

        tier_key = self._get_tier_key(
            pump_config.capacity_lps
        )

        tier_rules = (
            self._rules
            .get("tiers", {})
            .get(tier_key, {})
        )

        rules_match: list[
            MatchedRule
        ] = []

        rule_evaluations: list[
            RuleEvaluation
        ] = []

        limitations: list[str] = []

        evaluate_tier_rules(
            self,
            readings,
            agg,
            tier_rules,
            pump_config,
            operating_setpoint,
            trigger_namespace,
            rules_match,
            rule_evaluations,
            limitations,
        )

        panel_rules = (
            self._rules
            .get("tiers", {})
            .get(
                "panel_overheat",
                {},
            )
            .get(
                "rules",
                {},
            )
        )
        evaluate_panel(
            readings,
            panel_rules,
            rules_match,
            rule_evaluations,
        )

        unbalance_rule = (
            self._rules
            .get(
                "capability_rules",
                {},
            )
            .get(
                "UNBALANCE",
                {},
            )
        )
        evaluate_unbalance(
            readings,
            unbalance_rule,
            rules_match,
            rule_evaluations,
            limitations,
        )

        capability_rules = (
            self._rules.get(
                "capability_rules",
                {},
            )
        )
        evaluate_voltage(
            agg,
            capability_rules,
            rules_match,
            rule_evaluations,
            limitations,
        )

        supported_evaluations = [
            evaluation
            for evaluation
            in rule_evaluations
            if (
                evaluation.capability_status
                != "UNSUPPORTED"
            )
        ]

        ready_count = sum(
            evaluation.capability_status
            == "READY"
            for evaluation
            in supported_evaluations
        )

        # Opsi B: tidak ada SKIPPED — PARTIAL tidak ada, hanya FULL/INSUFFICIENT_DATA
        if ready_count == 0:
            evaluation_status = (
                "INSUFFICIENT_DATA"
            )
        else:
            evaluation_status = "FULL"

        # Preserve existing unsupported-tier behavior.
        if (
            not rules_match
            and tier_key is None
        ):
            raise (
                UnsupportedPumpConfigurationError(
                    (
                        "Unsupported pump "
                        "configuration for current "
                        "PoC rules: "
                        f"pump_id="
                        f"{pump_config.pump_id}, "
                        f"flowhead_id="
                        f"{pump_config.flowhead_id}, "
                        f"capacity_lps="
                        f"{pump_config.capacity_lps}"
                    )
                )
            )

        # No rule matched is not automatically equivalent
        # to "fully normal" when capability is partial.
        # Opsi C: langsung NORMAL tanpa confidence
        if not rules_match:
            return ClassificationResult(
                pump_id=pump_config.pump_id,
                timestamp=last_reading.timestamp,
                trouble_type=(
                    TroubleType.NORMAL
                ),
                matched_rules=[],
                sensor_snapshot=agg,
                readings_count=len(
                    readings
                ),
                limitations=limitations,
                evaluation_status=(
                    evaluation_status
                ),
                rule_evaluations=(
                    rule_evaluations
                ),
            )

        # Opsi C: tanpa sorting/confidence, first-match wins
        best = rules_match[0]

        return ClassificationResult(
            pump_id=pump_config.pump_id,
            timestamp=last_reading.timestamp,
            trouble_type=(
                best.trouble_type
            ),
            matched_rules=rules_match,
            sensor_snapshot=agg,
            readings_count=len(readings),
            limitations=limitations,
            evaluation_status=(
                evaluation_status
            ),
            rule_evaluations=(
                rule_evaluations
            ),
        )

    def _get_missing_requirements(
        self,
        readings: list[SensorReading],
        agg: dict,
        rule_def: dict,
        operating_setpoint: OperatingSetpoint,
    ) -> list[str]:
        return support.get_missing_requirements(readings, agg, rule_def, operating_setpoint)

    def _get_missing_or_requirements(
        self,
        agg: dict,
        rule_def: dict,
    ) -> list[str]:
        return support.get_missing_or_requirements(agg, rule_def)

    def _get_tier_key(self, capacity_lps: int) -> str | None:
        return support.get_tier_key(self._rules, capacity_lps)

    def _aggregate_readings(self, readings: list[SensorReading]) -> dict:
        return support.aggregate_readings(readings)

    def _match_rule(
        self,
        readings: list[SensorReading],
        agg: dict,
        rule_def: dict,
        setpoints: OperatingSetpoint,
    ) -> tuple[bool, list[str], int, bool]:
        conditions = rule_def.get("conditions", [])
        logic = rule_def.get("logic", "AND")
        matched_conds: list[str] = []

        config_refs = {
            "setpoint_freq",
            "setpoint_rpm",
            "setpoint_torque",
        }

        required_refs = {
            cond.get("ref")
            for cond in conditions
            if cond.get("ref") in config_refs
        }

        missing_setpoint = any(
            (
                value := self._resolve_operating_setpoint(
                    setpoints,
                    ref,
                )
            ) is None
            or value <= 0
            for ref in required_refs
        )

        for cond in conditions:
            field = cond["field"]
            op = cond["op"]
            actual = agg.get(field)

            if actual is None:
                continue

            if op == "reaching_setpoint":
                ref_field = cond.get("ref", "")
                sp = self._resolve_operating_setpoint(setpoints, ref_field)
                if sp is not None and sp > 0 and actual >= sp:
                    matched_conds.append(
                        f"{field}={actual:.1f} reaches setpoint {sp}"
                    )
            elif op == "not_reaching_setpoint":
                ref_field = cond.get("ref", "")
                sp = self._resolve_operating_setpoint(setpoints, ref_field)
                if sp is not None and sp > 0 and actual < sp:
                    matched_conds.append(
                        f"{field}={actual:.1f} < setpoint {sp}"
                    )
            elif op == "not_exceeding_setpoint":
                ref_field = cond.get("ref", "")
                sp = self._resolve_operating_setpoint(setpoints, ref_field)
                if sp is not None and sp > 0 and actual <= sp:
                    matched_conds.append(
                        f"{field}={actual:.1f} <= setpoint {sp}"
                    )
            elif op == "near_setpoint":
                ref_field = cond.get("ref", "")
                sp = self._resolve_operating_setpoint(setpoints, ref_field)
                tol = cond.get("tolerance_pct", 10) / 100
                if sp is not None and sp > 0 and abs(actual - sp) <= sp * tol:
                    matched_conds.append(
                        f"{field}={actual:.1f} near setpoint {sp} (+/-{tol*100:.0f}%)"
                    )
            elif op == "fluctuating":
                threshold = cond["value"]
                center = cond.get("center")
                is_fluct = self._check_fluctuation(
                    readings,
                    field,
                    threshold,
                    center,
                )
                if is_fluct:
                    if center is not None:
                        matched_conds.append(
                            f"{field} fluctuates +/-{threshold} inside [{float(center)-float(threshold):.0f},{float(center)+float(threshold):.0f}]"
                        )
                    else:
                        matched_conds.append(
                            f"{field} fluctuates +/-{threshold}"
                        )
            elif op == ">":
                value = cond["value"]
                if actual > value:
                    matched_conds.append(f"{field}={actual:.1f} > {value}")
            elif op == ">=":
                value = cond["value"]
                if actual >= value:
                    matched_conds.append(f"{field}={actual:.1f} >= {value}")
            elif op == "<":
                value = cond["value"]
                if actual < value:
                    matched_conds.append(f"{field}={actual:.1f} < {value}")
            elif op == "==":
                value = cond["value"]
                if abs(actual - value) < 0.01:
                    matched_conds.append(f"{field}={actual:.1f} == {value}")

        total = len(conditions)
        matched_count = len(matched_conds)

        if logic == "AND":
            # Opsi B mayoritas: >3 terpenuhi = terdeteksi
            # 5 kondisi -> 4/5, 6 kondisi -> 5/6
            if total == 5:
                matched = matched_count >= 4
            elif total == 6:
                matched = matched_count >= 5
            else:
                matched = matched_count == total
        else:
            matched = matched_count > 0

        return matched, matched_conds, total, missing_setpoint

    @staticmethod
    def _resolve_operating_setpoint(
        setpoints: OperatingSetpoint,
        ref_field: str,
    ) -> float | None:
        return support.resolve_operating_setpoint(setpoints, ref_field)

    def _check_fluctuation(
        self,
        readings: list[SensorReading],
        field: str,
        threshold: float,
        center: float | None = None,
    ) -> bool:
        return support.check_fluctuation(readings, field, threshold, center)
