# OPEN_DECISIONS — Phase 1 Characterization + Phase 8 Differential Results

**Generated:** 2026-10-25
**Status:** All items require domain owner resolution before production deployment
**Principle:** Mathematical specification is source of truth; do NOT guess

---

## OD-01: Pump OFF Detection
**Question:** Which field(s) definitively indicate pump OFF?
**Current State:** Payload contains `status`, `vsd_standby`, `pump_fault`, etc. Semantics undocumented.
**Constraint:** Agent MUST NOT guess. Provide `isPumpOff` injectable port.
**Required:** Verified OFF mapping from middleware/device team.
**Impact:** OFF >120s continuous resets `activeTroubles` (spec requirement).
**Test Fixture Needed:** Explicit OFF signal in test payloads.
**Implementation:** `engine.ts` constructor accepts `isPumpOff` function; default throws `OD-01: isPumpOff not injected`
**Differential Impact:** 34 cases flagged with zero frequency / OFF detection

---

## OD-02: OFF 120s Reset — Lifecycle Impact
**Question:** When OFF >120s resets `activeTroubles`, what happens to lifecycle?
**Proposal:** Close active episodes (`endAt = receivedAt`), clear counters/windows.
**Status:** **DECISION_REQUIRED** — User only specified "reset activeTroubles".
**Risk:** If episodes not closed, stale troubles may reappear on next event.
**Test Needed:** Verify episode closure behavior with OFF fixture.
**Implementation:** `engine.ts` → `_checkOffReset()` calls `StateManager.resetPump()` which clears troubles Map
**Differential Impact:** 34 cases (same as OD-01)

---

## OD-03: Config Hot-Reload — Active Trouble State
**Question:** When threshold/reference changes while trouble is active, what happens?
**Options:**
- A) Preserve state, apply new config to next evaluation
- B) Re-evaluate active troubles with new config immediately
- C) Reset state for affected troubles
**Status:** **DECISION_REQUIRED** — Snapshot config per event is decided; state reset policy not.
**Impact:** State Manager design depends on this.
**Implementation:** `engine.ts` → `_classifyInternal()` has OD-03 guard; current default is PRESERVE_STATE (config changes apply to NEXT event)

---

## OD-04: NULL Operand Truth Tables (AND/OR)
**Question:** Can evaluation be "ready" when outcome is determined despite NULL operands?
**Examples:**
- `TRUE OR NULL` → Can return TRUE (short-circuit)?
- `FALSE AND NULL` → Can return FALSE (short-circuit)?
- `NULL OR NULL` → Not ready?
**Current Legacy:** NULL → `READY` + `NO_MATCH` for panel/voltage/unbalance
**Spec Target:** Separate `ready` from `detected`; NULL → `not ready` + `missingData`
**Status:** **DECISION_REQUIRED** — Need explicit truth table per trouble type.
**Impact:** Evaluator readiness logic, `missingData` field population.
**Implementation:** All evaluators return `ready: false` if any required input is NULL
**Differential Impact:** 0 cases flagged (conservative approach: NULL → not ready)

---

## OD-05: Measurement Field Canonical Mapping
**Question:** Which raw field maps to which canonical sensor input?
**Mappings Needed:**
| Raw Field | Canonical Target | Status |
|-----------|------------------|--------|
| `output_current` | `currentA`? | **UNVERIFIED** |
| `motor_current` | `currentA`? | **UNVERIFIED** |
| `output_torsi` | `torquePercent`? | **UNVERIFIED** |
| `motor_torque` | `torquePercent`? | **UNVERIFIED** |
| `realtime_running_frequency` | `frequencyHz`? | **UNVERIFIED** |
| `output_frequency` | `frequencyHz`? | **UNVERIFIED** |

**Constraint:** No auto-fallback between ambiguous fields. Each mapping must be verified.
**Impact:** `telemetry.ts` parser (Phase 2), all evaluator inputs.
**Implementation:** `telemetry.ts` has explicit mapping with NO fallback; throws if ambiguous

---

## OD-06: `received_at` Timezone Contract
**Question:** What timezone is `received_at` (format: `YYYY-MM-DD HH:mm:ss` no offset)?
**Current:** Parsed as local server time (risky for 120s OFF calculation).
**Required:** Explicit timezone in input contract (UTC? Local? Device timezone?).
**Impact:** OFF 120s duration calculation, event ordering gate.
**Implementation:** `telemetry.ts` → `parseTimestamp()` assumes UTC (offsetMinutes: 0)
**Differential Impact:** 0 cases flagged (frozen cases have timezone offsets in timestamps)

---

