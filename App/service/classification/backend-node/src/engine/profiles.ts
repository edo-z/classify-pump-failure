/**
 * Pump-profile helpers — 1:1 port of ``app/classification/profiles.py``.
 */

import { readFileSync } from "node:fs";

export const PUMP_PROFILES_FILE = new URL(
  "./pump_profiles.json",
  import.meta.url,
);

interface PumpProfilesDoc {
  profiles?: Record<string, { capacity_lps?: unknown }>;
}

export function getProfileCapacity(
  profile_id: string,
  path: URL | string = PUMP_PROFILES_FILE,
): number {
  const raw = JSON.parse(readFileSync(path, "utf-8")) as PumpProfilesDoc;
  const profile = raw.profiles?.[profile_id];
  if (profile === undefined) {
    throw new ProfileNotFoundError(profile_id);
  }
  const capacity = profile.capacity_lps;
  if (typeof capacity !== "number" || !Number.isInteger(capacity) || capacity <= 0) {
    throw new Error(`Invalid capacity for profile: ${profile_id}`);
  }
  return capacity;
}

/** Raised when a profile id is unknown (mapped to HTTP 404 by the API). */
export class ProfileNotFoundError extends Error {
  constructor(profile_id: string) {
    super(profile_id);
    this.name = "ProfileNotFoundError";
  }
}
