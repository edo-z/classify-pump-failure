
/**
 * Flowhead group evaluators: PTS, Turbulensi, Banyak Sampah, Dry Run.
 * Pure functions: no state mutation, return Evaluation discriminated union.
 *
 * Readiness setiap Failure menggunakan validateFailureConfig()
 * dari configuration.ts.
 */

import { TroubleType } from "../models.ts";

import type {
  CanonicalTelemetry,
  ClassificationConfig,
  Evaluation,
  SensorReading,
} from "../models.ts";

import {
  freqEq2dp,
  freqBelowSetpoint,
  freqAtOrBelowSetpoint,
} from "../mathematics/frequency.ts";

import { computeTA } from "../mathematics/moving-average.ts";
import type { MAResult } from "../mathematics/moving-average.ts";

import { validateFailureConfig } from "../configuration.ts";

// ============================================================================
// FAILURE-SPECIFIC READINESS
// ============================================================================

type FlowheadFailure =
  | typeof TroubleType.POMPA_TERSANGKUT_SAMPAH
  | typeof TroubleType.TURBULENSI
  | typeof TroubleType.BANYAK_SAMPAH
  | typeof TroubleType.DRY_RUN;

/**
 * Memeriksa kesiapan konfigurasi berdasarkan satu Failure.
 *
 * Tidak lagi mewajibkan seluruh parameter Flowhead.
 *
 * Persyaratan parameter dikelola pada configuration.ts.
 * Format missingData tetap kompatibel dengan Classification Engine.
 */
function checkFhReadiness(
  config: ClassificationConfig,
  failure: FlowheadFailure,
): { ready: boolean; missing: string[] } {

  const result = validateFailureConfig(
    config,
    failure,
  );

  const missing = result.errors.map((error) => {

    const match =
      /^(flowhead\.[a-zA-Z][a-zA-Z0-9]*):/.exec(error);

    if (match) {
      return `config.${match[1]}`;
    }

    return error;
  });

  return {
    ready: result.ready,
    missing,
  };
}

// ============================================================================
// PTS — POMPA TERSANGKUT SAMPAH
// ============================================================================

export function evaluatePTS(
  telemetry: CanonicalTelemetry,
  config: ClassificationConfig,
  history: SensorReading[],
): Evaluation {

  const readiness = checkFhReadiness(
    config,
    TroubleType.POMPA_TERSANGKUT_SAMPAH,
  );

  if (!readiness.ready) {
    return {
      ready: false,
      missingData: readiness.missing,
    };
  }

  const f = telemetry.frequencyHz;
  const kw = telemetry.powerKw;
  const a = telemetry.currentA;
  const t = telemetry.torquePercent;
  const rpm = telemetry.motorSpeedRpm;

  if (
    f === null ||
    kw === null ||
    a === null ||
    t === null ||
    rpm === null
  ) {
    return {
      ready: false,
      missingData: [
        "frequencyHz",
        "powerKw",
        "currentA",
        "torquePercent",
        "motorSpeedRpm",
      ].filter(k => (telemetry as any)[k] === null),
    };
  }

  const ptsF =
    f <= config.flowhead.ptsFrequencyHz!;

  const ptsKw =
    kw >= config.flowhead.ptsPowerRefKw!;

  const ptsA =
    a >= config.flowhead.ptsCurrentRefA!;

  const ptsT =
    t >= config.flowhead.ptsTorqueRefPct!;

  const ptsRpm =
    rpm >= config.flowhead.ptsRpmRef!;

  const ptsCount =
    (ptsKw ? 1 : 0) +
    (ptsA ? 1 : 0) +
    (ptsT ? 1 : 0) +
    (ptsRpm ? 1 : 0);

  const matched =
    ptsF && ptsCount >= 3;

  const measurements: Record<
    string,
    number | string | null
  > = {
    frequencyHz: f,
    powerKw: kw,
    currentA: a,
    torquePercent: t,
    motorSpeedRpm: rpm,

    ptsFrequencyHz: config.flowhead.ptsFrequencyHz,
    ptsPowerRefKw: config.flowhead.ptsPowerRefKw,
    ptsCurrentRefA: config.flowhead.ptsCurrentRefA,
    ptsTorqueRefPct: config.flowhead.ptsTorqueRefPct,
    ptsRpmRef: config.flowhead.ptsRpmRef,

    ptsF: ptsF ? 1 : 0,
    ptsKw: ptsKw ? 1 : 0,
    ptsA: ptsA ? 1 : 0,
    ptsT: ptsT ? 1 : 0,
    ptsRpm: ptsRpm ? 1 : 0,

    ptsCount,
    matched: matched ? 1 : 0,
  };

  return {
    ready: true,
    trigger: matched ? 1 : 0,
    measurements,
  };
}

