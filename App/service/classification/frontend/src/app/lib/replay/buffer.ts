// 5R Rapi — buffer series/adaptive/points, diekstrak dari ../replay.ts.
// replay.ts me-re-export modul ini, konsumen `../replay` tidak berubah.

import type { TelemetrySample } from "../../api";
import type {
  ReplayPoint,
  ReplayRender,
  ReplayRenderMode,
  ReplayRow,
  ReplaySeries,
} from "./types";
import { SIGNALS } from "./constants";

function median(values: number[]) {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 0) {
    return (
      sorted[middle - 1] +
      sorted[middle]
    ) / 2;
  }

  return sorted[middle];
}

function lowerBound(
  timestamps: number[],
  value: number,
) {
  let low = 0;
  let high = timestamps.length;

  while (low < high) {
    const middle = Math.floor((low + high) / 2);

    if (timestamps[middle] < value) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }

  return low;
}

function upperBound(
  timestamps: number[],
  value: number,
) {
  let low = 0;
  let high = timestamps.length;

  while (low < high) {
    const middle = Math.floor((low + high) / 2);

    if (timestamps[middle] <= value) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }

  return low;
}

export function buildReplaySeries(
  samples: TelemetrySample[],
): ReplaySeries {
  const valid = samples
    .map((sample) => ({
      sample,
      timestamp: sample.timestamp
        ? Date.parse(sample.timestamp)
        : Number.NaN,
    }))
    .filter((item) =>
      Number.isFinite(item.timestamp),
    );

  const timestamps = valid.map(
    (item) => item.timestamp,
  );

  const intervals: number[] = [];

  for (
    let index = 1;
    index < timestamps.length;
    index += 1
  ) {
    const delta =
      timestamps[index] -
      timestamps[index - 1];

    if (delta > 0) {
      intervals.push(delta);
    }
  }

  const medianIntervalMs = median(intervals);

  const gapThreshold =
    medianIntervalMs > 0
      ? medianIntervalMs * 2
      : Number.POSITIVE_INFINITY;

  let gapCount = 0;

  const rows: ReplayRow[] = valid.map(
    ({ sample, timestamp }, index) => {
      let gapBefore = false;

      if (index > 0) {
        const delta =
          timestamp -
          valid[index - 1].timestamp;

        gapBefore =
          delta > gapThreshold;

        if (gapBefore) {
          gapCount += 1;
        }
      }

      return {
        timestamp,
        motorSpeed: sample.motor_speed,
        outputFrequency:
          sample.output_frequency,
        motorCurrent:
          sample.motor_current,
        motorTorque:
          sample.motor_torque,
        outputPower:
          sample.output_power,
        hoursRun:
          sample.hours_run,
        outputVoltage:
          sample.output_voltage,
        ambientTemperature:
          sample.ambient_temperature,
        controlBoardTemperature:
          sample.control_board_temperature,
        inverterTemperature:
          sample.inverter_temperature,
        inputVoltage:
          sample.input_voltage,
        fluxActual:
          sample.flux_actual,
        motorEstimatedTemperature:
          sample.motor_estimated_temperature,
        arusRmsU:
          sample.arus_rms_u,
        arusRmsV:
          sample.arus_rms_v,
        arusRmsW:
          sample.arus_rms_w,
        frequencySetpoint:
          (sample as any).frequency_setpoint ?? (sample as any).frequencySetpoint ?? null,
        gapBefore,
      };
    },
  );

  return {
    rows,
    timestamps,
    firstTimestamp:
      timestamps[0] ?? 0,
    lastTimestamp:
      timestamps.at(-1) ?? 0,
    timestampedSamples:
      timestamps.length,
    medianIntervalMs,
    gapCount,
  };
}

export function countSamplesInRange(
  timestamps: number[],
  start: number,
  end: number,
) {
  return Math.max(
    0,
    upperBound(timestamps, end) -
      lowerBound(timestamps, start),
  );
}

export function getReplayRenderBudget(
  chartWidth: number,
) {
  const width = Math.max(1, chartWidth);

  return Math.max(
    800,
    Math.min(
      6000,
      Math.floor(width * 2),
    ),
  );
}

