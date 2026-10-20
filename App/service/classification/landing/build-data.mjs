#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BACKEND = path.resolve(HERE, "../backend-node");
const GOLDEN = path.join(BACKEND, "test/golden");
const RULES_FILE = path.join(BACKEND, "src/engine/rules.json");
const SETPOINTS_FILE = path.join(BACKEND, "src/engine/profile_setpoints.json");
const OUT_FILE = path.join(HERE, "data.json");

const PROFILE_ID = "5000_lps";
const PROFILE_LABEL = "5000 lps";
const DEFAULT_CASE = "pompa_tersangkut_sampah";

const CASE_FILES = [
  { id: "normal", file: "01_normal", label: "Normal", short: "Normal" },
  {
    id: "pompa_tersangkut_sampah",
    file: "02_pompa_tersangkut_sampah",
    label: "Pompa tersangkut sampah",
    short: "Tersangkut sampah",
  },
  {
    id: "banyak_sampah",
    file: "03_banyak_sampah",
    label: "Banyak sampah",
    short: "Banyak sampah",
  },
  { id: "dry_run", file: "04_dry_run", label: "Dry run", short: "Dry run" },
  {
    id: "unbalance",
    file: "05_unbalance",
    label: "Unbalance",
    short: "Unbalance",
  },
  {
    id: "undervoltage",
    file: "06_undervoltage",
    label: "Undervoltage",
    short: "Undervoltage",
  },
  {
    id: "overvoltage",
    file: "07_overvoltage",
    label: "Overvoltage",
    short: "Overvoltage",
  },
  {
    id: "panel_overheat",
    file: "08_panel_overheat",
    label: "Panel overheat",
    short: "Panel overheat",
  },
  {
    id: "turbulensi",
    file: "09_turbulensi_ma30",
    label: "Turbulensi",
    short: "Turbulensi",
  },
];

const RULE_ORDER = [
  "pompa_tersangkut_sampah",
  "turbulensi",
  "banyak_sampah",
  "dry_run",
  "panel_overheat",
  "unbalance",
  "undervoltage",
  "overvoltage",
];

const RULE_NAMES = {
  pompa_tersangkut_sampah: "Pompa tersangkut sampah",
  turbulensi: "Turbulensi",
  banyak_sampah: "Banyak sampah",
  dry_run: "Dry run",
  panel_overheat: "Panel overheat",
  unbalance: "Unbalance",
  undervoltage: "Undervoltage",
  overvoltage: "Overvoltage",
};

const nf = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 2 });
const fmt = (value) => nf.format(value);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function conditionByField(conditions, field) {
  const found = conditions.find((condition) => condition.field === field);
  assert(found, `missing condition for ${field}`);
  return found;
}

function metricFor(id, input, result) {
  const reading = input.readings.at(-1);
  const snapshot = result.sensor_snapshot;

  if (id === "unbalance") {
    return `Fasa W ${fmt(reading.arus_rms_w)} A`;
  }
  if (id === "undervoltage" || id === "overvoltage") {
    return `${fmt(reading.input_voltage)} V`;
  }
  if (id === "panel_overheat") {
    const temperatures = [
      snapshot.ambient_temperature,
      snapshot.control_board_temperature,
      snapshot.inverter_temperature,
    ].filter((value) => typeof value === "number");
    return `${fmt(Math.max(...temperatures))} °C`;
  }
  if (id === "turbulensi") {
    return `${result.readings_count} pembacaan`;
  }
  if (id === "dry_run") {
    return `${fmt(reading.output_frequency)} Hz · ${fmt(reading.output_power)} kW`;
  }
  return `${fmt(reading.output_frequency)} Hz · ${fmt(reading.motor_current)} A`;
}

