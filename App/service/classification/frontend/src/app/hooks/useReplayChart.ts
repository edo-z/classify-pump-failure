// 5R Rapi — chart replay + viewport, diekstrak verbatim dari documents/page.tsx.
// Pemilik: 4 instance echarts, cursor, 8 stat viewport. zoomToFailure yang mati
// (tak dipanggil) tidak ikut pindah.

import { useEffect, useRef, useState } from "react";
import * as echarts from "echarts";
import {
  buildFailureAreaSeries,
  buildReplayCursorSeries,
  buildReplayOption,
  buildReplayRender,
  buildReplayRenderSeries,
  buildReplaySeries,
  buildSmallMultipleOption,
  getReplayRenderBudget,
  SMALL_MULTIPLE_GROUPS,
  type DryThresholds,
  type FailureArea,
  type ReplaySignal,
} from "../replay";
import type { TelemetryReplayDataset } from "../api";

type Params = {
  replayDataset: TelemetryReplayDataset | null;
  visibleSignals: Record<ReplaySignal, boolean>;
  failureAreas: FailureArea[];
  // Hanya untuk paritas deps effect (body memakai failureAreas turunan).
  failurePoints: unknown[];
  selectedRangeMs: number;
  lastTimestamp: number;
  replayChartElement: React.RefObject<HTMLDivElement | null>;
  smallChartMechanicalRef: React.RefObject<HTMLDivElement | null>;
  smallChartElectricalRef: React.RefObject<HTMLDivElement | null>;
  smallChartThermalRef: React.RefObject<HTMLDivElement | null>;
  dryThresholds?: DryThresholds;
  monochrome?: boolean;
};

