export type DocumentStatus =
  | "LOADED"
  | "PARSE_ERROR"
  | "UNSUPPORTED_FORMAT";

export type StoredDocument = {
  document_id: string;
  filename: string;
  file_type: "csv";
  size_bytes: number;
  created_at: string;
  row_count: number;
  column_count: number;
  status: DocumentStatus;
  user_message?: string | null;
};

async function responseError(response: Response): Promise<string> {
  try {
    const body = await response.json();
    return body.detail ?? `HTTP ${response.status}`;
  } catch {
    return `HTTP ${response.status}`;
  }
}

export async function getDocuments(): Promise<StoredDocument[]> {
  const response = await fetch("/api/documents");

  if (!response.ok) {
    throw new Error(await responseError(response));
  }

  return response.json();
}

export async function uploadDocument(
  file: File,
): Promise<StoredDocument> {
  const response = await fetch(
    `/api/documents/upload?filename=${encodeURIComponent(file.name)}`,
    {
      method: "POST",
      body: file,
    },
  );

  if (!response.ok) {
    throw new Error(await responseError(response));
  }

  return response.json();
}

export async function deleteDocument(
  documentId: string,
): Promise<StoredDocument> {
  const response = await fetch(
    `/api/documents/${encodeURIComponent(documentId)}`,
    {
      method: "DELETE",
    },
  );

  if (!response.ok) {
    throw new Error(await responseError(response));
  }

  return response.json();
}

export async function prepareTelemetry(
  documentId: string,
): Promise<void> {
  const response = await fetch(
    `/api/telemetry/${encodeURIComponent(documentId)}`,
    {
      method: "POST",
    },
  );

  if (!response.ok) {
    throw new Error(await responseError(response));
  }
}

export type MatchedRule = {
  trouble_type: string;
  matched_conditions: string[];
  total_conditions: number;
};

export type ClassificationPipelineResult = {
  document_id: string;
  profile_id: string;
  document_status: "NORMALIZED" | "PARTIAL" | "UNSUPPORTED_SCHEMA";
  source_row_count: number;
  timestamped_row_count: number;
  classification: {
    trouble_type: string;
    matched_rules: MatchedRule[];
    sensor_snapshot: Record<string, unknown>;
    limitations: string[];
    evaluation_status: "FULL" | "PARTIAL" | "INSUFFICIENT_DATA";
  };
};

export async function runClassification(
  documentId: string,
  profileId: string,
  setpointFreq?: number | null,
): Promise<ClassificationPipelineResult> {
  const response = await fetch("/api/classification/run", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      document_id: documentId,
      profile_id: profileId,
      setpoint_freq: setpointFreq,
    }),
  });

  if (!response.ok) {
    throw new Error(await responseError(response));
  }

  return response.json();
}

export type TelemetrySample = {
  timestamp: string | null;
  motor_speed: number | null;
  output_frequency: number | null;
  motor_current: number | null;
  motor_torque: number | null;
  output_power: number | null;
  hours_run: number | null;
  output_voltage: number | null;
  ambient_temperature: number | null;
  control_board_temperature: number | null;
  inverter_temperature: number | null;
  input_voltage: number | null;
  flux_actual: number | null;
  motor_estimated_temperature: number | null;
  arus_rms_u: number | null;
  arus_rms_v: number | null;
  arus_rms_w: number | null;
};

export type TelemetryReplayDataset = {
  document_id: string;
  raw_row_count: number;
  complete_row_count: number;
  partial_row_count: number;
  status: string;
  samples: TelemetrySample[];
};

export async function getTelemetryReplay(
  documentId: string,
): Promise<TelemetryReplayDataset> {
  const response = await fetch(
    `/api/telemetry/${encodeURIComponent(documentId)}`,
  );

  if (!response.ok) {
    throw new Error(await responseError(response));
  }

  return response.json();
}

