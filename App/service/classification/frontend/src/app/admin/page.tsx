"use client";

import { useEffect, useState } from "react";
import { getProfileSetpoints, saveProfileSetpoint, type ProfileSetpoint } from "../api";

const PROFILES = ["500_lps", "3000_lps", "5000_lps"] as const;

export default function AdminPage() {
  const [setpoints, setSetpoints] = useState<Record<string, ProfileSetpoint>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [message, setMessage] = useState<Record<string, string>>({});
  const [inputs, setInputs] = useState<Record<string, { freq: string; rpm: string; torque: string }>>({});

  useEffect(() => {
    void (async () => {
      setLoading(true);
      try {
        const data = await getProfileSetpoints();
        setSetpoints(data);
        const init: Record<string, { freq: string; rpm: string; torque: string }> = {};
        for (const pid of PROFILES) {
          const sp = data[pid];
          init[pid] = {
            freq: sp?.frequency_hz != null ? String(sp.frequency_hz) : "",
            rpm: sp?.rpm != null ? String(sp.rpm) : "",
            torque: sp?.torque != null ? String(sp.torque) : "",
          };
        }
        setInputs(init);
      } catch (e) {
        setMessage({ _global: e instanceof Error ? e.message : "Gagal load" });
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function handleSave(profileId: string) {
    const inp = inputs[profileId];
    if (!inp) return;
    setSaving(profileId);
    setMessage((prev) => ({ ...prev, [profileId]: "" }));
    try {
      const freq = inp.freq.trim() === "" ? null : Number(inp.freq);
      const rpm = inp.rpm.trim() === "" ? null : Number(inp.rpm);
      const torque = inp.torque.trim() === "" ? null : Number(inp.torque);
      if (freq !== null && (!Number.isFinite(freq) || freq < 0)) throw new Error("frequency_hz >=0");
      if (rpm !== null && (!Number.isFinite(rpm) || rpm < 0)) throw new Error("rpm >=0");
      if (torque !== null && (!Number.isFinite(torque) || torque < 0)) throw new Error("torque >=0");
      const saved = await saveProfileSetpoint(profileId, { frequency_hz: freq, rpm: rpm, torque: torque });
      setSetpoints((prev) => ({ ...prev, [profileId]: saved }));
      setMessage((prev) => ({ ...prev, [profileId]: "Tersimpan — otomatis di profile_setpoints.json" }));
      setTimeout(() => setMessage((prev) => ({ ...prev, [profileId]: "" })), 2000);
    } catch (e) {
      setMessage((prev) => ({ ...prev, [profileId]: e instanceof Error ? e.message : "Gagal simpan" }));
    } finally {
      setSaving(null);
    }
  }

  if (loading) return <div className="dashboard"><p>Memuat setpoint...</p></div>;

  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <div>
          <p className="eyebrow">Admin • Konfigurasi</p>
          <h1>Setpoint Profil Pompa</h1>
          <p style={{ margin: "0.35rem 0 0", fontSize: "0.8rem", color: "#6b7280" }}>
            Perubahan disimpan otomatis ke <code>profile_setpoints.json</code> via <code>PUT /profile-setpoints/{'{profile_id}'}</code> dan langsung dipakai engine tanpa restart. Kosongkan untuk null.
          </p>
        </div>
      </header>

      {message._global && <p className="message">{message._global}</p>}

      <div style={{ display: "grid", gap: "1rem" }}>
        {PROFILES.map((pid) => {
          const inp = inputs[pid] || { freq: "", rpm: "", torque: "" };
          const current = setpoints[pid];
          return (
            <div key={pid} className="chart-card">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <h2 style={{ margin: 0 }}>{pid}</h2>
                <span style={{ fontSize: "0.75rem", color: "#6b7280", background: "#f3f4f6", padding: "0.25rem 0.5rem", borderRadius: 999 }}>
                  {current ? `freq ${current.frequency_hz ?? "null"} • rpm ${current.rpm ?? "null"} • torque ${current.torque ?? "null"}` : "memuat..."}
                </span>
              </div>

              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", marginTop: "1rem", alignItems: "end" }}>
                <label style={{ display: "grid", gap: "0.25rem", fontSize: "0.8rem" }}>
                  Frequency Hz
                  <input
                    type="number"
                    min={0}
                    step={0.1}
                    value={inp.freq}
                    onChange={(e) => setInputs((prev) => ({ ...prev, [pid]: { ...prev[pid], freq: e.target.value } }))}
                    placeholder="null"
                    style={{ padding: "0.55rem", border: "1px solid #d1d5db", borderRadius: 8, width: 140 }}
                  />
                </label>
                <label style={{ display: "grid", gap: "0.25rem", fontSize: "0.8rem" }}>
                  RPM
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={inp.rpm}
                    onChange={(e) => setInputs((prev) => ({ ...prev, [pid]: { ...prev[pid], rpm: e.target.value } }))}
                    placeholder="null"
                    style={{ padding: "0.55rem", border: "1px solid #d1d5db", borderRadius: 8, width: 140 }}
                  />
                </label>
                <label style={{ display: "grid", gap: "0.25rem", fontSize: "0.8rem" }}>
                  Torque
                  <input
                    type="number"
                    min={0}
                    step={0.1}
                    value={inp.torque}
                    onChange={(e) => setInputs((prev) => ({ ...prev, [pid]: { ...prev[pid], torque: e.target.value } }))}
                    placeholder="null"
                    style={{ padding: "0.55rem", border: "1px solid #d1d5db", borderRadius: 8, width: 140 }}
                  />
                </label>
                <button
                  type="button"
                  disabled={saving === pid}
                  onClick={() => handleSave(pid)}
                  style={{
                    padding: "0.6rem 1rem",
                    borderRadius: 8,
                    border: "1px solid #2563eb",
                    background: saving === pid ? "#93c5fd" : "#2563eb",
                    color: "white",
                    cursor: saving === pid ? "not-allowed" : "pointer",
                  }}
                >
                  {saving === pid ? "Menyimpan..." : "Simpan"}
                </button>
                {message[pid] && (
                  <span style={{ fontSize: "0.8rem", color: message[pid].includes("Tersimpan") ? "#16a34a" : "#dc2626" }}>
                    {message[pid]}
                  </span>
                )}
              </div>

              <p style={{ fontSize: "0.7rem", color: "#9ca3af", marginTop: "0.5rem" }}>
                File: <code>backend-node/src/engine/profile_setpoints.json</code> — load langsung di sana, tidak perlu memasukkan default lagi.
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
