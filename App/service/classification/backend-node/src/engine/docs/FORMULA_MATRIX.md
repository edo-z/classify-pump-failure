# FORMULA_MATRIX — Mathematical Specifications

**Generated:** 2026-10-25
**Purpose:** Authoritative reference for all mathematical formulas per trouble type
**Status:** Updated to match actual implementation in `evaluators/` and `mathematics/`

---

## 1. PTS — Pompa Tersangkut Sampah (specificFailureFH)

### Formula
```
PTS_F = (frequencyHz <= ptsFrequencyHz)
PTS_KW = (powerKw >= ptsPowerRefKw)
PTS_A  = (currentA >= ptsCurrentRefA)
PTS_T  = (torquePercent >= ptsTorqueRefPct)
PTS_RPM = (motorSpeedRpm >= ptsRpmRef)

PTS = PTS_F AND (PTS_KW + PTS_A + PTS_T + PTS_RPM >= 3)
```

### Parameters (per flowhead tier)
| Tier | ptsFrequencyHz | ptsPowerRefKw | ptsCurrentRefA | ptsTorqueRefPct | ptsRpmRef |
|------|----------------|---------------|----------------|-----------------|-----------|
| 500  | 10             | 75            | 157            | 110             | 100       |
| 3000 | 10             | 250           | 517            | 110             | 100       |
| 5000 | 10             | 400           | 867            | 110             | 100       |

### Conflict: OD-08
- **rules.json**: `<= 10` (legacy evaluator follows this)
- **pump_profiles.json**: `< 10`
- **Implementation**: Uses `<= 10` (from rules.json via configuration-resolver)
- **Status**: DECISION_REQUIRED — boundary 10.0 Hz behavior undecided

### Activation
- **Immediate**: No trigger counter, no freq_sustain gating
- **Multi-label**: Can co-occur with other troubles
- **Readiness**: Requires all 5 inputs + all config refs non-null

### Implementation: `evaluators/flowhead.ts` → `evaluatePTS()`

---

## 2. TURBULENSI (specificFailureFH)

### Formula
```
T_Freq = (frequencyHz < frequencySetpointHz)
T_KW   = (powerKw >= turbulensiPowerRefKw)
T_T    = (torquePercent >= turbulensiTorqueRefPct)

T_A: |currentA - MA/CMA| >= turbulensiCurrentDevThresholdA
     where MA/CMA uses HISTORICAL current only (current reading EXCLUDED)

Turbulensi = T_Freq AND T_KW AND T_A AND T_T
```

### T_A Mathematical Area
| Historical Samples | Reference | Formula |
|-------------------|-----------|---------|
| 0                 | Insufficient | Not ready → missingData: "motor_current_history" |
| 1–29              | CMA (Cumulative Moving Average) | mean(all historical) |
| ≥30               | MA30 (Moving Average 30) | mean(last 30 historical) |

**Current reading EXCLUDED from MA/CMA baseline**

### Parameters (per tier)
| Tier | turbulensiPowerRefKw | turbulensiTorqueRefPct | turbulensiCurrentDevThresholdA | turbulensiWindow |
|------|---------------------|------------------------|--------------------------------|------------------|
| 500  | 75                  | 90                     | 10                             | 30               |
| 3000 | 250                 | 90                     | 10                             | 30               |
| 5000 | 400                 | 90                     | 10                             | 30               |

### Activation
- **Immediate**: No trigger counter
- **Multi-label**: Can co-occur
- **History requirement**: ≥1 valid historical sample for CMA; ≥30 for MA30

### Implementation: `evaluators/flowhead.ts` → `evaluateTurbulensi()` → `mathematics/moving-average.ts` → `computeTA()`

---

## 3. BANYAK_SAMPAH (specificFailureFH)

### Formula
```
BS_F = (frequencyHz <= frequencySetpointHz)
BS_KW = (powerKw >= banyakSampahPowerRefKw)
BS_A  = (currentA >= banyakSampahCurrentRefA)
BS_T  = (torquePercent >= banyakSampahTorqueRefPct)

BanyakSampah = BS_F AND BS_KW AND BS_A AND BS_T
```

### Parameters (per tier)
| Tier | banyakSampahPowerRefKw | banyakSampahCurrentRefA | banyakSampahTorqueRefPct |
|------|------------------------|-------------------------|--------------------------|
| 500  | 75                     | 157                     | 90                       |
| 3000 | 250                    | 517                     | 90                       |
| 5000 | 400                    | 867                     | 90                       |

### Activation
- **Immediate**: Strict AND 4/4
- **Multi-label**: Can co-occur with PTS, Turbulensi
- **Readiness**: Requires all 4 inputs + all config refs non-null

### Implementation: `evaluators/flowhead.ts` → `evaluateBanyakSampah()`

---

## 4. DRY_RUN (specificFailureFH)

