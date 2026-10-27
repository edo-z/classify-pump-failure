/**
 * VFD group evaluators: Unbalance, Undervoltage, Overvoltage, Panel Overheat.
 * Pure functions: no state mutation, return Evaluation discriminated union.
 */

import type { CanonicalTelemetry, ClassificationConfig, Evaluation } from "../models.ts";
import { calculateUnbalance, formatUnbalanceCondition } from "../mathematics/three-phase.ts";

/** Unbalance */
export function evaluateUnbalance(
  telemetry: CanonicalTelemetry,
  config: ClassificationConfig,
  history: any[]
): Evaluation {
  if (config.vfd.unbalanceThresholdPct === null) {
    return { ready: false, missingData: ["config.vfd.unbalanceThresholdPct"] };
  }

  const u = telemetry.phaseCurrentU;
  const v = telemetry.phaseCurrentV;
  const w = telemetry.phaseCurrentW;

  if (u === null || v === null || w === null) {
    return { ready: false, missingData: ["phaseCurrentU", "phaseCurrentV", "phaseCurrentW"].filter(k => (telemetry as any)[k] === null) };
  }

  const result = calculateUnbalance(u, v, w, config.vfd.unbalanceThresholdPct);
  const matched = result.matched;

  const measurements: Record<string, number | string | null> = {
    phaseCurrentU: u,
    phaseCurrentV: v,
    phaseCurrentW: w,
    ri: result.ri,
    eu: result.eu,
    ev: result.ev,
    ew: result.ew,
    thresholdPct: config.vfd.unbalanceThresholdPct,
    condition: formatUnbalanceCondition(result),
    matched: matched ? 1 : 0,
  };

  return { ready: true, trigger: matched ? 1 : 0, measurements };
}

/** Undervoltage */
export function evaluateUndervoltage(
  telemetry: CanonicalTelemetry,
  config: ClassificationConfig,
  history: any[]
): Evaluation {
  if (config.vfd.undervoltageThresholdV === null) {
    return { ready: false, missingData: ["config.vfd.undervoltageThresholdV"] };
  }

  const voltage = telemetry.inputVoltageV;
  if (voltage === null) {
    return { ready: false, missingData: ["inputVoltageV"] };
  }

  const matched = voltage < config.vfd.undervoltageThresholdV!;

  const measurements: Record<string, number | string | null> = {
    inputVoltageV: voltage,
    thresholdV: config.vfd.undervoltageThresholdV,
    matched: matched ? 1 : 0,
  };

  return { ready: true, trigger: matched ? 1 : 0, measurements };
}

/** Overvoltage */
export function evaluateOvervoltage(
  telemetry: CanonicalTelemetry,
  config: ClassificationConfig,
  history: any[]
): Evaluation {
  if (config.vfd.overvoltageThresholdV === null) {
    return { ready: false, missingData: ["config.vfd.overvoltageThresholdV"] };
  }

  const voltage = telemetry.inputVoltageV;
  if (voltage === null) {
    return { ready: false, missingData: ["inputVoltageV"] };
  }

  const matched = voltage > config.vfd.overvoltageThresholdV!;

  const measurements: Record<string, number | string | null> = {
    inputVoltageV: voltage,
    thresholdV: config.vfd.overvoltageThresholdV,
    matched: matched ? 1 : 0,
  };

  return { ready: true, trigger: matched ? 1 : 0, measurements };
}

/** Panel Overheat */
export function evaluatePanelOverheat(
  telemetry: CanonicalTelemetry,
  config: ClassificationConfig,
  history: any[]
): Evaluation {
  if (config.vfd.panelOverheatThresholdC === null) {
    return { ready: false, missingData: ["config.vfd.panelOverheatThresholdC"] };
  }

  const ambient = telemetry.ambientTemperatureC;
  const controlBoard = telemetry.controlBoardTemperatureC;
  const inverter = telemetry.inverterTemperatureC;

  const available = [ambient, controlBoard, inverter].filter(t => t !== null).length;
  if (available === 0) {
    return { ready: false, missingData: ["ambientTemperatureC", "controlBoardTemperatureC", "inverterTemperatureC"] };
  }

  const threshold = config.vfd.panelOverheatThresholdC!;
  const ambientOk = ambient !== null && ambient >= threshold;
  const controlBoardOk = controlBoard !== null && controlBoard >= threshold;
  const inverterOk = inverter !== null && inverter >= threshold;
  const matched = ambientOk || controlBoardOk || inverterOk;

  const measurements: Record<string, number | string | null> = {
    ambientTemperatureC: ambient,
    controlBoardTemperatureC: controlBoard,
    inverterTemperatureC: inverter,
    thresholdC: threshold,
    ambientOk: ambientOk ? 1 : 0,
    controlBoardOk: controlBoardOk ? 1 : 0,
    inverterOk: inverterOk ? 1 : 0,
    matched: matched ? 1 : 0,
  };

  return { ready: true, trigger: matched ? 1 : 0, measurements };
}