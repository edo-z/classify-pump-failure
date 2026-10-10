// 5R Rapi — ECharts option builders, diekstrak dari ../replay.ts.
// replay.ts me-re-export modul ini, konsumen `../replay` tidak berubah.

import type { EChartsOption } from "echarts";
import type {
  FailureArea,
  FailurePointLite,
  ReplayPoint,
  ReplayRender,
  ReplaySeries,
  ReplaySignal,
} from "./types";
import {
  FAILURE_COLORS,
  FAILURE_SYMBOLS,
  MONOCHROME_LINESTYLES,
  MONOCHROME_WIDTHS,
  REPLAY_SIGNAL_COLORS,
  REPLAY_SIGNAL_LABELS,
  SIGNAL_UNITS,
  UNKNOWN_FAILURE_COLOR,
} from "./constants";

// F3 riset: label → satuan untuk formatter tooltip.
const UNIT_BY_LABEL: Record<string, string> = {};
(Object.keys(REPLAY_SIGNAL_LABELS) as ReplaySignal[]).forEach((k) => {
  UNIT_BY_LABEL[REPLAY_SIGNAL_LABELS[k]] = SIGNAL_UNITS[k];
});

export type TooltipParam = {
  seriesName?: string;
  value?: unknown;
  marker?: string;
};

// Keputusan produk #2: titik putus = sensor mati (bukan jeda wajar).
// Dipakai main chart + live agar konsisten.
export function formatAxisTooltip(params: unknown, unitByLabel: Record<string, string> = UNIT_BY_LABEL): string {
  const pts = Array.isArray(params) ? params : [params];
  const lines: string[] = [];
  let gapSeen = false;
  for (const p of pts as TooltipParam[]) {
    const v = Array.isArray(p.value) ? p.value[1] : p.value;
    if (v === null || v === undefined) {
      gapSeen = true;
      continue;
    }
    const unit = unitByLabel[p.seriesName ?? ""] ?? "";
    const num = typeof v === "number" ? v.toLocaleString("id-ID", { maximumFractionDigits: 2 }) : String(v);
    lines.push(`${p.marker ?? ""} ${p.seriesName ?? ""}: <b>${num}${unit ? ` ${unit}` : ""}</b>`);
  }
  if (gapSeen) {
    lines.push(`<span style="color:#6b7280">— gap: sensor mati, tidak ada data —</span>`);
  }
  return lines.join("<br/>");
}

export type DryThresholds = {
  drKw: number;
  drAmp: number;
} | null;

