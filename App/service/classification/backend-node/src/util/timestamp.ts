/**
 * Timezone-aware ISO-8601 timestamp handling that mirrors Python
 * ``datetime`` semantics for the classification contract:
 *  - event-time ordering by absolute instant,
 *  - strict calendar/offset validation (Pydantic rejects invalid values),
 *  - output serialization preserves non-UTC offsets and writes UTC as ``Z``,
 *  - fractional seconds are normalised to microseconds (6 digits), exactly
 *    like Python ``datetime.isoformat()``.
 */

export interface ZonedTimestamp {
  /** Absolute instant in milliseconds since the Unix epoch (may be fractional). */
  epochMs: number;
  /** UTC offset in minutes (e.g. +07:00 -> 420). */
  offsetMinutes: number;
  /** Fractional-second digits normalised to 6 digits; "" when absent. */
  frac: string;
}

const ISO_RE =
  /^(\d{4})-(\d{2})-(\d{2})[Tt ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?(Z|z|[+-]\d{2}:?\d{2})$/;

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] as number;
}

/**
 * Parse an ISO-8601 timestamp. Returns ``null`` when the value is not a
 * valid timestamp (Pydantic would reject it with 422).
 *
 * Unlike ``Date.UTC``, this validates every component first so invalid
 * dates such as ``2026-02-30`` or offsets like ``+25:00`` are rejected
 * instead of being silently normalised.
 */
export function parseIso(value: string): ZonedTimestamp | null {
  const m = ISO_RE.exec(value);
  if (!m) return null;
  const [, y, mo, d, h, mi, s, fracRaw, tz] = m;
  const year = Number(y);
  const month = Number(mo);
  const day = Number(d);
  const hour = Number(h);
  const minute = Number(mi);
  const second = s === undefined ? 0 : Number(s);

  if (year < 1 || year > 9999) return null;
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > daysInMonth(year, month)) return null;
  if (hour > 23 || minute > 59 || second > 59) return null;

  let offsetMinutes = 0;
  if (tz !== "Z" && tz !== "z") {
    const sign = tz.startsWith("-") ? -1 : 1;
    const digits = tz.slice(1).replace(":", "");
    const offsetHour = Number(digits.slice(0, 2));
    const offsetMinute = Number(digits.slice(2, 4));
    if (offsetHour > 23 || offsetMinute > 59) return null;
    offsetMinutes = sign * (offsetHour * 60 + offsetMinute);
  }

  const frac = (fracRaw ?? "").padEnd(6, "0").slice(0, 6);
  const fracMs = frac ? Number(frac.slice(0, 3)) + Number(frac.slice(3)) / 1000 : 0;

  // setUTCFullYear avoids Date.UTC's 0-99 -> 1900-1999 remapping.
  const utc = new Date(0);
  utc.setUTCFullYear(year, month - 1, day);
  utc.setUTCHours(hour, minute, second, 0);
  const epochMs = utc.getTime() + fracMs - offsetMinutes * 60000;

  return {
    epochMs,
    offsetMinutes,
    frac: fracRaw === undefined ? "" : frac,
  };
}

function pad(n: number, width: number): string {
  return String(n).padStart(width, "0");
}

/** Serialize in Python/Pydantic style (microseconds, ``Z`` for UTC). */
export function serializeIso(ts: ZonedTimestamp): string {
  const shifted = new Date(ts.epochMs + ts.offsetMinutes * 60000);
  const date =
    pad(shifted.getUTCFullYear(), 4) +
    "-" +
    pad(shifted.getUTCMonth() + 1, 2) +
    "-" +
    pad(shifted.getUTCDate(), 2) +
    "T" +
    pad(shifted.getUTCHours(), 2) +
    ":" +
    pad(shifted.getUTCMinutes(), 2) +
    ":" +
    pad(shifted.getUTCSeconds(), 2);
  const frac = ts.frac ? "." + ts.frac : "";
  if (ts.offsetMinutes === 0) return date + frac + "Z";
  const sign = ts.offsetMinutes < 0 ? "-" : "+";
  const abs = Math.abs(ts.offsetMinutes);
  const off = sign + pad(Math.floor(abs / 60), 2) + ":" + pad(abs % 60, 2);
  return date + frac + off;
}
