// 5R Simulasi Sensor — Automatic Variation + engine klasifikasi aktual.
// Slider = TARGET sensor; engine menilai NILAI AKTUAL sintetis (target + noise).
// Tanpa rumus diagnosis baru: semua vonis dari POST /v1/classify.
"use client";

import { useEffect, useRef, useState } from "react";
import * as echarts from "echarts";
import {
  classifyWindow,
  type V1Classification,
  type V1Reading,
} from "../api";
import { FAILURE_COLORS } from "../lib/replay/constants";
import {
  MANUAL_FIELDS,
  NOISE_SENSORS,
  ampOptions,
  defaultAmps,
  defaultTargets,
  type SimSensor,
} from "./sensors";
import {
  RESPONSE_ALPHA,
  SensorNoise,
  clip,
  mulberry32,
  type ResponseMode,
} from "./variation";

type Phase = "idle" | "running" | "stopped";

const TICK_MS = 2000;
const MAX_BUFFER = 40;
const MAX_HISTORY = 60;

const PROFILES = ["500_lps", "3000_lps", "5000_lps"] as const;
const MODES: ResponseMode[] = ["halus", "normal", "cepat"];

type SimSnapshot = {
  seq: number;
  time: string;
  trouble: string;
  actuals: Record<string, number | null>;
  targets: Record<string, number | null>;
};

type SimResult = {
  seq: number;
  classification: V1Classification;
  evidence: number;
  rules: string;
};

function newSessionId(): string {
  try {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
      return `sim-${crypto.randomUUID().slice(0, 8)}`;
    }
  } catch {
    // abaikan, fallback di bawah
  }
  return `sim-${Date.now().toString(36)}`;
}

function fmt(value: number | null, decimals: number): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return value.toFixed(decimals);
}

