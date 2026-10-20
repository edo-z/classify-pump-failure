/**
 * Evidence semantics — 1:1 port of ``app/classification/evidence.py``.
 *
 * EVIDENCE_MAXLEN = 31 (30 history + current for the T_A MA30 baseline);
 * an event-time gap breaks the history; readings must already be sorted
 * ascending by timestamp.
 */

import type { SensorReading } from "./models.ts";

export const EVIDENCE_MAXLEN = 31;
export const LIVE_GAP_THRESHOLD_MS = 10000;

/** True when the event-time delta exceeds ``threshold_ms`` (strict). */
export function gapExceeded(
  prev_ts: { epochMs: number },
  curr_ts: { epochMs: number },
  threshold_ms: number,
): boolean {
  try {
    const delta_ms = curr_ts.epochMs - prev_ts.epochMs;
    return delta_ms > threshold_ms;
  } catch {
    return false;
  }
}

export function shouldResetOnGap(
  prev_ts: { epochMs: number },
  curr_ts: { epochMs: number },
  threshold_ms: number = LIVE_GAP_THRESHOLD_MS,
): boolean {
  return gapExceeded(prev_ts, curr_ts, threshold_ms);
}

/**
 * Live-style trailing evidence: walk back up to ``maxlen`` and stop at the
 * first gap. Readings must be sorted ascending by timestamp.
 */
export function buildTrailingEvidence(
  sorted_readings: SensorReading[],
  idx: number,
  gap_threshold_ms: number = LIVE_GAP_THRESHOLD_MS,
  maxlen: number = EVIDENCE_MAXLEN,
): SensorReading[] {
  const trail: SensorReading[] = [sorted_readings[idx]];
  for (let j = idx - 1; j > Math.max(-1, idx - maxlen); j--) {
    const next = sorted_readings[j + 1];
    const cur = sorted_readings[j];
    if (next === undefined || cur === undefined) break;
    const delta_ms = next.timestamp.epochMs - cur.timestamp.epochMs;
    if (delta_ms > gap_threshold_ms) break;
    trail.push(cur);
  }
  trail.reverse();
  return trail;
}

/** median(interval) * 2; <2 samples or median<=0 -> 0. */
export function computeAdaptiveGapThresholdMs(
  sorted_epoch_ms: number[],
): number {
  if (sorted_epoch_ms.length < 2) return 0;
  const intervals: number[] = [];
  for (let i = 0; i + 1 < sorted_epoch_ms.length; i++) {
    intervals.push((sorted_epoch_ms[i + 1] as number) - (sorted_epoch_ms[i] as number));
  }
  intervals.sort((a, b) => a - b);
  const n = intervals.length;
  let median: number;
  if (n % 2 === 1) {
    median = intervals[Math.floor(n / 2)] as number;
  } else {
    median =
      ((intervals[n / 2 - 1] as number) + (intervals[n / 2] as number)) / 2;
  }
  return median > 0 ? median * 2 : 0;
}
