
"use client";

import { useEffect, useState } from "react";
import styles from "./config.module.css";
import PumpSetpointEditor from "./PumpSetpointEditor.js";

// ============================================================
// TYPES — MATCH EXISTING DEXMIN API
// ============================================================

interface PumpRow {
  id: number;
  pumpId: string;
  flowhead_capacity: string | number;
  vsd_type_id: number;
}

interface ConfigEntry {
  code: string;
  name?: string;
  numeric_value: string | number;
  unit: string;
  source: string;
  updated_at?: string;
}

interface EffectiveConfiguration {
  pump: PumpRow;
  flowhead: ConfigEntry[];
  vfd: ConfigEntry[];
  runtime: ConfigEntry[];
  missing: string[];
}

interface ApiResponse<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

// ============================================================
// API CLIENT — READ ONLY
// ============================================================

async function fetchConfig<T>(
  endpoint: string,
  signal: AbortSignal,
): Promise<T> {
  const response = await fetch(endpoint, {
    method: "GET",
    signal,
  });

  const payload = (await response.json()) as ApiResponse<T>;

  if (
    !response.ok ||
    payload.ok !== true ||
    payload.data === undefined
  ) {
    throw new Error(
      payload.error ??
      `API request failed: HTTP ${response.status}`,
    );
  }

  return payload.data;
}

// ============================================================
// DISPLAY HELPERS
// ============================================================

function formatCapacity(
  value: string | number,
): string {
  const number = Number(value);

  return Number.isFinite(number)
    ? new Intl.NumberFormat("id-ID").format(number)
    : String(value);
}

function ErrorMessage({
  message,
}: {
  message: string;
}) {
  return (
    <div className={styles.error} role="alert">
      <strong>Gagal memuat data</strong>
      <p>{message}</p>
    </div>
  );
}

// ============================================================
// PAGE
// ============================================================

