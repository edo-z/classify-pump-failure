#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { RulesEngine, RULES_FILE } from "../backend-node/src/engine/engine.ts";
import { getProfileCapacity } from "../backend-node/src/engine/profiles.ts";
import { resolveEffectiveSetpoint } from "../backend-node/src/engine/setpoints.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GOLDEN = path.resolve(HERE, "../backend-node/test/golden");
const SETPOINTS_FILE = path.resolve(HERE, "../backend-node/src/engine/profile_setpoints.json");
const TEMPLATE_FILE = path.join(HERE, "aturan.template.html");
const OUT_FILE = path.join(HERE, "aturan.html");

const PROFILE_IDS = ["500_lps", "3000_lps", "5000_lps"];
const PROFILE_LABELS = {
  "500_lps": "500 lps",
  "3000_lps": "3000 lps",
  "5000_lps": "5000 lps",
};
const TIER_KEYS = {
  "500_lps": "500",
  "3000_lps": "3000",
  "5000_lps": "5000",
};

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

const TIER_RULE_ORDER = RULE_ORDER.slice(0, 4);
const GLOBAL_RULE_ORDER = RULE_ORDER.slice(4);

const RULE_NAMES = {
  pompa_tersangkut_sampah: "Pompa tersangkut sampah",
  turbulensi: "Turbulensi",
  banyak_sampah: "Banyak sampah",
  dry_run: "Dry run",
  panel_overheat: "Panel overheat",
  unbalance: "Unbalance",
  undervoltage: "Undervoltage",
  overvoltage: "Overvoltage",
  normal: "Normal",
};

const RULE_KEYS = {
  pompa_tersangkut_sampah: "POMPA_TERSANGKUT_SAMPAH",
  turbulensi: "TURBULENSI",
  banyak_sampah: "BANYAK_SAMPAH",
  dry_run: "DRY_RUN",
  panel_overheat: "PANEL_OVERHEAT",
};

const RULE_LOGIC = {
  pompa_tersangkut_sampah:
    "Frekuensi ≤ 10 Hz wajib; minimal 3 dari 4 tanda beban terpenuhi.",
  turbulensi:
    "Frekuensi di bawah setpoint, arus menyimpang dari MA30/CMA, daya dan torsi di atas acuan. Semua 4 wajib.",
  banyak_sampah:
    "Frekuensi tidak melewati setpoint; daya, arus, dan torsi di atas acuan. Semua 4 wajib.",
  dry_run:
    "Frekuensi tepat di setpoint; daya, arus, dan torsi rendah. Semua 4 wajib.",
  panel_overheat:
    "Salah satu dari tiga titik suhu mencapai 60 °C.",
  unbalance:
    "Salah satu fasa menyimpang 10% atau lebih dari rata-rata arus tiga fasa.",
  undervoltage:
    "Tegangan masukan di bawah batas operasi.",
  overvoltage:
    "Tegangan masukan di atas batas operasi.",
  normal:
    "Tidak ada aturan yang cocok.",
};

const GOLDEN_FOR_RULE = {
  "500_lps": {
    banyak_sampah: "23_tier500_banyak_sampah",
    pompa_tersangkut_sampah: null,
    turbulensi: null,
    dry_run: null,
  },
  "3000_lps": {
    banyak_sampah: "24_tier3000_banyak_sampah",
    pompa_tersangkut_sampah: null,
    turbulensi: null,
    dry_run: null,
  },
  "5000_lps": {
    pompa_tersangkut_sampah: "02_pompa_tersangkut_sampah",
    turbulensi: "09_turbulensi_ma30",
    banyak_sampah: "03_banyak_sampah",
    dry_run: "04_dry_run",
  },
};

const GLOBAL_GOLDEN = {
  panel_overheat: "08_panel_overheat",
  unbalance: "05_unbalance",
  undervoltage: "06_undervoltage",
  overvoltage: "07_overvoltage",
  normal: "01_normal",
};

