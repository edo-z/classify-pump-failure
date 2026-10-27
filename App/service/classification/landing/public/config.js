const API_HOST = "https://class-api.aldozeno.my.id";
const REFRESH_MS = 30_000;
const TIMEOUT_MS = 10_000;

const nf = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 2 });

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
  tabs: {
    list: byId("config-tabs-list"),
    buttons: {
      pumps: byId("tab-pumps"),
      flowhead: byId("tab-flowhead"),
      vfd: byId("tab-vfd"),
      global: byId("tab-global"),
    },
    panels: {
      pumps: byId("panel-pumps"),
      flowhead: byId("panel-flowhead"),
      vfd: byId("panel-vfd"),
      global: byId("panel-global"),
    },
  },
  pumps: {
    select: byId("pump-select"),
    refresh: byId("refresh-pumps"),
    container: byId("pump-config"),
    count: byId("pump-config-count"),
    tableBody: byId("pump-config-table").querySelector("tbody"),
  },
  flowhead: {
    select: byId("flowhead-capacity"),
    refresh: byId("refresh-flowhead"),
    container: byId("flowhead-config"),
    count: byId("flowhead-config-count"),
    tableBody: byId("flowhead-config-table").querySelector("tbody"),
  },
  vfd: {
    select: byId("vfd-type"),
    refresh: byId("refresh-vfd"),
    container: byId("vfd-config"),
    count: byId("vfd-config-count"),
    tableBody: byId("vfd-config-table").querySelector("tbody"),
  },
  global: {
    container: byId("global-config"),
    count: byId("global-config-count"),
    tableBody: byId("global-config-table").querySelector("tbody"),
  },
  effective: {
    select: byId("effective-pump-select"),
    refresh: byId("refresh-effective"),
    container: byId("effective-config"),
    tableBody: byId("effective-config-table").querySelector("tbody"),
    missingDiv: byId("missing-params"),
    missingList: byId("missing-list"),
  },
};

const state = {
  socket: null,
  pumps: [],
  flowheadCapacities: [],
  vfdTypes: [],
  currentTab: "pumps",
  currentPumpId: null,
  currentFlowheadCapacity: null,
  currentVfdTypeId: null,
  currentEffectivePumpId: null,
};

function formatNumber(value) {
  return value === null || value === undefined ? "—" : nf.format(value);
}

function setStatus(stateName, label) {
  ui.statusDot.dataset.state = stateName;
  if (ui.statusText.textContent !== label) {
    ui.statusText.textContent = label;
  }
  document.body.className = `status-${stateName}`;
}

function showToast(message, type = "info") {
  const container = document.querySelector(".toast-container") || (() => {
    const c = document.createElement("div");
    c.className = "toast-container";
    document.body.appendChild(c);
    return c;
  })();

  const template = document.getElementById("toast-template");
  const toast = template.content.cloneNode(true).querySelector(".toast");
  toast.classList.add(type);
  toast.querySelector(".toast-message").textContent = message;
  toast.querySelector(".toast-close").addEventListener("click", () => toast.remove());
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 5000);
}

function switchTab(tabName) {
  state.currentTab = tabName;
  for (const [name, button] of Object.entries(ui.tabs.buttons)) {
    const isActive = name === tabName;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-selected", isActive);
    ui.tabs.panels[name].hidden = !isActive;
  }
}

async function socketEmit(event, payload) {
  if (!state.socket || !state.socket.connected) {
    throw new Error("Socket not connected");
  }
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Timeout")), TIMEOUT_MS);
    state.socket.emit(event, payload, (response) => {
      clearTimeout(timeout);
      if (response?.ok) resolve(response.data);
      else reject(new Error(response?.error?.message || "Unknown error"));
    });
  });
}

async function loadPumps() {
  try {
    const pumps = await socketEmit("config:pump:get", {});
    state.pumps = pumps;
    renderPumpSelect(ui.pumps.select, pumps);
    renderPumpSelect(ui.effective.select, pumps);
  } catch (err) {
    showToast(`Gagal memuat pompa: ${err.message}`, "error");
  }
}

function renderPumpSelect(select, pumps) {
  const currentValue = select.value;
  select.innerHTML = '<option value="">Pilih pompa…</option>';
  for (const pump of pumps) {
    const opt = el("option", "", `${pump.dex_pump_id} (${pump.flowhead_capacity ?? "?"} L/s, VFD ${pump.vsd_type_id ?? "?"})`);
    opt.value = pump.dex_pump_id;
    select.append(opt);
  }
  if (pumps.some(p => p.dex_pump_id === currentValue)) {
    select.value = currentValue;
  }
}

