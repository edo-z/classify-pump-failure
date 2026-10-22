/**
 * Per-profile setpoints — 1:1 port of ``app/classification/setpoints.py``.
 *
 * setpoint priority (FMEA F8): override_freq > profile. Values <=0 / None /
 * invalid fall through to the next level. rpm/torque always come from the
 * profile.
 */

import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";

import { cleanPositive, resolveLayeredValue } from "./configuration-resolver.ts";
import type { OperatingSetpoint } from "./models.ts";
import { PUMP_PROFILES_FILE, ProfileNotFoundError } from "./profiles.ts";
import { pyJsonDumps } from "../util/pyjson.ts";

export const PROFILE_SETPOINTS_FILE = new URL(
  "./profile_setpoints.json",
  import.meta.url,
);

export interface ProfileSetpoint {
  frequency_hz: number | null;
  rpm: number | null;
  torque: number | null;
}

interface ProfilesDoc {
  profiles?: Record<string, unknown>;
}

export function loadProfileIds(
  path: URL | string = PUMP_PROFILES_FILE,
): Set<string> {
  const raw = JSON.parse(readFileSync(path, "utf-8")) as ProfilesDoc;
  return new Set(Object.keys(raw.profiles ?? {}));
}

function toProfileSetpoint(raw: Record<string, unknown>): ProfileSetpoint {
  const f = raw.frequency_hz;
  const r = raw.rpm;
  const t = raw.torque;
  return {
    frequency_hz: typeof f === "number" ? f : null,
    rpm: typeof r === "number" ? r : null,
    torque: typeof t === "number" ? t : null,
  };
}

export function loadProfileSetpoints(
  path: URL | string = PROFILE_SETPOINTS_FILE,
): Record<string, ProfileSetpoint> {
  const flowhead_ids = loadProfileIds();
  let raw: Record<string, Record<string, unknown>> = {};
  if (existsSync(path)) {
    raw = JSON.parse(readFileSync(path, "utf-8")) as Record<
      string,
      Record<string, unknown>
    >;
  }
  const out: Record<string, ProfileSetpoint> = {};
  for (const flowhead_id of [...flowhead_ids].sort()) {
    out[flowhead_id] = toProfileSetpoint(raw[flowhead_id] ?? {});
  }
  return out;
}

export function getProfileSetpoint(
  flowhead_id: string,
  path: URL | string = PROFILE_SETPOINTS_FILE,
): ProfileSetpoint {
  const flowhead_ids = loadProfileIds();
  if (!flowhead_ids.has(flowhead_id)) {
    throw new ProfileNotFoundError(flowhead_id);
  }
  return loadProfileSetpoints(path)[flowhead_id] as ProfileSetpoint;
}

export function saveProfileSetpoint(
  flowhead_id: string,
  setpoint: ProfileSetpoint,
  path: URL | string = PROFILE_SETPOINTS_FILE,
): ProfileSetpoint {
  const flowhead_ids = loadProfileIds();
  if (!flowhead_ids.has(flowhead_id)) {
    throw new ProfileNotFoundError(flowhead_id);
  }
  for (const [field, value] of Object.entries(setpoint)) {
    if (value !== null && !Number.isFinite(value)) {
      throw new RangeError(`non-finite setpoint value: ${field}`);
    }
  }
  const current = loadProfileSetpoints(path);
  current[flowhead_id] = setpoint;
  const serializable: Record<string, ProfileSetpoint> = {};
  for (const key of Object.keys(current).sort()) {
    serializable[key] = current[key] as ProfileSetpoint;
  }
  const target = path instanceof URL ? path : new URL(`file://${path}`);
  const tempName = target.pathname + ".tmp";
  writeFileSync(tempName, pyJsonDumps(serializable, 2) + "\n", "utf-8");
  renameSync(tempName, target.pathname);
  return setpoint;
}

export function resolveEffectiveSetpoint(
  flowhead_id: string,
  override_freq: unknown = null,
): OperatingSetpoint {
  const profile_sp = getProfileSetpoint(flowhead_id);
  const freq = resolveLayeredValue(override_freq, profile_sp.frequency_hz);
  return { frequency: freq, rpm: profile_sp.rpm, torque: profile_sp.torque };
}

export { cleanPositive };
