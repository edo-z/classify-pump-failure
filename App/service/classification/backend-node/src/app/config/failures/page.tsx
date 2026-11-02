
"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "./failures.module.css";

type Scope = "flowhead" | "vsd" | null;

interface FailureDefinition {
  id: number;
  failure: string;
  name: string;
}

interface Pump {
  id: number;
  pumpId: string;
  flowhead_capacity: string | number;
  vsd_type_id: number;
}

interface Parameter {
  code: string;
  name?: string;
  failure_code?: string | null;
  numeric_value: string | number;
  unit: string;
  source: string;
  updated_at?: string;
}

interface ApiResponse<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

const FLOWHEAD_FAILURES = new Set([
  "pompa_tersangkut_sampah",
  "turbulensi",
  "banyak_sampah",
  "dry_run",
]);

const VSD_FAILURES = new Set([
  "unbalance",
  "undervoltage",
  "overvoltage",
]);

function getScope(code: string): Scope {
  if (FLOWHEAD_FAILURES.has(code)) return "flowhead";
  if (VSD_FAILURES.has(code)) return "vsd";
  return null;
}

async function readApi<T>(
  url: string,
  signal: AbortSignal,
): Promise<T> {
  const response = await fetch(url, {
    method: "GET",
    signal,
  });

  const result = (await response.json()) as ApiResponse<T>;

  if (!response.ok || result.ok !== true || result.data === undefined) {
    throw new Error(
      result.error ?? `HTTP ${response.status}`,
    );
  }

  return result.data;
}

