// Simulasi Sensor: engine aktual via /classify, tanpa mock vonis.
// T2/T3 memakai backend :3031 yang hidup (real engine, real thresholds).
import { expect, test } from "@playwright/test";

test.describe("Simulasi Sensor", () => {
  test.beforeEach(async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(String(err).slice(0, 300)));
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        const text = msg.text();
        if (!/hmr|websocket|devtools/i.test(text)) pageErrors.push(text.slice(0, 300));
      }
    });
    (page as unknown as { __pageErrors: string[] }).__pageErrors = pageErrors;
    await page.goto("/simulation");
  });

  test.afterEach(async ({ page }) => {
    const errs = (page as unknown as { __pageErrors?: string[] }).__pageErrors ?? [];
    expect(errs, `console/page errors: ${errs.join(" | ")}`).toEqual([]);
  });

  test("T1 idle: badge SIMULATION + slider terkunci", async ({ page }) => {
    await expect(page.getByTestId("sim-badge")).toBeVisible();
    await expect(page.getByTestId("sim-badge")).toContainText("SIMULATION");
    await expect(page.getByLabel("Target Input Voltage")).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Start Simulation" }),
    ).toBeVisible();
  });

  test("T2 engine aktual: target 340V -> undervoltage", async ({ page }) => {
    test.setTimeout(120000);
    await page.getByRole("button", { name: "Start Simulation" }).click();
    await expect(page.getByTestId("sim-seq")).toContainText("#1", {
      timeout: 15000,
    });
    // Failure-based UI: Input Voltage primer saat monitoring undervoltage.
    await page.getByTestId("sim-failure-select").selectOption("undervoltage");
    await page.getByLabel("Angka Input Voltage").fill("340");
    // 340 ± 0.5% selalu di bawah 360 -> engine nyata wajib undervoltage.
    await expect(page.getByTestId("sim-trouble")).toContainText(
      "undervoltage",
      { timeout: 40000 },
    );
    await expect(page.getByTestId("sim-badge")).toBeVisible();
  });

  test("T3 seed sama -> aktual pertama identik", async ({ page }) => {
    await page.getByRole("button", { name: "Start Simulation" }).click();
    await expect(page.getByTestId("sim-seq")).toContainText("#1", {
      timeout: 15000,
    });
    await page.getByRole("button", { name: "Stop" }).click();
    const firstVoltage = await page.getByTestId("actual-input_voltage").textContent();
    await page.reload();
    await page.getByRole("button", { name: "Start Simulation" }).click();
    await expect(page.getByTestId("sim-seq")).toContainText("#1", {
      timeout: 15000,
    });
    await page.getByRole("button", { name: "Stop" }).click();
    const secondVoltage = await page.getByTestId("actual-input_voltage").textContent();
    expect(firstVoltage).toBeTruthy();
    expect(secondVoltage).toBe(firstVoltage);
  });

  test("T4 Stop membekukan sampel", async ({ page }) => {
    await page.getByRole("button", { name: "Start Simulation" }).click();
    await expect(page.getByTestId("sim-seq")).toContainText("#1", {
      timeout: 15000,
    });
    await page.getByRole("button", { name: "Stop" }).click();
    const before = await page.getByTestId("sim-seq").textContent();
    await page.waitForTimeout(3500);
    await expect(page.getByTestId("sim-seq")).toHaveText(before ?? "");
  });

  test("T5 mobile: tanpa overflow horizontal", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/simulation");
    await expect(page.getByTestId("sim-badge")).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
    await expect(
      page.getByRole("button", { name: "Start Simulation" }),
    ).toBeVisible();
  });
});
