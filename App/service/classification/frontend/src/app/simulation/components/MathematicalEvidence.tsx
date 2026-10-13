// F8.4 — Panel Mathematical Evidence (presentasi saja).
// Menerima FocusedEvidenceView yang sudah dibentuk formatter; komponen ini
// tidak menghitung verdict, tidak mem-parse string, tidak menyimpan state.
"use client";

import type {
  ConditionStatus,
  EvidenceConditionView,
  EvidenceGroupView,
  FocusedEvidenceView,
} from "../evidence-contract";

const STATUS_STYLE: Record<ConditionStatus, { bg: string; fg: string; border: string }> = {
  TRUE: { bg: "#dcfce7", fg: "#166534", border: "#bbf7d0" },
  FALSE: { bg: "#fef3c7", fg: "#92400e", border: "#fcd34d" },
  UNKNOWN: { bg: "#f3f4f6", fg: "#4b5563", border: "#d1d5db" },
};

const VERDICT_STYLE: Record<string, { bg: string; fg: string }> = {
  MATCH: { bg: "#16a34a", fg: "white" },
  NO_MATCH: { bg: "#d97706", fg: "white" },
  NOT_EVALUABLE: { bg: "#6b7280", fg: "white" },
};

function StatusBadge({ status }: { status: ConditionStatus }) {
  const s = STATUS_STYLE[status];
  return (
    <span
      data-testid={`sim-evidence-status-${status}`}
      style={{
        fontSize: "0.68rem", fontWeight: 800, padding: "0.1rem 0.45rem",
        borderRadius: "4px", background: s.bg, color: s.fg,
        border: `1px solid ${s.border}`, whiteSpace: "nowrap",
      }}
    >
      {status}
    </span>
  );
}

const STATUS_WORD: Record<ConditionStatus, string> = {
  TRUE: "Terpenuhi",
  FALSE: "Tidak terpenuhi",
  UNKNOWN: "Belum dapat dinilai",
};

const SOURCE_WORD: Record<string, string> = {
  engine: "Engine Evidence",
  snapshot: "Snapshot",
  refs: "Rule Refs (runtime)",
  unavailable: "—",
};

