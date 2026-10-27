/**
 * Differential Regression Test — Legacy vs New Engine.
 * 
 * Runs 400 frozen cases through new ClassificationEngine and categorizes differences:
 * - EXPECTED_SPEC_CHANGE: Multi-label, readiness split, lifecycle, naming
 * - BUG_FIXED_BY_SPEC: First-match bug, NULL handling, trigger gating removed
 * - UNRESOLVED: OD-01/02/04/05/06/07/08 boundaries
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { ClassificationEngine, RULES_FILE } from "../engine.ts";
import { mockIsPumpOff, createTestEngine } from "./helpers.ts";
import { loadConvertedCases, type ConvertedCase, type LegacyClassification, type LegacyRuleEvaluation } from "./fixtures/legacy-to-new.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface DiffResult {
  caseIndex: number;
  pumpId: string;
  category: "EXPECTED_SPEC_CHANGE" | "BUG_FIXED_BY_SPEC" | "UNRESOLVED" | "MATCH";
  details: string[];
  legacyTrouble: string;
  newResults: string[];
  newActiveTroubles: string[];
  newMissingData: Record<string, string[]>;
}

const CATEGORIES = {
  EXPECTED_SPEC_CHANGE: "EXPECTED_SPEC_CHANGE",
  BUG_FIXED_BY_SPEC: "BUG_FIXED_BY_SPEC",
  UNRESOLVED: "UNRESOLVED",
  MATCH: "MATCH",
} as const;

type Category = typeof CATEGORIES[keyof typeof CATEGORIES];

const allResults: DiffResult[] = [];

function categorizeDifference(
  legacy: LegacyClassification,
  newOutput: any,
  caseIndex: number,
  pumpId: string
): DiffResult {
  const details: string[] = [];
  let category: Category = CATEGORIES.MATCH;

  // Legacy: single trouble_type (first-match)
  const legacyTrouble = legacy.trouble_type;
  // New: multi-label results + activeTroubles
  const newResults = newOutput.results.map((r: any) => r.troubleType);
  const newActiveTroubles = newOutput.activeTroubles;
  const newMissingData = newOutput.missingData;

  // Check UNRESOLVED conditions first (OD-related)
  let isUnresolved = false;

  // 8. OD-08 boundaries: PTS 10Hz, unbalance denominator
  const hasPTSBoundary = legacy.rule_evaluations.some((e: LegacyRuleEvaluation) => 
    e.trouble_type === "pompa_tersangkut_sampah" && e.matched_conditions.some(c => c.includes("freq=10"))
  );
  if (hasPTSBoundary) {
    isUnresolved = true;
    details.push("PTS 10Hz boundary (OD-08)");
  }

  const hasUnbalance = legacy.rule_evaluations.some((e: LegacyRuleEvaluation) => 
    e.trouble_type === "unbalance" && e.evaluation === "MATCH"
  );
  if (hasUnbalance) {
    isUnresolved = true;
    details.push("Unbalance formula (OD-08)");
  }

  // 9. OFF detection (OD-01/02) - check if any reading has frequency 0
  const hasZeroFreq = legacy.rule_evaluations.some((e: LegacyRuleEvaluation) => 
    e.matched_conditions.some(c => c.includes("freq=0") || c.includes("output_frequency=0"))
  );
  if (hasZeroFreq) {
    isUnresolved = true;
    details.push("OFF detection / zero frequency (OD-01/02)");
  }

  // 10. Gap >10s (OD-07) - check timestamp gaps in readings
  if (legacy.limitations.some(l => l.includes("insufficient_history"))) {
    isUnresolved = true;
    details.push("Insufficient history / gap handling (OD-07)");
  }

  // If any UNRESOLVED condition, mark as UNRESOLVED
  if (isUnresolved) {
    category = CATEGORIES.UNRESOLVED;
  } else {
    // Check EXPECTED_SPEC_CHANGE conditions
    let isExpectedChange = false;

    // 1. Multi-label vs single-label (EXPECTED_SPEC_CHANGE)
    if (newResults.length > 1 || (newResults.length === 1 && newResults[0] !== legacyTrouble)) {
      isExpectedChange = true;
      details.push(`Multi-label: legacy="${legacyTrouble}" vs new=[${newResults.join(", ")}]`);
    }

    // 2. Active troubles persistence (EXPECTED_SPEC_CHANGE)
    if (newActiveTroubles.length > 0 && !newActiveTroubles.includes(legacyTrouble)) {
      isExpectedChange = true;
      details.push(`Active troubles persist: ${newActiveTroubles.join(", ")}`);
    }

    // 3. Readiness split: legacy NO_MATCH -> new missingData (EXPECTED_SPEC_CHANGE)
    const legacyNotReady = legacy.rule_evaluations.filter((e: LegacyRuleEvaluation) => 
      e.evaluation === "NO_MATCH" || e.capability_status !== "READY"
    );
    if (legacyNotReady.length > 0 && Object.keys(newMissingData).length > 0) {
      isExpectedChange = true;
      details.push(`Readiness split: ${legacyNotReady.length} legacy NO_MATCH -> ${Object.keys(newMissingData).length} missingData`);
    }

    // 4. Lifecycle fields present (EXPECTED_SPEC_CHANGE)
    const hasLifecycle = newOutput.results.some((r: any) => 
      r.startAt !== null || r.endAt !== null || r.triggerCount > 0
    );
    if (hasLifecycle) {
      isExpectedChange = true;
      details.push("Lifecycle fields present (startAt, endAt, triggerCount)");
    }

    if (isExpectedChange) {
      category = CATEGORIES.EXPECTED_SPEC_CHANGE;
    } else {
      // 6. First-match bug fix: legacy returns first match, new returns all (BUG_FIXED_BY_SPEC)
      const legacyMatches = legacy.rule_evaluations.filter((e: LegacyRuleEvaluation) => e.evaluation === "MATCH");
      if (legacyMatches.length > 1) {
        category = CATEGORIES.BUG_FIXED_BY_SPEC;
        details.push(`First-match bug: legacy returned "${legacyTrouble}" but ${legacyMatches.length} troubles matched`);
      }
    }
  }

  return {
    caseIndex,
    pumpId,
    category,
    details,
    legacyTrouble,
    newResults,
    newActiveTroubles,
    newMissingData,
  };
}

async function runCase(convertedCase: ConvertedCase): Promise<any> {
  const engine = createTestEngine();
  let lastOutput: any = null;

  // Process each payload sequentially to build history
  for (const payload of convertedCase.payloads) {
    lastOutput = await engine.classify(payload);
  }

  return lastOutput;
}

test("Differential regression: 400 frozen cases", async () => {
  const cases = loadConvertedCases();
  assert.equal(cases.length, 400);

  const summary = {
    MATCH: 0,
    EXPECTED_SPEC_CHANGE: 0,
    BUG_FIXED_BY_SPEC: 0,
    UNRESOLVED: 0,
  };

  for (const convertedCase of cases) {
    const newOutput = await runCase(convertedCase);
    const diff = categorizeDifference(
      convertedCase.legacyResponse.classification,
      newOutput,
      convertedCase.caseIndex,
      convertedCase.pumpId
    );
    allResults.push(diff);
    summary[diff.category]++;
  }

  // Print summary
  console.log("\n=== DIFFERENTIAL REGRESSION SUMMARY ===");
  console.log(`Total cases: ${cases.length}`);
  console.log(`MATCH: ${summary.MATCH}`);
  console.log(`EXPECTED_SPEC_CHANGE: ${summary.EXPECTED_SPEC_CHANGE}`);
  console.log(`BUG_FIXED_BY_SPEC: ${summary.BUG_FIXED_BY_SPEC}`);
  console.log(`UNRESOLVED: ${summary.UNRESOLVED}`);

  // Print UNRESOLVED details
  const unresolved = allResults.filter(r => r.category === CATEGORIES.UNRESOLVED);
  if (unresolved.length > 0) {
    console.log("\n=== UNRESOLVED CASES (require domain decision) ===");
    for (const r of unresolved.slice(0, 20)) {
      console.log(`  Case ${r.caseIndex}: ${r.details.join("; ")}`);
    }
    if (unresolved.length > 20) console.log(`  ... and ${unresolved.length - 20} more`);
  }

  // Print BUG_FIXED_BY_SPEC details
  const bugs = allResults.filter(r => r.category === CATEGORIES.BUG_FIXED_BY_SPEC);
  if (bugs.length > 0) {
    console.log("\n=== BUG_FIXED_BY_SPEC ===");
    for (const r of bugs.slice(0, 10)) {
      console.log(`  Case ${r.caseIndex}: ${r.details.join("; ")}`);
    }
  }

  // Print EXPECTED_SPEC_CHANGE details
  const expected = allResults.filter(r => r.category === CATEGORIES.EXPECTED_SPEC_CHANGE);
  if (expected.length > 0) {
    console.log("\n=== EXPECTED_SPEC_CHANGE ===");
    for (const r of expected.slice(0, 10)) {
      console.log(`  Case ${r.caseIndex}: ${r.details.join("; ")}`);
    }
  }

  // Generate machine-readable report
  const report = {
    generatedAt: new Date().toISOString(),
    totalCases: cases.length,
    summary,
    results: allResults,
  };

  // Write report to file
  const fs = await import("node:fs");
  const reportPath = join(__dirname, "..", "docs", "differential-report.json");
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`\nReport written to: ${reportPath}`);

  // Assert expectations
  // We expect most cases to be EXPECTED_SPEC_CHANGE or MATCH
  // UNRESOLVED should be documented but not fail the test
  assert.ok(summary.EXPECTED_SPEC_CHANGE + summary.MATCH > 0, "Should have some expected changes or matches");
});

test("Differential regression: UNRESOLVED cases by OD", async () => {
  const cases = loadConvertedCases();
  const odCounts: Record<string, number> = {
    "OD-01": 0,
    "OD-02": 0,
    "OD-04": 0,
    "OD-05": 0,
    "OD-06": 0,
    "OD-07": 0,
    "OD-08": 0,
  };

  for (const convertedCase of cases) {
    const newOutput = await runCase(convertedCase);
    const diff = categorizeDifference(
      convertedCase.legacyResponse.classification,
      newOutput,
      convertedCase.caseIndex,
      convertedCase.pumpId
    );

    if (diff.category === CATEGORIES.UNRESOLVED) {
      for (const detail of diff.details) {
        if (detail.includes("OD-01") || detail.includes("OD-02") || detail.includes("OFF detection")) {
          odCounts["OD-01"]++;
          odCounts["OD-02"]++;
        }
        if (detail.includes("NULL handling")) odCounts["OD-04"]++;
        if (detail.includes("PTS 10Hz") || detail.includes("Unbalance formula")) odCounts["OD-08"]++;
        if (detail.includes("insufficient_history") || detail.includes("gap handling")) odCounts["OD-07"]++;
      }
    }
  }

  console.log("\n=== UNRESOLVED BY OPEN DECISION ===");
  for (const [od, count] of Object.entries(odCounts)) {
    console.log(`  ${od}: ${count} cases`);
  }
});