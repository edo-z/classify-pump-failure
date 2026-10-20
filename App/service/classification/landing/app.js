/**
 * Landing status widget: reads the public classification API health endpoint.
 * Plain DOM, no dependencies; failures degrade to an "offline" state.
 */

const API_HEALTH = "https://class-api.aldozeno.my.id/health";
const REFRESH_MS = 30_000;
const TIMEOUT_MS = 8_000;

const pill = document.getElementById("status-pill");
const statusText = document.getElementById("status-text");
const rulesEl = document.getElementById("rules");
const setpointsEl = document.getElementById("setpoints");
const checkedEl = document.getElementById("checked");

function setState(state, label) {
  if (!pill) return;
  pill.dataset.state = state;
  if (statusText) statusText.textContent = label;
}

function yesNo(value) {
  if (value === true) return "Siap";
  if (value === false) return "Bermasalah";
  return "—";
}

function stamp() {
  return new Intl.DateTimeFormat("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZone: "Asia/Jakarta",
  }).format(new Date());
}

async function refresh() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(API_HEALTH, {
      signal: controller.signal,
      cache: "no-store",
      headers: { accept: "application/json" },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const health = await response.json();
    const ok = health.status === "ok";
    setState(ok ? "ok" : "degraded", ok ? "Operasional" : "Degraded");
    if (rulesEl) rulesEl.textContent = yesNo(health.rules_loaded);
    if (setpointsEl) setpointsEl.textContent = yesNo(health.setpoints_loaded);
  } catch {
    setState("offline", "Tidak terjangkau");
    if (rulesEl) rulesEl.textContent = "—";
    if (setpointsEl) setpointsEl.textContent = "—";
  } finally {
    clearTimeout(timer);
    if (checkedEl) checkedEl.textContent = `${stamp()} WIB`;
  }
}

refresh();
setInterval(refresh, REFRESH_MS);
