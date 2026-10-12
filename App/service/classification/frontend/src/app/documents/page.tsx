"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  deleteDocument,
  getDocuments,
  getTelemetryReplay,
  getTierRefs,
  prepareTelemetry,
  scanClassification,
  uploadDocument,
  type ClassificationPipelineResult,
  type DocumentStatus,
  type FailurePoint,
  type StoredDocument,
  type TelemetryReplayDataset,
  type TierRefs,
} from "../api";

import {
  DEFAULT_VISIBLE_SIGNALS,
  FAILURE_COLORS,
  REPLAY_SIGNAL_COLORS,
  REPLAY_SIGNAL_LABELS,
  SMALL_MULTIPLE_GROUPS,
  TROUBLE_PRESET_ORDER,
  TROUBLE_SIGNAL_PRESETS,
  type FailureArea,
  type ReplaySignal,
} from "../replay";
import FailureTable from "../components/FailureTable";
import { useReplayChart } from "../hooks/useReplayChart";
import {
  ALL_FAILURE_TYPES,
  countFailuresByType,
  filterFailuresByRange,
  groupFailureAreas,
} from "../lib/failure-areas";
import {
  numericSnapshot,
  technicalLabel,
  troubleDescription,
} from "../lib/labels";

function statusLabel(status: DocumentStatus) {
  switch (status) {
    case "LOADED":
      return "Siap";
    case "PARSE_ERROR":
      return "Gagal dibaca";
    case "UNSUPPORTED_FORMAT":
      return "Format tidak didukung";
  }
}