async function loadFlowheadCapacities() {
  try {
    const params = await socketEmit("config:flowhead:get", { capacity: 0 });
    const capacities = [...new Set(params.map(p => p.parameter_id))];
    state.flowheadCapacities = [500, 3000, 5000];
    renderCapacitySelect();
  } catch (err) {
    state.flowheadCapacities = [500, 3000, 5000];
    renderCapacitySelect();
  }
}

function renderCapacitySelect() {
  const select = ui.flowhead.select;
  const currentValue = select.value;
  select.innerHTML = '<option value="">Pilih kapasitas…</option>';
  for (const cap of state.flowheadCapacities) {
    const opt = el("option", "", `${cap} L/s`);
    opt.value = String(cap);
    select.append(opt);
  }
  if (state.flowheadCapacities.includes(Number(currentValue))) {
    select.value = currentValue;
  }
}

async function loadVfdTypes() {
  try {
    const pumps = await socketEmit("config:pump:get", {});
    const types = [...new Set(pumps.map(p => p.vsd_type_id).filter(Boolean))].sort((a, b) => a - b);
    state.vfdTypes = types;
    renderVfdTypeSelect();
  } catch (err) {
    state.vfdTypes = [1, 2, 3];
    renderVfdTypeSelect();
  }
}

function renderVfdTypeSelect() {
  const select = ui.vfd.select;
  const currentValue = select.value;
  select.innerHTML = '<option value="">Pilih tipe VFD…</option>';
  for (const type of state.vfdTypes) {
    const opt = el("option", "", `VFD Type ${type}`);
    opt.value = String(type);
    select.append(opt);
  }
  if (state.vfdTypes.includes(Number(currentValue))) {
    select.value = currentValue;
  }
}

async function loadPumpConfig() {
  if (!state.currentPumpId) return;
  ui.pumps.container.hidden = true;
  try {
    const config = await socketEmit("config:pump:get", { pumpId: Number(state.currentPumpId) });
    renderConfigTable(ui.pumps.tableBody, config, "pump", {
      showScope: true,
      editable: true,
      pumpId: state.currentPumpId,
      onUpdate: (paramId, value) => socketEmit("config:pump:update", { dexPumpId: state.currentPumpId, parameterId: paramId, value }),
      onDelete: (paramId) => socketEmit("config:pump:update", { dexPumpId: state.currentPumpId, parameterId: paramId, value: null }),
    });
    ui.pumps.count.textContent = config.length;
    ui.pumps.container.hidden = false;
  } catch (err) {
    showToast(`Gagal memuat konfigurasi pompa: ${err.message}`, "error");
  }
}

async function loadFlowheadConfig() {
  if (!state.currentFlowheadCapacity) return;
  ui.flowhead.container.hidden = true;
  try {
    const config = await socketEmit("config:flowhead:get", { capacity: Number(state.currentFlowheadCapacity) });
    renderConfigTable(ui.flowhead.tableBody, config, "flowhead", {
      showScope: false,
      editable: true,
      capacity: state.currentFlowheadCapacity,
      onUpdate: (paramId, value) => socketEmit("config:flowhead:update", { capacity: Number(state.currentFlowheadCapacity), parameterId: paramId, value }),
      onDelete: (paramId) => socketEmit("config:flowhead:update", { capacity: Number(state.currentFlowheadCapacity), parameterId: paramId, value: null }),
    });
    ui.flowhead.count.textContent = config.length;
    ui.flowhead.container.hidden = false;
  } catch (err) {
    showToast(`Gagal memuat konfigurasi flowhead: ${err.message}`, "error");
  }
}

async function loadVfdConfig() {
  if (!state.currentVfdTypeId) return;
  ui.vfd.container.hidden = true;
  try {
    const config = await socketEmit("config:vfd:get", { vsdTypeId: Number(state.currentVfdTypeId) });
    renderConfigTable(ui.vfd.tableBody, config, "vfd", {
      showScope: false,
      editable: true,
      vsdTypeId: state.currentVfdTypeId,
      onUpdate: (paramId, value) => socketEmit("config:vfd:update", { vsdTypeId: Number(state.currentVfdTypeId), parameterId: paramId, value }),
      onDelete: (paramId) => socketEmit("config:vfd:update", { vsdTypeId: Number(state.currentVfdTypeId), parameterId: paramId, value: null }),
    });
    ui.vfd.count.textContent = config.length;
    ui.vfd.container.hidden = false;
  } catch (err) {
    showToast(`Gagal memuat konfigurasi VFD: ${err.message}`, "error");
  }
}

async function loadGlobalConfig() {
  ui.global.container.hidden = true;
  try {
    const config = await socketEmit("config:global:get", {});
    renderConfigTable(ui.global.tableBody, config, "global", {
      showScope: false,
      editable: true,
      onUpdate: (paramId, value) => socketEmit("config:global:update", { parameterId: paramId, value }),
      onDelete: (paramId) => socketEmit("config:global:update", { parameterId: paramId, value: null }),
    });
    ui.global.count.textContent = config.length;
    ui.global.container.hidden = false;
  } catch (err) {
    showToast(`Gagal memuat konfigurasi global: ${err.message}`, "error");
  }
}