function buildRules(rules, setpoints) {
  const tierKey = PROFILE_ID.split("_")[0];
  const tier = rules.tiers[tierKey].rules;
  const setpoint = setpoints[PROFILE_ID].frequency_hz;

  const pts = tier.POMPA_TERSANGKUT_SAMPAH.conditions;
  const turbulence = tier.TURBULENSI.conditions;
  const trash = tier.BANYAK_SAMPAH.conditions;
  const dry = tier.DRY_RUN.conditions;
  const heat = rules.tiers.panel_overheat.rules.PANEL_OVERHEAT.conditions;

  const ptsFrequency = conditionByField(pts, "output_frequency");
  const ptsPower = conditionByField(pts, "output_power");
  const ptsCurrent = conditionByField(pts, "motor_current");
  const ptsTorque = conditionByField(pts, "motor_torque");
  const ptsSpeed = conditionByField(pts, "motor_speed");

  const turbulencePower = conditionByField(turbulence, "output_power");
  const turbulenceCurrent = conditionByField(turbulence, "motor_current");
  const turbulenceTorque = conditionByField(turbulence, "motor_torque");

  const trashPower = conditionByField(trash, "output_power");
  const trashCurrent = conditionByField(trash, "motor_current");
  const trashTorque = conditionByField(trash, "motor_torque");

  const dryPower = conditionByField(dry, "output_power");
  const dryCurrent = conditionByField(dry, "motor_current");
  const dryTorque = conditionByField(dry, "motor_torque");

  const heatAmbient = conditionByField(heat, "ambient_temperature");
  const heatBoard = conditionByField(heat, "control_board_temperature");
  const heatInverter = conditionByField(heat, "inverter_temperature");

  const unbalance = rules.capability_rules.UNBALANCE;
  const undervoltage = rules.capability_rules.UNDERVOLTAGE;
  const overvoltage = rules.capability_rules.OVERVOLTAGE;

  const summaries = {
    pompa_tersangkut_sampah: {
      logic:
        "Frekuensi rendah plus minimal tiga dari empat tanda beban. Diperiksa pertama.",
      thresholds: [
        `Frekuensi ≤ ${fmt(ptsFrequency.value)} ${ptsFrequency.unit}`,
        `Daya ≥ ${fmt(ptsPower.value)} ${ptsPower.unit}`,
        `Arus ≥ ${fmt(ptsCurrent.value)} ${ptsCurrent.unit}`,
        `Torsi ≥ ${fmt(ptsTorque.value)}${ptsTorque.unit}`,
        `Putaran ≥ ${fmt(ptsSpeed.value)} ${ptsSpeed.unit}`,
      ],
    },
    turbulensi: {
      logic:
        "Frekuensi tidak mencapai setpoint dan arus menyimpang dari rata-rata historis.",
      thresholds: [
        `Frekuensi < setpoint ${fmt(setpoint)} Hz`,
        `Daya ≥ ${fmt(turbulencePower.value)} ${turbulencePower.unit}`,
        `|Arus − MA30| ≥ ${fmt(turbulenceCurrent.threshold)} ${turbulenceCurrent.unit}`,
        `Torsi ≥ ${fmt(turbulenceTorque.value)}${turbulenceTorque.unit}`,
      ],
    },
    banyak_sampah: {
      logic:
        "Frekuensi tertahan di setpoint dengan daya, arus, dan torsi di atas acuan.",
      thresholds: [
        `Frekuensi ≤ setpoint ${fmt(setpoint)} Hz`,
        `Daya ≥ ${fmt(trashPower.value)} ${trashPower.unit}`,
        `Arus ≥ ${fmt(trashCurrent.value)} ${trashCurrent.unit}`,
        `Torsi ≥ ${fmt(trashTorque.value)}${trashTorque.unit}`,
      ],
    },
    dry_run: {
      logic:
        "Frekuensi tepat di setpoint, tetapi daya, arus, dan torsi berada di bawah beban normal.",
      thresholds: [
        `Frekuensi = setpoint ${fmt(setpoint)} Hz, 2 desimal`,
        `Daya ≤ ${fmt(dryPower.value)} ${dryPower.unit}`,
        `Arus ≤ ${fmt(dryCurrent.value)} ${dryCurrent.unit}`,
        `Torsi < ${fmt(dryTorque.value)}${dryTorque.unit}`,
      ],
    },
    panel_overheat: {
      logic: "Suhu panel di atas ambang pada salah satu dari tiga titik ukur.",
      thresholds: [
        `Ambient ≥ ${fmt(heatAmbient.value)} °C`,
        `Control board ≥ ${fmt(heatBoard.value)} °C`,
        `Inverter ≥ ${fmt(heatInverter.value)} °C`,
      ],
    },
    unbalance: {
      logic:
        "Satu fase menyimpang dari rata-rata arus tiga fase. Tidak memakai riwayat.",
      thresholds: [
        `Deviasi fasa maksimum ≥ ${fmt(unbalance.threshold_pct)}%`,
      ],
    },
    undervoltage: {
      logic: "Tegangan masukan berada di bawah batas operasi.",
      thresholds: [
        `Tegangan ${undervoltage.operator} ${fmt(undervoltage.threshold_v)} ${"V"}`,
      ],
    },
    overvoltage: {
      logic: "Tegangan masukan berada di atas batas operasi.",
      thresholds: [
        `Tegangan ${overvoltage.operator} ${fmt(overvoltage.threshold_v)} ${"V"}`,
      ],
    },
  };

  return RULE_ORDER.map((id, index) => ({
    order: index + 1,
    id,
    name: RULE_NAMES[id],
    ...summaries[id],
  }));
}

