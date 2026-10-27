# DECISION_REGISTER — Binding User Decisions

**Generated:** 2026-10-25
**Authority:** These decisions are FINAL and binding for all implementation phases

---

## Final Decisions (Binding)

| Area | Decision | Rationale |
|------|----------|-----------|
| **Goal** | Behavioral preservation against **verified mathematical specification**, not Python port bugs | Legacy port has bugs; spec is source of truth |
| **Architecture** | **Fully Procedural TypeScript** — no JSON rule interpreter, no Strategy Pattern over-engineering | Equations in code; DB/config supplies numeric values |
| **Compatibility** | Breaking changes allowed | No obligation to preserve snake_case or legacy contracts |
| **Scope** | **Only `engine/` directory** | API, DB, Socket.IO, deployment not modified |
| **Evaluation** | Independent per troubleType; **multi-label**; **immediate activation** on TRUE | No `count_trigger` gating; `triggerCount` for observability only |
| **Groups** | `specificFailureVFD` / `specificFailureFH` = domain categories only | No device whitelist; Universal Classification |
| **Config** | Typed config injected via `ConfigurationProvider` | No DB queries from evaluators |
| **Readiness** | Explicit: `Dapat Di Klasifikasi` / `Belum Dapat Di Klasifikasi` | Separate from detection; `results`=ready, `missingData`=not ready |
| **NULL Handling** | NULL stays NULL; no zero-fill; boolean `"false"` ≠ true | NULL ignored ONLY for NORMAL derivation |
| **Normal** | **Explicit classification** with lifecycle | Active when NO other trouble active; NULL ignored for NORMAL |
| **Terminology** | `Mathematical Trigger`, `Mathematical Area`, `Trigger Count`, `Stagnation Count` | Consistent naming |
| **Trigger Count** | Starts 0; TRUE increments; FALSE resets; NULL holds; no max | Per troubleType per pump |
| **Stagnation** | Increments on not-ready; resets on ready; ≥5 resets both counters (not detected) | `limitStagnan=5` |
| **Lifecycle** | `startAt`/`endAt` per trouble (incl. NORMAL); `received_at` event-time | NULL doesn't open/close episodes |
| **Temporal** | Bounded window per `pumpId`+parameter; strict `receivedAt` ordering | MA/CMA for turbulensi <30/≥30 hist samples |
| **State** | In-memory, State Manager separate, atomic per event | Long-term history = DB/middleware |
| **Results** | `results`=ready, `missingData`=not ready, `activeTroubles`=last-known state | Multi-label |
| **OFF >120s** | **Verified OFF continuous >120s by `received_at` diff** → reset `activeTroubles` | **Do NOT assume `status:"0"` = OFF** |
| **Config Changes** | Snapshot applies from next event; history not re-evaluated | State reset policy = OD-03 |
| **Output** | **PoC**: `measurements` included; **Production**: `measurements` absent | Not `null`/`{}`/`evidence` |
| **Versioning** | **No separate math version tracking** | Reject Q68 recommendation |

---

## Open Decisions (Require Domain Resolution)

| ID | Decision Needed | Blocking Phase | Status | Differential Cases |
|----|-----------------|----------------|--------|-------------------|
| **OD-01** | Which field = pump OFF? (`status`? `vsd_standby`? `pump_fault`?) | Phase 4/5 | **OPEN** | 34 |
| **OD-02** | OFF >120s: close episodes (`endAt=now`) + clear counters/windows? | Phase 5 | **OPEN** | 34 |
| **OD-03** | Config hot-reload: preserve state / re-evaluate / reset affected? | Phase 6 | **OPEN** | 0 |
| **OD-04** | NULL truth tables: `TRUE OR NULL=TRUE`? `FALSE AND NULL=FALSE`? | Phase 3 | **OPEN** | 0 |
| **OD-05** | `output_current` vs `motor_current` → `currentA`? (etc.) | Phase 2 | **OPEN** | 0 |
| **OD-06** | `received_at` timezone (UTC? Local? Device?) | Phase 2 | **OPEN** | 0 |
| **OD-07** | 10s gap policy: keep/remove/configure per trouble? | Phase 4 | **OPEN** | 249 |
| **OD-08** | PTS freq: `rules.json` `<=10` vs `profiles` `<10`; unbalance denominator | Phase 3 | **OPEN** | 153 |

