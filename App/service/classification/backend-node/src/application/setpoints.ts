import {
  PROFILE_SETPOINTS_FILE,
  getProfileSetpoint,
  loadProfileSetpoints,
  saveProfileSetpoint,
  type ProfileSetpoint,
} from "../engine/setpoints.ts";
import { ValidationError } from "./errors.ts";

function coerceGe0(value: unknown, field: string): number | null {
  if (value === null || value === undefined) return null;
  let n: number;
  if (typeof value === "number") n = value;
  else if (typeof value === "string" && value.trim() !== "") n = Number(value);
  else throw new ValidationError(`${field}: value is not a valid number`);
  if (!Number.isFinite(n)) {
    throw new ValidationError(`${field}: value must be a finite number`);
  }
  if (n < 0) throw new ValidationError(`${field}: Input should be greater than or equal to 0`);
  return n;
}

/**
 * Merge a (possibly partial) update onto the current setpoint.
 *
 * An absent field keeps the stored value; an explicit ``null`` clears it.
 * This prevents a partial PUT from silently wiping ``rpm``/``torque``.
 */
export function parseUpdate(
  rawBody: unknown,
  current: ProfileSetpoint,
): ProfileSetpoint {
  if (rawBody === null || typeof rawBody !== "object" || Array.isArray(rawBody)) {
    throw new ValidationError("body: request body must be an object");
  }
  const body = rawBody as Record<string, unknown>;
  const pick = (field: keyof ProfileSetpoint): number | null =>
    Object.prototype.hasOwnProperty.call(body, field)
      ? coerceGe0(body[field], field)
      : current[field];
  return {
    frequency_hz: pick("frequency_hz"),
    rpm: pick("rpm"),
    torque: pick("torque"),
  };
}

export function listProfileSetpoints(
  path: URL | string = PROFILE_SETPOINTS_FILE,
): Record<string, ProfileSetpoint> {
  return loadProfileSetpoints(path);
}

export function readProfileSetpoint(
  profile_id: string,
  path: URL | string = PROFILE_SETPOINTS_FILE,
): ProfileSetpoint {
  return getProfileSetpoint(profile_id, path);
}

export function updateProfileSetpoint(
  profile_id: string,
  rawBody: unknown,
  path: URL | string = PROFILE_SETPOINTS_FILE,
): ProfileSetpoint {
  const current = getProfileSetpoint(profile_id, path);
  const setpoint = parseUpdate(rawBody, current);
  return saveProfileSetpoint(profile_id, setpoint, path);
}
