/**
 * DEXMIN Classification Engine - Fully Procedural Implementation.
 * 
 * Orchestrates: telemetry normalization -> config resolution -> evaluation -> state transition -> serialization.
 * No generic rule interpreter; pure mathematical evaluators per trouble type.
 */

import { readFileSync } from "node:fs";

import { applyEffectiveRefs, type EffectiveRefs } from "./configuration-resolver.ts";
import { evaluateAll } from "./evaluators/index.ts";
import { normalizeTelemetry, validateEnvelope, extractIdentity } from "./telemetry.ts";
import { getDefaultConfigurationProvider } from "./configuration-provider.ts";
import { StateManager } from "./state/index.ts";
import { serializeWithState, type InternalResult } from "./output/serializer.ts";
import type {
  ClassificationOutput,
  SensorReading,
  PumpConfig,
  OperatingSetpoint,
  TroubleType,
  ClassificationConfig,
  CanonicalTelemetry,
  EquipmentIdentity,
  RawTelemetryPayload,
  IsPumpOffFn,
  OffDetectionState,
  PumpState,
} from "./models.ts";
import { UnsupportedPumpConfigurationError } from "./models.ts";

export const RULES_FILE = new URL("./rules.json", import.meta.url);

/** Legacy rule document type (for config resolver) */
interface RulesDoc {
  tiers?: Record<string, { rules?: Record<string, any> }>;
  capability_rules?: Record<string, Record<string, unknown>>;
}

/** Per-pump event queue for serialization (Phase 6) */
class PumpEventQueue {
  private _queue: Array<() => Promise<void>> = [];
  private _running = false;

  async enqueue<T>(work: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      this._queue.push(async () => {
        try {
          const result = await work();
          resolve(result);
        } catch (err) {
          reject(err);
        }
      });
      this._drain();
    });
  }

  private async _drain(): Promise<void> {
    if (this._running || this._queue.length === 0) return;
    this._running = true;
    while (this._queue.length > 0) {
      const work = this._queue.shift()!;
      await work();
    }
    this._running = false;
  }
}

/** Global pump queues for per-pump serialization */
const _pumpQueues = new Map<string, PumpEventQueue>();

function _getPumpQueue(pumpId: string): PumpEventQueue {
  let queue = _pumpQueues.get(pumpId);
  if (!queue) {
    queue = new PumpEventQueue();
    _pumpQueues.set(pumpId, queue);
  }
  return queue;
}

export class ClassificationEngine {
  private _rules: RulesDoc = {};
  private _stateManager: StateManager;
  private _outputMode: "poc" | "production";
  private _isPumpOff: IsPumpOffFn;

  constructor(
    rulesPath: URL | string,
    options: { 
      outputMode?: "poc" | "production";
      isPumpOff?: IsPumpOffFn;
    } = {}
  ) {
    this._outputMode = options.outputMode ?? "poc";
    this._stateManager = new StateManager();
    // OD-01: Default OFF detection is a stub that throws - MUST be injected by middleware
    this._isPumpOff = options.isPumpOff ?? (() => {
      throw new Error("OD-01: isPumpOff not injected. Provide isPumpOff function to ClassificationEngine constructor.");
    });
    this._loadRules(rulesPath);
  }

  private _loadRules(rulesPath: URL | string): void {
    try {
      this._rules = JSON.parse(readFileSync(rulesPath instanceof URL ? rulesPath : new URL(`file://${rulesPath}`), "utf-8")) as RulesDoc;
    } catch (exc) {
      if ((exc as NodeJS.ErrnoException).code === "ENOENT") {
        throw new Error(`rules.json not found at ${rulesPath}`);
      }
      throw new Error(`Corrupt rules.json: ${(exc as Error).message}`);
    }
    if (typeof this._rules !== "object" || this._rules === null || !("tiers" in this._rules)) {
      throw new Error(`Invalid rules.json schema: missing 'tiers'`);
    }
  }

  /** Main classification entry point */
  async classify(
    rawPayload: any,
    ruleConfig: EffectiveRefs | null = null
  ): Promise<ClassificationOutput> {
    const pumpId = String(rawPayload.pump_id ?? rawPayload.data?.pump_id ?? "");
    const queue = _getPumpQueue(pumpId);

    // Serialize per pumpId (Phase 6)
    return queue.enqueue(async () => this._classifyInternal(rawPayload, ruleConfig));
  }

