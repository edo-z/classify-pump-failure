const API_HOST = "https://class-api.aldozeno.my.id";
const DATA_URL = "/data.json";
const REFRESH_MS = 30_000;
const TIMEOUT_MS = 8_000;

const SENSOR_FIELDS = [
  ["output_frequency", "Frekuensi keluaran", "Hz"],
  ["output_power", "Daya keluaran", "kW"],
  ["motor_current", "Arus motor", "A"],
  ["motor_torque", "Torsi motor", "%"],
  ["motor_speed", "Putaran motor", "RPM"],
  ["ambient_temperature", "Suhu ambient", "°C"],
  ["control_board_temperature", "Suhu control board", "°C"],
  ["inverter_temperature", "Suhu inverter", "°C"],
  ["input_voltage", "Tegangan masuk", "V"],
];

const nf = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 2 });
const dateFmt = new Intl.DateTimeFormat("id-ID", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Asia/Jakarta",
});
const clockFmt = new Intl.DateTimeFormat("id-ID", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  timeZone: "Asia/Jakarta",
});

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

const byId = (id) => document.getElementById(id);

const ui = {
  statusDot: byId("status-dot"),
  statusText: byId("status-text"),
  footerHealth: byId("footer-health"),
  footerChecked: byId("footer-checked"),
  copyCurl: byId("copy-curl"),
  copyCode: byId("copy-code"),
  copyFeedback: byId("copy-feedback"),
  codeFeedback: byId("code-feedback"),
  codeCase: byId("code-case"),
  curlCode: byId("curl-code"),
  caseIndex: byId("case-index"),
  report: byId("report"),
  announcer: byId("report-announcer"),
  ruleList: byId("rule-list"),
  metaProfile: byId("meta-profile"),
  metaTime: byId("meta-time"),
  metaEval: byId("meta-eval"),
};

const state = {
  data: null,
  currentId: null,
  curl: "",
};

function formatNumber(value) {
  return nf.format(value);
}

function formatDate(iso) {
  return `${dateFmt.format(new Date(iso))} WIB`;
}

function formatClock() {
  return `${clockFmt.format(new Date())} WIB`;
}

function setCopyFeedback(node, message, stateName = "ok") {
  if (!node) return;
  node.textContent = message;
  node.dataset.state = stateName;
}

function sensorSummary(snapshot, readingsCount) {
  const parts = [];
  if (typeof snapshot.output_frequency === "number") {
    parts.push(`${formatNumber(snapshot.output_frequency)} Hz`);
  }
  if (typeof snapshot.output_power === "number") {
    parts.push(`${formatNumber(snapshot.output_power)} kW`);
  }
  if (typeof snapshot.motor_current === "number") {
    parts.push(`${formatNumber(snapshot.motor_current)} A`);
  }
  if (typeof snapshot.motor_torque === "number") {
    parts.push(`${formatNumber(snapshot.motor_torque)}%`);
  }
  if (typeof snapshot.motor_speed === "number") {
    parts.push(`${formatNumber(snapshot.motor_speed)} RPM`);
  }
  if (typeof snapshot.input_voltage === "number") {
    parts.push(`${formatNumber(snapshot.input_voltage)} V`);
  }
  parts.push(`${readingsCount} pembacaan`);
  return parts.join(" · ");
}

function humanizeLimitation(text) {
  const history = text.match(
    /TURBULENSI T_A insufficient_history: need_30_got_(\d+) \(need 30 prev, A=([\d.]+)\)/,
  );
  if (history) {
    return `Turbulensi: perlu 30 pembacaan sebelumnya, tersedia ${history[1]} (arus ${formatNumber(Number(history[2]))} A).`;
  }
  return text;
}

function ruleOrder(troubleType) {
  const rule = state.data?.rules.find((item) => item.id === troubleType);
  return rule ? rule.order : "—";
}

