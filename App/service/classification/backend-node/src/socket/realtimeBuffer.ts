import { loadDbConfig } from "../config/db.ts";

interface PendingWrite {
  dexPumpId: string;
  paramKey: string;
  value: string;
  eventTimestamp: Date;
  retryCount: number;
}

let retryBuffer: Map<string, PendingWrite> = new Map();
let isProcessing = false;
let dbUnavailableLogged = false;
let config: ReturnType<typeof loadDbConfig>;

export function initRetryBuffer(cfg: ReturnType<typeof loadDbConfig>): void {
  config = cfg;
}

function makeKey(dexPumpId: string, paramKey: string): string {
  return `${dexPumpId}:${paramKey}`;
}

function getDelay(retryCount: number): number {
  const base = config.retryBaseMs;
  const max = config.retryMaxMs;
  const delay = Math.min(base * Math.pow(2, retryCount), max);
  const jitter = delay * 0.1 * Math.random();
  return Math.floor(delay + jitter);
}

function evictOldestIfFull(): void {
  if (retryBuffer.size < config.retryBufferMax) return;
  let oldestKey: string | null = null;
  let oldestTime = Number.MAX_SAFE_INTEGER;
  for (const [key, entry] of retryBuffer.entries()) {
    if (entry.eventTimestamp.getTime() < oldestTime) {
      oldestTime = entry.eventTimestamp.getTime();
      oldestKey = key;
    }
  }
  if (oldestKey) {
    retryBuffer.delete(oldestKey);
    console.warn("[db-retry] buffer full, evicted oldest entry");
  }
}

export function enqueue(
  dexPumpId: string,
  paramKey: string,
  value: string,
  eventTimestamp: Date
): void {
  const key = makeKey(dexPumpId, paramKey);
  const existing = retryBuffer.get(key);
  if (existing) {
    existing.value = value;
    existing.eventTimestamp = eventTimestamp;
    existing.retryCount = 0;
  } else {
    evictOldestIfFull();
    retryBuffer.set(key, { dexPumpId, paramKey, value, eventTimestamp, retryCount: 0 });
  }
}

export function remove(dexPumpId: string, paramKey: string): void {
  const key = makeKey(dexPumpId, paramKey);
  retryBuffer.delete(key);
}

export async function processQueue(
  resolvePump: (dexPumpId: string) => Promise<{ id: number } | null>,
  resolveParam: (paramKey: string) => number | null,
  upsertFn: (pumpId: number, paramDefId: number, value: string, eventTimestamp: Date) => Promise<void>
): Promise<void> {
  if (isProcessing || retryBuffer.size === 0) return;
  isProcessing = true;

  try {
    for (const [key, entry] of retryBuffer.entries()) {
      const paramDefId = resolveParam(entry.paramKey);
      if (!paramDefId) {
        console.warn(`[db-retry] parameter ${entry.paramKey} not in cache, re-queueing`);
        entry.retryCount++;
        continue;
      }

      const pump = await resolvePump(entry.dexPumpId);
      if (!pump) {
        console.warn(`[db-retry] pump ${entry.dexPumpId} not resolvable, re-queueing`);
        entry.retryCount++;
        continue;
      }

      try {
        await upsertFn(pump.id, paramDefId, entry.value, entry.eventTimestamp);
        retryBuffer.delete(key);
        if (!dbUnavailableLogged) {
          console.log("[db-retry] database recovered");
          dbUnavailableLogged = false;
        }
      } catch (e) {
        if (!dbUnavailableLogged) {
          console.error("[db-retry] database unavailable");
          dbUnavailableLogged = true;
        }
        entry.retryCount++;
      }
    }
  } finally {
    isProcessing = false;
    if (retryBuffer.size > 0) {
      const nextRetry = Math.min(...Array.from(retryBuffer.values()).map(e => getDelay(e.retryCount)));
      setTimeout(() => processQueue(resolvePump, resolveParam, upsertFn), nextRetry);
    }
  }
}

export function getBufferSize(): number {
  return retryBuffer.size;
}

export function clearBuffer(): void {
  retryBuffer.clear();
}