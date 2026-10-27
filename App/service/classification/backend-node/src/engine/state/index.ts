/**
 * State module exports
 */

export { StateManager, createStateManager } from "./manager.ts";
export { applyTransition, createInitialState, isActive, getActiveTroubles, STAGNATION_LIMIT, type TransitionInput } from "./transition.ts";
export { BoundedWindow, WindowManager, type WindowEntry } from "./window.ts";