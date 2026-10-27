/**
 * In-memory State Manager per pumpId + troubleType.
 * Separates state from evaluation logic.
 */

import type { 
  OffDetectionState,
  TroubleType
} from "../models.ts";
import { applyTransition, STAGNATION_LIMIT, type TransitionInput } from "./transition.ts";
import { WindowManager } from "./window.ts";

/** Key for state map: pumpId:troubleType */
function stateKey(pumpId: string, trouble: string): string {
  return `${pumpId}:${trouble}`;
}

/** Pump state snapshot for rollback (atomic commit) */
interface PumpStateSnapshot {
  pumpId: string;
  troubles: Map<string, any>;
  offDetection: { offSince: number | null; lastRunAt: number | null };
  lastAcceptedAt: number | null;
  configSnapshot: any;
  windows: Map<string, any>;
}

/** State Manager - single instance per engine */
export class StateManager {
  private states: Map<string, any> = new Map();
  private windows: WindowManager;
  private pumpStates: Map<string, { 
    offDetection: { offSince: number | null; lastRunAt: number | null }; 
    lastAcceptedAt: number | null; 
    configSnapshot: any;
    troubles: Map<string, any>;
  }> = new Map();

  constructor(windowMaxSize: number = 31, gapThresholdMs: number = 10000) {
    this.windows = new WindowManager(windowMaxSize, gapThresholdMs);
  }

  /** Get or create pump-level state (for OFF tracking, config snapshot) */
  getOrCreatePumpState(pumpId: string): { 
    offDetection: { offSince: number | null; lastRunAt: number | null }; 
    lastAcceptedAt: number | null; 
    configSnapshot: any;
    troubles: Map<string, any>;
  } {
    let pumpState = this.pumpStates.get(pumpId);
    if (!pumpState) {
      pumpState = {
        offDetection: { offSince: null, lastRunAt: null },
        lastAcceptedAt: null,
        configSnapshot: null,
        troubles: new Map(),
      };
      this.pumpStates.set(pumpId, pumpState);
    }
    return pumpState;
  }

  getPumpState(pumpId: string): { 
    offDetection: { offSince: number | null; lastRunAt: number | null }; 
    lastAcceptedAt: number | null; 
    configSnapshot: any;
  } | null {
    return this.pumpStates.get(pumpId) ?? null;
  }

  /** Get or create state for a pump+trouble */
  getState(pumpId: string, trouble: string): any {
    const key = `${pumpId}:${trouble}`;
    let state = this.states.get(key);
    if (!state) {
      state = { detected: false, triggerCount: 0, stagnationCount: 0, startAt: null, endAt: null };
      this.states.set(key, state);
    }
    return state;
  }

  /** Get all active troubles for a pump */
  getActiveTroubles(pumpId: string): string[] {
    const active: string[] = [];
    for (const [key, state] of this.states) {
      if (key.startsWith(`${pumpId}:`) && state.detected) {
        const trouble = key.slice(pumpId.length + 1);
        active.push(trouble);
      }
    }
    return active;
  }

  /** Apply evaluator result to state (single trouble) */
  applyEvaluation(
    pumpId: string,
    trouble: string,
    evaluation: { ready: true; trigger: 0 | 1 } | { ready: false; missingData: string[] },
    receivedAt: string
  ): any {
    const state = this.getState(pumpId, trouble);
    const newState = applyTransition(state, { trouble: trouble as TroubleType, evaluation, receivedAt });
    this.states.set(`${pumpId}:${trouble}`, newState);
    return newState;
  }

  /** Apply all evaluations for a pump */
  applyAllEvaluations(
    pumpId: string,
    evaluations: Map<string, { ready: true; trigger: 0 | 1 } | { ready: false; missingData: string[] }>,
    receivedAt: string
  ): Map<string, any> {
    const result = new Map();
    for (const [trouble, evalResult] of evaluations) {
      const state = this.applyEvaluation(pumpId, trouble, evalResult, receivedAt);
      result.set(trouble, state);
    }
    return result;
  }

  /** Get window manager for historical data */
  getWindows(): any {
    return this.windows;
  }

  /** Add reading to historical windows */
  addReading(pumpId: string, reading: { [metric: string]: number | null }, epochMs: number): void {
    for (const [metric, value] of Object.entries(reading)) {
      if (value !== null && value !== undefined && Number.isFinite(value)) {
        this.windows.tryAdd(pumpId, metric, value, epochMs);
      }
    }
  }

  /** Get historical values for a metric */
  getHistory(pumpId: string, metric: string): number[] {
    return this.windows.getHistory(pumpId, metric);
  }

  /** Event-time gate: check if new event is strictly after last accepted */
  checkEventTimeGate(pumpId: string, receivedAtMs: number): boolean {
    const lastTs = this.windows.getLastTimestamp(pumpId);
    if (lastTs === null) return true; // First event
    return receivedAtMs > lastTs;
  }

  /** Get pump state snapshot for atomic commit/rollback */
  getPumpStateSnapshot(pumpId: string): { 
    pumpId: string;
    troubles: Map<string, any>; 
    offDetection: { offSince: number | null; lastRunAt: number | null }; 
    lastAcceptedAt: number | null; 
    configSnapshot: any;
    windows: Map<string, any>;
  } | null {
    const pumpState = this.pumpStates.get(pumpId);
    if (!pumpState) return null;

    // Collect troubles for this pump
    const troubles = new Map<string, any>();
    for (const [key, state] of this.states) {
      if (key.startsWith(`${pumpId}:`)) {
        troubles.set(key.slice(pumpId.length + 1), { ...state });
      }
    }

    return {
      pumpId,
      troubles,
      offDetection: { ...pumpState.offDetection },
      lastAcceptedAt: this.windows.getLastTimestamp(pumpId),
      configSnapshot: pumpState.configSnapshot,
      windows: this.windows.toJSON ? new Map(Object.entries(this.windows.toJSON())) : new Map(),
    };
  }

  /** Rollback pump state to snapshot (atomic rollback) */
  rollbackPumpState(snapshot: { 
    pumpId: string;
    troubles: Map<string, any>; 
    offDetection: { offSince: number | null; lastRunAt: number | null }; 
    lastAcceptedAt: number | null; 
    configSnapshot: any;
    windows: Map<string, any>;
  }): void {
    // Restore troubles
    this.states.clear();
    for (const [trouble, state] of snapshot.troubles) {
      this.states.set(`${snapshot.pumpId}:${trouble}`, state);
    }
    // Note: Full window restoration would require deserializing windows
    // For now, we rely on the fact that failed events don't add readings
  }

  /** Reset pump state (e.g., on OFF > 120s) */
  resetPump(pumpId: string): void {
    for (const key of this.states.keys()) {
      if (key.startsWith(`${pumpId}:`)) {
        this.states.delete(key);
      }
    }
    this.windows.clearPump(pumpId);
    this.pumpStates.delete(pumpId);
  }

  /** Get stagnation limit constant */
  static getStagnationLimit(): number {
    return STAGNATION_LIMIT;
  }
}

/** Create empty state manager */
export function createStateManager(windowMaxSize?: number, gapThresholdMs?: number): StateManager {
  return new StateManager(windowMaxSize, gapThresholdMs);
}
