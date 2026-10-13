// 5R Simulasi Sensor — Automatic Variation + engine klasifikasi aktual.
// Slider = TARGET sensor; engine menilai NILAI AKTUAL sintetis (target + noise).
// Tanpa rumus diagnosis baru: semua vonis dari POST /v1/classify.
//
// Tanggung jawab file ini: session lifecycle + sampling clock + state.
// Presentasi dipecah ke components/ (SensorControlsPanel, LiveTrendPanel,
// ClassificationPanel, MathematicalEvidence). Formatter evidence di
// evidence-format.ts. Tidak ada logika diagnosis di lapisan UI.
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  classifyWindow,
  getTierRefs,
  type TierRefs,
  type V1Reading,
} from "../api";
import { FAILURE_COLORS } from "../lib/replay/constants";
import {
  MANUAL_FIELDS,
  NOISE_SENSORS,
  defaultAmps,
  defaultTargets,
} from "./sensors";
import {
  RESPONSE_ALPHA,
  SensorNoise,
  clip,
  mulberry32,
  type ResponseMode,
} from "./variation";
import { FAILURE_MAP, type FailureType } from "./failure-signals";
import { buildFocusedEvidence } from "./evidence-format";
import MathematicalEvidence from "./components/MathematicalEvidence";
import SensorControlsPanel from "./components/SensorControlsPanel";
import LiveTrendPanel from "./components/LiveTrendPanel";
import ClassificationPanel from "./components/ClassificationPanel";
import type { SimResult, SimSnapshot } from "./types";

type Phase = "idle" | "running" | "stopped";

const TICK_MS = 2000;
const MAX_BUFFER = 40;
const MAX_HISTORY = 60;

const PROFILES = ["500_lps", "3000_lps", "5000_lps"] as const;
const MODES: ResponseMode[] = ["halus", "normal", "cepat"];

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
  // E2: referensi efektif runtime (/tier-refs). Null => fallback Jalur A
  // (threshold FALSE tetap "—"). Fetch gagal tidak boleh mematikan simulasi.
  const [tierRefs, setTierRefs] = useState<TierRefs | null>(null);

  const phaseRef = useRef<Phase>("idle");
  const sessionRef = useRef<string>("");
  const seqRef = useRef(0);
  const bufferRef = useRef<V1Reading[]>([]);
  const noiseRef = useRef<Record<string, SensorNoise>>({});
  const randRef = useRef<() => number>(Math.random);
  const hoursBaseRef = useRef(0);
  const inFlightRef = useRef(false);
  const timerRef = useRef<number | null>(null);


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
        ruleEvaluations: res.classification.rule_evaluations ?? [],
        reading,
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

  useEffect(() => {
    let cancelled = false;
    getTierRefs()
      .then((refs) => { if (!cancelled) setTierRefs(refs); })
      .catch(() => { /* refs opsional: formatter fallback ke Jalur A */ });
    return () => {
      cancelled = true;
      stopTimer();
    };
  }, []);


  const lastSnap = snapshots.length ? snapshots[snapshots.length - 1] : null;
  const trouble = result?.classification.trouble_type ?? "—";
  const troubleColor = (FAILURE_COLORS as Record<string, string>)[trouble] ?? "#6b7280";

  // F8.5 — Evidence fokus dibaca dari paket atomik (ruleEvaluations + reading
  // seq yang sama dengan grafik & KPI). Ganti failure hanya memilih fokus lain
  // dari hasil tersimpan; tidak memicu fetch, tidak mereset state.
  const focusedView = useMemo(() => {
    if (!result) return null;
    return buildFocusedEvidence({
      failureType: selectedFailure,
      ruleEvaluations: result.ruleEvaluations,
      snapshot: result.classification.sensor_snapshot ?? {},
      lastReading: result.reading as unknown as Record<string, number | null>,
      limitations: result.classification.limitations ?? [],
      sampleSeq: result.seq,
      timestamp: result.reading.timestamp,
      rulesVersion: result.rules,
      evaluationStatus: result.classification.evaluation_status,
      globalTrouble: result.classification.trouble_type,
      refs: tierRefs,
      profileId,
    });
  }, [result, selectedFailure, tierRefs, profileId]);

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
          <SensorControlsPanel
            running={running}
            selectedFailure={selectedFailure}
            onSelectFailure={(f) => setSelectedFailure(f)}
            primarySensors={PRIMARY_SENSORS}
            secondarySensors={SECONDARY_SENSORS}
            manualSensors={MANUAL_SENSORS}
            targets={targets}
            amps={amps}
            enabled={enabled}
            manuals={manuals}
            lastActuals={lastSnap ? lastSnap.actuals : null}
            onToggleEnabled={(key, v) => setEnabled((prev) => ({ ...prev, [key]: v }))}
            onTargetChange={(key, v) => setTargets((prev) => ({ ...prev, [key]: v }))}
            onAmpChange={(key, v) => setAmps((prev) => ({ ...prev, [key]: v }))}
            onManualChange={(key, v) => setManuals((prev) => ({ ...prev, [key]: v }))}
          />

          <div style={{ display: "grid", gap: "1rem", alignContent: "start" }}>
            <LiveTrendPanel sensorKeys={failureSensors} snapshots={snapshots} />
            <ClassificationPanel result={result} selectedFailure={selectedFailure} />
          </div>
        </div>

        <section className="sim-panel sim-math-full" data-testid="sim-math-full">
              <h2 style={{ marginTop: 0 }}>Mathematical Evidence</h2>
              {!focusedView && <p>Belum ada hasil klasifikasi. Panel perhitungan failure yang dimonitoring tampil di sini setelah Start, mengikuti sampel yang sama dengan grafik dan KPI.</p>}
              {focusedView && <MathematicalEvidence view={focusedView} />}
        </section>
        </div>
    </main>
  );
}
