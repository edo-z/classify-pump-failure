/**
 * Normal evaluator - derives NORMAL from active trouble state.
 * Not a sensor evaluator; runs after all trouble evaluations and state updates.
 */

import type { Evaluation, TroubleType } from "../models.ts";

/**
 * Derive NORMAL classification.
 * NORMAL is active when NO other trouble is active.
 * This runs AFTER all trouble states have been updated.
 */
export function evaluateNormal(
  activeTroubles: string[],
  allTroubleTypes: string[]
): Evaluation {
  const otherTroubles = allTroubleTypes.filter(t => t !== "normal");
  const hasActiveTrouble = otherTroubles.some(t => activeTroubles.includes(t));
  const normalActive = !hasActiveTrouble;

  const measurements: Record<string, number | string | null> = {
    activeTroublesCount: activeTroubles.length,
    activeTroubles: activeTroubles.join(","),
    normalActive: normalActive ? 1 : 0,
  };

  return { ready: true, trigger: normalActive ? 1 : 0, measurements };
}