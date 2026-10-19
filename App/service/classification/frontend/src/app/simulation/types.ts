// Tipe state simulasi — dipakai page.tsx dan panel presentasi.
// Murni tipe (tidak ada logika engine di sini).
import type { ClassifyClassification, ClassifyReading, ClassifyRuleEvaluation } from "../api";

export type SimSnapshot = {
  seq: number;
  time: string;
  trouble: string;
  actuals: Record<string, number | null>;
  targets: Record<string, number | null>;
};

export type SimResult = {
  seq: number;
  classification: ClassifyClassification;
  evidence: number;
  // Paket sampel atomik F8.5: evaluasi + reading yang menghasilkan seq ini.
  // Evidence fokus selalu dibaca dari paket yang sama dengan grafik & KPI.
  ruleEvaluations: ClassifyRuleEvaluation[];
  reading: ClassifyReading;
};
