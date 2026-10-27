/**
 * State transition reducer - pure functions for trouble state lifecycle.
 * No I/O, no side effects.
 */

import type { TroubleState, TroubleType } from "../models.ts";

/** Transition input from evaluator */
export interface TransitionInput {
  trouble: TroubleType;
  evaluation: { ready: true; trigger: 0 | 1 } | { ready: false; missingData: string[] };
  receivedAt: string;
}

/** Stagnation limit constant */
export const STAGNATION_LIMIT = 5;

/**
 * Initial state for a trouble.
 */
export function createInitialState(): TroubleState {
  return {
    detected: false,
    triggerCount: 0,
    stagnationCount: 0,
    startAt: null,
    endAt: null,
  };
}

/**
 * Apply transition for a single trouble based on evaluator output.
 * Implements the state transition matrix from the spec.
 */
export function applyTransition(
  currentState: TroubleState,
  input: TransitionInput
): TroubleState {
  const { evaluation, receivedAt } = input;

  if (evaluation.ready) {
    const trigger = evaluation.trigger;
    
    if (trigger === 1) {
      // TRUE transition
      if (!currentState.detected) {
        // Non-active -> Active
        return {
          detected: true,
          triggerCount: currentState.triggerCount + 1,
          stagnationCount: 0,
          startAt: receivedAt,
          endAt: null,
        };
      } else {
        // Active -> Active (continuing)
        return {
          ...currentState,
          detected: true,
          triggerCount: currentState.triggerCount + 1,
          stagnationCount: 0,
          startAt: currentState.startAt,
          endAt: null,
        };
      }
    } else {
      // FALSE transition
      if (currentState.detected) {
        // Active -> Non-active
        return {
          detected: false,
          triggerCount: 0,
          stagnationCount: 0,
          startAt: currentState.startAt,
          endAt: receivedAt,
        };
      } else {
        // Non-active -> Non-active
        return {
          ...currentState,
          detected: false,
          triggerCount: 0,
          stagnationCount: 0,
        };
      }
    }
  } else {
    // NOT READY (missing data)
    const newStagnation = currentState.stagnationCount + 1;
    
    if (newStagnation >= STAGNATION_LIMIT) {
      // Stagnation limit reached: reset both counters
      // BUT detected/startAt/endAt remain unchanged
      return {
        ...currentState,
        triggerCount: 0,
        stagnationCount: 0,
      };
    } else {
      // Increment stagnation, hold triggerCount and detected
      return {
        ...currentState,
        stagnationCount: newStagnation,
      };
    }
  }
}

/**
 * Check if a trouble is currently active (detected).
 */
export function isActive(state: TroubleState): boolean {
  return state.detected;
}

/**
 * Get active troubles from state map.
 */
export function getActiveTroubles(stateMap: Map<string, TroubleState>): string[] {
  const active: string[] = [];
  for (const [trouble, state] of stateMap) {
    if (state.detected) active.push(trouble);
  }
  return active;
}