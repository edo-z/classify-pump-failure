import { test, expect } from 'e2e';

// Dokumen: analisis rules lokal (tanpa LLM) — murah untuk agent step.
test('documents: analisis aldo_pump_logs_2.csv menampilkan Input Voltage', async ({
  app,
  screen,
  agent,
}) => {
  await app.open('/documents');
  await agent.act(
    'pilih dokumen "aldo_pump_logs_2.csv" dari dropdown dokumen lalu klik tombol "Analisis File Ini"',
  );
  await expect(screen.getByText('Data siap dianalisis.')).toBeVisible();
  await expect(screen.getByText('Input Voltage', { exact: true }).first()).toBeVisible();
});