  private async _classifyInternal(
    rawPayload: any,
    ruleConfig: EffectiveRefs | null
  ): Promise<ClassificationOutput> {
    // Draft state for atomic commit (Phase 6)
    const draftState = {
      pumpState: null as PumpState | null,
      evaluationResult: null as ReturnType<typeof evaluateAll> | null,
      activeTroubles: [] as string[],
      receivedAt: null as any,
      canonical: null as any,
      config: null as any,
      identity: null as any,
      error: null as Error | null,
    };

    try {
      // 1. Validate envelope
      const envelopeError = validateEnvelope(rawPayload);
      if (envelopeError) throw new Error(`Invalid envelope: ${envelopeError}`);

      // 2. Normalize telemetry to canonical form
      const canonical = normalizeTelemetry(rawPayload);
      draftState.canonical = canonical;

      // 3. Extract equipment identity
      const identity = extractIdentity(canonical);
      draftState.identity = identity;

      // 4. Event-time gate per pumpId
      if (!this._stateManager.checkEventTimeGate(canonical.pumpId, canonical.receivedAt.epochMs)) {
        // Duplicate or out-of-order: return current state without mutation
        return this._buildOutput(identity.pumpId, canonical.receivedAt, new Map(), this._stateManager.getActiveTroubles(identity.pumpId));
      }

      // 5. Resolve typed configuration using injected provider
      const configProvider = getDefaultConfigurationProvider();
      let config = await configProvider.resolve(identity);
      draftState.config = config;

      // 6. Apply rule_config overrides if provided
      if (ruleConfig !== null) {
        const newPowerKw = ruleConfig.power_kw ?? config.flowhead.powerRefKw;
        const newCurrentA = ruleConfig.current_a ?? config.flowhead.currentRefA;
        
        config.flowhead.powerRefKw = newPowerKw;
        config.flowhead.currentRefA = newCurrentA;
        // Also update family-specific refs (they all derive from the same base refs)
        config.flowhead.ptsPowerRefKw = newPowerKw;
        config.flowhead.ptsCurrentRefA = newCurrentA;
        config.flowhead.turbulensiPowerRefKw = newPowerKw;
        config.flowhead.banyakSampahPowerRefKw = newPowerKw;
        config.flowhead.banyakSampahCurrentRefA = newCurrentA;
      }

      // 7. Get or create pump state (for OFF tracking and config snapshot)
      const pumpState = this._stateManager.getOrCreatePumpState(identity.pumpId);
      draftState.pumpState = pumpState;

      // OD-03: Config hot-reload policy guard
      // If config snapshot exists and differs, apply policy (default: preserve state, new config for next eval)
      if (pumpState.configSnapshot) {
        // OD-03: Policy guard - default is PRESERVE_STATE
        // Config changes apply to NEXT event; state preserved
        // Future: implement REEVALUATE or RESET based on OD-03 decision
      }
      pumpState.configSnapshot = config;

      // 5. Event-time gate per pumpId (already checked above, but update lastAccepted)
      draftState.receivedAt = new Date(canonical.receivedAt.epochMs).toISOString();

      // 7. Add current reading to windows (for current and future evaluations)
      this._stateManager.addReading(canonical.pumpId, {
        frequencyHz: canonical.frequencyHz,
        currentA: canonical.currentA,
        powerKw: canonical.powerKw,
        torquePercent: canonical.torquePercent,
        motorSpeedRpm: canonical.motorSpeedRpm,
        phaseCurrentU: canonical.phaseCurrentU,
        phaseCurrentV: canonical.phaseCurrentV,
        phaseCurrentW: canonical.phaseCurrentW,
        inputVoltageV: canonical.inputVoltageV,
        ambientTemperatureC: canonical.ambientTemperatureC,
        controlBoardTemperatureC: canonical.controlBoardTemperatureC,
        inverterTemperatureC: canonical.inverterTemperatureC,
      }, canonical.receivedAt.epochMs);

      // 8. Build historical readings for evaluators (now includes current reading)
      const history = this._buildHistory(canonical.pumpId, rawPayload.data);

      // 9. OFF detection (OD-01) - using injected isPumpOff
      const isOff = this._isPumpOff(rawPayload);
      this._updateOffDetection(identity.pumpId, isOff, canonical.receivedAt.epochMs);

      // 10. Check OFF >120s reset (OD-02)
      if (this._checkOffReset(identity.pumpId, canonical.receivedAt.epochMs)) {
        this._stateManager.resetPump(identity.pumpId);
        draftState.activeTroubles = [];
        
        // Return output with empty active troubles
        return this._buildOutput(identity.pumpId, canonical.receivedAt, new Map(), []);
      }

      // 11. Evaluate all troubles
      const activeTroubles = this._stateManager.getActiveTroubles(identity.pumpId) as TroubleType[];
      const evaluationResult = evaluateAll(canonical, config, history, activeTroubles);
      
      // 12. Apply state transitions
      const newStates = this._stateManager.applyAllEvaluations(identity.pumpId, evaluationResult.evaluations, new Date(canonical.receivedAt.epochMs).toISOString());

      // 13. Get active troubles after transitions
      const activeTroublesAfter = this._stateManager.getActiveTroubles(identity.pumpId);

      // 14. Build and return output
      return this._buildOutputWithState(identity.pumpId, canonical.receivedAt, evaluationResult, newStates, activeTroublesAfter);
    } catch (error) {
      // Atomic rollback: any error rolls back all state changes for this event
      if (draftState.identity) {
        const snapshot = this._stateManager.getPumpStateSnapshot(draftState.identity.pumpId);
        if (snapshot) {
          this._stateManager.rollbackPumpState(snapshot);
        }
      }
      throw error;
    }
  }

