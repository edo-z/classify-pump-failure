// 5R Rapi — agregasi failure murni, diekstrak dari documents/page.tsx.
// Fungsi tanpa hook/state: mudah diuji, dipakai chart + tabel.

import type { FailureArea } from "./replay/types";

export type FailurePointLike = {
  timestamp: string;
  trouble_type: string;
};

export const ALL_FAILURE_TYPES = [
  "pompa_tersangkut_sampah",
  "turbulensi",
  "banyak_sampah",
  "unbalance",
  "undervoltage",
  "overvoltage",
  "dry_run",
  "panel_overheat",
] as const;

// Backend mengirim "dry_run" (nama lama "low_water_menyala" dinormalisasi).
const normalizeTroubleType = (t: string) =>
  t === "low_water_menyala" ? "dry_run" : t;

export function filterFailuresByRange(
  points: FailurePointLike[],
  lastTimestamp: number,
  rangeMs: number,
): FailurePointLike[] {
  if (!points.length) return [];
  if (!Number.isFinite(lastTimestamp) || lastTimestamp === 0) return points;
  const cutoff = lastTimestamp - rangeMs;
  return points.filter((f) => {
    const ts = Date.parse(f.timestamp);
    return Number.isFinite(ts) && ts >= cutoff && ts <= lastTimestamp;
  });
}

export function groupFailureAreas(
  points: FailurePointLike[],
  gapMs: number = 5 * 60 * 1000,
): FailureArea[] {
  if (!points.length) return [];
  const byType: Record<string, FailurePointLike[]> = {};
  for (const f of points) {
    const k = normalizeTroubleType(f.trouble_type || "unknown");
    if (!byType[k]) byType[k] = [];
    byType[k].push(f);
  }
  const areas: FailureArea[] = [];
  for (const [type, pts] of Object.entries(byType)) {
    pts.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
    let start = pts[0];
    let end = pts[0];
    let count = 1;
    for (let i = 1; i < pts.length; i++) {
      const cur = pts[i];
      const gap = Date.parse(cur.timestamp) - Date.parse(end.timestamp);
      if (gap <= gapMs) {
        end = cur;
        count++;
      } else {
        areas.push({
          start: start.timestamp,
          end: end.timestamp,
          trouble_type: type,
          count,
          durationMs: Date.parse(end.timestamp) - Date.parse(start.timestamp),
        });
        start = cur;
        end = cur;
        count = 1;
      }
    }
    areas.push({
      start: start.timestamp,
      end: end.timestamp,
      trouble_type: type,
      count,
      durationMs: Date.parse(end.timestamp) - Date.parse(start.timestamp),
    });
  }
  areas.sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  return areas;
}

export function countFailuresByType(
  points: FailurePointLike[],
  areas: FailureArea[],
): { pointCounts: Record<string, number>; areaCounts: Record<string, number> } {
  const pointCounts: Record<string, number> = {};
  for (const ft of ALL_FAILURE_TYPES) pointCounts[ft] = 0;
  for (const f of points) {
    const t = normalizeTroubleType(f.trouble_type);
    if (t in pointCounts) pointCounts[t]++;
  }
  const areaCounts: Record<string, number> = {};
  for (const ft of ALL_FAILURE_TYPES) areaCounts[ft] = 0;
  for (const a of areas) {
    const t = normalizeTroubleType(a.trouble_type);
    if (t in areaCounts) areaCounts[t]++;
  }
  return { pointCounts, areaCounts };
}
