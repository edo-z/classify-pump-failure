"use client";

import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  buildChatStreamUrl,
  validateChatMessage,
  type ChatTurn,
} from "../api";
import { createChatEventSource, type ChatDoneInfo } from "../chat";
import styles from "./chat.module.css";

type Conn = "idle" | "connecting" | "live" | "error";

// 5R Chips saran: fokus pembahasan failure — pertanyaan operator realistis
// yang memetakan ke jenis gangguan + ambang sistem (360/410 V, 60 °C).
const SUGGESTIONS = [
  "apa penyebab undervoltage pada pompa?",
  "apa beda turbulensi dan banyak sampah?",
  "ciri pompa tersangkut sampah?",
  "arus tidak seimbang antar fasa, bahayanya apa?",
  "bagaimana cara deteksi dry run?",
  "panel overheat di atas 60 derajat, apa tindakannya?",
];

function formatTime(at?: number): string {
  try {
    return new Date(at ?? Date.now()).toLocaleTimeString("id-ID", {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

export default function ChatPage() {
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState("");
  const [conn, setConn] = useState<Conn>("idle");
  const [connError, setConnError] = useState<string | null>(null);
  const [siteId, setSiteId] = useState("");
  const [documentId, setDocumentId] = useState("");
  const [streamWords, setStreamWords] = useState(0);
  const [mounted, setMounted] = useState(false);
  // 5R Stabilitas + FMEA 502: kalau 20 dtk tanpa delta pertama (RAG lambat /
  // rantai diam), tampilkan penenang — koneksi TIDAK diputus, stream jalan terus.
  const [stalled, setStalled] = useState(false);
  const STALL_MS = 20000;
  // 5R Metadata done (aditif :4100): disimpan per indeks bubble asisten.
  // Semua kunci nullable — absen = baris disembunyikan, bukan error.
  const [metas, setMetas] = useState<Record<number, ChatDoneInfo>>({});
  const pendingMetaIdxRef = useRef<number | null>(null);
  // 5R Rapi + anti-hidrasi #418: sesi dibuat MALAS (saat kirim pertama),
  // bukan saat render/initializer — UUID server vs browser pasti beda
  // sehingga teksnya tak boleh masuk HTML SSR. Label tampil setelah mount.
  const sessionRef = useRef<string>("");
  const sourceRef = useRef<EventSource | null>(null);
  const threadRef = useRef<HTMLDivElement | null>(null);
  const stallTimerRef = useRef<number | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  // 5R Interaksi: salin jawaban + smart scroll (hanya saat di bawah).
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const nearBottomRef = useRef(true);
  const copyTimerRef = useRef<number | null>(null);

  function clearStallTimer() {
    if (stallTimerRef.current !== null) {
      window.clearTimeout(stallTimerRef.current);
      stallTimerRef.current = null;
    }
  }

  function armStallTimer() {
    clearStallTimer();
    setStalled(false);
    stallTimerRef.current = window.setTimeout(() => {
      // Hanya penenang bila BELUM ada kata masuk; kata sudah mengalir = sehat.
      setStreamWords((w) => {
        if (w === 0) setStalled(true);
        return w;
      });
    }, STALL_MS);
  }

  useEffect(() => {
    // 5R Rapi: ID sesi dibuat setelah mount (aman hidrasi — tak masuk HTML
    // SSR) agar label "Sesi …" langsung terisi tanpa menunggu kirim pertama.
    getSessionId();
    setMounted(true);
  }, []);

  function getSessionId(): string {
    if (!sessionRef.current) {
      sessionRef.current =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `poc-${Date.now()}`;
    }
    return sessionRef.current;
  }

  useEffect(() => {
    const el = threadRef.current;
    // Smart scroll: ikuti stream hanya bila pengguna sudah di dekat bawah,
    // agar riwayat yang sedang dibaca tidak dirampas tiap delta.
    if (el && nearBottomRef.current) {
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    }
  }, [turns, conn]);

  function trackScroll() {
    const el = threadRef.current;
    if (!el) return;
    nearBottomRef.current =
      el.scrollHeight - el.scrollTop - el.clientHeight < 96;
  }

  useEffect(() => {
    return () => {
      try {
        sourceRef.current?.close();
      } catch {
        // abaikan
      }
      sourceRef.current = null;
      clearStallTimer();
      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current);
        copyTimerRef.current = null;
      }
    };
  }, []);

  function stopStream() {
    try {
      sourceRef.current?.close();
    } catch {
      // abaikan
    }
    sourceRef.current = null;
    clearStallTimer();
    setStalled(false);
    setConn((c) => (c === "live" || c === "connecting" ? "idle" : c));
  }

  function send(message?: string) {
    const raw = (message ?? input).trim();
    const invalid = validateChatMessage(raw);
    if (invalid) {
      setConnError(invalid);
      setConn("error");
      return;
    }
    if (conn === "connecting" || conn === "live") return;

    try {
      sourceRef.current?.close();
    } catch {
      // abaikan
    }
    setConnError(null);
    setConn("connecting");
    setStreamWords(0);
    armStallTimer();

    const history = turns;
    const now = Date.now();
    // Indeks bubble asisten yang akan ditempeli metadata done nanti.
    pendingMetaIdxRef.current = history.length + 1;
    setTurns((prev) => [...prev, { role: "user", text: raw, at: now }]);
    setInput("");
    if (inputRef.current) inputRef.current.style.height = "auto";
    // Bubble asisten kosong — ditempel per delta
    setTurns((prev) => [...prev, { role: "assistant", text: "", at: now }]);

    const url = buildChatStreamUrl(getSessionId(), raw, history, {
      siteId: siteId || null,
      documentId: documentId || null,
    });

    const src = createChatEventSource(url, {
      onOpen: () => setConn("live"),
      onDelta: (text) => {
        setConn("live");
        setStalled(false);
        setStreamWords((w) => w + text.split(/\s+/).filter(Boolean).length);
        setTurns((prev) => {
          const next = [...prev];
          for (let i = next.length - 1; i >= 0; i--) {
            if (next[i].role === "assistant") {
              next[i] = { ...next[i], text: next[i].text + text };
              break;
            }
          }
          return next;
        });
      },
      onDone: (info) => {
        sourceRef.current = null;
        clearStallTimer();
        setStalled(false);
        const idx = pendingMetaIdxRef.current;
        pendingMetaIdxRef.current = null;
        if (idx !== null && info && Object.keys(info).length > 0) {
          setMetas((prev) => ({ ...prev, [idx]: info }));
        }
        setConn("idle");
      },
      onError: (message) => {
        sourceRef.current = null;
        clearStallTimer();
        setStalled(false);
        pendingMetaIdxRef.current = null;
        setConnError(message);
        setConn("error");
        // Hapus bubble asisten kosong agar tidak mengotori riwayat
        setTurns((prev) => {
          const last = prev[prev.length - 1];
          if (last && last.role === "assistant" && !last.text.trim()) {
            return prev.slice(0, -1);
          }
          return prev;
        });
      },
    });
    sourceRef.current = src;
  }

  function retryLast() {
    const lastUser = [...turns].reverse().find((t) => t.role === "user");
    if (lastUser) send(lastUser.text);
  }

  async function copyText(text: string, idx: number) {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement("textarea");
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      setCopiedIdx(idx);
      if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current);
      copyTimerRef.current = window.setTimeout(() => setCopiedIdx(null), 2000);
    } catch {
      // clipboard tak tersedia — diam, tanpa error konsol
    }
  }

  function autoGrow() {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }

  const busy = conn === "connecting" || conn === "live";
  // 5R Komposisi: sebelum pesan pertama composer di tengah (hero),
  // setelahnya composer menempel di bawah (docking).
  const started = turns.length > 0 || busy;
  const lastTurn = turns[turns.length - 1];
  const streamingActive =
    busy && lastTurn?.role === "assistant" && !lastTurn.text.trim();
  const dotClass =
    conn === "live"
      ? `${styles.dot} ${styles.dotLive}`
      : conn === "connecting"
        ? `${styles.dot} ${styles.dotConnecting}`
        : conn === "error"
          ? `${styles.dot} ${styles.dotError}`
          : `${styles.dot} ${styles.dotIdle}`;
  const statusText =
    conn === "connecting" && !stalled
      ? "Menghubungi dexmin…"
      : conn === "connecting" && stalled
        ? "Masih mencari referensi di database… mohon tunggu, koneksi tetap jalan."
        : conn === "live" && streamWords === 0
          ? "Mulai menerima jawaban…"
          : conn === "live"
            ? `Menerima jawaban… (${streamWords} kata)`
            : conn === "error"
              ? "Terjadi gangguan — lihat pesan di bawah."
              : "Siap. Riwayat 10 turn tersimpan di browser.";

  // 5R Metadata done: susun baris info kecil. Aturan: label persona (model)
  // tampil bila ada; mesin beneran (model_actual) tampil bila beda; token
  // tampil bila total_tokens angka (null = disembunyikan, itu normal);
  // latensi 1 desimal id-ID. Semua absen = tidak ada footer sama sekali.
  function metaLine(meta: ChatDoneInfo): string | null {
    const parts: string[] = [];
    if (meta.model?.trim()) parts.push(meta.model.trim());
    if (meta.model_actual?.trim() && meta.model_actual.trim() !== meta.model?.trim()) {
      parts.push(meta.model_actual.trim());
    }
    if (typeof meta.latency_s === "number" && Number.isFinite(meta.latency_s)) {
      parts.push(`${meta.latency_s.toLocaleString("id-ID", { maximumFractionDigits: 1 })} dtk`);
    }
    const total = meta.usage?.total_tokens;
    if (typeof total === "number" && Number.isFinite(total)) {
      parts.push(`${Math.round(total).toLocaleString("id-ID")} token (token turn terakhir)`);
    }
    return parts.length ? parts.join(" • ") : null;
  }

  // 5R Komposisi: blok render dipakai ulang di cabang hero (tengah)
  // dan cabang thread (docking) — satu definisi, tanpa duplikasi JSX.
  const heroBlock = (
    <div className={styles.hero}>
      <div className={styles.heroTitle}>Halo, saya Dexmin.</div>
      <p className={styles.heroText}>
        Mentor teknisi pompa — tanya soal gangguan, ambang, dan tindak lanjut di lapangan.
      </p>
      <ul className={styles.heroList}>
        <li>Jelaskan 9 jenis gangguan + ambangnya (360/410 V, 60 °C, unbalance 10%).</li>
        <li>Bedakan pola mirip: turbulensi vs banyak sampah, dry run vs normal.</li>
        <li>Sarankan langkah aman berikutnya sebelum Anda eksekusi.</li>
      </ul>
    </div>
  );

  const chipsBlock = (
    <div className={styles.chips}>
      {SUGGESTIONS.map((s) => (
        <button
          key={s}
          type="button"
          className={styles.chip}
          disabled={busy}
          onClick={() => send(s)}
        >
          {s}
        </button>
      ))}
    </div>
  );

  const contextBlock = (
    <details className={styles.context}>
      <summary>Konteks pompa (opsional)</summary>
      <div className={styles.contextBody}>
        <label className={styles.field}>
          Site ID (nomor pompa)
          <input
            value={siteId}
            onChange={(e) => setSiteId(e.target.value)}
            placeholder="cth 96"
            style={{ width: 140 }}
          />
        </label>
        <label className={styles.field}>
          Document ID
          <input
            value={documentId}
            onChange={(e) => setDocumentId(e.target.value)}
            placeholder="kosong = umum"
            style={{ width: 200 }}
          />
        </label>
      </div>
    </details>
  );

  const errorBlock = connError ? (
    <div className={styles.error} role="alert">
      <span>{connError}</span>
      <button type="button" className={styles.retry} onClick={retryLast}>
        Coba lagi
      </button>
    </div>
  ) : null;

  const composerForm = (
    <form
      className={styles.composer}
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
    >
      <div className={styles.composerRow}>
        <textarea
          ref={inputRef}
          rows={1}
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            autoGrow();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          placeholder="Tulis pesan (maks 4000 huruf)…"
          maxLength={4000}
          disabled={busy}
          className={styles.input}
          aria-label="Pesan chat"
        />
        {!busy ? (
          <button type="submit" className={styles.send} disabled={input.length === 0}>
            Kirim
          </button>
        ) : (
          <button type="button" className={styles.stop} onClick={stopStream}>
            Stop
          </button>
        )}
      </div>
        <div className={styles.hint}>Enter kirim • Shift+Enter baris baru • {input.length}/4000 • token turn terakhir</div>
    </form>
  );

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <span className={`${styles.avatar} ${styles.avatarBot}`} aria-hidden="true">D</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className={styles.title}>Dexmin</div>
        </div>
        <span style={{ fontSize: "0.72rem", color: "#6b7280" }}>
          Sesi <code>{mounted ? `${sessionRef.current.slice(0, 8)}…` : "…"}</code>
        </span>
      </header>

      {(siteId.trim() || documentId.trim()) && (
        <div className={styles.contextPills} aria-label="Konteks aktif">
          {siteId.trim() && <span className={styles.pill}>Site {siteId.trim()}</span>}
          {documentId.trim() && <span className={styles.pill}>Dok {documentId.trim()}</span>}
        </div>
      )}

      {!started ? (
        <div className={`${styles.center} ${styles.centerFade}`}>
          {/* 5R Stabilitas: pembungkus margin-auto agar judul tak terpotong
              saat konten melebihi viewport (jebakan justify-center + overflow). */}
          <div className={styles.centerInner}>
            {heroBlock}
            {composerForm}
            {chipsBlock}
            {contextBlock}
            {errorBlock}
          </div>
        </div>
      ) : (
        <>
          {contextBlock}

      <div ref={threadRef} className={styles.thread} aria-live="polite" onScroll={trackScroll}>
        {streamingActive && (
          <div className={styles.row}>
            <span className={`${styles.avatar} ${styles.avatarBot}`} aria-hidden="true">D</span>
            <div>
              <span className={styles.typing} aria-hidden="true">
                <span />
                <span />
                <span />
              </span>
              {stalled && <span className={styles.stallNote}>masih mencari referensi…</span>}
            </div>
          </div>
        )}
        {turns.map((t, i) => {
          const isStreamingTarget =
            busy && t.role === "assistant" && i === turns.length - 1 && t.text.trim();
          const meta = t.role === "assistant" ? metas[i] : undefined;
          const line = meta ? metaLine(meta) : null;
          const reasoning = meta?.reasoning_preview?.trim() ? meta.reasoning_preview.trim() : null;
          const isUser = t.role === "user";
          return (
            <div key={i} className={`${styles.row} ${isUser ? styles.rowUser : ""}`}>
              {!isUser && (
                <span className={`${styles.avatar} ${styles.avatarBot}`} aria-hidden="true">D</span>
              )}
              <div className={styles.body}>
                <div className={isUser ? styles.bodyUser : styles.bodyBot}>
                  {isUser ? (
                    t.text
                  ) : t.text ? (
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{t.text}</ReactMarkdown>
                  ) : null}
                  {isStreamingTarget && <span className={styles.caret} aria-hidden="true" />}
                </div>
                {line && <div className={styles.meta}>{line}</div>}
                {reasoning && (
                  <details className={styles.meta}>
                    <summary style={{ cursor: "pointer" }}>
                      penalaran{typeof meta?.reasoning_chars === "number" ? ` (${meta.reasoning_chars} char)` : ""}
                    </summary>
                    <pre>{reasoning}</pre>
                  </details>
                )}
                <div className={styles.time}>{formatTime(t.at)}</div>
                {!isUser && t.text.trim() && (
                  <button
                    type="button"
                    className={styles.copy}
                    onClick={() => copyText(t.text, i)}
                  >
                    {copiedIdx === i ? "Tersalin" : "Salin"}
                  </button>
                )}
              </div>
              {isUser && (
                <span className={`${styles.avatar} ${styles.avatarUser}`} aria-hidden="true">U</span>
              )}
            </div>
          );
        })}
      </div>

      {errorBlock}

      {composerForm}
      <div className={styles.microfooter}>
        <span className={dotClass} aria-hidden="true" />
        <span>{statusText}</span>
      </div>
        </>
      )}
    </div>
  );
}
