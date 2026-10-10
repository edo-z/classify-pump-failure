// E2E semua 9 trouble klasifikasi (5000_lps) — dokumen.
// T1 /documents : upload fixture 41 baris -> Analisis File Ini (siapkan+klasifikasi)
//                 -> 8 kegagalan (8 tipe) dari 41 titik + badge per tipe.
import path from "node:path";
import { expect, test } from "@playwright/test";

const DOC = "pw_upload_allrules.csv";
const ALL_LABELS = [
  "POMPA_TERSANGKUT_SAMPAH",
  "TURBULENSI",
  "BANYAK_SAMPAH",
  "UNBALANCE",
  "UNDERVOLTAGE",
  "OVERVOLTAGE",
  "DRY_RUN",
  "PANEL_OVERHEAT",
];

test.describe("Klasifikasi semua trouble", () => {
  test("T1 documents: 41 titik -> 8 kegagalan 8 tipe", async ({
    page,
    request,
  }) => {
    test.setTimeout(120000);
    await request.delete(`/api/documents/${DOC}`);
    await page.goto("/documents");
    await page.locator("#document-upload").setInputFiles(
      path.join(__dirname, "fixtures", DOC),
    );
    await page.getByRole("button", { name: "Upload", exact: true }).click();
    await expect(
      page.locator(".document-list").getByText(DOC),
    ).toBeVisible({ timeout: 20000 });
    await page.locator("#document-select").selectOption(DOC);
    const profile = page.locator("select:not(#document-select)").first();
    const options = await profile.locator("option").allTextContents();
    if (options.some((o) => o.includes("5000_lps"))) {
      await profile.selectOption({ label: options.find((o) => o.includes("5000_lps"))! });
    }
    await page.getByRole("button", { name: "Analisis File Ini" }).click();
    await expect(page.getByText("Data siap dianalisis.")).toBeVisible({
      timeout: 20000,
    });
    await expect(page.getByText(/Selesai:/)).toBeVisible({ timeout: 60000 });
    const summary = await page.getByText(/Selesai:/).textContent();
    expect(summary).toContain("8 total di file dari 41 titik");
    // ringkasan tampil sebagai toast, bukan memenuhi header
    await expect(page.getByTestId("toast")).toHaveCount(2);
    await expect(
      page.locator("p.message", { hasText: "Selesai:" }),
    ).toHaveCount(0);
    for (const label of ALL_LABELS) {
      await expect(
        page.getByText(label, { exact: true }).first(),
      ).toBeVisible({ timeout: 10000 });
    }
    // preset trouble: klik DRY_RUN -> hanya parameter pengaruhnya menyala
    // (Frequency Setpoint tidak ada di toggle dokumen, hanya state)
    await page.getByTestId("preset-dry_run").click();
    for (const sig of ["Output Frequency", "Output Power", "Motor Current", "Motor Torque"]) {
      await expect(page.getByLabel(sig, { exact: true })).toBeChecked();
    }
    await expect(page.getByLabel("Input Voltage", { exact: true })).not.toBeChecked();
    await expect(page.getByLabel("Motor Speed", { exact: true })).not.toBeChecked();
    // klik lagi -> kembali default (Frequency, Current, Input Voltage)
    await page.getByTestId("preset-dry_run").click();
    for (const sig of ["Output Frequency", "Motor Current", "Input Voltage"]) {
      await expect(page.getByLabel(sig, { exact: true })).toBeChecked();
    }
    await expect(page.getByLabel("Motor Torque", { exact: true })).not.toBeChecked();
    // presisi via API lewat proxy UI
    const res = await request.get(
      `/api/classification/scan/${DOC}?profile_id=5000_lps`,
    );
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.total_points).toBe(41);
    expect(body.failure_count).toBe(8);
    const types = new Set(body.points.filter((p: { is_failure: boolean }) => p.is_failure).map((f: { trouble_type: string }) => f.trouble_type));
    for (const t of ALL_LABELS.map((s) => s.toLowerCase())) {
      expect(types.has(t)).toBeTruthy();
    }
    const del = await request.delete(`/api/documents/${DOC}`);
    expect(del.ok()).toBeTruthy();
  });
});
