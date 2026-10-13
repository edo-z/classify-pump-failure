// F1 contract: FAILURE_MAP harus memakai key kanonis NOISE_SENSORS.
// Browser-less (tanpa fixture page) — jalan via `playwright test failure-mapping`.
import { expect, test } from "@playwright/test";
import { FAILURE_MAP, FAILURE_OPTIONS } from "../src/app/simulation/failure-signals";
import { NOISE_SENSORS } from "../src/app/simulation/sensors";

const EXPECTED_COUNTS: Record<string, number> = {
  dry_run: 4,
  turbulensi: 4,
  banyak_sampah: 4,
  pompa_tersangkut_sampah: 5,
  unbalance: 3,
  undervoltage: 1,
  overvoltage: 1,
  panel_overheat: 3,
};

test.describe("F1 failure mapping contract", () => {
  test("8 failure preset, tanpa normal", () => {
    expect(FAILURE_OPTIONS).toHaveLength(8);
    expect(Object.keys(FAILURE_MAP).sort()).toEqual(Object.keys(EXPECTED_COUNTS).sort());
    expect(Object.keys(FAILURE_MAP)).not.toContain("normal");
  });

  test("jumlah sensor per failure sesuai planning §2", () => {
    for (const [failure, count] of Object.entries(EXPECTED_COUNTS)) {
      expect(
        FAILURE_MAP[failure as keyof typeof FAILURE_MAP].sensors,
        `sensor count ${failure}`,
      ).toHaveLength(count);
    }
  });

  test("semua key mapping adalah key kanonis NOISE_SENSORS", () => {
    const canonical = new Set(NOISE_SENSORS.map((s) => s.key));
    for (const [failure, map] of Object.entries(FAILURE_MAP)) {
      for (const key of map.sensors) {
        expect(canonical.has(key), `${failure} -> ${key} bukan key kanonis`).toBe(true);
      }
    }
  });

  test("setiap sensor kanonis dicakup minimal satu failure", () => {
    const covered = new Set(Object.values(FAILURE_MAP).flatMap((m) => m.sensors));
    for (const s of NOISE_SENSORS) {
      expect(covered.has(s.key), `${s.key} tidak dicakup failure manapun`).toBe(true);
    }
  });
});