// ============================================================================
// TURBULENSI
// ============================================================================

export function evaluateTurbulensi(
  telemetry: CanonicalTelemetry,
  config: ClassificationConfig,
  history: SensorReading[],
): Evaluation {

  const readiness = checkFhReadiness(
    config,
    TroubleType.TURBULENSI,
  );

  if (!readiness.ready) {
    return {
      ready: false,
      missingData: readiness.missing,
    };
  }

  const f = telemetry.frequencyHz;
  const kw = telemetry.powerKw;
  const t = telemetry.torquePercent;

  const currentHistory = history.map(r => ({
    motor_current: r.motor_current,
    timestamp: r.timestamp,
  }));

  if (
    f === null ||
    kw === null ||
    t === null
  ) {
    return {
      ready: false,
      missingData: [
        "frequencyHz",
        "powerKw",
        "torquePercent",
      ].filter(k => (telemetry as any)[k] === null),
    };
  }

  const tFreq = freqBelowSetpoint(
    f,
    config.flowhead.frequencySetpointHz,
  );

  const tKw =
    kw >= config.flowhead.turbulensiPowerRefKw!;

  const tT =
    t >= config.flowhead.turbulensiTorqueRefPct!;

  const taResult: MAResult = computeTA(
    currentHistory,
    config.flowhead.turbulensiWindow!,
    config.flowhead.turbulensiCurrentDevThresholdA!,
  );

  const tA = taResult.T_A;

  const matched =
    tFreq && tKw && tA && tT;

  const measurements: Record<
    string,
    number | string | null
  > = {
    frequencyHz: f,
    powerKw: kw,
    torquePercent: t,

    frequencySetpointHz:
      config.flowhead.frequencySetpointHz,

    turbulensiPowerRefKw:
      config.flowhead.turbulensiPowerRefKw,

    turbulensiTorqueRefPct:
      config.flowhead.turbulensiTorqueRefPct,

    turbulensiCurrentDevThresholdA:
      config.flowhead.turbulensiCurrentDevThresholdA,

    turbulensiWindow:
      config.flowhead.turbulensiWindow,

    tFreq: tFreq ? 1 : 0,
    tKw: tKw ? 1 : 0,
    tT: tT ? 1 : 0,
    tA: tA ? 1 : 0,

    taCurrent: taResult.A,
    taMA: taResult.MA_A,
    taDelta: taResult.Delta_A,
    taAbsDelta: taResult.Abs_Delta_A,
    taThreshold: taResult.threshold,
    taWindow: taResult.window,
    taRefKind: taResult.refKind,
    taCollected: taResult.collected,

    matched: matched ? 1 : 0,
  };

  if (!tA && taResult.insufficient) {
    return {
      ready: false,
      missingData: ["motor_current_history"],
    };
  }

  return {
    ready: true,
    trigger: matched ? 1 : 0,
    measurements,
  };
}

// ============================================================================
// BANYAK SAMPAH
// ============================================================================

