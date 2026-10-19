// F8.6 contract: formatter FocusedEvidenceView vs respons engine asli.
// Browser-less (tanpa fixture page). Fixture = respons /classify nyata
// yang direkam dari backend (lihat e2e/fixtures/evidence/*.json).
import { expect, test } from "@playwright/test";
import { buildFocusedEvidence } from "../src/app/simulation/evidence-format";
import type { EvidenceConditionView, EvidenceGroupView } from "../src/app/simulation/evidence-contract";
import type { TierRefs } from "../src/app/api";

import fx01 from "./fixtures/evidence/01-pts-match.json";
import fx02 from "./fixtures/evidence/02-turbulensi-match.json";
import fx03 from "./fixtures/evidence/03-banyak-sampah-match.json";
import fx04 from "./fixtures/evidence/04-dry-run-match.json";
import fx05 from "./fixtures/evidence/05-unbalance-match.json";
import fx06 from "./fixtures/evidence/06-undervoltage-match.json";
import fx07 from "./fixtures/evidence/07-overvoltage-match.json";
import fx08 from "./fixtures/evidence/08-panel-overheat-match.json";
import fx09 from "./fixtures/evidence/09-normal.json";
import fx10 from "./fixtures/evidence/10-turbulensi-insufficient.json";
import fx11 from "./fixtures/evidence/11-pts-quorum-2of4.json";
import fx12 from "./fixtures/evidence/12-tier500-bs-match.json";
import fx13 from "./fixtures/evidence/13-tier3000-bs-match.json";
import fx14 from "./fixtures/evidence/14-unbalance-plus-undervoltage.json";
import fx15 from "./fixtures/evidence/15-dryrun-boundary-freq.json";
import fx16 from "./fixtures/evidence/16-unbalance-null-phase.json";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Fx = any;

function inputFor(fx: Fx, failure: string, opts?: { refs?: TierRefs | null; profileId?: string }) {
  const c = fx.response.classification;
  return {
    failureType: failure,
    ruleEvaluations: c.rule_evaluations,
    snapshot: c.sensor_snapshot ?? {},
    lastReading: fx.last_reading ?? {},
    limitations: c.limitations ?? [],
    sampleSeq: 18,
    timestamp: c.timestamp ?? "",
    evaluationStatus: c.evaluation_status,
    globalTrouble: c.trouble_type,
    refs: opts?.refs ?? null,
    profileId: opts?.profileId ?? fx.meta.profile_id,
  };
}

// Cermin respons live GET /classification/tier-refs (rules v1.1).
const REFS: TierRefs = {
  tiers: {
    "500": { capacity_lps: 500, kw_ref: 75, amp_ref: 157, dr_kw: 50.025, dr_amp: 100.48, t_kw: 75, t_window: 30, t_threshold: 10 },
    "3000": { capacity_lps: 3000, kw_ref: 250, amp_ref: 517, dr_kw: 166.75, dr_amp: 330.88, t_kw: 250, t_window: 30, t_threshold: 10 },
    "5000": { capacity_lps: 5000, kw_ref: 400, amp_ref: 867, dr_kw: 266.8, dr_amp: 554.88, t_kw: 400, t_window: 30, t_threshold: 10 },
  },
  capabilities: { undervoltage_v: 360, overvoltage_v: 410, unbalance_pct: 10, panel_overheat_c: 60 },
  profiles: { "500_lps": "500", "3000_lps": "3000", "5000_lps": "5000" },
};

function flatten(view: { root: { children: unknown[] } }): EvidenceConditionView[] {
  const out: EvidenceConditionView[] = [];
  const walk = (nodes: unknown[]) => {
    for (const n of nodes) {
      const node = n as Record<string, unknown>;
      if ("condition_id" in node) {
        out.push(node as unknown as EvidenceConditionView);
        const ch = (node as unknown as EvidenceConditionView).children;
        if (ch) walk(ch);
      } else if ("children" in node) {
        walk(node.children as unknown[]);
      }
    }
  };
  walk(view.root.children as unknown[]);
  return out;
}

function byId(view: { root: { children: unknown[] } }, id: string) {
  const found = flatten(view).find((c) => c.condition_id === id);
  expect(found, `slot ${id} ada`).toBeTruthy();
  return found!;
}