async function readCase(entry) {
  const input = JSON.parse(
    await readFile(path.join(GOLDEN, `${entry.file}.input.json`), "utf8"),
  );
  const expected = JSON.parse(
    await readFile(path.join(GOLDEN, `${entry.file}.expected.json`), "utf8"),
  );
  const classification = expected.classification;

  return {
    id: entry.id,
    label: entry.label,
    short: entry.short,
    metric: metricFor(entry.id, input, classification),
    input,
    result: {
      trouble_type: classification.trouble_type,
      timestamp: classification.timestamp,
      readings_count: classification.readings_count,
      evaluation_status: classification.evaluation_status,
      matched_rules: classification.matched_rules,
      sensor_snapshot: classification.sensor_snapshot,
      limitations: classification.limitations,
      rule_evaluations: classification.rule_evaluations.map((rule) => ({
        trouble_type: rule.trouble_type,
        evaluation: rule.evaluation,
        capability_status: rule.capability_status,
      })),
    },
  };
}

async function main() {
  const rules = JSON.parse(await readFile(RULES_FILE, "utf8"));
  const setpoints = JSON.parse(await readFile(SETPOINTS_FILE, "utf8"));
  const cases = await Promise.all(CASE_FILES.map(readCase));
  const summaries = buildRules(rules, setpoints);

  assert(cases.length === 9, "landing requires exactly 9 cases");
  assert(summaries.length === 8, "landing requires exactly 8 rules");

  const types = new Set(cases.map((item) => item.result.trouble_type));
  assert(types.size === 9, "every case must resolve to a distinct outcome");

  for (const item of cases) {
    const { input, result } = item;
    assert(input.profile_id === PROFILE_ID, `${item.id}: wrong profile`);
    assert(
      input.readings.length >= 1 && input.readings.length <= 40,
      `${item.id}: readings out of contract range`,
    );
    assert(result.rule_evaluations.length === 8, `${item.id}: missing rules`);
    assert(
      result.readings_count === input.readings.length,
      `${item.id}: readings_count mismatch`,
    );
    for (const reading of input.readings) {
      assert(
        /(?:Z|[+-]\d{2}:\d{2})$/.test(reading.timestamp),
        `${item.id}: timestamp without zone`,
      );
    }
    if (result.trouble_type === "normal") {
      assert(result.matched_rules.length === 0, `${item.id}: normal has a match`);
    } else {
      assert(
        result.matched_rules[0]?.trouble_type === result.trouble_type,
        `${item.id}: first match is not the diagnosis`,
      );
    }
  }

  for (const summary of summaries) {
    assert(summary.thresholds.length > 0, `${summary.id}: empty thresholds`);
  }

  const payload = {
    schema: 1,
    profile_id: PROFILE_ID,
    profile_label: PROFILE_LABEL,
    default_case: DEFAULT_CASE,
    rule_version: rules.version,
    source: {
      rules: "backend-node/src/engine/rules.json",
      setpoints: "backend-node/src/engine/profile_setpoints.json",
      cases: "backend-node/test/golden",
      captured: "2026-10-19",
    },
    rules: summaries,
    cases,
  };

  const serialized = `${JSON.stringify(payload, null, 2)}\n`;
  const check = process.argv.includes("--check");

  if (check) {
    let current = "";
    try {
      current = await readFile(OUT_FILE, "utf8");
    } catch {
      throw new Error("data.json is missing; run node build-data.mjs");
    }
    if (current !== serialized) {
      throw new Error("data.json is stale; run node build-data.mjs");
    }
    console.log("[landing] data.json is current (9 cases, 8 rules)");
    return;
  }

  await writeFile(OUT_FILE, serialized);
  console.log("[landing] wrote data.json (9 cases, 8 rules)");
}

main().catch((error) => {
  console.error(`[landing] ${error.message}`);
  process.exit(1);
});
