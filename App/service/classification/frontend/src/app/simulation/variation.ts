// 5R Simulasi — Automatic Variation: bounded noise + temporal smoothing + seed.
// Murni, tanpa dependensi: epsilon(t) = clip(alpha*eps(t-1) + (1-alpha)*z(t), -A, A).

export type ResponseMode = "halus" | "normal" | "cepat";

export const RESPONSE_ALPHA: Record<ResponseMode, number> = {
  halus: 0.85,
  normal: 0.6,
  cepat: 0.25,
};

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class SensorNoise {
  private eps = 0;

  constructor(private alpha: number) {}

  reset(): void {
    this.eps = 0;
  }

  setAlpha(alpha: number): void {
    this.alpha = alpha;
  }

  /** Satu langkah smoothing. amplitude<=0 -> tepat 0 (deterministik). */
  next(rand: () => number, amplitude: number): number {
    if (!(amplitude > 0)) {
      this.eps = 0;
      return 0;
    }
    const z = (rand() * 2 - 1) * amplitude;
    const e = this.alpha * this.eps + (1 - this.alpha) * z;
    this.eps = Math.max(-amplitude, Math.min(amplitude, e));
    return this.eps;
  }
}

export function clip(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}