function renderConfigTable(tbody, config, scope, options) {
  tbody.innerHTML = "";
  if (!config.length) {
    tbody.append(el("tr", "empty-state", el("td", "", "Tidak ada parameter", { colspan: 7 })));
    return;
  }
  for (const item of config) {
    const tr = document.createElement("tr");
    const value = item.numeric_value;
    const isEmpty = value === null;
    const sourceClass = isEmpty ? "empty" : (item.source || scope);
    
    tr.innerHTML = `
      <td><code>${item.code}</code></td>
      <td>${item.failure_id ? `Failure ID: ${item.failure_id}` : "Shared"}</td>
      <td>${item.description || "—"}</td>
      <td>${item.unit}</td>
      <td>${formatNumber(item.min_value)} – ${formatNumber(item.max_value)} (${item.value_kind})</td>
      <td>
        <input type="number" 
               class="config-value-input ${sourceClass}" 
               value="${isEmpty ? "" : formatNumber(value).replace(/[,.]/g, "")}" 
               step="${item.value_kind === "INTEGER" ? "1" : "0.001"}"
               min="${item.min_value}"
               max="${item.max_value}"
               data-param-id="${item.parameter_id}"
               data-code="${item.code}"
               ${!options.editable ? "disabled" : ""}
               aria-label="Nilai untuk ${item.code}">
      </td>
      <td>
        ${options.editable ? `
          <button class="action-button save-btn" data-param-id="${item.parameter_id}" data-code="${item.code}">Simpan</button>
          ${!isEmpty ? `<button class="action-button delete" data-param-id="${item.parameter_id}" data-code="${item.code}">Hapus</button>` : ""}
        ` : ""}
      </td>
    `;
    tbody.append(tr);
  }

  tbody.querySelectorAll(".save-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const paramId = Number(btn.dataset.paramId);
      const code = btn.dataset.code;
      const input = tbody.querySelector(`input[data-param-id="${paramId}"]`);
      const value = input.value === "" ? null : (input.step === "1" ? parseInt(input.value) : parseFloat(input.value));
      btn.disabled = true;
      btn.textContent = "Menyimpan…";
      try {
        await options.onUpdate(paramId, value);
        showToast(`Parameter ${code} disimpan`, "success");
        if (options.onUpdate === ui.pumps.onUpdate) await loadPumpConfig();
        else if (options.onUpdate === ui.flowhead.onUpdate) await loadFlowheadConfig();
        else if (options.onUpdate === ui.vfd.onUpdate) await loadVfdConfig();
        else if (options.onUpdate === ui.global.onUpdate) await loadGlobalConfig();
      } catch (err) {
        showToast(`Gagal menyimpan: ${err.message}`, "error");
      } finally {
        btn.disabled = false;
        btn.textContent = "Simpan";
      }
    });
  });

  tbody.querySelectorAll(".action-button.delete").forEach(btn => {
    btn.addEventListener("click", async () => {
      const paramId = Number(btn.dataset.paramId);
      const code = btn.dataset.code;
      if (!confirm(`Hapus nilai untuk ${code}?`)) return;
      btn.disabled = true;
      btn.textContent = "Menghapus…";
      try {
        await options.onDelete(paramId);
        showToast(`Parameter ${code} dihapus`, "success");
        if (options.onDelete === ui.pumps.onDelete) await loadPumpConfig();
        else if (options.onDelete === ui.flowhead.onDelete) await loadFlowheadConfig();
        else if (options.onDelete === ui.vfd.onDelete) await loadVfdConfig();
        else if (options.onDelete === ui.global.onDelete) await loadGlobalConfig();
      } catch (err) {
        showToast(`Gagal menghapus: ${err.message}`, "error");
      } finally {
        btn.disabled = false;
        btn.textContent = "Hapus";
      }
    });
  });
}

async function loadEffectiveConfig() {
  if (!state.currentEffectivePumpId) return;
  ui.effective.container.hidden = true;
  try {
    const config = await socketEmit("config:effective", { dexPumpId: state.currentEffectivePumpId });
    renderEffectiveTable(config);
    ui.effective.container.hidden = false;
  } catch (err) {
    showToast(`Gagal memuat konfigurasi efektif: ${err.message}`, "error");
  }
}

