// F8.4 — Formatter FocusedEvidenceView (frontend-only, READ-ONLY terhadap engine).
// Aturan keras: verdict & angka HANYA dari respons engine / snapshot / reading
// kiriman sendiri. Tidak ada threshold hardcoded, tidak ada vonis independen.
// Parse gagal / format tak dikenal => UNKNOWN (tidak pernah FALSE).

import {
  EVIDENCE_TEMPLATES,
  type ConditionStatus,
  type EvidenceConditionView,
  type EvidenceGroupView,
  type EvidenceGroupViewSkeleton,
  type FocusedEvidenceView,
  type SlotTemplate,
  type ValueSource,
} from "./evidence-contract";
import type { ClassifyRuleEvaluation, TierRefs, TierRuleRefs, CapabilityRefs } from "../api";
import { FAILURE_MAP } from "./failure-signals";

export interface FocusInput {
  failureType: string;
  ruleEvaluations: ClassifyRuleEvaluation[];
  snapshot: Record<string, number | null>;
  lastReading: Record<string, number | null>;
  limitations: string[];
  sampleSeq: number;
  timestamp: string;
  evaluationStatus: string;
  globalTrouble: string;
  /** Referensi efektif runtime (/tier-refs). Null => perilaku Jalur A lama. */
  refs: TierRefs | null;
  profileId: string;
}

/** Peta slot -> threshold efektif dari tier-refs (E2). Slot yang tidak ada
 *  di sini (PTS_F/T/RPM, DR_T, BS_T, setpoint, ...) tetap null + note —
 *  tidak dikarang dari dokumen statis. */
type TierRow = TierRuleRefs;
type CapRow = CapabilityRefs;
const REFS_LOOKUP: Record<string, (t: TierRow | null, c: CapRow | null) => number | null> = {
  PTS_KW: (t) => t?.kw_ref ?? null,
  PTS_A: (t) => t?.amp_ref ?? null,
  T_KW: (t) => t?.t_kw ?? null,
  T_A: (t) => t?.t_threshold ?? null,
  BS_KW: (t) => t?.kw_ref ?? null,
  BS_A: (t) => t?.amp_ref ?? null,
  DR_KW: (t) => t?.dr_kw ?? null,
  DR_A: (t) => t?.dr_amp ?? null,
  UB: (_t, c) => c?.unbalance_pct ?? null,
  UV: (_t, c) => c?.undervoltage_v ?? null,
  OV: (_t, c) => c?.overvoltage_v ?? null,
  PO_AMB: (_t, c) => c?.panel_overheat_c ?? null,
  PO_CBD: (_t, c) => c?.panel_overheat_c ?? null,
  PO_INV: (_t, c) => c?.panel_overheat_c ?? null,
};

const OP_SYMBOL: Record<string, string> = {
  "<": "<", "<=": "≤", ">": ">", ">=": "≥", "==": "=",
};

function fmt(n: number, decimals: number): string {
  return n.toFixed(decimals);
}

