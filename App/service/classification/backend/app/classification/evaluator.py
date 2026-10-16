"""Rule evaluators untuk RulesEngine — diekstrak verbatim dari engine.py (5R Rapi).

Fungsi menerima state via parameter (lists diisi in-place); satu-satunya
kopling ke engine adalah 2 method stateful (_match_rule, _update_trigger_counter)
yang diteruskan sebagai `engine`. Rumus/persamaan TIDAK diubah.
"""

from __future__ import annotations

from app.classification import engine_support as support
from app.classification.models import (
    MatchedRule,
    OperatingSetpoint,
    PumpConfig,
    RuleEvaluation,
    SensorReading,
    TroubleType,
)


def evaluate_tier_rules(
    engine,
    readings: list[SensorReading],
    agg: dict,
    tier_rules: dict,
    pump_config: PumpConfig,
    operating_setpoint: OperatingSetpoint,
    trigger_namespace: str,
    rules_match: list[MatchedRule],
    rule_evaluations: list[RuleEvaluation],
    limitations: list[str],
) -> None:
    # ----------------------------------------------------
    # Tier / AND rules
    # ----------------------------------------------------

    for (
        trouble_name,
        rule_def,
    ) in tier_rules.get(
        "rules",
        {},
    ).items():

        try:
            trouble_type = (
                TroubleType[trouble_name]
            )
        except KeyError:
            continue

        # POMPA khusus PTS_F <=10 ∧ Count>=3 tanpa MEAN, DRY_RUN dinamis, else generic
        if trouble_name == "POMPA_TERSANGKUT_SAMPAH":
            # PTS tanpa MEAN: per-sample terakhir, ref 110% & 100 RPM, Count>=3
            last = readings[-1] if readings else None
            # ref dinamis dari tier POMPA yang sama
            kw_ref = None
            amp_ref = None
            ref_torque = 110.0
            ref_rpm = 100.0
            ref_freq = 10.0
            for c in rule_def.get("conditions", []):
                if c.get("field") == "output_power":
                    kw_ref = c.get("value")
                elif c.get("field") == "motor_current":
                    amp_ref = c.get("value")
                else:
                    try:
                        override = float(c.get("value"))
                    except (TypeError, ValueError):
                        continue
                    if c.get("field") == "motor_torque":
                        ref_torque = override
                    elif c.get("field") == "motor_speed":
                        ref_rpm = override
                    elif c.get("field") == "output_frequency":
                        ref_freq = override
            # fallback ke tier jika tidak ada (seharusnya ada)
            if kw_ref is None:
                kw_ref = 75
            if amp_ref is None:
                amp_ref = 157
            freq = getattr(last, "output_frequency", None) if last else None
            kw = getattr(last, "output_power", None) if last else None
            amp = getattr(last, "motor_current", None) if last else None
            torque = getattr(last, "motor_torque", None) if last else None
            rpm = getattr(last, "motor_speed", None) if last else None
            pts_f = freq is not None and freq <= ref_freq
            pts_kw = kw is not None and kw >= kw_ref
            pts_a = amp is not None and amp >= amp_ref
            pts_t = torque is not None and torque >= ref_torque
            pts_rpm = rpm is not None and rpm >= ref_rpm
            pts_count = sum([pts_kw, pts_a, pts_t, pts_rpm])
            matched = bool(pts_f and pts_count >= 3)
            matched_conds = []
            if pts_f:
                matched_conds.append(f"freq={freq:.1f} <={ref_freq:g}")
            if pts_kw:
                matched_conds.append(f"power={kw:.1f} >= {kw_ref}")
            if pts_a:
                matched_conds.append(f"current={amp:.1f} >= {amp_ref}")
            if pts_t:
                matched_conds.append(f"torque={torque:.1f} >= {ref_torque:g}%")
            if pts_rpm:
                matched_conds.append(f"speed={rpm:.1f} >= {ref_rpm:g}")
            total = 5
            _missing_setpoint = False
        elif trouble_name in ("LOW_WATER_MENYALA", "DRY_RUN"):
            # kw_ref/amp_ref dari POMPA_TERSANGKUT_SAMPAH di tier yang sama
            pompa_rule = tier_rules.get("rules", {}).get("POMPA_TERSANGKUT_SAMPAH", {})
            kw_ref = None
            amp_ref = None
            for c in pompa_rule.get("conditions", []):
                if c.get("field") == "output_power":
                    kw_ref = c.get("value")
                elif c.get("field") == "motor_current":
                    amp_ref = c.get("value")
            if kw_ref is None:
                kw_ref = next(
                    (c.get("value") for c in rule_def.get("conditions", []) if c.get("field") == "output_power"),
                    0,
                )
            if amp_ref is None:
                amp_ref = next(
                    (c.get("value") for c in rule_def.get("conditions", []) if c.get("field") == "motor_current"),
                    0,
                )
            try:
                dr_kw = float(kw_ref) * 0.667 if kw_ref is not None else 0
                dr_amp = float(amp_ref) * 0.64 if amp_ref is not None else 0
            except Exception:
                dr_kw = 0
                dr_amp = 0
            # Threshold torque dari rule_def (default 70, milik rules.json).
            dr_t = 70.0
            for c in rule_def.get("conditions", []):
                if c.get("field") == "motor_torque":
                    try:
                        dr_t = float(c.get("value"))
                    except (TypeError, ValueError):
                        pass
                    break
            # Dua tingkat, tanpa MEAN — per-sample terakhir, spesifikasi murni:
            # DryRun = DR_F ∧ DR_C, DR_C = DR_KW ∧ DR_A ∧ DR_T.
            # DR_F = kesetaraan raw 2 desimal (tanpa normalisasi).
            # freq_sustain/count_trigger = 1 (langsung emit per sampel).
            last = readings[-1] if readings else None
            actual_freq = getattr(last, "output_frequency", None) if last else None
            sp_freq = support.resolve_operating_setpoint(operating_setpoint, "setpoint_freq")
            actual_kw = getattr(last, "output_power", None) if last else None
            actual_amp = getattr(last, "motor_current", None) if last else None
            actual_torque = getattr(last, "motor_torque", None) if last else None
            dr_f_raw = support.freq_eq_2dp(actual_freq, sp_freq)
            try:
                freq_sustain = int(rule_def.get("freq_sustain", 1))
                if freq_sustain < 1:
                    freq_sustain = 1
            except Exception:
                freq_sustain = 1
            dr_f_armed, dr_f_cur = engine._update_trigger_counter(
                pump_config.pump_id, "DRY_RUN_DR_F", dr_f_raw, freq_sustain, trigger_namespace
            )
            matched_conds = []
            if dr_f_raw:
                matched_conds.append(f"DR_F: output_frequency={actual_freq:.2f} == setpoint {sp_freq:.2f}")
            if actual_kw is not None and actual_kw <= dr_kw:
                matched_conds.append(f"DR_C: output_power={actual_kw:.1f} <= DR_kW {dr_kw:.1f} (0.667*{kw_ref})")
            if actual_amp is not None and actual_amp <= dr_amp:
                matched_conds.append(f"DR_C: motor_current={actual_amp:.1f} <= DR_A {dr_amp:.1f} (0.64*{amp_ref})")
            if actual_torque is not None and actual_torque < dr_t:
                matched_conds.append(f"DR_C: motor_torque={actual_torque:.1f} < {dr_t:g}")
            total = 4
            matched = bool(dr_f_armed and len(matched_conds) == 4)
            _missing_setpoint = False
            if dr_f_raw and not dr_f_armed:
                limitations.append(
                    f"DRY_RUN DR_F arming {dr_f_cur}/{freq_sustain}: freq at setpoint, sustain {dr_f_cur} < {freq_sustain}"
                )
        elif trouble_name == "TURBULENSI":
            # Strict 4/4: T_Freq ∧ T_KW ∧ T_A (trailing MA) ∧ T_T, T_RPM dibuang
            last = readings[-1] if readings else None
            kw_ref = None
            torque_ref = 90.0
            for c in rule_def.get("conditions", []):
                if c.get("field") == "output_power":
                    try:
                        kw_ref = float(c.get("value"))
                    except Exception:
                        pass
                elif c.get("field") == "motor_torque":
                    try:
                        torque_ref = float(c.get("value", 90.0))
                    except Exception:
                        pass
            if kw_ref is None:
                kw_ref = 250.0
            window, threshold = support.get_t_a_params(rule_def)
            freq = getattr(last, "output_frequency", None) if last else None
            kw = getattr(last, "output_power", None) if last else None
            torque = getattr(last, "motor_torque", None) if last else None
            sp_freq = support.resolve_operating_setpoint(operating_setpoint, "setpoint_freq")
            t_freq = (
                freq is not None
                and sp_freq is not None
                and sp_freq > 0
                and freq < sp_freq
            )
            t_kw = kw is not None and kw >= kw_ref
            t_t = torque is not None and torque >= torque_ref
            t_a_res = support.compute_t_a(readings, window=window, threshold=threshold)
            t_a = bool(t_a_res.get("T_A", False))
            matched_conds = []
            if t_freq:
                matched_conds.append(f"freq={freq:.1f} < setpoint {sp_freq}")
            if t_kw:
                matched_conds.append(f"power={kw:.1f} >= {kw_ref:g}")
            if t_a:
                n_ref = t_a_res.get("window")
                ref_label = (
                    f"CMA{n_ref}"
                    if t_a_res.get("ref_kind") == "CMA"
                    else f"MA{n_ref}"
                )
                matched_conds.append(
                    f"current={t_a_res.get('A'):.1f} vs {ref_label}"
                    f"{t_a_res.get('MA_A'):.1f} Δ{t_a_res.get('Delta_A'):+.1f}"
                    f" |Δ|{t_a_res.get('Abs_Delta_A'):.1f}>={t_a_res.get('threshold'):g}"
                )
            if t_t:
                matched_conds.append(f"torque={torque:.1f} >= {torque_ref:g}%")
            total = 4
            matched = bool(t_freq and t_kw and t_a and t_t)
            _missing_setpoint = False
            if t_a_res.get("insufficient"):
                limitations.append(
                    f"TURBULENSI T_A insufficient_history: {t_a_res.get('reason')}"
                    f" (need {t_a_res.get('need', window)} prev, "
                    f"A={t_a_res.get('A')})"
                )
        else:
            (
                matched,
                matched_conds,
                total,
                _missing_setpoint,
            ) = engine._match_rule(
                readings,
                agg,
                rule_def,
                operating_setpoint,
            )

        rule_evaluations.append(
            RuleEvaluation(
                trouble_type=(
                    trouble_type
                ),
                capability_status="READY",
                evaluation=(
                    "MATCH"
                    if matched
                    else "NO_MATCH"
                ),
                matched_conditions=(
                    matched_conds
                ),
                total_conditions=total,
            )
        )

        # POMPA khusus PTS tanpa count_trigger buffer — langsung emit jika PTS true
        if trouble_name == "POMPA_TERSANGKUT_SAMPAH":
            if matched:
                rules_match.append(
                    MatchedRule(
                        trouble_type=trouble_type,
                        matched_conditions=matched_conds,
                        total_conditions=total,
                    )
                )
            # tanpa pending/limitations, tanpa _trigger_counters
        else:
            # count_trigger untuk trouble lain (generic, Opsi B)
            count_trigger = support.get_count_trigger(rule_def)
            if matched:
                should_emit, cur = engine._update_trigger_counter(
                    pump_config.pump_id, trouble_name, True, count_trigger, trigger_namespace
                )
                if should_emit:
                    rules_match.append(
                        MatchedRule(
                            trouble_type=(
                                trouble_type
                            ),
                            matched_conditions=(
                                matched_conds
                            ),
                            total_conditions=(
                                total
                            ),
                        )
                    )
                elif count_trigger > 1:
                    limitations.append(
                        f"{trouble_name} pending {cur}/{count_trigger}: consecutive match {cur} < trigger {count_trigger}"
                    )
            else:
                # Opsi B: NO_MATCH reset (tidak ada hold)
                engine._update_trigger_counter(
                    pump_config.pump_id, trouble_name, False, count_trigger, trigger_namespace
                )


