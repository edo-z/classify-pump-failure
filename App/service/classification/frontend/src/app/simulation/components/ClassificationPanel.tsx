// Panel Classification & Evidence — presentasi hasil engine (tanpa logika sampling).
// Badge monitoring menilai keberadaan failure di matched_rules (multi-match),
// bukan hanya trouble_type utama.
"use client";

import { FAILURE_COLORS } from "../../lib/replay/constants";
import type { FailureType } from "../failure-signals";
import type { SimResult } from "../types";

export interface ClassificationPanelProps {
  result: SimResult | null;
  selectedFailure: FailureType;
}

export default function ClassificationPanel({ result, selectedFailure }: ClassificationPanelProps) {
  const trouble = result?.classification.trouble_type ?? "—";
  const troubleColor = (FAILURE_COLORS as Record<string, string>)[trouble] ?? "#6b7280";
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
  );
}
