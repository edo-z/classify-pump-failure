import { readFileSync } from "node:fs";

import { RULES_FILE } from "../engine/engine.ts";
import {
  PROFILE_SETPOINTS_FILE,
  loadProfileSetpoints,
} from "../engine/setpoints.ts";

export interface HealthStatus {
  status: "ok" | "degraded";
  rules_exists: boolean;
  rules_loaded: boolean;
  rules_error: string | null;
  setpoints_exists: boolean;
  setpoints_loaded: boolean;
  setpoints_error: string | null;
}

export function getHealthStatus(): HealthStatus {
  let rulesExists = false;
  let rulesLoaded = false;
  let rulesError: string | null = null;
  try {
    const data = JSON.parse(readFileSync(RULES_FILE, "utf-8")) as unknown;
    rulesExists = true;
    rulesLoaded =
      typeof data === "object" && data !== null && "tiers" in (data as object);
    if (!rulesLoaded) rulesError = "invalid schema: missing 'tiers'";
  } catch (exc) {
    if ((exc as NodeJS.ErrnoException).code !== "ENOENT") {
      rulesExists = true;
      rulesError = exc instanceof SyntaxError ? "invalid JSON" : "unreadable";
    }
  }

  let setpointsExists = false;
  let setpointsLoaded = false;
  let setpointsError: string | null = null;
  try {
    readFileSync(PROFILE_SETPOINTS_FILE, "utf-8");
    setpointsExists = true;
    loadProfileSetpoints();
    setpointsLoaded = true;
  } catch (exc) {
    if ((exc as NodeJS.ErrnoException).code !== "ENOENT") {
      setpointsExists = true;
      setpointsError =
        exc instanceof SyntaxError ? "invalid JSON" : "unreadable";
    } else {
      setpointsLoaded = true;
    }
  }

  return {
    status: rulesLoaded && setpointsLoaded ? "ok" : "degraded",
    rules_exists: rulesExists,
    rules_loaded: rulesLoaded,
    rules_error: rulesError,
    setpoints_exists: setpointsExists,
    setpoints_loaded: setpointsLoaded,
    setpoints_error: setpointsError,
  };
}
