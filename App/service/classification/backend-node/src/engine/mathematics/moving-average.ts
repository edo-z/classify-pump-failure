/**
 * Moving Average / CMA calculations for Turbulensi T_A.
 * Pure functions: no state, no I/O.
 */

export interface MAResult {
  /** Current value being evaluated */
  A: number | null;
  /** Reference average (CMA or MA30) */
  MA_A: number;
  /** Difference: A - MA_A */
  Delta_A: number;
  /** Absolute difference */
  Abs_Delta_A: number;
  /** Threshold used for comparison */
  threshold: number;
  /** Number of historical samples used */
  window: number;
  /** "CMA" when historical < window, "MA30" when >= window */
  refKind: "CMA" | "MA30";
  /** Total historical samples available */
  collected: number;
  /** Whether |Delta_A| >= threshold */
  T_A: boolean;
  /** True when insufficient history (collected === 0) */
  insufficient: boolean;
  /** Reason for insufficient */
  reason?: string;
  /** Required samples for MA30 (usually 30) */
  need?: number;
}

/**
 * Compute Cumulative Moving Average (CMA) of historical values.
 * CMA_n = (sum of all historical) / n
 */
export function computeCMA(values: number[]): number {
  if (values.length === 0) return 0;
  const sum = values.reduce((acc, v) => acc + v, 0);
  return sum / values.length;
}

/**
 * Compute Moving Average of last N values (MA_N).
 * MA_N = (sum of last N historical) / N
 */
export function computeMA(values: number[], window: number): number {
  if (values.length === 0) return 0;
  const n = Math.min(values.length, window);
  const relevant = values.slice(-n);
  const sum = relevant.reduce((acc, v) => acc + v, 0);
  return sum / n;
}

/** Maximum allowed gap between consecutive readings (ms) for Turbulensi history continuity. */
export const MAX_HISTORY_GAP_MS = 10_000;

/**
 * Extract valid historical motor_current values from readings (excluding current reading).
 * Readings must be sorted ascending by timestamp.
 * Stops collecting when a timestamp gap > MAX_HISTORY_GAP_MS is encountered (continuity broken).
 * Returns array of historical values (oldest first) from the most recent contiguous segment.
 */
export function extractHistoricalCurrents(
  readings: Array<{ motor_current: number | null; timestamp: { epochMs: number } }>,
  maxHistory: number = 30
): number[] {
  const historical: number[] = [];
  let lastValidTs: number | null = null;
  
  // Exclude the last reading (current), iterate backwards through history
  for (let i = readings.length - 2; i >= 0; i--) {
    const reading = readings[i];
    const v = reading?.motor_current;
    const ts = reading?.timestamp?.epochMs;
    
    if (v === null || v === undefined || !Number.isFinite(v) || ts === undefined) {
      continue;
    }
    
    // Check gap from last valid reading (which is more recent)
    if (lastValidTs !== null && lastValidTs - ts > MAX_HISTORY_GAP_MS) {
      // Gap > 10s: continuity broken, stop collecting older history
      break;
    }
    
    historical.unshift(v); // unshift to maintain chronological order
    lastValidTs = ts;
    
    if (historical.length >= maxHistory) break;
  }
  return historical;
}

/**
 * Compute Turbulensi T_A reference and deviation.
 * - Historical values EXCLUDE the current reading
 * - 0 history -> insufficient
 * - 1-29 history -> CMA
 * - >=30 history -> MA30 (trailing 30)
 * 
 * @param readings Array of readings sorted by timestamp ascending, INCLUDING current reading as last element
 * @param window MA window size (default 30)
 * @param threshold Deviation threshold in Amperes (default 10.0)
 * @returns MAResult with T_A flag and details
 */