def evaluate_panel(
    readings: list[SensorReading],
    panel_rules: dict,
    rules_match: list[MatchedRule],
    rule_evaluations: list[RuleEvaluation],
) -> None:
    # ----------------------------------------------------
    # Common OR rule: PANEL_OVERHEAT
    #
    # OR semantics (Opsi B):
    # - one available MATCH is sufficient
    # - no match or missing -> NO_MATCH (tidak ada SKIPPED)
    # ----------------------------------------------------



    for (
        trouble_name,
        rule_def,
    ) in panel_rules.items():

        try:
            trouble_type = (
                TroubleType[trouble_name]
            )
        except KeyError:
            continue

        # Opsi B: per-sample max tanpa window/mean — cek reading terakhir langsung >=60
        # Tidak ada SKIPPED — hanya MATCH/NO_MATCH (missing = tidak match, reset)
        last = readings[-1] if readings else None
        matched = False
        matched_conds: list[str] = []
        total = len(rule_def.get("conditions", []))
        if last is not None:
            for cond in rule_def.get("conditions", []):
                field = cond.get("field")
                op = cond.get("op")
                value = cond.get("value")
                actual = getattr(last, field, None) if field else None
                if actual is None:
                    continue
                elif op == ">" and actual > value:
                    matched = True
                    matched_conds.append(f"{field}={actual:.1f} > {value}")
                elif op == ">=" and actual >= value:
                    matched = True
                    matched_conds.append(f"{field}={actual:.1f} >= {value}")
                elif op == "<" and actual < value:
                    matched = True
                    matched_conds.append(f"{field}={actual:.1f} < {value}")

        if matched:
            rule_evaluations.append(
                RuleEvaluation(
                    trouble_type=(
                        trouble_type
                    ),
                    capability_status="READY",
                    evaluation="MATCH",
                    matched_conditions=(
                        matched_conds
                    ),
                    total_conditions=total,
                )
            )

            rules_match.append(
                MatchedRule(
                    trouble_type=(
                        trouble_type
                    ),
                    matched_conditions=(
                        matched_conds
                    ),
                    total_conditions=(
                        total
                    ),
                )
            )

        else:
            rule_evaluations.append(
                RuleEvaluation(
                    trouble_type=(
                        trouble_type
                    ),
                    capability_status="READY",
                    evaluation="NO_MATCH",
                    total_conditions=total,
                )
            )


