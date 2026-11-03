"use client";

import { useEffect, useState } from "react";
import styles from "./pumpSetpoint.module.css";

interface PumpSetpoint {
  pumpId: string;
  flowhead_capacity: number | string | null;
  vsd_type_id: number | null;
  frequency_setpoint_hz: string | number | null;
}

interface ApiResponse {
  ok: boolean;
  data?: PumpSetpoint;
  error?: string;

  capabilities?: {
    pumpSetpointWrite: boolean;
  };
}

interface Props {
  pumpId: string;
}

function inputValue(target: unknown): string {
  return (target as { value: string }).value;
}

async function parseResponse(
  response: Response,
): Promise<ApiResponse> {
  const payload =
    (await response.json()) as ApiResponse;

  if (!response.ok || payload.ok !== true) {
    throw new Error(
      payload.error ??
        `Request failed: HTTP ${response.status}`,
    );
  }

  return payload;
}

export default function PumpSetpointEditor({
  pumpId,
}: Props) {
  const [setpoint, setSetpoint] =
    useState<PumpSetpoint | null>(null);

  const [draft, setDraft] = useState("");

  const [canWrite, setCanWrite] = useState(false);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const [confirmClear, setConfirmClear] =
    useState(false);

  const [reloadKey, setReloadKey] =
    useState(0);

  // ==========================================================
  // READ SETPOINT
  // ==========================================================

  useEffect(() => {
    const controller = new AbortController();

    setLoading(true);
    setError("");
    setMessage("");
    setSetpoint(null);
    setCanWrite(false);
    setDraft("");
    setConfirmClear(false);

    async function load() {
      try {
        const response = await fetch(
          "/api/config/pump-setpoints?pumpId=" +
            encodeURIComponent(pumpId),
          {
            method: "GET",
            signal: controller.signal,
          },
        );

        const result = await parseResponse(response);

        if (controller.signal.aborted) return;

        if (!result.data) {
          throw new Error(
            "Data Pump Setpoint tidak tersedia",
          );
        }

        setSetpoint(result.data);

        setDraft(
          result.data.frequency_setpoint_hz === null
            ? ""
            : String(
                result.data.frequency_setpoint_hz,
              ),
        );

        setCanWrite(
          result.capabilities?.pumpSetpointWrite === true,
        );
      } catch (cause) {
        if (controller.signal.aborted) return;

        setError(
          cause instanceof Error
            ? cause.message
            : "Gagal membaca Frequency Setpoint",
        );
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }

    void load();

    return () => controller.abort();
  }, [pumpId, reloadKey]);

  // ==========================================================
  // PATCH REQUEST
  // ==========================================================

  async function save(
    value: string | null,
  ) {
    if (!canWrite || saving || loading) {
      return;
    }

    if (value !== null) {
      const normalized = value.trim();
      const parsed = Number(normalized);

      if (
        !/^\d+(\.\d{1,2})?$/.test(normalized) ||
        !Number.isFinite(parsed) ||
        parsed <= 0 ||
        parsed > 999999.99
      ) {
        setError(
          "Masukkan nilai positif dengan maksimal dua desimal",
        );

        return;
      }
    }

    setSaving(true);
    setError("");
    setMessage("");

    try {
      const response = await fetch(
        "/api/config/pump-setpoints",
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },

          body: JSON.stringify({
            pumpId,
            frequency_setpoint_hz: value,
          }),
        },
      );

      const result = await parseResponse(response);

      if (!result.data) {
        throw new Error(
          "Respons penyimpanan tidak valid",
        );
      }

      setSetpoint(result.data);

      setDraft(
        result.data.frequency_setpoint_hz === null
          ? ""
          : String(
              result.data.frequency_setpoint_hz,
            ),
      );

      setConfirmClear(false);

      setMessage(
        value === null
          ? "Frequency Setpoint berhasil dikosongkan"
          : "Frequency Setpoint berhasil disimpan",
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Gagal menyimpan Frequency Setpoint",
      );
    } finally {
      setSaving(false);
    }
  }

  // ==========================================================
  // UI
  // ==========================================================

  const configured =
    setpoint?.frequency_setpoint_hz !== null &&
    setpoint?.frequency_setpoint_hz !== undefined;

  return (
    <section className={styles.card}>
      <div className={styles.heading}>
        <div>
          <div className={styles.eyebrow}>
            PUMP CONFIGURATION
          </div>

          <h3>Frequency Setpoint</h3>

          <p>
            Konfigurasi frekuensi berdasarkan
            identitas pompa.
          </p>
        </div>

        <span
          className={
            configured
              ? styles.configured
              : styles.notConfigured
          }
        >
          {loading
            ? "LOADING"
            : configured
              ? "CONFIGURED"
              : "NOT CONFIGURED"}
        </span>
      </div>

      {loading ? (
        <p className={styles.muted}>
          Membaca Frequency Setpoint...
        </p>
      ) : (
        <>
          <div className={styles.info}>
            <div>
              <span>PUMP ID</span>
              <strong>{pumpId}</strong>
            </div>

            <div>
              <span>FREQUENCY SETPOINT</span>

              <strong>
                {configured
                  ? `${setpoint?.frequency_setpoint_hz} Hz`
                  : "—"}
              </strong>
            </div>

            <div>
              <span>CONFIGURATION SOURCE</span>
              <strong>pumps</strong>
            </div>
          </div>

          <label className={styles.field}>
            Frequency Setpoint (Hz)

            <div className={styles.inputRow}>
              <input
                type="text"
                inputMode="decimal"
                placeholder="Belum dikonfigurasi"
                value={draft}
                disabled={!canWrite || saving}
                onChange={(event) => {
                  setDraft(
                    inputValue(event.currentTarget),
                  );

                  setConfirmClear(false);
                }}
              />

              <span>Hz</span>
            </div>
          </label>

          <div className={styles.actions}>
            <button
              type="button"
              className={styles.save}
              disabled={!canWrite || saving}
              onClick={() => void save(draft)}
            >
              {saving
                ? "Menyimpan..."
                : configured
                  ? "Update Setpoint"
                  : "Set Frequency"}
            </button>

            <button
              type="button"
              className={styles.refresh}
              disabled={saving}
              onClick={() =>
                setReloadKey((value) => value + 1)
              }
            >
              Refresh
            </button>

            {configured && canWrite && (
              <button
                type="button"
                className={styles.clear}
                disabled={saving}
                onClick={() =>
                  setConfirmClear(true)
                }
              >
                Clear
              </button>
            )}
          </div>

          {confirmClear && (
            <div className={styles.confirm}>
              <strong>
                Konfirmasi Clear Setpoint
              </strong>

              <p>
                Frequency Setpoint Pump {pumpId}
                akan dikembalikan menjadi NULL.
              </p>

              <div className={styles.actions}>
                <button
                  type="button"
                  className={styles.clear}
                  disabled={saving}
                  onClick={() => void save(null)}
                >
                  Ya, Kosongkan
                </button>

                <button
                  type="button"
                  className={styles.refresh}
                  disabled={saving}
                  onClick={() =>
                    setConfirmClear(false)
                  }
                >
                  Batal
                </button>
              </div>
            </div>
          )}

          {message && (
            <div
              className={styles.success}
              role="status"
            >
              {message}
            </div>
          )}

          {error && (
            <div
              className={styles.error}
              role="alert"
            >
              {error}
            </div>
          )}

          {!canWrite && (
            <p className={styles.muted}>
              Mode read-only. Pengubahan Frequency
              Setpoint belum diizinkan untuk
              akses ini.
            </p>
          )}

          <p className={styles.note}>
            Frequency Setpoint mengikuti Pump ID,
            bukan kapasitas Flowhead. Nilai harus
            berasal dari referensi operasional
            pompa yang telah diverifikasi.
          </p>
        </>
      )}
    </section>
  );
}