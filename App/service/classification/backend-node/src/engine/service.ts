/**
 * Factory/facade for the classification engine.
 * Provides DI for configuration resolver, clock, and output mode.
 */

import { RULES_FILE } from "./engine.ts";
import { ClassificationEngine } from "./engine.ts";
import type { ClassificationEngine as ClassificationEngineType } from "./engine.ts";

let _engine: ClassificationEngineType | null = null;

export function getEngine(options?: { outputMode?: "poc" | "production" }): ClassificationEngineType {
  if (_engine === null) {
    _engine = new ClassificationEngine(RULES_FILE, options);
  }
  return _engine;
}

export function resetEngine(): void {
  _engine = null;
}