import type { E2EConfig } from 'e2e';
import { web } from '@e2e-dev/web';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';

// Model: 9router lokal, combo hermes. Key dari env (JANGAN hardcode):
//   export NINEROUTER_API_KEY='sk-...'
// e2e tidak membaca .env sendiri; set di shell sebelum run.
const nineRouter = createOpenAICompatible({
  name: '9router',
  baseURL: 'http://localhost:20128/v1',
  apiKey: process.env.NINEROUTER_API_KEY,
});

export default {
  tests: 'tests-e2e/**/*.e2e.ts',
  // RCEA-1b: serial (paralel berebut state global -> flaky).
  workers: 1,
  // Retry murah: attempt ulang mereplay cache.
  retries: 1,
  targets: [
    {
      // Tanpa command: menempel ke systemd prod yang sudah jalan
      // (classify-pump-frontend :3030 -> backend :3031).
      // RCEA-1c: lawan next start (prod), bukan next dev.
      engine: web(),
      app: { url: 'http://127.0.0.1:3030' },
    },
  ],
  agents: {
    default: {
      model: nineRouter.chatModel('hermes'),
      // Kosakata app: vonis model portable antar run.
      context:
        'App klasifikasi gangguan pompa. 9 trouble: pompa_tersangkut_sampah, turbulensi, banyak_sampah, unbalance, undervoltage, overvoltage, dry_run, panel_overheat, normal. Rute: / (home), /chat (Dexmin), /documents (upload CSV + Analisis File Ini), /admin (setpoint). Label kanonis: "Input Voltage", bukan dc_voltage.',
      system: 'You are a thorough QA agent. Verify every outcome on screen.',
      // Flow sederhana: cap budget agar biaya terkendali.
      maxSteps: 12,
      maxModelCalls: 12,
      // hermes via 9router lambat (extract ~20-60s di layar 200+ node).
      judgmentTimeout: 120_000,
    },
  },
} satisfies E2EConfig;
