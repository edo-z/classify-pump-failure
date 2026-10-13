// F1–F6 failure-based dashboard: switching, state preservation, evidence badge.
// Membutuhkan frontend :3030 + backend :3031 yang hidup (lihat simulation.spec.ts).
import { expect, test } from "@playwright/test";

const EXPECTED_COUNTS: Record<string, number> = {
  dry_run: 4,
  turbulensi: 4,
  banyak_sampah: 4,
  pompa_tersangkut_sampah: 5,
  unbalance: 3,
  undervoltage: 1,
  overvoltage: 1,
  panel_overheat: 3,
};

test.describe("Failure-based simulation", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/simulation");
  });

  test("F1 idle: 8 failure menampilkan jumlah sensor + chart yang benar", async ({
    page,
  }) => {
    const select = page.getByTestId("sim-failure-select");
    await expect(select).toBeVisible();
    for (const [failure, count] of Object.entries(EXPECTED_COUNTS)) {
      await select.selectOption(failure);
      await expect(page.getByTestId("sim-primary-count")).toContainText(
        `${count} sensor`,
      );
      // Satu chart container per sensor primer.
      const charts = page.locator('[data-testid^="sim-chart-"]');
      await expect(charts).toHaveCount(count);
    }
  });

  test("F3 running: primary-count = sensor failure, bukan jumlah enabled", async ({
    page,
  }) => {
    test.setTimeout(120000);
    await page.getByRole("button", { name: "Start Simulation" }).click();
    await expect(page.getByTestId("sim-seq")).toContainText("#1", {
      timeout: 15000,
    });
    const select = page.getByTestId("sim-failure-select");
    await select.selectOption("dry_run");
    await expect(page.getByTestId("sim-primary-count")).toContainText("4 sensor");
    // Matikan satu sensor primer — count tetap, row disabled tetap terlihat.
    await page.getByLabel("Aktif Output Frequency").uncheck();
    await expect(page.getByTestId("sim-primary-count")).toContainText("4 sensor");
    await expect(page.getByLabel("Target Output Frequency")).toBeVisible();
  });

  test("F2/F3 running: ganti failure tidak mereset sesi dan nilai", async ({
    page,
  }) => {
    test.setTimeout(120000);
    await page.getByRole("button", { name: "Start Simulation" }).click();
    await expect(page.getByTestId("sim-seq")).toContainText("#1", {
      timeout: 15000,
    });
    const select = page.getByTestId("sim-failure-select");
    await select.selectOption("dry_run");
    // Ubah satu target primer dry_run saat running.
    const freqInput = page.getByLabel("Angka Output Frequency");
    await freqInput.fill("39");
    await select.selectOption("unbalance");
    await expect(page.getByTestId("sim-primary-count")).toContainText("3 sensor");
    // Sesi tidak reset: seq terus bertambah, phase tetap running.
    await expect(page.getByTestId("sim-phase")).toContainText("running");
    await select.selectOption("dry_run");
    await expect(page.getByTestId("sim-primary-count")).toContainText("4 sensor");
    // Nilai target kembali utuh.
    await expect(page.getByLabel("Angka Output Frequency")).toHaveValue("39");
    // Sesi berlanjut (tidak reset): sampel berikutnya tiba tanpa kembali ke awal.
    await expect(page.getByTestId("sim-seq")).toContainText("#2", {
      timeout: 15000,
    });
  });

  test("F5: badge monitoring muncul hanya bila trouble cocok", async ({
    page,
  }) => {
    test.setTimeout(120000);
    await page.getByRole("button", { name: "Start Simulation" }).click();
    await expect(page.getByTestId("sim-seq")).toContainText("#1", {
      timeout: 15000,
    });
    const select = page.getByTestId("sim-failure-select");
    // Pilih undervoltage lalu paksa kondisi undervoltage (340V < 360V).
    await select.selectOption("undervoltage");
    await page.getByLabel("Angka Input Voltage").fill("340");
    await expect(page.getByTestId("sim-trouble")).toContainText("undervoltage", {
      timeout: 40000,
    });
    await expect(page.getByTestId("sim-match-badge")).toBeVisible();
    // Pindah monitoring ke dry_run: badge hilang, hasil engine tetap terlihat.
    await select.selectOption("dry_run");
    await expect(page.getByTestId("sim-match-badge")).toHaveCount(0);
    await expect(page.getByTestId("sim-trouble")).toContainText("undervoltage");
  });

  test("F6 mobile running: tanpa overflow horizontal", async ({ page }) => {
    test.setTimeout(120000);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/simulation");
    await page.getByRole("button", { name: "Start Simulation" }).click();
    await expect(page.getByTestId("sim-seq")).toContainText("#1", {
      timeout: 15000,
    });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test("P1-2: hours_run aktif tetapi kosong tetap null", async ({ page }) => {
    test.setTimeout(120000);
    await page.getByRole("button", { name: "Start Simulation" }).click();
    await expect(page.getByTestId("sim-seq")).toContainText("#1", {
      timeout: 15000,
    });
    // Aktifkan Hours Run tanpa mengisi nilai → aktual harus "—", bukan 0.
    await page.getByText("Pengaturan lanjutan").click();
    await page.getByLabel("Aktif Hours Run").check();
    await expect(page.getByTestId("actual-hours_run")).toContainText("—", {
      timeout: 15000,
    });
  });

  test("P1-1: Stop lalu Start cepat tetap jalan (tidak macet inFlight)", async ({
    page,
  }) => {
    test.setTimeout(120000);
    await page.getByRole("button", { name: "Start Simulation" }).click();
    await expect(page.getByTestId("sim-seq")).toContainText("#1", {
      timeout: 15000,
    });
    await page.getByRole("button", { name: "Stop" }).click();
    await page.getByRole("button", { name: "Start Ulang" }).click();
    // Sesi baru harus memproduksi sampel tanpa macet.
    await expect(page.getByTestId("sim-seq")).toContainText("#2", {
      timeout: 20000,
    });
    await expect(page.getByTestId("sim-phase")).toContainText("running");
  });

  test("P2-1: badge muncul bila failure ada di matched_rules walau bukan trouble utama", async ({
    page,
  }) => {
    test.setTimeout(120000);
    await page.getByRole("button", { name: "Start Simulation" }).click();
    await expect(page.getByTestId("sim-seq")).toContainText("#1", {
      timeout: 15000,
    });
    const select = page.getByTestId("sim-failure-select");
    await select.selectOption("undervoltage");
    await page.getByLabel("Angka Input Voltage").fill("340");
    // Picu unbalance bersamaan via sensor sekunder (W menyimpang >10%).
    await page.getByText("sensor lainnya").click();
    await page.getByLabel("Angka Arus RMS W").fill("140");
    // trouble utama = unbalance (urutan engine), undervoltage ikut cocok.
    await expect(page.getByTestId("sim-trouble")).toContainText("unbalance", {
      timeout: 40000,
    });
    await expect(page.getByTestId("sim-match-badge")).toBeVisible();
  });
});