## OD-07: 10s Gap Policy for Mathematical Area
**Question:** Does existing `LIVE_GAP_THRESHOLD_MS = 10000` apply to all Mathematical Areas?
**Current:** `evidence.ts` resets history on gap >10s (legacy behavior).
**Spec:** Mathematical Area uses bounded window per `pumpId+parameter`; event-time gate only.
**Conflict:** Gap reset may break 30-sample continuity for MA30.
**Status:** **DECISION_REQUIRED** — Keep as configurable option? Remove? Per-trouble?
**Test Needed:** Characterization test for gap behavior in `computeTA`.
**Implementation:** `state/window.ts` does NOT implement gap reset; `evidence.ts` legacy behavior preserved but not used in new engine
**Differential Impact:** 249 cases flagged with `insufficient_history` / gap handling

---

## OD-08: Mathematical Formula Conflicts (Source of Truth)
**Question:** Which source is authoritative when files disagree?

| Formula | `rules.json` | `pump_profiles.json` | Legacy Code | Spec Target |
|---------|--------------|----------------------|-------------|-------------|
| PTS Frequency | `<= 10` | `< 10` | `<= 10` (evaluator) | **DECISION_REQUIRED** |
| Unbalance Denominator | N/A | N/A | Phase current | **DECISION_REQUIRED** |
| Dry Run DR_C Logic | All 3 AND | All 3 AND | All 3 AND | **VERIFY** |
| Dry Run DR_F Rounding | 2dp HALF_UP | N/A | 2dp HALF_UP | **VERIFY** |
| Turbulensi T_A Ref | Historical only | Historical only | Historical only | **VERIFY** |

**Constraint:** Do NOT change formulas until spec confirmed. Document legacy behavior exactly.
**Test Needed:** Oracle tests for each boundary case.
**Implementation:** 
- PTS: Uses `<= 10` from rules.json (via configuration-resolver)
- Unbalance: Uses phase current denominator (legacy formula)
- Dry Run: All 3 AND, 2dp ROUND_HALF_UP
**Differential Impact:** 153 cases flagged (50 PTS 10Hz boundary, 103 Unbalance formula)

---

## Decision Tracking

| ID | Status | Owner | Target Phase | Blocking | Differential Cases |
|----|--------|-------|--------------|----------|-------------------|
| OD-01 | OPEN | Domain/Middleware | Phase 4/5 | OFF detection, 120s reset | 34 |
| OD-02 | OPEN | Domain | Phase 5 | Lifecycle on OFF reset | 34 |
| OD-03 | OPEN | Domain/Architecture | Phase 6 | Config hot-reload | 0 |
| OD-04 | OPEN | Domain/Math | Phase 3 | Evaluator readiness | 0 |
| OD-05 | OPEN | Middleware/Device | Phase 2 | Telemetry parser | 0 |
| OD-06 | OPEN | Middleware/Device | Phase 2 | Timestamp parsing | 0 |
| OD-07 | OPEN | Domain/Math | Phase 4 | Window behavior | 249 |
| OD-08 | OPEN | Domain/Math | Phase 3 | Formula authority | 153 |

---

## Characterization Test Tags for Open Decisions

Tests in `engine/__tests__/` are tagged with relevant OD:
- `OD-01`: None (OFF detection not implemented — requires injection)
- `OD-02`: None (lifecycle on OFF reset not implemented — requires decision)
- `OD-04`: `normalization.test.ts` — NULL handling tests
- `OD-07`: `mathematics.test.ts` — `computeTA` gap behavior not tested (legacy gap in `evidence.ts`)
- `OD-08`: `mathematics.test.ts` — PTS boundary, unbalance formula documented

---

## Differential Regression Summary (400 cases)

| Category | Count | Primary ODs |
|----------|-------|-------------|
| EXPECTED_SPEC_CHANGE | 87 | Multi-label, readiness, lifecycle, naming |
| UNRESOLVED | 313 | OD-07 (249), OD-08 (153), OD-01/02 (34) |
| BUG_FIXED_BY_SPEC | 0 | — |
| MATCH | 0 | — |

---

## Next Steps

1. **Domain Review:** Present OD-01 through OD-08 to domain owners with differential regression evidence
2. **Decision Priority:** OD-01/02 (OFF detection) and OD-08 (formula conflicts) affect most cases
3. **Guard Implementation:** Add explicit `DECISION_REQUIRED` guards in evaluators for OD-04, OD-08
4. **Test Oracle:** Create mathematical oracle tests once formulas confirmed
5. **Production Gate:** Do NOT deploy to production until all 8 ODs resolved (per Plan Section K.6)