export type FailurePoint = {
  source_row: number;
  timestamp: string;
  cursor: number;
  trouble_type: string;
  is_failure: boolean;
  evaluation_status: string;
  readings_count: number;
  evidence_size: number;
  matched_rules: MatchedRule[];
  sensor_snapshot: Record<string, unknown>;
};

export type ScanResult = {
  document_id: string;
  profile_id: string;
  total_points: number;
  failure_count: number;
  points: FailurePoint[];
};

export async function scanClassification(
  documentId: string,
  profileId: string,
  setpointFreq?: number | null,
): Promise<ScanResult> {
  const params = new URLSearchParams({
    profile_id: profileId,
  });
  // Resik: jangan kirim "null" — FastAPI menolaknya dengan 422.
  if (
    setpointFreq !== undefined &&
    setpointFreq !== null &&
    Number.isFinite(setpointFreq)
  ) {
    params.append("setpoint_freq", String(setpointFreq));
  }
  const response = await fetch(
    `/api/classification/scan/${encodeURIComponent(documentId)}?${params.toString()}`,
  );
  if (!response.ok) {
    throw new Error(await responseError(response));
  }
  return response.json();
}

export type ProfileSetpoint = {
  frequency_hz: number | null;
  rpm: number | null;
  torque: number | null;
};

export async function getProfileSetpoints(): Promise<Record<string, ProfileSetpoint>> {
  const response = await fetch("/api/profile-setpoints");
  if (!response.ok) throw new Error(await responseError(response));
  return response.json();
}

