/*
 * DEXMIN — UI PoC Failure Management / Parameter Management.
 *
 * Reads:
 *   config:contract:get
 *   config:pump:get
 *   config:flowhead:get
 *   config:vfd:get
 *   config:failure:get (optional)
 *
 * Writes:
 *   config:flowhead:update
 *   config:vfd:update
 *
 * Create/Delete and new Failure logic:
 *   Browser memory only (PoC).
 */

"use strict";

// ============================================================================
// CONFIGURATION
// ============================================================================

const API_HOST = "https://class-api.aldozeno.my.id";

const CONTRACT_SCHEMA = "dexminClassificationAPI";

const TIMEOUT_MS = 10_000;

const CANDIDATE_CAPACITIES = [500, 3000, 5000];

const CANDIDATE_VSD = [1, 2];

const CATALOG = [
  ["pompa_tersangkut_sampah", "Pompa Tersangkut Sampah"],
  ["turbulensi", "Turbulensi"],
  ["banyak_sampah", "Banyak Sampah"],
  ["unbalance", "Unbalance Arus"],
  ["undervoltage", "Undervoltage"],
  ["overvoltage", "Overvoltage"],
  ["dry_run", "Dry Run"],
  ["panel_overheat", "Panel Overheat"],
  ["normal", "Normal"]
];

// ============================================================================
// DOM UTILITIES
// ============================================================================

const $ = (id) => document.getElementById(id);

const el = (tag, value, cls = "") => {
  const node = document.createElement(tag);

  if (value != null) {
    node.textContent = String(value);
  }

  if (cls) {
    node.className = cls;
  }

  return node;
};

// ============================================================================
// APPLICATION STATE
// ============================================================================

const state = {
  socket: null,

  canRead: false,
  canWrite: false,

  epoch: 0,

  failures: [],
  configs: [],

  draftFailures: [],
  draftParams: [],

  capacities: CANDIDATE_CAPACITIES,
  vsdTypes: CANDIDATE_VSD,

  selectedFailure: "",
  selectedParameter: "",

  editRow: null,
  failureDraftEdit: null,

  failedLoads: []
};

// ============================================================================
// DATA IDENTIFICATION
// ============================================================================

const keyFor = (row) =>
  `${row.equipment}:${row.equipmentId}:${row.code}`;

const paramKey = (row) =>
  `${row.equipment}:${row.code}`;

const allRows = () => [
  ...state.configs,
  ...state.draftParams
];

const allFailures = () => [
  ...state.failures,
  ...state.draftFailures
];

const failureKey = (row) =>
  row.failure_id == null
    ? "shared"
    : `db:${row.failure_id}`;

const format = (n) =>
  Number.isFinite(Number(n))
    ? new Intl.NumberFormat("id-ID", {
        maximumFractionDigits: 2
      }).format(Number(n))
    : "—";

// ============================================================================
// CONNECTION STATUS
// ============================================================================

function status(message, kind = "degraded") {
  $("status-text").textContent = message;
  $("status-dot").dataset.state = kind;

  document.body.classList.remove(
    "status-ok",
    "status-degraded",
    "status-offline",
    "status-loading"
  );

  document.body.classList.add(`status-${kind}`);

  $("footer-checked").textContent =
    new Date().toLocaleTimeString("id-ID", {
      timeZone: "Asia/Jakarta",
      hour: "2-digit",
      minute: "2-digit"
    }) + " WIB";
}

// ============================================================================
// NOTIFICATION
// ============================================================================

function notice(message, type = "info") {
  let area = document.querySelector(".toast-container");

  if (!area) {
    area = el("div", null, "toast-container");
    document.body.append(area);
  }

  const item = $("toast-template")
    .content
    .firstElementChild
    .cloneNode(true);

  item.classList.add(type);

  item.querySelector(".toast-message").textContent = message;

  item.querySelector(".toast-close").addEventListener(
    "click",
    () => item.remove()
  );

  area.append(item);

  setTimeout(() => item.remove(), 5500);
}

// ============================================================================
// TABLE UTILITIES
// ============================================================================

function empty(tbody, text, cols) {
  tbody.replaceChildren();

  const tr = el("tr", null, "empty-state");
  const cell = el("td", text);

  cell.colSpan = cols;

  tr.append(cell);
  tbody.append(tr);
}

function td(row, text) {
  const cell = el("td", text);
  row.append(cell);

  return cell;
}

function button(text, action, ref, disabled = false) {
  const b = el("button", text, "action-button");

  b.type = "button";

  b.dataset.action = action;
  b.dataset.ref = ref;

  b.disabled = disabled;

  return b;
}

