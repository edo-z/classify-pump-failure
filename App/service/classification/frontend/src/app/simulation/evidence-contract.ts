// F8.2/F8.3 — Kontrak presentasi Mathematical Evidence (frontend-only).
// BUKAN classifier kedua: verdict selalu dari engine (rule_evaluations).
// Template berisi struktur simbolis + pola parse string engine; TIDAK berisi
// literal threshold — seluruh angka berasal dari parse respons engine,
// sensor_snapshot, atau reading terakhir kiriman frontend. Nilai tak tersedia = null.
//
// Dua lapis pengenalan string (anti parser-drift):
// - `pattern` (ketat, anchored): mengekstrak angka aktual + threshold.
// - `hint` (longgar, identitas kondisi): nama kondisi dikenali tetapi format
//   angka berubah => UNKNOWN, tidak pernah FALSE.

export type EvidenceVerdict = "MATCH" | "NO_MATCH" | "NOT_EVALUABLE";
export type ConditionStatus = "TRUE" | "FALSE" | "UNKNOWN";
export type ValueSource = "engine" | "snapshot" | "refs" | "unavailable";
export type EvidenceAggregation = "AND" | "OR" | "QUORUM" | "SINGLE";
export type EvidenceOperator = "<" | "<=" | ">" | ">=" | "==";

export interface EvidenceConditionView {
  condition_id: string;
  label: string;
  formula_template: string; // simbolis, tanpa angka threshold
  unit: string;
  actual_value: number | null;
  actual_source: ValueSource;
  operator: EvidenceOperator;
  threshold_value: number | null; // hanya dari parse string engine
  threshold_source: ValueSource;
  substitution: string | null; // representasi numerik bila operand lengkap
  condition_status: ConditionStatus;
  note: string | null;
  children?: EvidenceConditionView[];
  reference_detail?: string | null; // mis. "MA30 600.0, Δ+15.0" (T_A) / "Ri 113.33" (UB)
}

export interface EvidenceGroupView {
  group_id: string;
  label: string;
  aggregation: EvidenceAggregation;
  quorum_needed?: number; // struktur teori (PTS: 3 dari 4), bukan threshold ukur
  structure_formula: string; // representasi teori, mis. "F ∧ (ΣI ≥ 3)"
  children: Array<EvidenceConditionView | EvidenceGroupView>;
  /** Hitungan leaf terpenuhi/total di bawah grup (gema status slot). */
  satisfied?: number;
  total?: number;
}

export interface FocusedEvidenceView {
  failure_type: string;
  label: string;
  sample_seq: number;
  timestamp: string;
  evaluation_status: string;
  global_trouble: string;
  verdict: EvidenceVerdict;
  root: EvidenceGroupView;
  matched_count: number; // gema engine: slot top-level TRUE
  total_conditions: number; // gema engine
  limitations: string[];
  missing_requirements: string[];
}

export interface ParsedOperands {
  actual: number;
  threshold: number | null;
  reference_detail?: string;
  /** Operand referensi kedua (mis. I_ref MA30 pada T_A) — dari engine. */
  ref?: number | null;
}

export interface SubstituteArgs {
  actual: number;
  threshold: number;
  ref: number | null;
  decimals: number;
}

/** Satu slot kondisi: cara mengenali + mem-parse string engine. */
export interface SlotTemplate {
  condition_id: string;
  label: string;
  unit: string;
  formula_template: string;
  operator: EvidenceOperator;
  actual_field: string; // kunci snapshot/reading untuk fallback aktual
  pattern: RegExp; // ketat, anchored ^ — grup tangkap sesuai parse()
  hint: RegExp; // longgar: identitas kondisi; cocok-tetapi-tak-terparse => UNKNOWN
  decimals: number; // presisi display mengikuti engine (DR_F & UB: 2, lain: 1)
  parse: (m: RegExpMatchArray) => ParsedOperands;
  /** Substitusi kustom (default "aktual op threshold"). Wajib untuk slot
   *  ber-referensi seperti T_A: "|I − I_ref| ≥ Δ". */
  substitute?: (a: SubstituteArgs) => string;
  needsHistory?: boolean; // true hanya untuk T_A turbulensi
  /** Penanda parser khusus anak (hanya "unbalance-or"): rincian fasa
   *  dibaca dari satu string OR engine, bukan slot mandiri. */
  custom?: "unbalance-or";
}

