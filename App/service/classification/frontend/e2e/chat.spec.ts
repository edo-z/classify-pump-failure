// Chat PoC — E2E dengan mock SSE lokal (tanpa :4100 hidup).
// T1 kirim halo -> delta ditempel -> done menutup -> badge IDLE.
// T2 pesan kosong -> banner validasi lokal, tanpa request jaringan.
import { expect, test } from "@playwright/test";

const MOCK_SSE = [
  "event: delta",
  'data: {"text": "Halo"}',
  "",
  "event: delta",
  'data: {"text": " dari mock"}',
  "",
  "event: done",
  "data: {}",
  "",
].join("\n");

test.describe("Chat PoC", () => {
  test.beforeEach(async ({ page }) => {
    // 5R Rawat: gagalkan tes bila ada JS/page/hydration error (#418).
    // Pengecualian: HMR dev (ws) — hanya relevan di prod; E2E jalan di :3030 prod.
    const pageErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(String(err).slice(0, 300)));
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        const text = msg.text();
        if (!/hmr|websocket|devtools/i.test(text)) pageErrors.push(text.slice(0, 300));
      }
    });
    // Simpan untuk assert di akhir tiap test via fixture manual
    (page as unknown as { __pageErrors: string[] }).__pageErrors = pageErrors;
    await page.route("**/api/llm/chat/*/stream*", async (route) => {
      await route.fulfill({
        status: 200,
        headers: { "content-type": "text/event-stream" },
        // SSE: tiap event HARUS diakhiri baris kosong (\n\n) — tanpa itu
        // event terakhir tertahan di buffer parser dan hangus saat close.
        body: MOCK_SSE + "\n",
      });
    });
    await page.goto("/chat");
  });

  test.afterEach(async ({ page }) => {
    const errs = (page as unknown as { __pageErrors?: string[] }).__pageErrors ?? [];
    expect(errs, `console/page errors: ${errs.join(" | ")}`).toEqual([]);
  });

  test("T1 kirim halo -> jawaban mengalir -> IDLE", async ({ page }) => {
    await page.getByPlaceholder("Tulis pesan…").fill("halo");
    await page.getByRole("button", { name: "Kirim" }).click();
    await expect(page.getByText("Halo dari mock")).toBeVisible({ timeout: 15000 });
    // Stream selesai -> tombol kembali Kirim (idle), status mikro disembunyikan
    await expect(page.getByRole("button", { name: "Kirim" })).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(/Siap\. Riwayat 10 turn/)).toHaveCount(0);
  });

  test("T2 pesan kosong -> validasi lokal, tanpa request", async ({ page }) => {
    let requested = false;
    page.on("request", (req) => {
      if (req.url().includes("/api/llm/")) requested = true;
    });
    await page.getByPlaceholder("Tulis pesan…").fill("   ");
    await page.getByRole("button", { name: "Kirim" }).click();
    await expect(page.getByText(/Pesan kosong/)).toBeVisible({ timeout: 5000 });
    expect(requested).toBe(false);
  });

  test("T3 stream macet 20 dtk -> penenang stall, koneksi tetap jalan", async ({ page }) => {    // Timpa mock: tunda respons 22 dtk (RAG lambat), lalu kirim jawaban.
    await page.unroute("**/api/llm/chat/*/stream*");
    await page.route("**/api/llm/chat/*/stream*", async (route) => {
      await new Promise((r) => setTimeout(r, 22000));
      await route.fulfill({
        status: 200,
        headers: { "content-type": "text/event-stream" },
        body: MOCK_SSE + "\n",
      });
    });
    await page.reload();
    await page.getByPlaceholder("Tulis pesan…").fill("halo lama");
    await page.getByRole("button", { name: "Kirim" }).click();
    // Penenang muncul selagi menunggu kata pertama (batas stall 20 dtk)
    await expect(page.getByText(/mencari referensi/)).toBeVisible({ timeout: 25000 });
    // Setelah respons tiba, jawaban tetap ditempel normal
    await expect(page.getByText("Halo dari mock")).toBeVisible({ timeout: 15000 });
  });

  test("T4 done lengkap -> latensi ringkas + Detail teknis", async ({ page }) => {
    await page.unroute("**/api/llm/chat/*/stream*");
    const doneFull = [
      "event: delta",
      'data: {"text": "Siap"}',
      "",
      "event: done",
      'data: {"session_id":"s1","model":"dexmin","model_actual":"helena-3.0-flash","latency_s":7.2,"usage":{"prompt_tokens":3078,"completion_tokens":23,"total_tokens":3101,"estimated":false,"source":"usage_metadata"},"reasoning_preview":"potongan… [truncated]","reasoning_chars":70}',
      "",
    ].join("\n");
    await page.route("**/api/llm/chat/*/stream*", async (route) => {
      await route.fulfill({
        status: 200,
        headers: { "content-type": "text/event-stream" },
        body: doneFull + "\n",
      });
    });
    await page.reload();
    await page.getByPlaceholder("Tulis pesan…").fill("info model?");
    await page.getByRole("button", { name: "Kirim" }).click();
    await expect(page.getByText("Siap", { exact: true })).toBeVisible({ timeout: 15000 });
    // Metadata teknis tersembunyi secara default (termasuk latensi)
    await expect(page.getByText(/7,2 dtk/)).not.toBeVisible();
    await expect(page.getByText(/helena-3\.0-flash/)).not.toBeVisible();
    await expect(page.getByText(/total 3\.101/)).not.toBeVisible();
    const details = page.locator("details").filter({ hasText: "Detail teknis" });
    await expect(details).toBeVisible({ timeout: 15000 });
    await details.locator("summary").click();
    await expect(page.getByText(/Respons 7,2 dtk/)).toBeVisible({ timeout: 5000 });
    await expect(page.getByText(/helena-3\.0-flash/)).toBeVisible({ timeout: 5000 });
    await expect(page.getByText("potongan… [truncated]")).toBeVisible({ timeout: 5000 });
  });

  test("T5 done lama ({}) -> tetap IDLE, tanpa footer, tanpa error", async ({ page }) => {
    // Mock bawaan beforeEach sudah mengirim done {} — kompatibel mundur.
    await page.getByPlaceholder("Tulis pesan…").fill("halo lawas");
    await page.getByRole("button", { name: "Kirim" }).click();
    await expect(page.getByText("Halo dari mock")).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole("button", { name: "Kirim" })).toBeVisible({ timeout: 15000 });
    await expect(page.locator("details").filter({ hasText: "penalaran" })).toHaveCount(0);
  });

  test("T6 klik chip saran -> langsung terkirim", async ({ page }) => {
    await page.getByRole("button", { name: "apa penyebab undervoltage pada pompa?", exact: true }).click();
    await expect(page.getByText("Halo dari mock")).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole("button", { name: "Kirim" })).toBeVisible({ timeout: 15000 });
  });

  test("T7 URL pakai language, bukan profile_id", async ({ page }) => {
    let streamUrl = "";
    page.on("request", (req) => {
      if (req.url().includes("/api/llm/chat/")) streamUrl = req.url();
    });
    await page.getByPlaceholder("Tulis pesan…").fill("halo");
    await page.getByRole("button", { name: "Kirim" }).click();
    await expect(page.getByText("Halo dari mock")).toBeVisible({ timeout: 15000 });
    expect(streamUrl).toContain("language=lapangan");
    expect(streamUrl).not.toContain("profile_id=");
  });

  test("T8 jauh dari bawah -> tombol Ke terbaru muncul", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 400 });
    for (const m of ["satu", "dua", "tiga", "empat", "lima"]) {
      await page.getByPlaceholder("Tulis pesan…").fill(m);
      await page.getByRole("button", { name: "Kirim" }).click();
      await expect(page.getByRole("button", { name: "Kirim" })).toBeVisible({ timeout: 15000 });
    }
    const thread = page.locator('div[aria-live="polite"]');
    await expect
      .poll(async () => thread.evaluate((el) => el.scrollHeight - el.clientHeight))
      .toBeGreaterThan(200);
    await thread.evaluate((el) => {
      el.scrollTop = 0;
    });
    const jump = page.getByRole("button", { name: "Ke pesan terbaru" });
    await expect(jump).toBeVisible({ timeout: 5000 });
    await jump.click();
    await expect(jump).toHaveCount(0);
  });
});