export function buildReplayRenderSeries(
  render: ReplayRender,
  enabled: Record<ReplaySignal, boolean>,
  dryThresholds: DryThresholds = null,
  monochrome: boolean = false,
): NonNullable<EChartsOption["series"]> {
  const candidates: Array<{
    key: ReplaySignal;
    name: string;
    yAxisIndex: number;
    data: ReplayPoint[];
    color: string;
  }> = [
    {
      key: "motorSpeed",
      name: REPLAY_SIGNAL_LABELS.motorSpeed,
      yAxisIndex: 0,
      data: render.motorSpeed,
      color: REPLAY_SIGNAL_COLORS.motorSpeed,
    },
    {
      key: "outputFrequency",
      name: REPLAY_SIGNAL_LABELS.outputFrequency,
      yAxisIndex: 0,
      data: render.outputFrequency,
      color: REPLAY_SIGNAL_COLORS.outputFrequency,
    },
    {
      key: "motorCurrent",
      name: REPLAY_SIGNAL_LABELS.motorCurrent,
      yAxisIndex: 0,
      data: render.motorCurrent,
      color: REPLAY_SIGNAL_COLORS.motorCurrent,
    },
    {
      key: "motorTorque",
      name: REPLAY_SIGNAL_LABELS.motorTorque,
      yAxisIndex: 0,
      data: render.motorTorque,
      color: REPLAY_SIGNAL_COLORS.motorTorque,
    },
    {
      key: "outputPower",
      name: REPLAY_SIGNAL_LABELS.outputPower,
      yAxisIndex: 0,
      data: render.outputPower,
      color: REPLAY_SIGNAL_COLORS.outputPower,
    },
    {
      key: "hoursRun",
      name: REPLAY_SIGNAL_LABELS.hoursRun,
      yAxisIndex: 0,
      data: render.hoursRun,
      color: REPLAY_SIGNAL_COLORS.hoursRun,
    },
    {
      key: "outputVoltage",
      name: REPLAY_SIGNAL_LABELS.outputVoltage,
      yAxisIndex: 1,
      data: render.outputVoltage,
      color: REPLAY_SIGNAL_COLORS.outputVoltage,
    },
    {
      key: "ambientTemperature",
      name: REPLAY_SIGNAL_LABELS.ambientTemperature,
      yAxisIndex: 0,
      data: render.ambientTemperature,
      color: REPLAY_SIGNAL_COLORS.ambientTemperature,
    },
    {
      key: "controlBoardTemperature",
      name: REPLAY_SIGNAL_LABELS.controlBoardTemperature,
      yAxisIndex: 0,
      data: render.controlBoardTemperature,
      color: REPLAY_SIGNAL_COLORS.controlBoardTemperature,
    },
    {
      key: "inverterTemperature",
      name: REPLAY_SIGNAL_LABELS.inverterTemperature,
      yAxisIndex: 0,
      data: render.inverterTemperature,
      color: REPLAY_SIGNAL_COLORS.inverterTemperature,
    },
    {
      key: "inputVoltage",
      name: REPLAY_SIGNAL_LABELS.inputVoltage,
      yAxisIndex: 1,
      data: render.inputVoltage,
      color: REPLAY_SIGNAL_COLORS.inputVoltage,
    },
    {
      key: "fluxActual",
      name: REPLAY_SIGNAL_LABELS.fluxActual,
      yAxisIndex: 0,
      data: render.fluxActual,
      color: REPLAY_SIGNAL_COLORS.fluxActual,
    },
    {
      key: "motorEstimatedTemperature",
      name: REPLAY_SIGNAL_LABELS.motorEstimatedTemperature,
      yAxisIndex: 0,
      data: render.motorEstimatedTemperature,
      color: REPLAY_SIGNAL_COLORS.motorEstimatedTemperature,
    },
    {
      key: "arusRmsU",
      name: REPLAY_SIGNAL_LABELS.arusRmsU,
      yAxisIndex: 0,
      data: render.arusRmsU,
      color: REPLAY_SIGNAL_COLORS.arusRmsU,
    },
    {
      key: "arusRmsV",
      name: REPLAY_SIGNAL_LABELS.arusRmsV,
      yAxisIndex: 0,
      data: render.arusRmsV,
      color: REPLAY_SIGNAL_COLORS.arusRmsV,
    },
    {
      key: "arusRmsW",
      name: REPLAY_SIGNAL_LABELS.arusRmsW,
      yAxisIndex: 0,
      data: render.arusRmsW,
      color: REPLAY_SIGNAL_COLORS.arusRmsW,
    },
    {
      key: "frequencySetpoint",
      name: REPLAY_SIGNAL_LABELS.frequencySetpoint,
      yAxisIndex: 0,
      data: (render as any).frequencySetpoint,
      color: REPLAY_SIGNAL_COLORS.frequencySetpoint,
    },
  ];

  return candidates
    .filter((item) => enabled[item.key])
    .map((item) => ({
      id: item.key,
      name: item.name,
      type: "line",
      xAxisIndex: 0,
      yAxisIndex: item.yAxisIndex,
      showSymbol: false,
      connectNulls: false,
      // F1 riset: garis patah jujur — smoothing memenggal puncak turbulensi.
      smooth: false,
      lineStyle: {
        width: monochrome
          ? MONOCHROME_WIDTHS[item.key]
          : item.key === "inputVoltage" || item.key === "outputVoltage" ? 2.5 : 2,
        // Mode monokrom: hitam + pola dash per sinyal (bukan warna).
        color: monochrome ? "#111827" : item.color,
        type: monochrome ? MONOCHROME_LINESTYLES[item.key] : "solid",
      },
      // F4 riset: tanpa fill garis utama (alpha menumpuk menyesatkan).
      emphasis: {
        focus: "series" as const,
      },
      data: item.data,
      // F2 riset: ambang tegangan dari rules (under<360, over>410) menempel di seri voltase.
      ...(item.key === "inputVoltage"
        ? {
            markLine: {
              silent: true,
              symbol: "none",
              label: { fontSize: 10, formatter: "{b}" },
              lineStyle: { type: "dashed", color: monochrome ? "#4b5563" : "#dc2626" },
              data: [{ yAxis: 360, name: "Under <360V" }, { yAxis: 410, name: "Over >410V" }],
            },
          }
        : null),
      // F7 riset: ambang DRY per-tier dari API (keputusan produk #3).
      ...((dryThresholds && item.key === "outputPower"
        ? {
            markLine: {
              silent: true,
              symbol: "none",
              label: { fontSize: 10, formatter: "DR kW" },
              lineStyle: { type: "dashed", color: monochrome ? "#4b5563" : "#b45309" },
              data: [{ yAxis: dryThresholds.drKw, name: "DR kW" }],
            },
          }
        : null) as object),
      ...((dryThresholds && item.key === "motorCurrent"
        ? {
            markLine: {
              silent: true,
              symbol: "none",
              label: { fontSize: 10, formatter: "DR A" },
              lineStyle: { type: "dashed", color: monochrome ? "#4b5563" : "#b45309" },
              data: [{ yAxis: dryThresholds.drAmp, name: "DR A" }],
            },
          }
        : null) as object),
      // F7 riset: PTS F<=10Hz (rules tiers.*.POMPA_TERSANGKUT_SAMPAH).
      ...((item.key === "outputFrequency"
        ? {
            markLine: {
              silent: true,
              symbol: "none",
              label: { fontSize: 10, formatter: "PTS F≤10Hz" },
              lineStyle: { type: "dashed", color: monochrome ? "#4b5563" : "#b45309" },
              data: [{ yAxis: 10, name: "PTS F≤10Hz" }],
            },
          }
        : null) as object),
      // F7 riset: panel 60°C (rules tiers.panel_overheat, ketiga suhu panel).
      ...((item.key === "ambientTemperature" ||
      item.key === "controlBoardTemperature" ||
      item.key === "inverterTemperature"
        ? {
            markLine: {
              silent: true,
              symbol: "none",
              label: { fontSize: 10, formatter: "Panel ≥60°C" },
              lineStyle: { type: "dashed", color: monochrome ? "#4b5563" : "#CC79A7" },
              data: [{ yAxis: 60, name: "Panel ≥60°C" }],
            },
          }
        : null) as object),
    }));
}

