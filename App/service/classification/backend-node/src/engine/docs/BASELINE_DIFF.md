# BASELINE_DIFF — Legacy vs Spec Behavior Comparison

**Generated:** 2026-10-25
**Purpose:** Document behavioral differences between legacy Python port and DEXMIN spec target

---

## Legacy Behavior (RulesEngine from Python Port)

### Classification Output
- **Single-trouble result**: `ClassificationResult.trouble_type` returns ONE trouble (first-match wins via `rules_match[0]`)
- **All evaluations included**: `rule_evaluations` contains entries for all 8 troubles + NORMAL
- **No `missingData` field**: Missing data indicated via `capability_status: "READY"` + `evaluation: "NO_MATCH"`
- **No `activeTroubles` field**: No persistent state across events
- **No `measurements` field**: Raw values in `sensor_snapshot`
- **No lifecycle timestamps**: No `startAt`/`endAt`/`triggerCount`/`stagnationCount`

### Evaluation Status
| Status | Meaning |
|--------|---------|
| `FULL` | At least one evaluator `READY` |
| `INSUFFICIENT_DATA` | No evaluators `READY` (unsupported pump) |
| `PARTIAL` | Not currently used |

### Mathematical Behaviors (Legacy)

#### PTS (Pompa Tersangkut Sampah)
- **Frequency**: `freq <= 10` (from `rules.json` `<=` operator)
- **Logic**: `PTS_F AND (>=3 of 4: kW>=ref, A>=ref, T>=110%, RPM>=100)`
- **No trigger counter**: Immediate emission on match
- **Ref defaults**: `kw_ref=75/250/400`, `amp_ref=157/517/867` per tier

#### Turbulensi
- **Frequency**: `freq < setpoint` (strict)
- **Logic**: `T_Freq AND T_KW AND T_A AND T_T` (strict 4/4)
- **T_A (Mathematical Area)**:
  - `0 history` → `insufficient` (need 30, got 0)
  - `1-29 history` → **CMA** (cumulative moving average of historical)
  - `>=30 history` → **MA30** (trailing 30 historical, current excluded)
- **Threshold**: `|A_current - MA/CMA| >= 10 A`
- **No trigger counter**: Immediate on full match

#### Banyak Sampah
- **Frequency**: `freq <= setpoint`
- **Logic**: Strict AND 4/4 (freq, kW, A, T)
- **No trigger counter**

#### Dry Run
- **DR_F**: `freqEq2dp(actual, setpoint)` — ROUND_HALF_UP at 2dp
- **DR_C**: `power <= 0.667*ref AND current <= 0.64*ref AND torque < 70%`
- **Logic**: `DR_F_armed AND (all 3 DR_C conditions)`
- **DR_F gating**: `freq_sustain` counter (currently 1 in all tiers → immediate)
- **Refs from PTS rule**: `kw_ref`, `amp_ref` borrowed from `POMPA_TERSANGKUT_SAMPAH`

#### Unbalance
- **Formula**: `(avg - phase) / phase * 100` for each phase
- **OR** of absolute deviations across 3 phases
- **Threshold**: `>= 10%`
- **Denominator**: Phase current (NOT average)
- **Zero phase**: Handled as `0%` deviation (no match)

#### Voltage (Under/Over)
- **Undervoltage**: `input_voltage < 360` (exclusive)
- **Overvoltage**: `input_voltage > 410` (exclusive)
- **Config validation**: Must have `field: "input_voltage"`, correct operator, numeric threshold

#### Panel Overheat
- **Logic**: OR of 3 temperatures `>= 60°C`
- **Partial NULL**: Evaluates available temps
- **All NULL**: Returns `READY` + `NO_MATCH` (legacy quirk)

### Trigger Counters (Legacy `count_trigger` / `freq_sustain`)
- **Per namespace isolation**: `namespace:pump_id:trouble_name`
- **`count_trigger <= 1`**: Immediate emission
- **`count_trigger > 1`**: Requires N consecutive TRUE
- **FALSE resets to 0**
- **No maximum cap**
- **PTS exempt**: No counter used

### Effective Refs (Configuration Resolver)
- **Priority**: `override → flowhead → profile`
- **Applied per-classify**: Snapshot, doesn't mutate global rules
- **Fields**: `power_kw`, `current_a`
- **Null ref**: Leaves condition value unchanged

### Evidence Window (Turbulensi T_A)
- **Max window**: 30 historical samples
- **Current reading excluded** from MA/CMA calculation
- **Gap handling**: Caller responsibility (engine assumes contiguous)
- **Namespace isolation**: Window tied to `trigger_namespace`

---

## Spec Target Behavior (DEXMIN Implementation Plan)

### Classification Output Contract (Target)
```typescript
interface ClassificationOutput {
  pumpId: string;
  receivedAt: string;
  results: TroubleResult[];           // READY ONLY
  missingData: Record<string, string[]>;  // NOT READY ONLY
  activeTroubles: string[];           // Last-known state
}
```

### Key Differences