function formatSize(bytes: number) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function Home() {
  const [documents, setDocuments] = useState<StoredDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [selectedDocumentId, setSelectedDocumentId] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  // 5R Hapus per baris: target modal bisa doc terpilih (tombol atas)
  // atau doc lain (tombol tiap baris daftar).
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzePhase, setAnalyzePhase] = useState("");
  const [analyzeElapsed, setAnalyzeElapsed] = useState(0);
  // Rajin: guard sinkron anti double-submit (state async tak menahan klik ganda cepat)
  const analyzingRef = useRef(false);
  const analyzeTimerRef = useRef<number | null>(null);
  // Cache hasil scan terakhir per (dokumen, profil, setpoint)
  const lastScanRef = useRef<{
    key: string;
    failures: FailurePoint[];
    failureCount: number;
    totalPoints: number;
  } | null>(null);
  const [telemetryError, setTelemetryError] = useState("");
  const [toasts, setToasts] = useState<
    { id: number; kind: "success" | "error"; text: string }[]
  >([]);
  const toastIdRef = useRef(0);

  const pushToast = useCallback((kind: "success" | "error", text: string) => {
    toastIdRef.current += 1;
    const id = toastIdRef.current;
    setToasts((prev) => [...prev.slice(-2), { id, kind, text }]);
    if (kind === "success") {
      window.setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 6000);
    }
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);
  const [profileId, setProfileId] = useState("5000_lps");
  // 5R Ringkas: state admin (profileSetpoints + form freq/rpm/torque + save)
  // dihapus dari page ini — tak ada tombol yang memanggilnya; admin asli di
  // admin/page.tsx. analysisSetpoint "" = fallback profil (resolver tunggal).
  const [analysisSetpoint, setAnalysisSetpoint] = useState<string>("");
  const [classificationResult, setClassificationResult] =
    useState<ClassificationPipelineResult | null>(null);
  const [replayDataset, setReplayDataset] =
    useState<TelemetryReplayDataset | null>(null);
  const [replayError, setReplayError] = useState("");
  const replayChartElement = useRef<HTMLDivElement | null>(null);
  const smallChartMechanicalRef = useRef<HTMLDivElement | null>(null);
  const smallChartElectricalRef = useRef<HTMLDivElement | null>(null);
  const smallChartThermalRef = useRef<HTMLDivElement | null>(null);
  const [visibleSignals, setVisibleSignals] = useState<
    Record<ReplaySignal, boolean>
  >({ ...DEFAULT_VISIBLE_SIGNALS });
  const [activePreset, setActivePreset] = useState<string | null>(null);
  // Mode cetak monokrom (keputusan produk #3cetak): hitam + pola dash per sinyal.
  const [monochrome, setMonochrome] = useState(false);

  const applyTroublePreset = (trouble: string | null) => {
    if (trouble === null || activePreset === trouble) {
      setActivePreset(null);
      setVisibleSignals({ ...DEFAULT_VISIBLE_SIGNALS });
      return;
    }
    const preset = TROUBLE_SIGNAL_PRESETS[trouble];
    if (!preset) return;
    const next = { ...DEFAULT_VISIBLE_SIGNALS };
    (Object.keys(next) as ReplaySignal[]).forEach((key) => {
      next[key] = false;
    });
    preset.forEach((sig) => {
      next[sig] = true;
    });
    setVisibleSignals(next);
    setActivePreset(trouble);
  };
  const [failurePoints, setFailurePoints] = useState<FailurePoint[]>([]);
  const [scanError, setScanError] = useState("");
  const [scanDone, setScanDone] = useState(false);
  const [failureVisibleCount, setFailureVisibleCount] = useState(50);

  const TIME_RANGES = [
    { label: "1 Jam", ms: 1 * 60 * 60 * 1000 },
    { label: "2 Jam", ms: 2 * 60 * 60 * 1000 },
    { label: "3 Jam", ms: 3 * 60 * 60 * 1000 },
    { label: "6 Jam", ms: 6 * 60 * 60 * 1000 },
    { label: "12 Jam", ms: 12 * 60 * 60 * 1000 },
    { label: "24 Jam", ms: 24 * 60 * 60 * 1000 },
    { label: "7 Hari", ms: 7 * 24 * 60 * 60 * 1000 },
    { label: "14 Hari", ms: 14 * 24 * 60 * 60 * 1000 },
    { label: "30 Hari", ms: 30 * 24 * 60 * 60 * 1000 },
    { label: "40 Hari", ms: 40 * 24 * 60 * 60 * 1000 },
    { label: "60 Hari", ms: 60 * 24 * 60 * 60 * 1000 },
    { label: "1 Tahun", ms: 365 * 24 * 60 * 60 * 1000 },
  ] as const;

  const [selectedRangeMs, setSelectedRangeMs] = useState<number>(
    24 * 60 * 60 * 1000,
  );

  // Backend mengirim "dry_run" (nama lama "low_water_menyala" dinormalisasi).
  // Agregasi murni di ../lib/failure-areas (dipakai chart + tabel).

  // Anti-skew: state tak boleh undefined meski respons backend tak dikenal.
  const safeFailurePoints: FailurePoint[] = failurePoints ?? [];

  const lastTimestamp = replayDataset
    ? Date.parse(
        replayDataset.samples
          .filter((s) => s.timestamp)
          .at(-1)?.timestamp || "",
      )
    : safeFailurePoints.length
      ? Date.parse(safeFailurePoints.at(-1)!.timestamp)
      : 0;

  const filteredFailures = filterFailuresByRange(safeFailurePoints, lastTimestamp, selectedRangeMs);

  const failureAreas: FailureArea[] = useMemo(
    () => groupFailureAreas(filteredFailures),
    [filteredFailures],
  );

  const displayAreas = failureAreas;
  const displayFailures = filteredFailures;

  const failureCountsByType = countFailuresByType(filteredFailures, failureAreas);

  // F7 riset: ambang DRY per-tier dari API (keputusan produk #3).
  const [tierRefs, setTierRefs] = useState<TierRefs | null>(null);
  useEffect(() => {
    let cancelled = false;
    getTierRefs()
      .then((refs) => {
        if (!cancelled) setTierRefs(refs);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  const dryThresholds = useMemo(() => {
    const tierKey = tierRefs?.profiles[profileId];
    const refs = tierKey ? tierRefs?.tiers[tierKey] : undefined;
    return refs ? { drKw: refs.dr_kw, drAmp: refs.dr_amp } : null;
  }, [tierRefs, profileId]);

  const {
    viewportSamples,
    replayMedianInterval,
    replayGapCount,
    renderMode,
    renderedPoints,
    renderBudget,
    zoomToArea,
  } = useReplayChart({
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
    dryThresholds,
    monochrome,
  });

  const loadDocuments = useCallback(async () => {
    setLoading(true);
    setLoadError("");

    try {
      const data = await getDocuments();
      setDocuments(data);

      if (!selectedDocumentId && data.length > 0) {
        const ready = data.find((item) => item.status === "LOADED");
        setSelectedDocumentId(ready?.document_id ?? "");
      }
    } catch {
      setLoadError("Data belum dapat diambil dari backend.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadDocuments();
  }, [loadDocuments]);

  useEffect(() => {
    // Clear failures when dataset or profile changes
    setFailurePoints([]);
    setScanDone(false);
    setScanError("");
    setFailureVisibleCount(50);
  }, [selectedDocumentId, profileId]);

  useEffect(() => {
    setFailureVisibleCount(50);
  }, [failurePoints]);

  // 5R Stabilitas: bersihkan interval elapsed bila pindah halaman saat analisis.
  useEffect(() => {
    return () => {
      if (analyzeTimerRef.current !== null) {
        window.clearInterval(analyzeTimerRef.current);
        analyzeTimerRef.current = null;
      }
    };
  }, []);

  async function handleAnalyzeFile() {
    if (!selectedDocumentId || analyzingRef.current) return;
    const setpoint =
      analysisSetpoint === "" ? null : Number(analysisSetpoint);
    if (setpoint !== null && !Number.isFinite(setpoint)) {
      setScanError("Setpoint harus berupa angka.");
      return;
    }
    const cacheKey = `${selectedDocumentId}|${profileId}|${setpoint ?? ""}`;
    const cached = lastScanRef.current;
    if (cached && cached.key === cacheKey) {
      setFailurePoints(cached.failures);
      setScanDone(true);
      pushToast(
        "success",
        `Selesai (cache): ${cached.failureCount.toLocaleString("id-ID")} total di file dari ${cached.totalPoints.toLocaleString("id-ID")} titik`,
      );
      return;
    }
    // Satu instruksi: siapkan data lalu klasifikasikan. POST telemetry
    // idempoten (overwrite), jadi aman dijalankan berurutan tiap klik.
    analyzingRef.current = true;
    setAnalyzing(true);
    setAnalyzePhase("Menyiapkan data…");
    setAnalyzeElapsed(0);
    const startedAt = Date.now();
    analyzeTimerRef.current = window.setInterval(() => {
      setAnalyzeElapsed(Math.floor((Date.now() - startedAt) / 1000));
    }, 500);
    setTelemetryError("");
    setScanError("");
    setScanDone(false);
    setFailurePoints([]);
    try {
      await prepareTelemetry(selectedDocumentId);

      setReplayError("");

      const replay = await getTelemetryReplay(
        selectedDocumentId,
      );

      setReplayDataset(replay);
      pushToast("success", "Data siap dianalisis.");
      setClassificationResult(null);

      setAnalyzePhase("Menganalisis…");
      const result = await scanClassification(
        selectedDocumentId,
        profileId,
        setpoint,
      );
      // Anti-skew: respons tak dikenal tampil kosong, bukan crash halaman.
      const failures = Array.isArray(result.points)
        ? result.points.filter((p) => p.is_failure)
        : [];
      setFailurePoints(failures);
      setScanDone(true);
      const elapsed = Math.floor((Date.now() - startedAt) / 1000);
      lastScanRef.current = {
        key: cacheKey,
        failures,
        failureCount: result.failure_count,
        totalPoints: result.points.length,
      };
      pushToast(
        "success",
        `Selesai: ${result.failure_count.toLocaleString("id-ID")} total di file dari ${result.points.length.toLocaleString("id-ID")} titik • murni per-sampel ala live (full-resolution) • ${elapsed} dtk`,
      );
      // Chart will auto-update via useEffect that watches failureAreas (derived from filteredFailures)
      setFailureVisibleCount(50);
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Analisis gagal";
      setScanError(msg);
      setTelemetryError(msg);
      pushToast("error", msg);
    } finally {
      analyzingRef.current = false;
      if (analyzeTimerRef.current !== null) {
        window.clearInterval(analyzeTimerRef.current);
        analyzeTimerRef.current = null;
      }
      setAnalyzing(false);
      setAnalyzePhase("");
    }
  }

  // 5R Hapus dataset: modal konfirmasi -> DELETE -> pindah otomatis
  // ke file sehat + reset total (termasuk cache scan anti-basi) bila
  // yang dihapus doc terpilih; doc lain cukup dibuang dari daftar.
  async function handleDeleteDocument() {
    const targetId = pendingDeleteId ?? selectedDocumentId;
    if (!targetId || analyzingRef.current || deleting) return;
    setDeleting(true);
    const targetName =
      documents.find((d) => d.document_id === targetId)?.filename ?? targetId;
    const wasSelected = targetId === selectedDocumentId;
    try {
      await deleteDocument(targetId);
      const remaining = documents.filter(
        (d) => d.document_id !== targetId && d.status === "LOADED",
      );
      setDocuments((prev) => prev.filter((d) => d.document_id !== targetId));
      if (wasSelected) {
        setSelectedDocumentId(remaining.length ? remaining[0].document_id : "");
        setTelemetryError("");
        setReplayDataset(null);
        setReplayError("");
        setClassificationResult(null);
        setFailurePoints([]);
        setScanDone(false);
        setScanError("");
        setFailureVisibleCount(50);
        lastScanRef.current = null;
      }
      setShowDeleteModal(false);
      setPendingDeleteId(null);
      pushToast("success", `${targetName} dihapus.`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Gagal menghapus dataset.";
      pushToast("error", msg);
    } finally {
      setDeleting(false);
    }
  }

  // Esc menutup modal hapus (kecuali sedang menghapus).
  useEffect(() => {
    if (!showDeleteModal) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !deleting) {
        setShowDeleteModal(false);
        setPendingDeleteId(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showDeleteModal, deleting]);

  async function handleUpload() {
    if (!file) {
      return;
    }

    setUploading(true);
    setUploadError("");

    try {
      await uploadDocument(file);
      setFile(null);

      const input = document.getElementById(
        "document-upload",
      ) as HTMLInputElement | null;

      if (input) {
        input.value = "";
      }

      await loadDocuments();
    } catch (error) {
      setUploadError(
        error instanceof Error
          ? error.message
          : "Upload gagal.",
      );
    } finally {
      setUploading(false);
    }
  }

  const selectedDocRowCount =
    documents.find((d) => d.document_id === selectedDocumentId)?.row_count ?? 0;

  // 5R Insiden 2026-10-12: modal wajib tunjukkan nama besar + sisa,
  // agar tak ada keraguan file mana yang dihapus.
  const deleteTargetName =
    documents.find((d) => d.document_id === (pendingDeleteId ?? selectedDocumentId))
      ?.filename ?? pendingDeleteId ?? selectedDocumentId;
  const deleteRestCount = documents.filter(
    (d) => d.document_id !== (pendingDeleteId ?? selectedDocumentId),
  ).length;

  return (
    <main>
      <div className="dashboard">
        <header className="dashboard-header">
          <div>
            <p className="eyebrow">Pump Classification • Sederhana</p>
            <h1>Dashboard Pompa</h1>
          </div>
          <div className="header-status">
            <span>{profileId}</span>
            <span style={{ color: "#6b7280" }}>
              {replayDataset ? `${replayDataset.raw_row_count.toLocaleString("id-ID")} titik` : ""}
            </span>
          </div>
        </header>

        <div className="top-controls">
          <div className="top-controls-row">
            <label>
              Dataset
              <select
                id="document-select"
                value={selectedDocumentId}
                disabled={loading || analyzing}
                onChange={(event) => {
                  setSelectedDocumentId(event.target.value);
                  setTelemetryError("");
                  setReplayDataset(null);
                  setReplayError("");
                  setClassificationResult(null);
                }}
              >
                <option value="">Pilih data</option>
                {documents
                  .filter((document) => document.status === "LOADED")
                  .map((document) => (
                    <option key={document.document_id} value={document.document_id}>
                      {document.filename}
                    </option>
                  ))}
              </select>
            </label>

            <label>
              Profil
              <select
                id="profile-select"
                value={profileId}
                onChange={(event) => setProfileId(event.target.value)}
              >
                <option value="500_lps">500 LPS</option>
                <option value="3000_lps">3000 LPS</option>
                <option value="5000_lps">5000 LPS</option>
              </select>
            </label>

            <label>
              Setpoint (Hz)
              <input
                type="number"
                step="0.01"
                value={analysisSetpoint}
                disabled={analyzing}
                onChange={(e) => setAnalysisSetpoint(e.target.value)}
                style={{ width: "80px" }}
              />
            </label>

            <button type="button" className="primary" disabled={!selectedDocumentId || analyzing} onClick={handleAnalyzeFile}>
              {analyzing
                ? `${analyzePhase || "Menganalisis…"}${analyzeElapsed > 0 ? ` (${analyzeElapsed} dtk)` : ""}`
                : "Analisis File Ini"}
            </button>

            <button
              type="button"
              className="danger"
              disabled={!selectedDocumentId || analyzing || deleting}
              onClick={() => {
                setPendingDeleteId(selectedDocumentId);
                setShowDeleteModal(true);
              }}
            >
              {deleting ? "Menghapus…" : "Hapus"}
            </button>

            <div style={{ flex: 1 }} />

            <label>
              Upload CSV
              <div className="upload-box" style={{ margin: 0 }}>
                <input
                  id="document-upload"
                  type="file"
                  accept=".csv,text/csv"
                  disabled={uploading}
                  onChange={(event) => {
                    setFile(event.target.files?.[0] ?? null);
                    setUploadError("");
                  }}
                />
                <button type="button" disabled={!file || uploading} onClick={handleUpload}>
                  {uploading ? "Mengunggah..." : "Upload"}
                </button>
              </div>
            </label>
          </div>

          {uploadError && <p className="message">{uploadError}</p>}
          {telemetryError && <p className="message">{telemetryError}</p>}
          {replayError && <p className="message">{replayError}</p>}
          {scanError && <p className="message">{scanError}</p>}
          {!scanDone && !analyzing && selectedDocRowCount > 10000 && (
            <p className="message">
              File besar ({selectedDocRowCount.toLocaleString("id-ID")} titik) — analisis bisa memakan waktu puluhan detik, mohon tunggu.
            </p>
          )}

          {scanDone && (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
                gap: "0.6rem",
                marginBottom: "1rem",
              }}
            >
              {ALL_FAILURE_TYPES.map((ft) => {
                const cnt = failureCountsByType.pointCounts[ft] ?? 0;
                const areaCnt = failureCountsByType.areaCounts[ft] ?? 0;
                const isZero = cnt === 0;
                return (
                  <div
                    key={ft}
                    style={{
                      background: isZero ? "#f9fafb" : "white",
                      border: `1px solid ${isZero ? "#e5e7eb" : "#d1d5db"}`,
                      borderRadius: 10,
                      padding: "0.7rem 0.8rem",
                      opacity: isZero ? 0.9 : 1,
                    }}
                  >
                    <div
                      style={{
                        fontSize: "0.65rem",
                        textTransform: "uppercase",
                        letterSpacing: "0.04em",
                        color: "#6b7280",
                        marginBottom: "0.25rem",
                        display: "flex",
                        alignItems: "center",
                        gap: "0.35rem",
                      }}
                    >
                      <span
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: 999,
                          // Konsistensi warna: kamus bersama (dulu hardcode warna sinyal).
                          background: FAILURE_COLORS[ft] ?? "#6b7280",
                          display: "inline-block",
                        }}
                      />
                      {ft.replaceAll("_", " ")}
                    </div>
                    <div style={{ fontSize: "1.25rem", fontWeight: 800, lineHeight: 1 }}>{cnt}</div>
                    <div style={{ fontSize: "0.7rem", color: "#6b7280" }}>
                      {areaCnt} area • {cnt === 0 ? "0" : cnt.toLocaleString("id-ID")} titik
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div
          className="chart-card"
          style={{ padding: "1rem" }}
        >
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginBottom: "1rem", alignItems: "center" }}>
            {TIME_RANGES.map((r) => (
              <button
                key={r.label}
                type="button"
                onClick={() => setSelectedRangeMs(r.ms)}
                style={{
                  padding: "0.45rem 0.7rem",
                  borderRadius: 999,
                  border: selectedRangeMs === r.ms ? "1px solid #2563eb" : "1px solid #d1d5db",
                  background: selectedRangeMs === r.ms ? "#2563eb" : "white",
                  color: selectedRangeMs === r.ms ? "white" : "#374151",
                  fontSize: "0.8rem",
                  cursor: "pointer",
                }}
              >
                {r.label}
              </button>
            ))}
          </div>

          {!replayDataset ? (
            <div
              style={{
                height: 300,
                display: "grid",
                placeItems: "center",
                color: "#9ca3af",
                border: "1px dashed #e5e7eb",
                borderRadius: 12,
              }}
            >
              Pilih dataset lalu Analisis File Ini
            </div>
          ) : (
            <>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
                <h2 style={{ margin: 0 }}>Riwayat Pompa — Line Chart</h2>
                <span style={{ fontSize: "0.8rem", color: "#6b7280" }}>{replayDataset.raw_row_count.toLocaleString("id-ID")} titik</span>
              </div>

              <div className="signal-toggles">
                <div style={{ width: "100%", display: "grid", gap: "0.5rem" }}>
                  <div>
                    <div style={{ fontSize: "0.7rem", fontWeight: 700, color: "#374151", marginBottom: "0.25rem", textTransform: "uppercase" }}>
                      Trouble
                    </div>
                    <label style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem", fontSize: "0.75rem", color: "#374151", marginBottom: "0.4rem" }}>
                      <input
                        type="checkbox"
                        checked={monochrome}
                        onChange={(e) => setMonochrome(e.target.checked)}
                      />
                      Mode cetak (monokrom)
                    </label>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem" }}>
                      <button
                        key="__default"
                        type="button"
                        data-testid="preset-default"
                        onClick={() => applyTroublePreset(null)}
                        title="Kembalikan tampilan sinyal bawaan"
                        style={{
                          fontSize: "0.75rem",
                          padding: "0.3rem 0.7rem",
                          borderRadius: 999,
                          cursor: "pointer",
                          color: "#374151",
                          background: activePreset === null ? "#eff6ff" : "white",
                          border: `1px solid ${activePreset === null ? "#2563eb" : "#e5e7eb"}`,
                        }}
                      >
                        Default
                      </button>
                      {TROUBLE_PRESET_ORDER.map((trouble) => {
                        const color = FAILURE_COLORS[trouble] || "#6b7280";
                        const active = activePreset === trouble;
                        return (
                          <button
                            key={trouble}
                            type="button"
                            data-testid={`preset-${trouble}`}
                            onClick={() => applyTroublePreset(trouble)}
                            title={`Tampilkan parameter ${technicalLabel(trouble)}`}
                            style={{
                              fontSize: "0.75rem",
                              padding: "0.3rem 0.7rem",
                              borderRadius: 999,
                              cursor: "pointer",
                              display: "inline-flex",
                              alignItems: "center",
                              gap: "0.35rem",
                              color: "#374151",
                              background: active ? `${color}1A` : "white",
                              border: `1px solid ${active ? color : "#e5e7eb"}`,
                            }}
                          >
                            <span
                              style={{
                                width: 8,
                                height: 8,
                                borderRadius: 999,
                                background: color,
                              }}
                            />
                            {technicalLabel(trouble)}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  {Object.entries(SMALL_MULTIPLE_GROUPS).map(([groupKey, group]) => (
                    <div key={groupKey}>
                      <div style={{ fontSize: "0.7rem", fontWeight: 700, color: "#374151", marginBottom: "0.25rem", textTransform: "uppercase" }}>
                        {group.label}
                      </div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem" }}>
                        {group.signals.map((sig) => (
                          <label key={sig} style={{ fontSize: "0.75rem" }}>
                            <input
                              type="checkbox"
                              checked={visibleSignals[sig]}
                              onChange={(event) => {
                                setActivePreset(null);
                                setVisibleSignals((current) => ({
                                  ...current,
                                  [sig]: event.target.checked,
                                }))
                              }
                              }
                            />
                            <span className="signal-dot" style={{ background: REPLAY_SIGNAL_COLORS[sig] }} />
                            {REPLAY_SIGNAL_LABELS[sig]}
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div ref={replayChartElement} className="replay-chart" style={{ height: 380 }} />

              <div className="small-multiples-grid" style={{ marginTop: "1rem" }}>
                <div ref={smallChartMechanicalRef} className="small-chart" />
                <div ref={smallChartElectricalRef} className="small-chart" />
                <div ref={smallChartThermalRef} className="small-chart" />
              </div>

              <p style={{ fontSize: "0.75rem", color: "#6b7280", marginTop: "0.5rem" }}>
                Rentang terpilih: {TIME_RANGES.find((r) => r.ms === selectedRangeMs)?.label} kebelakang • {displayFailures.length} kegagalan dalam rentang
              </p>
              {/* F6 riset: transparansi resolusi — RAW vs ADAPTIVE + gap + budget */}
              <p style={{ fontSize: "0.75rem", color: "#6b7280", marginTop: "0.25rem" }}>
                Mode: {renderMode} • Tampil {viewportSamples.toLocaleString("id-ID")} → {renderedPoints.toLocaleString("id-ID")} pts (budget {renderBudget.toLocaleString("id-ID")}) • Gap: {replayGapCount} • Median interval: {(replayMedianInterval / 1000).toLocaleString("id-ID", { maximumFractionDigits: 1 })}s
              </p>
            </>
          )}
        </div>

        {displayFailures.length > 0 && (
          <div className="chart-card">
            <h2>Titik Kegagalan — {TIME_RANGES.find((r) => r.ms === selectedRangeMs)?.label} Terakhir</h2>
            <p className="chart-subtitle">Klik Zoom untuk memperbesar grafik ke 5 menit sebelum & 2 menit sesudah titik.</p>

            <FailureTable
              areas={displayAreas}
              visibleCount={failureVisibleCount}
              rangeLabel={TIME_RANGES.find((r) => r.ms === selectedRangeMs)?.label}
              onZoomArea={(start, end) => zoomToArea(start, end)}
              onScrollNearBottom={() =>
                // F14: cap selalu areas (yang di-slice), step +100 konsisten.
                setFailureVisibleCount((c) => Math.min(displayAreas.length, c + 100))
              }
              onLoadMore={() =>
                setFailureVisibleCount((c) => Math.min(displayAreas.length, c + 100))
              }
            />
          </div>
        )}

        {classificationResult && (
          <div className="side-card" style={{ position: "static" }}>
            <h2>Hasil Analisis Saat Ini</h2>
            <div className="result-block">
              <p className="result-label">Hasil Analisis Saat Ini</p>
              <h2>{technicalLabel(classificationResult.classification.trouble_type)}</h2>
              <p>{troubleDescription(classificationResult.classification.trouble_type)}</p>
            </div>
            {classificationResult.classification.matched_rules.some((rule) => rule.trouble_type !== classificationResult.classification.trouble_type) && (
              <div className="result-block">
                <p className="result-label">Indikasi Tambahan</p>
                {classificationResult.classification.matched_rules
                  .filter((rule) => rule.trouble_type !== classificationResult.classification.trouble_type)
                  .map((rule) => (
                    <div className="additional-indication" key={rule.trouble_type}>
                      <strong>{technicalLabel(rule.trouble_type)}</strong>
                      <p>{troubleDescription(rule.trouble_type)}</p>
                    </div>
                  ))}
              </div>
            )}
            <div className="result-block">
              <p className="result-label">Data Pendukung</p>
              {numericSnapshot(classificationResult.classification.sensor_snapshot, "input_voltage") !== null && (
                <div className="evidence-row">
                  <div>
                    <strong>Input Voltage (AC)</strong>
                    <p>Tegangan Input AC (pure, tanpa konversi 1.35).</p>
                  </div>
                  <span>{numericSnapshot(classificationResult.classification.sensor_snapshot, "input_voltage")?.toFixed(1)} V</span>
                </div>
              )}
            </div>
          </div>
        )}

        <section style={{ marginTop: "1rem" }}>
          <h2>Dokumen Tersimpan</h2>
          {loading && <p>Memuat data...</p>}
          {loadError && <p className="message">{loadError}</p>}
          {!loading && !loadError && documents.length === 0 && <p>Belum ada data pompa.</p>}
          {!loading && !loadError && documents.length > 0 && (
            <div className="document-list">
              {documents.map((document) => (
                <article key={document.document_id}>
                  <div>
                    <strong>{document.filename}</strong>
                    <p>
                      {document.row_count.toLocaleString("id-ID")} baris · {document.column_count} kolom · {formatSize(document.size_bytes)}
                    </p>
                  </div>
                  <div className="document-actions">
                    <span>{statusLabel(document.status)}</span>
                    <button
                      type="button"
                      className="danger-small"
                      disabled={analyzing || deleting}
                      aria-label={`Hapus ${document.filename}`}
                      onClick={() => {
                        setPendingDeleteId(document.document_id);
                        setShowDeleteModal(true);
                      }}
                    >
                      Hapus
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
          {telemetryError && <p className="message">{telemetryError}</p>}
        </section>
      </div>

      {showDeleteModal && (
        <div
          className="modal-overlay"
          data-testid="delete-modal"
          onClick={() => {
            if (!deleting) {
              setShowDeleteModal(false);
              setPendingDeleteId(null);
            }
          }}
        >
          <div
            className="modal-box"
            role="alertdialog"
            aria-modal="true"
            aria-label="Konfirmasi hapus dataset"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-title">Hapus dataset?</div>
            <p>
              <strong>{deleteTargetName}</strong> beserta telemetry dan hasil
              scan ikut terhapus (dipindah ke trash, bisa dikembalikan).
            </p>
            <p className="modal-sub">
              {deleteRestCount > 0
                ? `${deleteRestCount.toLocaleString("id-ID")} dokumen lain tetap tersimpan.`
                : "Ini satu-satunya dokumen tersimpan."}
            </p>
            <div className="modal-actions">
              <button
                type="button"
                autoFocus
                disabled={deleting}
                onClick={() => {
                  setShowDeleteModal(false);
                  setPendingDeleteId(null);
                }}
              >
                Batal
              </button>
              <button
                type="button"
                className="primary"
                data-testid="delete-confirm"
                disabled={deleting}
                onClick={handleDeleteDocument}
              >
                {deleting ? "Menghapus…" : "Hapus"}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="toast-stack" aria-live="polite">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role="status"
            data-testid="toast"
            data-kind={toast.kind}
            className={`toast toast-${toast.kind}`}
          >
            <span>{toast.text}</span>
            {toast.kind === "error" && (
              <button
                type="button"
                aria-label="Tutup notifikasi"
                onClick={() => dismissToast(toast.id)}
                className="toast-close"
              >
                ×
              </button>
            )}
          </div>
        ))}
      </div>
    </main>
  );
}