export function buildReplayOption(
  replay: ReplaySeries,
  render: ReplayRender,
  enabled: Record<ReplaySignal, boolean>,
  dryThresholds: DryThresholds = null,
  monochrome: boolean = false,
): EChartsOption {
  return {
    animation: false,

    tooltip: {
      trigger: "axis",
      axisPointer: {
        type: "line",
      },
      backgroundColor: "white",
      borderColor: "#e5e7eb",
      borderWidth: 1,
      textStyle: {
        fontSize: 12,
      },
      // F3 riset: nilai + satuan per sinyal (Hz/A/%/kW/RPM/°C/V).
      // Titik putus = sensor mati (keputusan produk #2).
      formatter: (params: unknown) => formatAxisTooltip(params),
    },

    legend: {
      bottom: 0,
      top: undefined,
      type: "scroll",
      itemGap: 12,
      textStyle: {
        fontSize: 11,
      },
    },

    grid: {
      left: 60,
      right: 60,
      top: 20,
      bottom: 60,
    },

    xAxis: {
      type: "time",
      min: replay.firstTimestamp,
      max: replay.lastTimestamp,
      axisLine: {
        lineStyle: {
          color: "#d1d5db",
        },
      },
      splitLine: {
        show: true,
        lineStyle: {
          color: "#f3f4f6",
        },
      },
    },

    yAxis: [
      {
        type: "value",
        name: "Hz / A / % / kW / RPM / °C",
        position: "left",
        scale: true,
        min: 0,
        splitLine: {
          show: true,
          lineStyle: {
            color: "#f3f4f6",
          },
        },
      },
      {
        type: "value",
        name: "VDC / V",
        position: "right",
        // F2 riset: skala dinamis — fix 350-550 memotong undervoltage<360.
        scale: true,
        splitLine: {
          show: false,
        },
      },
      {
        type: "value",
        show: false,
        min: 0,
        max: 100,
      },
    ],

    dataZoom: [
      {
        type: "inside",
        xAxisIndex: 0,
        filterMode: "none",
      },
      {
        type: "slider",
        xAxisIndex: 0,
        filterMode: "none",
        bottom: 5,
        height: 18,
      },
    ],

    series: buildReplayRenderSeries(
      render,
      enabled,
      dryThresholds,
      monochrome,
    ),
  };
}

