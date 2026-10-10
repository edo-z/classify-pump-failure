// 5R Chat PoC — factory SSE tipis untuk stream chat Dexmin.
// Frontend hanya menampilkan; penilaian tugas dexmin :4100 (via rewrite /api/llm).
// Event: delta {text} → ditempel, done → tutup, error → tutup + lapor.

export type ChatHandlers = {
  onDelta?: (text: string) => void;
  onDone?: (info?: ChatDoneInfo) => void;
  onError?: (message: string) => void;
  onOpen?: () => void;
};

// 5R Chat PoC — metadata aditif dari event done (:4100, dexmin).
// SEMUA kunci nullable + selalu ada-menurut-kontrak tapi kode bertahan bila
// absen (server lama / frame rusak) — tak ada throw, tak ada `!`.
export type ChatUsage = {
  prompt_tokens?: number | null;
  completion_tokens?: number | null;
  total_tokens?: number | null;
  estimated?: boolean | null;
  source?: string | null;
};

export type ChatDoneInfo = {
  session_id?: string | null;
  model?: string | null;
  model_actual?: string | null;
  latency_s?: number | null;
  usage?: ChatUsage | null;
  reasoning_preview?: string | null;
  reasoning_chars?: number | null;
};

function parseDoneInfo(event: Event): ChatDoneInfo {
  try {
    const data = JSON.parse((event as MessageEvent).data) as Record<string, unknown>;
    if (!data || typeof data !== "object") return {};
    const usage = data["usage"];
    return {
      session_id: typeof data["session_id"] === "string" ? data["session_id"] : null,
      model: typeof data["model"] === "string" ? data["model"] : null,
      model_actual: typeof data["model_actual"] === "string" ? data["model_actual"] : null,
      latency_s: typeof data["latency_s"] === "number" ? data["latency_s"] : null,
      usage: usage && typeof usage === "object" ? (usage as ChatUsage) : null,
      reasoning_preview:
        typeof data["reasoning_preview"] === "string" ? data["reasoning_preview"] : null,
      reasoning_chars: typeof data["reasoning_chars"] === "number" ? data["reasoning_chars"] : null,
    };
  } catch {
    return {};
  }
}

export function createChatEventSource(url: string, handlers: ChatHandlers): EventSource {
  const source = new EventSource(url);
  // 5R Stabilitas: done yang sudah diterima membuat onerror berikutnya
  // diabaikan — server menutup koneksi right after done sehingga browser
  // bisa sempat menembak error padahal sukses (false alarm).
  let doneReceived = false;

  source.onopen = () => {
    handlers.onOpen?.();
  };

  // 5R Stabilitas: tutup stream saat error agar tak jadi zombie half-open;
  // pengguna memulai ulang via tombol (retry eksplisit per page).
  source.onerror = () => {
    if (doneReceived) return;
    try {
      source.close();
    } catch {
      // abaikan — yang penting stream mati
    }
    handlers.onError?.("Koneksi chat terputus. Coba lagi.");
  };

  source.addEventListener("delta", (event) => {
    try {
      const data = JSON.parse((event as MessageEvent).data) as { text?: unknown };
      if (typeof data.text === "string" && data.text) {
        handlers.onDelta?.(data.text);
      }
    } catch {
      // frame rusak diabaikan — stream tetap jalan
    }
  });

  source.addEventListener("done", (event) => {
    doneReceived = true;
    const info = parseDoneInfo(event);
    try {
      source.close();
    } catch {
      // abaikan
    }
    handlers.onDone?.(info);
  });

  source.addEventListener("error", (event) => {
    let message = "Chat gagal. Coba lagi.";
    try {
      const data = JSON.parse((event as MessageEvent).data) as { message?: unknown };
      if (typeof data.message === "string" && data.message.trim()) {
        message = data.message;
      }
    } catch {
      // pakai pesan baku
    }
    try {
      source.close();
    } catch {
      // abaikan
    }
    handlers.onError?.(message);
  });

  return source;
}
