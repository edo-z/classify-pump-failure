import { test, expect } from 'e2e';

// Reliability: rute me-render + disiplin lokal, tanpa model call kecuali
// dinyatakan. Stabil = syarat Rawat (Shitsuke).

test(
  'reliability: / redirect ke /documents + sidebar utuh',
  { tags: ['reliability'] },
  async ({ app, screen }) => {
    await app.open('/');
    await expect(
      screen.getByRole('link', 'Klasifikasi Dokumen', { exact: false }),
    ).toBeVisible();
    await expect(
      screen.getByRole('link', 'Chat Asisten', { exact: false }),
    ).toBeVisible();
    await expect(
      screen.getByRole('link', 'Admin Setpoint', { exact: false }),
    ).toBeVisible();
    await expect(
      screen.getByRole('button', 'Analisis File Ini', { exact: false }),
    ).toBeVisible();
  },
);

test(
  'reliability: /admin memuat setpoint',
  { tags: ['reliability'] },
  async ({ app, screen }) => {
    await app.open('/admin');
    await expect(
      screen.getByRole('heading', 'Setpoint Profil Pompa'),
    ).toBeVisible();
  },
);

test(
  'reliability: /chat pesan kosong divalidasi lokal',
  { tags: ['reliability'] },
  async ({ app, screen }) => {
    await app.open('/chat');
    await screen.getByPlaceholder('Tulis pesan (maks 4000 huruf)…').fill('   ');
    await screen.getByRole('button', 'Kirim').click();
    await expect(screen.getByText('Pesan kosong', { exact: false })).toBeVisible();
  },
);
