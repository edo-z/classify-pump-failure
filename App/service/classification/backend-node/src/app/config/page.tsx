
"use client";

import { useEffect, useState } from "react";
import styles from "./dashboard.module.css";
import ParameterCrudPanel from "./ParameterCrudPanel.js";

type Failure = {
  id: number;
  failure: string;
  name: string;
};

type Pump = {
  id: number;
  pumpId: string;
  flowhead_capacity: number | string;
  vsd_type_id: number;
};

type Parameter = {
  code: string;
  name?: string;
  numeric_value: number | string;
  unit?: string;
  failure_id?: number | null;
  failure_code?: string | null;
};

type ApiResult<T> = {
  ok: boolean;
  data?: T;
  error?: string;
  capabilities?: {
    failureCrud: boolean;
  };
};

type Mode = "create" | "edit" | "delete" | null;
type Scope = "flowhead" | "vsd" | null;

const FLOWHEAD = new Set([
  "pompa_tersangkut_sampah",
  "turbulensi",
  "banyak_sampah",
  "dry_run",
]);

const VSD = new Set([
  "unbalance",
  "undervoltage",
  "overvoltage",
]);

const CORE = new Set([
  ...FLOWHEAD,
  ...VSD,
  "normal",
  "panel_overheat",
]);

const FREQUENCY_DEPENDENT_FAILURES = new Set([
  "turbulensi",
  "banyak_sampah",
  "dry_run",
]);

const PARAMETER_CODES: Record<string, string[]> = {
  pompa_tersangkut_sampah: [
    "pts_frequency_hz",
    "pts_power_ref_kw",
    "pts_current_ref_a",
    "pts_torque_ref_pct",
    "pts_rpm_ref",
  ],

  turbulensi: [
    "turbulensi_power_ref_kw",
    "turbulensi_torque_ref_pct",
    "turbulensi_current_dev_threshold_a",
  ],

  banyak_sampah: [
    "banyak_sampah_power_ref_kw",
    "banyak_sampah_current_ref_a",
    "banyak_sampah_torque_ref_pct",
  ],

  dry_run: [
    "dry_run_power_factor",
    "dry_run_current_factor",
    "dry_run_torque_threshold_pct",
  ],

  unbalance: [
    "unbalance_threshold_pct",
  ],

  undervoltage: [
    "undervoltage_threshold_v",
  ],

  overvoltage: [
    "overvoltage_threshold_v",
  ],
};

const SHARED_FLOWHEAD_CODES = [
  "power_ref_kw",
  "current_ref_a",
  "rpm_setpoint",
  "torque_setpoint_pct",
];

const RUNTIME_CODES = [
  "stagnation_limit",
  "turbulensi_window",
];

function getScope(code: string): Scope {
  if (FLOWHEAD.has(code)) return "flowhead";
  if (VSD.has(code)) return "vsd";
  return null;
}

function getStatus(code: string): string {
  if (!CORE.has(code)) return "Evaluator Coming Soon";
  if (code === "panel_overheat") return "Pending Review";
  if (code === "normal") return "Normal / Built-in";
  return "Evaluator bawaan";
}

async function apiGet<T>(
  url: string,
  signal: AbortSignal,
): Promise<ApiResult<T>> {
  const response = await fetch(url, {
    method: "GET",
    signal,
  });

  const result = (await response.json()) as ApiResult<T>;

  if (
    !response.ok ||
    result.ok !== true ||
    result.data === undefined
  ) {
    throw new Error(
      result.error ?? `HTTP ${response.status}`,
    );
  }

  return result;
}