| Aspect | Legacy | Spec Target |
|--------|--------|-------------|
| **Multi-label** | ❌ First-match only | ✅ All active troubles |
| **Readiness** | Implicit (READY/NO_MATCH) | Explicit (`Dapat Di Klasifikasi` / `Belum Dapat Di Klasifikasi`) |
| **Missing Data** | Hidden in NO_MATCH | Explicit `missingData` field |
| **Active Troubles** | None | `activeTroubles` from State Manager |
| **Lifecycle** | None | `startAt`, `endAt`, `triggerCount`, `stagnationCount` |
| **Normal** | Implicit fallback | Explicit classification with lifecycle |
| **Measurements** | `sensor_snapshot` | `measurements` (PoC only) |
| **Naming** | snake_case | camelCase (`pumpId`, `receivedAt`) |

### Mathematical Behaviors (Spec Target)
- **Immediate activation**: No `count_trigger` gating (legacy `freq_sustain` removed)
- **TriggerCount**: Increments on TRUE, resets on FALSE, holds on NULL
- **StagnationCount**: Increments on not-ready, resets on ready, ≥5 resets both counters (not detected)
- **NULL handling**: Ignored for NORMAL derivation only; not zero-filled for sensor formulas
- **OFF >120s**: Resets `activeTroubles` (OD-01/OD-02 pending)

### Open Mathematical Conflicts (OD-08)
| Conflict | Legacy | Profile | Status |
|----------|--------|---------|--------|
| PTS Frequency | `<= 10` | `< 10` | **DECISION_REQUIRED** |
| Unbalance Denominator | Phase current | TBD | **DECISION_REQUIRED** |
| Dry Run DR_C Logic | All 3 AND | TBD | **DECISION_REQUIRED** |

---

## Differential Regression Results (400 Frozen Cases)

**Run Date:** 2026-10-25
**Tool:** `engine/__tests__/differential.test.ts`
**Report:** `engine/docs/differential-report.json`

### Summary
| Category | Count | Percentage |
|----------|-------|------------|
| **EXPECTED_SPEC_CHANGE** | 87 | 21.8% |
| **UNRESOLVED** | 313 | 78.3% |
| **BUG_FIXED_BY_SPEC** | 0 | 0% |
| **MATCH** | 0 | 0% |

### EXPECTED_SPEC_CHANGE (87 cases)
These differences are **intentional** per the DEXMIN specification:

1. **Multi-label output** — New engine returns all active troubles; legacy returns only first-match
2. **Readiness split** — Legacy `NO_MATCH` → New `missingData` with explicit field paths
3. **Lifecycle fields** — New engine includes `startAt`, `endAt`, `triggerCount`, `stagnationCount`
4. **Active troubles persistence** — New engine maintains `activeTroubles` across events from State Manager

**Example (Case 8):**
- Legacy: `trouble_type: "panel_overheat"`
- New: `results: [pompa_tersangkut_sampah, turbulensi, banyak_sampah, dry_run, panel_overheat, normal]`, `activeTroubles: [undervoltage, panel_overheat]`

### UNRESOLVED (313 cases) — Require Domain Decisions

| Open Decision | Cases Affected | Description |
|---------------|----------------|-------------|
| **OD-07: 10s gap / history** | 249 | Legacy `insufficient_history` limitations; new engine window behavior |
| **OD-08: Formula conflicts** | 153 | PTS 10Hz boundary (`<=10` vs `<10`), Unbalance denominator |
| **OD-01/02: OFF detection** | 34 | Zero frequency readings, OFF >120s lifecycle reset |

**Breakdown by OD:**
- OD-07 (10s gap / insufficient history): 249 cases
- OD-08 (PTS 10Hz boundary): 50 cases
- OD-08 (Unbalance formula): 103 cases
- OD-01/02 (OFF detection): 34 cases

### BUG_FIXED_BY_SPEC (0 cases)
No additional bugs found beyond the expected specification changes. The legacy first-match behavior is captured under EXPECTED_SPEC_CHANGE (multi-label).

### MATCH (0 cases)
No exact matches due to structural output format differences (camelCase vs snake_case, new fields, etc.).

---

## Breaking Changes Required for Spec Compliance

1. **Return type**: `ClassificationResult` → `ClassificationOutput`
2. **Single → Multi-label**: `trouble_type` → `results[]` + `activeTroubles[]`
3. **Readiness split**: `rule_evaluations` → `results` (ready) + `missingData` (not ready)
4. **Lifecycle fields**: Add `startAt`, `endAt`, `triggerCount`, `stagnationCount`
5. **Naming**: snake_case → camelCase throughout
6. **Normal**: Implicit → Explicit with lifecycle
7. **Measurements**: Add PoC-only `measurements` field
8. **State Manager**: New separate module for atomic state transitions
9. **Event-time gate**: `receivedAt` strictly increasing per pumpId
10. **OFF detection**: New `isPumpOff` injectable port (OD-01)

---

## Files Not Modified (Outside Scope)
- `../application/classify.ts` — Caller, will need update
- `../socket/handlers.ts` — Caller, will need update
- `test/unit/engine.test.ts` — Existing tests, will need migration
- `test/golden/` — Golden fixtures, will need regeneration