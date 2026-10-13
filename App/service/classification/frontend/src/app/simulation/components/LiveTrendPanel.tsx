// Panel Live Trend — presentasi grafik Target vs Aktual (tanpa logika sampling).
// Lifecycle echarts (init/update/dispose + ResizeObserver) dimiliki panel ini;
// page.tsx hanya memasok snapshots dan kunci sensor failure terpilih.
"use client";

import { useEffect, useRef } from "react";
import * as echarts from "echarts";
import { NOISE_SENSORS } from "../sensors";
import type { SimSnapshot } from "../types";

export interface LiveTrendPanelProps {
  sensorKeys: string[];
  snapshots: SimSnapshot[];
}

export default function LiveTrendPanel({ sensorKeys, snapshots }: LiveTrendPanelProps) {
  const chartsInstRef = useRef<Record<string, echarts.ECharts>>({});
  const resizeObsRef = useRef<ResizeObserver | null>(null);

  useEffect(() => {
    const handleResize = () => {
      Object.values(chartsInstRef.current).forEach(inst => inst.resize());
    };
    window.addEventListener("resize", handleResize);
    // Panel chart bisa berubah ukuran tanpa window resize (ganti failure,
    // buka/tutup details, reflow grid): amati tiap container chart.
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const key = (entry.target as HTMLElement).dataset.chartKey;
        const inst = key ? chartsInstRef.current[key] : undefined;
        if (inst && !inst.isDisposed()) inst.resize();
      }
    });
    resizeObsRef.current = ro;
    return () => {
      window.removeEventListener("resize", handleResize);
      ro.disconnect();
      resizeObsRef.current = null;
      Object.values(chartsInstRef.current).forEach(inst => inst.dispose());
      chartsInstRef.current = {};
    };
  }, []);

  // Multi-chart: Target vs Aktual untuk semua sensor relevan failure.
  // Dispose instance failure lama agar tidak ada chart hantu saat ganti failure.
  useEffect(() => {
    const active: Set<string> = new Set<string>(sensorKeys);
    for (const key of Object.keys(chartsInstRef.current)) {
      if (!active.has(key)) {
        const staleEl = document.getElementById(`chart-${key}`);
        if (staleEl) resizeObsRef.current?.unobserve(staleEl);
        chartsInstRef.current[key].dispose();
        delete chartsInstRef.current[key];
      }
    }
    sensorKeys.forEach(key => {
      const el = document.getElementById(`chart-${key}`);
      if (!el) return;
      resizeObsRef.current?.observe(el);

      if (!chartsInstRef.current[key]) {
        chartsInstRef.current[key] = echarts.init(el);
      }
      const inst = chartsInstRef.current[key];
      const sig = NOISE_SENSORS.find((s) => s.key === key);
      const xs = snapshots.map((s) => `#${s.seq}`);
      const tgt = snapshots.map((s) => s.targets[key] ?? null);
      const act = snapshots.map((s) => s.actuals[key] ?? null);

      inst.setOption({
        animation: false,
        grid: { left: 44, right: 12, top: 20, bottom: 28 },
        tooltip: { trigger: "axis" },
        xAxis: { type: "category", data: xs },
        yAxis: { type: "value", scale: true },
        series: [
          { name: `Target${sig ? ` (${sig.unit})` : ""}`, type: "line", data: tgt, lineStyle: { type: "dashed", color: "#9ca3af" }, itemStyle: { color: "#9ca3af" }, symbol: "none" },
          { name: "Aktual", type: "line", data: act, lineStyle: { color: "#2563eb" }, itemStyle: { color: "#2563eb" }, symbol: "circle", symbolSize: 5 },
        ],
      }, true);
    });
  }, [snapshots, sensorKeys]);

  return (
    <div className="sim-panel">
      <h2 style={{ marginTop: 0 }}>Live Trend — Target vs Aktual</h2>
      <div className="sim-charts">
        {sensorKeys.map(key => {
          const sig = NOISE_SENSORS.find(s => s.key === key);
          return (
            <div key={key} data-testid={`sim-chart-${key}`} style={{ background: "#f9fafb", padding: "0.75rem", borderRadius: "8px", border: "1px solid #e5e7eb", minWidth: 0 }}>
              <div style={{ fontSize: "0.8rem", fontWeight: 600, marginBottom: "0.5rem", display: "flex", justifyContent: "space-between" }}>
                <span>{sig?.label || key}</span>
                <span style={{ color: "#6b7280" }}>{sig?.unit || ""}</span>
              </div>
              <div id={`chart-${key}`} data-chart-key={key} style={{ width: "100%", height: "160px" }} />
            </div>
          );
        })}
      </div>
      {snapshots.length === 0 && (
        <p style={{
          color: "#9ca3af", fontSize: "0.9rem",
          fontStyle: "italic", margin: "0.75rem 0 0"
        }}>
          Grafik tampil setelah Start
        </p>
      )}
    </div>
  );
}
