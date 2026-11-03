"use client";

import { useState } from "react";
import styles from "./ParameterCrudPanel.module.css";

export interface ConfigParameter {
    code: string;
    name?: string;
    numeric_value: number | string;
    unit?: string;

    failure_id?: number | null;
    failure_code?: string | null;

    updated_at?: string;
}

type ConfigScope = "flowhead" | "vsd" | "runtime";

type Action = "create" | "edit" | "delete" | null;

interface Props {
    scope: ConfigScope;
    context?: string;

    failureId?: number | null;

    rows: ConfigParameter[];
    allowedCodes: readonly string[];

    canWrite: boolean;

    onChanged: () => void;
}

type ApiResponse = {
    ok: boolean;
    error?: string | { message?: string };
};

const OPTIONAL_SHARED_CODES = new Set([
    "power_ref_kw",
    "current_ref_a",
    "rpm_setpoint",
    "torque_setpoint_pct",
]);

const DEFAULT_UNITS: Record<string, string> = {
    power_ref_kw: "kW",
    current_ref_a: "A",
    rpm_setpoint: "RPM",
    torque_setpoint_pct: "%",
    frequency_setpoint_hz: "Hz",

    pts_frequency_hz: "Hz",
    pts_power_ref_kw: "kW",
    pts_current_ref_a: "A",
    pts_torque_ref_pct: "%",
    pts_rpm_ref: "RPM",

    turbulensi_power_ref_kw: "kW",
    turbulensi_torque_ref_pct: "%",
    turbulensi_current_dev_threshold_a: "A",

    banyak_sampah_power_ref_kw: "kW",
    banyak_sampah_current_ref_a: "A",
    banyak_sampah_torque_ref_pct: "%",

    dry_run_power_factor: "%",
    dry_run_current_factor: "%",
    dry_run_torque_threshold_pct: "%",

    unbalance_threshold_pct: "%",
    undervoltage_threshold_v: "V",
    overvoltage_threshold_v: "V",
};

function readInputValue(
    target: unknown,
): string {
    return (target as { value: string }).value;
}

function humanize(code: string): string {
    return code
        .split("_")
        .map((part) =>
            part.length > 0
                ? part.charAt(0).toUpperCase() + part.slice(1)
                : part,
        )
        .join(" ");
}

function getApiUrl(
    scope: ConfigScope,
    context?: string,
    code?: string,
): string {
    const params = new URLSearchParams();

    if (scope === "flowhead" && context) {
        params.set("capacity", context);
    }

    if (scope === "vsd" && context) {
        params.set("vsdTypeId", context);
    }

    if (code) {
        params.set("code", code);
    }

    const query = params.toString();

    return `/api/config/${scope}${query ? `?${query}` : ""}`;
}

function getErrorMessage(payload: ApiResponse): string {
    if (typeof payload.error === "string") {
        return payload.error;
    }

    if (
        payload.error &&
        typeof payload.error.message === "string"
    ) {
        return payload.error.message;
    }

    return "Operasi konfigurasi gagal";
}

async function writeConfig(
    method: "POST" | "PATCH" | "DELETE",
    url: string,
    body: Record<string, unknown>,
): Promise<void> {
    const response = await fetch(url, {
        method,
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
    });

    const result = (await response.json()) as ApiResponse;

    if (!response.ok || result.ok !== true) {
        throw new Error(getErrorMessage(result));
    }
}

