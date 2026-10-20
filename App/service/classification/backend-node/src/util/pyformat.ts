/**
 * Python-compatible numeric formatting helpers.
 *
 * The golden oracle compares ``matched_conditions`` strings for EXACT
 * equality, so the Node port must reproduce Python's ``str(float)``,
 * ``f"{x:.1f}"``, ``f"{x:.2f}"``, ``f"{x:g}"`` and ``f"{x:+.1f}"``
 * semantics — not merely numeric equality.
 *
 * ``fixed`` performs exact round-half-even on the true IEEE-754 value
 * (via BigInt decomposition) to match Python's correctly-rounded
 * formatting, which JS ``toFixed`` does not guarantee.
 */

function decompose(x: number): { mantissa: bigint; exp: number } {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, x);
  const bits = dv.getBigUint64(0);
  const exp = Number((bits >> 52n) & 0x7ffn);
  const frac = bits & 0xfffffffffffffn;
  if (exp === 0) {
    return { mantissa: frac, exp: -1074 };
  }
  // value = mantissa * 2^(exp - 1075); mantissa includes the implicit bit.
  return { mantissa: frac | (1n << 52n), exp: exp - 1075 };
}

/** ``f"{x:.{k}f}"`` — exact round-half-even (Python ``format``). */
export function fixed(x: number, k: number): string {
  if (Number.isNaN(x)) return "nan";
  if (x === Infinity) return "inf";
  if (x === -Infinity) return "-inf";
  const neg = x < 0 || Object.is(x, -0);
  const ax = Math.abs(x);
  const { mantissa, exp } = decompose(ax);
  const e = exp + k;
  const fivePow = 5n ** BigInt(k);
  let num: bigint;
  let den: bigint;
  if (e >= 0) {
    num = mantissa * (1n << BigInt(e)) * fivePow;
    den = 1n;
  } else {
    num = mantissa * fivePow;
    den = 1n << BigInt(-e);
  }
  let q = num / den;
  const r = num % den;
  const twice = r * 2n;
  if (twice > den || (twice === den && q % 2n === 1n)) {
    q += 1n;
  }
  const pow = 10n ** BigInt(k);
  const intPart = q / pow;
  const fracPart = q % pow;
  let s = intPart.toString();
  if (k > 0) {
    s += "." + fracPart.toString().padStart(k, "0");
  }
  return (neg ? "-" : "") + s;
}

/** ``f"{x:+.1f}"`` — always show an explicit sign for non-negative values. */
export function plusFixed(x: number, k: number): string {
  const s = fixed(x, k);
  return s.startsWith("-") ? s : "+" + s;
}

/** Python ``str(float)`` / ``repr(float)`` — shortest round-trip, keeps ``.0``. */
export function reprFloat(x: number): string {
  if (Number.isNaN(x)) return "nan";
  if (x === Infinity) return "inf";
  if (x === -Infinity) return "-inf";
  if (Number.isInteger(x) && Math.abs(x) < 1e16) {
    return (Object.is(x, -0) ? "-0" : String(x)) + ".0";
  }
  let s = String(x);
  if (s.includes("e")) {
    s = s.replace(/e([+-])(\d+)$/, (_m, sign: string, digits: string) => {
      return "e" + sign + digits.padStart(2, "0");
    });
  }
  return s;
}

/** Python ``f"{x:g}"`` — 6 significant digits, trailing zeros stripped. */
export function general(x: number): string {
  if (Number.isNaN(x)) return "nan";
  if (x === Infinity) return "inf";
  if (x === -Infinity) return "-inf";
  if (x === 0) return "0";
  const p = 6;
  const exp = Math.floor(Math.log10(Math.abs(x)));
  if (exp < -4 || exp >= p) {
    const raw = x.toExponential(p - 1);
    const [mantissa, ePart] = raw.split("e") as [string, string];
    let m = mantissa;
    if (m.includes(".")) {
      m = m.replace(/0+$/, "").replace(/\.$/, "");
    }
    const sign = ePart.startsWith("-") ? "-" : "+";
    let digits = ePart.replace(/^[+-]/, "");
    if (digits.length < 2) digits = "0" + digits;
    return m + "e" + sign + digits;
  }
  let s = x.toPrecision(p);
  if (s.includes(".")) {
    s = s.replace(/0+$/, "").replace(/\.$/, "");
  }
  return s;
}

/**
 * Default Python ``str(value)`` for a JSON scalar that may be an int or a
 * float (JSON integers render without a trailing ``.0``).
 */
export function numRepr(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return reprFloat(value);
}
