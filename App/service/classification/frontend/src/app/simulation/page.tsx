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
import { FAILURE_MAP, FAILURE_OPTIONS, type FailureType } from "./failure-signals";

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
  // Total sampel sesi — snapshots dibatasi MAX_HISTORY untuk grafik,
  // sedangkan KPI harus terus menghitung selama sesi berjalan.
  const [sampleCount, setSampleCount] = useState(0);
  const [result, setResult] = useState<SimResult | null>(null);
  const [error, setError] = useState("");
  const [selectedFailure, setSelectedFailure] = useState<FailureType>("dry_run");

  const phaseRef = useRef<Phase>("idle");
  const sessionRef = useRef<string>("");
  const seqRef = useRef(0);
  const bufferRef = useRef<V1Reading[]>([]);
  const noiseRef = useRef<Record<string, SensorNoise>>({});
  const randRef = useRef<() => number>(Math.random);
  const hoursBaseRef = useRef(0);
  const inFlightRef = useRef(false);
  const timerRef = useRef<number | null>(null);
  const chartsInstRef = useRef<Record<string, echarts.ECharts>>({});
  const resizeObsRef = useRef<ResizeObserver | null>(null);


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
        // String kosong = data belum tersedia → null, bukan 0.
        // Number("") === 0 akan mengubah field kosong menjadi angka valid.
        const raw = (man[m.key] ?? "").trim();
        if (raw === "") {
          actuals[m.key] = null;
          tgs[m.key] = null;
          continue;
        }
        const base = Number(raw);
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
      setSampleCount((c) => c + 1);
      setError("");
    } catch (err) {
      if (sessionRef.current !== session || seqRef.current !== seq) return;
      if (phaseRef.current !== "running") return;
      setError(err instanceof Error ? err.message : "Klasifikasi gagal.");
    } finally {
      // Hanya request pemilik sesi aktif yang boleh membebaskan inFlight.
      // Respons basi dari sesi lama (mis. Stop → Start cepat) tidak boleh
      // membuka slot request sesi baru sehingga tercipta request paralel.
      if (sessionRef.current === session) inFlightRef.current = false;
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
    setSampleCount(0);
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
    setSampleCount(0);
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

  // 5R Dashboard: Sensor utama mengikuti failure yang dipilih.
  const failureSensors = FAILURE_MAP[selectedFailure].sensors;
  const PRIMARY_KEYS = failureSensors;
  const PRIMARY_SENSORS = NOISE_SENSORS.filter((s) => PRIMARY_KEYS.includes(s.key));
  const SECONDARY_SENSORS = NOISE_SENSORS.filter((s) => !PRIMARY_KEYS.includes(s.key));
  const MANUAL_SENSORS = MANUAL_FIELDS;

  const renderNoiseRow = (s: SimSensor) => {
    return (
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
          </div>
        </div>
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
  };

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
      stopTimer();
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
    const sensors = FAILURE_MAP[selectedFailure].sensors;
    const active: Set<string> = new Set<string>(sensors);
    for (const key of Object.keys(chartsInstRef.current)) {
      if (!active.has(key)) {
        const staleEl = document.getElementById(`chart-${key}`);
        if (staleEl) resizeObsRef.current?.unobserve(staleEl);
        chartsInstRef.current[key].dispose();
        delete chartsInstRef.current[key];
      }
    }
    sensors.forEach(key => {
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
  }, [snapshots, selectedFailure]);

  const lastSnap = snapshots.length ? snapshots[snapshots.length - 1] : null;
  const trouble = result?.classification.trouble_type ?? "—";
  const troubleColor = (FAILURE_COLORS as Record<string, string>)[trouble] ?? "#6b7280";
  // Monitoring = filter tampilan, bukan injeksi diagnosis: bandingkan langsung
  // trouble_type kanonis, bukan via label. Semua matched_rules tetap ditampilkan.
  // Classifier bisa cocok beberapa gangguan sekaligus (trouble_type hanya salah
  // satunya), jadi badge menilai keberadaan failure di matched_rules.
  const isMonitoringMatch =
    !!result &&
    result.classification.matched_rules.some((r) => r.trouble_type === selectedFailure);
  const orderedRules = result
    ? [
        ...result.classification.matched_rules.filter((r) => r.trouble_type === selectedFailure),
        ...result.classification.matched_rules.filter((r) => r.trouble_type !== selectedFailure),
      ]
    : [];

  return (
    <main>
      <div className="dashboard">
        <header style={{ display: "flex", alignItems: "baseline", gap: "0.6rem", flexWrap: "wrap" }}>
          <h1 style={{ margin: 0, fontSize: "1.4rem" }}>Simulasi Sensor</h1>
          <span data-testid="sim-badge" className="sim-badge" title="Data sintetis — bukan telemetry aktual">
            SIMULATION
          </span>
          <span className="sim-chip">{profileId.replace("_lps", " LPS").toUpperCase()} · 2s sampling</span>
          <span className={`sim-chip sim-phase-${phase}`} data-testid="sim-phase">{phase}</span>
        </header>

        <div className="top-controls sim-toolbar">
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
          <details className="sim-details sim-settings">
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
            <p className="sim-sessionline">sesi {sessionShort} • seed {seed} • rules {result?.rules ?? "—"} • slider = target, engine menilai aktual</p>
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
            <div className="k-value" data-testid="sim-kpi-samples">{sampleCount}</div>
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
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem", gap: "1rem", flexWrap: "wrap" }}>
                <h2 style={{ margin: 0 }}>Sensor Controls — {FAILURE_MAP[selectedFailure].label} · <span data-testid="sim-primary-count">{PRIMARY_SENSORS.length} sensor</span> {running ? "" : "(aktif setelah Start)"}</h2>
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <label style={{ fontSize: "0.8rem", fontWeight: 600 }}>Monitoring</label>
                  <select 
                    aria-label="Failure Monitoring" 
                    data-testid="sim-failure-select"
                    value={selectedFailure} 
                    onChange={(e) => setSelectedFailure(e.target.value as FailureType)}
                    style={{ padding: "0.4rem", borderRadius: "8px", border: "1px solid #d1d5db", fontSize: "0.85rem" }}
                  >
                    {FAILURE_OPTIONS.map(opt => (
                      <option key={opt.id} value={opt.id}>{opt.label}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="sim-grid">
                {PRIMARY_SENSORS.map(renderNoiseRow)}
              </div>
              <details className="sim-details">
                <summary>+ {SECONDARY_SENSORS.length} sensor lainnya</summary>
                <div className="sim-grid" style={{ marginTop: "0.5rem" }}>
                  {SECONDARY_SENSORS.map(renderNoiseRow)}
                </div>
              </details>
              <details className="sim-details">
                <summary>Pengaturan lanjutan (field manual)</summary>
                <div className="sim-grid" style={{ marginTop: "0.5rem" }}>
                  {MANUAL_SENSORS.map((m) => (
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
              <div style={{ 
                display: "grid", 
                gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", 
                gap: "1rem", 
                marginTop: "1rem" 
              }}>
                {FAILURE_MAP[selectedFailure].sensors.map(key => {
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
            <div className="sim-panel" data-testid="sim-result">
              <h2 style={{ marginTop: 0 }}>Classification &amp; Evidence</h2>
              <p style={{ fontSize: "0.78rem", color: "#6b7280", margin: "0 0 0.5rem" }}>
                Monitoring = filter tampilan, bukan injeksi diagnosis. Engine menilai semua gangguan.
              </p>
               {!result && <p>Belum ada hasil klasifikasi. Ketika simulasi berjalan, gangguan yang cocok dan ringkasan penyebabnya tampil di sini.</p>}
               {result && (
                 <div>
                   <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.5rem" }}>
                     <span data-testid="sim-trouble" className="sim-trouble" style={{ background: troubleColor }}>
                       {trouble}
                     </span>{" "}
                     <span data-testid="sim-seq" style={{ fontSize: "0.78rem", color: "#6b7280" }}>
                       (sampel #{result.seq})
                     </span>
                      {isMonitoringMatch && (
                        <span data-testid="sim-match-badge" style={{ fontSize: "0.7rem", background: "#dcfce7", color: "#166534", padding: "0.1rem 0.4rem", borderRadius: "4px", fontWeight: 600, border: "1px solid #bbf7d0" }}>
                          ✓ Cocok dengan Monitoring
                        </span>
                      )}
                   </div>
                    <details className="sim-details" style={{ marginTop: "0.5rem" }}>
                      <summary>
                        Detail evidence ({result.classification.matched_rules.length} kondisi cocok
                        {result.classification.limitations.length ? `, ${result.classification.limitations.length} keterbatasan` : ""})
                      </summary>
                      {orderedRules.length > 0 && (
                        <ul data-testid="sim-matched-list">
                          {orderedRules.map((r) => (
                            <li key={r.trouble_type} style={r.trouble_type === selectedFailure ? { borderLeft: "3px solid #2563eb", paddingLeft: "0.5rem" } : undefined}>
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
                        <div data-testid="sim-limitations">
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