export default function ConfigurationPage() {
  const [pumps, setPumps] = useState<PumpRow[]>([]);
  const [selectedPumpId, setSelectedPumpId] =
    useState("");

  const [configuration, setConfiguration] =
    useState<EffectiveConfiguration | null>(null);

  const [pumpsLoading, setPumpsLoading] =
    useState(true);

  const [configurationLoading, setConfigurationLoading] =
    useState(false);

  const [pumpsError, setPumpsError] =
    useState("");

  const [configurationError, setConfigurationError] =
    useState("");

  const [reloadKey, setReloadKey] = useState(0);

  // ==========================================================
  // LOAD PUMP LIST
  // ==========================================================

  useEffect(() => {
    const controller = new AbortController();

    async function loadPumps() {
      setPumpsLoading(true);
      setPumpsError("");

      try {
        const result = await fetchConfig<PumpRow[]>(
          "/api/config/pumps",
          controller.signal,
        );

        if (!Array.isArray(result)) {
          throw new Error(
            "Format data pompa tidak sesuai kontrak API",
          );
        }

        if (controller.signal.aborted) return;

        setPumps(result);

        setSelectedPumpId((current) => {
          if (
            result.some(
              (pump) => pump.pumpId === current,
            )
          ) {
            return current;
          }

          return result[0]?.pumpId ?? "";
        });
      } catch (error) {
        if (controller.signal.aborted) return;

        setPumps([]);
        setSelectedPumpId("");

        setPumpsError(
          error instanceof Error
            ? error.message
            : "Gagal membaca daftar pompa",
        );
      } finally {
        if (!controller.signal.aborted) {
          setPumpsLoading(false);
        }
      }
    }

    void loadPumps();

    return () => controller.abort();
  }, [reloadKey]);

  // ==========================================================
  // LOAD EFFECTIVE CONFIGURATION
  // ==========================================================

  useEffect(() => {
    const controller = new AbortController();

    if (!selectedPumpId) {
      setConfiguration(null);
      setConfigurationLoading(false);
      setConfigurationError("");
      return () => controller.abort();
    }

    async function loadConfiguration() {
      setConfiguration(null);
      setConfigurationLoading(true);
      setConfigurationError("");

      try {
        const endpoint =
          "/api/config/effective?pumpId=" +
          encodeURIComponent(selectedPumpId);

        const result =
          await fetchConfig<EffectiveConfiguration>(
            endpoint,
            controller.signal,
          );

        if (
          !result ||
          !result.pump ||
          !Array.isArray(result.flowhead) ||
          !Array.isArray(result.vfd) ||
          !Array.isArray(result.runtime) ||
          !Array.isArray(result.missing)
        ) {
          throw new Error(
            "Format konfigurasi efektif tidak sesuai kontrak API",
          );
        }

        if (controller.signal.aborted) return;

        setConfiguration(result);
      } catch (error) {
        if (controller.signal.aborted) return;

        setConfigurationError(
          error instanceof Error
            ? error.message
            : "Gagal membaca konfigurasi efektif",
        );
      } finally {
        if (!controller.signal.aborted) {
          setConfigurationLoading(false);
        }
      }
    }

    void loadConfiguration();

    return () => controller.abort();
  }, [selectedPumpId, reloadKey]);

  // ==========================================================
  // DERIVED VALUES
  // ==========================================================

  const selectedPump =
    pumps.find(
      (pump) => pump.pumpId === selectedPumpId,
    ) ?? null;

  const missing = configuration?.missing ?? [];

  const summary = [
    {
      label: "Flowhead",
      count: configuration?.flowhead.length ?? 0,
      description: "Parameter kapasitas pompa",
      category: "FLOWHEAD",
    },
    {
      label: "VSD",
      count: configuration?.vfd.length ?? 0,
      description: "Parameter tipe penggerak",
      category: "VSD",
    },
    {
      label: "Runtime",
      count: configuration?.runtime.length ?? 0,
      description: "Parameter operasional bersama",
      category: "RUNTIME",
    },
  ];

  // ==========================================================
  // UI
  // ==========================================================

  return (
    <div className={styles.app}>
      <header className={styles.topbar}>
        <div className={styles.brand}>
          <div className={styles.brandMark}>D</div>
          <div>
            <div className={styles.brandName}>DEXMIN</div>
            <div className={styles.brandSubtitle}>
              Configuration Management
            </div>
          </div>
        </div>

        <span className={styles.readOnlyBadge}>
          READ ONLY · 8A
        </span>
      </header>

      <main className={styles.container}>
        <div className={styles.pageHeading}>
          <div>
            <div className={styles.eyebrow}>
              CONFIGURATION / OVERVIEW
            </div>

            <h1>Konfigurasi Pompa</h1>

            <p>
              Lihat konfigurasi efektif setiap pompa
              berdasarkan kapasitas Flowhead, tipe VSD,
              dan parameter Runtime.
            </p>
          </div>

          <button
            type="button"
            className={styles.refreshButton}
            onClick={() =>
              setReloadKey((value) => value + 1)
            }
          >
            Muat ulang data
          </button>
        </div>

        <div className={styles.workspace}>
          {/* ===========================================
              PUMP SELECTOR
          =========================================== */}

          <aside className={styles.sidebar}>
            <div className={styles.sidebarHeading}>
              <div>
                <h2>Daftar Pompa</h2>
                <p>Pilih perangkat</p>
              </div>

              <span className={styles.countBadge}>
                {pumps.length}
              </span>
            </div>

            {pumpsLoading && (
              <p className={styles.muted} role="status">
                Memuat daftar pompa...
              </p>
            )}

            {pumpsError && (
              <ErrorMessage message={pumpsError} />
            )}

            {!pumpsLoading &&
              !pumpsError &&
              pumps.length === 0 && (
                <p className={styles.muted}>
                  Belum ada pompa terdaftar.
                </p>
              )}

            <div className={styles.pumpList}>
              {pumps.map((pump) => {
                const active =
                  pump.pumpId === selectedPumpId;

                return (
                  <button
                    type="button"
                    key={pump.pumpId}
                    onClick={() =>
                      setSelectedPumpId(pump.pumpId)
                    }
                    aria-pressed={active}
                    className={[
                      styles.pumpButton,
                      active ? styles.pumpActive : "",
                    ].join(" ")}
                  >
                    <span className={styles.pumpSymbol}>
                      P
                    </span>

                    <span className={styles.pumpText}>
                      <strong>
                        Pump {pump.pumpId}
                      </strong>
                      <small>
                        FH {formatCapacity(
                          pump.flowhead_capacity,
                        )}{" "}
                        · VSD {pump.vsd_type_id}
                      </small>
                    </span>

                    <span
                      className={styles.selectionIndicator}
                    />
                  </button>
                );
              })}
            </div>

            <div className={styles.sidebarFooter}>
              <span className={styles.statusDot} />
              Data bersumber dari MySQL DEXMIN
            </div>
          </aside>

          {/* ===========================================
              CONFIGURATION OVERVIEW
          =========================================== */}

          <section
            className={styles.content}
            aria-live="polite"
          >
            {!selectedPump && !pumpsLoading && (
              <div className={styles.placeholder}>
                Pilih pompa untuk melihat konfigurasinya.
              </div>
            )}

            {selectedPump && (
              <>
                <div className={styles.pumpHeader}>
                  <div>
                    <div className={styles.eyebrow}>
                      SELECTED EQUIPMENT
                    </div>

                    <h2>
                      Pump {selectedPump.pumpId}
                    </h2>

                    <p>
                      Ringkasan konfigurasi efektif
                      perangkat terdaftar.
                    </p>
                  </div>

                  <span className={styles.equipmentBadge}>
                    Pump ID: {selectedPump.pumpId}
                  </span>
                </div>

                <div className={styles.equipmentGrid}>
                  <div className={styles.equipmentField}>
                    <span>FLOWHEAD CAPACITY</span>
                    <strong>
                      {formatCapacity(
                        selectedPump.flowhead_capacity,
                      )}
                    </strong>
                  </div>

                  <PumpSetpointEditor
                    key={selectedPump.pumpId}
                    pumpId={selectedPump.pumpId}
                  />

                  <div className={styles.equipmentField}>
                    <span>VSD TYPE</span>
                    <strong>
                      {selectedPump.vsd_type_id}
                    </strong>
                  </div>

                  <div className={styles.equipmentField}>
                    <span>CONFIGURATION SOURCE</span>
                    <strong>MySQL</strong>
                  </div>
                </div>

                {configurationLoading && (
                  <div
                    className={styles.loading}
                    role="status"
                  >
                    Membaca konfigurasi efektif...
                  </div>
                )}

                {configurationError && (
                  <ErrorMessage
                    message={configurationError}
                  />
                )}

                {configuration &&
                  !configurationLoading && (
                    <>
                      <div className={styles.sectionHeading}>
                        <div>
                          <h3>Parameter Overview</h3>
                          <p>
                            Jumlah parameter yang tersedia
                            untuk pompa terpilih.
                          </p>
                        </div>
                      </div>

                      <div className={styles.summaryGrid}>
                        {summary.map((item) => (
                          <div
                            className={styles.summaryCard}
                            key={item.category}
                          >
                            <div className={styles.cardCategory}>
                              {item.category}
                            </div>

                            <div className={styles.cardValue}>
                              {item.count}
                            </div>

                            <div className={styles.cardLabel}>
                              {item.label}
                            </div>

                            <p>{item.description}</p>
                          </div>
                        ))}
                      </div>

                      <section className={styles.readinessPanel}>
                        <div className={styles.readinessHeading}>
                          <div>
                            <h3>Kelengkapan Konfigurasi</h3>
                            <p>
                              Berdasarkan daftar parameter
                              missing dari API.
                            </p>
                          </div>

                          <span
                            className={
                              missing.length > 0
                                ? styles.warningBadge
                                : styles.neutralBadge
                            }
                          >
                            {missing.length} missing
                          </span>
                        </div>

                        {missing.length > 0 ? (
                          <div className={styles.missingList}>
                            {missing.map((code) => (
                              <div
                                className={styles.missingItem}
                                key={code}
                              >
                                <span className={styles.warningDot} />
                                <code>{code}</code>
                                <span>Belum tersedia</span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className={styles.noMissing}>
                            API tidak melaporkan parameter
                            yang belum tersedia.
                          </p>
                        )}

                        <p className={styles.readinessNote}>
                          Kelengkapan parameter tidak
                          otomatis menyatakan evaluator
                          siap digunakan. Penilaian
                          readiness per Failure dilakukan
                          pada tahap berikutnya.
                        </p>
                      </section>
                    </>
                  )}
              </>
            )}
          </section>
        </div>

        <footer className={styles.footer}>
          DEXMIN · Configuration Management ·
          Tahap 8A · Read-only
        </footer>
      </main>
    </div>
  );
}