export default function SimulationPage() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [profileId, setProfileId] = useState<string>("5000_lps");
  const [classSetpoint, setClassSetpoint] = useState<string>("");
  const [seed, setSeed] = useState<number>(7);
  const [mode, setMode] = useState<ResponseMode>("normal");

  const [targets, setTargets] = useState<Record<string, number>>(() =>
    defaultTargets("5000_lps"),
  );
  const [amps, setAmps] = useState<Record<string, number>>(defaultAmps);
  const [enabled, setEnabled] = useState<Record<string, boolean>>(() => {
    const out: Record<string, boolean> = {};
    for (const s of NOISE_SENSORS) out[s.key] = true;
    for (const m of MANUAL_FIELDS) out[m.key] = false;
    return out;
  });
  const [manuals, setManuals] = useState<Record<string, string>>({});

  const [snapshots, setSnapshots] = useState<SimSnapshot[]>([]);
  const [result, setResult] = useState<SimResult | null>(null);
  const [error, setError] = useState("");
  const [chartSignal, setChartSignal] = useState<string>("input_voltage");

  const phaseRef = useRef<Phase>("idle");
  const sessionRef = useRef<string>("");
  const seqRef = useRef(0);
  const bufferRef = useRef<V1Reading[]>([]);
  const noiseRef = useRef<Record<string, SensorNoise>>({});
  const randRef = useRef<() => number>(Math.random);
  const hoursBaseRef = useRef(0);
  const inFlightRef = useRef(false);
  const timerRef = useRef<number | null>(null);
  const chartRef = useRef<HTMLDivElement | null>(null);
  const chartInstRef = useRef<echarts.ECharts | null>(null);

  // 5R Stale-closure: interval clock memegang sendTick render pertama.
  // Semua input mutabel dibaca via ref agar tick selalu pakai nilai terbaru.
  const liveRef = useRef({ targets, amps, enabled, manuals, classSetpoint, profileId });
  liveRef.current = { targets, amps, enabled, manuals, classSetpoint, profileId };

  const running = phase === "running";
  const sessionShort = sessionRef.current || "—";

  function setPhaseBoth(p: Phase) {
    phaseRef.current = p;
    setPhase(p);
  }

  function stopTimer() {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }

  function buildSnapshot(): V1Reading & { __targets: Record<string, number | null> } {
    const now = new Date().toISOString();
    const { targets: tg, amps: am, enabled: en, manuals: man } = liveRef.current;
    const actuals: Record<string, number | null> = {};
    const tgs: Record<string, number | null> = {};
    const rand = randRef.current;
    for (const s of NOISE_SENSORS) {
      if (!en[s.key]) {
        actuals[s.key] = null;
        tgs[s.key] = null;
        continue;
      }
      const target = tg[s.key] ?? 0;
      const ampSel = am[s.key] ?? 0;
      const amp = s.noise === "pct" ? (target * ampSel) / 100 : ampSel;
      const noise = noiseRef.current[s.key];
      const eps = noise ? noise.next(rand, amp) : 0;
      actuals[s.key] = clip(target + eps, s.min, s.max);
      tgs[s.key] = target;
    }
    for (const m of MANUAL_FIELDS) {
      if (!en[m.key]) {
        actuals[m.key] = null;
        tgs[m.key] = null;
        continue;
      }
      if (m.accumulate) {
        const base = Number(man[m.key]);
        const start = Number.isFinite(base) ? base : 0;
        const val = start + (hoursBaseRef.current * TICK_MS) / 3600000;
        actuals[m.key] = val;
        tgs[m.key] = start;
        continue;
      }
      const raw = (man[m.key] ?? "").trim();
      const val = raw === "" ? null : Number(raw);
      actuals[m.key] = val !== null && Number.isFinite(val) ? clip(val, m.min, m.max) : null;
      tgs[m.key] = actuals[m.key];
    }
    return { timestamp: now, ...(actuals as Omit<V1Reading, "timestamp">), __targets: tgs } as V1Reading & {
      __targets: Record<string, number | null>;
    };
  }

  async function sendTick() {
    if (inFlightRef.current) return; // jangan paralel per sesi
    const session = sessionRef.current;
    if (!session) return;
    const { classSetpoint: csp, profileId: pid } = liveRef.current;
    let setpoint: number | null = null;
    if (csp.trim() !== "") {
      const v = Number(csp);
      if (!Number.isFinite(v)) {
        setError("Setpoint klasifikasi harus berupa angka.");
        return;
      }
      setpoint = v;
    }
    const seq = seqRef.current + 1;
    seqRef.current = seq;
    const snap = buildSnapshot();
    const { __targets, ...reading } = snap;
    bufferRef.current = [...bufferRef.current, reading].slice(-MAX_BUFFER);
    const window = [...bufferRef.current];
    inFlightRef.current = true;
    try {
      const res = await classifyWindow(pid, setpoint, session, window);
      // Guard basi: hanya sesi + sampel terbaru yang boleh tampil.
      if (sessionRef.current !== session || seqRef.current !== seq) return;
      if (phaseRef.current !== "running") return;
      setResult({
        seq,
        classification: res.classification,
        evidence: res.evidence_size,
        rules: res.rules_version,
      });
      const actuals: Record<string, number | null> = {};
      for (const s of NOISE_SENSORS) actuals[s.key] = (reading[s.key as keyof V1Reading] as number | null) ?? null;
      setSnapshots((prev) =>
        [...prev, { seq, time: reading.timestamp, trouble: res.classification.trouble_type, actuals, targets: __targets }].slice(-MAX_HISTORY),
      );
      setError("");
    } catch (err) {
      if (sessionRef.current !== session || seqRef.current !== seq) return;
      if (phaseRef.current !== "running") return;
      setError(err instanceof Error ? err.message : "Klasifikasi gagal.");
    } finally {
      inFlightRef.current = false;
    }
  }

  function handleStart() {
    if (phaseRef.current === "running") return;
    stopTimer();
    sessionRef.current = newSessionId();
    seqRef.current = 0;
    bufferRef.current = [];
    hoursBaseRef.current = 0;
    inFlightRef.current = false;
    const alpha = RESPONSE_ALPHA[mode];
    const map: Record<string, SensorNoise> = {};
    for (const s of NOISE_SENSORS) map[s.key] = new SensorNoise(alpha);
    noiseRef.current = map;
    randRef.current = mulberry32(Number.isFinite(seed) ? seed : 7);
    setSnapshots([]);
    setResult(null);
    setError("");
    setPhaseBoth("running");
    void sendTick();
    timerRef.current = window.setInterval(() => {
      if (phaseRef.current !== "running") return;
      hoursBaseRef.current += 1;
      void sendTick();
    }, TICK_MS);
  }

  function handleStop() {
    stopTimer();
    setPhaseBoth("stopped"); // respons telat diabaikan via guard
  }

  function doReset(nextProfile: string) {
    stopTimer();
    inFlightRef.current = false;
    sessionRef.current = "";
    seqRef.current = 0;
    bufferRef.current = [];
    hoursBaseRef.current = 0;
    setProfileId(nextProfile);
    setTargets(defaultTargets(nextProfile));
    setAmps(defaultAmps());
    setSnapshots([]);
    setResult(null);
    setError("");
    setPhaseBoth("idle");
  }

  function handleProfileChange(next: string) {
    if (next === profileId && phaseRef.current === "idle") return;
    doReset(next);
  }

  function handleModeChange(next: ResponseMode) {
    setMode(next);
    const alpha = RESPONSE_ALPHA[next];
    for (const key of Object.keys(noiseRef.current)) {
      noiseRef.current[key].setAlpha(alpha);
    }
  }

  // 5R Dashboard: 4 sensor primer selalu terlihat, sisanya progressive disclosure.
  const PRIMARY_KEYS = ["input_voltage", "motor_current", "output_frequency", "motor_torque"];

  const renderNoiseRow = (s: SimSensor) => (
    <div key={s.key} className="sim-row">
      <label className="sim-enable">
        <input
          type="checkbox"
          aria-label={`Aktif ${s.label}`}
          checked={!!enabled[s.key]}
          disabled={!running}
          onChange={(e) => setEnabled((prev) => ({ ...prev, [s.key]: e.target.checked }))}
        />
      </label>
      <span className="sim-label">{s.label} <small>({s.unit})</small></span>
      <input
        type="range"
        aria-label={`Target ${s.label}`}
        min={s.min}
        max={s.max}
        step={s.step}
        value={targets[s.key] ?? s.min}
        disabled={!running || !enabled[s.key]}
        onChange={(e) => setTargets((prev) => ({ ...prev, [s.key]: Number(e.target.value) }))}
        className="sim-slider"
      />
      <input
        type="number"
        aria-label={`Angka ${s.label}`}
        step={s.step}
        value={targets[s.key] ?? ""}
        disabled={!running || !enabled[s.key]}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (Number.isFinite(v)) setTargets((prev) => ({ ...prev, [s.key]: v }));
        }}
        className="sim-number"
      />
      <select
        aria-label={`Amplitudo ${s.label}`}
        value={amps[s.key] ?? 0}
        disabled={!running || !enabled[s.key]}
        onChange={(e) => setAmps((prev) => ({ ...prev, [s.key]: Number(e.target.value) }))}
        className="sim-amp"
      >
        {ampOptions(s).map((a) => (
          <option key={a} value={a}>{a === 0 ? "noise 0" : `±${a}${s.ampUnit}`}</option>
        ))}
      </select>
      <span data-testid={`actual-${s.key}`} className="sim-actual">
        {lastSnap ? fmt(lastSnap.actuals[s.key] ?? null, s.decimals) : "—"} {s.unit}
      </span>
    </div>
  );

  useEffect(() => {
    return () => {
      stopTimer();
      chartInstRef.current?.dispose();
      chartInstRef.current = null;
    };
  }, []);

  // Grafik target vs aktual sinyal terpilih.
  useEffect(() => {
    if (!chartRef.current) return;
    if (!chartInstRef.current) {
      chartInstRef.current = echarts.init(chartRef.current);
    }
    const inst = chartInstRef.current;
    const xs = snapshots.map((s) => `#${s.seq}`);
    const sig = NOISE_SENSORS.find((s) => s.key === chartSignal);
    const tgt = snapshots.map((s) => s.targets[chartSignal] ?? null);
    const act = snapshots.map((s) => s.actuals[chartSignal] ?? null);
    inst.setOption(
      {
        animation: false,
        grid: { left: 44, right: 12, top: 12, bottom: 28 },
        tooltip: { trigger: "axis" },
        xAxis: { type: "category", data: xs },
        yAxis: { type: "value", scale: true },
        series: [
          { name: `Target${sig ? ` (${sig.unit})` : ""}`, type: "line", data: tgt, lineStyle: { type: "dashed", color: "#9ca3af" }, itemStyle: { color: "#9ca3af" }, symbol: "none" },
          { name: "Aktual", type: "line", data: act, lineStyle: { color: "#2563eb" }, itemStyle: { color: "#2563eb" }, symbol: "circle", symbolSize: 5 },
        ],
      },
      true,
    );
    const onResize = () => inst.resize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [snapshots, chartSignal]);

  const lastSnap = snapshots.length ? snapshots[snapshots.length - 1] : null;
  const trouble = result?.classification.trouble_type ?? "—";
  const troubleColor = (FAILURE_COLORS as Record<string, string>)[trouble] ?? "#6b7280";

  return (
    <main>
      <div className="dashboard">
        <header style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
          <h1 style={{ margin: 0 }}>Simulasi Sensor</h1>
          <span data-testid="sim-badge" className="sim-badge" title="Data sintetis — bukan telemetry aktual">
            SIMULATION
          </span>
          <span className="sim-chip">{profileId.replace("_lps", " LPS").toUpperCase()}</span>
          <span className="sim-chip">2s sampling</span>
          <span className={`sim-chip sim-phase-${phase}`} data-testid="sim-phase">{phase}</span>
          <span style={{ fontSize: "0.75rem", color: "#6b7280" }}>
            sesi {sessionShort} • seed {seed} • rules {result?.rules ?? "—"}
          </span>
        </header>
        <p style={{ fontSize: "0.85rem", color: "#374151", maxWidth: "70ch" }}>
          Slider mengatur <strong>target</strong> sensor; engine menilai <strong>nilai aktual</strong> sintetis
          (target + noise terbatas). Semua vonis dari engine klasifikasi aktual via <code>/v1/classify</code>.
        </p>

        <div className="top-controls">
          <div className="top-controls-row">
            {!running ? (
              <button type="button" className="primary" onClick={handleStart}>
                {phase === "stopped" ? "Start Ulang" : "Start Simulation"}
              </button>
            ) : (
              <button type="button" onClick={handleStop}>
                Stop
              </button>
            )}
            <button type="button" disabled={running} onClick={() => doReset(profileId)}>
              Reset
            </button>
          </div>
          <details className="sim-details">
            <summary>Simulation Settings</summary>
            <div className="top-controls-row" style={{ marginTop: "0.5rem" }}>
              <label>
                Profil
                <select
                  aria-label="Profil pompa"
                  value={profileId}
                  disabled={running}
                  onChange={(e) => handleProfileChange(e.target.value)}
                >
                  {PROFILES.map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              </label>
              <label>
                Setpoint klasifikasi (Hz)
                <input
                  aria-label="Setpoint klasifikasi"
                  type="number"
                  step="0.1"
                  placeholder="bawaan profil"
                  value={classSetpoint}
                  onChange={(e) => setClassSetpoint(e.target.value)}
                  style={{ width: "120px" }}
                />
              </label>
              <label>
                Seed
                <input
                  aria-label="Random seed"
                  type="number"
                  value={Number.isFinite(seed) ? seed : 7}
                  disabled={running}
                  onChange={(e) => setSeed(Number(e.target.value))}
                  style={{ width: "90px" }}
                />
              </label>
              <label>
                Respons
                <select aria-label="Respons noise" value={mode} onChange={(e) => handleModeChange(e.target.value as ResponseMode)}>
                  {MODES.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </label>
            </div>
          </details>
        </div>

        <div className="sim-kpis">
          <div className="sim-kpi">
            <div className="k-label">Kondisi Pompa</div>
            <div className="k-value" data-testid="sim-kpi-trouble" style={{ color: trouble === "—" ? "#9ca3af" : troubleColor }}>
              {trouble}
            </div>
            <div className="k-sub">{result ? `sampel #${result.seq}` : "Belum dievaluasi"}</div>
          </div>
          <div className="sim-kpi">
            <div className="k-label">Sampel</div>
            <div className="k-value" data-testid="sim-kpi-samples">{snapshots.length}</div>
            <div className="k-sub">Interval 2 dtk</div>
          </div>
          <div className="sim-kpi">
            <div className="k-label">Gangguan</div>
            <div className="k-value" data-testid="sim-kpi-faults">
              {snapshots.filter((s) => s.trouble !== "normal").length}
            </div>
            <div className="k-sub">Non-normal sesi ini</div>
          </div>
        </div>

        {error && <p className="message" role="alert">{error}</p>}

        <div className="sim-dash">
          <div className="sim-panel">
            <h2 style={{ marginTop: 0 }}>Sensor Controls {running ? "" : "(aktif setelah Start)"}</h2>
            <div className="sim-grid">
              {NOISE_SENSORS.filter((s) => PRIMARY_KEYS.includes(s.key)).map(renderNoiseRow)}
            </div>
            <details className="sim-details">
              <summary>+ {NOISE_SENSORS.length - PRIMARY_KEYS.length} sensor lainnya</summary>
              <div className="sim-grid" style={{ marginTop: "0.5rem" }}>
                {NOISE_SENSORS.filter((s) => !PRIMARY_KEYS.includes(s.key)).map(renderNoiseRow)}
              </div>
            </details>
            <details className="sim-details">
              <summary>Pengaturan lanjutan (field manual)</summary>
              <div className="sim-grid" style={{ marginTop: "0.5rem" }}>
                {MANUAL_FIELDS.map((m) => (
                  <div key={m.key} className="sim-row">
                    <label className="sim-enable">
                      <input
                        type="checkbox"
                        aria-label={`Aktif ${m.label}`}
                        checked={!!enabled[m.key]}
                        disabled={!running}
                        onChange={(e) => setEnabled((prev) => ({ ...prev, [m.key]: e.target.checked }))}
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
                      onChange={(e) => setManuals((prev) => ({ ...prev, [m.key]: e.target.value }))}
                      className="sim-number"
                    />
                    <span />
                    <span data-testid={`actual-${m.key}`} className="sim-actual">
                      {lastSnap ? fmt(lastSnap.actuals[m.key] ?? null, 1) : "—"}
                    </span>
                  </div>
                ))}
              </div>
            </details>
          </div>

          <div style={{ display: "grid", gap: "1rem", alignContent: "start" }}>
            <div className="sim-panel">
              <h2 style={{ marginTop: 0 }}>Live Trend — Target vs Aktual</h2>
              <label>
                Sinyal
                <select aria-label="Sinyal monitor" value={chartSignal} onChange={(e) => setChartSignal(e.target.value)}>
                  {NOISE_SENSORS.map((s) => (
                    <option key={s.key} value={s.key}>{s.label}</option>
                  ))}
                </select>
              </label>
              <div ref={chartRef} data-testid="sim-chart" style={{ width: "100%", height: "260px", marginTop: "0.5rem" }} />
              {snapshots.length > 0 && (
                <div data-testid="sim-history" className="sim-history" aria-label="Riwayat gangguan">
                  {snapshots.slice(-12).map((s) => (
                    <span
                      key={s.seq}
                      title={`#${s.seq} ${s.trouble}`}
                      className="sim-hist"
                      style={{ background: (FAILURE_COLORS as Record<string, string>)[s.trouble] ?? "#e5e7eb" }}
                    >
                      #{s.seq}
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div className="sim-panel" data-testid="sim-result">
              <h2 style={{ marginTop: 0 }}>Classification &amp; Evidence</h2>
              {!result && <p>Belum ada hasil klasifikasi. Ketika simulasi berjalan, gangguan yang cocok dan ringkasan penyebabnya tampil di sini.</p>}
              {result && (
                <div>
                  <span data-testid="sim-trouble" className="sim-trouble" style={{ background: troubleColor }}>
                    {trouble}
                  </span>{" "}
                  <span data-testid="sim-seq" style={{ fontSize: "0.78rem", color: "#6b7280" }}>
                    (sampel #{result.seq})
                  </span>
                  <details className="sim-details" style={{ marginTop: "0.5rem" }}>
                    <summary>
                      Detail evidence ({result.classification.matched_rules.length} kondisi cocok
                      {result.classification.limitations.length ? `, ${result.classification.limitations.length} keterbatasan` : ""})
                    </summary>
                    {result.classification.matched_rules.length > 0 && (
                      <ul>
                        {result.classification.matched_rules.map((r) => (
                          <li key={r.trouble_type}>
                            <strong>{r.trouble_type}</strong>
                            <ul>
                              {r.matched_conditions.map((c) => (
                                <li key={c}><code>{c}</code></li>
                              ))}
                            </ul>
                          </li>
                        ))}
                      </ul>
                    )}
                    {result.classification.limitations.length > 0 && (
                      <div>
                        <strong>Keterbatasan:</strong>
                        <ul>
                          {result.classification.limitations.map((l) => (
                            <li key={l}><code>{l}</code></li>
                          ))}
                        </ul>
                      </div>
                    )}
                    <p style={{ fontSize: "0.78rem", color: "#6b7280" }}>
                      evidence {result.evidence} • rules {result.rules} • status {result.classification.evaluation_status}
                    </p>
                  </details>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
