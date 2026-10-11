import { test, expect } from 'e2e';

// Readiness: cek API + service tanpa browser-agent (0 model call).
// Gagal di sini = hentikan run lanjutan (app belum siap).
const BE = 'http://127.0.0.1:3031';
const FE = 'http://127.0.0.1:3030';
const LLM = 'http://127.0.0.1:4100';

test(
  'readiness: backend /health ok + rules termuat',
  { tags: ['readiness'] },
  async () => {
    const res = await fetch(`${BE}/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      status: string;
      rules_exists: boolean;
      rules_loaded: boolean;
      rules_error: unknown;
    };
    expect(body.status).toBe('ok');
    expect(body.rules_exists).toBe(true);
    expect(body.rules_loaded).toBe(true);
    expect(body.rules_error).toBeNull();
  },
);

test(
  'readiness: frontend :3030 menjawab',
  { tags: ['readiness'] },
  async () => {
    const res = await fetch(FE, { redirect: 'manual' });
    expect([200, 301, 302, 303, 307, 308]).toContain(res.status);
  },
);

test(
  'readiness: gateway LLM :4100 hidup',
  { tags: ['readiness'] },
  async () => {
    // Root :4100 bukan endpoint valid (404) — yang penting port menjawab,
    // bukan connection refused.
    const res = await fetch(LLM);
    expect(res.status).toBe(404);
  },
);

test(
  'readiness: seed aldo_pump_logs_2.csv tersedia (LOADED)',
  { tags: ['readiness'] },
  async () => {
    const res = await fetch(`${FE}/api/documents`);
    expect(res.status).toBe(200);
    const docs = (await res.json()) as { document_id: string; status: string }[];
    const seed = docs.find((d) => d.document_id === 'aldo_pump_logs_2.csv');
    expect(seed).toBeDefined();
    expect(seed?.status).toBe('LOADED');
  },
);
