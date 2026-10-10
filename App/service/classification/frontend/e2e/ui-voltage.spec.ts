// Opsi B — verifikasi UI rename dc_voltage -> input_voltage (Playwright, headless).
//
// T1 /documents label toggle      : Analisis File Ini -> "Input Voltage", tanpa dc_*
// T2 /documents upload via UI     : file-input -> Analisis File Ini -> cleanup afterAll
// T4 /admin smoke                 : load setpoint
import path from "node:path";
import { expect, test } from "@playwright/test";

const UPLOAD_DOC = "pw_upload_voltage.csv";
const ABSENT = [/dc_voltage/, /dcVoltage/, /DC Voltage/];

test.describe("UI input_voltage", () => {
  test("T1 documents: Analisis File Ini menampilkan toggle Input Voltage, tanpa dc_*", async ({
    page,
  }) => {
    await page.goto("/documents");
    await page.locator("#document-select").selectOption("aldo_pump_logs_2.csv");
    await page.getByRole("button", { name: "Analisis File Ini" }).click();
    await expect(page.getByText("Data siap dianalisis.")).toBeVisible({
      timeout: 20000,
    });
    await expect(page.getByText("Input Voltage", { exact: true }).first()).toBeVisible();
    const html = await page.content();
    for (const re of ABSENT) expect(html).not.toMatch(re);
  });

  test("T2 documents: upload CSV via UI lalu Analisis File Ini", async ({
    page,
    request,
  }) => {
    test.setTimeout(60000);
    // pra-bersih agar retry idempoten
    await request.delete(`/api/documents/${UPLOAD_DOC}`);
    await page.goto("/documents");
    await page.locator("#document-upload").setInputFiles(
      path.join(__dirname, "fixtures", UPLOAD_DOC),
    );
    await page.getByRole("button", { name: "Upload", exact: true }).click();
    await expect(
      page.locator(".document-list").getByText(UPLOAD_DOC),
    ).toBeVisible({ timeout: 20000 });
    await page.locator("#document-select").selectOption(UPLOAD_DOC);
    await page.getByRole("button", { name: "Analisis File Ini" }).click();
    await expect(page.getByText("Data siap dianalisis.")).toBeVisible({
      timeout: 20000,
    });
    await expect(page.getByText("Input Voltage", { exact: true }).first()).toBeVisible();
    const html = await page.content();
    for (const re of ABSENT) expect(html).not.toMatch(re);
    // cleanup: kembalikan daftar dokumen ke semula
    const del = await request.delete(`/api/documents/${UPLOAD_DOC}`);
    expect(del.ok()).toBeTruthy();
  });

  test("T4 admin: halaman setpoint termuat", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto("/admin");
    await expect(page.getByText("5000_lps").first()).toBeVisible({
      timeout: 20000,
    });
    expect(errors.filter((e) => !e.includes("ResizeObserver"))).toEqual([]);
  });
});