function ConditionCard({ cond, depth }: { cond: EvidenceConditionView; depth: number }) {
  return (
    <div
      data-testid={`sim-evidence-condition-${cond.condition_id}`}
      style={{
        border: "1px solid #e5e7eb", borderLeft: `4px solid ${STATUS_STYLE[cond.condition_status].border}`,
        borderRadius: "8px", padding: "0.6rem 0.75rem",
        background: depth > 0 ? "#f9fafb" : "white", minWidth: 0,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ fontSize: "0.8rem", fontWeight: 700 }}>
          {cond.condition_id} — {cond.label}
        </span>
        <StatusBadge status={cond.condition_status} />
      </div>
      <div style={{ fontSize: "0.68rem", color: "#6b7280", marginTop: "0.45rem", textTransform: "uppercase", letterSpacing: "0.04em" }}>
        Persamaan
      </div>
      <div style={{ fontSize: "1.05rem", fontWeight: 700, color: "#111827" }}>
        <code>{cond.formula_template}</code>
      </div>
      <div style={{ fontSize: "0.68rem", color: "#6b7280", marginTop: "0.4rem", textTransform: "uppercase", letterSpacing: "0.04em" }}>
        Substitusi dari engine
      </div>
      {cond.substitution !== null ? (
        <div
          data-testid={`sim-evidence-substitution-${cond.condition_id}`}
          title={cond.actual_value !== null ? `aktual mentah: ${cond.actual_value}` : undefined}
          style={{ fontSize: "1rem", fontWeight: 700, color: "#1d4ed8" }}
        >
          <code>{cond.substitution}</code>{" "}
          <span style={{ fontWeight: 400, color: "#6b7280", fontSize: "0.75rem" }}>{cond.unit}</span>
        </div>
      ) : (
        <div style={{ fontSize: "0.8rem", color: "#9ca3af", fontStyle: "italic" }}>
          {cond.actual_value !== null && cond.threshold_value === null
            ? `aktual ${cond.actual_value} ${cond.unit} — nilai pembanding tidak tersedia`
            : cond.actual_value === null
              ? "nilai aktual belum tersedia"
              : "tidak ditampilkan"}
        </div>
      )}
      {cond.reference_detail && (
        <div style={{ fontSize: "0.75rem", color: "#6b7280", marginTop: "0.15rem" }}>
          Referensi engine: <code>{cond.reference_detail}</code>
        </div>
      )}
      <div style={{ fontSize: "0.75rem", color: "#6b7280", marginTop: "0.25rem" }}>
        Sumber — aktual: {SOURCE_WORD[cond.actual_source]} · pembanding: {SOURCE_WORD[cond.threshold_source]}
      </div>
      <div style={{ fontSize: "0.8rem", fontWeight: 700, color: STATUS_STYLE[cond.condition_status].fg, marginTop: "0.15rem" }}>
        {STATUS_WORD[cond.condition_status]}
      </div>
      {cond.note && (
        <div style={{ fontSize: "0.75rem", color: "#6b7280", marginTop: "0.15rem" }}>{cond.note}</div>
      )}
      {cond.children && cond.children.length > 0 && (
        <div style={{ display: "grid", gap: "0.4rem", marginTop: "0.5rem" }}>
          {cond.children.map((ch) => (
            <ConditionCard key={ch.condition_id} cond={ch} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

function GroupBlock({ group }: { group: EvidenceGroupView }) {
  return (
    <div style={{ display: "grid", gap: "0.5rem", minWidth: 0 }}>
      <div style={{ fontSize: "0.78rem", color: "#374151" }}>
        Struktur keputusan: <code>{group.structure_formula}</code>
        {group.aggregation === "QUORUM" && group.quorum_needed !== undefined && (
          <span>
            {" "}— perlu ≥ {group.quorum_needed} dari {group.children.length}
            {group.satisfied !== undefined && group.total !== undefined && (
              <span data-testid={`sim-evidence-quorum-${group.group_id}`}>
                {" "}· terpenuhi {group.satisfied} dari {group.total}
              </span>
            )}
          </span>
        )}
      </div>
      {group.children.map((ch, i) =>
        "condition_id" in ch
          ? <ConditionCard key={ch.condition_id} cond={ch as EvidenceConditionView} depth={0} />
          : <GroupBlock key={`${ch.group_id}-${i}`} group={ch as EvidenceGroupView} />,
      )}
    </div>
  );
}

export default function MathematicalEvidence({ view }: { view: FocusedEvidenceView }) {
  const v = VERDICT_STYLE[view.verdict] ?? VERDICT_STYLE.NOT_EVALUABLE;
  return (
    <div data-testid="sim-evidence" style={{ display: "grid", gap: "0.6rem" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
        <span style={{ fontSize: "0.8rem", fontWeight: 700 }}>Monitoring: {view.label}</span>
        <span className="sim-chip">sampel #{view.sample_seq}</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
        <span style={{ fontSize: "0.78rem", color: "#6b7280" }}>Klasifikasi global:</span>
        <span data-testid="sim-evidence-global" className="sim-trouble" style={{ background: "#6b7280" }}>
          {view.global_trouble}
        </span>
        <span style={{ fontSize: "0.78rem", color: "#6b7280" }}>Evaluasi fokus:</span>
        <span
          data-testid="sim-evidence-verdict"
          style={{ fontWeight: 800, color: "white", background: v.bg, padding: "0.15rem 0.6rem", borderRadius: "6px", fontSize: "0.85rem" }}
        >
          {view.verdict}
        </span>
        <span style={{ fontSize: "0.75rem", color: "#6b7280" }}>
          evidence {view.matched_count}/{view.total_conditions} (engine)
        </span>
      </div>
      <GroupBlock group={view.root} />
      <details className="sim-details">
        <summary>Detail sumber & keterbatasan</summary>
        <ul style={{ fontSize: "0.78rem", color: "#4b5563", margin: "0.4rem 0" }}>
          <li>timestamp {view.timestamp} · rules {view.rules_version} · status {view.evaluation_status}</li>
          <li>Sumber angka: engine (parse string evaluasi) atau snapshot/reading terakhir; threshold tak-tersedia tidak dikarang.</li>
          {view.missing_requirements.length > 0 && (
            <li>missing_requirements: {view.missing_requirements.join("; ")}</li>
          )}
          {view.limitations.length > 0 && (
            <li data-testid="sim-evidence-limitations">limitations: {view.limitations.join(" | ")}</li>
          )}
          {view.limitations.length === 0 && view.missing_requirements.length === 0 && (
            <li>Tidak ada keterbatasan tercatat untuk failure ini.</li>
          )}
        </ul>
      </details>
    </div>
  );
}
