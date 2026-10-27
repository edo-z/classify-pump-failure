/**
 * Three-phase unbalance calculation.
 * Formula: (average - phase) / phase * 100 for each phase, then OR of absolute values.
 * Denominator is phase current (legacy formula), not average.
 */

export interface UnbalanceResult {
  eu: number | null;
  ev: number | null;
  ew: number | null;
  ri: number;
  matched: boolean;
  thresholdPct: number;
}

/**
 * Calculate three-phase unbalance using IEC/NEMA formula:
 * deviation% = |avg - phase| / avg * 100
 * Unbalance = max(|Eu|, |Ev|, |Ew|) >= threshold
 * Denominator is average current (IEC standard).
 * 
 * @param u Phase U current (A)
 * @param v Phase V current (A)
 * @param w Phase W current (A)
 * @param thresholdPct Threshold in percentage (default 10%)
 * @returns UnbalanceResult with per-phase deviations and match flag
 */
export function calculateUnbalance(
  u: number | null | undefined,
  v: number | null | undefined,
  w: number | null | undefined,
  thresholdPct: number = 10.0
): UnbalanceResult {
  // Validate all phases present and finite
  if (u === null || u === undefined || !Number.isFinite(u)) {
    return { eu: null, ev: null, ew: null, ri: 0, matched: false, thresholdPct };
  }
  if (v === null || v === undefined || !Number.isFinite(v)) {
    return { eu: null, ev: null, ew: null, ri: 0, matched: false, thresholdPct };
  }
  if (w === null || w === undefined || !Number.isFinite(w)) {
    return { eu: null, ev: null, ew: null, ri: 0, matched: false, thresholdPct };
  }

  const ri = (u + v + w) / 3.0;

  const eu = ri !== 0 ? Math.abs((ri - u) / ri) * 100 : 0;
  const ev = ri !== 0 ? Math.abs((ri - v) / ri) * 100 : 0;
  const ew = ri !== 0 ? Math.abs((ri - w) / ri) * 100 : 0;

  const unbalance = Math.max(eu, ev, ew);
  const matched = unbalance >= thresholdPct;

  return { eu, ev, ew, ri, matched, thresholdPct };
}

/**
 * Check if any phase deviation exceeds threshold (legacy OR logic).
 */
export function checkUnbalance(
  u: number | null | undefined,
  v: number | null | undefined,
  w: number | null | undefined,
  thresholdPct: number = 10.0
): boolean {
  return calculateUnbalance(u, v, w, thresholdPct).matched;
}

/**
 * Format unbalance result for matched_conditions string.
 */
export function formatUnbalanceCondition(result: UnbalanceResult): string {
  const euStr = result.eu !== null ? result.eu.toFixed(2) : "null";
  const evStr = result.ev !== null ? result.ev.toFixed(2) : "null";
  const ewStr = result.ew !== null ? result.ew.toFixed(2) : "null";
  const euOk = result.eu !== null && Math.abs(result.eu) >= result.thresholdPct;
  const evOk = result.ev !== null && Math.abs(result.ev) >= result.thresholdPct;
  const ewOk = result.ew !== null && Math.abs(result.ew) >= result.thresholdPct;
  
  return `unbalance OR: Eu ${euStr}% ${euOk ? "TRUE" : "FALSE"}, ` +
         `Ev ${evStr}% ${evOk ? "TRUE" : "FALSE"}, ` +
         `Ew ${ewStr}% ${ewOk ? "TRUE" : "FALSE"} >= ${result.thresholdPct.toFixed(2)}% (Ri ${result.ri.toFixed(2)})`;
}