/** Hasil parse string OR unbalance engine (satu-satunya sumber sub-fasa). */
export interface UnbalancePhaseDetail {
  phase: "U" | "V" | "W";
  deviation: number;
  flag: boolean; // TRUE/FALSE eksplisit dari engine
}

export const UNBALANCE_OR_PATTERN =
  /^unbalance OR: Eu ([-\d.]+)% (TRUE|FALSE), Ev ([-\d.]+)% (TRUE|FALSE), Ew ([-\d.]+)% (TRUE|FALSE) >= ([\d.]+)% \(Ri ([\d.]+)\)/;
export const UNBALANCE_OR_HINT = /^unbalance OR:/;

export interface FailureEvidenceTemplate {
  failure_type: string;
  root: EvidenceGroupViewSkeleton;
  slots: SlotTemplate[];
}

export type EvidenceGroupViewSkeleton = Omit<EvidenceGroupView, "children"> & {
  children: Array<string | EvidenceGroupViewSkeleton>; // string = condition_id slot
};

const num = (s: string): number | null => {
  const v = Number(s);
  return Number.isFinite(v) ? v : null;
};

function slot(
  condition_id: string,
  label: string,
  unit: string,
  formula_template: string,
  operator: EvidenceOperator,
  actual_field: string,
  pattern: RegExp,
  hint: RegExp,
  decimals: number,
  parse: SlotTemplate["parse"],
  needsHistory = false,
  substitute?: SlotTemplate["substitute"],
): SlotTemplate {
  return {
    condition_id, label, unit, formula_template, operator,
    actual_field, pattern, hint, decimals, parse, needsHistory, substitute,
  };
}

const simpleParse =
  (ai: number, ti: number | null) =>
  (m: RegExpMatchArray): ParsedOperands => ({
    actual: Number(m[ai]),
    threshold: ti === null ? null : num(m[ti]),
  });