function selectAdaptiveRows(
  rows: ReplayRow[],
  renderBudget: number,
) {
  if (rows.length <= renderBudget) {
    return rows;
  }

  const selected = new Set<number>();

  /*
   * Per bucket:
   * - first
   * - last
   * - min/max for each visible signal
   *
   * Up to ~34 selected rows per bucket for 16 signals.
   */
  const maximumSelectionsPerBucket =
    2 + SIGNALS.length * 2;

  const bucketCount = Math.max(
    1,
    Math.floor(
      renderBudget /
        maximumSelectionsPerBucket,
    ),
  );

  const bucketSize = Math.ceil(
    rows.length / bucketCount,
  );

  for (
    let start = 0;
    start < rows.length;
    start += bucketSize
  ) {
    const end = Math.min(
      rows.length,
      start + bucketSize,
    );

    selected.add(start);
    selected.add(end - 1);

    for (const signal of SIGNALS) {
      let minIndex = -1;
      let maxIndex = -1;
      let minValue =
        Number.POSITIVE_INFINITY;
      let maxValue =
        Number.NEGATIVE_INFINITY;

      for (
        let index = start;
        index < end;
        index += 1
      ) {
        const value = rows[index][signal];

        if (
          typeof value !== "number" ||
          !Number.isFinite(value)
        ) {
          continue;
        }

        if (value < minValue) {
          minValue = value;
          minIndex = index;
        }

        if (value > maxValue) {
          maxValue = value;
          maxIndex = index;
        }
      }

      if (minIndex >= 0) {
        selected.add(minIndex);
      }

      if (maxIndex >= 0) {
        selected.add(maxIndex);
      }
    }
  }

  /*
   * Always retain both sides of a real
   * telemetry gap.
   */
  for (
    let index = 1;
    index < rows.length;
    index += 1
  ) {
    if (rows[index].gapBefore) {
      selected.add(index - 1);
      selected.add(index);
    }
  }

  return [...selected]
    .sort((a, b) => a - b)
    .map((index) => rows[index]);
}

function buildPoints(
  rows: ReplayRow[],
  key: keyof Omit<ReplayRow, "timestamp" | "gapBefore">,
  medianIntervalMs: number,
): ReplayPoint[] {
  const points: ReplayPoint[] = [];

  let previous:
    | ReplayRow
    | undefined;

  for (const row of rows) {
    if (
      row.gapBefore &&
      previous
    ) {
      points.push([
        previous.timestamp +
          medianIntervalMs,
        null,
      ]);
    }

    points.push([
      row.timestamp,
      row[key] as number | null,
    ]);

    previous = row;
  }

  return points;
}

export function buildReplayRender(
  replay: ReplaySeries,
  start: number,
  end: number,
  renderBudget: number,
): ReplayRender {
  const firstIndex = lowerBound(
    replay.timestamps,
    start,
  );

  const lastIndex = upperBound(
    replay.timestamps,
    end,
  );

  const visibleRows =
    replay.rows.slice(
      firstIndex,
      lastIndex,
    );

  const mode: ReplayRenderMode =
    visibleRows.length <= renderBudget
      ? "RAW"
      : "ADAPTIVE";

  const renderedRows =
    mode === "RAW"
      ? visibleRows
      : selectAdaptiveRows(
          visibleRows,
          renderBudget,
        );

  return {
    motorSpeed: buildPoints(
      renderedRows,
      "motorSpeed",
      replay.medianIntervalMs,
    ),
    outputFrequency: buildPoints(
      renderedRows,
      "outputFrequency",
      replay.medianIntervalMs,
    ),
    motorCurrent: buildPoints(
      renderedRows,
      "motorCurrent",
      replay.medianIntervalMs,
    ),
    motorTorque: buildPoints(
      renderedRows,
      "motorTorque",
      replay.medianIntervalMs,
    ),
    outputPower: buildPoints(
      renderedRows,
      "outputPower",
      replay.medianIntervalMs,
    ),
    hoursRun: buildPoints(
      renderedRows,
      "hoursRun",
      replay.medianIntervalMs,
    ),
    outputVoltage: buildPoints(
      renderedRows,
      "outputVoltage",
      replay.medianIntervalMs,
    ),
    ambientTemperature: buildPoints(
      renderedRows,
      "ambientTemperature",
      replay.medianIntervalMs,
    ),
    controlBoardTemperature: buildPoints(
      renderedRows,
      "controlBoardTemperature",
      replay.medianIntervalMs,
    ),
    inverterTemperature: buildPoints(
      renderedRows,
      "inverterTemperature",
      replay.medianIntervalMs,
    ),
    inputVoltage: buildPoints(
      renderedRows,
      "inputVoltage",
      replay.medianIntervalMs,
    ),
    fluxActual: buildPoints(
      renderedRows,
      "fluxActual",
      replay.medianIntervalMs,
    ),
    motorEstimatedTemperature: buildPoints(
      renderedRows,
      "motorEstimatedTemperature",
      replay.medianIntervalMs,
    ),
    arusRmsU: buildPoints(
      renderedRows,
      "arusRmsU",
      replay.medianIntervalMs,
    ),
    arusRmsV: buildPoints(
      renderedRows,
      "arusRmsV",
      replay.medianIntervalMs,
    ),
    arusRmsW: buildPoints(
      renderedRows,
      "arusRmsW",
      replay.medianIntervalMs,
    ),
    frequencySetpoint: buildPoints(
      renderedRows,
      "frequencySetpoint" as any,
      replay.medianIntervalMs,
    ),
    visibleSamples:
      visibleRows.length,
    renderedPoints:
      renderedRows.length,
    renderBudget,
    mode,
  };
}