### Formula
```
DR_F = freqEq2dp(frequencyHz, frequencySetpointHz)  // 2dp ROUND_HALF_UP equality

DR_PowerThreshold = ptsPowerRefKw * dryRunPowerFactor
DR_CurrentThreshold = ptsCurrentRefA * dryRunCurrentFactor

DR_Power = (powerKw <= DR_PowerThreshold)
DR_Current = (currentA <= DR_CurrentThreshold)
DR_Torque = (torquePercent < dryRunTorqueThresholdPct)

DR_C = DR_Power AND DR_Current AND DR_Torque

DryRun = DR_F AND DR_C
```

### freqEq2dp — 2dp ROUND_HALF_UP Equality
```
freqEq2dp(actual, setpoint) = 
  Decimal(actual).toFixed(2, ROUND_HALF_UP) == Decimal(setpoint).toFixed(2, ROUND_HALF_UP)

Examples:
  40.004 vs 40.000 → TRUE  (40.00 == 40.00)
  40.005 vs 40.000 → FALSE (40.01 != 40.00)
  38.004 vs 38.000 → TRUE
  38.005 vs 38.000 → FALSE
```

### Parameters (per tier, derived from PTS refs)
| Tier | dryRunPowerFactor | dryRunCurrentFactor | dryRunTorqueThresholdPct |
|------|-------------------|---------------------|--------------------------|
| 500  | 0.667             | 0.64                | 70                       |
| 3000 | 0.667             | 0.64                | 70                       |
| 5000 | 0.667             | 0.64                | 70                       |

**DR thresholds derived from PTS refs at evaluation time**

### Conflict: OD-08
- **DR_C Logic**: All 3 AND (legacy) — VERIFY if official spec differs
- **DR_F Rounding**: 2dp ROUND_HALF_UP — VERIFY
- **Status**: VERIFY with spec owner

### Implementation: `evaluators/flowhead.ts` → `evaluateDryRun()` → `mathematics/frequency.ts` → `freqEq2dp()`

---

## 5. UNBALANCE (specificFailureVFD)

### Formula (Legacy — VERIFY)
```
Ri = (Iu + Iv + Iw) / 3

Eu = (Ri - Iu) / Iu * 100   // Iu ≠ 0
Ev = (Ri - Iv) / Iv * 100   // Iv ≠ 0
Ew = (Ri - Iw) / Iw * 100   // Iw ≠ 0

Unbalance = (|Eu| >= thresholdPct) OR (|Ev| >= thresholdPct) OR (|Ew| >= thresholdPct)
```

**Denominator: Phase current (NOT average)** — **OD-08: DECISION_REQUIRED**

### Zero Phase Handling
- If phase = 0: deviation = 0% (no match)

### Parameters
| Parameter | Value |
|-----------|-------|
| thresholdPct | 10% |
| Operator | OR of absolute deviations |

### Implementation: `evaluators/vfd.ts` → `evaluateUnbalance()` → `mathematics/three-phase.ts` → `calculateUnbalance()`

---

## 6. UNDERVOLTAGE (specificFailureVFD)

### Formula
```
Undervoltage = (inputVoltageV < undervoltageThresholdV)
```

### Parameters
| Parameter | Value |
|-----------|-------|
| undervoltageThresholdV | 360 V |

### Boundary Behavior
- `< 360` → TRUE
- `>= 360` → FALSE
- Exclusive boundary

### Implementation: `evaluators/vfd.ts` → `evaluateUndervoltage()`

---

## 7. OVERVOLTAGE (specificFailureVFD)

### Formula
```
Overvoltage = (inputVoltageV > overvoltageThresholdV)
```

### Parameters
| Parameter | Value |
|-----------|-------|
| overvoltageThresholdV | 410 V |

### Boundary Behavior
- `> 410` → TRUE
- `<= 410` → FALSE
- Exclusive boundary

### Implementation: `evaluators/vfd.ts` → `evaluateOvervoltage()`

---

## 8. PANEL_OVERHEAT (specificFailureVFD)

### Formula
```
PanelOverheat = (ambientTemperatureC >= thresholdC) 
             OR (controlBoardTemperatureC >= thresholdC)
             OR (inverterTemperatureC >= thresholdC)
```

### Parameters
| Parameter | Value |
|-----------|-------|
| thresholdC | 60 °C |

### NULL Handling (OD-04)
| Available Temps | Behavior |
|-----------------|----------|
| All 3 present | OR evaluation |
| Partial (1-2) | OR of available |
| All NULL | Not ready → missingData |

### Implementation: `evaluators/vfd.ts` → `evaluatePanelOverheat()`

---

## 9. NORMAL (Derived)

### Formula
```
NORMAL = NOT (ANY activeTrouble IN [PTS, Turbulensi, BanyakSampah, DryRun, Unbalance, Undervoltage, Overvoltage, PanelOverheat])
```

### Special Rules
- **NULL ignored**: Active troubles with NULL recent evaluation remain active
- **All not-ready**: NORMAL = true (no active troubles)
- **Explicit lifecycle**: Has `startAt`/`endAt`/`triggerCount`/`stagnationCount`

### Implementation: `evaluators/normal.ts` → `evaluateNormal()`

---

## 10. STATE TRANSITION MATRIX