function renderIndex() {
  if (!state.data) return;
  ui.caseIndex.replaceChildren();
  for (const item of state.data.cases) {
    const button = el("button", "case-button");
    button.type = "button";
    button.dataset.caseId = item.id;
    button.setAttribute("aria-pressed", "false");
    button.append(el("span", "case-label", item.short), el("span", "case-metric", item.metric));
    button.addEventListener("click", () => selectCase(item.id));
    ui.caseIndex.append(button);
  }
}

function renderVerdict(item) {
  const result = item.result;
  const verdict = el("div", "verdict");
  const stateName = result.trouble_type === "normal" ? "normal" : "fault";
  const stateLabel =
    result.evaluation_status === "FULL"
      ? result.trouble_type === "normal"
        ? "Normal"
        : "Gangguan"
      : "Evaluasi terbatas";

  const stateNode = el("p", "verdict-state", stateLabel);
  stateNode.dataset.state = stateName;

  const title =
    result.trouble_type === "normal" ? "Tidak ada pola gangguan" : item.label;
  const summary = sensorSummary(result.sensor_snapshot, result.readings_count);

  const note = el("p", "verdict-note");
  if (result.matched_rules.length === 0) {
    note.append(
      el("strong", "", "0 aturan cocok. "),
      document.createTextNode("Delapan aturan dievaluasi; tidak ada pola gangguan."),
    );
  } else {
    note.append(
      el(
        "strong",
        "",
        `${result.matched_rules.length} aturan cocok. `,
      ),
      document.createTextNode(
        "Diagnosis diambil dari aturan pertama yang cocok.",
      ),
    );
  }

  verdict.append(
    el("h3", "", title),
    stateNode,
    el("p", "verdict-summary", summary),
    note,
  );
  return verdict;
}

function renderEvidence(item) {
  const section = el("div", "evidence");
  section.append(el("h4", "", "Bukti aturan"));

  if (item.result.matched_rules.length === 0) {
    section.append(
      el(
        "p",
        "empty-evidence",
        "Tidak ada aturan yang cocok. Semua aturan berstatus tidak cocok.",
      ),
    );
    return section;
  }

  item.result.matched_rules.forEach((rule, index) => {
    const block = el("div", "matched-rule");
    const tag = el(
      "p",
      "rule-tag",
      `Aturan ${ruleOrder(rule.trouble_type)} · ${index === 0 ? "dipakai" : "juga cocok"}`,
    );
    tag.dataset.used = String(index === 0);

    const conditions = el("ul", "rule-conditions");
    for (const condition of rule.matched_conditions) {
      conditions.append(el("li", "", condition));
    }

    block.append(tag, conditions);
    section.append(block);
  });

  return section;
}

function renderSensors(item) {
  const section = el("div", "sensors");
  section.append(el("h4", "", "Data sensor"));

  const grid = el("dl", "sensor-grid");
  const snapshot = item.result.sensor_snapshot;

  for (const [field, label, unit] of SENSOR_FIELDS) {
    const row = el("div");
    const value = snapshot[field];
    const definition = el("dd");
    if (typeof value === "number" && Number.isFinite(value)) {
      definition.textContent = `${formatNumber(value)} ${unit}`;
    } else {
      definition.textContent = "tidak ada";
      definition.dataset.missing = "true";
    }
    row.append(el("dt", "", label), definition);
    grid.append(row);
  }

  section.append(
    grid,
    el("p", "sensor-note", "Nilai yang tidak ada tidak diisi nol."),
    el("h4", "", "Catatan evaluasi"),
  );

  if (item.result.limitations.length === 0) {
    section.append(el("p", "limitations-empty", "Tidak ada catatan."));
  } else {
    const list = el("ul", "limitations");
    for (const limitation of item.result.limitations) {
      list.append(el("li", "", humanizeLimitation(limitation)));
    }
    const details = el("details", "machine-note");
    details.append(
      el("summary", "", "String mesin"),
      el("pre", "", item.result.limitations.join("\n")),
    );
    section.append(list, details);
  }

  return section;
}

