// Hapus dataset via UI: upload -> modal Batal -> modal Hapus ->
// baris hilang + pindah otomatis + toast (Playwright, headless).
import path from "node:path";
import { expect, test } from "@playwright/test";

const DELETE_DOC = "pw_upload_delete.csv";

test.describe("UI delete dataset", () => {
  test("upload -> Batal bertahan -> Hapus hilang + toast", async ({
    page,
    request,
  }) => {
    test.setTimeout(90000);
    // pra-bersih agar retry idempoten
    await request.delete(`/api/documents/${DELETE_DOC}`);
    await page.goto("/documents");

    // upload file kecil khusus delete (hindari tabrakan file spec lain)
    await page.locator("#document-upload").setInputFiles(
      path.join(__dirname, "fixtures", DELETE_DOC),
    );
    await page.getByRole("button", { name: "Upload", exact: true }).click();
    await expect(
      page.locator(".document-list").getByText(DELETE_DOC),
    ).toBeVisible({ timeout: 20000 });
    await page.locator("#document-select").selectOption(DELETE_DOC);

    // Batal: modal tutup, file tetap ada
    await page.getByRole("button", { name: "Hapus", exact: true }).click();
    await expect(page.getByTestId("delete-modal")).toBeVisible();
    await page.getByRole("button", { name: "Batal" }).click();
    await expect(page.getByTestId("delete-modal")).toHaveCount(0);
    await expect(
      page.locator(".document-list").getByText(DELETE_DOC),
    ).toBeVisible();

    // Hapus: baris hilang + pindah otomatis + toast sukses
    await page.getByRole("button", { name: "Hapus", exact: true }).click();
    await page.getByTestId("delete-confirm").click();
    await expect(page.getByTestId("delete-modal")).toHaveCount(0);
    await expect(
      page.locator(".document-list").getByText(DELETE_DOC),
    ).toHaveCount(0);
    await expect(page.locator("#document-select")).not.toHaveValue(
      DELETE_DOC,
    );
    await expect(page.getByText(/dihapus\./)).toBeVisible();

    // bersih-bersih akhir (aman bila sudah terhapus)
    await request.delete(`/api/documents/${DELETE_DOC}`);
  });

  test("hapus via baris daftar: non-terpilih hilang, terpilih aman", async ({
    page,
    request,
  }) => {
    test.setTimeout(90000);
    const OTHER_DOC = "pw_upload_delete2.csv";
    await request.delete(`/api/documents/${DELETE_DOC}`);
    await request.delete(`/api/documents/${OTHER_DOC}`);
    await page.goto("/documents");

    for (const f of [DELETE_DOC, OTHER_DOC]) {
      await page.locator("#document-upload").setInputFiles(
        path.join(__dirname, "fixtures", f),
      );
      await page.getByRole("button", { name: "Upload", exact: true }).click();
      await expect(
        page.locator(".document-list").getByText(f),
      ).toBeVisible({ timeout: 20000 });
    }
    await page.locator("#document-select").selectOption(DELETE_DOC);

    // hapus file non-terpilih lewat tombol barisnya
    await page
      .locator("article", { hasText: OTHER_DOC })
      .getByRole("button", { name: "Hapus" })
      .click();
    await expect(page.getByTestId("delete-modal")).toBeVisible();
    await expect(page.getByTestId("delete-modal")).toContainText(OTHER_DOC);
    await page.getByTestId("delete-confirm").click();
    await expect(
      page.locator(".document-list").getByText(OTHER_DOC),
    ).toHaveCount(0);
    // terpilih tetap aman + tidak pindah
    await expect(
      page.locator(".document-list").getByText(DELETE_DOC),
    ).toBeVisible();
    await expect(page.locator("#document-select")).toHaveValue(DELETE_DOC);
    await expect(page.getByText(/pw_upload_delete2\.csv dihapus\./)).toBeVisible();

    // bersih-bersih akhir
    await request.delete(`/api/documents/${DELETE_DOC}`);
    await request.delete(`/api/documents/${OTHER_DOC}`);
  });
});