function asNumber(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function unknownSlot(
  t: SlotTemplate,
  actual: number | null,
  actualSource: ValueSource,
  note: string,
): EvidenceConditionView {
  return {
    condition_id: t.condition_id,
    label: t.label,
    formula_template: t.formula_template,
    unit: t.unit,
    actual_value: actual,
    actual_source: actualSource,
    operator: t.operator,
    threshold_value: null,
    threshold_source: "unavailable",
    substitution: null,
    condition_status: "UNKNOWN",
    note,
  };
}

function hasInsufficientHistory(limitations: string[]): boolean {
  return limitations.some((l) => /insufficient_history/i.test(l));
}

function resolveOrdinarySlot(
  t: SlotTemplate,
  matched: string[],
  actualOf: (field: string) => number | null,
  limitations: string[],
  evaluable: boolean,
  refsOf: (slotId: string) => number | null,
): EvidenceConditionView {
  const actual = actualOf(t.actual_field);
  const actualSource: ValueSource = actual === null ? "unavailable" : "snapshot";
  if (!evaluable) {
    return unknownSlot(t, actual, actualSource, "Evaluasi tidak didukung engine.");
  }
  const raw = matched.find((s) => t.pattern.test(s));
  if (raw) {
    let parsed: { actual: number; threshold: number | null; reference_detail?: string; ref?: number | null };
    try {
      const m = raw.match(t.pattern);
      if (!m) throw new Error("no-match");
      parsed = t.parse(m);
      if (!Number.isFinite(parsed.actual)) throw new Error("bad-actual");
    } catch {
      return unknownSlot(t, actual, actualSource, "Format string engine tidak dikenal.");
    }
    const th = parsed.threshold !== null && Number.isFinite(parsed.threshold)
      ? parsed.threshold
      : null;
    const ref = parsed.ref !== undefined && parsed.ref !== null && Number.isFinite(parsed.ref)
      ? parsed.ref
      : null;
    const substitution = th === null
      ? null
      : t.substitute
        ? t.substitute({ actual: parsed.actual, threshold: th, ref, decimals: t.decimals })
        : `${fmt(parsed.actual, t.decimals)} ${OP_SYMBOL[t.operator]} ${fmt(th, t.decimals)}`;
    return {
      condition_id: t.condition_id,
      label: t.label,
      formula_template: t.formula_template,
      unit: t.unit,
      actual_value: parsed.actual,
      actual_source: "engine",
      operator: t.operator,
      threshold_value: th,
      threshold_source: th === null ? "unavailable" : "engine",
      substitution,
      condition_status: "TRUE",
      note: parsed.reference_detail && th !== null && !t.substitute
        ? `Referensi engine: ${parsed.reference_detail}`
        : th === null
          ? "Nilai pembanding tidak disediakan respons engine."
          : null,
      reference_detail: parsed.reference_detail ?? null,
    };
  }
  // Nama kondisi dikenali (hint) tetapi format angka berubah => drift.
  // UNKNOWN, tidak pernah FALSE — prinsip anti parser-drift.
  const hintHit = matched.find((s) => t.hint.test(s));
  if (hintHit) {
    return unknownSlot(t, actual, actualSource,
      `Format angka engine berubah: ${hintHit.slice(0, 80)}`);
  }
  if (actual === null) {
    return unknownSlot(t, actual, "unavailable", "Data aktual belum tersedia (null).");
  }
  if (t.needsHistory && hasInsufficientHistory(limitations)) {
    return unknownSlot(t, actual, actualSource, "Histori tidak cukup — lihat limitations.");
  }
  // E2: threshold FALSE dari rule refs runtime bila tersedia; selainnya jujur null.
  // Slot ber-referensi (T_A) memakai substitusi kustom dengan ref=null —
  // I_ref tak diketahui sehingga tidak dikarang.
  const refTh = refsOf(t.condition_id);
  if (refTh !== null) {
    return {
      condition_id: t.condition_id,
      label: t.label,
      formula_template: t.formula_template,
      unit: t.unit,
      actual_value: actual,
      actual_source: actualSource,
      operator: t.operator,
      threshold_value: refTh,
      threshold_source: "refs",
      substitution: t.substitute
        ? t.substitute({ actual, threshold: refTh, ref: null, decimals: t.decimals })
        : `${fmt(actual, t.decimals)} ${OP_SYMBOL[t.operator]} ${fmt(refTh, t.decimals)}`,
      condition_status: "FALSE",
      note: "Tidak terpenuhi; nilai pembanding dari rule refs runtime.",
    };
  }
  return {
    condition_id: t.condition_id,
    label: t.label,
    formula_template: t.formula_template,
    unit: t.unit,
    actual_value: actual,
    actual_source: actualSource,
    operator: t.operator,
    threshold_value: null,
    threshold_source: "unavailable",
    substitution: null,
    condition_status: "FALSE",
    note: "Tidak terpenuhi; nilai pembanding tidak disediakan respons engine.",
  };
}

function resolveUnbalanceSlot(
  t: SlotTemplate,
  matched: string[],
  actualOf: (field: string) => number | null,
  evaluable: boolean,
  refsOf: (slotId: string) => number | null,
): EvidenceConditionView {
  const phaseFields = ["arus_rms_u", "arus_rms_v", "arus_rms_w"] as const;
  const phaseLabels = ["Fasa U", "Fasa V", "Fasa W"] as const;
  const phaseIds = ["UB_U", "UB_V", "UB_W"] as const;
  const unknownChildren = (note: string): EvidenceConditionView[] =>
    phaseIds.map((id, i) => ({
      condition_id: id,
      label: phaseLabels[i],
      formula_template: "|E_fasa| ≥ E_limit",
      unit: "%",
      actual_value: actualOf(phaseFields[i]),
      actual_source: (actualOf(phaseFields[i]) === null ? "unavailable" : "snapshot") as ValueSource,
      operator: ">=" as const,
      threshold_value: null,
      threshold_source: "unavailable" as ValueSource,
      substitution: null,
      condition_status: "UNKNOWN" as const,
      note,
    }));
  if (!evaluable) {
    return {
      condition_id: t.condition_id, label: t.label,
      formula_template: t.formula_template, unit: t.unit,
      actual_value: null, actual_source: "unavailable",
      operator: t.operator, threshold_value: null,
      threshold_source: "unavailable", substitution: null,
      condition_status: "UNKNOWN", note: "Evaluasi tidak didukung engine.",
      children: unknownChildren("Evaluasi tidak didukung engine."),
    };
  }
  const raw = matched.find((s) => t.pattern.test(s));
  if (!raw) {
    // Nama kondisi dikenali tetapi format angka berubah => drift => UNKNOWN.
    const hintHit = matched.find((s) => t.hint.test(s));
    if (hintHit) {
      const driftNote = `Format angka engine berubah: ${hintHit.slice(0, 80)}`;
      return {
        condition_id: t.condition_id, label: t.label,
        formula_template: t.formula_template, unit: t.unit,
        actual_value: null, actual_source: "unavailable",
        operator: t.operator, threshold_value: null,
        threshold_source: "unavailable", substitution: null,
        condition_status: "UNKNOWN", note: driftNote,
        children: unknownChildren(driftNote),
      };
    }
  }
  if (raw) {
    const m = raw.match(t.pattern);
    if (!m) {
      return {
        condition_id: t.condition_id, label: t.label,
        formula_template: t.formula_template, unit: t.unit,
        actual_value: null, actual_source: "unavailable",
        operator: t.operator, threshold_value: null,
        threshold_source: "unavailable", substitution: null,
        condition_status: "UNKNOWN", note: "Format string engine tidak dikenal.",
        children: unknownChildren("Format string engine tidak dikenal."),
      };
    }
    const devs = [Number(m[1]), Number(m[3]), Number(m[5])];
    const flags = [m[2] === "TRUE", m[4] === "TRUE", m[6] === "TRUE"];
    const limit = Number(m[7]);
    const ri = m[8];
    const children: EvidenceConditionView[] = phaseIds.map((id, i) => ({
      condition_id: id,
      label: phaseLabels[i],
      formula_template: "|E_fasa| ≥ E_limit",
      unit: "%",
      actual_value: devs[i],
      actual_source: "engine" as ValueSource,
      operator: ">=" as const,
      threshold_value: limit,
      threshold_source: "engine" as ValueSource,
      substitution: `${fmt(devs[i], 2)} ${OP_SYMBOL[">="]} ${fmt(limit, 2)}`,
      condition_status: (flags[i] ? "TRUE" : "FALSE") as ConditionStatus,
      note: null,
    }));
    return {
      condition_id: t.condition_id, label: t.label,
      formula_template: t.formula_template, unit: t.unit,
      actual_value: null, actual_source: "unavailable",
      operator: t.operator, threshold_value: limit,
      threshold_source: "engine", substitution: null,
      condition_status: "TRUE", note: null,
      reference_detail: `Ri ${ri}`,
      children,
    };
  }
  const vals = phaseFields.map((f) => actualOf(f));
  if (vals.some((v) => v === null)) {
    return {
      condition_id: t.condition_id, label: t.label,
      formula_template: t.formula_template, unit: t.unit,
      actual_value: null, actual_source: "unavailable",
      operator: t.operator, threshold_value: null,
      threshold_source: "unavailable", substitution: null,
      condition_status: "UNKNOWN", note: "Data fasa belum tersedia (null).",
      children: unknownChildren("Data fasa belum tersedia (null)."),
    };
  }
  const refTh = refsOf(t.condition_id);
  return {
    condition_id: t.condition_id, label: t.label,
    formula_template: t.formula_template, unit: t.unit,
    actual_value: null, actual_source: "unavailable",
    operator: t.operator,
    threshold_value: refTh,
    threshold_source: refTh === null ? "unavailable" : "refs",
    substitution: null,
    condition_status: "FALSE",
    note: refTh === null
      ? "Tidak ada fasa menyimpang; nilai pembanding tidak disediakan respons engine."
      : "Tidak ada fasa menyimpang; nilai pembanding dari rule refs runtime.",
    children: unknownChildren("Rincian fasa hanya tersedia saat MATCH (string engine)."),
  };
}

function countLeaves(node: EvidenceConditionView | EvidenceGroupView): { satisfied: number; total: number } {
  if ("condition_id" in node) {
    const cond = node as EvidenceConditionView;
    // Anak sub-fasa (punya children) dihitung via daunnya agar tak ganda.
    if (cond.children && cond.children.length > 0) {
      return cond.children.reduce(
        (acc, ch) => {
          const c = countLeaves(ch);
          return { satisfied: acc.satisfied + c.satisfied, total: acc.total + c.total };
        },
        { satisfied: 0, total: 0 },
      );
    }
    return { satisfied: cond.condition_status === "TRUE" ? 1 : 0, total: 1 };
  }
  const group = node as EvidenceGroupView;
  return group.children.reduce(
    (acc, ch) => {
      const c = countLeaves(ch);
      return { satisfied: acc.satisfied + c.satisfied, total: acc.total + c.total };
    },
    { satisfied: 0, total: 0 },
  );
}

function buildGroup(
  skel: EvidenceGroupViewSkeleton,
  byId: Map<string, EvidenceConditionView>,
): EvidenceGroupView {
  const children = skel.children.map((c) =>
    typeof c === "string" ? byId.get(c)! : buildGroup(c, byId)
  );
  const counts = children.reduce(
    (acc, ch) => {
      const c = countLeaves(ch);
      return { satisfied: acc.satisfied + c.satisfied, total: acc.total + c.total };
    },
    { satisfied: 0, total: 0 },
  );
  return {
    group_id: skel.group_id,
    label: skel.label,
    aggregation: skel.aggregation,
    quorum_needed: skel.quorum_needed,
    structure_formula: skel.structure_formula,
    children,
    satisfied: counts.satisfied,
    total: counts.total,
  };
}

/** Bangun FocusedEvidenceView dari SATU respons klasifikasi. Tidak menilai ulang. */
export function buildFocusedEvidence(input: FocusInput): FocusedEvidenceView | null {
  const template = EVIDENCE_TEMPLATES[input.failureType];
  if (!template) return null;
  const label = FAILURE_MAP[input.failureType as keyof typeof FAILURE_MAP]?.label
    ?? input.failureType;
  const entry = input.ruleEvaluations.find((e) => e.trouble_type === input.failureType);

  let verdict: FocusedEvidenceView["verdict"] = "NOT_EVALUABLE";
  let matched: string[] = [];
  let total = 0;
  let missing: string[] = [];
  let evaluable = false;
  if (entry && entry.capability_status === "READY" && entry.evaluation) {
    verdict = entry.evaluation; // langsung dari engine: MATCH | NO_MATCH
    matched = entry.matched_conditions ?? [];
    total = entry.total_conditions ?? 0;
    missing = entry.missing_requirements ?? [];
    evaluable = true;
  } else if (entry) {
    missing = entry.missing_requirements ?? [];
  }

  const actualOf = (field: string): number | null => {
    const a = asNumber(input.snapshot[field]);
    if (a !== null) return a;
    return asNumber(input.lastReading[field]);
  };

  // Detektor drift format: string engine yang tidak dikenali pola slot mana
  // pun berarti formatter tertinggal dari engine — slot tak-cocok menjadi
  // UNKNOWN (tidak pernah FALSE), agar bukti keliru tidak ditampilkan.
  const allPatterns = template.slots.map((t) => t.pattern);
  const driftStrings = matched.filter((s) => !allPatterns.some((p) => p.test(s)));
  const driftNote = driftStrings.length > 0
    ? `Format string engine tidak dikenal: ${driftStrings[0].slice(0, 80)}`
    : null;

  // E2: kunci tier dari peta profiles backend (mis. "5000_lps" -> "5000").
  // refs dibaca live dari rules.json oleh backend — bukan salinan statis.
  const tierKey = input.refs?.profiles?.[input.profileId] ?? null;
  const tierRow = tierKey ? input.refs!.tiers[tierKey] ?? null : null;
  const capRow = input.refs?.capabilities ?? null;
  const refsOf = (slotId: string): number | null => {
    if (!tierRow && !capRow) return null;
    const lookup = REFS_LOOKUP[slotId];
    if (!lookup) return null;
    const v = lookup(tierRow, capRow);
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  };

  const byId = new Map<string, EvidenceConditionView>();
  for (const t of template.slots) {
    let view = t.custom === "unbalance-or"
      ? resolveUnbalanceSlot(t, matched, actualOf, evaluable, refsOf)
      : resolveOrdinarySlot(t, matched, actualOf, input.limitations, evaluable, refsOf);
    if (driftNote && view.condition_status === "FALSE") {
      view = { ...view, condition_status: "UNKNOWN", note: driftNote };
    }
    byId.set(t.condition_id, view);
  }
  const root = buildGroup(template.root, byId);
  const tag = input.failureType.toUpperCase();
  const relevant = input.limitations.filter((l) => l.toUpperCase().includes(tag));
  return {
    failure_type: input.failureType,
    label,
    sample_seq: input.sampleSeq,
    timestamp: input.timestamp,
    evaluation_status: input.evaluationStatus,
    global_trouble: input.globalTrouble,
    verdict,
    root,
    matched_count: matched.length, // gema engine apa adanya
    total_conditions: total, // gema engine apa adanya
    limitations: relevant,
    missing_requirements: missing,
  };
}
