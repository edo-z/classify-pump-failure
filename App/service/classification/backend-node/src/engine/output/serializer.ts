/**
 * Output serializer - PoC and Production modes.
 * Single algorithm, two serializations.
 */

import type { ClassificationOutput, TroubleResult, Evaluation, TroubleType, OutputMode } from "../models.ts";

/** Internal result before serialization */
export interface InternalResult {
  pumpId: string;
  receivedAt: string;
  evaluations: Map<string, Evaluation>;
  activeTroubles: string[];
  missingData: Record<string, string[]>;
}

/** Serialize internal result to ClassificationOutput */
export function serialize(
  internal: InternalResult,
  outputMode: OutputMode
): ClassificationOutput {
  const { pumpId, receivedAt, evaluations, activeTroubles, missingData } = internal;

  const results: TroubleResult[] = [];

  for (const [trouble, evalResult] of evaluations) {
    if (evalResult.ready) {
      const trigger = evalResult.trigger;
      const detected = trigger === 1;
      
      const result: TroubleResult = {
        troubleType: trouble as any,
        status: "Dapat Di Klasifikasi",
        detected,
        triggerCount: 0,
        startAt: null,
        endAt: null,
      };

      if (outputMode === "poc" && evalResult.measurements) {
        result.measurements = evalResult.measurements;
      }

      results.push(result);
    }
  }

  const missingDataOut: Record<string, string[]> = {};
  for (const [trouble, evalResult] of evaluations) {
    if (!evalResult.ready) {
      missingDataOut[trouble] = evalResult.missingData;
    }
  }

  return {
    pumpId,
    receivedAt,
    results,
    missingData: missingDataOut,
    activeTroubles,
  };
}

/** Serialize with state enrichment (triggerCount, startAt, endAt) */
export function serializeWithState(
  internal: InternalResult,
  outputMode: OutputMode,
  getState: (trouble: string) => { triggerCount: number; startAt: string | null; endAt: string | null; detected: boolean }
): ClassificationOutput {
  const { pumpId, receivedAt, evaluations, activeTroubles, missingData } = internal;

  const results: TroubleResult[] = [];

  for (const [trouble, evalResult] of evaluations) {
    if (evalResult.ready) {
      const state = getState(trouble);
      const trigger = evalResult.trigger;
      const detected = trigger === 1;
      
      const result: TroubleResult = {
        troubleType: trouble as any,
        status: "Dapat Di Klasifikasi",
        detected,
        triggerCount: state.triggerCount,
        startAt: state.startAt,
        endAt: state.endAt,
      };

      if (outputMode === "poc" && evalResult.measurements) {
        result.measurements = evalResult.measurements;
      }

      results.push(result);
    }
  }

  const missingDataOut: Record<string, string[]> = {};
  for (const [trouble, evalResult] of evaluations) {
    if (!evalResult.ready) {
      missingDataOut[trouble] = evalResult.missingData;
    }
  }

  return {
    pumpId,
    receivedAt,
    results,
    missingData: missingDataOut,
    activeTroubles,
  };
}