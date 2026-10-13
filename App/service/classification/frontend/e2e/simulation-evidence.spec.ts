// F8.5/F8.7: panel Mathematical Evidence real-time + sinkronisasi + VAT.
// Membutuhkan frontend :3030 + backend :3031 yang hidup.
import { expect, test } from "@playwright/test";

test.describe("Mathematical Evidence", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/simulation");
  });

  test("F8.4: panel evidence tampil + NO_MATCH terdiferensiasi saat global normal", async ({
    page,
  }) => {
    test.setTimeout(120000);
    await page.getByRole("button", { name: "Start Simulation" }).click();
    await expect(page.getByTestId("sim-seq")).toContainText("#1", {
      timeout: 15000,
    });
    // Default dry_run, freq 39 != setpoint 40 -> global normal, fokus NO_MATCH.
    await expect(page.getByTestId("sim-evidence")).toBeVisible();
    await expect(page.getByTestId("sim-evidence-verdict")).toContainText("NO_MATCH");
    await expect(
      page.getByTestId("sim-evidence-condition-DR_F"),
    ).toContainText("FALSE");
    await expect(
      page.getByTestId("sim-evidence-condition-DR_KW"),
    ).toContainText("TRUE");
  });

  test("F8.4: PTS MATCH menampilkan substitusi engine per slot", async ({
    page,
  }) => {
    test.setTimeout(120000);
    await page.getByRole("button", { name: "Start Simulation" }).click();
    await expect(page.getByTestId("sim-seq")).toContainText("#1", {
      timeout: 15000,
    });
    await page
      .getByTestId("sim-failure-select")
      .selectOption("pompa_tersangkut_sampah");
    await page.getByLabel("Angka Output Frequency").fill("8");
    await page.getByLabel("Angka Output Power").fill("450");
    await page.getByLabel("Angka Motor Current").fill("900");
    await page.getByLabel("Angka Motor Torque").fill("115");
    await page.getByLabel("Angka Motor Speed").fill("200");
    await expect(page.getByTestId("sim-evidence-verdict")).toContainText("MATCH", {
      timeout: 40000,
    });
    await expect(
      page.getByTestId("sim-evidence-substitution-PTS_F"),
    ).toContainText("≤");
    await expect(
      page.getByTestId("sim-evidence-substitution-PTS_KW"),
    ).toContainText("≥");
  });

  test("F8.5: ganti failure memakai sampel yang sama (seq konsisten)", async ({
    page,
  }) => {
    test.setTimeout(120000);
    await page.getByRole("button", { name: "Start Simulation" }).click();
    await expect(page.getByTestId("sim-seq")).toContainText("#1", {
      timeout: 15000,
    });
    const select = page.getByTestId("sim-failure-select");
    await select.selectOption("unbalance");
    await expect(page.getByTestId("sim-evidence")).toBeVisible();
    // Nomor sampel evidence == nomor sampel klasifikasi (paket atomik).
    const seqText = (await page.getByTestId("sim-seq").textContent()) ?? "";
    const seqNum = seqText.replace(/[^0-9]/g, "");
    await expect(page.getByTestId("sim-evidence")).toContainText(
      `sampel #${seqNum}`,
    );
    await select.selectOption("panel_overheat");
    const seqText2 = (await page.getByTestId("sim-seq").textContent()) ?? "";
    expect(seqText2.replace(/[^0-9]/g, "")).not.toBe("");
    await expect(page.getByTestId("sim-evidence")).toBeVisible();
  });

  test("F8.7 mobile: evidence tanpa overflow horizontal", async ({ page }) => {    test.setTimeout(120000);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/simulation");
    await page.getByRole("button", { name: "Start Simulation" }).click();
    await expect(page.getByTestId("sim-seq")).toContainText("#1", {
      timeout: 15000,
    });
    await expect(page.getByTestId("sim-evidence-verdict")).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test("F9: math full-width independen dari dropdown sensor", async ({ page }) => {    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/simulation");
    const math = page.getByTestId("sim-math-full");
    await expect(math).toBeVisible();
    const wClosed = await math.evaluate((el) => (el as HTMLElement).offsetWidth);
    await page.getByText("sensor lainnya").click();
    await page.getByText("Pengaturan lanjutan").click();
    const wOpen = await math.evaluate((el) => (el as HTMLElement).offsetWidth);
    expect(wOpen).toBe(wClosed);
    // Lebar mengikuti konten dashboard (penuh), bukan kolom kanan.
    const dash = await page
      .evaluate(() => document.querySelector(".dashboard")?.clientWidth ?? 0);
    expect(wOpen).toBeGreaterThan(0);
    expect(Math.abs(wOpen - dash)).toBeLessThanOrEqual(48);
  });

  test("E2: FALSE memakai threshold tier-refs runtime (PTS_KW ≥ 400)", async ({
    page,
  }) => {
    test.setTimeout(120000);
    await page.getByRole("button", { name: "Start Simulation" }).click();
    await expect(page.getByTestId("sim-seq")).toContainText("#1", {
      timeout: 15000,
    });
    await page
      .getByTestId("sim-failure-select")
      .selectOption("pompa_tersangkut_sampah");
    // Default: power 111 < 400 -> PTS_KW FALSE dengan substitusi dari refs.
    await expect(
      page.getByTestId("sim-evidence-substitution-PTS_KW"),
    ).toContainText("400", { timeout: 20000 });
  });
});
