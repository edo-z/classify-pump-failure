import type {
  ReplayPoint,
  ReplayRender,
} from "./lib/replay/types";
import {
  LIVE_SIGNALS,
  NON_LIVE_SIGNALS,
} from "./lib/replay/constants";
import type { LiveSignal } from "./lib/replay/constants";

export * from "./lib/replay/types";
export * from "./lib/replay/constants";
export * from "./lib/replay/option";
export * from "./lib/replay/buffer";


// 5R Rapi — helper tampung grafik live per-sinyal: event-time per sinyal,
// MAX 2000 + eviksi 1 jam, gap per sinyal.
function buildLivePoints(
  points: ReplayPoint[],
  gapThresholdMs: number,
): ReplayPoint[] {
  if (!points.length) return [];
  // gapThreshold already median*2 or 10000, per signal timeline
  const out: ReplayPoint[] = [];
  let prev: ReplayPoint | undefined;
  for (const p of points) {
    if (prev && p[0] - prev[0] > gapThresholdMs && prev[1] !== null) {
      out.push([prev[0] + gapThresholdMs / 2, null]);
    }
    out.push(p);
    prev = p;
  }
  return out;
}

export function buildLiveRender(
  buffers: Record<LiveSignal, ReplayPoint[]>,
  start: number,
  end: number,
  renderBudget: number,
): ReplayRender {
  // Saring per sinyal menurut rentang tampil, gap per lini-masa sinyal (bukan global)
  const filtered: Record<LiveSignal, ReplayPoint[]> = {} as any;
  let totalPoints = 0;
  for (const sig of LIVE_SIGNALS) {
    const pts = buffers[sig] || [];
    const f = pts.filter((p) => p[0] >= start && p[0] <= end);
    filtered[sig] = f;
    totalPoints += f.length;
  }
  const render: any = {
    visibleSamples: totalPoints,
    renderedPoints: totalPoints,
    renderBudget,
    mode: totalPoints <= renderBudget ? "RAW" : "ADAPTIVE",
  };
  for (const sig of LIVE_SIGNALS) {
    const pts = filtered[sig];
    // Per-signal median for gap, not global (cadence per signal can differ)
    let gapThreshold = 10000;
    if (pts.length >= 2) {
      const intervals: number[] = [];
      for (let i = 1; i < pts.length; i++) {
        const d = pts[i][0] - pts[i - 1][0];
        if (d > 0) intervals.push(d);
      }
      if (intervals.length) {
        intervals.sort((a, b) => a - b);
        const m = Math.floor(intervals.length / 2);
        const median = intervals.length % 2 === 0 ? (intervals[m - 1] + intervals[m]) / 2 : intervals[m];
        gapThreshold = median > 0 ? median * 2 : 10000;
      }
    }
    render[sig] = buildLivePoints(pts, gapThreshold);
  }
  // Fill non-live signals as empty for type compat
  for (const s of NON_LIVE_SIGNALS) {
    render[s] = [];
  }
  return render as ReplayRender;
}