export function evaluateBanyakSampah(
  telemetry: CanonicalTelemetry,
  config: ClassificationConfig,
  history: SensorReading[],
): Evaluation {

  const readiness = checkFhReadiness(
    config,
    TroubleType.BANYAK_SAMPAH,
  );

  if (!readiness.ready) {
    return {
      ready: false,
      missingData: readiness.missing,
    };
  }

  const f = telemetry.frequencyHz;
  const kw = telemetry.powerKw;
  const a = telemetry.currentA;
  const t = telemetry.torquePercent;

  if (
    f === null ||
    kw === null ||
    a === null ||
    t === null
  ) {
    return {
      ready: false,
      missingData: [
        "frequencyHz",
        "powerKw",
        "currentA",
        "torquePercent",
      ].filter(k => (telemetry as any)[k] === null),
    };
  }

  const bsF = freqAtOrBelowSetpoint(
    f,
    config.flowhead.frequencySetpointHz,
  );

  const bsKw =
    kw >= config.flowhead.banyakSampahPowerRefKw!;

  const bsA =
    a >= config.flowhead.banyakSampahCurrentRefA!;

  const bsT =
    t >= config.flowhead.banyakSampahTorqueRefPct!;

  const matched =
    bsF && bsKw && bsA && bsT;

  const measurements: Record<
    string,
    number | string | null
  > = {
    frequencyHz: f,
    powerKw: kw,
    currentA: a,
    torquePercent: t,

    frequencySetpointHz:
      config.flowhead.frequencySetpointHz,

    banyakSampahPowerRefKw:
      config.flowhead.banyakSampahPowerRefKw,

    banyakSampahCurrentRefA:
      config.flowhead.banyakSampahCurrentRefA,

    banyakSampahTorqueRefPct:
      config.flowhead.banyakSampahTorqueRefPct,

    bsF: bsF ? 1 : 0,
    bsKw: bsKw ? 1 : 0,
    bsA: bsA ? 1 : 0,
    bsT: bsT ? 1 : 0,

    matched: matched ? 1 : 0,
  };

  return {
    ready: true,
    trigger: matched ? 1 : 0,
    measurements,
  };
}

// ============================================================================
// DRY RUN
// ============================================================================

export function evaluateDryRun(
  telemetry: CanonicalTelemetry,
  config: ClassificationConfig,
  history: SensorReading[],
): Evaluation {

  const readiness = checkFhReadiness(
    config,
    TroubleType.DRY_RUN,
  );

  if (!readiness.ready) {
    return {
      ready: false,
      missingData: readiness.missing,
    };
  }

  const f = telemetry.frequencyHz;
  const kw = telemetry.powerKw;
  const a = telemetry.currentA;
  const t = telemetry.torquePercent;

  if (
    f === null ||
    kw === null ||
    a === null ||
    t === null
  ) {
    return {
      ready: false,
      missingData: [
        "frequencyHz",
        "powerKw",
        "currentA",
        "torquePercent",
      ].filter(k => (telemetry as any)[k] === null),
    };
  }

  const drFrequency = freqEq2dp(
    f,
    config.flowhead.frequencySetpointHz,
  );

  const drPowerThreshold =
    config.flowhead.ptsPowerRefKw! *
    config.flowhead.dryRunPowerFactor!;

  const drCurrentThreshold =
    config.flowhead.ptsCurrentRefA! *
    config.flowhead.dryRunCurrentFactor!;

  const drTorqueThreshold =
    config.flowhead.dryRunTorqueThresholdPct!;

  const drPower =
    kw <= drPowerThreshold;

  const drCurrent =
    a <= drCurrentThreshold;

  const drTorque =
    t < drTorqueThreshold;

  const matched =
    drFrequency &&
    drPower &&
    drCurrent &&
    drTorque;

  const measurements: Record<
    string,
    number | string | null
  > = {
    frequencyHz: f,
    powerKw: kw,
    currentA: a,
    torquePercent: t,

    frequencySetpointHz:
      config.flowhead.frequencySetpointHz,

    drPowerThreshold,
    drCurrentThreshold,
    drTorqueThreshold,

    drFrequency: drFrequency ? 1 : 0,
    drPower: drPower ? 1 : 0,
    drCurrent: drCurrent ? 1 : 0,
    drTorque: drTorque ? 1 : 0,

    matched: matched ? 1 : 0,
  };

  return {
    ready: true,
    trigger: matched ? 1 : 0,
    measurements,
  };
}