const nf = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 3 });
const fmt = (value) => nf.format(value);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function esc(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function formatUnit(unit) {
  if (unit === "C") return "°C";
  if (!unit) return "";
  return unit;
}

function formatValue(value, unit) {
  if (typeof value !== "number") return String(value);
  const suffix = formatUnit(unit);
  if (!suffix) return fmt(value);
  return suffix === "%" ? `${fmt(value)}%` : `${fmt(value)} ${suffix}`;
}

function setpointFor(profileId, setpoints) {
  const raw = setpoints[profileId];
  assert(raw, `missing setpoint for ${profileId}`);
  return raw;
}

function opText(op) {
  return { "<=": "≤", ">=": "≥", "<": "<", ">": ">", "==": "=" }[op] ?? op;
}

function conditionText(condition, setpoint) {
  const { field, op, value, unit, threshold, window } = condition;
  const frequency = setpoint.frequency_hz;

  if (field === "output_frequency") {
    if (op === "not_reaching_setpoint") return `Frekuensi < ${fmt(frequency)} Hz`;
    if (op === "not_exceeding_setpoint") return `Frekuensi ≤ ${fmt(frequency)} Hz`;
    if (op === "==") return `Frekuensi = ${fmt(frequency)} Hz (2 desimal)`;
    return `Frekuensi ${opText(op)} ${formatValue(value, unit)}`;
  }
  if (field === "output_power") {
    return `Daya ${opText(op)} ${formatValue(value, unit)}`;
  }
  if (field === "motor_current") {
    if (op === "deviation_from_ma") {
      return `|Arus − MA${window ?? 30}| ≥ ${fmt(threshold)} A`;
    }
    return `Arus ${opText(op)} ${formatValue(value, unit)}`;
  }
  if (field === "motor_torque") {
    return `Torsi ${opText(op)} ${formatValue(value, unit)}`;
  }
  if (field === "motor_speed") {
    return `Putaran ${opText(op)} ${formatValue(value, unit)}`;
  }
  if (field === "ambient_temperature") {
    return `Ambient ${opText(op)} ${formatValue(value, unit)}`;
  }
  if (field === "control_board_temperature") {
    return `Papan kontrol ${opText(op)} ${formatValue(value, unit)}`;
  }
  if (field === "inverter_temperature") {
    return `Inverter ${opText(op)} ${formatValue(value, unit)}`;
  }
  return `${field} ${opText(op)} ${value ?? ""}`.trim();
}

function capabilityTexts(rules) {
  const unbalance = rules.capability_rules.UNBALANCE;
  const undervoltage = rules.capability_rules.UNDERVOLTAGE;
  const overvoltage = rules.capability_rules.OVERVOLTAGE;
  return {
    unbalance: [
      `Deviasi fasa maksimum ${opText(unbalance.operator)} ${fmt(unbalance.threshold_pct)}%`,
    ],
    undervoltage: [
      `Tegangan ${undervoltage.operator} ${fmt(undervoltage.threshold_v)} V`,
    ],
    overvoltage: [
      `Tegangan ${overvoltage.operator} ${fmt(overvoltage.threshold_v)} V`,
    ],
  };
}

function ruleConditions(rule) {
  return (rule.conditions ?? []).map((condition) => condition);
}

function thresholdList(items) {
  return `<ul class="threshold-list">${items
    .map((item) => `<li>${esc(item)}</li>`)
    .join("")}</ul>`;
}

function buildMatrix(rules, setpoints, capabilities) {
  const rows = [];

  for (const id of TIER_RULE_ORDER) {
    const cells = PROFILE_IDS.map((profileId) => {
      const tier = rules.tiers[TIER_KEYS[profileId]];
      const definition = tier.rules[RULE_KEYS[id]];
      assert(definition, `missing ${id} for ${profileId}`);
      const setpoint = setpointFor(profileId, setpoints);
      const items = ruleConditions(definition).map((condition) =>
        conditionText(condition, setpoint),
      );
      return `<td data-label="${esc(PROFILE_LABELS[profileId])}">${thresholdList(items)}</td>`;
    });

    rows.push(`<tr>
      <th scope="row">
        <div class="matrix-rule">
          <h3>${esc(RULE_NAMES[id])}</h3>
          <p>${esc(RULE_LOGIC[id])}</p>
        </div>
      </th>
      ${cells.join("")}
    </tr>`);
  }

  for (const id of GLOBAL_RULE_ORDER) {
    let items;
    if (id === "panel_overheat") {
      const definition = rules.tiers.panel_overheat.rules.PANEL_OVERHEAT;
      items = ruleConditions(definition).map((condition) =>
        conditionText(condition, setpointFor("5000_lps", setpoints)),
      );
    } else {
      items = capabilities[id];
    }
    rows.push(`<tr>
      <th scope="row">
        <div class="matrix-rule">
          <h3>${esc(RULE_NAMES[id])}</h3>
          <p>${esc(RULE_LOGIC[id])}</p>
        </div>
      </th>
      <td colspan="3" data-label="Ambang global" class="matrix-global">
        <span class="matrix-global-label">Global · semua tier</span>
        ${thresholdList(items)}
      </td>
    </tr>`);
  }

  rows.push(`<tr>
    <th scope="row">
      <div class="matrix-rule">
        <h3>Normal</h3>
        <p>${esc(RULE_LOGIC.normal)}</p>
      </div>
    </th>
    <td colspan="3" data-label="Fallback" class="matrix-global">
      <span class="matrix-global-label">Fallback · semua tier</span>
      <p class="matrix-normal">Tidak ada aturan yang cocok → <strong>normal</strong>.</p>
    </td>
  </tr>`);

  return rows.join("\n");
}

function buildSetpointRows(setpoints) {
  return PROFILE_IDS.map((profileId) => {
    const setpoint = setpointFor(profileId, setpoints);
    return `<tr>
      <th scope="row">${esc(PROFILE_LABELS[profileId])}</th>
      <td data-label="Frekuensi">${fmt(setpoint.frequency_hz)} Hz</td>
      <td data-label="Putaran">${fmt(setpoint.rpm)} RPM</td>
      <td data-label="Torsi">${fmt(setpoint.torque)}%</td>
    </tr>`;
  }).join("\n");
}

function readingTimestamp(index) {
  return {
    epochMs: Date.UTC(2026, 0, 1) + index * 1000,
    offsetMinutes: 0,
    frac: "",
  };
}

function reading(index, overrides = {}) {
  return {
    timestamp: readingTimestamp(index),
    motor_speed: 900,
    output_frequency: 30,
    motor_current: 100,
    motor_torque: 95,
    output_power: 100,
    hours_run: null,
    output_voltage: null,
    ambient_temperature: 30,
    control_board_temperature: 40,
    inverter_temperature: 45,
    input_voltage: 380,
    flux_actual: null,
    motor_estimated_temperature: null,
    arus_rms_u: 100,
    arus_rms_v: 100,
    arus_rms_w: 100,
    ...overrides,
  };
}

function tierRefs(rules, profileId) {
  const definition = rules.tiers[TIER_KEYS[profileId]].rules.POMPA_TERSANGKUT_SAMPAH;
  const power = definition.conditions.find((c) => c.field === "output_power");
  const current = definition.conditions.find((c) => c.field === "motor_current");
  const turbulence = rules.tiers[TIER_KEYS[profileId]].rules.TURBULENSI;
  const threshold = turbulence.conditions.find(
    (c) => c.op === "deviation_from_ma",
  );
  return {
    power: Number(power.value),
    current: Number(current.value),
    currentThreshold: Number(threshold.threshold),
    currentWindow: Number(threshold.window),
  };
}

function derivedReadings(rules, profileId, ruleId) {
  const refs = tierRefs(rules, profileId);
  const setpoint = resolveEffectiveSetpoint(profileId);
  const frequency = setpoint.frequency;
  assert(typeof frequency === "number" && frequency > 0, `invalid setpoint ${profileId}`);

  if (ruleId === "pompa_tersangkut_sampah") {
    return [
      reading(0, {
        output_frequency: 8,
        output_power: refs.power * 1.1,
        motor_current: refs.current * 1.1,
        motor_torque: 80,
        motor_speed: 900,
      }),
    ];
  }

  if (ruleId === "turbulensi") {
    const baseCurrent = refs.current * 0.5;
    const readings = Array.from({ length: refs.currentWindow }, (_, index) =>
      reading(index, {
        output_frequency: frequency - 5,
        output_power: refs.power * 1.1,
        motor_current: baseCurrent,
        motor_torque: 95,
      }),
    );
    readings.push(
      reading(refs.currentWindow, {
        output_frequency: frequency - 5,
        output_power: refs.power * 1.1,
        motor_current: baseCurrent + refs.currentThreshold + 5,
        motor_torque: 95,
      }),
    );
    return readings;
  }

  if (ruleId === "dry_run") {
    const dryPower = refs.power * 0.5;
    const dryCurrent = refs.current * 0.5;
    return [
      reading(0, {
        output_frequency: frequency,
        output_power: dryPower,
        motor_current: dryCurrent,
        motor_torque: 40,
      }),
    ];
  }

  throw new Error(`no derived fixture for ${ruleId}`);
}

function classify(profileId, readings, namespace) {
  const engine = new RulesEngine(RULES_FILE);
  const capacity = getProfileCapacity(profileId);
  return engine.classify(
    readings,
    { pump_id: capacity, capacity_lps: capacity },
    resolveEffectiveSetpoint(profileId),
    namespace,
  );
}

async function readGolden(name) {
  const input = JSON.parse(
    await readFile(path.join(GOLDEN, `${name}.input.json`), "utf8"),
  );
  const expected = JSON.parse(
    await readFile(path.join(GOLDEN, `${name}.expected.json`), "utf8"),
  );
  return { input, result: expected.classification };
}

function lastReading(input) {
  assert(
    Array.isArray(input.readings) && input.readings.length > 0,
    "example without readings",
  );
  return input.readings.at(-1);
}

function inputSummary(ruleId, input) {
  const last = lastReading(input);
  const parts = [];
  const add = (label, value) => parts.push(`${label} ${value}`);

  if (ruleId === "pompa_tersangkut_sampah") {
    add("frekuensi", `${fmt(last.output_frequency)} Hz`);
    add("daya", `${fmt(last.output_power)} kW`);
    add("arus", `${fmt(last.motor_current)} A`);
    add("torsi", `${fmt(last.motor_torque)}%`);
    add("putaran", `${fmt(last.motor_speed)} RPM`);
    return parts.join(" · ");
  }

  if (ruleId === "turbulensi") {
    const readings = input.readings;
    const current = Number(last.motor_current);
    const previous = readings
      .slice(0, -1)
      .map((item) => item.motor_current)
      .filter((value) => typeof value === "number")
      .slice(-30);
    const average = previous.reduce((sum, value) => sum + value, 0) / previous.length;
    const reference = previous.length >= 30 ? "MA30" : `CMA${previous.length}`;
    add("bacaan", String(readings.length));
    add("frekuensi", `${fmt(last.output_frequency)} Hz`);
    add("daya", `${fmt(last.output_power)} kW`);
    add("torsi", `${fmt(last.motor_torque)}%`);
    add("arus", `${fmt(current)} A vs ${reference} ${fmt(average)} A`);
    return parts.join(" · ");
  }

  if (ruleId === "banyak_sampah") {
    add("frekuensi", `${fmt(last.output_frequency)} Hz`);
    add("daya", `${fmt(last.output_power)} kW`);
    add("arus", `${fmt(last.motor_current)} A`);
    add("torsi", `${fmt(last.motor_torque)}%`);
    return parts.join(" · ");
  }

  if (ruleId === "dry_run") {
    add("frekuensi", `${fmt(last.output_frequency)} Hz`);
    add("daya", `${fmt(last.output_power)} kW`);
    add("arus", `${fmt(last.motor_current)} A`);
    add("torsi", `${fmt(last.motor_torque)}%`);
    return parts.join(" · ");
  }

  if (ruleId === "panel_overheat") {
    add("ambient", `${fmt(last.ambient_temperature)} °C`);
    add("papan kontrol", `${fmt(last.control_board_temperature)} °C`);
    add("inverter", `${fmt(last.inverter_temperature)} °C`);
    return parts.join(" · ");
  }

  if (ruleId === "unbalance") {
    add("fasa U", `${fmt(last.arus_rms_u)} A`);
    add("fasa V", `${fmt(last.arus_rms_v)} A`);
    add("fasa W", `${fmt(last.arus_rms_w)} A`);
    return parts.join(" · ");
  }

  if (ruleId === "undervoltage" || ruleId === "overvoltage") {
    add("tegangan", `${fmt(last.input_voltage)} V`);
    return parts.join(" · ");
  }

  add("frekuensi", `${fmt(last.output_frequency)} Hz`);
  add("daya", `${fmt(last.output_power)} kW`);
  add("arus", `${fmt(last.motor_current)} A`);
  add("torsi", `${fmt(last.motor_torque)}%`);
  return parts.join(" · ");
}

function caseData(ruleId, profileId, input, result, source, sourceDetail) {
  return {
    ruleId,
    profileId,
    summary: inputSummary(ruleId, input),
    result,
    trouble_type: result.trouble_type,
    matched_rules: result.matched_rules,
    source,
    sourceDetail,
  };
}

function prettyCondition(text) {
  return text
    .replace(/MA30(?=\d)/g, "MA30 ")
    .replace(/(\|Δ\|)(?=\d)/g, "$1 ")
    .replace(/>=/g, " ≥ ")
    .replace(/<=/g, " ≤ ")
    .replace(/(?<=\d)\.(?=\d)/g, ",")
    .replace(/\s+/g, " ")
    .trim();
}

function exampleRow(item, label) {
  const resultName = RULE_NAMES[item.trouble_type] ?? item.trouble_type;
  const grouped = new Map();
  for (const rule of item.matched_rules) {
    const name = RULE_NAMES[rule.trouble_type] ?? rule.trouble_type;
    const conditions = grouped.get(name) ?? [];
    conditions.push(...rule.matched_conditions);
    grouped.set(name, conditions);
  }
  const renderConditions = (conditions) =>
    `<ul class="condition-list">${conditions
      .map((condition) => `<li>${esc(prettyCondition(condition))}</li>`)
      .join("")}</ul>`;
  let conditionBlock = `<p class="example-empty">Tidak ada aturan yang cocok.</p>`;
  if (grouped.size > 0) {
    conditionBlock = renderConditions(grouped.get(resultName) ?? []);
    for (const [name, conditions] of grouped) {
      if (name === resultName) continue;
      conditionBlock += `<p class="example-also">Cocok juga: ${esc(name)}</p>`;
      conditionBlock += renderConditions(conditions);
    }
  }

  return `<tr>
    <th scope="row">
      <span class="tier-name">${esc(label)}</span>
      <span class="source-label" data-kind="${item.source}">${esc(item.source)}</span>
    </th>
    <td data-label="Masukan"><p class="example-input">${esc(item.summary)}</p></td>
    <td data-label="Hasil">
      <p class="example-result"><strong>${esc(resultName)}</strong> <span>trouble_type</span></p>
      ${conditionBlock}
      <p class="source-detail">${esc(item.sourceDetail)}</p>
    </td>
  </tr>`;
}

async function buildTierExamples(rules) {
  const groups = [];

  for (const ruleId of TIER_RULE_ORDER) {
    const rows = [];

    for (const profileId of PROFILE_IDS) {
      const goldenName = GOLDEN_FOR_RULE[profileId][ruleId];
      let item;

      if (goldenName) {
        const golden = await readGolden(goldenName);
        assert(
          golden.input.profile_id === profileId,
          `${goldenName}: profile mismatch`,
        );
        item = caseData(
          ruleId,
          profileId,
          golden.input,
          golden.result,
          "terekam",
          `golden ${goldenName}`,
        );
        assert(
          item.trouble_type === ruleId,
          `${goldenName}: expected ${ruleId}, got ${item.trouble_type}`,
        );
      } else {
        const input = { readings: derivedReadings(rules, profileId, ruleId) };
        const result = classify(profileId, input.readings, `aturan:${profileId}:${ruleId}`);
        item = caseData(
          ruleId,
          profileId,
          input,
          result,
          "turunan",
          `engine · ${PROFILE_LABELS[profileId]}`,
        );
        assert(
          item.trouble_type === ruleId,
          `${profileId}/${ruleId}: derived example produced ${item.trouble_type}`,
        );
        assert(
          item.matched_rules.length === 1,
          `${profileId}/${ruleId}: derived example must isolate one rule`,
        );
      }

      rows.push(exampleRow(item, PROFILE_LABELS[profileId]));
    }

    groups.push(`<article class="example-group">
      <header class="example-head">
        <div>
          <h3>${esc(RULE_NAMES[ruleId])}</h3>
          <p>${esc(RULE_LOGIC[ruleId])}</p>
        </div>
        <span class="example-count">3 tier</span>
      </header>
      <div class="table-scroll example-scroll" tabindex="0" role="region" aria-label="Contoh ${esc(RULE_NAMES[ruleId])} per tier">
        <table class="example-table">
          <caption class="visually-hidden">Contoh ${esc(RULE_NAMES[ruleId])} untuk 500, 3000, dan 5000 lps</caption>
          <thead>
            <tr><th scope="col">Tier</th><th scope="col">Masukan</th><th scope="col">Hasil</th></tr>
          </thead>
          <tbody>${rows.join("\n")}</tbody>
        </table>
      </div>
    </article>`);
  }

  return groups.join("\n");
}

async function buildGlobalExamples() {
  const rows = [];

  for (const ruleId of [...GLOBAL_RULE_ORDER, "normal"]) {
    const goldenName = GLOBAL_GOLDEN[ruleId];
    const golden = await readGolden(goldenName);
    const item = caseData(
      ruleId,
      "5000_lps",
      golden.input,
      golden.result,
      "terekam",
      `golden ${goldenName}`,
    );
    assert(
      item.trouble_type === ruleId,
      `${goldenName}: expected ${ruleId}, got ${item.trouble_type}`,
    );
    rows.push(exampleRow(item, "Global"));
  }

  return `<article class="example-group">
    <header class="example-head">
      <div>
        <h3>Aturan global</h3>
        <p>Panel, unbalance, dan tegangan tidak bergantung pada ukuran pompa. Contoh diambil dari profil 5000 lps.</p>
      </div>
      <span class="example-count">5 contoh</span>
    </header>
    <div class="table-scroll example-scroll" tabindex="0" role="region" aria-label="Contoh aturan global">
      <table class="example-table">
        <caption class="visually-hidden">Contoh aturan global dan kondisi normal</caption>
        <thead>
          <tr><th scope="col">Cakupan</th><th scope="col">Masukan</th><th scope="col">Hasil</th></tr>
        </thead>
        <tbody>${rows.join("\n")}</tbody>
      </table>
    </div>
  </article>`;
}

function buildRawBlocks(rules) {
  const blocks = [];

  for (const profileId of PROFILE_IDS) {
    const tierKey = TIER_KEYS[profileId];
    const raw = {
      tier: tierKey,
      rules: rules.tiers[tierKey].rules,
    };
    blocks.push(`<details class="raw-item">
      <summary>
        <span>${esc(PROFILE_LABELS[profileId])}</span>
        <span class="raw-meta">4 aturan tier</span>
      </summary>
      <pre class="raw-code"><code>${esc(JSON.stringify(raw, null, 2))}</code></pre>
    </details>`);
  }

  blocks.push(`<details class="raw-item">
    <summary>
      <span>Global</span>
      <span class="raw-meta">panel + capability rules</span>
    </summary>
    <pre class="raw-code"><code>${esc(
      JSON.stringify(
        {
          panel_overheat: rules.tiers.panel_overheat,
          capability_rules: rules.capability_rules,
        },
        null,
        2,
      ),
    )}</code></pre>
  </details>`);

  return blocks.join("\n");
}

function assertPage(html, rules) {
  for (const name of Object.values(RULE_NAMES)) {
    assert(html.includes(esc(name)), `page missing rule: ${name}`);
  }
  for (const profileId of PROFILE_IDS) {
    assert(html.includes(PROFILE_LABELS[profileId]), `page missing ${profileId}`);
  }
  assert(html.includes("Aturan mentah"), "page missing raw rules section");
  assert(html.includes(`v${esc(rules.version)}`), "page missing rule version");

  const matrixRows = (html.match(/<div class="matrix-rule">/g) ?? []).length;
  assert(
    matrixRows === RULE_ORDER.length + 1,
    `page has ${matrixRows} matrix rows, expected ${RULE_ORDER.length + 1}`,
  );
  const exampleGroups = (html.match(/<article class="example-group">/g) ?? []).length;
  assert(
    exampleGroups === TIER_RULE_ORDER.length + 1,
    `page has ${exampleGroups} example groups, expected ${TIER_RULE_ORDER.length + 1}`,
  );
  const exampleRows = (html.match(/<span class="tier-name">/g) ?? []).length;
  assert(
    exampleRows === TIER_RULE_ORDER.length * PROFILE_IDS.length + GLOBAL_RULE_ORDER.length + 1,
    `page has ${exampleRows} example rows`,
  );
  const rawItems = (html.match(/<details class="raw-item">/g) ?? []).length;
  assert(
    rawItems === PROFILE_IDS.length + 1,
    `page has ${rawItems} raw blocks, expected ${PROFILE_IDS.length + 1}`,
  );
}

async function main() {
  const rules = JSON.parse(await readFile(RULES_FILE, "utf8"));
  const setpoints = JSON.parse(await readFile(SETPOINTS_FILE, "utf8"));
  const template = await readFile(TEMPLATE_FILE, "utf8");

  assert(PROFILE_IDS.length === 3, "rules page requires 3 profiles");
  assert(RULE_ORDER.length === 8, "rules page requires 8 rules");

  const capabilities = capabilityTexts(rules);
  const replacements = {
    "{{RULE_VERSION}}": esc(rules.version),
    "{{SETPOINT_ROWS}}": buildSetpointRows(setpoints),
    "{{MATRIX_ROWS}}": buildMatrix(rules, setpoints, capabilities),
    "{{TIER_EXAMPLE_GROUPS}}": await buildTierExamples(rules),
    "{{GLOBAL_EXAMPLES}}": await buildGlobalExamples(),
    "{{RAW_BLOCKS}}": buildRawBlocks(rules),
  };

  let html = template;
  for (const [token, value] of Object.entries(replacements)) {
    assert(html.includes(token), `template missing ${token}`);
    html = html.replaceAll(token, value);
  }

  assertPage(html, rules);

  const serialized = `${html.trim()}\n`;
  const check = process.argv.includes("--check");

  if (check) {
    let current = "";
    try {
      current = await readFile(OUT_FILE, "utf8");
    } catch {
      throw new Error("aturan.html is missing; run node build-rules.mjs");
    }
    if (current !== serialized) {
      throw new Error("aturan.html is stale; run node build-rules.mjs");
    }
    console.log("[aturan] aturan.html is current (3 tiers, 8 rules)");
    return;
  }

  await writeFile(OUT_FILE, serialized);
  console.log("[aturan] wrote aturan.html (3 tiers, 8 rules)");
}

main().catch((error) => {
  console.error(`[aturan] ${error.message}`);
  process.exit(1);
});