function renderReport(item) {
  const inner = el("div", "report-inner");
  const body = el("div", "report-body");
  body.append(renderEvidence(item), renderSensors(item));
  inner.append(renderVerdict(item), body);
  ui.report.replaceChildren(inner);
}

function renderRules(item) {
  ui.ruleList.replaceChildren();
  const evaluations = new Map(
    item.result.rule_evaluations.map((rule) => [rule.trouble_type, rule]),
  );

  for (const rule of state.data.rules) {
    const evaluation = evaluations.get(rule.id);
    const isDiagnosis = item.result.trouble_type === rule.id;
    const isMatch = evaluation?.evaluation === "MATCH";
    const isReady = evaluation?.capability_status === "READY";

    let stateName = "none";
    let label = "Tidak";
    if (isDiagnosis) {
      stateName = "used";
      label = "Dipakai";
    } else if (isMatch) {
      stateName = "match";
      label = "Cocok";
    } else if (!isReady) {
      stateName = "insufficient";
      label = "Data kurang";
    }

    const row = el("li", "rule-row");
    const name = el("div", "rule-name");
    name.append(el("h3", "", rule.name), el("p", "", rule.logic));

    const thresholds = el("ul", "rule-thresholds");
    for (const threshold of rule.thresholds) {
      thresholds.append(el("li", "", threshold));
    }

    const result = el("span", "rule-result", label);
    result.dataset.state = stateName;

    row.append(
      el("span", "rule-order", String(rule.order)),
      name,
      thresholds,
      result,
    );
    ui.ruleList.append(row);
  }
}

function transformToClassifyPayload(raw) {
  const data = raw.data || raw;
  const ts = data.received_at
    ? data.received_at.replace(" ", "T") + "+07:00"
    : new Date().toISOString();

  const parseNum = (val) => (val === null || val === undefined ? null : parseFloat(val));

  // Suffix _lps ditambahkan otomatis untuk kompatibilitas dengan server
  const flowheadVal = data.flowhead;
  const profile_id = flowheadVal !== undefined && flowheadVal !== null 
    ? `${flowheadVal}_lps` 
    : null;

  return {
    flowhead: profile_id,
    pump_id: raw.pump_id || data.pump_id,
    setpoint_freq: parseNum(data.set_point),
    readings: [
      {
        timestamp: ts,
        motor_speed: parseNum(data.motor_speed),
        output_frequency: parseNum(data.output_frequency),
        motor_current: parseNum(data.motor_current),
        motor_torque: parseNum(data.motor_torque),
        output_power: parseNum(data.output_power),
        hours_run: parseNum(data.hours_run),
        output_voltage: parseNum(data.output_voltage),
        ambient_temperature: parseNum(data.ambient_temperature),
        control_board_temperature: parseNum(data.control_board_temperature),
        inverter_temperature: parseNum(data.inverter_temperature),
        input_voltage: parseNum(data.input_voltage),
        arus_rms_u: parseNum(data.arus_rms_u),
        arus_rms_v: parseNum(data.arus_rms_v),
        arus_rms_w: parseNum(data.arus_rms_w),
      },
    ],
  };
}

function renderCurl(item) {
  const payload = JSON.stringify(transformToClassifyPayload(item.input), null, 2);
  state.curl = `socket.emit("classify", ${payload}, (response) => {
  if (response.ok) console.log(response.data);
  else console.error(response.error);
});`;
  ui.curlCode.textContent = state.curl;
  ui.codeCase.textContent = item.label;
}

function updateMeta(item) {
  ui.metaProfile.textContent = state.data.profile_label;
  ui.metaTime.textContent = formatDate(item.result.timestamp);
  ui.metaEval.textContent =
    item.result.evaluation_status === "FULL" ? "Penuh" : "Terbatas";
}