export async function saveProfileSetpoint(
  profileId: string,
  setpoint: ProfileSetpoint,
): Promise<ProfileSetpoint> {
  const response = await fetch(`/api/profile-setpoints/${encodeURIComponent(profileId)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(setpoint),
  });
  if (!response.ok) throw new Error(await responseError(response));
  return response.json();
}

export type TierRuleRefs = {
  capacity_lps: number;
  kw_ref: number;
  amp_ref: number;
  dr_kw: number;
  dr_amp: number;
  t_kw: number;
  t_window: number;
  t_threshold: number;
};

export type TierRefs = {
  tiers: Record<string, TierRuleRefs>;
  capabilities: {
    undervoltage_v: number;
    overvoltage_v: number;
    unbalance_pct: number;
    panel_overheat_c: number;
  };
  profiles: Record<string, string>;
};

export async function getTierRefs(): Promise<TierRefs> {
  const response = await fetch("/api/classification/tier-refs");
  if (!response.ok) throw new Error(await responseError(response));
  return response.json();
}

// 5R Chat PoC — frontend hanya menampilkan; model (dexmin :4100) yang menilai.
// Riwayat di memori browser, dikirim ulang tiap turn (LLM stateless).
export type ChatRole = "user" | "assistant";

export type ChatTurn = {
  role: ChatRole;
  text: string;
  // 5R Tampilan: stempel waktu tampil-saja (F5 FMEA) — TIDAK ikut dikirim
  // ke LLM (lihat buildChatHistory yang memangkasnya) agar kontrak aman.
  at?: number;
};

export const CHAT_MESSAGE_MAX = 4000;
export const CHAT_HISTORY_TURNS = 10;

export function validateChatMessage(message: string): string | null {
  const text = message.trim();
  if (!text) return "Pesan kosong — tulis dulu sebelum kirim.";
  if (text.length > CHAT_MESSAGE_MAX) {
    return `Pesan kepanjangan (${text.length}/${CHAT_MESSAGE_MAX}). Pendekkan dulu.`;
  }
  return null;
}

// Ambil N turn terakhir, selalu JSON valid ("[]"/"[...]" ) —
// salah format ditoleransi jadi "[]" agar tak kena 422 sia-sia.
// KONTRAK BERSIH: kirim [{role,content}] — kolom tampil-saja (at) dan
// legacy {text} dipangkas. Backend tetap terima {text} sebagai fallback.
export function buildChatHistory(turns: ChatTurn[]): string {
  try {
    const last = turns
      .filter((t) => t.text.trim())
      .slice(-CHAT_HISTORY_TURNS)
      .map((t) => ({ role: t.role, content: t.text }));
    return JSON.stringify(last);
  } catch {
    return "[]";
  }
}

export type ChatLang = "lapangan" | "en";

export type ChatStreamOpts = {
  siteId?: string | null;
  documentId?: string | null;
  language?: string | null;
};

export function buildChatStreamUrl(
  sessionId: string,
  message: string,
  turns: ChatTurn[],
  opts?: ChatStreamOpts,
): string {
  const params = new URLSearchParams({
    message: message.trim(),
    history: buildChatHistory(turns),
  });
  // Resik: jangan kirim "null"/"" — FastAPI menolaknya / mengotori query.
  if (opts?.siteId?.trim()) params.append("site_id", opts.siteId.trim());
  if (opts?.documentId?.trim()) params.append("document_id", opts.documentId.trim());
  // Bahasa lapangan default: "id" dinormalisasi jadi "lapangan" (alias).
  // Chat pakai `language`, bukan `profile_id` (klasifikasi tetap `profile_id`).
  const lang = (opts?.language ?? "lapangan").trim().toLowerCase();
  params.append("language", lang === "en" ? "en" : "lapangan");
  return `/api/llm/chat/${encodeURIComponent(sessionId)}/stream?${params.toString()}`;
}

// 5R Simulasi — klasifikasi jendela sintetis via kontrak klasifikasi stabil
// (stateless, tanpa CSV). Namespace wajib prefix sim- agar counter
// tak bocor ke site produksi.
export type ClassifyReading = {
  timestamp: string;
  motor_speed: number | null;
  output_frequency: number | null;
  motor_current: number | null;
  motor_torque: number | null;
  output_power: number | null;
  hours_run: number | null;
  output_voltage: number | null;
  ambient_temperature: number | null;
  control_board_temperature: number | null;
  inverter_temperature: number | null;
  input_voltage: number | null;
  flux_actual: number | null;
  motor_estimated_temperature: number | null;
  arus_rms_u: number | null;
  arus_rms_v: number | null;
  arus_rms_w: number | null;
};

export type ClassifyMatchedRule = {
  trouble_type: string;
  matched_conditions: string[];
  total_conditions: number;
};

// Type-only mirror of backend RuleEvaluation (ClassificationResult.rule_evaluations).
// Runtime sudah dikirim /classify; deklarasi ini hanya mengetikkannya.
// evaluation null / capability != READY => NOT_EVALUABLE di lapisan presentasi.
export type ClassifyRuleEvaluation = {
  trouble_type: string;
  capability_status: "READY" | "SKIPPED" | "UNSUPPORTED";
  evaluation: "MATCH" | "NO_MATCH" | null;
  missing_requirements: string[];
  matched_conditions: string[];
  total_conditions: number;
};

export type ClassifyClassification = {
  trouble_type: string;
  matched_rules: ClassifyMatchedRule[];
  sensor_snapshot: Record<string, number | null>;
  limitations: string[];
  evaluation_status: string;
  rule_evaluations: ClassifyRuleEvaluation[];
};

export type ClassifyResult = {
  profile_id: string;
  namespace: string;
  rules_version: string;
  evidence_size: number;
  classification: ClassifyClassification;
};

export async function classifyWindow(
  profileId: string,
  setpointFreq: number | null,
  namespace: string,
  readings: ClassifyReading[],
): Promise<ClassifyResult> {
  const response = await fetch("/api/classify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      profile_id: profileId,
      setpoint_freq: setpointFreq,
      namespace,
      readings,
    }),
  });
  if (!response.ok) {
    throw new Error(await responseError(response));
  }
  return response.json();
}

// E2 — Capabilities memakai bentuk inline pada TierRefs di atas.
export type CapabilityRefs = TierRefs["capabilities"];