async function apiWrite<T>(
  method: "POST" | "PATCH" | "DELETE",
  body: Record<string, unknown>,
): Promise<T> {
  const response = await fetch(
    "/api/config/failure-registry",
    {
      method,
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );

  const result = (await response.json()) as ApiResult<T>;

  if (
    !response.ok ||
    result.ok !== true ||
    result.data === undefined
  ) {
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
      <p className={styles.muted}>
        Tidak ada parameter untuk bagian ini.
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
            <th>Unit</th>
          </tr>
        </thead>

        <tbody>
          {rows.map((row) => (
            <tr key={row.code}>
              <td>{row.name || row.code}</td>
              <td><code>{row.code}</code></td>
              <td><strong>{String(row.numeric_value)}</strong></td>
              <td>{row.unit || "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function ClassificationDashboard() {
  const [failures, setFailures] = useState<Failure[]>([]);
  const [pumps, setPumps] = useState<Pump[]>([]);
  const [runtime, setRuntime] = useState<Parameter[]>([]);
  const [parameters, setParameters] = useState<Parameter[]>([]);

  const [selectedId, setSelectedId] =
    useState<number | null>(null);

  const [capacity, setCapacity] = useState("");
  const [vsdType, setVsdType] = useState("");

  const [canWrite, setCanWrite] = useState(false);
  const [loading, setLoading] = useState(true);
  const [parameterLoading, setParameterLoading] =
    useState(false);

  const [error, setError] = useState("");
  const [parameterError, setParameterError] = useState("");
  const [message, setMessage] = useState("");
  const [reload, setReload] = useState(0);

  const [mode, setMode] = useState<Mode>(null);
  const [draftCode, setDraftCode] = useState("");
  const [draftName, setDraftName] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [showComingSoon, setShowComingSoon] =
    useState(false);

  // ==========================================================
  // INITIAL DATA
  // ==========================================================

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      setLoading(true);
      setError("");

      try {
        const [registry, pumpData, runtimeData] =
          await Promise.all([
            apiGet<Failure[]>(
              "/api/config/failure-registry",
              controller.signal,
            ),
            apiGet<Pump[]>(
              "/api/config/pumps",
              controller.signal,
            ),
            apiGet<Parameter[]>(
              "/api/config/runtime",
              controller.signal,
            ),
          ]);

        const rows = registry.data;
        const pumpRows = pumpData.data;
        const runtimeRows = runtimeData.data;

        if (
          !Array.isArray(rows) ||
          !Array.isArray(pumpRows) ||
          !Array.isArray(runtimeRows)
        ) {
          throw new Error("Format respons API tidak valid");
        }

        if (controller.signal.aborted) return;

        setFailures(rows);
        setPumps(pumpRows);
        setRuntime(runtimeRows);

        setCanWrite(
          registry.capabilities?.failureCrud === true,
        );

        setSelectedId((current) =>
          rows.some((row) => row.id === current)
            ? current
            : rows[0]?.id ?? null,
        );
      } catch (cause) {
        if (controller.signal.aborted) return;

        setError(
          cause instanceof Error
            ? cause.message
            : "Gagal membaca konfigurasi",
        );
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }

    void load();

    return () => controller.abort();
  }, [reload]);

  const selected =
    failures.find((row) => row.id === selectedId) ?? null;

  const scope = getScope(selected?.failure ?? "");

  const capacities = [
    ...new Set(
      pumps.map((pump) => String(pump.flowhead_capacity)),
    ),
  ].sort((a, b) => Number(a) - Number(b));

  const vsdTypes = [
    ...new Set(
      pumps.map((pump) => String(pump.vsd_type_id)),
    ),
  ].sort((a, b) => Number(a) - Number(b));

  const activeCapacity = capacities.includes(capacity)
    ? capacity
    : capacities[0] ?? "";

  const activeVsdType = vsdTypes.includes(vsdType)
    ? vsdType
    : vsdTypes[0] ?? "";

  const contextValues =
    scope === "flowhead" ? capacities : vsdTypes;

  const activeContext =
    scope === "flowhead" ? activeCapacity : activeVsdType;

  // ==========================================================
  // CLASSIFICATION PARAMETERS
  // ==========================================================

  useEffect(() => {
    const controller = new AbortController();

    setParameters([]);
    setParameterError("");

    if (!scope || !activeContext) {
      setParameterLoading(false);
      return () => controller.abort();
    }

    const url =
      scope === "flowhead"
        ? `/api/config/flowhead?capacity=${encodeURIComponent(activeCapacity)}`
        : `/api/config/vsd?vsdTypeId=${encodeURIComponent(activeVsdType)}`;

    async function loadParameters() {
      setParameterLoading(true);

      try {
        const result = await apiGet<Parameter[]>(
          url,
          controller.signal,
        );

        if (!Array.isArray(result.data)) {
          throw new Error("Format parameter tidak valid");
        }

        if (!controller.signal.aborted) {
          setParameters(result.data);
        }
      } catch (cause) {
        if (controller.signal.aborted) return;

        setParameterError(
          cause instanceof Error
            ? cause.message
            : "Gagal memuat parameter",
        );
      } finally {
        if (!controller.signal.aborted) {
          setParameterLoading(false);
        }
      }
    }

    void loadParameters();

    return () => controller.abort();
  }, [
    selectedId,
    scope,
    activeContext,
    activeCapacity,
    activeVsdType,
    reload,
  ]);

  const hasOwnership = parameters.some(
    (row) =>
      "failure_id" in row ||
      "failure_code" in row,
  );

  const specific = selected && hasOwnership
    ? parameters.filter(
      (row) =>
        row.failure_id === selected.id ||
        row.failure_code === selected.failure,
    )
    : [];

  const shared =
    scope === "flowhead" && hasOwnership
      ? parameters.filter(
        (row) =>
          row.failure_id == null &&
          row.failure_code == null,
      )
      : [];

  const customCount = failures.filter(
    (row) => !CORE.has(row.failure),
  ).length;

  // ==========================================================
  // FAILURE CRUD
  // ==========================================================

  function openDialog(nextMode: Exclude<Mode, null>) {
    if (!canWrite) return;

    setMode(nextMode);
    setFormError("");

    setDraftCode(
      nextMode === "create" ? "" : selected?.failure ?? "",
    );

    setDraftName(
      nextMode === "create" ? "" : selected?.name ?? "",
    );
  }

  async function submit() {
    if (!canWrite || saving || !mode) return;

    setSaving(true);
    setFormError("");
    setMessage("");

    try {
      if (mode === "create") {
        const created = await apiWrite<Failure>("POST", {
          failure: draftCode.trim(),
          name: draftName.trim(),
        });

        setSelectedId(created.id);
        setMessage(
          `Failure ${created.failure} berhasil ditambahkan. Evaluator Coming Soon.`,
        );
      }

      if (mode === "edit" && selected) {
        await apiWrite<Failure>("PATCH", {
          id: selected.id,
          name: draftName.trim(),
        });

        setMessage("Nama Failure berhasil diperbarui.");
      }

      if (mode === "delete" && selected) {
        await apiWrite<{ id: number }>("DELETE", {
          id: selected.id,
        });

        setSelectedId(null);
        setMessage("Failure berhasil dihapus.");
      }

      setMode(null);
      setReload((value) => value + 1);
    } catch (cause) {
      setFormError(
        cause instanceof Error
          ? cause.message
          : "Operasi gagal",
      );
    } finally {
      setSaving(false);
    }
  }

  // ==========================================================
  // DASHBOARD
  // ==========================================================

  return (
    <div className={styles.app}>
      <header className={styles.header}>
        <div className={styles.brand}>
          <div className={styles.logo}>D</div>
          <div>
            <strong>DEXMIN</strong>
            <small>Classification Management</small>
          </div>
        </div>
        <span className={styles.headerBadge}>
          CONFIGURATION DASHBOARD
        </span>
      </header>

      <main className={styles.container}>
        <div className={styles.heading}>
          <div>
            <p className={styles.eyebrow}>
              CLASSIFICATION / CONFIGURATION
            </p>
            <h1>Failure Configuration</h1>
            <p>
              Kelola Failure Registry dan lihat parameter
              referensi Classification Engine.
            </p>
          </div>

          <button
            type="button"
            className={styles.secondaryButton}
            onClick={() => setReload((value) => value + 1)}
          >
            Muat ulang
          </button>
        </div>

        <div className={styles.metrics}>
          <div className={styles.metric}>
            <strong>{failures.length}</strong>
            <span>Failure Terdaftar</span>
          </div>
          <div className={styles.metric}>
            <strong>{failures.length - customCount}</strong>
            <span>Failure Bawaan</span>
          </div>
          <div className={styles.metric}>
            <strong>{customCount}</strong>
            <span>Evaluator Coming Soon</span>
          </div>
        </div>

        <nav className={styles.navigation}>
          <a href="/config">Dashboard</a>
          <a href="/config/failures">Failure Browser</a>
          <a href="/config/pumps">Pump Overview</a>

          <button
            type="button"
            onClick={() => setShowComingSoon(true)}
          >
            Dynamic Rule Engine
          </button>
        </nav>

        {showComingSoon && (
          <div className={styles.notice} role="status">
            <div>
              <strong>
                Dynamic Rule Engine — Coming Soon
              </strong>
              <p>
                Pembuatan rumus dan evaluator melalui
                dashboard belum tersedia. Failure baru
                hanya didaftarkan pada registry dan tidak
                otomatis dievaluasi oleh Classification Engine.
              </p>
            </div>

            <button
              type="button"
              onClick={() => setShowComingSoon(false)}
            >
              Tutup
            </button>
          </div>
        )}

        {!canWrite && !loading && (
          <div className={styles.readOnly}>
            Mode read-only. Penulisan Failure Registry
            belum diaktifkan untuk akses ini.
          </div>
        )}

        {error && (
          <div className={styles.error} role="alert">
            {error}
          </div>
        )}

        {message && (
          <div className={styles.success} role="status">
            {message}
          </div>
        )}

        <div className={styles.workspace}>
          {/* FAILURE LIST */}

          <aside className={styles.sidebar}>
            <div className={styles.sidebarHeader}>
              <div>
                <strong>Failure Registry</strong>
                <small>{failures.length} jenis</small>
              </div>

              <button
                type="button"
                className={styles.primaryButton}
                disabled={!canWrite}
                onClick={() => openDialog("create")}
              >
                + Tambah
              </button>
            </div>

            {loading && (
              <p className={styles.muted}>
                Memuat Failure...
              </p>
            )}

            <div className={styles.failureList}>
              {failures.map((failure) => (
                <button
                  type="button"
                  key={failure.id}
                  aria-pressed={
                    selectedId === failure.id
                  }
                  className={
                    selectedId === failure.id
                      ? styles.activeFailure
                      : styles.failureButton
                  }
                  onClick={() =>
                    setSelectedId(failure.id)
                  }
                >
                  <strong>{failure.name}</strong>
                  <small>{failure.failure}</small>
                </button>
              ))}
            </div>
          </aside>

          {/* FAILURE DETAIL */}

          <section className={styles.detail}>
            {!selected ? (
              <p className={styles.muted}>
                Pilih Failure untuk melihat detailnya.
              </p>
            ) : (
              <>
                <div className={styles.detailHeader}>
                  <div>
                    <p className={styles.eyebrow}>
                      FAILURE DEFINITION #{selected.id}
                    </p>
                    <h2>{selected.name}</h2>
                    <code>{selected.failure}</code>
                  </div>

                  <div className={styles.actions}>
                    <button
                      type="button"
                      className={styles.secondaryButton}
                      disabled={!canWrite}
                      onClick={() => openDialog("edit")}
                    >
                      Edit Nama
                    </button>

                    <button
                      type="button"
                      className={styles.deleteButton}
                      disabled={
                        !canWrite ||
                        CORE.has(selected.failure)
                      }
                      onClick={() => openDialog("delete")}
                    >
                      Hapus
                    </button>
                  </div>
                </div>

                <div className={styles.infoGrid}>
                  <div>
                    <small>STATUS</small>
                    <strong>
                      {getStatus(selected.failure)}
                    </strong>
                  </div>

                  <div>
                    <small>CONFIGURATION SCOPE</small>
                    <strong>
                      {scope === "flowhead"
                        ? "Flowhead"
                        : scope === "vsd"
                          ? "VSD"
                          : "Tidak tersedia"}
                    </strong>
                  </div>

                  <div>
                    <small>ENGINE SUPPORT</small>
                    <strong>
                      {CORE.has(selected.failure)
                        ? "Built-in / Review"
                        : "Coming Soon"}
                    </strong>
                  </div>
                </div>

                {!CORE.has(selected.failure) && (
                  <div className={styles.notice}>
                    <div>
                      <strong>
                        Evaluator Coming Soon
                      </strong>
                      <p>
                        Failure ini sudah terdaftar,
                        tetapi belum memiliki rumus
                        klasifikasi yang dapat dijalankan.
                      </p>
                    </div>
                  </div>
                )}

                {selected.failure === "panel_overheat" && (
                  <div className={styles.notice}>
                    <div>
                      <strong>Pending Review</strong>
                      <p>
                        Threshold Panel Overheat
                        belum ditetapkan.
                      </p>
                    </div>
                  </div>
                )}

                {scope && (
                  <>
                    <h3>Parameter Klasifikasi</h3>

                    <div className={styles.context}>
                      <strong>
                        {scope === "flowhead"
                          ? "Kapasitas Flowhead"
                          : "Tipe VSD"}
                      </strong>

                      <div className={styles.contextOptions}>
                        {contextValues.map((value) => (
                          <button
                            type="button"
                            key={value}
                            className={
                              activeContext === value
                                ? styles.activeContext
                                : styles.contextButton
                            }
                            onClick={() => {
                              if (scope === "flowhead") {
                                setCapacity(value);
                              } else {
                                setVsdType(value);
                              }
                            }}
                          >
                            {scope === "flowhead"
                              ? `FH ${value}`
                              : `VSD ${value}`}
                          </button>
                        ))}
                      </div>
                    </div>

                    {parameterLoading ? (
                      <p className={styles.muted}>
                        Memuat parameter...
                      </p>
                    ) : parameterError ? (
                      <div className={styles.error}>
                        {parameterError}
                      </div>
                    ) : !hasOwnership ? (
                      <div className={styles.notice}>
                        API belum menyertakan relasi
                        failure_id / failure_code.
                        Parameter tidak dapat dipetakan
                        secara aman ke Failure ini.
                      </div>
                    ) : (
                      <ParameterCrudPanel
                        key={`failure:${selected.id}:${scope}:${activeContext}`}
                        scope={scope}
                        context={activeContext}
                        failureId={selected.id}
                        rows={specific}
                        allowedCodes={
                          PARAMETER_CODES[selected.failure] ?? []
                        }
                        canWrite={canWrite}
                        onChanged={() =>
                          setReload((value) => value + 1)
                        }
                      />
                    )}

                    {scope === "flowhead" &&
                      selected &&
                      FREQUENCY_DEPENDENT_FAILURES.has(selected.failure) && (
                        <div className={styles.notice}>
                          <div>
                            <strong>Frequency Setpoint — Pump Configuration</strong>

                            <p>
                              Frequency setpoint merupakan konfigurasi
                              masing-masing Pump ID, bukan konfigurasi
                              bersama berdasarkan kapasitas Flowhead.

                              Pengelolaannya akan dilakukan melalui
                              Pump Configuration.
                            </p>
                          </div>
                        </div>
                      )}

                    {scope === "flowhead" &&
                      !parameterLoading &&
                      !parameterError &&
                      hasOwnership && (
                        <>
                          <h3>Shared Flowhead</h3>
                          <ParameterCrudPanel
                            key={`shared:${activeCapacity}`}
                            scope="flowhead"
                            context={activeCapacity}
                            failureId={null}
                            rows={shared.filter(
                              (row) => row.code !== "frequency_setpoint_hz"
                            )}
                            allowedCodes={SHARED_FLOWHEAD_CODES}
                            canWrite={canWrite}
                            onChanged={() =>
                              setReload((value) => value + 1)
                            }
                          />
                        </>
                      )}
                  </>
                )}

                <h3>Runtime Configuration</h3>
                <ParameterCrudPanel
                  key="runtime-global"
                  scope="runtime"
                  rows={runtime}
                  allowedCodes={RUNTIME_CODES}
                  canWrite={canWrite}
                  onChanged={() =>
                    setReload((value) => value + 1)
                  }
                />

                <p className={styles.muted}>
                  Runtime merupakan konfigurasi global.
                  Tidak semua parameternya digunakan
                  oleh Failure yang sedang dipilih.
                </p>
              </>
            )}
          </section>
        </div>

        {/* CREATE / UPDATE / DELETE DIALOG */}

        {mode && (
          <div className={styles.overlay}>
            <section
              className={styles.dialog}
              role="dialog"
              aria-modal="true"
              aria-labelledby="dialog-title"
            >
              <h2 id="dialog-title">
                {mode === "create"
                  ? "Tambah Failure"
                  : mode === "edit"
                    ? "Edit Failure"
                    : "Hapus Failure"}
              </h2>

              {mode === "delete" ? (
                <p>
                  Yakin menghapus{" "}
                  <strong>{selected?.name}</strong>?
                  Failure yang masih digunakan tidak
                  dapat dihapus.
                </p>
              ) : (
                <>
                  <label>
                    Failure Code
                    <input
                      value={draftCode}
                      disabled={mode !== "create" || saving}
                      placeholder="bearing_overheat"
                      onChange={(event) =>
                        setDraftCode(
                          (event.currentTarget as unknown as {
                            value: string;
                          }).value,
                        )
                      }
                    />
                  </label>

                  <label>
                    Failure Name
                    <input
                      value={draftName}
                      disabled={saving}
                      placeholder="Bearing Overheat"
                      onChange={(event) =>
                        setDraftName(
                          (event.currentTarget as unknown as {
                            value: string;
                          }).value,
                        )
                      }
                    />
                  </label>

                  {mode === "create" && (
                    <p className={styles.muted}>
                      Failure baru belum mempunyai
                      evaluator. Dynamic Rule Engine:
                      Coming Soon.
                    </p>
                  )}
                </>
              )}

              {formError && (
                <div className={styles.error} role="alert">
                  {formError}
                </div>
              )}

              <div className={styles.dialogActions}>
                <button
                  type="button"
                  className={styles.secondaryButton}
                  disabled={saving}
                  onClick={() => setMode(null)}
                >
                  Batal
                </button>

                <button
                  type="button"
                  className={
                    mode === "delete"
                      ? styles.deleteButton
                      : styles.primaryButton
                  }
                  disabled={saving}
                  onClick={() => void submit()}
                >
                  {saving
                    ? "Memproses..."
                    : mode === "delete"
                      ? "Ya, Hapus"
                      : "Simpan"}
                </button>
              </div>
            </section>
          </div>
        )}
      </main>
    </div>
  );
}
