// Panel Sensor Controls — presentasi saja (tanpa logika sampling/engine).
// Seluruh state dan handler dimiliki page.tsx dan diteruskan via props.
"use client";

import { clip } from "../variation";
import {
  FAILURE_MAP,
  FAILURE_OPTIONS,
  type FailureType,
} from "../failure-signals";
import type { ManualField, SimSensor } from "../sensors";

export interface SensorControlsPanelProps {
  running: boolean;
  selectedFailure: FailureType;
  onSelectFailure: (f: FailureType) => void;
  primarySensors: SimSensor[];
  secondarySensors: SimSensor[];
  manualSensors: ManualField[];
  targets: Record<string, number>;
  amps: Record<string, number>;
  enabled: Record<string, boolean>;
  manuals: Record<string, string>;
  lastActuals: Record<string, number | null> | null;
  onToggleEnabled: (key: string, v: boolean) => void;
  onTargetChange: (key: string, v: number) => void;
  onAmpChange: (key: string, v: number) => void;
  onManualChange: (key: string, v: string) => void;
}

function fmt(value: number | null, decimals: number): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return value.toFixed(decimals);
}

export default function SensorControlsPanel(props: SensorControlsPanelProps) {
  const {
    running, selectedFailure, onSelectFailure,
    primarySensors, secondarySensors, manualSensors,
    targets, amps, enabled, manuals, lastActuals,
    onToggleEnabled, onTargetChange, onAmpChange, onManualChange,
  } = props;

  const renderNoiseRow = (s: SimSensor) => {
    return (
      <div key={s.key} className="sim-row">
        <label className="sim-enable">
          <input
            type="checkbox"
            aria-label={`Aktif ${s.label}`}
            checked={!!enabled[s.key]}
            disabled={!running}
            onChange={(e) => onToggleEnabled(s.key, e.target.checked)}
          />
        </label>
        <div className="sim-row-main">
          <div className="sim-label-group">
            <span className="sim-label">{s.label}</span>
            <span className="sim-unit">({s.unit})</span>
          </div>
          <div className="sim-control-group">
            <input
              type="range"
              aria-label={`Target ${s.label}`}
              min={s.min}
              max={s.max}
              step={s.step}
              value={targets[s.key] ?? s.min}
              disabled={!running || !enabled[s.key]}
              onChange={(e) => onTargetChange(s.key, Number(e.target.value))}
              className="sim-slider"
            />
            <input
              type="number"
              aria-label={`Angka ${s.label}`}
              min={s.min}
              max={s.max}
              step={s.step}
              title={`Rentang ${s.min}–${s.max} ${s.unit}`}
              value={targets[s.key] ?? ""}
              disabled={!running || !enabled[s.key]}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (Number.isFinite(v)) onTargetChange(s.key, clip(v, s.min, s.max));
              }}
              className="sim-number"
            />
          </div>
        </div>
        <input
          type="number"
          aria-label={`Amplitudo ${s.label}`}
          min={0}
          max={s.ampMax}
          step="any"
          title={`Amplitudo noise 0–${s.ampMax}${s.ampUnit} (dibatasi ${s.ampMax}${s.ampUnit})`}
          placeholder="±0"
          value={amps[s.key] ?? 0}
          disabled={!running || !enabled[s.key]}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (Number.isFinite(v)) onAmpChange(s.key, clip(v, 0, s.ampMax));
          }}
          className="sim-amp"
        />
        <span data-testid={`actual-${s.key}`} className="sim-actual">
          {lastActuals ? fmt(lastActuals[s.key] ?? null, s.decimals) : "—"} {s.unit}
        </span>
      </div>
    );
  };

  return (
    <div className="sim-panel">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem", gap: "1rem", flexWrap: "wrap" }}>
        <h2 style={{ margin: 0 }}>Sensor Controls — {FAILURE_MAP[selectedFailure].label} · <span data-testid="sim-primary-count">{primarySensors.length} sensor</span> {running ? "" : "(aktif setelah Start)"}</h2>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <label style={{ fontSize: "0.8rem", fontWeight: 600 }}>Monitoring</label>
          <select
            aria-label="Failure Monitoring"
            data-testid="sim-failure-select"
            value={selectedFailure}
            onChange={(e) => onSelectFailure(e.target.value as FailureType)}
            style={{ padding: "0.4rem", borderRadius: "8px", border: "1px solid #d1d5db", fontSize: "0.85rem" }}
          >
            {FAILURE_OPTIONS.map(opt => (
              <option key={opt.id} value={opt.id}>{opt.label}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="sim-grid">
        {primarySensors.map(renderNoiseRow)}
      </div>
      <details className="sim-details">
        <summary>+ {secondarySensors.length} sensor lainnya</summary>
        <div className="sim-grid sim-scroll" style={{ marginTop: "0.5rem" }}>
          {secondarySensors.map(renderNoiseRow)}
        </div>
      </details>
      <details className="sim-details">
        <summary>Pengaturan lanjutan (field manual)</summary>
        <div className="sim-grid sim-scroll" style={{ marginTop: "0.5rem" }}>
          {manualSensors.map((m) => (
            <div key={m.key} className="sim-row">
              <label className="sim-enable">
                <input
                  type="checkbox"
                  aria-label={`Aktif ${m.label}`}
                  checked={!!enabled[m.key]}
                  disabled={!running}
                  onChange={(e) => onToggleEnabled(m.key, e.target.checked)}
                />
              </label>
              <span className="sim-label">{m.label} <small>({m.unit}{m.accumulate ? ", akumulatif" : ""})</small></span>
              <span />
              <input
                type="number"
                aria-label={`Angka ${m.label}`}
                step={m.step}
                placeholder="null"
                value={manuals[m.key] ?? ""}
                disabled={!running || !enabled[m.key]}
                onChange={(e) => onManualChange(m.key, e.target.value)}
                className="sim-number"
              />
              <span />
              <span data-testid={`actual-${m.key}`} className="sim-actual">
                {lastActuals ? fmt(lastActuals[m.key] ?? null, 1) : "—"}
              </span>
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}
