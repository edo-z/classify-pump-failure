/**
 * Evaluator orchestrator - coordinates all modular evaluators.
 * Pure orchestration: no state mutation, no I/O.
 */

import type { CanonicalTelemetry, ClassificationConfig, Evaluation, TroubleType, SensorReading } from "../models.ts";
import { evaluatePTS, evaluateTurbulensi, evaluateBanyakSampah, evaluateDryRun } from "./flowhead.ts";
import { evaluateUnbalance, evaluateUndervoltage, evaluateOvervoltage, evaluatePanelOverheat } from "./vfd.ts";
import { evaluateNormal } from "./normal.ts";

export const TROUBLE_TYPES: TroubleType[] = [
  "pompa_tersangkut_sampah",
  "turbulensi", 
  "banyak_sampah",
  "dry_run",
  "unbalance",
  "undervoltage",
  "overvoltage",
  "panel_overheat",
  "normal",
];

export const FH_TROUBLES: TroubleType[] = [
  "pompa_tersangkut_sampah",
  "turbulensi",
  "banyak_sampah",
  "dry_run",
];

export const VFD_TROUBLES: TroubleType[] = [
  "unbalance",
  "undervoltage",
  "overvoltage",
  "panel_overheat",
];

/** Result of evaluating all troubles */
export interface EvaluationResult {
  evaluations: Map<TroubleType, Evaluation>;
  readyTroubles: TroubleType[];
  notReadyTroubles: TroubleType[];
  missingData: Record<TroubleType, string[]>;
}

/**
 * Evaluate all troubles for a single telemetry event.
 * Returns Evaluation for each trouble type.
 */
export function evaluateAll(
  telemetry: CanonicalTelemetry,
  config: ClassificationConfig,
  history: SensorReading[],
  activeTroubles: TroubleType[]
): EvaluationResult {
  const evaluations = new Map<TroubleType, Evaluation>();
  const readyTroubles: TroubleType[] = [];
  const notReadyTroubles: TroubleType[] = [];
  const missingData: Record<TroubleType, string[]> = {} as any;

  // Evaluate FH group
  const ptsEval = evaluatePTS(telemetry, config, history);
  evaluations.set("pompa_tersangkut_sampah", ptsEval);
  if (ptsEval.ready) readyTroubles.push("pompa_tersangkut_sampah");
  else { notReadyTroubles.push("pompa_tersangkut_sampah"); missingData["pompa_tersangkut_sampah"] = ptsEval.missingData; }

  const turbEval = evaluateTurbulensi(telemetry, config, history);
  evaluations.set("turbulensi", turbEval);
  if (turbEval.ready) readyTroubles.push("turbulensi");
  else { notReadyTroubles.push("turbulensi"); missingData["turbulensi"] = turbEval.missingData; }

  const bsEval = evaluateBanyakSampah(telemetry, config, history);
  evaluations.set("banyak_sampah", bsEval);
  if (bsEval.ready) readyTroubles.push("banyak_sampah");
  else { notReadyTroubles.push("banyak_sampah"); missingData["banyak_sampah"] = bsEval.missingData; }

  const drEval = evaluateDryRun(telemetry, config, history);
  evaluations.set("dry_run", drEval);
  if (drEval.ready) readyTroubles.push("dry_run");
  else { notReadyTroubles.push("dry_run"); missingData["dry_run"] = drEval.missingData; }

  // Evaluate VFD group
  const ubEval = evaluateUnbalance(telemetry, config, history);
  evaluations.set("unbalance", ubEval);
  if (ubEval.ready) readyTroubles.push("unbalance");
  else { notReadyTroubles.push("unbalance"); missingData["unbalance"] = ubEval.missingData; }

  const uvEval = evaluateUndervoltage(telemetry, config, history);
  evaluations.set("undervoltage", uvEval);
  if (uvEval.ready) readyTroubles.push("undervoltage");
  else { notReadyTroubles.push("undervoltage"); missingData["undervoltage"] = uvEval.missingData; }

  const ovEval = evaluateOvervoltage(telemetry, config, history);
  evaluations.set("overvoltage", ovEval);
  if (ovEval.ready) readyTroubles.push("overvoltage");
  else { notReadyTroubles.push("overvoltage"); missingData["overvoltage"] = ovEval.missingData; }

  const panelEval = evaluatePanelOverheat(telemetry, config, history);
  evaluations.set("panel_overheat", panelEval);
  if (panelEval.ready) readyTroubles.push("panel_overheat");
  else { notReadyTroubles.push("panel_overheat"); missingData["panel_overheat"] = panelEval.missingData; }

  // Evaluate NORMAL (derived from active troubles)
  const normalEval = evaluateNormal(activeTroubles, ["pompa_tersangkut_sampah", "turbulensi", "banyak_sampah", "dry_run", "unbalance", "undervoltage", "overvoltage", "panel_overheat", "normal"]);
  evaluations.set("normal", normalEval);
  if (normalEval.ready) readyTroubles.push("normal");

  return { evaluations, readyTroubles, notReadyTroubles, missingData };
}

/**
 * Get evaluation for a specific trouble type.
 */
export function getEvaluation(result: EvaluationResult, trouble: TroubleType): Evaluation | undefined {
  return result.evaluations.get(trouble);
}

/**
 * Check if a trouble type is ready (evaluable).
 */
export function isReady(result: EvaluationResult, trouble: TroubleType): boolean {
  return result.readyTroubles.includes(trouble);
}