function renderEffectiveTable(config) {
  const tbody = ui.effective.tableBody;
  tbody.innerHTML = "";
  
  const allParams = [
    ...config.flowhead.map(f => ({ ...f, scope: "FLOWHEAD" })),
    ...config.vfd.map(v => ({ ...v, scope: "VFD" })),
    ...config.global.map(g => ({ ...g, scope: "GLOBAL" })),
  ].sort((a, b) => a.code.localeCompare(b.code));

  for (const item of allParams) {
    const tr = document.createElement("tr");
    const isMissing = item.numeric_value === null;
    const sourceClass = isMissing ? "none" : item.source;
    const statusText = isMissing ? "Kosong" : "Tersedia";
    const statusClass = isMissing ? "empty" : "";
    
    tr.innerHTML = `
      <td><code>${item.code}</code></td>
      <td>${item.failure_id ? `Failure ID: ${item.failure_id}` : "Shared"}</td>
      <td>${item.scope}</td>
      <td><span class="source-badge ${sourceClass}">${item.source || "—"}</span></td>
      <td><span class="config-value-display ${sourceClass}">${formatNumber(item.numeric_value)} ${item.unit}</span></td>
      <td class="${statusClass}">${statusText}</td>
    `;
    tbody.append(tr);
  }

  if (config.missing.length) {
    ui.effective.missingList.innerHTML = "";
    for (const code of config.missing) {
      ui.effective.missingList.append(el("li", "", code));
    }
    ui.effective.missingDiv.hidden = false;
  } else {
    ui.effective.missingDiv.hidden = true;
  }
}

function initTabs() {
  for (const [name, button] of Object.entries(ui.tabs.buttons)) {
    button.addEventListener("click", () => {
      switchTab(name);
      if (name === "pumps" && !state.currentPumpId && state.pumps.length) {
        ui.pumps.select.value = state.pumps[0].dex_pump_id;
        ui.pumps.select.dispatchEvent(new Event("change"));
      } else if (name === "flowhead" && !state.currentFlowheadCapacity) {
        ui.flowhead.select.value = String(state.flowheadCapacities[0] || "");
        ui.flowhead.select.dispatchEvent(new Event("change"));
      } else if (name === "vfd" && !state.currentVfdTypeId) {
        ui.vfd.select.value = String(state.vfdTypes[0] || "");
        ui.vfd.select.dispatchEvent(new Event("change"));
      } else if (name === "global") {
        loadGlobalConfig();
      }
    });
  }
}

function initSelectors() {
  ui.pumps.select.addEventListener("change", () => {
    state.currentPumpId = ui.pumps.select.value || null;
    loadPumpConfig();
  });
  ui.pumps.refresh.addEventListener("click", loadPumpConfig);

  ui.flowhead.select.addEventListener("change", () => {
    state.currentFlowheadCapacity = ui.flowhead.select.value || null;
    loadFlowheadConfig();
  });
  ui.flowhead.refresh.addEventListener("click", loadFlowheadConfig);

  ui.vfd.select.addEventListener("change", () => {
    state.currentVfdTypeId = ui.vfd.select.value || null;
    loadVfdConfig();
  });
  ui.vfd.refresh.addEventListener("click", loadVfdConfig);

  ui.effective.select.addEventListener("change", () => {
    state.currentEffectivePumpId = ui.effective.select.value || null;
    loadEffectiveConfig();
  });
  ui.effective.refresh.addEventListener("click", loadEffectiveConfig);
}

async function initSocket() {
  const { io } = window;
  state.socket = io(API_HOST);

  state.socket.on("connect", () => {
    console.log("[config] connected to API");
    setStatus("ok", "Terhubung ke API");
    refreshHealth();
    loadPumps();
    loadFlowheadCapacities();
    loadVfdTypes();
    loadGlobalConfig();
  });

  state.socket.on("disconnect", () => {
    setStatus("offline", "Koneksi terputus");
    ui.footerHealth.textContent = "Status API tidak tersedia";
  });
}

async function refreshHealth() {
  if (!state.socket || !state.socket.connected) {
    setStatus("offline", "API tidak terjangkau");
    ui.footerHealth.textContent = "Status API tidak tersedia";
    return;
  }

  try {
    const health = await socketEmit("health", {});
    const healthy = health.status === "ok" && health.rules_loaded !== false && health.setpoints_loaded !== false && health.config_loaded !== false && health.db_connected !== false;

    if (health.status === "ok" && healthy) {
      setStatus("ok", "API operasional");
      ui.footerHealth.textContent = "Aturan & DB siap";
    } else if (health.status === "ok") {
      setStatus("degraded", "API perlu diperiksa");
      ui.footerHealth.textContent = "Beberapa komponen bermasalah";
    } else {
      setStatus("degraded", "API degraded");
      ui.footerHealth.textContent = "Komponen bermasalah";
    }
    ui.footerChecked.textContent = `Diperiksa ${new Date().toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta" })} WIB`;
  } catch (err) {
    setStatus("offline", "API tidak merespons");
    ui.footerHealth.textContent = "Status API tidak tersedia";
  }
}

initTabs();
initSelectors();
initSocket();
refreshHealth();
window.setInterval(refreshHealth, REFRESH_MS);