export function buildSmallMultipleOption(
  replay: ReplaySeries,
  render: ReplayRender,
  signals: ReplaySignal[],
  enabled: Record<ReplaySignal, boolean>,
  title: string,
  unit: string = "",
  monochrome: boolean = false,
): EChartsOption {
  const filteredEnabled: Record<ReplaySignal, boolean> = {} as Record<ReplaySignal, boolean>;
  for (const sig of signals) {
    filteredEnabled[sig] = !!enabled[sig];
  }
  // For small multiples we want all signals in group regardless of global enabled? Use filteredEnabled
  // If none enabled in group, show empty placeholder
  return {
    animation: false,
    title: {
      text: title,
      left: "center",
      textStyle: {
        fontSize: 12,
        fontWeight: 600,
      },
    },
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "line" },
      backgroundColor: "white",
      borderColor: "#e5e7eb",
      borderWidth: 1,
      textStyle: { fontSize: 11 },
    },
    grid: {
      left: 50,
      right: 20,
      top: 30,
      bottom: 30,
    },
    xAxis: {
      type: "time",
      min: replay.firstTimestamp,
      max: replay.lastTimestamp,
      // F11 riset: label waktu agar panel sejajar (format jam:menit).
      axisLabel: {
        formatter: (value: unknown) =>
          new Date(typeof value === "number" ? value : Number(value)).toLocaleString("id-ID", {
            hour: "2-digit",
            minute: "2-digit",
            day: "2-digit",
            month: "2-digit",
          }),
        fontSize: 10,
        color: "#6b7280",
      },
    },
    yAxis: {
      type: "value",
      scale: true,
      min: 0,
      // F11 riset: satuan grup agar panel berdiri sendiri di paper.
      name: unit,
      nameTextStyle: { fontSize: 10, color: "#6b7280" },
      splitLine: {
        show: true,
        lineStyle: { color: "#f3f4f6" },
      },
    },
    dataZoom: [
      {
        type: "inside",
        xAxisIndex: 0,
        filterMode: "none",
      },
    ],
    series: (buildReplayRenderSeries(
      render,
      filteredEnabled,
      null,
      monochrome,
    ) as unknown as Array<{ id: string; yAxisIndex: number }>)
      .filter((s) =>
        (signals as string[]).includes(s.id as string),
      )
      .map((s) => ({ ...s, yAxisIndex: 0, xAxisIndex: 0 })) as unknown as EChartsOption["series"],
  };
}

export function buildReplayCursorSeries(
  timestamp: number,
): NonNullable<EChartsOption["series"]> {
  return [
    {
      id: "replay-cursor",
      type: "line",
      xAxisIndex: 0,
      yAxisIndex: 0,
      data: [],
      silent: true,
      markLine: {
        symbol: "none",
        silent: true,
        label: {
          show: false,
        },
        lineStyle: {
          type: "dashed",
          color: "#ef4444",
        },
        data: [
          {
            xAxis: timestamp,
          },
        ],
      },
    },
  ];
}