export function computeTA(
  readings: Array<{ motor_current: number | null; timestamp: { epochMs: number } }>,
  window: number = 30,
  threshold: number = 10.0
): MAResult {
  if (readings.length === 0) {
    return {
      A: 0,
      MA_A: 0,
      Delta_A: 0,
      Abs_Delta_A: 0,
      threshold,
      window: 0,
      refKind: "CMA",
      collected: 0,
      T_A: false,
      insufficient: true,
      reason: "no_readings",
    };
  }

  const currentReading = readings[readings.length - 1];
  const current = currentReading?.motor_current;
  
  if (current === null || current === undefined || !Number.isFinite(current)) {
    return {
      A: null,
      MA_A: 0,
      Delta_A: 0,
      Abs_Delta_A: 0,
      threshold,
      window: 0,
      refKind: "CMA",
      collected: 0,
      T_A: false,
      insufficient: true,
      reason: "current_none",
    };
  }

  const historical = extractHistoricalCurrents(readings, window);
  const collected = historical.length;

  if (collected === 0) {
    return {
      A: current,
      MA_A: 0,
      Delta_A: 0,
      Abs_Delta_A: 0,
      threshold,
      window: 0,
      refKind: "CMA",
      collected: 0,
      T_A: false,
      insufficient: true,
      reason: `need_${window}_got_0`,
      need: window,
    };
  }

  const refKind = collected >= window ? "MA30" : "CMA";
  const n = Math.min(collected, window);
  
  const refAvg = refKind === "MA30" 
    ? computeMA(historical, window)
    : computeCMA(historical);

  const delta = current - refAvg;
  const absDelta = Math.abs(delta);
  const tA = absDelta >= threshold;

  return {
    A: current,
    MA_A: refAvg,
    Delta_A: delta,
    Abs_Delta_A: absDelta,
    threshold,
    window: n,
    refKind,
    collected,
    T_A: tA,
    insufficient: false,
    need: window,
  };
}

/**
 * Extract window and threshold from rule conditions for T_A.
 * Defaults: window=30, threshold=10.0
 */
export function getTAParams(ruleDef: { conditions?: Array<{ field?: string; op?: string; window?: unknown; threshold?: unknown }> }): [number, number] {
  let window = 30;
  let threshold = 10.0;

  for (const c of ruleDef.conditions ?? []) {
    if (c.field === "motor_current" && c.op === "deviation_from_ma") {
      const w = Math.trunc(Number(c.window ?? 30));
      if (Number.isFinite(w) && w >= 1) window = w;
      const t = Number(c.threshold ?? 10.0);
      if (Number.isFinite(t) && t > 0) threshold = t;
      break;
    }
  }
  return [window, threshold];
}

/**
 * Check if value deviates from reference by at least threshold.
 */
export function checkDeviation(value: number, reference: number, threshold: number): boolean {
  return Math.abs(value - reference) >= threshold;
}

/**
 * Fluctuating check (currently unreachable from the shipped rules.json,
 * ported for behavioral completeness). Returns true when the series shows
 * >= 3 significant moves with >= 2 reversals; optional band centre.
 */
export function checkFluctuation(
  readings: Array<{ timestamp: { epochMs: number }; [key: string]: unknown }>,
  field: string,
  threshold: number,
  center: number | null = null,
): boolean {
  const values: number[] = [];
  for (const reading of readings) {
    const value = reading[field];
    if (value !== null && value !== undefined) values.push(value as number);
  }
  if (values.length < 4) return false;
  if (center !== null) {
    const c = Number(center);
    const t = Number(threshold);
    if (!values.every((v) => c - t <= v && v <= c + t)) return false;
  }
  const directions: number[] = [];
  for (let i = 0; i + 1 < values.length; i++) {
    const delta = (values[i + 1] as number) - (values[i] as number);
    if (delta >= threshold) directions.push(1);
    else if (delta <= -threshold) directions.push(-1);
  }
  if (directions.length < 3) return false;
  let reversals = 0;
  for (let i = 0; i + 1 < directions.length; i++) {
    if (directions[i] !== directions[i + 1]) reversals++;
  }
  return reversals >= 2;
}

/**
 * Check if value is within tolerance percentage of reference.
 */
export function checkNearReference(value: number, reference: number, tolerancePct: number): boolean {
  const tolerance = Math.abs(reference) * (tolerancePct / 100);
  return Math.abs(value - reference) <= tolerance;
}