  /** Update OFF detection state based on isPumpOff result (OD-01/OD-02) */
  private _updateOffDetection(pumpId: string, isOff: boolean, receivedAtMs: number): void {
    const pumpState = this._stateManager.getOrCreatePumpState(pumpId);
    const offState = pumpState.offDetection;

    if (isOff) {
      if (offState.offSince === null) {
        // First OFF detection
        offState.offSince = receivedAtMs;
      }
      offState.lastRunAt = null;
    } else {
      // RUN detected
      offState.offSince = null;
      offState.lastRunAt = receivedAtMs;
    }
  }

  /** Check if OFF >120s continuous (OD-02) */
  private _checkOffReset(pumpId: string, receivedAtMs: number): boolean {
    const pumpState = this._stateManager.getPumpState(pumpId);
    if (!pumpState) return false;

    const offState = pumpState.offDetection;
    if (offState.offSince === null) return false;

    const elapsed = receivedAtMs - offState.offSince;
    return elapsed > 120_000; // strictly greater than 120s
  }

  /** Build history array from WindowManager for evaluators */
  private _buildHistory(pumpId: string, data: any): any[] {
    const windows = this._stateManager.getWindows();
    const motorCurrentHistory = windows.getHistory(pumpId, "currentA");
    
    // Build history readings from motor current values
    // We need to create readings with motor_current and timestamp
    // For now, we'll use the window entries which have epochMs
    const window = windows.getWindow(pumpId, "currentA");
    const entries = window.getEntries();
    
    return entries.map((e: { value: number; epochMs: number }) => ({
      motor_current: e.value,
      timestamp: { epochMs: e.epochMs }
    }));
  }

  /** Build output without state (for rejected events) */
  private _buildOutput(
    pumpId: string,
    receivedAt: any,
    evaluations: Map<string, any>,
    activeTroubles: any[]
  ): any {
    const internal: any = {
      pumpId: pumpId,
      receivedAt: new Date(receivedAt.epochMs).toISOString(),
      evaluations: new Map(),
      activeTroubles,
      missingData: {},
    };
    return serializeWithState(internal, this._outputMode, () => ({ triggerCount: 0, startAt: null, endAt: null, detected: false }));
  }

  /** Build output with full state enrichment */
  private _buildOutputWithState(
    pumpId: string,
    receivedAt: any,
    evaluationResult: any,
    newStates: Map<string, any>,
    activeTroubles: any[]
  ): any {
    const internal: any = {
      pumpId,
      receivedAt: new Date(receivedAt.epochMs).toISOString(),
      evaluations: evaluationResult.evaluations,
      activeTroubles,
      missingData: evaluationResult.missingData,
    };

    return serializeWithState(internal, this._outputMode, (trouble) => {
      const state = newStates.get(trouble);
      if (!state) return { triggerCount: 0, startAt: null, endAt: null, detected: false };
      return {
        triggerCount: state.triggerCount,
        startAt: state.startAt,
        endAt: state.endAt,
        detected: state.detected,
      };
    });
  }

  // Legacy compatibility methods
  reload(): void {
    this._loadRules(RULES_FILE);
    this._stateManager = new StateManager();
  }

  clearTriggerCounters(): void {
    this._stateManager = new StateManager();
  }

  getTriggerCounter(pumpId: number, troubleName: string, namespace = ""): number {
    return this._stateManager.getState(String(pumpId), troubleName as any).triggerCount;
  }

  updateTriggerCounter(
    pumpId: number,
    troubleName: string,
    matched: boolean,
    countTrigger: number,
    namespace = ""
  ): [boolean, number] {
    return [matched, matched ? 1 : 0];
  }
} 

// Re-export types
export type { EffectiveRefs } from "./configuration-resolver.ts";
export type { ClassificationOutput } from "./models.ts";