def evaluate_unbalance(
    readings: list[SensorReading],
    unbalance_rule: dict,
    rules_match: list[MatchedRule],
    rule_evaluations: list[RuleEvaluation],
    limitations: list[str],
) -> None:
    # ----------------------------------------------------
    # Common derived rule: UNBALANCE
    #
    # Ri=(U+V+W)/3, lalu deviasi per fasa dengan penyebut
    # fasa masing-masing. Tiap fasa jadi boolean terhadap
    # threshold, digabung OR (final):
    #
    # Eu=(Ri-U)/U*100, Ev=(Ri-V)/V*100, Ew=(Ri-W)/W*100
    # UNBALANCE = (|Eu|>=T) OR (|Ev|>=T) OR (|Ew|>=T)
    #
    # Satu fasa TRUE sudah mengaktifkan UNBALANCE
    # (satu aturan OR, total_conditions=1).
    #
    # Boundary contract (final):
    #   >= threshold -> MATCH
    #   < threshold  -> NO_MATCH
    # ----------------------------------------------------

    unbalance_threshold = (
            unbalance_rule.get(
                "threshold_pct"
            )
    )

    unbalance_operator = (
        unbalance_rule.get(
            "operator"
        )
    )

    if (
        not isinstance(
            unbalance_threshold,
            (int, float),
        )
        or unbalance_operator != ">="
    ):
        rule_evaluations.append(
            RuleEvaluation(
                trouble_type=(
                    TroubleType.UNBALANCE
                ),
                capability_status=(
                    "UNSUPPORTED"
                ),
                missing_requirements=[
                    "unbalance_rule_config",
                ],
            )
        )

        limitations.append(
            (
                "UNBALANCE not evaluated: "
                "valid threshold/operator "
                "configuration unavailable"
            )
        )

    else:
        last = readings[-1] if readings else None
        if last is None:
            rule_evaluations.append(
                RuleEvaluation(
                    trouble_type=(
                        TroubleType.UNBALANCE
                    ),
                    capability_status="READY",
                    evaluation="NO_MATCH",
                    total_conditions=1,
                )
            )
        else:
            u = getattr(last, "arus_rms_u", None)
            v = getattr(last, "arus_rms_v", None)
            w = getattr(last, "arus_rms_w", None)
            if u is None or v is None or w is None:
                rule_evaluations.append(
                    RuleEvaluation(
                        trouble_type=(
                            TroubleType.UNBALANCE
                        ),
                        capability_status="READY",
                        evaluation="NO_MATCH",
                        total_conditions=1,
                    )
                )
            else:
                # Rumus yang ditetapkan (OR per fasa):
                # Ri=(U+V+W)/3, Eu=(Ri-U)/U*100 (+Ev,+Ew),
                # UNBALANCE = (|Eu|>=T) OR (|Ev|>=T) OR (|Ew|>=T)
                ri = (u + v + w) / 3.0
                eu = ((ri - u) / u) * 100 if u != 0 else None
                ev = ((ri - v) / v) * 100 if v != 0 else None
                ew = ((ri - w) / w) * 100 if w != 0 else None
                # jika ada penyebut 0 → tidak bisa hitung → NO_MATCH
                if eu is None or ev is None or ew is None:
                    rule_evaluations.append(
                        RuleEvaluation(
                            trouble_type=(
                                TroubleType.UNBALANCE
                            ),
                            capability_status="READY",
                            evaluation="NO_MATCH",
                            total_conditions=1,
                        )
                    )
                else:
                    # OR per fasa: salah satu TRUE sudah MATCH
                    # (satu aturan OR, total_conditions=1).
                    limit = float(unbalance_threshold)
                    eu_ok = abs(eu) >= limit
                    ev_ok = abs(ev) >= limit
                    ew_ok = abs(ew) >= limit
                    matched = eu_ok or ev_ok or ew_ok
                    matched_conditions = (
                        [
                            f"unbalance OR: Eu {eu:.2f}% {'TRUE' if eu_ok else 'FALSE'}, Ev {ev:.2f}% {'TRUE' if ev_ok else 'FALSE'}, Ew {ew:.2f}% {'TRUE' if ew_ok else 'FALSE'} >= {limit:.2f}% (Ri {ri:.2f})"
                        ]
                        if matched
                        else []
                    )
                    rule_evaluations.append(
                        RuleEvaluation(
                            trouble_type=(
                                TroubleType.UNBALANCE
                            ),
                            capability_status="READY",
                            evaluation="MATCH" if matched else "NO_MATCH",
                            matched_conditions=matched_conditions,
                            total_conditions=1,
                        )
                    )
                    if matched:
                        rules_match.append(
                            MatchedRule(
                                trouble_type=TroubleType.UNBALANCE,
                                matched_conditions=matched_conditions,
                                total_conditions=1,
                            )
                        )