function selectCase(id, options = {}) {
  const item = state.data?.cases.find((entry) => entry.id === id);
  if (!item) return;

  state.currentId = id;
  for (const button of ui.caseIndex.querySelectorAll(".case-button")) {
    button.setAttribute("aria-pressed", String(button.dataset.caseId === id));
  }

  renderReport(item);
  renderRules(item);
  renderCurl(item);
  updateMeta(item);

  if (options.animate !== false) {
    ui.report.classList.remove("is-entering");
    void ui.report.offsetWidth;
    ui.report.classList.add("is-entering");
  }

  if (options.announce !== false) {
    ui.announcer.textContent = `${item.label} ditampilkan.`;
  }

  ui.copyCurl.disabled = false;
  ui.copyCode.disabled = false;
}

function showDataError(message) {
  ui.report.replaceChildren(el("p", "report-error", message));
  ui.copyCurl.disabled = true;
  ui.copyCode.disabled = true;
  ui.curlCode.textContent = "Data contoh tidak tersedia.";
  ui.codeCase.textContent = "—";
}

async function loadData() {
  try {
    const response = await fetch(DATA_URL, {
      cache: "no-store",
      headers: { accept: "application/json" },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data = await response.json();
    if (!Array.isArray(data.cases) || data.cases.length !== 9) {
      throw new Error("invalid cases");
    }
    if (!Array.isArray(data.rules) || data.rules.length !== 8) {
      throw new Error("invalid rules");
    }

    state.data = data;
    renderIndex();
    selectCase(data.default_case, { animate: false, announce: false });
  } catch {
    showDataError(
      "Data contoh tidak dapat dimuat. Muat ulang halaman; kontrak API tetap tersedia di bawah.",
    );
  }
}

async function copyText(text, feedbackNode, success, failure) {
  try {
    await navigator.clipboard.writeText(text);
    setCopyFeedback(feedbackNode, success, "ok");
    return true;
  } catch {
    const range = document.createRange();
    range.selectNodeContents(ui.curlCode);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    setCopyFeedback(feedbackNode, failure, "error");
    return false;
  }
}

function flashButton(button, label) {
  const original = button.textContent;
  button.textContent = label;
  window.setTimeout(() => {
    button.textContent = original;
  }, 1600);
}

function setStatus(stateName, label) {
  ui.statusDot.dataset.state = stateName;
  if (ui.statusText.textContent !== label) {
    ui.statusText.textContent = label;
  }
}

let socket;

function initSocket() {
  socket = io(API_HOST);

  socket.on("connect", () => {
    console.log("[landing] connected to API");
    refreshHealth();
  });

  socket.on("disconnect", () => {
    setStatus("offline", "Koneksi terputus");
    ui.footerHealth.textContent = "Status API tidak tersedia";
  });
}

async function refreshHealth() {
  if (!socket || !socket.connected) {
    setStatus("offline", "API tidak terjangkau");
    ui.footerHealth.textContent = "Status API tidak tersedia";
    return;
  }

  socket.emit("health", (response) => {
    if (!response || !response.ok) {
      setStatus("offline", "API tidak merespons");
      ui.footerHealth.textContent = "Status API tidak tersedia";
      return;
    }

    const health = response.data;
    const healthy =
      health.status === "ok" &&
      health.rules_loaded !== false &&
      health.setpoints_loaded !== false;

    if (health.status === "ok" && healthy) {
      setStatus("ok", "API operasional");
      ui.footerHealth.textContent = "Aturan siap";
    } else if (health.status === "ok") {
      setStatus("degraded", "API perlu diperiksa");
      ui.footerHealth.textContent = "Aturan bermasalah";
    } else {
      setStatus("degraded", "API degraded");
      ui.footerHealth.textContent = "Aturan bermasalah";
    }
    ui.footerChecked.textContent = `Diperiksa ${formatClock()}`;
  });
}

// Initialize
initSocket();
loadData();
refreshHealth();
window.setInterval(refreshHealth, REFRESH_MS);