export const EVIDENCE_TEMPLATES: Record<string, FailureEvidenceTemplate> = {
  pompa_tersangkut_sampah: {
    failure_type: "pompa_tersangkut_sampah",
    root: {
      group_id: "PTS", label: "Pompa Tersangkut Sampah",
      aggregation: "AND", structure_formula: "PTS = F ∧ (ΣI ≥ 3)",
      children: [
        "PTS_F",
        {
          group_id: "PTS_I", label: "Indikator pendukung",
          aggregation: "QUORUM", quorum_needed: 3,
          structure_formula: "ΣI = I_KW + I_A + I_T + I_RPM ≥ 3",
          children: ["PTS_KW", "PTS_A", "PTS_T", "PTS_RPM"],
        },
      ],
    },
    slots: [
      slot("PTS_F", "Frekuensi", "Hz", "F_aktual ≤ F_limit", "<=", "output_frequency",
        /^freq=([\d.]+) <=([\d.]+)/, /^freq=/, 1, simpleParse(1, 2)),
      slot("PTS_KW", "Daya", "kW", "P_aktual ≥ P_ref·tier", ">=", "output_power",
        /^power=([\d.]+) >= ([\d.]+)/, /^power=/, 1, simpleParse(1, 2)),
      slot("PTS_A", "Arus", "A", "I_aktual ≥ I_ref·tier", ">=", "motor_current",
        /^current=([\d.]+) >= ([\d.]+)/, /^current=/, 1, simpleParse(1, 2)),
      slot("PTS_T", "Torsi", "%", "T_aktual ≥ T_limit", ">=", "motor_torque",
        /^torque=([\d.]+) >= ([\d.]+)%/, /^torque=/, 1, simpleParse(1, 2)),
      slot("PTS_RPM", "Kecepatan", "rpm", "N_aktual ≥ N_limit", ">=", "motor_speed",
        /^speed=([\d.]+) >= ([\d.]+)/, /^speed=/, 1, simpleParse(1, 2)),
    ],
  },
  turbulensi: {
    failure_type: "turbulensi",
    root: {
      group_id: "TB", label: "Turbulensi",
      aggregation: "AND", structure_formula: "TB = F ∧ KW ∧ A ∧ T (ketat 4/4)",
      children: ["T_F", "T_KW", "T_A", "T_T"],
    },
    slots: [
      slot("T_F", "Frekuensi", "Hz", "F_aktual < F_setpoint", "<", "output_frequency",
        /^freq=([\d.]+) < setpoint ([\d.]+)/, /^freq=/, 1, simpleParse(1, 2)),
      slot("T_KW", "Daya", "kW", "P_aktual ≥ P_ref·tier", ">=", "output_power",
        /^power=([\d.]+) >= ([\d.]+)/, /^power=/, 1, simpleParse(1, 2)),
      slot("T_A", "Deviasi arus", "A", "|I − I_ref| ≥ Δ_limit", ">=", "motor_current",
        /^current=([\d.]+) vs (MA30|CMA\d+)([\d.]+) Δ([+-][\d.]+) \|Δ\|([\d.]+)>=([\d.]+)/,
        /^current=/, 1,
        (m) => ({
          actual: Number(m[1]),
          threshold: num(m[6]),
          reference_detail: `${m[2]} ${m[3]}, Δ${m[4]}`,
          ref: num(m[3]),
        }),
        true,
        (a) => `|${a.actual.toFixed(a.decimals)} − ${a.ref !== null ? a.ref.toFixed(a.decimals) : "—"}| ≥ ${a.threshold.toFixed(a.decimals)}`),
      slot("T_T", "Torsi", "%", "T_aktual ≥ T_limit", ">=", "motor_torque",
        /^torque=([\d.]+) >= ([\d.]+)%/, /^torque=/, 1, simpleParse(1, 2)),
    ],
  },
  banyak_sampah: {
    failure_type: "banyak_sampah",
    root: {
      group_id: "BS", label: "Banyak Sampah",
      aggregation: "AND", structure_formula: "BS = F ∧ KW ∧ A ∧ T (semua wajib)",
      children: ["BS_F", "BS_KW", "BS_A", "BS_T"],
    },
    slots: [
      slot("BS_F", "Frekuensi", "Hz", "F_aktual ≤ F_setpoint", "<=", "output_frequency",
        /^output_frequency=([\d.]+) <= setpoint ([\d.]+)/, /^output_frequency=/, 1, simpleParse(1, 2)),
      slot("BS_KW", "Daya", "kW", "P_aktual ≥ P_ref·tier", ">=", "output_power",
        /^output_power=([\d.]+) >= ([\d.]+)/, /^output_power=/, 1, simpleParse(1, 2)),
      slot("BS_A", "Arus", "A", "I_aktual ≥ I_ref·tier", ">=", "motor_current",
        /^motor_current=([\d.]+) >= ([\d.]+)/, /^motor_current=/, 1, simpleParse(1, 2)),
      slot("BS_T", "Torsi", "%", "T_aktual ≥ T_limit", ">=", "motor_torque",
        /^motor_torque=([\d.]+) >= ([\d.]+)/, /^motor_torque=/, 1, simpleParse(1, 2)),
    ],
  },
  dry_run: {
    failure_type: "dry_run",
    root: {
      group_id: "DR", label: "Dry Run",
      aggregation: "AND", structure_formula: "DryRun = DR_F ∧ DR_C, DR_C = KW ∧ A ∧ T",
      children: [
        "DR_F",
        {
          group_id: "DR_C", label: "Tanpa beban (DR_C)",
          aggregation: "AND", structure_formula: "DR_C = DR_KW ∧ DR_A ∧ DR_T",
          children: ["DR_KW", "DR_A", "DR_T"],
        },
      ],
    },
    slots: [
      slot("DR_F", "Frekuensi vs setpoint", "Hz", "F_aktual == F_setpoint (2 desimal)", "==", "output_frequency",
        /^DR_F: output_frequency=([\d.]+) == setpoint ([\d.]+)/, /^DR_F:/, 2, simpleParse(1, 2)),
      slot("DR_KW", "Daya", "kW", "P_aktual ≤ 0.667 × P_ref·tier", "<=", "output_power",
        /^DR_C: output_power=([\d.]+) <= DR_kW ([\d.]+) \(0\.667\*([\d.]+)\)/, /^DR_C: output_power=/, 1,
        (m) => ({ actual: Number(m[1]), threshold: num(m[2]), reference_detail: `0.667 × ${m[3]}` })),
      slot("DR_A", "Arus", "A", "I_aktual ≤ 0.64 × I_ref·tier", "<=", "motor_current",
        /^DR_C: motor_current=([\d.]+) <= DR_A ([\d.]+) \(0\.64\*([\d.]+)\)/, /^DR_C: motor_current=/, 1,
        (m) => ({ actual: Number(m[1]), threshold: num(m[2]), reference_detail: `0.64 × ${m[3]}` })),
      slot("DR_T", "Torsi", "%", "T_aktual < T_limit", "<", "motor_torque",
        /^DR_C: motor_torque=([\d.]+) < ([\d.]+)/, /^DR_C: motor_torque=/, 1, simpleParse(1, 2)),
    ],
  },
  unbalance: {
    failure_type: "unbalance",
    root: {
      group_id: "UB", label: "Unbalance",
      aggregation: "OR", structure_formula: "UB = (|Eu|≥E) ∨ (|Ev|≥E) ∨ (|Ew|≥E)",
      children: ["UB"],
    },
    slots: [
      {
        condition_id: "UB", label: "Deviasi fasa", unit: "%",
        formula_template: "|E_fasa| ≥ E_limit", operator: ">=",
        actual_field: "arus_rms_u", pattern: UNBALANCE_OR_PATTERN,
        hint: UNBALANCE_OR_HINT, decimals: 2,
        parse: (m) => ({
          actual: Number.NaN,
          threshold: num(m[7]),
          reference_detail: `Ri ${m[8]}`,
        }),
        custom: "unbalance-or",
      },
    ],
  },
  undervoltage: {
    failure_type: "undervoltage",
    root: {
      group_id: "UV", label: "Undervoltage",
      aggregation: "SINGLE", structure_formula: "UV = (V_aktual < V_limit)",
      children: ["UV"],
    },
    slots: [
      slot("UV", "Tegangan masukan", "V", "V_aktual < V_limit", "<", "input_voltage",
        /^input_voltage ([\d.]+) (<|>) ([\d.]+)/, /^input_voltage /, 2, simpleParse(1, 3)),
    ],
  },
  overvoltage: {
    failure_type: "overvoltage",
    root: {
      group_id: "OV", label: "Overvoltage",
      aggregation: "SINGLE", structure_formula: "OV = (V_aktual > V_limit)",
      children: ["OV"],
    },
    slots: [
      slot("OV", "Tegangan masukan", "V", "V_aktual > V_limit", ">", "input_voltage",
        /^input_voltage ([\d.]+) (<|>) ([\d.]+)/, /^input_voltage /, 2, simpleParse(1, 3)),
    ],
  },
  panel_overheat: {
    failure_type: "panel_overheat",
    root: {
      group_id: "PO", label: "Panel Overheat",
      aggregation: "OR", structure_formula: "PO = (AMB≥S) ∨ (CBD≥S) ∨ (INV≥S)",
      children: ["PO_AMB", "PO_CBD", "PO_INV"],
    },
    slots: [
      slot("PO_AMB", "Suhu ambient", "°C", "S_aktual ≥ S_limit", ">=", "ambient_temperature",
        /^ambient_temperature=([\d.]+) >= ([\d.]+)/, /^ambient_temperature=/, 1, simpleParse(1, 2)),
      slot("PO_CBD", "Suhu control board", "°C", "S_aktual ≥ S_limit", ">=", "control_board_temperature",
        /^control_board_temperature=([\d.]+) >= ([\d.]+)/, /^control_board_temperature=/, 1, simpleParse(1, 2)),
      slot("PO_INV", "Suhu inverter", "°C", "S_aktual ≥ S_limit", ">=", "inverter_temperature",
        /^inverter_temperature=([\d.]+) >= ([\d.]+)/, /^inverter_temperature=/, 1, simpleParse(1, 2)),
    ],
  },
};
