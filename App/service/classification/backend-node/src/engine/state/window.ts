/**
 * Bounded historical window per pumpId + parameter.
 * Manages event-time ordered history with gap detection.
 */

import type { SensorReading } from "../models.ts";

export const MAX_WINDOW_SIZE = 31;
export const DEFAULT_GAP_THRESHOLD_MS = 10000;

/** Window entry with value and timestamp */
export interface WindowEntry {
  value: number;
  epochMs: number;
}

/** Bounded window for a single metric */
export class BoundedWindow {
  private entries: WindowEntry[] = [];
  private readonly maxSize: number;
  private readonly gapThresholdMs: number;
  private lastEpochMs: number | null = null;

  constructor(maxSize: number = MAX_WINDOW_SIZE, gapThresholdMs: number = DEFAULT_GAP_THRESHOLD_MS) {
    this.maxSize = maxSize;
    this.gapThresholdMs = gapThresholdMs;
  }

  /** 
   * Add a new value if timestamp passes event-time gate.
   * Returns true if added, false if rejected (duplicate/out-of-order).
   */
  tryAdd(value: number | null, epochMs: number): boolean {
    if (value === null || value === undefined || !Number.isFinite(value)) {
      return false;
    }

    if (this.lastEpochMs !== null && epochMs <= this.lastEpochMs) {
      return false;
    }

    if (this.lastEpochMs !== null && (epochMs - this.lastEpochMs) > this.gapThresholdMs) {
      this.entries = [];
    }

    this.entries.push({ value, epochMs });
    this.lastEpochMs = epochMs;

    if (this.entries.length > this.maxSize) {
      this.entries.shift();
    }

    return true;
  }

  getValues(): number[] {
    return this.entries.map(e => e.value);
  }

  getEntries(): WindowEntry[] {
    return [...this.entries];
  }

  getLastEpochMs(): number | null {
    return this.lastEpochMs;
  }

  hasFullHistory(): boolean {
    return this.entries.length >= 30;
  }

  size(): number {
    return this.entries.length;
  }

  clear(): void {
    this.entries = [];
    this.lastEpochMs = null;
  }

  toJSON(): { entries: WindowEntry[]; lastEpochMs: number | null } {
    return { entries: this.entries, lastEpochMs: this.lastEpochMs };
  }

  static fromJSON(data: { entries: WindowEntry[]; lastEpochMs: number | null }, maxSize?: number, gapThresholdMs?: number): BoundedWindow {
    const w = new BoundedWindow(maxSize, gapThresholdMs);
    w.entries = data.entries;
    w.lastEpochMs = data.lastEpochMs;
    return w;
  }
}

/** Window manager for multiple metrics per pump */
export class WindowManager {
  private windows: Map<string, BoundedWindow> = new Map();
  private readonly maxSize: number;
  private readonly gapThresholdMs: number;

  constructor(maxSize: number = MAX_WINDOW_SIZE, gapThresholdMs: number = DEFAULT_GAP_THRESHOLD_MS) {
    this.maxSize = maxSize;
    this.gapThresholdMs = gapThresholdMs;
  }

  private getKey(pumpId: string, metric: string): string {
    return `${pumpId}:${metric}`;
  }

  getWindow(pumpId: string, metric: string): BoundedWindow {
    const key = this.getKey(pumpId, metric);
    let window = this.windows.get(key);
    if (!window) {
      window = new BoundedWindow(this.maxSize, this.gapThresholdMs);
      this.windows.set(key, window);
    }
    return window;
  }

  tryAdd(pumpId: string, metric: string, value: number | null, epochMs: number): boolean {
    return this.getWindow(pumpId, metric).tryAdd(value, epochMs);
  }

  getHistory(pumpId: string, metric: string): number[] {
    return this.getWindow(pumpId, metric).getValues();
  }

  getLastTimestamp(pumpId: string): number | null {
    let latest: number | null = null;
    for (const [key, window] of this.windows) {
      if (key.startsWith(`${pumpId}:`)) {
        const ts = window.getLastEpochMs();
        if (ts !== null && (latest === null || ts > latest)) {
          latest = ts;
        }
      }
    }
    return latest;
  }

  clearPump(pumpId: string): void {
    for (const [key, window] of this.windows) {
      if (key.startsWith(`${pumpId}:`)) {
        window.clear();
        this.windows.delete(key);
      }
    }
  }

  toJSON(): Record<string, { entries: WindowEntry[]; lastEpochMs: number | null }> {
    const result: Record<string, any> = {};
    for (const [key, window] of this.windows) {
      result[key] = window.toJSON();
    }
    return result;
  }

  static fromJSON(data: Record<string, { entries: WindowEntry[]; lastEpochMs: number | null }>, maxSize?: number, gapThresholdMs?: number): WindowManager {
    const m = new WindowManager(maxSize, gapThresholdMs);
    for (const [key, windowData] of Object.entries(data)) {
      m.windows.set(key, BoundedWindow.fromJSON(windowData, maxSize, gapThresholdMs));
    }
    return m;
  }
}