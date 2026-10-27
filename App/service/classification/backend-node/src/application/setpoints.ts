import { readFile, writeFile } from "node:fs/promises";
import { NotFoundError, ValidationError } from "./errors.ts";

const SETPOINTS_FILE = new URL("../engine/profile_setpoints.json", import.meta.url);

export type ProfileSetpoint = {
  frequency_hz: number | null;
  rpm: number | null;
  torque: number | null;
};

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

async function loadAll(path: URL | string = SETPOINTS_FILE): Promise<Record<string, ProfileSetpoint>> {
  try {
    const content = await readFile(path, "utf-8");
    return JSON.parse(content) as Record<string, ProfileSetpoint>;
  } catch (exc) {
    if ((exc as NodeJS.ErrnoException).code === "ENOENT") {
      return {};
    }
    throw exc;
  }
}

async function saveAll(data: Record<string, ProfileSetpoint>, path: URL | string = SETPOINTS_FILE): Promise<void> {
  await writeFile(path, JSON.stringify(data, null, 2), "utf-8");
}

export async function listProfileSetpoints(
  path: URL | string = SETPOINTS_FILE,
): Promise<Record<string, ProfileSetpoint>> {
  return loadAll(path);
}

export async function readProfileSetpoint(
  flowheadId: string,
  path: URL | string = SETPOINTS_FILE,
): Promise<ProfileSetpoint> {
  const all = await loadAll(path);
  const setpoint = all[flowheadId];
  if (!setpoint) {
    throw new NotFoundError(`Setpoint not found for flowhead: ${flowheadId}`);
  }
  return setpoint;
}

export async function updateProfileSetpoint(
  flowheadId: string,
  rawBody: unknown,
  path: URL | string = SETPOINTS_FILE,
): Promise<ProfileSetpoint> {
  const all = await loadAll(path);
  if (!all[flowheadId]) {
    throw new NotFoundError(`Setpoint not found for flowhead: ${flowheadId}`);
  }
  const current = all[flowheadId];
  const setpoint = parseUpdate(rawBody, current);
  all[flowheadId] = setpoint;
  await saveAll(all, path);
  return setpoint;
}