def evaluate_voltage(
    agg: dict,
    capability_rules: dict,
    rules_match: list[MatchedRule],
    rule_evaluations: list[RuleEvaluation],
    limitations: list[str],
) -> None:
    # ----------------------------------------------------
    # Common rules: INPUT VOLTAGE (pure AC)
    #
    # Field input_voltage holds the AC input voltage (no conversion).
    #
    # UNDERVOLTAGE (ambang dari rules.json capability_rules):
    #   < 360 V  -> MATCH
    #   >=360 V  -> NO_MATCH
    #
    # OVERVOLTAGE:
    #   > 410 V  -> MATCH
    #   <=410 V  -> NO_MATCH
    #
    # Missing input_voltage:
    #   both capabilities -> NO_MATCH (Opsi B, tidak ada SKIPPED)
    # ----------------------------------------------------

    voltage_capabilities = (
        (
            "UNDERVOLTAGE",
            TroubleType.UNDERVOLTAGE,
            "<",
        ),
        (
            "OVERVOLTAGE",
            TroubleType.OVERVOLTAGE,
            ">",
        ),
    )

    for (
        trouble_name,
        trouble_type,
        expected_operator,
    ) in voltage_capabilities:
        voltage_rule = (
            capability_rules.get(
                trouble_name,
                {},
            )
        )

        field = (
            voltage_rule.get(
                "field"
            )
            or voltage_rule.get(
                "source_field"
            )
        )

        operator = (
            voltage_rule.get(
                "operator"
            )
        )

        threshold_v = (
            voltage_rule.get(
                "threshold_v"
            )
        )

        valid_config = (
            field == "input_voltage"
            and operator
            == expected_operator
            and isinstance(
                threshold_v,
                (int, float),
            )
        )

        if not valid_config:
            rule_evaluations.append(
                RuleEvaluation(
                    trouble_type=(
                        trouble_type
                    ),
                    capability_status=(
                        "UNSUPPORTED"
                    ),
                    missing_requirements=[
                        (
                            f"{trouble_name.lower()}"
                            "_rule_config"
                        )
                    ],
                    total_conditions=1,
                )
            )

            limitations.append(
                (
                    f"{trouble_name} "
                    "not evaluated: "
                    "valid voltage rule "
                    "configuration unavailable"
                )
            )

            continue

        input_voltage = agg.get(
            "input_voltage"
        )

        if input_voltage is None:
            # Opsi B: tidak ada SKIPPED — input_voltage missing = NO_MATCH
            rule_evaluations.append(
                RuleEvaluation(
                    trouble_type=(
                        trouble_type
                    ),
                    capability_status="READY",
                    evaluation="NO_MATCH",
                    total_conditions=1,
                )
            )

            continue

        threshold = float(
            threshold_v
        )

        if operator == "<":
            matched = (
                float(input_voltage)
                < threshold
            )
        else:
            matched = (
                float(input_voltage)
                > threshold
            )

        matched_conditions = (
            [
                (
                    "input_voltage "
                    f"{float(input_voltage):.2f} "
                    f"{operator} "
                    f"{threshold:.2f}"
                )
            ]
            if matched
            else []
        )

        rule_evaluations.append(
            RuleEvaluation(
                trouble_type=(
                    trouble_type
                ),
                capability_status="READY",
                evaluation=(
                    "MATCH"
                    if matched
                    else "NO_MATCH"
                ),
                matched_conditions=(
                    matched_conditions
                ),
                total_conditions=1,
            )
        )

        if matched:
            rules_match.append(
                MatchedRule(
                    trouble_type=(
                        trouble_type
                    ),
                    matched_conditions=(
                        matched_conditions
                    ),
                    total_conditions=1,
                )
            )