export function buildFailureScatterSeries(
  failures: FailurePointLite[],
): NonNullable<EChartsOption["series"]> {
  if (!failures.length) return [];

  const grouped: Record<string, number[]> = {};
  for (const f of failures) {
    const ts = Date.parse(f.timestamp);
    if (!Number.isFinite(ts)) continue;
    const key = f.trouble_type || "unknown";
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(ts);
  }

  return Object.entries(grouped).flatMap(([type, timestamps]) => {
    const color = FAILURE_COLORS[type] || UNKNOWN_FAILURE_COLOR;
    const symbol = FAILURE_SYMBOLS[type] || "diamond";
    // Scatter diamond on top (y high) + vertical dashed line per point
    const scatter: Record<string, unknown> = {
      id: `failure-${type}`,
      name: type.toUpperCase(),
      type: "scatter",
      xAxisIndex: 0,
      yAxisIndex: 2,
      symbol,
      symbolSize: 12,
      z: 10,
      zlevel: 1,
      itemStyle: {
        color,
        borderColor: "white",
        borderWidth: 2,
        shadowColor: "rgba(0,0,0,0.25)",
        shadowBlur: 6,
      },
      emphasis: {
        scale: 1.6,
        itemStyle: {
          shadowBlur: 10,
        },
      },
      // Use hidden yAxis 2 (0-100) at y=95 near top, always visible regardless of main left axis range
      data: timestamps.map((ts) => [ts, 95] as [number, number]),
      tooltip: {
        formatter: (p: unknown) => {
          const param = p as { data: [number, number]; seriesName: string };
          return `${param.seriesName}<br/>${new Date(
            param.data[0],
          ).toLocaleString("id-ID")}`;
        },
      },
    };

    const verticalLines: Record<string, unknown> = {
      id: `failure-line-${type}`,
      type: "line",
      xAxisIndex: 0,
      yAxisIndex: 0,
      data: [],
      silent: true,
      z: 9,
      lineStyle: { opacity: 0 },
      // F10 riset: garis vertikal per titik hanya bila sedikit (<=20);
      // ratusan titik jadi garis-garis yang menutupi grafik.
      markLine: timestamps.length <= 20 ? {
        symbol: "none",
        silent: true,
        label: { show: false },
        lineStyle: {
          type: "dashed",
          width: 1,
          color,
          opacity: 0.45,
        },
        data: timestamps.map((ts) => ({ xAxis: ts })),
      } : { symbol: "none", silent: true, label: { show: false }, data: [] },
    };

    return (timestamps.length <= 20 ? [scatter, verticalLines] : [scatter]) as unknown as NonNullable<
      EChartsOption["series"]
    >;
  }) as NonNullable<EChartsOption["series"]>;
}

export function buildFailureAreaSeries(
  areas: FailureArea[],
): NonNullable<EChartsOption["series"]> {
  if (!areas.length) return [];

  const grouped: Record<string, { start: number; end: number; durationMs: number }[]> = {};
  for (const a of areas) {
    const s = Date.parse(a.start);
    const e = Date.parse(a.end);
    if (!Number.isFinite(s) || !Number.isFinite(e)) continue;
    const key = a.trouble_type || "unknown";
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push({ start: s, end: e, durationMs: a.durationMs });
  }

  const series: Record<string, unknown>[] = [];

  for (const [type, intervals] of Object.entries(grouped)) {
    const color = FAILURE_COLORS[type] || UNKNOWN_FAILURE_COLOR;
    const symbol = FAILURE_SYMBOLS[type] || "diamond";
    series.push({
      id: `failure-area-${type}`,
      name: `${type.toUpperCase()} AREA`,
      type: "line",
      xAxisIndex: 0,
      yAxisIndex: 0,
      data: [],
      silent: true,
      z: 5,
      lineStyle: { opacity: 0 },
      markArea: {
        silent: true,
        itemStyle: {
          color: `${color}18`,
          borderWidth: 0,
        },
        label: {
          show: true,
          position: "insideTop",
          formatter: () => {
            // Label area cukup tipe + durasi via data item (lihat intervals.map di bawah).
            return type.toUpperCase();
          },
          color,
          // F10 riset: label area minimal 10px agar terbaca di figure.
          fontSize: 10,
          fontWeight: 600,
        },
        data: intervals.map(({ start, end, durationMs }) => {
          const durSec = Math.round(durationMs / 1000);
          const durLabel = durSec < 60 ? `${durSec}s` : durSec < 3600 ? `${Math.round(durSec / 60)}m` : `${(durSec / 3600).toFixed(1)}h`;
          return [
            { xAxis: start, label: { formatter: `${type.toUpperCase()} ${durLabel}` } },
            { xAxis: end },
          ];
        }),
      },
    });

    // Diamond at start edge per area
    series.push({
      id: `failure-start-${type}`,
      name: `${type.toUpperCase()} START`,
      type: "scatter",
      xAxisIndex: 0,
      yAxisIndex: 2,
      symbol,
      symbolSize: 12,
      z: 10,
      zlevel: 1,
      itemStyle: {
        color,
        borderColor: "white",
        borderWidth: 2,
        shadowColor: "rgba(0,0,0,0.25)",
        shadowBlur: 6,
      },
      emphasis: { scale: 1.6 },
      data: intervals.map(({ start }) => [start, 95] as [number, number]),
    });
  }

  return series as unknown as NonNullable<EChartsOption["series"]>;
}

export function buildFailureMarkAreaOption(
  failures: FailurePointLite[],
): NonNullable<EChartsOption["series"]> {
  return buildFailureScatterSeries(failures);
}
