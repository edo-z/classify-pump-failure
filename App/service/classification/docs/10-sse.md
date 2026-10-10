# 10 — Aliran Data ke Tampilan (SSE)

Satu-satunya SSE tersisa adalah chat asisten Dexmin (model eksternal `:4100`, loopback saja).

## Chat Dexmin

Browser membuka `EventSource` ke `/api/llm/chat/{session}/stream?...` (same-origin `:3030`, diteruskan ke `:4100`); riwayat 10 turn `{role, text}` dikirim ulang tiap turn (LLM stateless).

```
event: delta
data: {"text":"..."}

event: done
data: {"session_id":"...","model":"...","usage":{...}}

event: error
data: {"message":"..."}
```

- `delta {text}` ditempel ke bubble; `done` menutup stream; `error` menutup + lapor + tombol coba-lagi manual.
- `compress: false` lestari — SSE tidak boleh di-gzip agar perantara tidak me-buffer stream.
- Stall 20 detik hanya indikator UI (tidak memutus koneksi); `onerror` selalu `close()` agar tak ada zombie half-open.