| Input | detected | triggerCount | stagnationCount | Lifecycle |
|-------|----------|--------------|-----------------|-----------|
| ready=true, trigger=1 | true | prev + 1 | 0 | if !detected: startAt=now |
| ready=true, trigger=0 | false | 0 | 0 | if detected: endAt=now |
| ready=false, stagnation<5 | hold | hold | +1 | no timestamp change |
| ready=false, stagnation≥5 | hold | 0 | 0 | no timestamp change |
| Event rejected (time gate) | hold | hold | hold | no mutation |
| OFF >120s | reset active | TBD (OD-02) | TBD | TBD (OD-02) |

### Invariants
- `triggerCount` not an activation threshold; no maximum
- Stagnation reset does NOT set `detected=false`
- NULL evaluation holds triggerCount, increments stagnation
- `stagnationCount` resets to 0 on any ready evaluation

### Implementation: `state/transition.ts` → `applyTransition()`

---

## 11. BOUNDARY CONDITIONS SUMMARY

| Trouble | Boundary | Expected |
|---------|----------|----------|
| PTS Freq | 10.0 Hz | **OD-08: DECISION_REQUIRED** (≤10 vs <10) |
| PTS Freq | 10.001 Hz | FALSE |
| Undervoltage | 359.99 V | TRUE |
| Undervoltage | 360.00 V | FALSE |
| Overvoltage | 410.00 V | FALSE |
| Overvoltage | 410.01 V | TRUE |
| Panel | 59.9 °C | FALSE |
| Panel | 60.0 °C | TRUE |
| DR_F | 38.004 vs 38.0 | TRUE |
| DR_F | 38.005 vs 38.0 | FALSE |
| Unbalance | 10.0% | TRUE (|dev| >= 10) |
| Unbalance | 9.99% | FALSE |

---

## 12. TURBULENSI T_A WINDOW BEHAVIOR

| Historical Samples | Reference Type | Effective Window | Current Included? |
|-------------------|----------------|------------------|-------------------|
| 0 | Insufficient | 0 | — |
| 1–29 | CMA | n | NO |
| ≥30 | MA30 | 30 | NO |

**Current reading NEVER included in MA/CMA baseline**

### Implementation: `mathematics/moving-average.ts` → `computeTA()` → `getTAParams()`

---

## 13. DRY RUN DR_F ROUNDING TABLE

| Actual | Setpoint | Rounded Actual | Rounded SP | Match |
|--------|----------|----------------|------------|-------|
| 40.004 | 40.0 | 40.00 | 40.00 | TRUE |
| 40.005 | 40.0 | 40.01 | 40.00 | FALSE |
| 38.004 | 38.0 | 38.00 | 38.00 | TRUE |
| 38.005 | 38.0 | 38.01 | 38.00 | FALSE |
| 37.995 | 38.0 | 38.00 | 38.00 | TRUE |
| 37.994 | 38.0 | 37.99 | 38.00 | FALSE |
| 46.104 | 46.1 | 46.10 | 46.10 | TRUE |
| 46.105 | 46.1 | 46.11 | 46.10 | FALSE |

**Method**: `Decimal(value).toDecimalPlaces(2, ROUND_HALF_UP)`

---

## 14. READINESS REQUIREMENTS PER TROUBLE

| Trouble | Required Telemetry | Required Config |
|---------|-------------------|-----------------|
| PTS | frequencyHz, powerKw, currentA, torquePercent, motorSpeedRpm | ptsFrequencyHz, ptsPowerRefKw, ptsCurrentRefA, ptsTorqueRefPct, ptsRpmRef |
| Turbulensi | frequencyHz, powerKw, torquePercent, motor_current_history | frequencySetpointHz, turbulensiPowerRefKw, turbulensiTorqueRefPct, turbulensiCurrentDevThresholdA, turbulensiWindow |
| Banyak Sampah | frequencyHz, powerKw, currentA, torquePercent | frequencySetpointHz, banyakSampahPowerRefKw, banyakSampahCurrentRefA, banyakSampahTorqueRefPct |
| Dry Run | frequencyHz, powerKw, currentA, torquePercent | frequencySetpointHz, ptsPowerRefKw, ptsCurrentRefA, dryRunPowerFactor, dryRunCurrentFactor, dryRunTorqueThresholdPct |
| Unbalance | phaseCurrentU, phaseCurrentV, phaseCurrentW | unbalanceThresholdPct |
| Undervoltage | inputVoltageV | undervoltageThresholdV |
| Overvoltage | inputVoltageV | overvoltageThresholdV |
| Panel Overheat | Any 1 of: ambient, controlBoard, inverter | panelOverheatThresholdC |
| Normal | (derived) | (derived) |

---

## 15. MISSING DATA FIELD PATHS (for `missingData` output)

When evaluator returns `ready: false`, `missingData` contains paths like:
- `config.flowhead.powerRefKw` — Config reference missing
- `config.flowhead.ptsFrequencyHz` — Config reference missing
- `frequencyHz` — Telemetry field null
- `motor_current_history` — Insufficient history for Turbulensi
- `phaseCurrentU` — Phase current null
- `inputVoltageV` — Voltage null
- `ambientTemperatureC` — Temperature null (all three)