---

## Confirmed Mathematical Specifications (Verified)

| Formula | Spec Status | Implementation |
|---------|-------------|----------------|
| PTS: `freq <= 10` AND (≥3 of 4: kW/A/T/RPM) | **VERIFIED** | `evaluatePTS` |
| Turbulensi: `freq<sp` AND `kW>=ref` AND `\|A-MA\|>=10` AND `T>=90` | **VERIFIED** | `evaluateTurbulensi` |
| Banyak Sampah: `freq<=sp` AND `kW>=ref` AND `A>=ref` AND `T>=90` | **VERIFIED** | `evaluateBanyakSampah` |
| Dry Run: `freqEq2dp` AND `kW<=0.667*ref` AND `A<=0.64*ref` AND `T<70` | **VERIFIED** | `evaluateDryRun` |
| Unbalance: `(avg-phase)/phase*100` OR ≥10% | **VERIFY** (denominator=phase current) | `evaluateUnbalance` |
| Undervoltage: `voltage < 360` (exclusive) | **VERIFIED** | `evaluateUndervoltage` |
| Overvoltage: `voltage > 410` (exclusive) | **VERIFIED** | `evaluateOvervoltage` |
| Panel: `ambient>=60` OR `ctrl>=60` OR `inv>=60` | **VERIFIED** | `evaluatePanelOverheat` |
| Normal: active when NO other trouble active | **VERIFIED** | `evaluateNormal` |

---

## Implementation Decisions (Code Structure)

| Decision | Implementation |
|----------|----------------|
| **Pure evaluators** | No state mutation, no I/O, no DB access |
| **Discriminated unions** | `Evaluation` = `ready=true/false` with `trigger`/`missingData` |
| **State Manager** | Separate class, Map<pumpId:troubleType, TroubleState> |
| **Bounded windows** | Per `pumpId:metric`, max 31, event-time gate |
| **Event-time gate** | `receivedAt > lastAccepted` per pumpId |
| **Atomic commit** | Draft state → apply all → commit or full rollback |
| **Per-pump serialization** | Promise queue per pumpId (no global lock) |
| **Serialization** | PoC: `measurements` present; Production: `measurements` absent |
| **Naming** | camelCase internal; snake_case only in raw payload |

---

## Non-Goals (Explicitly Excluded)

- ❌ Database/schema changes
- ❌ Socket.IO handlers
- ❌ Message broker changes
- ❌ Full repository refactor
- ❌ Primary trouble selection
- ❌ Second engine
- ❌ LLM-based classification
- ❌ Formula changes without approval
- ❌ Deployment

---

## Audit Trail

| Date | Phase | Decision | Author |
|------|-------|----------|--------|
| 2026-10-24 | Phase 0 | Scope locked to `engine/` | Agent |
| 2026-10-24 | Phase 1 | Characterization tests created | Agent |
| 2026-10-24 | Phase 2 | `telemetry.ts`, `configuration.ts`, `models.ts` extended | Agent |
| 2026-10-24 | Phase 3 | `mathematics/*`, `evaluators/*` created | Agent |
| 2026-10-24 | Phase 4-7 | `state/*`, `output/*`, `engine.ts`, `service.ts` created | Agent |
| 2026-10-25 | Phase 8 | Differential regression: 400 cases (87 EXPECTED_SPEC_CHANGE, 313 UNRESOLVED) | Agent |
| 2026-10-25 | Phase 8 | Documentation finalized: 6 files in `engine/docs/` | Agent |
| 2026-10-25 | Phase 8 | Differential test harness: `engine/__tests__/differential.test.ts` | Agent |
| 2026-10-25 | Phase 8 | Fixture converter: `engine/__tests__/fixtures/legacy-to-new.ts` | Agent |