function ParameterTable({
  rows,
}: {
  rows: Parameter[];
}) {
  if (rows.length === 0) {
    return (
      <p className={styles.empty}>
        Belum ada parameter pada konteks konfigurasi ini.
      </p>
    );
  }

  return (
    <div className={styles.tableScroll}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Parameter</th>
            <th>Code</th>
            <th>Nilai</th>
            <th>Satuan</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.code}>
              <td>{row.name || row.code}</td>
              <td>
                <code>{row.code}</code>
              </td>
              <td className={styles.numeric}>
                {String(row.numeric_value)}
              </td>
              <td>{row.unit}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function FailureConfigurationPage() {
  const [failures, setFailures] =
    useState<FailureDefinition[]>([]);
  const [pumps, setPumps] = useState<Pump[]>([]);

  const [selectedFailure, setSelectedFailure] = useState("");
  const [capacity, setCapacity] = useState("");
  const [vsdTypeId, setVsdTypeId] = useState("");

  const [parameters, setParameters] =
    useState<Parameter[]>([]);
  const [sharedParameters, setSharedParameters] =
    useState<Parameter[]>([]);
  const [runtimeParameters, setRuntimeParameters] =
    useState<Parameter[]>([]);

  const [initialLoading, setInitialLoading] = useState(true);
  const [configLoading, setConfigLoading] = useState(false);
  const [initialError, setInitialError] = useState("");
  const [configError, setConfigError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  // ==========================================================
  // LOAD FAILURE DEFINITIONS AND REGISTERED EQUIPMENT
  // ==========================================================

  useEffect(() => {
    const controller = new AbortController();

    async function loadInitialData() {
      setInitialLoading(true);
      setInitialError("");

      try {
        const [failureData, pumpData] = await Promise.all([
          readApi<FailureDefinition[]>(
            "/api/config/failures",
            controller.signal,
          ),
          readApi<Pump[]>(
            "/api/config/pumps",
            controller.signal,
          ),
        ]);

        if (!Array.isArray(failureData) ||
            !Array.isArray(pumpData)) {
          throw new Error("Format data API tidak valid");
        }

        if (controller.signal.aborted) return;

        setFailures(failureData);
        setPumps(pumpData);

        setSelectedFailure((current) => {
          if (failureData.some((item) => item.failure === current)) {
            return current;
          }
          return failureData[0]?.failure ?? "";
        });
      } catch (error) {
        if (controller.signal.aborted) return;

        setInitialError(
          error instanceof Error
            ? error.message
            : "Gagal membaca konfigurasi",
        );
      } finally {
        if (!controller.signal.aborted) {
          setInitialLoading(false);
        }
      }
    }

    void loadInitialData();

    return () => controller.abort();
  }, [reloadKey]);

  // ==========================================================
  // EQUIPMENT CONTEXT FROM REGISTERED PUMPS
  // ==========================================================

  const capacities = useMemo(
    () =>
      [...new Set(
        pumps.map((pump) => String(pump.flowhead_capacity)),
      )].sort((a, b) => Number(a) - Number(b)),
    [pumps],
  );

  const vsdTypes = useMemo(
    () =>
      [...new Set(
        pumps.map((pump) => String(pump.vsd_type_id)),
      )].sort((a, b) => Number(a) - Number(b)),
    [pumps],
  );

  const activeCapacity = capacities.includes(capacity)
    ? capacity
    : capacities[0] ?? "";

  const activeVsdType = vsdTypes.includes(vsdTypeId)
    ? vsdTypeId
    : vsdTypes[0] ?? "";

  const selectedDefinition =
    failures.find((item) => item.failure === selectedFailure);

  const scope = getScope(selectedFailure);

  // ==========================================================
  // LOAD CONFIGURATION BY FAILURE + EQUIPMENT CLASS
  // ==========================================================

  useEffect(() => {
    const controller = new AbortController();

    setParameters([]);
    setSharedParameters([]);
    setRuntimeParameters([]);
    setConfigError("");

    if (
      !selectedFailure ||
      scope === null ||
      (scope === "flowhead" && !activeCapacity) ||
      (scope === "vsd" && !activeVsdType)
    ) {
      setConfigLoading(false);
      return () => controller.abort();
    }

    async function loadParameters() {
      setConfigLoading(true);

      try {
        const configUrl =
          scope === "flowhead"
            ? "/api/config/flowhead?capacity=" +
              encodeURIComponent(activeCapacity)
            : "/api/config/vsd?vsdTypeId=" +
              encodeURIComponent(activeVsdType);

        const [configRows, runtimeRows] = await Promise.all([
          readApi<Parameter[]>(
            configUrl,
            controller.signal,
          ),
          readApi<Parameter[]>(
            "/api/config/runtime",
            controller.signal,
          ),
        ]);

        if (!Array.isArray(configRows) ||
            !Array.isArray(runtimeRows)) {
          throw new Error("Format parameter tidak valid");
        }

        if (controller.signal.aborted) return;

        setParameters(
          configRows.filter(
            (row) => row.failure_code === selectedFailure,
          ),
        );

        setSharedParameters(
          scope === "flowhead"
            ? configRows.filter(
                (row) => row.failure_code == null,
              )
            : [],
        );

        setRuntimeParameters(runtimeRows);
      } catch (error) {
        if (controller.signal.aborted) return;

        setConfigError(
          error instanceof Error
            ? error.message
            : "Gagal membaca parameter",
        );
      } finally {
        if (!controller.signal.aborted) {
          setConfigLoading(false);
        }
      }
    }

    void loadParameters();

    return () => controller.abort();
  }, [
    selectedFailure,
    scope,
    activeCapacity,
    activeVsdType,
    reloadKey,
  ]);

  const frequencyMissing =
    scope === "flowhead" &&
    !sharedParameters.some(
      (item) => item.code === "frequency_setpoint_hz",
    );

  return (
    <div className={styles.app}>
      <header className={styles.header}>
        <div className={styles.brand}>
          <div className={styles.logo}>D</div>
          <div>
            <strong>DEXMIN</strong>
            <small>Classification Configuration</small>
          </div>
        </div>
        <span className={styles.mode}>8A2 · READ ONLY</span>
      </header>

      <main className={styles.container}>
        <nav className={styles.nav}>
          <a href="/config">8A1 — Pump Overview</a>
          <span>/</span>
          <strong>8A2 — Failure Configuration</strong>
        </nav>

        <div className={styles.heading}>
          <div>
            <p className={styles.eyebrow}>
              CLASSIFICATION MANAGEMENT
            </p>
            <h1>Failure Configuration</h1>
            <p>
              Pilih jenis gangguan dan tinjau parameter
              yang digunakan sebagai referensi klasifikasi.
            </p>
          </div>
          <button
            type="button"
            className={styles.refresh}
            onClick={() => setReloadKey((value) => value + 1)}
          >
            Muat ulang
          </button>
        </div>

        {initialError && (
          <div className={styles.error} role="alert">
            {initialError}
          </div>
        )}

        {initialLoading && (
          <p role="status">Memuat daftar Failure...</p>
        )}

        <div className={styles.workspace}>
          <aside className={styles.sidebar}>
            <div className={styles.sidebarTitle}>
              <strong>Failure Definitions</strong>
              <span>{failures.length}</span>
            </div>

            <div className={styles.failureList}>
              {failures.map((failure) => (
                <button
                  type="button"
                  key={failure.failure}
                  className={
                    selectedFailure === failure.failure
                      ? styles.failureActive
                      : styles.failureButton
                  }
                  aria-pressed={
                    selectedFailure === failure.failure
                  }
                  onClick={() =>
                    setSelectedFailure(failure.failure)
                  }
                >
                  <strong>{failure.name}</strong>
                  <small>{failure.failure}</small>
                </button>
              ))}
            </div>
          </aside>

          <section className={styles.content}>
            {!selectedDefinition ? (
              <p className={styles.empty}>
                Pilih Failure untuk melihat konfigurasinya.
              </p>
            ) : (
              <>
                <div className={styles.failureHeader}>
                  <p className={styles.eyebrow}>
                    SELECTED CLASSIFICATION
                  </p>
                  <h2>{selectedDefinition.name}</h2>
                  <code>{selectedDefinition.failure}</code>
                </div>

                {scope !== null && (
                  <div className={styles.context}>
                    <div>
                      <strong>Configuration Scope</strong>
                      <p>
                        {scope === "flowhead"
                          ? "Parameter berdasarkan kapasitas Flowhead"
                          : "Parameter berdasarkan tipe VSD"}
                      </p>
                    </div>

                    <label>
                      {scope === "flowhead"
                        ? "Kapasitas Flowhead"
                        : "Tipe VSD"}

                      <select
                        value={
                          scope === "flowhead"
                            ? activeCapacity
                            : activeVsdType
                        }
                        onChange={(event) => {
                          if (scope === "flowhead") {
                            setCapacity(event.target.value);
                          } else {
                            setVsdTypeId(event.target.value);
                          }
                        }}
                      >
                        {(scope === "flowhead"
                          ? capacities
                          : vsdTypes
                        ).map((value) => (
                          <option key={value} value={value}>
                            {scope === "flowhead"
                              ? `FH ${value}`
                              : `VSD ${value}`}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                )}

                {scope === null ? (
                  <div className={styles.info}>
                    {selectedFailure === "panel_overheat"
                      ? "Pending Review — threshold tiap sensor suhu belum ditetapkan."
                      : "Tidak ada parameter threshold khusus untuk klasifikasi ini."}
                  </div>
                ) : (
                  <>
                    {configLoading && (
                      <p role="status">
                        Memuat parameter klasifikasi...
                      </p>
                    )}

                    {configError && (
                      <div className={styles.error} role="alert">
                        {configError}
                      </div>
                    )}

                    {!configLoading && !configError && (
                      <>
                        <div className={styles.sectionTitle}>
                          <h3>Parameter Klasifikasi</h3>
                          <span>
                            {parameters.length} parameter
                          </span>
                        </div>
                        <ParameterTable rows={parameters} />

                        {scope === "flowhead" && (
                          <>
                            <div className={styles.sectionTitle}>
                              <h3>Shared Flowhead Configuration</h3>
                              <span>
                                {sharedParameters.length} parameter
                              </span>
                            </div>
                            <ParameterTable
                              rows={sharedParameters}
                            />

                            {frequencyMissing && (
                              <div className={styles.warning}>
                                <strong>
                                  Parameter belum tersedia
                                </strong>
                                <code>
                                  flowhead.frequency_setpoint_hz
                                </code>
                                <p>
                                  Kebutuhan parameter ini harus
                                  diperiksa sebelum menyatakan
                                  evaluator siap.
                                </p>
                              </div>
                            )}
                          </>
                        )}

                        <div className={styles.sectionTitle}>
                          <h3>Runtime Global</h3>
                          <span>
                            {runtimeParameters.length} parameter
                          </span>
                        </div>
                        <ParameterTable
                          rows={runtimeParameters}
                        />

                        <p className={styles.note}>
                          Parameter Runtime bersifat bersama.
                          Penampilan parameter di halaman ini
                          tidak berarti semuanya dipakai oleh
                          Failure yang sedang dipilih.
                          Readiness evaluator dinilai
                          secara terpisah pada Tahap 8C.
                        </p>
                      </>
                    )}
                  </>
                )}
              </>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