export default function ParameterCrudPanel({
    scope,
    context,
    failureId,
    rows,
    allowedCodes,
    canWrite,
    onChanged,
}: Props) {
    const [action, setAction] = useState<Action>(null);

    const [target, setTarget] =
        useState<ConfigParameter | null>(null);

    const [draftCode, setDraftCode] = useState("");
    const [draftName, setDraftName] = useState("");
    const [draftValue, setDraftValue] = useState("");
    const [draftUnit, setDraftUnit] = useState("");

    const [saving, setSaving] = useState(false);

    const [error, setError] = useState("");
    const [message, setMessage] = useState("");

    const validContext =
        scope === "runtime" ||
        (
            context !== undefined &&
            Number.isSafeInteger(Number(context)) &&
            Number(context) > 0
        );

    const writable = canWrite && validContext;

    const existingCodes = new Set(
        rows.map((row) => row.code),
    );

    const missingCodes = allowedCodes.filter(
        (code) => !existingCodes.has(code),
    );

    const canCreate =
        writable && missingCodes.length > 0;

    function resetAction() {
        setAction(null);
        setTarget(null);
        setError("");
    }

    function openCreate() {
        if (!canCreate) return;

        const firstCode = missingCodes[0];

        setTarget(null);

        setDraftCode(firstCode);
        setDraftName(humanize(firstCode));
        setDraftValue("");
        setDraftUnit(DEFAULT_UNITS[firstCode] ?? "");

        setError("");
        setMessage("");
        setAction("create");
    }

    function openEdit(row: ConfigParameter) {
        if (!writable) return;

        setTarget(row);

        setDraftCode(row.code);
        setDraftName(row.name ?? row.code);
        setDraftValue(String(row.numeric_value));
        setDraftUnit(row.unit ?? "");

        setError("");
        setMessage("");
        setAction("edit");
    }

    function canDelete(row: ConfigParameter): boolean {
        return (
            writable &&
            scope === "flowhead" &&
            failureId === null &&
            OPTIONAL_SHARED_CODES.has(row.code)
        );
    }

    function openDelete(row: ConfigParameter) {
        if (!canDelete(row)) return;

        setTarget(row);

        setDraftCode(row.code);
        setDraftName(row.name ?? row.code);

        setError("");
        setMessage("");
        setAction("delete");
    }

    function changeCode(code: string) {
        setDraftCode(code);
        setDraftName(humanize(code));
        setDraftUnit(DEFAULT_UNITS[code] ?? "");
    }

    async function submit() {
        if (!action || !writable || saving) return;

        setSaving(true);
        setError("");
        setMessage("");

        try {
            const url = getApiUrl(
                scope,
                context,
                action === "delete" ? draftCode : undefined,
            );

            if (action === "create") {
                if (!missingCodes.includes(draftCode)) {
                    throw new Error(
                        "Kode parameter tidak tersedia untuk dibuat",
                    );
                }

                if (!draftName.trim()) {
                    throw new Error("Nama parameter wajib diisi");
                }

                if (!draftUnit.trim()) {
                    throw new Error("Satuan parameter wajib diisi");
                }

                const numeric = Number(draftValue);

                if (
                    !/^\d+(\.\d{1,2})?$/.test(draftValue) ||
                    !Number.isFinite(numeric) ||
                    numeric <= 0
                ) {
                    throw new Error(
                        "Nilai harus positif, maksimal dua angka desimal",
                    );
                }

                const payload: Record<string, unknown> = {
                    code: draftCode,
                    name: draftName.trim(),
                    numeric_value: draftValue,
                    unit: draftUnit.trim(),
                };

                if (scope !== "runtime") {
                    payload.failure_id = failureId ?? null;
                }

                await writeConfig("POST", url, payload);
            }

            if (action === "edit") {
                if (!target) {
                    throw new Error("Parameter tidak dipilih");
                }

                const numeric = Number(draftValue);

                if (
                    !/^\d+(\.\d{1,2})?$/.test(draftValue) ||
                    !Number.isFinite(numeric) ||
                    numeric <= 0
                ) {
                    throw new Error(
                        "Nilai harus positif, maksimal dua angka desimal",
                    );
                }

                await writeConfig("PATCH", url, {
                    code: target.code,
                    numeric_value: draftValue,
                });
            }

            if (action === "delete") {
                if (!target || !canDelete(target)) {
                    throw new Error(
                        "Parameter ini tidak boleh dihapus",
                    );
                }

                await writeConfig("DELETE", url, {
                    code: target.code,
                });
            }

            const successMessage =
                action === "create"
                    ? "Parameter berhasil ditambahkan"
                    : action === "edit"
                        ? "Nilai parameter berhasil diperbarui"
                        : "Parameter berhasil dihapus";

            resetAction();
            setMessage(successMessage);

            // Membaca ulang dari MySQL melalui dashboard.
            onChanged();
        } catch (cause) {
            setError(
                cause instanceof Error
                    ? cause.message
                    : "Operasi gagal",
            );
        } finally {
            setSaving(false);
        }
    }

    return (
        <section className={styles.panel}>
            <div className={styles.heading}>
                <div>
                    <strong>Configuration Parameters</strong>
                    <p>
                        {rows.length} parameter tersedia
                    </p>
                </div>

                <button
                    type="button"
                    className={styles.addButton}
                    disabled={!canCreate || saving}
                    onClick={openCreate}
                >
                    + Tambah Parameter
                </button>
            </div>

            {message && (
                <div className={styles.success} role="status">
                    {message}
                </div>
            )}

            {rows.length === 0 ? (
                <div className={styles.empty}>
                    Belum ada parameter tersimpan.
                </div>
            ) : (
                <div className={styles.tableWrapper}>
                    <table className={styles.table}>
                        <thead>
                            <tr>
                                <th>Parameter</th>
                                <th>Code</th>
                                <th>Nilai</th>
                                <th>Unit</th>
                                <th>Action</th>
                            </tr>
                        </thead>

                        <tbody>
                            {rows.map((row) => (
                                <tr key={row.code}>
                                    <td>
                                        {row.name || row.code}
                                    </td>

                                    <td>
                                        <code>{row.code}</code>
                                    </td>

                                    <td className={styles.numeric}>
                                        {String(row.numeric_value)}
                                    </td>

                                    <td>{row.unit || "-"}</td>

                                    <td>
                                        <div className={styles.actions}>
                                            <button
                                                type="button"
                                                className={styles.editButton}
                                                disabled={!writable}
                                                onClick={() => openEdit(row)}
                                            >
                                                Edit
                                            </button>

                                            <span
                                                title={
                                                    !writable
                                                        ? "Akses tulis tidak tersedia"
                                                        : canDelete(row)
                                                            ? "Hapus parameter opsional"
                                                            : "Parameter wajib atau tidak diizinkan untuk dihapus"
                                                }
                                            >
                                                <button
                                                    type="button"
                                                    className={styles.deleteButton}
                                                    disabled={!canDelete(row)}
                                                    onClick={() => openDelete(row)}
                                                >
                                                    Hapus
                                                </button>
                                            </span>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {missingCodes.length > 0 && (
                <div className={styles.missing}>
                    <strong>
                        Parameter terdaftar yang belum tersedia:
                    </strong>

                    <div className={styles.missingCodes}>
                        {missingCodes.map((code) => (
                            <code key={code}>{code}</code>
                        ))}
                    </div>
                </div>
            )}

            {!writable && (
                <p className={styles.readOnly}>
                    Pengubahan parameter hanya tersedia pada
                    development lokal dengan akses tulis yang
                    diizinkan.
                </p>
            )}

            {action && (
                <div className={styles.overlay}>
                    <div
                        className={styles.dialog}
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="parameter-dialog-title"
                    >
                        <h2 id="parameter-dialog-title">
                            {action === "create"
                                ? "Tambah Parameter"
                                : action === "edit"
                                    ? "Edit Parameter"
                                    : "Hapus Parameter"}
                        </h2>

                        {action === "delete" ? (
                            <div className={styles.warning}>
                                <strong>
                                    Konfirmasi penghapusan
                                </strong>

                                <p>
                                    Parameter{" "}
                                    <code>{target?.code}</code>{" "}
                                    akan dihapus dari konfigurasi.
                                </p>

                                <p>
                                    Operasi ini dapat memengaruhi
                                    klasifikasi yang menggunakan
                                    konfigurasi tersebut.
                                </p>
                            </div>
                        ) : (
                            <>
                                <label className={styles.field}>
                                    Parameter Code

                                    {action === "create" ? (
                                        <select
                                            value={draftCode}
                                            disabled={saving}
                                            onChange={(event) =>
                                                changeCode(
                                                    readInputValue(
                                                        event.currentTarget,
                                                    ),
                                                )
                                            }
                                        >
                                            {missingCodes.map((code) => (
                                                <option
                                                    key={code}
                                                    value={code}
                                                >
                                                    {code}
                                                </option>
                                            ))}
                                        </select>
                                    ) : (
                                        <input
                                            value={draftCode}
                                            disabled
                                            readOnly
                                        />
                                    )}
                                </label>

                                {action === "create" && (
                                    <label className={styles.field}>
                                        Parameter Name

                                        <input
                                            value={draftName}
                                            disabled={saving}
                                            onChange={(event) =>
                                                setDraftName(
                                                    readInputValue(
                                                        event.currentTarget,
                                                    ),
                                                )
                                            }
                                        />
                                    </label>
                                )}

                                <label className={styles.field}>
                                    Numeric Value

                                    <input
                                        type="text"
                                        inputMode="decimal"
                                        value={draftValue}
                                        disabled={saving}
                                        placeholder="Masukkan nilai"
                                        onChange={(event) =>
                                            setDraftValue(
                                                readInputValue(
                                                    event.currentTarget,
                                                ),
                                            )
                                        }
                                    />
                                </label>

                                <label className={styles.field}>
                                    Unit

                                    <input
                                        value={draftUnit}
                                        disabled={action !== "create" || saving}
                                        readOnly={action !== "create"}
                                        onChange={(event) =>
                                            setDraftUnit(
                                                readInputValue(
                                                    event.currentTarget,
                                                ),
                                            )
                                        }
                                    />
                                </label>
                            </>
                        )}

                        {error && (
                            <div
                                className={styles.error}
                                role="alert"
                            >
                                {error}
                            </div>
                        )}

                        <div className={styles.dialogActions}>
                            <button
                                type="button"
                                className={styles.cancelButton}
                                disabled={saving}
                                onClick={resetAction}
                            >
                                Batal
                            </button>

                            <button
                                type="button"
                                className={
                                    action === "delete"
                                        ? styles.deleteButton
                                        : styles.saveButton
                                }
                                disabled={saving}
                                onClick={() => void submit()}
                            >
                                {saving
                                    ? "Menyimpan..."
                                    : action === "delete"
                                        ? "Konfirmasi Hapus"
                                        : "Simpan"}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </section>
    );
}