const MATCH_CASES: Array<[Fx, string, string[]]> = [
  [fx01, "pompa_tersangkut_sampah", ["PTS_F", "PTS_KW", "PTS_A", "PTS_T", "PTS_RPM"]],
  [fx02, "turbulensi", ["T_F", "T_KW", "T_A", "T_T"]],
  [fx03, "banyak_sampah", ["BS_F", "BS_KW", "BS_A", "BS_T"]],
  [fx04, "dry_run", ["DR_F", "DR_KW", "DR_A", "DR_T"]],
  [fx05, "unbalance", ["UB"]],
  [fx06, "undervoltage", ["UV"]],
  [fx07, "overvoltage", ["OV"]],
  // Fixture 08 hanya memanaskan ambient: PO_AMB TRUE, lainnya FALSE (aktual ada).
  [fx08, "panel_overheat", ["PO_AMB"]],
];

test.describe("F8.6 evidence formatter contract", () => {
  test("8 failure MATCH: verdict engine + semua slot TRUE + substitusi engine", () => {
    for (const [fx, failure, slots] of MATCH_CASES) {
      const view = buildFocusedEvidence(inputFor(fx, failure))!;
      expect(view, `view ${failure}`).toBeTruthy();
      expect(view.verdict, `verdict ${failure}`).toBe("MATCH");
      for (const id of slots) {
        const c = byId(view, id);
        expect(c.condition_status, `${failure}.${id}`).toBe("TRUE");
        expect(c.threshold_source, `${failure}.${id} threshold dari engine`).toBe("engine");
        if (id !== "UB") {
          // UB parent tidak punya aktual tunggal; sub-fasa membawa substitusi.
          expect(c.substitution, `${failure}.${id} substitution`).toBeTruthy();
        }
      }
    }
    // Panel: sensor dingin dengan aktual tersedia => FALSE, bukan UNKNOWN.
    const po = buildFocusedEvidence(inputFor(fx08, "panel_overheat"))!;
    expect(byId(po, "PO_CBD").condition_status).toBe("FALSE");
    expect(byId(po, "PO_INV").condition_status).toBe("FALSE");
    // Unbalance MATCH: 3 sub-fasa dari string OR engine.
    const ub = buildFocusedEvidence(inputFor(fx05, "unbalance"))!;
    const flags = ["UB_U", "UB_V", "UB_W"].map((id) => byId(ub, id));
    expect(flags.map((f) => f.condition_status)).toEqual(["TRUE", "TRUE", "TRUE"]);
    for (const f of flags) expect(f.substitution).toBeTruthy();
  });

  test("threshold mengikuti tier engine, bukan konstanta frontend", () => {
    const kw500 = byId(buildFocusedEvidence(inputFor(fx12, "banyak_sampah"))!, "BS_KW");
    const kw3000 = byId(buildFocusedEvidence(inputFor(fx13, "banyak_sampah"))!, "BS_KW");
    const kw5000 = byId(buildFocusedEvidence(inputFor(fx03, "banyak_sampah"))!, "BS_KW");
    expect(kw500.threshold_value).toBe(75);
    expect(kw3000.threshold_value).toBe(250);
    expect(kw5000.threshold_value).toBe(400);
  });

  test("global normal: dry_run NO_MATCH, FALSE dibedakan dari UNKNOWN", () => {
    const view = buildFocusedEvidence(inputFor(fx09, "dry_run"))!;
    expect(view.verdict).toBe("NO_MATCH");
    expect(view.global_trouble).toBe("normal");
    // Freq 39 vs setpoint 40: aktual ada, threshold tak tersedia -> FALSE + note.
    const drf = byId(view, "DR_F");
    expect(drf.condition_status).toBe("FALSE");
    expect(drf.threshold_value).toBeNull();
    expect(drf.note).toBeTruthy();
    // Unbalance dengan 3 fasa ada tetapi tak-cocok -> parent FALSE, anak UNKNOWN.
    const ubView = buildFocusedEvidence(inputFor(fx09, "unbalance"))!;
    expect(ubView.verdict).toBe("NO_MATCH");
    expect(byId(ubView, "UB").condition_status).toBe("FALSE");
    for (const id of ["UB_U", "UB_V", "UB_W"]) {
      expect(byId(ubView, id).condition_status).toBe("UNKNOWN");
    }
  });

  test("T_A histori tak-cukup: UNKNOWN + limitation, bukan FALSE", () => {
    const view = buildFocusedEvidence(inputFor(fx10, "turbulensi"))!;
    expect(view.verdict).toBe("NO_MATCH");
    expect(byId(view, "T_F").condition_status).toBe("TRUE");
    expect(byId(view, "T_KW").condition_status).toBe("TRUE");
    const ta = byId(view, "T_A");
    expect(ta.condition_status).toBe("UNKNOWN");
    expect(view.limitations.join(" ")).toMatch(/insufficient_history/);
  });

  test("PTS quorum 2/4: verdict ikut engine (NO_MATCH), bukan hitungan frontend", () => {
    const view = buildFocusedEvidence(inputFor(fx11, "pompa_tersangkut_sampah"))!;
    expect(view.verdict).toBe("NO_MATCH");
    expect(view.matched_count).toBe(3);
    expect(view.total_conditions).toBe(5);
    expect(byId(view, "PTS_F").condition_status).toBe("TRUE");
    expect(byId(view, "PTS_KW").condition_status).toBe("TRUE");
    expect(byId(view, "PTS_A").condition_status).toBe("TRUE");
    expect(byId(view, "PTS_T").condition_status).toBe("FALSE");
    expect(byId(view, "PTS_RPM").condition_status).toBe("FALSE");
  });

  test("Dry Run boundary 40.01 vs 40.00: DR_F FALSE, threshold null", () => {
    const view = buildFocusedEvidence(inputFor(fx15, "dry_run"))!;
    expect(view.verdict).toBe("NO_MATCH");
    const drf = byId(view, "DR_F");
    expect(drf.condition_status).toBe("FALSE");
    expect(drf.actual_value).toBeCloseTo(40.01, 5);
    expect(drf.threshold_value).toBeNull();
    expect(byId(view, "DR_KW").condition_status).toBe("TRUE");
  });

  test("Unbalance fasa null: UNKNOWN, bukan FALSE dan bukan MATCH", () => {
    const view = buildFocusedEvidence(inputFor(fx16, "unbalance"))!;
    expect(view.verdict).toBe("NO_MATCH");
    expect(byId(view, "UB").condition_status).toBe("UNKNOWN");
  });

  test("multi-match: verdict fokus undervoltage MATCH walau global unbalance", () => {
    const view = buildFocusedEvidence(inputFor(fx14, "undervoltage"))!;
    expect(view.global_trouble).toBe("unbalance");
    expect(view.verdict).toBe("MATCH");
    expect(byId(view, "UV").substitution).toContain("<");
  });

  test("T_A MATCH membawa referensi MA30 + deviasi dari engine", () => {
    const view = buildFocusedEvidence(inputFor(fx02, "turbulensi"))!;
    const ta = byId(view, "T_A");
    expect(ta.condition_status).toBe("TRUE");
    expect(ta.actual_value).toBeCloseTo(615, 5);
    expect(ta.threshold_value).toBe(10);
    expect(ta.reference_detail ?? "").toMatch(/MA30/);
  });

  test("UNSUPPORTED sintetis: NOT_EVALUABLE + missing_requirements", () => {
    const view = buildFocusedEvidence({
      ...inputFor(fx09, "unbalance"),
      ruleEvaluations: [{
        trouble_type: "unbalance",
        capability_status: "UNSUPPORTED",
        evaluation: null,
        missing_requirements: ["unbalance_rule_config"],
        matched_conditions: [],
        total_conditions: 1,
      }],
    })!;
    expect(view.verdict).toBe("NOT_EVALUABLE");
    expect(view.missing_requirements).toContain("unbalance_rule_config");
    expect(byId(view, "UB").condition_status).toBe("UNKNOWN");
  });

  test("string korup: UNKNOWN, bukan FALSE", () => {    const view = buildFocusedEvidence({
      ...inputFor(fx06, "undervoltage"),
      ruleEvaluations: [{
        trouble_type: "undervoltage",
        capability_status: "READY",
        evaluation: "MATCH",
        missing_requirements: [],
        matched_conditions: ["input_voltage ??? bogus-format"],
        total_conditions: 1,
      }],
    })!;
    expect(view.verdict).toBe("MATCH");
    expect(byId(view, "UV").condition_status).toBe("UNKNOWN");
  });

  test("nama kondisi dikenali tetapi format angka berubah: UNKNOWN (drift)", () => {
    const view = buildFocusedEvidence({
      ...inputFor(fx03, "banyak_sampah"),
      ruleEvaluations: [{
        trouble_type: "banyak_sampah",
        capability_status: "READY",
        evaluation: "MATCH",
        missing_requirements: [],
        // Hint ^output_power= cocok, pola ketat tidak => drift, bukan FALSE.
        matched_conditions: ["output_power=450.0 at-least 400"],
        total_conditions: 4,
      }],
    })!;
    expect(view.verdict).toBe("MATCH");
    const kw = byId(view, "BS_KW");
    expect(kw.condition_status).toBe("UNKNOWN");
    expect(kw.note ?? "").toMatch(/Format angka engine berubah/);
  });

  test("substitusi T_A memakai |I-Iref|≥Δ dari engine", () => {
    const view = buildFocusedEvidence(inputFor(fx02, "turbulensi"))!;
    const ta = byId(view, "T_A");
    expect(ta.substitution).toBe("|615.0 − 600.0| ≥ 10.0");
    expect(ta.threshold_value).toBe(10);
  });

  test("E2: threshold FALSE dari tier-refs runtime (contoh PTS 5000 LPS)", () => {
    const view = buildFocusedEvidence(inputFor(fx09, "pompa_tersangkut_sampah", { refs: REFS }))!;
    expect(view.verdict).toBe("NO_MATCH");
    const kw = byId(view, "PTS_KW");
    expect(kw.condition_status).toBe("FALSE");
    expect(kw.threshold_value).toBe(400);
    expect(kw.threshold_source).toBe("refs");
    expect(kw.substitution).toContain("≥");
    expect(kw.substitution).toContain("400");
    const ka = byId(view, "PTS_A");
    expect(ka.threshold_value).toBe(867);
    expect(ka.threshold_source).toBe("refs");
    // Slot yang tak diekspos tier-refs tetap jujur null (F/T).
    // PTS_RPM TRUE di fixture ini (990 ≥ 100 dari engine).
    expect(byId(view, "PTS_F").threshold_value).toBeNull();
    expect(byId(view, "PTS_T").threshold_value).toBeNull();
    expect(byId(view, "PTS_RPM").condition_status).toBe("TRUE");
  });

  test("E2: voltage/UB FALSE memakai capabilities refs", () => {
    const uv = buildFocusedEvidence(inputFor(fx09, "undervoltage", { refs: REFS }))!;
    expect(byId(uv, "UV").threshold_value).toBe(360);
    expect(byId(uv, "UV").threshold_source).toBe("refs");
    const ub = buildFocusedEvidence(inputFor(fx09, "unbalance", { refs: REFS }))!;
    expect(byId(ub, "UB").threshold_value).toBe(10);
  });

  test("E2: tanpa refs => fallback Jalur A (threshold null + note)", () => {
    const view = buildFocusedEvidence(inputFor(fx09, "pompa_tersangkut_sampah"))!;
    expect(byId(view, "PTS_KW").threshold_value).toBeNull();
    expect(byId(view, "PTS_KW").note ?? "").toMatch(/tidak disediakan/);
  });

  test("E5: grup QUORUM menghitung terpenuhi/total", () => {
    const view = buildFocusedEvidence(inputFor(fx11, "pompa_tersangkut_sampah", { refs: REFS }))!;
    const ptsI = (view.root.children as unknown as EvidenceGroupView[])
      .find((g) => (g as EvidenceGroupView).group_id === "PTS_I") as EvidenceGroupView;
    expect(ptsI.satisfied).toBe(2);
    expect(ptsI.total).toBe(4);
    expect(ptsI.quorum_needed).toBe(3);
  });
});