function choose(select, items, placeholder, desired) {
  select.replaceChildren();

  const none = el("option", placeholder);
  none.value = "";

  select.append(none);

  for (const [value, label] of items) {
    const opt = el("option", label);

    opt.value = String(value);

    select.append(opt);
  }

  if (
    desired != null &&
    [...select.options].some(
      (o) => o.value === String(desired)
    )
  ) {
    select.value = String(desired);
  }
}

// ============================================================================
// NUMERIC VALIDATION
// ============================================================================

function parseDecimal(raw) {
  const text = String(raw).trim();

  if (!/^-?\d+(?:\.\d{1,2})?$/.test(text)) {
    throw new Error(
      "Gunakan angka dengan titik desimal, maksimal dua digit (contoh 66.70)."
    );
  }

  const [whole, fraction = ""] = text
    .replace(/^-/, "")
    .split(".");

  const cents =
    BigInt(whole) * 100n +
    BigInt(fraction.padEnd(2, "0"));

  if (cents > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("Nilai terlalu besar.");
  }

  return Number(text);
}

// ============================================================================
// SOCKET.IO API
// ============================================================================

function emit(event, payload, timeout = TIMEOUT_MS) {
  if (!state.socket?.connected) {
    return Promise.reject(
      new Error("API tidak terhubung")
    );
  }

  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timeout ${event}`)),
      timeout
    );

    state.socket.emit(event, payload, (response) => {
      clearTimeout(timer);

      if (response?.ok === true) {
        resolve(response.data);
      } else {
        reject(
          new Error(
            response?.error?.message ||
            `${event} ditolak`
          )
        );
      }
    });
  });
}

// ============================================================================
// API RESPONSE VALIDATION
// ============================================================================

function assertRows(data, kind, id) {
  if (!Array.isArray(data)) {
    throw new Error(`Respons ${kind} bukan array`);
  }

  const seen = new Set();

  return data.map((row) => {
    if (
      !row ||
      typeof row.code !== "string" ||
      !row.code.trim() ||
      typeof row.unit !== "string" ||
      !row.unit.trim() ||
      row.numeric_value == null ||
      String(row.numeric_value).trim() === "" ||
      !Number.isFinite(Number(row.numeric_value))
    ) {
      throw new Error(`Respons ${kind} tidak valid`);
    }

    const equipmentId = Number(id);

    const identityField =
      kind === "flowhead"
        ? "flowhead_capacity"
        : "vsd_type_id";

    if (
      row[identityField] != null &&
      Number(row[identityField]) !== equipmentId
    ) {
      throw new Error(
        `Identitas ${kind} pada respons berbeda`
      );
    }

    if (seen.has(row.code)) {
      throw new Error(`Duplikasi code ${row.code}`);
    }

    seen.add(row.code);

    return {
      ...row,

      name: row.name || row.code,

      equipment: kind,
      equipmentId,

      failureKey: failureKey(row),

      source: "db"
    };
  });
}

// ============================================================================
// FAILURE CATALOG
// ============================================================================

function fallbackCatalog() {
  return CATALOG.map(([code, name]) => ({
    key: `catalog:${code}`,
    code,
    name,
    id: null,
    source: "referensi"
  }));
}

// ============================================================================
// LOAD FAILURE DEFINITIONS
// ============================================================================

async function loadFailures() {
  // Optional extension.
  // Jika API tidak tersedia, jangan menebak ID MySQL.

  try {
    const data = await emit(
      "config:failure:get",
      {},
      3000
    );

    if (
      !Array.isArray(data) ||
      data.some(
        (x) =>
          !x ||
          !Number.isSafeInteger(Number(x.id)) ||
          Number(x.id) < 1 ||
          typeof x.failure !== "string" ||
          typeof x.name !== "string"
      )
    ) {
      throw new Error(
        "Format failure_definitions tidak cocok"
      );
    }

    const ids = new Set();
    const codes = new Set();

    for (const item of data) {
      if (
        ids.has(Number(item.id)) ||
        codes.has(item.failure)
      ) {
        throw new Error("Duplikasi Failure");
      }

      ids.add(Number(item.id));
      codes.add(item.failure);
    }

    state.failures = data.map((x) => ({
      key: `db:${x.id}`,

      id: Number(x.id),

      code: x.failure,
      name: x.name,

      source: "db"
    }));

  } catch (e) {
    state.failures = fallbackCatalog();

    state.failedLoads.push(
      `failure_definitions: ${e.message}`
    );
  }
}

// ============================================================================
// REFRESH CONFIGURATION FROM API
// ============================================================================
async function getFailures() {
    const response = await fetch(
        "./config.php?resource=failures"
    );

    if (!response.ok) {
        throw new Error("Gagal mengambil Failure");
    }

    return await response.json();
}

async function refreshFromAPI() {
  const epoch = ++state.epoch;

  state.canRead = false;
  state.canWrite = false;

  state.configs = [];
  state.failedLoads = [];

  render();

  if (!state.socket?.connected) {
    state.failures = fallbackCatalog();

    status(
      "Mode PoC — API tidak terhubung",
      "offline"
    );

    render();
    return;
  }

  status(
    "Membaca Configuration API…",
    "loading"
  );

  try {
    const contract = await emit(
      "config:contract:get",
      {}
    );

    if (epoch !== state.epoch) {
      return;
    }

    if (
      contract?.schema !== CONTRACT_SCHEMA ||
      contract?.read !== true
    ) {
      throw new Error(
        "Kontrak dexminClassificationAPI belum tervalidasi"
      );
    }

    state.canRead = true;
    state.canWrite = contract.write === true;

    let pumps = [];

    try {
      pumps = await emit(
        "config:pump:get",
        {}
      );

      if (!Array.isArray(pumps)) {
        throw new Error(
          "Daftar pompa tidak valid"
        );
      }

    } catch (err) {
      state.failedLoads.push(
        `pumps: ${err.message}`
      );
    }

    if (epoch !== state.epoch) {
      return;
    }

    const numericIds = (field) =>
      pumps
        .map((p) => Number(p?.[field]))
        .filter(
          (n) =>
            Number.isSafeInteger(n) &&
            n > 0
        );

    state.capacities = [
      ...new Set([
        ...CANDIDATE_CAPACITIES,
        ...numericIds("flowhead_capacity")
      ])
    ];

    state.vsdTypes = [
      ...new Set([
        ...CANDIDATE_VSD,
        ...numericIds("vsd_type_id")
      ])
    ];

    await loadFailures();

    if (epoch !== state.epoch) {
      return;
    }

    const requests = [
      ...state.capacities.map((id) => ({
        event: "config:flowhead:get",

        payload: {
          capacity: id
        },

        kind: "flowhead",
        id
      })),

      ...state.vsdTypes.map((id) => ({
        event: "config:vfd:get",

        payload: {
          vsdTypeId: id
        },

        kind: "vsd",
        id
      }))
    ];

    const results = await Promise.allSettled(
      requests.map((r) =>
        emit(r.event, r.payload)
      )
    );

    if (epoch !== state.epoch) {
      return;
    }

    state.configs = [];

    results.forEach((result, i) => {
      const r = requests[i];

      if (result.status === "fulfilled") {
        try {
          state.configs.push(
            ...assertRows(
              result.value,
              r.kind,
              r.id
            )
          );

        } catch (err) {
          state.failedLoads.push(
            `${r.kind} ${r.id}: ${err.message}`
          );
        }

      } else {
        state.failedLoads.push(
          `${r.kind} ${r.id}: ${result.reason.message}`
        );
      }
    });

    if (state.failedLoads.length) {
      // Partial data must not be treated as complete.
      state.canWrite = false;

      status(
        "Data sebagian / kontrak belum lengkap",
        "degraded"
      );

    } else {
      status(
        "Konfigurasi API terbaca",
        "ok"
      );
    }

    $("contract-notice").textContent =
      state.failedLoads.length
        ? `Mode terbatas. ${state.failedLoads.join("; ")}. CRUD Create/Delete hanya PoC lokal.`
        : "Data dibaca dari API. Update nilai DB diperbolehkan bila backend mengizinkan; Create/Delete hanya draft PoC lokal.";

    $("footer-health").textContent =
      state.canWrite
        ? "Update terotorisasi (klaim API)"
        : "Read-only / PoC";

  } catch (err) {
    if (epoch !== state.epoch) {
      return;
    }

    state.failures = fallbackCatalog();

    state.canRead = false;
    state.canWrite = false;

    status(
      "Mode PoC — integrasi API belum siap",
      "degraded"
    );

    $("contract-notice").textContent =
      `${err.message}. Hanya draft lokal dapat dibuat; tidak ada penulisan database.`;
  }

  render();
}

// ============================================================================
// FAILURE RELATIONSHIPS
// ============================================================================

function failureByKey(key) {
  if (key === "shared") {
    return {
      name: "Shared",
      code: "shared",
      source: "shared"
    };
  }

  return (
    allFailures().find(
      (f) => f.key === key
    ) || {
      name: key.startsWith("db:")
        ? `Failure ID ${key.slice(3)} (nama belum terbaca)`
        : key,

      code: key,
      source: "unknown"
    }
  );
}

function relatedRows(f) {
  return allRows().filter(
    (r) => r.failureKey === f.key
  );
}

// ============================================================================
// FAILURE MANAGEMENT — TABLE
// ============================================================================

function renderFailures() {
  const tbody = $("failure-table").tBodies[0];

  tbody.replaceChildren();

  const filter = $("failure-search")
    .value
    .trim()
    .toLowerCase();

  const known = allFailures();

  const seen = new Set(
    known.map((f) => f.key)
  );

  const unresolved = allRows()
    .filter(
      (r) =>
        r.failureKey.startsWith("db:") &&
        !seen.has(r.failureKey)
    )
    .map((r) => r.failureKey)
    .filter(
      (key, i, a) =>
        a.indexOf(key) === i
    )
    .map((key) => ({
      key,
      code: key,
      name: `Failure ID ${key.slice(3)} (belum terpetakan)`,
      source: "unknown"
    }));

  const failures = [
    ...known,
    ...unresolved
  ].filter(
    (f) =>
      `${f.name} ${f.code}`
        .toLowerCase()
        .includes(filter)
  );

  if (!failures.length) {
    empty(
      tbody,
      "Tidak ada Failure yang cocok.",
      6
    );
  }

  for (const f of failures) {
    const rows = relatedRows(f);

    const tr = el("tr");

    td(tr, f.name);

    const code = td(tr, "");
    code.append(
      el("code", f.code)
    );

    td(
      tr,
      state.canRead
        ? new Set(
            rows.map((r) => r.code)
          ).size
        : "—"
    );

    td(
      tr,
      [
        ...new Set(
          rows.map(
            (r) =>
              r.equipment === "vsd"
                ? "VSD"
                : "Flowhead"
          )
        )
      ].join(", ") || "—"
    );

    td(
      tr,
      f.source === "draft"
        ? "Draft PoC"
        : f.source === "db"
          ? "Database"
          : "Referensi / belum terverifikasi"
    );

    const action = td(tr, "");

    action.append(
      button(
        "Detail",
        "failure-detail",
        f.key
      )
    );

    if (f.source === "draft") {
      action.append(
        button(
          "Edit",
          "failure-edit",
          f.key
        )
      );

      action.append(
        button(
          "Hapus",
          "failure-delete",
          f.key
        )
      );
    }

    tbody.append(tr);
  }

  const active =
    allFailures().some(
      (f) => f.key === state.selectedFailure
    ) ||
    unresolved.some(
      (f) => f.key === state.selectedFailure
    );

  $("failure-detail").hidden = !active;

  if (active) {
    renderFailureDetail();
  }
}

// ============================================================================
// EQUIPMENT LABEL
// ============================================================================

function equipmentLabel(row) {
  return row.equipment === "flowhead"
    ? `Flowhead ${row.equipmentId} L/s`
    : `VSD Type ${row.equipmentId}`;
}

// ============================================================================
// CONFIGURATION VALUES TABLE
// ============================================================================

function renderValueTable(
  tbody,
  rows,
  byFailure = false
) {
  tbody.replaceChildren();

  if (!rows.length) {
    return empty(
      tbody,
      "Tidak ada konfigurasi yang terpetakan.",
      6
    );
  }

  for (const row of rows) {
    const tr = el("tr");

    if (byFailure) {
      td(tr, row.name);
      td(tr, row.code);
      td(tr, equipmentLabel(row));
      td(tr, format(row.numeric_value));
      td(tr, row.unit);

    } else {
      td(tr, equipmentLabel(row));

      td(
        tr,
        failureByKey(row.failureKey).name
      );

      td(tr, format(row.numeric_value));
      td(tr, row.unit);

      td(
        tr,
        row.source === "draft"
          ? "Draft PoC"
          : "Database"
      );
    }

    const actions = td(tr, "");

    actions.append(
      button(
        "Edit",
        "value-edit",
        keyFor(row),
        row.source === "db" &&
        !state.canWrite
      )
    );

    actions.append(
      button(
        "Hapus",
        "value-delete",
        keyFor(row),
        row.source !== "draft"
      )
    );

    if (row.source !== "draft") {
      actions.lastElementChild.title =
        "Delete DB belum terhubung dengan kontrak backend";
    }

    tbody.append(tr);
  }
}

// ============================================================================
// FAILURE MANAGEMENT — EQUIPMENT FILTER
// ============================================================================

function renderEquipmentChoices() {
  const kind = $("failure-equipment").value;

  const candidates =
    kind === "flowhead"
      ? state.capacities
      : kind === "vsd"
        ? state.vsdTypes
        : [];

  const old = $("failure-equipment-id").value;

  const entries = [
    ["all", "Semua"],

    ...candidates.map((n) => [
      String(n),

      kind === "vsd"
        ? `Type ${n}`
        : `${n} L/s`
    ])
  ];

  choose(
    $("failure-equipment-id"),
    entries,
    "Semua",
    old || "all"
  );

  if (!$("failure-equipment-id").value) {
    $("failure-equipment-id").value = "all";
  }
}

// ============================================================================
// FAILURE MANAGEMENT — DETAIL
// ============================================================================

function renderFailureDetail() {
  const f = failureByKey(
    state.selectedFailure
  );

  $("failure-detail-title").textContent =
    `Detail — ${f.name}`;

  const kind = $("failure-equipment").value;
  const id = $("failure-equipment-id").value;

  const rows = relatedRows(f).filter(
    (r) =>
      (
        kind === "all" ||
        r.equipment === kind
      ) &&
      (
        id === "all" ||
        String(r.equipmentId) === id
      )
  );

  renderValueTable(
    $("failure-parameter-table").tBodies[0],
    rows,
    true
  );

  $("failure-detail-note").textContent =
    f.source === "db"
      ? "Failure terdaftar di database. Parameter disaring menggunakan failure_id asli."
      : f.source === "draft"
        ? "Failure PoC lokal, bukan klasifikasi aktif."
        : "ID Failure belum diverifikasi dari API. Jangan menyamakan urutan seed dengan ID database.";

  $("failure-logic").textContent =
    f.source === "draft"
      ? `DRAFT (tidak dieksekusi): ${f.logic.telemetry} ${f.logic.operator} ${f.logic.reference}`
      : "Evaluator untuk Failure bawaan berada di TypeScript. UI ini tidak mengubah rumus atau mengaktifkan Failure.";
}

// ============================================================================
// PARAMETER MANAGEMENT — TABLE
// ============================================================================

function renderParameters() {
  const tbody = $("parameter-table").tBodies[0];

  tbody.replaceChildren();

  const group = new Map();

  for (const row of allRows()) {
    const k = paramKey(row);

    if (!group.has(k)) {
      group.set(k, []);
    }

    group.get(k).push(row);
  }

  const search = $("parameter-search")
    .value
    .toLowerCase()
    .trim();

  const keys = [
    ...group.keys()
  ].filter((k) => {
    const first = group.get(k)[0];

    return `${first.name} ${first.code}`
      .toLowerCase()
      .includes(search);
  }).sort();

  if (!keys.length) {
    empty(
      tbody,
      "Belum ada parameter yang tersedia.",
      6
    );
  }

  for (const k of keys) {
    const rows = group.get(k);
    const r = rows[0];

    const tr = el("tr");

    td(tr, r.name);
    td(tr, r.code);

    td(
      tr,
      r.equipment === "vsd"
        ? "VSD"
        : "Flowhead"
    );

    td(
      tr,
      [
        ...new Set(
          rows.map(
            (x) =>
              failureByKey(x.failureKey).name
          )
        )
      ].join(", ")
    );

    td(
      tr,
      String(rows.length)
    );

    td(tr, "").append(
      button(
        "Detail",
        "parameter-detail",
        k
      )
    );

    tbody.append(tr);
  }

  $("parameter-detail").hidden =
    !group.has(state.selectedParameter);

  if (group.has(state.selectedParameter)) {
    const rows = group.get(
      state.selectedParameter
    );

    $("parameter-detail-title").textContent =
      `Detail — ${rows[0].name}`;

    renderValueTable(
      $("parameter-value-table").tBodies[0],
      rows
    );
  }
}

// ============================================================================
// RENDER APPLICATION
// ============================================================================

function render() {
  renderFailures();
  renderParameters();
}

// ============================================================================
// NAVIGATION
// ============================================================================

function showTab(tab) {
  for (const name of [
    "failure",
    "parameter"
  ]) {
    const isActive = tab === name;

    $(`tab-${name}`).classList.toggle(
      "active",
      isActive
    );

    $(`tab-${name}`).setAttribute(
      "aria-selected",
      String(isActive)
    );

    $(`panel-${name}`).hidden =
      !isActive;
  }
}

// ============================================================================
// CREATE / EDIT FAILURE — PoC
// ============================================================================

function openFailureDialog(f = null) {
  state.failureDraftEdit =
    f?.key || null;

  const form = $("failure-form");

  form.reset();

  $("failure-dialog-title").textContent =
    f
      ? "Edit Failure — PoC"
      : "Failure Baru — PoC";

  if (f) {
    for (const key of [
      "name",
      "code",
      "equipment"
    ]) {
      form.elements[key].value = f[key];
    }

    for (const field of [
      "telemetry",
      "operator",
      "reference"
    ]) {
      form.elements[field].value =
        f.logic[field];
    }
  }

  $("failure-dialog").showModal();
}

// ============================================================================
// PARAMETER EQUIPMENT SELECTION
// ============================================================================

function fillParameterEquipment() {
  const kind = $("p-equipment").value;

  const values =
    kind === "flowhead"
      ? state.capacities
      : state.vsdTypes;

  choose(
    $("p-equipment-id"),

    values.map((v) => [
      v,

      kind === "flowhead"
        ? `${v} L/s`
        : `Type ${v}`
    ]),

    "Pilih equipment"
  );
}

// ============================================================================
// CREATE PARAMETER — PoC
// ============================================================================

function openParameterDialog() {
  const form = $("parameter-form");

  form.reset();

  if (state.selectedFailure) {
    const failure = allFailures().find(
      (f) =>
        f.key === state.selectedFailure
    );

    if (failure?.equipment === "vsd") {
      $("p-equipment").value = "vsd";
    }
  }

  fillParameterEquipment();

  choose(
    $("p-failure"),

    [
      ["shared", "Shared"],

      ...allFailures().map((f) => [
        f.key,
        f.name
      ])
    ],

    "Pilih Failure",

    state.selectedFailure || ""
  );

  $("parameter-dialog").showModal();
}

// ============================================================================
// EDIT CONFIGURATION VALUE
// ============================================================================

function findRowByKey(key) {
  return allRows().find(
    (r) =>
      keyFor(r) === key
  );
}

function openEdit(row) {
  state.editRow = {
    key: keyFor(row),
    epoch: state.epoch
  };

  $("edit-context").textContent =
    `${row.name} · ` +
    `${equipmentLabel(row)} · ` +
    `${row.unit} ` +
    `(${row.source === "draft" ? "PoC" : "DB"})`;

  // No locale formatting.
  $("edit-value").value =
    String(row.numeric_value);

  $("edit-dialog").showModal();
}

// ============================================================================
// UPDATE CONFIGURATION
// ============================================================================

async function saveEdit(ev) {
  ev.preventDefault();

  const context = state.editRow;

  if (!context) {
    return;
  }

  const row = findRowByKey(
    context.key
  );

  if (!row) {
    return notice(
      "Baris konfigurasi tidak ditemukan",
      "error"
    );
  }

  let value;

  try {
    value = parseDecimal(
      $("edit-value").value
    );

  } catch (e) {
    return notice(
      e.message,
      "error"
    );
  }

  // ==========================================================
  // UPDATE LOCAL DRAFT
  // ==========================================================

  if (row.source === "draft") {
    row.numeric_value =
      String(value);

    $("edit-dialog").close();

    render();

    return notice(
      "Draft lokal diperbarui (belum tersimpan pada DB)",
      "success"
    );
  }

  // ==========================================================
  // DATABASE UPDATE VALIDATION
  // ==========================================================

  if (
    !state.canWrite ||
    !state.socket?.connected ||
    context.epoch !== state.epoch
  ) {
    return notice(
      "Update DB ditolak: koneksi/hak akses belum valid",
      "error"
    );
  }

  if (
    Number(row.numeric_value) === value
  ) {
    $("edit-dialog").close();

    return notice(
      "Nilai tidak berubah"
    );
  }

  if (
    !window.confirm(
      `Update ${row.code} pada ` +
      `${equipmentLabel(row)} ` +
      `menjadi ${value} ${row.unit}?`
    )
  ) {
    return;
  }

  const submit = $("edit-submit");

  submit.disabled = true;

  let acknowledged = false;

  try {
    const isFlow =
      row.equipment === "flowhead";

    const payload = isFlow
      ? {
          capacity: row.equipmentId,
          code: row.code,
          numeric_value: value
        }
      : {
          vsdTypeId: row.equipmentId,
          code: row.code,
          numeric_value: value
        };

    await emit(
      isFlow
        ? "config:flowhead:update"
        : "config:vfd:update",

      payload
    );

    acknowledged = true;

    if (
      context.epoch !== state.epoch
    ) {
      return;
    }

    // ========================================================
    // READ BACK VERIFICATION
    // ========================================================

    const fresh = assertRows(
      await emit(
        isFlow
          ? "config:flowhead:get"
          : "config:vfd:get",

        isFlow
          ? {
              capacity: row.equipmentId
            }
          : {
              vsdTypeId: row.equipmentId
            }
      ),

      row.equipment,
      row.equipmentId
    );

    if (
      context.epoch !== state.epoch
    ) {
      return;
    }

    const verified = fresh.find(
      (r) =>
        r.code === row.code
    );

    if (
      !verified ||
      Number(verified.numeric_value) !== value
    ) {
      throw new Error(
        "Read-back tidak sama dengan nilai yang dikirim"
      );
    }

    state.configs = state.configs
      .filter(
        (r) =>
          !(
            r.equipment === row.equipment &&
            r.equipmentId === row.equipmentId
          )
      )
      .concat(fresh);

    $("edit-dialog").close();

    render();

    notice(
      "Nilai database tersimpan dan diverifikasi",
      "success"
    );

  } catch (e) {
    notice(
      (
        acknowledged
          ? "Update diterima tetapi belum terverifikasi: "
          : "Update gagal: "
      ) + e.message,

      "error"
    );

  } finally {
    submit.disabled = false;
  }
}

// ============================================================================
// SAVE FAILURE DRAFT — PoC
// ============================================================================

function saveDraftFailure(ev) {
  ev.preventDefault();

  const form = ev.currentTarget;

  const name =
    form.elements.name.value.trim();

  const code =
    form.elements.code.value.trim();

  const previous = state.draftFailures.find(
    (f) =>
      f.key === state.failureDraftEdit
  );

  if (
    allFailures().some(
      (f) =>
        f.code === code &&
        f !== previous
    )
  ) {
    return notice(
      "Failure code sudah digunakan",
      "error"
    );
  }

  const record = {
    key: `poc:${code}`,

    name,
    code,

    equipment:
      form.elements.equipment.value,

    source: "draft",

    logic: {
      telemetry:
        form.elements.telemetry.value.trim(),

      operator:
        form.elements.operator.value,

      reference:
        form.elements.reference.value.trim()
    }
  };

  if (previous) {
    const oldKey =
      previous.key;

    Object.assign(
      previous,
      record
    );

    for (const row of state.draftParams) {
      if (
        row.failureKey === oldKey
      ) {
        row.failureKey =
          record.key;
      }
    }

    if (
      state.selectedFailure === oldKey
    ) {
      state.selectedFailure =
        record.key;
    }

  } else {
    state.draftFailures.push(record);
  }

  $("failure-dialog").close();

  render();

  notice(
    "Draft Failure tersimpan hanya selama halaman ini terbuka",
    "success"
  );
}

// ============================================================================
// SAVE PARAMETER DRAFT — PoC
// ============================================================================

function saveDraftParameter(ev) {
  ev.preventDefault();

  const f = ev.currentTarget;

  const equipment =
    f.elements.equipment.value;

  const equipmentId = Number(
    f.elements.equipment_id.value
  );

  const code =
    f.elements.code.value.trim();

  let numeric_value;

  try {
    numeric_value = parseDecimal(
      f.elements.value.value
    );

  } catch (e) {
    return notice(
      e.message,
      "error"
    );
  }

  if (
    !Number.isSafeInteger(equipmentId) ||
    equipmentId < 1 ||
    !f.elements.failure.value
  ) {
    return notice(
      "Equipment dan Failure wajib dipilih",
      "error"
    );
  }

  const draft = {
    equipment,
    equipmentId,

    code,

    name:
      f.elements.name.value.trim(),

    numeric_value:
      String(numeric_value),

    unit:
      f.elements.unit.value.trim(),

    failureKey:
      f.elements.failure.value,

    source: "draft"
  };

  if (
    allRows().some(
      (row) =>
        keyFor(row) === keyFor(draft)
    )
  ) {
    return notice(
      "Parameter sudah ada pada equipment tersebut (Primary Key bentrok)",
      "error"
    );
  }

  state.draftParams.push(draft);

  $("parameter-dialog").close();

  render();

  notice(
    "Draft parameter hanya tersimpan dalam memori browser",
    "success"
  );
}

// ============================================================================
// TABLE ACTION HANDLER
// ============================================================================

function onTableAction(ev) {
  const b = ev.target.closest(
    "button[data-action]"
  );

  if (
    !b ||
    b.disabled
  ) {
    return;
  }

  const {
    action,
    ref
  } = b.dataset;

  // ==========================================================
  // FAILURE DETAIL
  // ==========================================================

  if (
    action === "failure-detail"
  ) {
    state.selectedFailure = ref;

    $("failure-equipment").value =
      "all";

    renderEquipmentChoices();
    renderFailures();

    $("failure-detail").scrollIntoView({
      behavior: "smooth",
      block: "nearest"
    });

  // ==========================================================
  // FAILURE EDIT
  // ==========================================================

  } else if (
    action === "failure-edit"
  ) {
    const f = state.draftFailures.find(
      (x) =>
        x.key === ref
    );

    if (f) {
      openFailureDialog(f);
    }

  // ==========================================================
  // FAILURE DELETE
  // ==========================================================

  } else if (
    action === "failure-delete"
  ) {
    const f = state.draftFailures.find(
      (x) =>
        x.key === ref
    );

    if (!f) {
      return;
    }

    if (
      !window.confirm(
        `Hapus draft Failure ${f.name} beserta parameter draft terkait?`
      )
    ) {
      return;
    }

    state.draftFailures =
      state.draftFailures.filter(
        (x) =>
          x !== f
      );

    state.draftParams =
      state.draftParams.filter(
        (x) =>
          x.failureKey !== ref
      );

    if (
      state.selectedFailure === ref
    ) {
      state.selectedFailure = "";
    }

    render();

  // ==========================================================
  // PARAMETER DETAIL
  // ==========================================================

  } else if (
    action === "parameter-detail"
  ) {
    state.selectedParameter = ref;

    renderParameters();

    $("parameter-detail").scrollIntoView({
      behavior: "smooth",
      block: "nearest"
    });

  // ==========================================================
  // VALUE EDIT
  // ==========================================================

  } else if (
    action === "value-edit"
  ) {
    const row = findRowByKey(ref);

    if (row) {
      openEdit(row);
    }

  // ==========================================================
  // VALUE DELETE
  // ==========================================================

  } else if (
    action === "value-delete"
  ) {
    const row = findRowByKey(ref);

    if (
      !row ||
      row.source !== "draft"
    ) {
      return;
    }

    if (
      !window.confirm(
        `Hapus draft ${row.code} pada ${equipmentLabel(row)}?`
      )
    ) {
      return;
    }

    state.draftParams =
      state.draftParams.filter(
        (r) =>
          r !== row
      );

    render();
  }
}

// ============================================================================
// INITIALIZATION
// ============================================================================

function initialize() {
  // ==========================================================
  // NAVIGATION
  // ==========================================================

  $("tab-failure").addEventListener(
    "click",
    () => showTab("failure")
  );

  $("tab-parameter").addEventListener(
    "click",
    () => showTab("parameter")
  );

  // ==========================================================
  // SEARCH
  // ==========================================================

  $("failure-search").addEventListener(
    "input",
    renderFailures
  );

  $("parameter-search").addEventListener(
    "input",
    renderParameters
  );

  // ==========================================================
  // FAILURE EQUIPMENT FILTER
  // ==========================================================

  $("failure-equipment").addEventListener(
    "change",
    () => {
      renderEquipmentChoices();
      renderFailureDetail();
    }
  );

  $("failure-equipment-id").addEventListener(
    "change",
    renderFailureDetail
  );

  // ==========================================================
  // CREATE
  // ==========================================================

  $("add-failure").addEventListener(
    "click",
    () => openFailureDialog()
  );

  $("add-parameter").addEventListener(
    "click",
    openParameterDialog
  );

  $("add-failure-parameter").addEventListener(
    "click",
    openParameterDialog
  );

  // ==========================================================
  // REFRESH
  // ==========================================================

  $("refresh-config").addEventListener(
    "click",
    refreshFromAPI
  );

  // ==========================================================
  // PARAMETER EQUIPMENT
  // ==========================================================

  $("p-equipment").addEventListener(
    "change",
    fillParameterEquipment
  );

  // ==========================================================
  // FORM SUBMISSION
  // ==========================================================

  $("failure-form").addEventListener(
    "submit",
    saveDraftFailure
  );

  $("parameter-form").addEventListener(
    "submit",
    saveDraftParameter
  );

  $("edit-form").addEventListener(
    "submit",
    saveEdit
  );

  // ==========================================================
  // DATA TABLE EVENTS
  // ==========================================================

  for (const table of [
    "failure-table",
    "failure-parameter-table",
    "parameter-table",
    "parameter-value-table"
  ]) {
    $(table).addEventListener(
      "click",
      onTableAction
    );
  }

  // ==========================================================
  // DIALOG CLOSE
  // ==========================================================

  document
    .querySelectorAll("[data-close]")
    .forEach((b) => {
      b.addEventListener(
        "click",
        () => {
          $(b.dataset.close).close();
        }
      );
    });

  // ==========================================================
  // INITIAL STATE
  // ==========================================================

  state.failures =
    fallbackCatalog();

  renderEquipmentChoices();

  render();

  // ==========================================================
  // SOCKET.IO INITIALIZATION
  // ==========================================================

  if (
    typeof window.io !== "function"
  ) {
    status(
      "Mode PoC — Socket.IO tidak tersedia",
      "offline"
    );

    $("contract-notice").textContent =
      "Katalog Failure referensi dan draft PoC tersedia. Data MySQL belum terhubung.";

    return;
  }

  // ==========================================================
  // CONNECTION
  // ==========================================================

  state.socket =
    window.io(API_HOST);

  state.socket.on(
    "connect",
    refreshFromAPI
  );

  // ==========================================================
  // DISCONNECT
  // ==========================================================

  state.socket.on(
    "disconnect",
    () => {
      state.epoch++;

      state.canRead = false;
      state.canWrite = false;

      state.configs = [];

      state.failures =
        fallbackCatalog();

      status(
        "API terputus — hanya PoC lokal",
        "offline"
      );

      $("contract-notice").textContent =
        "Koneksi terputus. Edit database dinonaktifkan; draft PoC tetap lokal.";

      render();
    }
  );
}

// ============================================================================
// START APPLICATION
// ============================================================================

initialize();