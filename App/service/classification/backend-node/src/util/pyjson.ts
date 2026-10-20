/**
 * Minimal Python-compatible JSON serializer used only for the writable
 * ``profile_setpoints.json`` file, so a Node PUT produces byte-identical
 * output to Python's ``json.dumps(..., indent=2, ensure_ascii=False) + "\n"``.
 *
 * Differences from ``JSON.stringify`` that matter here:
 *  - integral floats keep a ``.0`` suffix (38.0, not 38),
 *  - 2-space indentation with Python's ``", "`` / ``": "`` layout.
 */

function dumpValue(value: unknown, indent: number, level: number): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (Number.isFinite(value)) {
      return Number.isInteger(value) ? value.toFixed(1) : String(value);
    }
    return value === Infinity ? "Infinity" : value === -Infinity ? "-Infinity" : "NaN";
  }
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    const pad = " ".repeat(indent * (level + 1));
    const closePad = " ".repeat(indent * level);
    const items = value.map((v) => pad + dumpValue(v, indent, level + 1));
    return "[\n" + items.join(",\n") + "\n" + closePad + "]";
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) return "{}";
  const pad = " ".repeat(indent * (level + 1));
  const closePad = " ".repeat(indent * level);
  const items = entries.map(
    ([k, v]) => pad + JSON.stringify(k) + ": " + dumpValue(v, indent, level + 1),
  );
  return "{\n" + items.join(",\n") + "\n" + closePad + "}";
}

export function pyJsonDumps(value: unknown, indent = 2): string {
  return dumpValue(value, indent, 0);
}
