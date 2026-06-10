// Exact float formatting utilities.
// Python rounds decimal output using round-half-even on the *exact* binary
// value of a double. JS toFixed rounds half-away-from-zero, so we implement
// exact decimal scaling with BigInt arithmetic on the IEEE-754 bits.

const f64 = new DataView(new ArrayBuffer(8));

// Decompose |x| (finite, > 0) into m * 2^e with m a BigInt integer.
export function floatParts(x) {
  f64.setFloat64(0, x);
  const hi = f64.getUint32(0);
  const lo = f64.getUint32(4);
  const biasedExp = (hi >>> 20) & 0x7ff;
  let mant = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  let e;
  if (biasedExp === 0) {
    e = -1074; // subnormal
  } else {
    mant |= 1n << 52n;
    e = biasedExp - 1075;
  }
  return { m: mant, e };
}

// Round-half-even of |x| * 10^pow10, exact. x must be finite, >= 0.
export function exactScaled(x, pow10) {
  if (x === 0) return 0n;
  const { m, e } = floatParts(x);
  let num = m;
  let den = 1n;
  if (e > 0) num <<= BigInt(e);
  else if (e < 0) den <<= BigInt(-e);
  if (pow10 > 0) num *= 10n ** BigInt(pow10);
  else if (pow10 < 0) den *= 10n ** BigInt(-pow10);
  const q = num / den;
  const r = num % den;
  const r2 = r * 2n;
  if (r2 > den) return q + 1n;
  if (r2 === den && (q & 1n) === 1n) return q + 1n;
  return q;
}

// Decimal exponent E of |x|: the power of ten of the leading digit.
export function decimalExponent(x) {
  // toExponential gives the exact decimal exponent of the shortest repr,
  // which equals the true decimal exponent.
  const s = Math.abs(x).toExponential();
  const idx = s.indexOf('e');
  return parseInt(s.slice(idx + 1), 10);
}

// Python repr() of a float.
export function floatRepr(x) {
  if (Number.isNaN(x)) return 'nan';
  if (x === Infinity) return 'inf';
  if (x === -Infinity) return '-inf';
  if (x === 0) return Object.is(x, -0) ? '-0.0' : '0.0';
  const neg = x < 0;
  const s = Math.abs(x).toExponential(); // shortest digits that round-trip
  const eIdx = s.indexOf('e');
  let mantissa = s.slice(0, eIdx).replace('.', '');
  const E = parseInt(s.slice(eIdx + 1), 10);
  let out;
  if (E >= 16 || E < -4) {
    // Scientific notation, Python style: 1e+16, 1.5e-05
    const m = mantissa.length > 1 ? mantissa[0] + '.' + mantissa.slice(1) : mantissa;
    const absE = Math.abs(E);
    out = m + 'e' + (E < 0 ? '-' : '+') + (absE < 10 ? '0' + absE : String(absE));
  } else if (E >= 0) {
    if (mantissa.length <= E + 1) {
      out = mantissa + '0'.repeat(E + 1 - mantissa.length) + '.0';
    } else {
      out = mantissa.slice(0, E + 1) + '.' + mantissa.slice(E + 1);
    }
  } else {
    out = '0.' + '0'.repeat(-E - 1) + mantissa;
  }
  return neg ? '-' + out : out;
}

// Fixed-point: |x| with `prec` digits after the decimal point, half-even.
export function formatFixedAbs(x, prec) {
  if (!Number.isFinite(x)) return Number.isNaN(x) ? 'nan' : 'inf';
  const scaled = exactScaled(Math.abs(x), prec);
  let digits = scaled.toString();
  if (prec === 0) return digits;
  if (digits.length <= prec) digits = '0'.repeat(prec - digits.length + 1) + digits;
  return digits.slice(0, -prec) + '.' + digits.slice(-prec);
}

// Scientific: |x| as {digits, exp} with `sig` significant digits, half-even.
export function formatSigAbs(x, sig) {
  if (x === 0) return { digits: '0'.repeat(sig), exp: 0 };
  let E = decimalExponent(Math.abs(x));
  let scaled = exactScaled(Math.abs(x), sig - 1 - E);
  let digits = scaled.toString();
  if (digits.length > sig) {
    // Rounding overflowed (e.g. 9.99 -> 10.0): bump exponent.
    E += 1;
    scaled = exactScaled(Math.abs(x), sig - 1 - E);
    digits = scaled.toString();
  }
  if (digits.length < sig) digits = '0'.repeat(sig - digits.length) + digits;
  return { digits, exp: E };
}

// Python round(x) -> integer (BigInt), half-even.
export function roundHalfEvenToInt(x) {
  const n = exactScaled(Math.abs(x), 0);
  return x < 0 ? -n : n;
}

// Python round(x, ndigits) -> float.
export function roundToDigits(x, ndigits) {
  if (!Number.isFinite(x)) return x;
  if (x === 0) return x;
  // Large ndigits: value unchanged.
  if (ndigits >= 323) return x;
  if (ndigits <= -309) return x < 0 ? -0 : 0;
  const n = exactScaled(Math.abs(x), ndigits);
  let result;
  if (ndigits >= 0) {
    result = Number(n) / Math.pow(10, ndigits);
    // Use string parse for better correctness on the division.
    const ds = n.toString();
    if (ndigits === 0) result = Number(ds);
    else if (ds.length <= ndigits) {
      result = Number('0.' + '0'.repeat(ndigits - ds.length) + ds);
    } else {
      result = Number(ds.slice(0, -ndigits) + '.' + ds.slice(-ndigits));
    }
  } else {
    result = Number(n.toString() + '0'.repeat(-ndigits));
  }
  return x < 0 ? -result : result;
}

// Insert grouping separators into the integer digit string.
export function groupDigits(intDigits, sep, groupSize = 3) {
  let out = '';
  let count = 0;
  for (let i = intDigits.length - 1; i >= 0; i--) {
    out = intDigits[i] + out;
    count++;
    if (count % groupSize === 0 && i > 0) out = sep + out;
  }
  return out;
}
