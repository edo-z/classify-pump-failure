// Tipe state simulasi — dipakai page.tsx dan panel presentasi.
// Murni tipe (tidak ada logika engine di sini).
import type { V1Classification, V1Reading, V1RuleEvaluation } from "../api";

export type SimSnapshot = {
  seq: number;
  time: string;
  trouble: string;
  actuals: Record<string, number | null>;
  targets: Record<string, number | null>;
};

export type SimResult = {
  seq: number;
  classification: V1Classification;
  evidence: number;
  rules: string;
  // Paket sampel atomik F8.5: evaluasi + reading yang menghasilkan seq ini.
  // Evidence fokus selalu dibaca dari paket yang sama dengan grafik & KPI.
  ruleEvaluations: V1RuleEvaluation[];
  reading: V1Reading;
};