export function useReplayChart({
  replayDataset,
  visibleSignals,
  failureAreas,
  failurePoints,
  selectedRangeMs,
  lastTimestamp,
  replayChartElement,
  smallChartMechanicalRef,
  smallChartElectricalRef,
  smallChartThermalRef,
  dryThresholds = null,
  monochrome = false,
}: Params) {
  const [viewportStart, setViewportStart] = useState(0);
  const [viewportEnd, setViewportEnd] = useState(0);
  const [viewportSamples, setViewportSamples] = useState(0);
  const [replayMedianInterval, setReplayMedianInterval] = useState(0);
  const [replayGapCount, setReplayGapCount] = useState(0);
  const [renderMode, setRenderMode] =
    useState<"RAW" | "ADAPTIVE">("RAW");
  const [renderedPoints, setRenderedPoints] = useState(0);
  const [renderBudget, setRenderBudget] = useState(0);
  const chartInstanceRef = useRef<echarts.ECharts | null>(null);
  const smallChartMechanicalInstanceRef = useRef<echarts.ECharts | null>(null);
  const smallChartElectricalInstanceRef = useRef<echarts.ECharts | null>(null);
  const smallChartThermalInstanceRef = useRef<echarts.ECharts | null>(null);
  const replayCursorRef = useRef(0);
  useEffect(() => {
    if (!replayDataset || !replayChartElement.current) {
      return;
    }

    const replay =
      buildReplaySeries(replayDataset.samples);

    const chart =
      echarts.init(replayChartElement.current);

    chartInstanceRef.current = chart;

    // F9 riset: sinkron dataZoom 4 chart via grup (pengganti dispatch manual
    // yang diabaikan small-multiples). Diputus di cleanup.
    chart.group = "replay-sync";
    const groupCharts: echarts.ECharts[] = [chart];

    // Small multiples init
    const smallMechanicalChart = smallChartMechanicalRef.current
      ? echarts.init(smallChartMechanicalRef.current)
      : null;
    const smallElectricalChart = smallChartElectricalRef.current
      ? echarts.init(smallChartElectricalRef.current)
      : null;
    const smallThermalChart = smallChartThermalRef.current
      ? echarts.init(smallChartThermalRef.current)
      : null;

    if (smallMechanicalChart) {
      smallMechanicalChart.group = "replay-sync";
      groupCharts.push(smallMechanicalChart);
      smallChartMechanicalInstanceRef.current = smallMechanicalChart;
    }
    if (smallElectricalChart) {
      smallElectricalChart.group = "replay-sync";
      groupCharts.push(smallElectricalChart);
      smallChartElectricalInstanceRef.current = smallElectricalChart;
    }
    if (smallThermalChart) {
      smallThermalChart.group = "replay-sync";
      groupCharts.push(smallThermalChart);
      smallChartThermalInstanceRef.current = smallThermalChart;
    }
    echarts.connect("replay-sync");

    let currentStart =
      replay.firstTimestamp;

    let currentEnd =
      replay.lastTimestamp;

    let frame:
      | number
      | null = null;

    const applyViewport = (
      start: number,
      end: number,
    ) => {
      currentStart = start;
      currentEnd = end;

      const budget =
        getReplayRenderBudget(
          chart.getWidth(),
        );

      const render =
        buildReplayRender(
          replay,
          start,
          end,
          budget,
        );

      const baseSeries = buildReplayRenderSeries(
        render,
        visibleSignals,
        dryThresholds,
        monochrome,
      ) as unknown[];
      const failureSeries =
        failureAreas.length
          ? (buildFailureAreaSeries(failureAreas) as unknown[])
          : ([] as unknown[]);
      // F8 riset: cursor selalu ikut agar tak hilang setelah pan/zoom.
      const cursorSeries =
        replayCursorRef.current > 0
          ? (buildReplayCursorSeries(replayCursorRef.current) as unknown[])
          : ([] as unknown[]);
      chart.setOption({
        series: [...(baseSeries as unknown[]), ...(failureSeries as unknown[]), ...cursorSeries],
      });

      setViewportStart(start);
      setViewportEnd(end);
      setViewportSamples(
        render.visibleSamples,
      );
      setRenderMode(render.mode);
      setRenderedPoints(
        render.renderedPoints,
      );
      setRenderBudget(
        render.renderBudget,
      );

      // Update small multiples with same viewport
      if (smallMechanicalChart) {
        const mechRender = buildReplayRender(replay, start, end, budget);
        smallMechanicalChart.setOption(
          buildSmallMultipleOption(
            replay,
            mechRender,
            SMALL_MULTIPLE_GROUPS.mechanical.signals,
            visibleSignals,
            SMALL_MULTIPLE_GROUPS.mechanical.label,
            "Hz / kW / A / % / RPM",
            monochrome,
          ),
        );
      }
      if (smallElectricalChart) {
        const elecRender = buildReplayRender(replay, start, end, budget);
        smallElectricalChart.setOption(
          buildSmallMultipleOption(
            replay,
            elecRender,
            SMALL_MULTIPLE_GROUPS.electrical.signals,
            visibleSignals,
            SMALL_MULTIPLE_GROUPS.electrical.label,
            "V / A",
            monochrome,
          ),
        );
      }
      if (smallThermalChart) {
        const thermRender = buildReplayRender(replay, start, end, budget);
        smallThermalChart.setOption(
          buildSmallMultipleOption(
            replay,
            thermRender,
            SMALL_MULTIPLE_GROUPS.thermal.signals,
            visibleSignals,
            SMALL_MULTIPLE_GROUPS.thermal.label,
            "°C",
            monochrome,
          ),
        );
      }
    };

    const initialBudget =
      getReplayRenderBudget(
        chart.getWidth(),
      );

    const initialRender =
      buildReplayRender(
        replay,
        replay.firstTimestamp,
        replay.lastTimestamp,
        initialBudget,
      );

    chart.setOption(
      buildReplayOption(
        replay,
        initialRender,
        visibleSignals,
        dryThresholds,
        monochrome,
      ),
    );

    if (failureAreas.length) {
      const areaSeries = buildFailureAreaSeries(failureAreas) as unknown[];
      const currentOption = chart.getOption() as unknown as {
        series: unknown[];
      };
      const existing = (currentOption.series as unknown[]) || [];
      const filtered = (
        existing as Array<{ id?: string }>
      ).filter(
        (s) =>
          typeof s.id !== "string" ||
          !s.id.startsWith("failure-"),
      );
      chart.setOption({
        series: [...filtered, ...areaSeries],
      });
    }

    // Init small multiples with initial render
    if (smallMechanicalChart) {
      smallMechanicalChart.setOption(
        buildSmallMultipleOption(
          replay,
          initialRender,
          SMALL_MULTIPLE_GROUPS.mechanical.signals,
          visibleSignals,
          SMALL_MULTIPLE_GROUPS.mechanical.label,
            "Hz / kW / A / % / RPM",
            monochrome,
        ),
      );
    }
    if (smallElectricalChart) {
      smallElectricalChart.setOption(
        buildSmallMultipleOption(
          replay,
          initialRender,
          SMALL_MULTIPLE_GROUPS.electrical.signals,
          visibleSignals,
          SMALL_MULTIPLE_GROUPS.electrical.label,
            "V / A",
            monochrome,
        ),
      );
    }
    if (smallThermalChart) {
      smallThermalChart.setOption(
        buildSmallMultipleOption(
          replay,
          initialRender,
          SMALL_MULTIPLE_GROUPS.thermal.signals,
          visibleSignals,
          SMALL_MULTIPLE_GROUPS.thermal.label,
            "°C",
            monochrome,
        ),
      );
    }

    if (replayCursorRef.current > 0) {
      chart.setOption({
        series: buildReplayCursorSeries(
          replayCursorRef.current,
        ),
      });
    }

    setReplayMedianInterval(
      replay.medianIntervalMs,
    );
    setReplayGapCount(
      replay.gapCount,
    );

    setViewportStart(
      replay.firstTimestamp,
    );
    setViewportEnd(
      replay.lastTimestamp,
    );
    setViewportSamples(
      initialRender.visibleSamples,
    );
    setRenderMode(
      initialRender.mode,
    );
    setRenderedPoints(
      initialRender.renderedPoints,
    );
    setRenderBudget(
      initialRender.renderBudget,
    );

    const handleZoom = (
      event: unknown,
    ) => {
      const payload = event as {
        start?: number;
        end?: number;
        startValue?: number;
        endValue?: number;
        batch?: Array<{
          start?: number;
          end?: number;
          startValue?: number;
          endValue?: number;
        }>;
      };

      const item =
        payload.batch?.[0] ??
        payload;

      // F9 riset: pakai nilai absolut bila ada (presisi pasca-zoom beruntun);
      // persen hanya fallback (drift akumulasi bila dipakai terus).
      if (
        typeof item.startValue === "number" &&
        typeof item.endValue === "number" &&
        Number.isFinite(item.startValue) &&
        Number.isFinite(item.endValue) &&
        item.startValue < item.endValue
      ) {
        if (frame !== null) {
          cancelAnimationFrame(frame);
        }

        frame = requestAnimationFrame(
          () => {
            applyViewport(item.startValue as number, item.endValue as number);
            frame = null;
          },
        );

        return;
      }

      const startPercent =
        typeof item.start === "number"
          ? item.start
          : 0;

      const endPercent =
        typeof item.end === "number"
          ? item.end
          : 100;

      const duration =
        replay.lastTimestamp -
        replay.firstTimestamp;

      const start =
        replay.firstTimestamp +
        duration *
          (startPercent / 100);

      const end =
        replay.firstTimestamp +
        duration *
          (endPercent / 100);

      if (frame !== null) {
        cancelAnimationFrame(frame);
      }

      frame = requestAnimationFrame(
        () => {
          applyViewport(start, end);
          frame = null;
        },
      );
    };

    chart.on(
      "datazoom",
      handleZoom,
    );

    const handleResize = () => {
      chart.resize();
      smallMechanicalChart?.resize();
      smallElectricalChart?.resize();
      smallThermalChart?.resize();

      applyViewport(
        currentStart,
        currentEnd,
      );
    };

    window.addEventListener(
      "resize",
      handleResize,
    );

    return () => {
      if (frame !== null) {
        cancelAnimationFrame(frame);
      }

      window.removeEventListener(
        "resize",
        handleResize,
      );

      chart.off(
        "datazoom",
        handleZoom,
      );

      chart.dispose();
      smallMechanicalChart?.dispose();
      smallElectricalChart?.dispose();
      smallThermalChart?.dispose();
      try {
        echarts.disconnect("replay-sync");
      } catch {}
      chartInstanceRef.current = null;
    };
  }, [replayDataset, visibleSignals, failurePoints, selectedRangeMs, monochrome, dryThresholds]);
  function zoomToArea(startIso: string, endIso: string) {
    const s = Date.parse(startIso);
    const e = Date.parse(endIso);
    if (!Number.isFinite(s) || !Number.isFinite(e)) return;
    const padBefore = 5 * 60 * 1000;
    const padAfter = 2 * 60 * 1000;
    const start = s - padBefore;
    const end = e + padAfter;
    if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) return;
    const chart = chartInstanceRef.current;
    try {
      chart?.dispatchAction({ type: "dataZoom", startValue: start, endValue: end });
      smallChartMechanicalInstanceRef.current?.dispatchAction({ type: "dataZoom", startValue: start, endValue: end });
      smallChartElectricalInstanceRef.current?.dispatchAction({ type: "dataZoom", startValue: start, endValue: end });
      smallChartThermalInstanceRef.current?.dispatchAction({ type: "dataZoom", startValue: start, endValue: end });
    } catch {}
    replayCursorRef.current = s;
    try {
      chart?.setOption({ series: buildReplayCursorSeries(s) } as any);
    } catch {}
    replayChartElement.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }
  // Auto-zoom chart when range changes
  useEffect(() => {
    if (!replayDataset || !chartInstanceRef.current || !Number.isFinite(lastTimestamp)) return;
    const start = lastTimestamp - selectedRangeMs;
    const end = lastTimestamp;
    const chart = chartInstanceRef.current;
    chart.dispatchAction({ type: "dataZoom", startValue: start, endValue: end });
    smallChartMechanicalInstanceRef.current?.dispatchAction({ type: "dataZoom", startValue: start, endValue: end });
    smallChartElectricalInstanceRef.current?.dispatchAction({ type: "dataZoom", startValue: start, endValue: end });
    smallChartThermalInstanceRef.current?.dispatchAction({ type: "dataZoom", startValue: start, endValue: end });
  }, [selectedRangeMs, replayDataset, lastTimestamp]);

  return {
    chartInstanceRef,
    replayCursorRef,
    viewportStart,
    viewportEnd,
    viewportSamples,
    replayMedianInterval,
    replayGapCount,
    renderMode,
    renderedPoints,
    renderBudget,
    zoomToArea,
  };
}
