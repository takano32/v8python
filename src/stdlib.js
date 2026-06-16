// Standard library modules for v8python.
//
// ===========================================================================
// VALUE REPRESENTATION CONVENTIONS (read before adding a module)
// ===========================================================================
//   Python int   -> JS BigInt        (e.g. 3n)
//   Python float -> JS number        (e.g. 3.0)
//   Python str   -> JS string
//   Python bool  -> JS boolean
//   Python None  -> NONE sentinel
//   list  -> new PyList([...])        (.items is the JS array)
//   tuple -> new PyTuple([...])       (.items is the JS array)
//   dict  -> new PyDict()             (.set(k,v) / .get(k) / .has(k) / .entries() / .size)
//   set   -> new PySet()              (.add(k) / .has(k) / .keys() / .size)
//
//   A builtin callable is `new PyBuiltin('name', (args, kwargs) => value)`:
//     - args   : JS array of positional argument values
//     - kwargs : Map<string, value> | null
//     - MUST return a value; return NONE if there is nothing to return.
//   Raise a Python exception with: raiseError('ValueError', 'message')
//   Call a Python callable with:   pyCall(callable, [arg1, arg2], kwargsMapOrNull)
//
//   Everything is imported from './objects.js'. builtins.js may also be
//   imported (IO, strFormat, pySortInPlace). NEVER import './interp.js'
//   here — that would create a circular dependency (interp imports us).
// ===========================================================================

import {
  NONE, NOT_IMPLEMENTED, DONE,
  PyList, PyTuple, PyDict, PySet, PyBuiltin, PyModule, PyType, PyInstance,
  PyProperty, PyIterator, PyError, PyFunction, PyBoundMethod,
  PyClassMethod, PyStaticMethod,
  TYPE_OBJECT, TYPE_DICT, EXC,
  raiseError, pyCall, numToBigInt, bigIntToNumber, iterToArray, pyTruthy,
  pyEq, pyStr, pyRepr, typeOf, unwrap, isNum, hashKey, richCompare,
  binOp, unaryOp, getItem, getAttr, setAttr, mroLookup, bindClassAttr,
  keyErrorExc, pyIter, pyContains,
} from './objects.js';
import { floatRepr } from './fmt.js';
import { IO, strFormat } from './builtins.js';

// ---------- helpers ----------

export const STDLIB = new Map();

function reg(name, builder) { STDLIB.set(name, builder); }

function mkmod(name, entries) {
  const m = new PyModule(name);
  for (const [k, v] of Object.entries(entries)) m.attrs.set(k, v);
  return m;
}

function bfn(name, f) { return new PyBuiltin(name, f); }

// Coerce a Python numeric value to a JS number (float context).
export function asFloat(v) {
  if (typeof v === 'number') return v;
  if (typeof v === 'bigint') return bigIntToNumber(v);
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v instanceof PyInstance) {
    const r = unwrap(v);
    if (typeof r === 'number') return r;
    if (typeof r === 'bigint') return bigIntToNumber(r);
  }
  raiseError('TypeError', `must be real number, not ${typeOf(v).name}`);
}

function getKw(kwargs, name, dflt) {
  if (kwargs && kwargs.has(name)) return kwargs.get(name);
  return dflt;
}

// ---------- typing (stub) ----------

reg('typing', () => {
  // Dummy generic-alias-friendly placeholders. Using TYPE_OBJECT lets
  // subscription like List[int] work (objects.js getItem passes PyType through).
  const names = [
    'List', 'Dict', 'Set', 'FrozenSet', 'Tuple', 'Type', 'Optional', 'Union',
    'Any', 'Callable', 'Iterator', 'Iterable', 'Sequence', 'Mapping',
    'MutableMapping', 'MutableSequence', 'Generator', 'Coroutine', 'Awaitable',
    'NamedTuple', 'TypedDict', 'Protocol', 'Generic', 'ClassVar', 'Final',
    'Annotated', 'Literal', 'NoReturn', 'Hashable', 'Sized', 'Container',
    'Collection', 'Reversible', 'AbstractSet', 'ByteString', 'Text', 'IO',
    'TextIO', 'BinaryIO', 'Counter', 'DefaultDict', 'Deque', 'OrderedDict',
  ];
  const entries = {};
  for (const n of names) entries[n] = TYPE_OBJECT;
  entries.TypeVar = bfn('TypeVar', (args) => (args.length ? args[0] : NONE));
  entries.NewType = bfn('NewType', (args) => (args.length > 1 ? args[1] : TYPE_OBJECT));
  entries.cast = bfn('cast', (args) => args[1]);
  entries.get_type_hints = bfn('get_type_hints', () => new PyDict());
  entries.overload = bfn('overload', (args) => args[0]);
  entries.no_type_check = bfn('no_type_check', (args) => args[0]);
  entries.final = bfn('final', (args) => args[0]);
  entries.runtime_checkable = bfn('runtime_checkable', (args) => args[0]);
  entries.TYPE_CHECKING = false;
  return mkmod('typing', entries);
});

// ---------- __future__ (stub) ----------

reg('__future__', () => mkmod('__future__', {
  annotations: NONE,
  division: NONE,
  print_function: NONE,
  unicode_literals: NONE,
  generator_stop: NONE,
}));

// ---------- string ----------

reg('string', () => {
  const lower = 'abcdefghijklmnopqrstuvwxyz';
  const upper = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const digits = '0123456789';
  const punctuation = '!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~';

  // string.Template: $-based substitution ($id, ${id}, $$ escape).
  const Template = new PyType('Template', [TYPE_OBJECT], new Map(), { module: 'string' });
  Template.construct = (args) => {
    const inst = new PyInstance(Template);
    inst.attrs.set('template', unwrap(args[0]));
    return inst;
  };
  const MISSING = Symbol('missing');
  const buildMapping = (args, kwargs) => {
    const m = new Map();
    if (args.length && args[0] !== NONE) {
      const d = unwrap(args[0]);
      if (d instanceof PyDict) {
        for (const [k, v] of d.entries()) if (typeof k === 'string') m.set(k, v);
      }
    }
    if (kwargs) for (const [k, v] of kwargs) m.set(k, v);
    return m;
  };
  const expand = (tmpl, m, safe) => {
    const re = /\$(?:(\$)|\{([_a-zA-Z][_a-zA-Z0-9]*)\}|([_a-zA-Z][_a-zA-Z0-9]*)|(.|$))/g;
    let out = '', last = 0, match;
    while ((match = re.exec(tmpl)) !== null) {
      out += tmpl.slice(last, match.index);
      last = re.lastIndex;
      if (match[1]) { out += '$'; continue; }
      const name = match[2] !== undefined ? match[2] : match[3];
      if (name !== undefined) {
        if (m.has(name)) { out += pyStr(m.get(name)); continue; }
        if (safe) { out += match[0]; continue; }
        raiseError('KeyError', name);
      }
      if (safe) { out += match[0]; continue; }
      raiseError('ValueError', `Invalid placeholder in string: line 1, col ${match.index + 1}`);
    }
    return out + tmpl.slice(last);
  };
  Template.attrs.set('substitute', new PyBuiltin('substitute', (self, args, kwargs) =>
    expand(self.attrs.get('template'), buildMapping(args, kwargs), false), true));
  Template.attrs.set('safe_substitute', new PyBuiltin('safe_substitute', (self, args, kwargs) =>
    expand(self.attrs.get('template'), buildMapping(args, kwargs), true), true));

  // string.Formatter: object form of str.format (format / vformat).
  const Formatter = new PyType('Formatter', [TYPE_OBJECT], new Map(), { module: 'string' });
  Formatter.attrs.set('format', new PyBuiltin('format', (self, args, kwargs) =>
    strFormat(unwrap(args[0]), args.slice(1), kwargs), true));
  Formatter.attrs.set('vformat', new PyBuiltin('vformat', (self, args) => {
    const posArgs = iterToArray(args[1]);
    const kw = new Map();
    const m = unwrap(args[2]);
    if (m instanceof PyDict) for (const [k, v] of m.entries()) if (typeof k === 'string') kw.set(k, v);
    return strFormat(unwrap(args[0]), posArgs, kw);
  }, true));

  return mkmod('string', {
    Template,
    Formatter,
    ascii_lowercase: lower,
    ascii_uppercase: upper,
    ascii_letters: lower + upper,
    digits,
    hexdigits: digits + 'abcdefABCDEF',
    octdigits: '01234567',
    punctuation,
    whitespace: ' \t\n\r\x0b\x0c',
    printable: digits + lower + upper + punctuation + ' \t\n\r\x0b\x0c',
    capwords: bfn('capwords', (args) => {
      const s = unwrap(args[0]);
      const sep = args.length > 1 && args[1] !== NONE ? unwrap(args[1]) : null;
      if (sep === null) {
        return s.split(/\s+/).filter((w) => w.length).map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
      }
      return s.split(sep).map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(sep);
    }),
  });
});

// ---------- operator ----------

reg('operator', () => {
  const binWrap = (name, op) => bfn(name, (args) => binOp(op, args[0], args[1]));
  const cmpWrap = (name, op) => bfn(name, (args) => richCompare(op, args[0], args[1]));
  const entries = {
    add: binWrap('add', '+'),
    sub: binWrap('sub', '-'),
    mul: binWrap('mul', '*'),
    truediv: binWrap('truediv', '/'),
    floordiv: binWrap('floordiv', '//'),
    mod: binWrap('mod', '%'),
    pow: binWrap('pow', '**'),
    matmul: binWrap('matmul', '@'),
    lshift: binWrap('lshift', '<<'),
    rshift: binWrap('rshift', '>>'),
    and_: binWrap('and_', '&'),
    or_: binWrap('or_', '|'),
    xor: binWrap('xor', '^'),
    neg: bfn('neg', (args) => unaryOp('-', args[0])),
    pos: bfn('pos', (args) => unaryOp('+', args[0])),
    invert: bfn('invert', (args) => unaryOp('~', args[0])),
    not_: bfn('not_', (args) => !pyTruthy(args[0])),
    truth: bfn('truth', (args) => pyTruthy(args[0])),
    lt: cmpWrap('lt', '<'),
    le: cmpWrap('le', '<='),
    gt: cmpWrap('gt', '>'),
    ge: cmpWrap('ge', '>='),
    eq: bfn('eq', (args) => pyEq(args[0], args[1])),
    ne: bfn('ne', (args) => !pyEq(args[0], args[1])),
    contains: bfn('contains', (args) => pyContains(args[1], args[0])),
    getitem: bfn('getitem', (args) => getItem(args[0], args[1])),
    concat: binWrap('concat', '+'),
    index: bfn('index', (args) => numToBigInt(args[0])),
    abs: bfn('abs', (args) => {
      const v = unwrap(args[0]);
      if (typeof v === 'bigint') return v < 0n ? -v : v;
      return Math.abs(asFloat(args[0]));
    }),
    itemgetter: bfn('itemgetter', (args) => {
      const keys = args.slice();
      if (keys.length === 1) {
        return bfn('itemgetter', (a) => getItem(a[0], keys[0]));
      }
      return bfn('itemgetter', (a) => new PyTuple(keys.map((k) => getItem(a[0], k))));
    }),
    attrgetter: bfn('attrgetter', (args) => {
      const names = args.map((a) => unwrap(a));
      const getOne = (obj, dotted) => {
        let v = obj;
        for (const part of dotted.split('.')) v = getAttr(v, part);
        return v;
      };
      if (names.length === 1) {
        return bfn('attrgetter', (a) => getOne(a[0], names[0]));
      }
      return bfn('attrgetter', (a) => new PyTuple(names.map((n) => getOne(a[0], n))));
    }),
    methodcaller: bfn('methodcaller', (args, kwargs) => {
      const mname = unwrap(args[0]);
      const extra = args.slice(1);
      const kw = kwargs ? new Map(kwargs) : null;
      return bfn('methodcaller', (a) => pyCall(getAttr(a[0], mname), extra, kw));
    }),
  };
  return mkmod('operator', entries);
});

// ---------- math ----------

function asInt(v, who = 'math') {
  if (typeof v === 'bigint') return v;
  if (typeof v === 'boolean') return v ? 1n : 0n;
  if (v instanceof PyInstance) {
    const r = unwrap(v);
    if (typeof r === 'bigint') return r;
  }
  return numToBigInt(v);
}

function bigAbs(n) { return n < 0n ? -n : n; }

function bigGcd(a, b) {
  a = bigAbs(a); b = bigAbs(b);
  while (b) { [a, b] = [b, a % b]; }
  return a;
}

reg('math', () => {
  const domainErr = () => raiseError('ValueError', 'math domain error');
  const f1 = (name, fn) => bfn(name, (args) => fn(asFloat(args[0])));

  const entries = {
    pi: Math.PI,
    e: Math.E,
    tau: 2 * Math.PI,
    inf: Infinity,
    nan: NaN,

    sqrt: bfn('sqrt', (args) => { const x = asFloat(args[0]); if (x < 0) domainErr(); return Math.sqrt(x); }),
    floor: bfn('floor', (args) => {
      const v = args[0];
      if (typeof unwrap(v) === 'bigint') return unwrap(v);
      const x = asFloat(v);
      if (!Number.isFinite(x)) raiseError(Number.isNaN(x) ? 'ValueError' : 'OverflowError', 'cannot convert float ' + (Number.isNaN(x) ? 'NaN' : 'infinity') + ' to integer');
      return BigInt(Math.floor(x));
    }),
    ceil: bfn('ceil', (args) => {
      const v = args[0];
      if (typeof unwrap(v) === 'bigint') return unwrap(v);
      const x = asFloat(v);
      if (!Number.isFinite(x)) raiseError(Number.isNaN(x) ? 'ValueError' : 'OverflowError', 'cannot convert float ' + (Number.isNaN(x) ? 'NaN' : 'infinity') + ' to integer');
      return BigInt(Math.ceil(x));
    }),
    trunc: bfn('trunc', (args) => {
      const v = args[0];
      if (typeof unwrap(v) === 'bigint') return unwrap(v);
      const x = asFloat(v);
      if (!Number.isFinite(x)) raiseError(Number.isNaN(x) ? 'ValueError' : 'OverflowError', 'cannot convert float to integer');
      return BigInt(Math.trunc(x));
    }),

    sin: f1('sin', Math.sin),
    cos: f1('cos', Math.cos),
    tan: f1('tan', Math.tan),
    asin: bfn('asin', (args) => { const x = asFloat(args[0]); if (x < -1 || x > 1) domainErr(); return Math.asin(x); }),
    acos: bfn('acos', (args) => { const x = asFloat(args[0]); if (x < -1 || x > 1) domainErr(); return Math.acos(x); }),
    atan: f1('atan', Math.atan),
    atan2: bfn('atan2', (args) => Math.atan2(asFloat(args[0]), asFloat(args[1]))),
    sinh: f1('sinh', Math.sinh),
    cosh: f1('cosh', Math.cosh),
    tanh: f1('tanh', Math.tanh),
    asinh: f1('asinh', Math.asinh),
    acosh: bfn('acosh', (args) => { const x = asFloat(args[0]); if (x < 1) domainErr(); return Math.acosh(x); }),
    atanh: bfn('atanh', (args) => { const x = asFloat(args[0]); if (x <= -1 || x >= 1) domainErr(); return Math.atanh(x); }),
    exp: f1('exp', Math.exp),
    exp2: bfn('exp2', (args) => Math.pow(2, asFloat(args[0]))),
    expm1: f1('expm1', Math.expm1),
    log: bfn('log', (args) => {
      const x = asFloat(args[0]);
      if (x <= 0) domainErr();
      if (args.length > 1) {
        const base = asFloat(args[1]);
        if (base <= 0) domainErr();
        return Math.log(x) / Math.log(base);
      }
      return Math.log(x);
    }),
    log2: bfn('log2', (args) => { const x = asFloat(args[0]); if (x <= 0) domainErr(); return Math.log2(x); }),
    log10: bfn('log10', (args) => { const x = asFloat(args[0]); if (x <= 0) domainErr(); return Math.log10(x); }),
    log1p: bfn('log1p', (args) => { const x = asFloat(args[0]); if (x <= -1) domainErr(); return Math.log1p(x); }),
    fabs: bfn('fabs', (args) => Math.abs(asFloat(args[0]))),
    hypot: bfn('hypot', (args) => Math.hypot(...args.map(asFloat))),
    degrees: bfn('degrees', (args) => asFloat(args[0]) * 180 / Math.PI),
    radians: bfn('radians', (args) => asFloat(args[0]) * Math.PI / 180),
    copysign: bfn('copysign', (args) => {
      const x = asFloat(args[0]); const y = asFloat(args[1]);
      const sign = (y < 0 || Object.is(y, -0)) ? -1 : 1;
      return sign * Math.abs(x);
    }),
    fmod: bfn('fmod', (args) => {
      const x = asFloat(args[0]); const y = asFloat(args[1]);
      if (y === 0) raiseError('ValueError', 'math domain error');
      return x % y;
    }),
    nextafter: bfn('nextafter', (args) => {
      const x = asFloat(args[0]); const y = asFloat(args[1]);
      if (Number.isNaN(x) || Number.isNaN(y)) return NaN;
      if (x === y) return y;
      if (x === 0) return y > 0 ? Number.MIN_VALUE : -Number.MIN_VALUE;
      const buf = new DataView(new ArrayBuffer(8));
      buf.setFloat64(0, x);
      let bits = buf.getBigUint64(0);
      bits += (x < y) === (x > 0) ? 1n : -1n;
      buf.setBigUint64(0, bits);
      return buf.getFloat64(0);
    }),
    ulp: bfn('ulp', (args) => {
      const x = Math.abs(asFloat(args[0]));
      if (Number.isNaN(x) || !Number.isFinite(x)) return x;
      if (x === 0) return Number.MIN_VALUE;
      const buf = new DataView(new ArrayBuffer(8));
      buf.setFloat64(0, x);
      buf.setBigUint64(0, buf.getBigUint64(0) + 1n);
      return buf.getFloat64(0) - x;
    }),
    remainder: bfn('remainder', (args) => {
      const x = asFloat(args[0]); const y = asFloat(args[1]);
      if (y === 0 || !Number.isFinite(x)) { if (Number.isNaN(x) || Number.isNaN(y)) return NaN; raiseError('ValueError', 'math domain error'); }
      const r = x - Math.round(x / y) * y;
      return r;
    }),
    isnan: bfn('isnan', (args) => Number.isNaN(asFloat(args[0]))),
    isinf: bfn('isinf', (args) => { const x = asFloat(args[0]); return x === Infinity || x === -Infinity; }),
    isfinite: bfn('isfinite', (args) => Number.isFinite(asFloat(args[0]))),
    isclose: bfn('isclose', (args, kwargs) => {
      const a = asFloat(args[0]); const b = asFloat(args[1]);
      const relTol = asFloat(getKw(kwargs, 'rel_tol', 1e-9));
      const absTol = asFloat(getKw(kwargs, 'abs_tol', 0.0));
      if (a === b) return true;
      if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
      return Math.abs(a - b) <= Math.max(relTol * Math.max(Math.abs(a), Math.abs(b)), absTol);
    }),
    gcd: bfn('gcd', (args) => {
      if (args.length === 0) return 0n;
      let g = asInt(args[0]);
      for (let i = 1; i < args.length; i++) g = bigGcd(g, asInt(args[i]));
      return bigAbs(g);
    }),
    lcm: bfn('lcm', (args) => {
      if (args.length === 0) return 1n;
      let l = bigAbs(asInt(args[0]));
      for (let i = 1; i < args.length; i++) {
        const n = bigAbs(asInt(args[i]));
        if (l === 0n || n === 0n) { l = 0n; continue; }
        l = (l / bigGcd(l, n)) * n;
      }
      return l;
    }),
    factorial: bfn('factorial', (args) => {
      const v = args[0];
      if (typeof unwrap(v) === 'number' && !Number.isInteger(unwrap(v))) {
        raiseError('ValueError', 'factorial() only accepts integral values');
      }
      const n = asInt(v);
      if (n < 0n) raiseError('ValueError', 'factorial() not defined for negative values');
      let r = 1n;
      for (let i = 2n; i <= n; i++) r *= i;
      return r;
    }),
    comb: bfn('comb', (args) => {
      let n = asInt(args[0]); let k = asInt(args[1]);
      if (n < 0n || k < 0n) raiseError('ValueError', 'n and k must be non-negative integers');
      if (k > n) return 0n;
      if (k > n - k) k = n - k;
      let num = 1n, den = 1n;
      for (let i = 0n; i < k; i++) { num *= (n - i); den *= (i + 1n); }
      return num / den;
    }),
    perm: bfn('perm', (args) => {
      const n = asInt(args[0]);
      const k = args.length > 1 && args[1] !== NONE ? asInt(args[1]) : n;
      if (n < 0n || k < 0n) raiseError('ValueError', 'n and k must be non-negative integers');
      if (k > n) return 0n;
      let r = 1n;
      for (let i = 0n; i < k; i++) r *= (n - i);
      return r;
    }),
    pow: bfn('pow', (args) => {
      const x = asFloat(args[0]); const y = asFloat(args[1]);
      if (x === 0 && y < 0) raiseError('ValueError', 'math domain error');
      if (x < 0 && !Number.isInteger(y) && Number.isFinite(y)) raiseError('ValueError', 'math domain error');
      return Math.pow(x, y);
    }),
    dist: bfn('dist', (args) => {
      const p = iterToArray(args[0]).map(asFloat);
      const q = iterToArray(args[1]).map(asFloat);
      if (p.length !== q.length) raiseError('ValueError', 'both points must have the same number of dimensions');
      let s = 0;
      for (let i = 0; i < p.length; i++) { const d = p[i] - q[i]; s += d * d; }
      return Math.sqrt(s);
    }),
    prod: bfn('prod', (args, kwargs) => {
      let acc = getKw(kwargs, 'start', 1n);
      for (const x of iterToArray(args[0])) acc = binOp('*', acc, x);
      return acc;
    }),
    fsum: bfn('fsum', (args) => {
      // Neumaier summation for improved accuracy.
      let sum = 0, c = 0;
      for (const x of iterToArray(args[0])) {
        const v = asFloat(x);
        const t = sum + v;
        if (Math.abs(sum) >= Math.abs(v)) c += (sum - t) + v;
        else c += (v - t) + sum;
        sum = t;
      }
      return sum + c;
    }),
    modf: bfn('modf', (args) => {
      const x = asFloat(args[0]);
      const intPart = Math.trunc(x);
      return new PyTuple([x - intPart, intPart]);
    }),
    ldexp: bfn('ldexp', (args) => asFloat(args[0]) * Math.pow(2, Number(asInt(args[1])))),
    frexp: bfn('frexp', (args) => {
      let x = asFloat(args[0]);
      if (x === 0 || !Number.isFinite(x)) return new PyTuple([x, 0n]);
      const sign = x < 0 ? -1 : 1; x = Math.abs(x);
      let exp = Math.ceil(Math.log2(x));
      let m = x / Math.pow(2, exp);
      while (m >= 1) { m /= 2; exp += 1; }
      while (m < 0.5) { m *= 2; exp -= 1; }
      return new PyTuple([sign * m, BigInt(exp)]);
    }),
    gamma: bfn('gamma', (args) => gammaFn(asFloat(args[0]))),
    lgamma: bfn('lgamma', (args) => Math.log(Math.abs(gammaFn(asFloat(args[0]))))),
    isqrt: bfn('isqrt', (args) => {
      const n = asInt(args[0]);
      if (n < 0n) raiseError('ValueError', 'isqrt() argument must be nonnegative');
      if (n < 2n) return n;
      let x = n, y = (x + 1n) / 2n;
      while (y < x) { x = y; y = (x + n / x) / 2n; }
      return x;
    }),
  };
  return mkmod('math', entries);
});

function gammaFn(x) {
  // Lanczos approximation.
  const g = 7;
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (x < 0.5) return Math.PI / (Math.sin(Math.PI * x) * gammaFn(1 - x));
  x -= 1;
  let a = c[0];
  const t = x + g + 0.5;
  for (let i = 1; i < g + 2; i++) a += c[i] / (x + i);
  return Math.sqrt(2 * Math.PI) * Math.pow(t, x + 0.5) * Math.exp(-t) * a;
}

// ---------- sys ----------

function makeStdStream(name, writeFn) {
  const s = new PyModule(name);
  s.attrs.set('write', bfn('write', (args) => {
    const str = unwrap(args[0]);
    if (typeof str !== 'string') raiseError('TypeError', `write() argument must be str, not ${typeOf(args[0]).name}`);
    writeFn(str);
    return BigInt([...str].length);
  }));
  s.attrs.set('writelines', bfn('writelines', (args) => {
    for (const line of iterToArray(args[0])) writeFn(unwrap(line));
    return NONE;
  }));
  s.attrs.set('flush', bfn('flush', () => NONE));
  s.attrs.set('isatty', bfn('isatty', () => false));
  s.attrs.set('fileno', bfn('fileno', () => (name === 'stderr' ? 2n : name === 'stdin' ? 0n : 1n)));
  s.isStderr = name === 'stderr';
  return s;
}

reg('sys', (env) => {
  const exitFn = bfn('exit', (args) => {
    const inst = new PyInstance(EXC.SystemExit);
    inst.attrs.set('args', new PyTuple(args.length ? [args[0]] : []));
    inst.attrs.set('code', args.length ? args[0] : NONE);
    throw new PyError(inst);
  });
  const stdin = new PyModule('stdin');
  stdin.attrs.set('readline', bfn('readline', () => {
    if (!IO.readLine) raiseError('RuntimeError', 'stdin is not available');
    const line = IO.readLine();
    return line === null ? '' : line;
  }));
  stdin.attrs.set('read', bfn('read', () => {
    if (!IO.readLine) raiseError('RuntimeError', 'stdin is not available');
    let out = '';
    for (;;) { const l = IO.readLine(); if (l === null) break; out += l; }
    return out;
  }));
  stdin.attrs.set('isatty', bfn('isatty', () => false));

  let recursionLimit = 1000n;
  return mkmod('sys', {
    argv: new PyList((env.argv || ['<stdin>']).map(String)),
    version: (env.version || '3.12.0') + ' (v8python)',
    version_info: new PyTuple([3n, 12n, 0n, 'final', 0n]),
    hexversion: 0x30c00f0n,
    maxsize: 9223372036854775807n,
    maxunicode: 1114111n,
    platform: 'v8',
    byteorder: 'little',
    executable: 'v8python',
    prefix: '/usr',
    exit: exitFn,
    stdout: makeStdStream('stdout', (s) => IO.write(s)),
    stderr: makeStdStream('stderr', (s) => IO.writeErr(s)),
    stdin,
    modules: new PyDict(),
    path: new PyList(['']),
    builtin_module_names: new PyTuple([...STDLIB.keys()].map(String)),
    setrecursionlimit: bfn('setrecursionlimit', (args) => { recursionLimit = numToBigInt(args[0]); return NONE; }),
    getrecursionlimit: bfn('getrecursionlimit', () => recursionLimit),
    getsizeof: bfn('getsizeof', () => 64n),
    intern: bfn('intern', (args) => args[0]),
    is_finalizing: bfn('is_finalizing', () => false),
    getrefcount: bfn('getrefcount', () => 1n),
    flags: mkmod('flags', { debug: 0n, optimize: 0n, interactive: 0n }),
    dont_write_bytecode: true,
  });
});

// ---------- time ----------

reg('time', () => {
  const sleepFn = bfn('sleep', (args) => {
    const secs = asFloat(args[0]);
    if (secs <= 0) return NONE;
    const ms = Math.floor(secs * 1000);
    try {
      const sab = new Int32Array(new SharedArrayBuffer(4));
      Atomics.wait(sab, 0, 0, ms);
    } catch (e) {
      const end = Date.now() + ms;
      while (Date.now() < end) { /* busy wait fallback */ }
    }
    return NONE;
  });
  return mkmod('time', {
    time: bfn('time', () => Date.now() / 1000),
    time_ns: bfn('time_ns', () => BigInt(Date.now()) * 1000000n),
    perf_counter: bfn('perf_counter', () => performance.now() / 1000),
    perf_counter_ns: bfn('perf_counter_ns', () => BigInt(Math.round(performance.now() * 1e6))),
    monotonic: bfn('monotonic', () => performance.now() / 1000),
    monotonic_ns: bfn('monotonic_ns', () => BigInt(Math.round(performance.now() * 1e6))),
    process_time: bfn('process_time', () => performance.now() / 1000),
    sleep: sleepFn,
  });
});

// ---------- random ----------

reg('random', () => {
  let state = (Date.now() >>> 0) || 1;
  function next32() {
    state |= 0;
    state = (state + 0x6D2B79F5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  function hashSeed(v) {
    const u = unwrap(v);
    if (typeof u === 'bigint') return Number(((u % 4294967296n) + 4294967296n) % 4294967296n) >>> 0;
    if (typeof u === 'number') return Math.abs(Math.floor(u)) >>> 0;
    if (typeof u === 'string') {
      let h = 2166136261;
      for (let i = 0; i < u.length; i++) { h ^= u.charCodeAt(i); h = Math.imul(h, 16777619); }
      return h >>> 0;
    }
    return (Date.now() >>> 0) || 1;
  }
  // Random integer in [0, n) for BigInt n, via rejection-free scaling (n small enough in practice).
  function randBelow(n) {
    return BigInt(Math.floor(next32() * Number(n)));
  }
  function seqArray(seq) {
    const u = unwrap(seq);
    if (u instanceof PyList || u instanceof PyTuple) return u.items;
    if (typeof u === 'string') return [...u];
    return iterToArray(seq);
  }

  const randint = bfn('randint', (args) => {
    const a = numToBigInt(args[0]); const b = numToBigInt(args[1]);
    if (a > b) raiseError('ValueError', `empty range in randrange(${a}, ${b + 1n})`);
    return a + randBelow(b - a + 1n);
  });

  const randrange = bfn('randrange', (args) => {
    let start, stop, step;
    if (args.length === 1) { start = 0n; stop = numToBigInt(args[0]); step = 1n; }
    else if (args.length === 2) { start = numToBigInt(args[0]); stop = numToBigInt(args[1]); step = 1n; }
    else { start = numToBigInt(args[0]); stop = numToBigInt(args[1]); step = numToBigInt(args[2]); }
    if (step === 0n) raiseError('ValueError', 'zero step for randrange()');
    let width = stop - start;
    let n;
    if (step > 0n) n = (width + step - 1n) / step;
    else n = (width + step + 1n) / step;
    if (n <= 0n) raiseError('ValueError', 'empty range for randrange()');
    return start + step * randBelow(n);
  });

  const choice = bfn('choice', (args) => {
    const arr = seqArray(args[0]);
    if (!arr.length) raiseError('IndexError', 'Cannot choose from an empty sequence');
    return arr[Math.floor(next32() * arr.length)];
  });

  const shuffle = bfn('shuffle', (args) => {
    const u = unwrap(args[0]);
    if (!(u instanceof PyList)) raiseError('TypeError', "'" + typeOf(args[0]).name + "' object does not support item assignment");
    const a = u.items;
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(next32() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return NONE;
  });

  return mkmod('random', {
    seed: bfn('seed', (args) => { state = args.length && args[0] !== NONE ? hashSeed(args[0]) : ((Date.now() >>> 0) || 1); return NONE; }),
    random: bfn('random', () => next32()),
    randint,
    randrange,
    uniform: bfn('uniform', (args) => { const a = asFloat(args[0]); const b = asFloat(args[1]); return a + (b - a) * next32(); }),
    choice,
    choices: bfn('choices', (args, kwargs) => {
      const arr = seqArray(args[0]);
      const k = Number(numToBigInt(getKw(kwargs, 'k', args.length > 1 ? args[1] : 1n)));
      const weights = getKw(kwargs, 'weights', NONE);
      const out = [];
      if (weights !== NONE && weights !== undefined) {
        const w = iterToArray(weights).map(asFloat);
        const cum = []; let s = 0;
        for (const x of w) { s += x; cum.push(s); }
        for (let i = 0; i < k; i++) {
          const r = next32() * s;
          let lo = 0;
          while (lo < cum.length && cum[lo] < r) lo++;
          out.push(arr[Math.min(lo, arr.length - 1)]);
        }
      } else {
        for (let i = 0; i < k; i++) out.push(arr[Math.floor(next32() * arr.length)]);
      }
      return new PyList(out);
    }),
    shuffle,
    sample: bfn('sample', (args) => {
      const arr = seqArray(args[0]).slice();
      const k = Number(numToBigInt(args[1]));
      if (k < 0 || k > arr.length) raiseError('ValueError', 'Sample larger than population or is negative');
      // Partial Fisher-Yates.
      const out = [];
      for (let i = 0; i < k; i++) {
        const j = i + Math.floor(next32() * (arr.length - i));
        [arr[i], arr[j]] = [arr[j], arr[i]];
        out.push(arr[i]);
      }
      return new PyList(out);
    }),
    gauss: bfn('gauss', (args) => {
      const mu = args.length > 0 ? asFloat(args[0]) : 0;
      const sigma = args.length > 1 ? asFloat(args[1]) : 1;
      const u1 = next32() || 1e-12; const u2 = next32();
      const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      return mu + sigma * z;
    }),
    normalvariate: bfn('normalvariate', (args) => {
      const mu = args.length > 0 ? asFloat(args[0]) : 0;
      const sigma = args.length > 1 ? asFloat(args[1]) : 1;
      const u1 = next32() || 1e-12; const u2 = next32();
      const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      return mu + sigma * z;
    }),
    getrandbits: bfn('getrandbits', (args) => {
      const k = Number(numToBigInt(args[0]));
      let result = 0n;
      let remaining = k;
      while (remaining > 0) {
        const take = Math.min(30, remaining);
        const bits = BigInt(Math.floor(next32() * (2 ** take)));
        result = (result << BigInt(take)) | bits;
        remaining -= take;
      }
      return result;
    }),
  });
});

// ---------- functools ----------

function isCallable(v) {
  return v instanceof PyFunction || v instanceof PyBuiltin ||
    v instanceof PyBoundMethod || v instanceof PyType ||
    (v instanceof PyInstance && typeOf(v).mro.some((t) => t.attrs.has('__call__')));
}

function cacheKey(args, kwargs) {
  let key = args.map(hashKey).join('');
  if (kwargs && kwargs.size) {
    const parts = [...kwargs.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
    key += '' + parts.map(([k, v]) => k + '=' + hashKey(v)).join('');
  }
  return key;
}

function makeCached(func) {
  const cache = new Map();
  let hits = 0, misses = 0;
  const wrapper = bfn('wrapper', (args, kwargs) => {
    const key = cacheKey(args, kwargs);
    if (cache.has(key)) { hits++; return cache.get(key); }
    misses++;
    const r = pyCall(func, args, kwargs);
    cache.set(key, r);
    return r;
  });
  wrapper.fn.cacheClear = () => { cache.clear(); hits = 0; misses = 0; };
  // Attach cache_clear / cache_info as attributes via a wrapping that supports getAttr.
  // PyBuiltin has limited attr support; store helpers on a side map consulted nowhere
  // critical — most code only calls the wrapper. Provide cache_clear as a sibling.
  return wrapper;
}

reg('functools', () => {
  const reduce = bfn('reduce', (args) => {
    const func = args[0];
    const items = iterToArray(args[1]);
    let acc; let start = 0;
    if (args.length >= 3) acc = args[2];
    else {
      if (!items.length) raiseError('TypeError', 'reduce() of empty iterable with no initial value');
      acc = items[0]; start = 1;
    }
    for (let i = start; i < items.length; i++) acc = pyCall(func, [acc, items[i]]);
    return acc;
  });

  const partial = bfn('partial', (args, kwargs) => {
    const func = args[0];
    const bound = args.slice(1);
    const boundKw = kwargs ? new Map(kwargs) : null;
    return bfn('partial', (a2, kw2) => {
      const merged = boundKw ? new Map(boundKw) : (kw2 ? new Map() : null);
      if (kw2) {
        const m = merged || new Map();
        for (const [k, v] of kw2) m.set(k, v);
        return pyCall(func, [...bound, ...a2], m);
      }
      return pyCall(func, [...bound, ...a2], merged);
    });
  });

  // functools.update_wrapper / wraps: copy identifying metadata from the
  // wrapped function onto the wrapper, and set __wrapped__.
  const WRAPPER_ASSIGNMENTS = ['__module__', '__name__', '__qualname__', '__annotations__', '__doc__'];
  const updateWrapper = (wrapper, wrapped) => {
    for (const a of WRAPPER_ASSIGNMENTS) {
      try { setAttr(wrapper, a, getAttr(wrapped, a)); }
      catch (e) { if (!(e instanceof PyError)) throw e; }
    }
    try { setAttr(wrapper, '__wrapped__', wrapped); }
    catch (e) { if (!(e instanceof PyError)) throw e; }
    return wrapper;
  };
  const wraps = bfn('wraps', (wargs) => {
    const wrapped = wargs[0];
    return bfn('decorator', (a) => updateWrapper(a[0], wrapped));
  });

  const lruCache = bfn('lru_cache', (args) => {
    // @lru_cache  (arg is the function)
    if (args.length >= 1 && isCallable(args[0])) {
      return makeCached(args[0]);
    }
    // @lru_cache() or @lru_cache(maxsize=128) -> returns a decorator
    return bfn('lru_cache_decorator', (a) => makeCached(a[0]));
  });

  const cache = bfn('cache', (args) => makeCached(args[0]));

  const cmpToKey = bfn('cmp_to_key', (cmpArgs) => {
    const cmpfunc = cmpArgs[0];
    const K = new PyType('K', [TYPE_OBJECT], new Map(), { module: 'functools' });
    const cmpResult = (self, other) => pyCall(cmpfunc, [self.attrs.get('obj'), other.attrs.get('obj')]);
    K.attrs.set('__lt__', new PyBuiltin('__lt__', (self, a) => richCompare('<', cmpResult(self, a[0]), 0n), true));
    K.attrs.set('__gt__', new PyBuiltin('__gt__', (self, a) => richCompare('>', cmpResult(self, a[0]), 0n), true));
    K.attrs.set('__le__', new PyBuiltin('__le__', (self, a) => richCompare('<=', cmpResult(self, a[0]), 0n), true));
    K.attrs.set('__ge__', new PyBuiltin('__ge__', (self, a) => richCompare('>=', cmpResult(self, a[0]), 0n), true));
    K.attrs.set('__eq__', new PyBuiltin('__eq__', (self, a) => pyEq(cmpResult(self, a[0]), 0n), true));
    return bfn('K', (a) => { const inst = new PyInstance(K); inst.attrs.set('obj', a[0]); return inst; });
  });

  // total_ordering: fill in the missing rich-comparison methods from the one
  // (plus __eq__) that the class already defines.
  const ordMethod = (rootName, kind, opname) => new PyBuiltin(opname, (self, a) => {
    const other = a[0];
    const r = pyCall(getAttr(self, rootName), [other]);
    if (r === NOT_IMPLEMENTED) return NOT_IMPLEMENTED;
    const b = pyTruthy(r);
    switch (kind) {
      case 'not': return !b;
      case 'or_eq': return b || pyEq(self, other);
      case 'and_ne': return b && !pyEq(self, other);
      case 'not_and_ne': return !b && !pyEq(self, other);
      case 'not_or_eq': return !b || pyEq(self, other);
      default: return NOT_IMPLEMENTED;
    }
  }, true);
  const ORDER_CONVERT = {
    '__lt__': [['__gt__', 'not_and_ne'], ['__le__', 'or_eq'], ['__ge__', 'not']],
    '__le__': [['__ge__', 'not_or_eq'], ['__lt__', 'and_ne'], ['__gt__', 'not']],
    '__gt__': [['__lt__', 'not_and_ne'], ['__ge__', 'or_eq'], ['__le__', 'not']],
    '__ge__': [['__le__', 'not_or_eq'], ['__gt__', 'and_ne'], ['__lt__', 'not']],
  };
  const totalOrdering = bfn('total_ordering', (targs) => {
    const cls = targs[0];
    const ops = ['__lt__', '__le__', '__gt__', '__ge__'];
    const defined = ops.filter((op) => {
      const hit = mroLookup(cls, op);
      return hit && hit.owner && !hit.owner.builtin;
    });
    if (!defined.length) {
      raiseError('ValueError', 'must define at least one ordering operation: < > <= >=');
    }
    // Prefer __lt__, then __le__, __gt__, __ge__ (CPython picks max() of names).
    const root = defined.slice().sort().pop();
    for (const [opname, kind] of ORDER_CONVERT[root]) {
      if (!defined.includes(opname)) cls.attrs.set(opname, ordMethod(root, kind, opname));
    }
    return cls;
  });

  const reduceMod = mkmod('functools', {
    reduce,
    partial,
    wraps,
    lru_cache: lruCache,
    cache,
    cmp_to_key: cmpToKey,
    update_wrapper: bfn('update_wrapper', (args) => updateWrapper(args[0], args[1])),
    total_ordering: totalOrdering,
  });
  return reduceMod;
});

// ---------- itertools ----------

reg('itertools', () => {
  const count = bfn('count', (args) => {
    let cur = args.length > 0 ? args[0] : 0n;
    const step = args.length > 1 ? args[1] : 1n;
    return new PyIterator(() => { const r = cur; cur = binOp('+', cur, step); return r; }, 'count');
  });

  const cycle = bfn('cycle', (args) => {
    const it = pyIter(args[0]);
    const saved = [];
    let exhausted = false;
    let i = 0;
    return new PyIterator(() => {
      if (!exhausted) {
        const v = it.next();
        if (v !== DONE) { saved.push(v); return v; }
        exhausted = true;
      }
      if (!saved.length) return DONE;
      const r = saved[i];
      i = (i + 1) % saved.length;
      return r;
    }, 'cycle');
  });

  const repeat = bfn('repeat', (args) => {
    const obj = args[0];
    let times = args.length > 1 ? Number(numToBigInt(args[1])) : Infinity;
    return new PyIterator(() => { if (times <= 0) return DONE; times--; return obj; }, 'repeat');
  });

  const chainFn = (iterables) => {
    let idx = 0;
    let cur = iterables.length ? pyIter(iterables[0]) : null;
    return new PyIterator(() => {
      for (;;) {
        if (cur === null) return DONE;
        const v = cur.next();
        if (v !== DONE) return v;
        idx++;
        cur = idx < iterables.length ? pyIter(iterables[idx]) : null;
      }
    }, 'chain');
  };
  const chain = bfn('chain', (args) => chainFn(args));
  chain.attrs = new Map();
  chain.attrs.set('from_iterable', bfn('from_iterable', (args) => {
    const groups = iterToArray(args[0]);
    return chainFn(groups);
  }));

  const islice = bfn('islice', (args) => {
    const it = pyIter(args[0]);
    let start, stop, step;
    if (args.length === 2) { start = 0; stop = args[1] === NONE ? Infinity : Number(numToBigInt(args[1])); step = 1; }
    else {
      start = args[1] === NONE ? 0 : Number(numToBigInt(args[1]));
      stop = args[2] === NONE ? Infinity : Number(numToBigInt(args[2]));
      step = args.length > 3 && args[3] !== NONE ? Number(numToBigInt(args[3])) : 1;
    }
    let idx = 0;
    let nextWanted = start;
    return new PyIterator(() => {
      for (;;) {
        if (idx >= stop) return DONE;
        const v = it.next();
        if (v === DONE) return DONE;
        const cur = idx;
        idx++;
        if (cur === nextWanted) { nextWanted += step; return v; }
        if (cur >= stop) return DONE;
      }
    }, 'islice');
  });

  const product = bfn('product', (args, kwargs) => {
    const repeatN = Number(numToBigInt(getKw(kwargs, 'repeat', 1n)));
    let pools = args.map((a) => iterToArray(a));
    const allPools = [];
    for (let r = 0; r < repeatN; r++) for (const p of pools) allPools.push(p);
    let result = [[]];
    for (const pool of allPools) {
      const next = [];
      for (const combo of result) for (const item of pool) next.push([...combo, item]);
      result = next;
    }
    let i = 0;
    return new PyIterator(() => (i < result.length ? new PyTuple(result[i++]) : DONE), 'product');
  });

  function* combosGen(arr, r, withRepl) {
    const n = arr.length;
    if (r > n && !withRepl) return;
    const indices = [];
    for (let i = 0; i < r; i++) indices.push(withRepl ? 0 : i);
    while (true) {
      yield indices.map((i) => arr[i]);
      let i = r - 1;
      if (withRepl) {
        while (i >= 0 && indices[i] === n - 1) i--;
        if (i < 0) return;
        const v = indices[i] + 1;
        for (let j = i; j < r; j++) indices[j] = v;
      } else {
        while (i >= 0 && indices[i] === i + n - r) i--;
        if (i < 0) return;
        indices[i]++;
        for (let j = i + 1; j < r; j++) indices[j] = indices[j - 1] + 1;
      }
    }
  }

  function* permsGen(arr, r) {
    const n = arr.length;
    if (r > n) return;
    const indices = []; for (let i = 0; i < n; i++) indices.push(i);
    const cycles = []; for (let i = n; i > n - r; i--) cycles.push(i);
    yield indices.slice(0, r).map((i) => arr[i]);
    if (r === 0) return;
    while (true) {
      let i = r - 1;
      for (; i >= 0; i--) {
        cycles[i]--;
        if (cycles[i] === 0) {
          const first = indices[i];
          for (let j = i; j < n - 1; j++) indices[j] = indices[j + 1];
          indices[n - 1] = first;
          cycles[i] = n - i;
        } else {
          const j = n - cycles[i];
          [indices[i], indices[j]] = [indices[j], indices[i]];
          yield indices.slice(0, r).map((k) => arr[k]);
          break;
        }
      }
      if (i < 0) return;
    }
  }

  const genToIter = (gen, name) => new PyIterator(() => {
    const r = gen.next();
    return r.done ? DONE : new PyTuple(r.value);
  }, name);

  const permutations = bfn('permutations', (args) => {
    const arr = iterToArray(args[0]);
    const r = args.length > 1 && args[1] !== NONE ? Number(numToBigInt(args[1])) : arr.length;
    return genToIter(permsGen(arr, r), 'permutations');
  });
  const combinations = bfn('combinations', (args) => {
    const arr = iterToArray(args[0]);
    const r = Number(numToBigInt(args[1]));
    return genToIter(combosGen(arr, r, false), 'combinations');
  });
  const combinationsWR = bfn('combinations_with_replacement', (args) => {
    const arr = iterToArray(args[0]);
    const r = Number(numToBigInt(args[1]));
    return genToIter(combosGen(arr, r, true), 'combinations_with_replacement');
  });

  const accumulate = bfn('accumulate', (args, kwargs) => {
    const it = pyIter(args[0]);
    const func = args.length > 1 && args[1] !== NONE ? args[1] : null;
    const initial = getKw(kwargs, 'initial', NONE);
    let acc;
    let started = false;
    let emittedInitial = false;
    const hasInitial = initial !== NONE && initial !== undefined;
    if (hasInitial) acc = initial;
    return new PyIterator(() => {
      if (hasInitial && !emittedInitial) { emittedInitial = true; return acc; }
      const v = it.next();
      if (v === DONE) return DONE;
      if (!started && !hasInitial) { started = true; acc = v; return acc; }
      acc = func ? pyCall(func, [acc, v]) : binOp('+', acc, v);
      return acc;
    }, 'accumulate');
  });

  const zipLongest = bfn('zip_longest', (args, kwargs) => {
    const fill = getKw(kwargs, 'fillvalue', NONE);
    const iters = args.map(pyIter);
    return new PyIterator(() => {
      if (!iters.length) return DONE;
      const row = [];
      let allDone = true;
      for (const it of iters) {
        const v = it.next();
        if (v === DONE) row.push(fill);
        else { allDone = false; row.push(v); }
      }
      return allDone ? DONE : new PyTuple(row);
    }, 'zip_longest');
  });

  const groupby = bfn('groupby', (args, kwargs) => {
    const arr = iterToArray(args[0]);
    const keyArg = args.length > 1 ? args[1] : getKw(kwargs, 'key', NONE);
    const keyFn = keyArg !== NONE && keyArg !== undefined ? keyArg : null;
    const keyed = arr.map((x) => [keyFn ? pyCall(keyFn, [x]) : x, x]);
    let i = 0;
    return new PyIterator(() => {
      if (i >= keyed.length) return DONE;
      const curKey = keyed[i][0];
      const group = [];
      while (i < keyed.length && pyEq(keyed[i][0], curKey)) { group.push(keyed[i][1]); i++; }
      let j = 0;
      const groupIter = new PyIterator(() => (j < group.length ? group[j++] : DONE), '_grouper');
      return new PyTuple([curKey, groupIter]);
    }, 'groupby');
  });

  const starmap = bfn('starmap', (args) => {
    const func = args[0];
    const it = pyIter(args[1]);
    return new PyIterator(() => {
      const v = it.next();
      if (v === DONE) return DONE;
      return pyCall(func, iterToArray(v));
    }, 'starmap');
  });

  const takewhile = bfn('takewhile', (args) => {
    const pred = args[0];
    const it = pyIter(args[1]);
    let done = false;
    return new PyIterator(() => {
      if (done) return DONE;
      const v = it.next();
      if (v === DONE) { done = true; return DONE; }
      if (pyTruthy(pyCall(pred, [v]))) return v;
      done = true; return DONE;
    }, 'takewhile');
  });

  const dropwhile = bfn('dropwhile', (args) => {
    const pred = args[0];
    const it = pyIter(args[1]);
    let dropping = true;
    return new PyIterator(() => {
      for (;;) {
        const v = it.next();
        if (v === DONE) return DONE;
        if (dropping && pyTruthy(pyCall(pred, [v]))) continue;
        dropping = false;
        return v;
      }
    }, 'dropwhile');
  });

  const filterfalse = bfn('filterfalse', (args) => {
    const pred = args[0];
    const it = pyIter(args[1]);
    return new PyIterator(() => {
      for (;;) {
        const v = it.next();
        if (v === DONE) return DONE;
        const keep = pred === NONE ? !pyTruthy(v) : !pyTruthy(pyCall(pred, [v]));
        if (keep) return v;
      }
    }, 'filterfalse');
  });

  const pairwise = bfn('pairwise', (args) => {
    const it = pyIter(args[0]);
    let prev = it.next();
    return new PyIterator(() => {
      if (prev === DONE) return DONE;
      const cur = it.next();
      if (cur === DONE) { prev = DONE; return DONE; }
      const r = new PyTuple([prev, cur]);
      prev = cur;
      return r;
    }, 'pairwise');
  });

  const compress = bfn('compress', (args) => {
    const data = pyIter(args[0]);
    const sel = pyIter(args[1]);
    return new PyIterator(() => {
      for (;;) {
        const d = data.next();
        const s = sel.next();
        if (d === DONE || s === DONE) return DONE;
        if (pyTruthy(s)) return d;
      }
    }, 'compress');
  });

  const tee = bfn('tee', (args) => {
    const it = pyIter(args[0]);
    const n = args.length > 1 ? Number(numToBigInt(args[1])) : 2;
    const buf = [];
    let exhausted = false;
    const reader = () => {
      let i = 0;
      return new PyIterator(() => {
        if (i >= buf.length) {
          if (exhausted) return DONE;
          const v = it.next();
          if (v === DONE) { exhausted = true; return DONE; }
          buf.push(v);
        }
        return buf[i++];
      }, 'tee');
    };
    const out = [];
    for (let k = 0; k < n; k++) out.push(reader());
    return new PyTuple(out);
  });

  return mkmod('itertools', {
    count, cycle, repeat, chain, islice, product,
    permutations, combinations, combinations_with_replacement: combinationsWR,
    accumulate, zip_longest: zipLongest, groupby, starmap,
    takewhile, dropwhile, filterfalse, pairwise, compress, tee,
  });
});

// ---------- json ----------

function jsonEscape(s, ensureAscii) {
  let out = '"';
  for (const ch of s) {
    const code = ch.codePointAt(0);
    switch (ch) {
      case '"': out += '\\"'; break;
      case '\\': out += '\\\\'; break;
      case '\n': out += '\\n'; break;
      case '\t': out += '\\t'; break;
      case '\r': out += '\\r'; break;
      case '\b': out += '\\b'; break;
      case '\f': out += '\\f'; break;
      default:
        if (code < 0x20) {
          out += '\\u' + code.toString(16).padStart(4, '0');
        } else if (ensureAscii && code > 0x7e) {
          if (code > 0xffff) {
            const c = code - 0x10000;
            const hi = 0xd800 + (c >> 10);
            const lo = 0xdc00 + (c & 0x3ff);
            out += '\\u' + hi.toString(16).padStart(4, '0') + '\\u' + lo.toString(16).padStart(4, '0');
          } else {
            out += '\\u' + code.toString(16).padStart(4, '0');
          }
        } else {
          out += ch;
        }
    }
  }
  return out + '"';
}

function jsonNumberStr(v) {
  if (typeof v === 'bigint') return v.toString();
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  // float
  if (Number.isNaN(v)) return 'NaN';
  if (v === Infinity) return 'Infinity';
  if (v === -Infinity) return '-Infinity';
  return floatRepr(v);
}

function jsonDumps(obj, opts) {
  const { indent, sortKeys, itemSep, kvSep, ensureAscii, defaultFn } = opts;
  const seen = new Set();

  function ser(v, depth) {
    if (v === NONE) return 'null';
    if (typeof v === 'boolean') return v ? 'true' : 'false';
    if (typeof v === 'bigint') return v.toString();
    if (typeof v === 'number') return jsonNumberStr(v);
    if (typeof v === 'string') return jsonEscape(v, ensureAscii);

    const u = unwrap(v);
    if (u instanceof PyList || u instanceof PyTuple) {
      if (seen.has(u)) raiseError('ValueError', 'Circular reference detected');
      if (!u.items.length) return '[]';
      seen.add(u);
      const parts = u.items.map((x) => ser(x, depth + 1));
      seen.delete(u);
      return wrapItems(parts, '[', ']', depth);
    }
    if (u instanceof PyDict) {
      if (seen.has(u)) raiseError('ValueError', 'Circular reference detected');
      if (!u.size) return '{}';
      seen.add(u);
      let entries = [...u.entries()];
      if (sortKeys) entries = entries.sort((a, b) => (keyStr(a[0]) < keyStr(b[0]) ? -1 : keyStr(a[0]) > keyStr(b[0]) ? 1 : 0));
      const parts = entries.map(([k, val]) => jsonEscape(keyStr(k), ensureAscii) + kvSep + ser(val, depth + 1));
      seen.delete(u);
      return wrapItems(parts, '{', '}', depth);
    }
    // fallback to default
    if (defaultFn && defaultFn !== NONE) {
      return ser(pyCall(defaultFn, [v]), depth);
    }
    raiseError('TypeError', `Object of type ${typeOf(v).name} is not JSON serializable`);
  }

  function keyStr(k) {
    if (typeof k === 'string') return k;
    if (typeof k === 'bigint') return k.toString();
    if (typeof k === 'boolean') return k ? 'true' : 'false';
    if (typeof k === 'number') return jsonNumberStr(k);
    if (k === NONE) return 'null';
    raiseError('TypeError', `keys must be str, int, float, bool or None, not ${typeOf(k).name}`);
  }

  function wrapItems(parts, open, close, depth) {
    if (indent === null) return open + parts.join(itemSep) + close;
    const pad = '\n' + ' '.repeat(indent * (depth + 1));
    const padClose = '\n' + ' '.repeat(indent * depth);
    return open + pad + parts.join(itemSep + pad) + padClose + close;
  }

  return ser(obj, 0);
}

function jsonLoads(text) {
  let i = 0;
  const n = text.length;
  const ws = () => { while (i < n && ' \t\n\r'.includes(text[i])) i++; };
  const err = (msg) => raiseError('ValueError', `${msg}: line 1 column ${i + 1} (char ${i})`);

  function value() {
    ws();
    if (i >= n) err('Expecting value');
    const ch = text[i];
    if (ch === '{') return obj();
    if (ch === '[') return arr();
    if (ch === '"') return str();
    if (ch === '-' || (ch >= '0' && ch <= '9')) return num();
    if (text.startsWith('true', i)) { i += 4; return true; }
    if (text.startsWith('false', i)) { i += 5; return false; }
    if (text.startsWith('null', i)) { i += 4; return NONE; }
    if (text.startsWith('NaN', i)) { i += 3; return NaN; }
    if (text.startsWith('Infinity', i)) { i += 8; return Infinity; }
    if (text.startsWith('-Infinity', i)) { i += 9; return -Infinity; }
    err('Expecting value');
  }

  function str() {
    i++; // opening quote
    let out = '';
    while (i < n) {
      const ch = text[i];
      if (ch === '"') { i++; return out; }
      if (ch === '\\') {
        i++;
        const e = text[i];
        switch (e) {
          case '"': out += '"'; break;
          case '\\': out += '\\'; break;
          case '/': out += '/'; break;
          case 'n': out += '\n'; break;
          case 't': out += '\t'; break;
          case 'r': out += '\r'; break;
          case 'b': out += '\b'; break;
          case 'f': out += '\f'; break;
          case 'u': {
            const hex = text.slice(i + 1, i + 5);
            out += String.fromCharCode(parseInt(hex, 16));
            i += 4;
            break;
          }
          default: err('Invalid \\escape');
        }
        i++;
      } else {
        out += ch;
        i++;
      }
    }
    err('Unterminated string starting at');
  }

  function num() {
    const start = i;
    if (text[i] === '-') i++;
    while (i < n && text[i] >= '0' && text[i] <= '9') i++;
    let isFloat = false;
    if (text[i] === '.') { isFloat = true; i++; while (i < n && text[i] >= '0' && text[i] <= '9') i++; }
    if (text[i] === 'e' || text[i] === 'E') {
      isFloat = true; i++;
      if (text[i] === '+' || text[i] === '-') i++;
      while (i < n && text[i] >= '0' && text[i] <= '9') i++;
    }
    const s = text.slice(start, i);
    return isFloat ? parseFloat(s) : BigInt(s);
  }

  function arr() {
    i++; // [
    const out = [];
    ws();
    if (text[i] === ']') { i++; return new PyList(out); }
    for (;;) {
      out.push(value());
      ws();
      if (text[i] === ',') { i++; continue; }
      if (text[i] === ']') { i++; break; }
      err("Expecting ',' delimiter");
    }
    return new PyList(out);
  }

  function obj() {
    i++; // {
    const d = new PyDict();
    ws();
    if (text[i] === '}') { i++; return d; }
    for (;;) {
      ws();
      if (text[i] !== '"') err('Expecting property name enclosed in double quotes');
      const k = str();
      ws();
      if (text[i] !== ':') err("Expecting ':' delimiter");
      i++;
      d.set(k, value());
      ws();
      if (text[i] === ',') { i++; continue; }
      if (text[i] === '}') { i++; break; }
      err("Expecting ',' delimiter");
    }
    return d;
  }

  const result = value();
  ws();
  if (i < n) err('Extra data');
  return result;
}

reg('json', () => {
  const dumps = bfn('dumps', (args, kwargs) => {
    const obj = args[0];
    let indent = getKw(kwargs, 'indent', NONE);
    indent = (indent === NONE || indent === undefined) ? null : Number(numToBigInt(indent));
    const sortKeys = pyTruthy(getKw(kwargs, 'sort_keys', false));
    const ensureAscii = pyTruthy(getKw(kwargs, 'ensure_ascii', true));
    const defaultFn = getKw(kwargs, 'default', NONE);
    const sepArg = getKw(kwargs, 'separators', NONE);
    let itemSep, kvSep;
    if (sepArg !== NONE && sepArg !== undefined) {
      const seps = iterToArray(sepArg);
      itemSep = unwrap(seps[0]); kvSep = unwrap(seps[1]);
    } else {
      itemSep = indent === null ? ', ' : ',';
      kvSep = ': ';
    }
    return jsonDumps(obj, { indent, sortKeys, itemSep, kvSep, ensureAscii, defaultFn });
  });

  const loads = bfn('loads', (args) => {
    let s = unwrap(args[0]);
    if (typeof s !== 'string') raiseError('TypeError', `the JSON object must be str, not ${typeOf(args[0]).name}`);
    return jsonLoads(s);
  });

  const dump = bfn('dump', (args, kwargs) => {
    const fileObj = args[1];
    const text = dumps.fn([args[0]], kwargs);
    pyCall(getAttr(fileObj, 'write'), [text]);
    return NONE;
  });

  const load = bfn('load', (args) => {
    const fileObj = args[0];
    const text = pyCall(getAttr(fileObj, 'read'), []);
    return jsonLoads(unwrap(text));
  });

  return mkmod('json', { dumps, loads, dump, load });
});

// ---------- collections ----------

reg('collections', () => {
  // ----- defaultdict -----
  const DefaultDict = new PyType('defaultdict', [TYPE_DICT], new Map(), { module: 'collections' });
  DefaultDict.construct = (args, kwargs) => {
    const inst = new PyInstance(DefaultDict);
    const pd = new PyDict();
    const factory = args.length && args[0] !== NONE ? args[0] : NONE;
    pd.defaultFactory = factory;
    inst.payload = pd;
    inst.attrs.set('default_factory', factory);
    // remaining positional + kwargs initialize like dict
    for (let k = 1; k < args.length; k++) {
      const src = unwrap(args[k]);
      if (src instanceof PyDict) for (const [kk, vv] of src.entries()) pd.set(kk, vv);
      else for (const pair of iterToArray(args[k])) { const it = iterToArray(pair); pd.set(it[0], it[1]); }
    }
    if (kwargs) for (const [kk, vv] of kwargs) pd.set(kk, vv);
    return inst;
  };
  DefaultDict.attrs.set('__repr__', new PyBuiltin('__repr__', (self) => {
    const factory = self.attrs.get('default_factory');
    return `defaultdict(${pyRepr(factory)}, ${pyRepr(self.payload)})`;
  }, true));

  // ----- Counter -----
  const Counter = new PyType('Counter', [TYPE_DICT], new Map(), { module: 'collections' });
  // Entries sorted by count descending, ties broken by insertion order.
  function counterSorted(pd) {
    return [...pd.entries()]
      .map((e, idx) => ({ e, idx }))
      .sort((a, b) => {
        const c = richCompare('>', a.e[1], b.e[1]) ? -1 : richCompare('<', a.e[1], b.e[1]) ? 1 : 0;
        return c !== 0 ? c : a.idx - b.idx;
      })
      .map((x) => x.e);
  }
  function counterAdd(pd, src) {
    const u = unwrap(src);
    if (u instanceof PyDict) {
      for (const [k, v] of u.entries()) {
        const cur = pd.get(k);
        pd.set(k, binOp('+', cur === undefined ? 0n : cur, v));
      }
    } else {
      for (const x of iterToArray(src)) {
        const cur = pd.get(x);
        pd.set(x, (cur === undefined ? 0n : cur) + 1n);
      }
    }
  }
  Counter.construct = (args, kwargs) => {
    const inst = new PyInstance(Counter);
    const pd = new PyDict();
    inst.payload = pd;
    if (args.length && args[0] !== NONE) counterAdd(pd, args[0]);
    if (kwargs) for (const [k, v] of kwargs) pd.set(k, binOp('+', pd.get(k) === undefined ? 0n : pd.get(k), v));
    return inst;
  };
  Counter.attrs.set('__missing__', new PyBuiltin('__missing__', () => 0n, true));
  Counter.attrs.set('most_common', new PyBuiltin('most_common', (self, args) => {
    const sorted = counterSorted(self.payload).map(([k, v]) => new PyTuple([k, v]));
    if (args.length && args[0] !== NONE) {
      return new PyList(sorted.slice(0, Number(numToBigInt(args[0]))));
    }
    return new PyList(sorted);
  }, true));
  Counter.attrs.set('elements', new PyBuiltin('elements', (self) => {
    const out = [];
    for (const [k, v] of self.payload.entries()) {
      const count = Number(numToBigInt(v));
      for (let i = 0; i < count; i++) out.push(k);
    }
    let i = 0;
    return new PyIterator(() => (i < out.length ? out[i++] : DONE), 'elements');
  }, true));
  Counter.attrs.set('update', new PyBuiltin('update', (self, args, kwargs) => {
    if (args.length && args[0] !== NONE) counterAdd(self.payload, args[0]);
    if (kwargs) for (const [k, v] of kwargs) self.payload.set(k, binOp('+', self.payload.get(k) === undefined ? 0n : self.payload.get(k), v));
    return NONE;
  }, true));
  Counter.attrs.set('subtract', new PyBuiltin('subtract', (self, args) => {
    const u = unwrap(args[0]);
    if (u instanceof PyDict) for (const [k, v] of u.entries()) self.payload.set(k, binOp('-', self.payload.get(k) === undefined ? 0n : self.payload.get(k), v));
    else for (const x of iterToArray(args[0])) self.payload.set(x, (self.payload.get(x) === undefined ? 0n : self.payload.get(x)) - 1n);
    return NONE;
  }, true));
  Counter.attrs.set('total', new PyBuiltin('total', (self) => {
    let s = 0n;
    for (const [, v] of self.payload.entries()) s = binOp('+', s, v);
    return s;
  }, true));
  Counter.attrs.set('__repr__', new PyBuiltin('__repr__', (self) => {
    const sorted = counterSorted(self.payload);
    if (!sorted.length) return 'Counter()';
    return 'Counter({' + sorted.map(([k, v]) => pyRepr(k) + ': ' + pyRepr(v)).join(', ') + '})';
  }, true));
  // Multiset arithmetic: results drop non-positive counts (like CPython).
  const newCounter = (entries) => {
    const inst = new PyInstance(Counter);
    const pd = new PyDict();
    for (const [k, v] of entries) if (richCompare('>', v, 0n)) pd.set(k, v);
    inst.payload = pd;
    return inst;
  };
  const counterBinop = (op, combine) => new PyBuiltin(op, (self, args) => {
    const other = unwrap(args[0]);
    if (!(other instanceof PyDict) && !(args[0] instanceof PyInstance && args[0].payload instanceof PyDict)) {
      return NOT_IMPLEMENTED;
    }
    const b = unwrap(args[0]) instanceof PyDict ? unwrap(args[0]) : args[0].payload;
    const out = [];
    const keys = new PyDict();
    for (const [k] of self.payload.entries()) keys.set(k, true);
    for (const [k] of b.entries()) keys.set(k, true);
    for (const [k] of keys.entries()) {
      const x = self.payload.get(k); const y = b.get(k);
      out.push([k, combine(x === undefined ? 0n : x, y === undefined ? 0n : y)]);
    }
    return newCounter(out);
  }, true);
  Counter.attrs.set('__add__', counterBinop('__add__', (x, y) => binOp('+', x, y)));
  Counter.attrs.set('__sub__', counterBinop('__sub__', (x, y) => binOp('-', x, y)));
  Counter.attrs.set('__and__', counterBinop('__and__', (x, y) => (richCompare('<', x, y) ? x : y)));
  Counter.attrs.set('__or__', counterBinop('__or__', (x, y) => (richCompare('>', x, y) ? x : y)));

  // ----- deque -----
  const Deque = new PyType('deque', [TYPE_OBJECT], new Map(), { module: 'collections' });
  Deque.construct = (args, kwargs) => {
    const inst = new PyInstance(Deque);
    const items = (args.length && args[0] !== NONE) ? iterToArray(args[0]) : [];
    inst.attrs.set('_items', new PyList(items));
    const maxlen = (args.length > 1 && args[1] !== NONE) ? Number(numToBigInt(args[1])) : (kwargs && kwargs.has('maxlen') && kwargs.get('maxlen') !== NONE ? Number(numToBigInt(kwargs.get('maxlen'))) : null);
    inst.attrs.set('_maxlen', maxlen === null ? NONE : BigInt(maxlen));
    inst._maxlen = maxlen;
    if (maxlen !== null && inst.attrs.get('_items').items.length > maxlen) {
      inst.attrs.get('_items').items.splice(0, inst.attrs.get('_items').items.length - maxlen);
    }
    return inst;
  };
  const dqItems = (self) => self.attrs.get('_items').items;
  const dqTrim = (self, fromLeft) => {
    const m = self._maxlen;
    if (m === null || m === undefined) return;
    const arr = dqItems(self);
    while (arr.length > m) { if (fromLeft) arr.shift(); else arr.pop(); }
  };
  Deque.attrs.set('append', new PyBuiltin('append', (self, args) => { dqItems(self).push(args[0]); dqTrim(self, true); return NONE; }, true));
  Deque.attrs.set('appendleft', new PyBuiltin('appendleft', (self, args) => { dqItems(self).unshift(args[0]); dqTrim(self, false); return NONE; }, true));
  Deque.attrs.set('pop', new PyBuiltin('pop', (self) => { const a = dqItems(self); if (!a.length) raiseError('IndexError', 'pop from an empty deque'); return a.pop(); }, true));
  Deque.attrs.set('popleft', new PyBuiltin('popleft', (self) => { const a = dqItems(self); if (!a.length) raiseError('IndexError', 'pop from an empty deque'); return a.shift(); }, true));
  Deque.attrs.set('extend', new PyBuiltin('extend', (self, args) => { for (const x of iterToArray(args[0])) dqItems(self).push(x); dqTrim(self, true); return NONE; }, true));
  Deque.attrs.set('extendleft', new PyBuiltin('extendleft', (self, args) => { for (const x of iterToArray(args[0])) dqItems(self).unshift(x); dqTrim(self, false); return NONE; }, true));
  Deque.attrs.set('clear', new PyBuiltin('clear', (self) => { dqItems(self).length = 0; return NONE; }, true));
  Deque.attrs.set('count', new PyBuiltin('count', (self, args) => BigInt(dqItems(self).filter((x) => pyEq(x, args[0])).length), true));
  Deque.attrs.set('remove', new PyBuiltin('remove', (self, args) => {
    const a = dqItems(self);
    for (let i = 0; i < a.length; i++) if (pyEq(a[i], args[0])) { a.splice(i, 1); return NONE; }
    raiseError('ValueError', 'deque.remove(x): x not in deque');
  }, true));
  Deque.attrs.set('reverse', new PyBuiltin('reverse', (self) => { dqItems(self).reverse(); return NONE; }, true));
  Deque.attrs.set('rotate', new PyBuiltin('rotate', (self, args) => {
    const a = dqItems(self);
    if (!a.length) return NONE;
    let k = args.length ? Number(numToBigInt(args[0])) : 1;
    k = ((k % a.length) + a.length) % a.length;
    if (k > 0) { const tail = a.splice(a.length - k, k); a.unshift(...tail); }
    return NONE;
  }, true));
  Deque.attrs.set('__len__', new PyBuiltin('__len__', (self) => BigInt(dqItems(self).length), true));
  Deque.attrs.set('__iter__', new PyBuiltin('__iter__', (self) => {
    const a = dqItems(self); let i = 0;
    return new PyIterator(() => (i < a.length ? a[i++] : DONE), 'deque_iterator');
  }, true));
  Deque.attrs.set('__contains__', new PyBuiltin('__contains__', (self, args) => dqItems(self).some((x) => pyEq(x, args[0])), true));
  Deque.attrs.set('__getitem__', new PyBuiltin('__getitem__', (self, args) => {
    const a = dqItems(self);
    let idx = Number(numToBigInt(args[0]));
    if (idx < 0) idx += a.length;
    if (idx < 0 || idx >= a.length) raiseError('IndexError', 'deque index out of range');
    return a[idx];
  }, true));
  Deque.attrs.set('__repr__', new PyBuiltin('__repr__', (self) => {
    const inner = dqItems(self).map(pyRepr).join(', ');
    const m = self._maxlen;
    return `deque([${inner}]${m !== null && m !== undefined ? ', maxlen=' + m : ''})`;
  }, true));
  Deque.attrs.set('__bool__', new PyBuiltin('__bool__', (self) => dqItems(self).length > 0, true));

  // ----- namedtuple -----
  const namedtuple = bfn('namedtuple', (args, kwargs) => {
    const typename = unwrap(args[0]);
    let fields;
    const fieldsArg = unwrap(args[1]);
    if (typeof fieldsArg === 'string') {
      fields = fieldsArg.replace(/,/g, ' ').split(/\s+/).filter((s) => s.length);
    } else {
      fields = iterToArray(args[1]).map((f) => unwrap(f));
    }
    // defaults= applies to the rightmost fields.
    const defaultsArg = kwargs && kwargs.has('defaults') && kwargs.get('defaults') !== NONE
      ? iterToArray(kwargs.get('defaults')) : [];
    const fieldDefaults = new Map();
    defaultsArg.forEach((d, i) => fieldDefaults.set(fields[fields.length - defaultsArg.length + i], d));
    const NT = new PyType(typename, [TYPE_OBJECT], new Map(), { module: '__main__' });
    NT.construct = (a, kw) => {
      const inst = new PyInstance(NT);
      const vals = new Array(fields.length);
      for (let i = 0; i < a.length && i < fields.length; i++) { vals[i] = a[i]; }
      if (a.length > fields.length) raiseError('TypeError', `__new__() takes ${fields.length + 1} positional arguments but ${a.length + 1} were given`);
      if (kw) for (const [k, v] of kw) { const fi = fields.indexOf(k); if (fi === -1) raiseError('TypeError', `__new__() got an unexpected keyword argument '${k}'`); vals[fi] = v; }
      for (let i = 0; i < fields.length; i++) {
        if (vals[i] === undefined) {
          if (fieldDefaults.has(fields[i])) vals[i] = fieldDefaults.get(fields[i]);
          else raiseError('TypeError', `__new__() missing argument: '${fields[i]}'`);
        }
      }
      inst.payload = new PyTuple(vals);
      return inst;
    };
    fields.forEach((f, i) => {
      NT.attrs.set(f, new PyProperty(new PyBuiltin(f, (self) => self.payload.items[i], true)));
    });
    NT.attrs.set('_fields', new PyTuple(fields.map(String)));
    const fdef = new PyDict();
    for (const [k, v] of fieldDefaults) fdef.set(k, v);
    NT.attrs.set('_field_defaults', fdef);
    NT.attrs.set('__repr__', new PyBuiltin('__repr__', (self) =>
      `${typename}(${fields.map((f, i) => f + '=' + pyRepr(self.payload.items[i])).join(', ')})`, true));
    NT.attrs.set('_asdict', new PyBuiltin('_asdict', (self) => {
      const d = new PyDict();
      fields.forEach((f, i) => d.set(f, self.payload.items[i]));
      return d;
    }, true));
    NT.attrs.set('_make', new PyBuiltin('_make', (self, mArgs) => NT.construct(iterToArray(mArgs[0]), null), true));
    NT.attrs.set('_replace', new PyBuiltin('_replace', (self, rArgs, kw) => {
      const vals = [...self.payload.items];
      if (kw) for (const [k, v] of kw) { const fi = fields.indexOf(k); if (fi === -1) raiseError('ValueError', `Got unexpected field names: ['${k}']`); vals[fi] = v; }
      const inst = new PyInstance(NT);
      inst.payload = new PyTuple(vals);
      return inst;
    }, true));
    return NT;
  });

  // ----- ChainMap -----
  const ChainMap = new PyType('ChainMap', [TYPE_OBJECT], new Map(), { module: 'collections' });
  const cmMaps = (self) => self.attrs.get('maps').items;
  ChainMap.construct = (args) => {
    const inst = new PyInstance(ChainMap);
    const maps = args.length ? args.map((m) => m) : [new PyDict()];
    inst.attrs.set('maps', new PyList(maps));
    return inst;
  };
  const cmMergedKeys = (self) => {
    const d = new PyDict();
    const maps = cmMaps(self);
    for (let i = maps.length - 1; i >= 0; i--) {
      for (const [k] of unwrap(maps[i]).entries()) d.set(k, true);
    }
    return [...d.entries()].map(([k]) => k);
  };
  ChainMap.attrs.set('__getitem__', new PyBuiltin('__getitem__', (self, args) => {
    for (const m of cmMaps(self)) {
      const e = unwrap(m).getEntry(args[0]);
      if (e) return e.value;
    }
    throw new PyError(keyErrorExc(args[0]));
  }, true));
  ChainMap.attrs.set('get', new PyBuiltin('get', (self, args) => {
    for (const m of cmMaps(self)) {
      const e = unwrap(m).getEntry(args[0]);
      if (e) return e.value;
    }
    return args.length > 1 ? args[1] : NONE;
  }, true));
  ChainMap.attrs.set('__contains__', new PyBuiltin('__contains__', (self, args) =>
    cmMaps(self).some((m) => unwrap(m).getEntry(args[0]) !== undefined && unwrap(m).getEntry(args[0]) !== null), true));
  ChainMap.attrs.set('__setitem__', new PyBuiltin('__setitem__', (self, args) => {
    unwrap(cmMaps(self)[0]).set(args[0], args[1]); return NONE;
  }, true));
  ChainMap.attrs.set('__delitem__', new PyBuiltin('__delitem__', (self, args) => {
    const m = unwrap(cmMaps(self)[0]);
    if (m.getEntry(args[0]) == null) raiseError('KeyError', `Key not found in the first mapping: ${pyRepr(args[0])}`);
    m.delete(args[0]); return NONE;
  }, true));
  ChainMap.attrs.set('__len__', new PyBuiltin('__len__', (self) => BigInt(cmMergedKeys(self).length), true));
  ChainMap.attrs.set('__iter__', new PyBuiltin('__iter__', (self) => {
    const ks = cmMergedKeys(self); let i = 0;
    return new PyIterator(() => (i < ks.length ? ks[i++] : DONE), 'ChainMap_iterator');
  }, true));
  ChainMap.attrs.set('keys', new PyBuiltin('keys', (self) => new PyList(cmMergedKeys(self)), true));
  ChainMap.attrs.set('values', new PyBuiltin('values', (self) => {
    const get = ChainMap.attrs.get('__getitem__');
    return new PyList(cmMergedKeys(self).map((k) => get.fn(self, [k])));
  }, true));
  ChainMap.attrs.set('items', new PyBuiltin('items', (self) => {
    const get = ChainMap.attrs.get('__getitem__');
    return new PyList(cmMergedKeys(self).map((k) => new PyTuple([k, get.fn(self, [k])])));
  }, true));
  ChainMap.attrs.set('new_child', new PyBuiltin('new_child', (self, args) => {
    const child = args.length && args[0] !== NONE ? args[0] : new PyDict();
    return ChainMap.construct([child, ...cmMaps(self)]);
  }, true));
  ChainMap.attrs.set('parents', new PyProperty(new PyBuiltin('parents', (self) =>
    ChainMap.construct(cmMaps(self).slice(1)), true)));
  ChainMap.attrs.set('__repr__', new PyBuiltin('__repr__', (self) =>
    `ChainMap(${cmMaps(self).map(pyRepr).join(', ')})`, true));

  // ----- UserDict / UserList (subclassable wrappers over .data) -----
  // Uses __init__ (not .construct) so user subclasses inherit construction.
  const UserDict = new PyType('UserDict', [TYPE_OBJECT], new Map(), { module: 'collections' });
  UserDict.attrs.set('__init__', new PyBuiltin('__init__', (self, args, kwargs) => {
    const pd = new PyDict();
    if (args.length && args[0] !== NONE) {
      const src = unwrap(args[0]);
      if (src instanceof PyDict) for (const [k, v] of src.entries()) pd.set(k, v);
      else for (const pair of iterToArray(args[0])) { const it = iterToArray(pair); pd.set(it[0], it[1]); }
    }
    if (kwargs) for (const [k, v] of kwargs) pd.set(k, v);
    self.attrs.set('data', pd);
    return NONE;
  }, true));
  const udData = (self) => unwrap(getAttr(self, 'data'));
  UserDict.attrs.set('__getitem__', new PyBuiltin('__getitem__', (self, args) => {
    const e = udData(self).getEntry(args[0]);
    if (e) return e.value;
    const mh = mroLookup(self.cls, '__missing__');
    if (mh && !mh.owner.builtin) return pyCall(bindClassAttr(mh.value, self), [args[0]]);
    throw new PyError(keyErrorExc(args[0]));
  }, true));
  UserDict.attrs.set('__setitem__', new PyBuiltin('__setitem__', (self, args) => { udData(self).set(args[0], args[1]); return NONE; }, true));
  UserDict.attrs.set('__delitem__', new PyBuiltin('__delitem__', (self, args) => {
    if (!udData(self).delete(args[0])) throw new PyError(keyErrorExc(args[0]));
    return NONE;
  }, true));
  UserDict.attrs.set('__len__', new PyBuiltin('__len__', (self) => BigInt(udData(self).size), true));
  UserDict.attrs.set('__contains__', new PyBuiltin('__contains__', (self, args) => udData(self).getEntry(args[0]) != null, true));
  UserDict.attrs.set('__iter__', new PyBuiltin('__iter__', (self) => {
    const ks = [...udData(self).entries()].map(([k]) => k); let i = 0;
    return new PyIterator(() => (i < ks.length ? ks[i++] : DONE), 'UserDict_iterator');
  }, true));
  UserDict.attrs.set('get', new PyBuiltin('get', (self, args) => {
    const e = udData(self).getEntry(args[0]);
    return e ? e.value : (args.length > 1 ? args[1] : NONE);
  }, true));
  UserDict.attrs.set('keys', new PyBuiltin('keys', (self) => new PyList([...udData(self).entries()].map(([k]) => k)), true));
  UserDict.attrs.set('values', new PyBuiltin('values', (self) => new PyList([...udData(self).entries()].map(([, v]) => v)), true));
  UserDict.attrs.set('items', new PyBuiltin('items', (self) => new PyList([...udData(self).entries()].map(([k, v]) => new PyTuple([k, v]))), true));
  UserDict.attrs.set('__repr__', new PyBuiltin('__repr__', (self) => pyRepr(udData(self)), true));

  const UserList = new PyType('UserList', [TYPE_OBJECT], new Map(), { module: 'collections' });
  UserList.attrs.set('__init__', new PyBuiltin('__init__', (self, args) => {
    const items = (args.length && args[0] !== NONE) ? iterToArray(args[0]) : [];
    self.attrs.set('data', new PyList(items));
    return NONE;
  }, true));
  const ulData = (self) => unwrap(getAttr(self, 'data')).items;
  UserList.attrs.set('__getitem__', new PyBuiltin('__getitem__', (self, args) => getItem(unwrap(getAttr(self, 'data')), args[0]), true));
  UserList.attrs.set('__setitem__', new PyBuiltin('__setitem__', (self, args) => { ulData(self)[Number(numToBigInt(args[0]))] = args[1]; return NONE; }, true));
  UserList.attrs.set('__len__', new PyBuiltin('__len__', (self) => BigInt(ulData(self).length), true));
  UserList.attrs.set('__contains__', new PyBuiltin('__contains__', (self, args) => ulData(self).some((x) => pyEq(x, args[0])), true));
  UserList.attrs.set('__iter__', new PyBuiltin('__iter__', (self) => {
    const a = ulData(self); let i = 0;
    return new PyIterator(() => (i < a.length ? a[i++] : DONE), 'UserList_iterator');
  }, true));
  UserList.attrs.set('append', new PyBuiltin('append', (self, args) => { ulData(self).push(args[0]); return NONE; }, true));
  UserList.attrs.set('extend', new PyBuiltin('extend', (self, args) => { for (const x of iterToArray(args[0])) ulData(self).push(x); return NONE; }, true));
  UserList.attrs.set('insert', new PyBuiltin('insert', (self, args) => { ulData(self).splice(Number(numToBigInt(args[0])), 0, args[1]); return NONE; }, true));
  UserList.attrs.set('pop', new PyBuiltin('pop', (self, args) => {
    const a = ulData(self);
    const idx = args.length ? Number(numToBigInt(args[0])) : a.length - 1;
    if (!a.length) raiseError('IndexError', 'pop from empty list');
    return a.splice(idx < 0 ? idx + a.length : idx, 1)[0];
  }, true));
  UserList.attrs.set('__repr__', new PyBuiltin('__repr__', (self) => pyRepr(unwrap(getAttr(self, 'data'))), true));

  return mkmod('collections', {
    defaultdict: DefaultDict,
    Counter,
    deque: Deque,
    namedtuple,
    ChainMap,
    UserDict,
    UserList,
    OrderedDict: TYPE_DICT,
    abc: mkmod('collections.abc', {}),
  });
});

// ---------- bisect ----------

reg('bisect', () => {
  const valAt = (arr, i, key) => (key ? pyCall(key, [arr[i]]) : arr[i]);
  const bisectRight = (arr, x, lo, hi, key) => {
    while (lo < hi) { const mid = (lo + hi) >> 1; if (richCompare('<', x, valAt(arr, mid, key))) hi = mid; else lo = mid + 1; }
    return lo;
  };
  const bisectLeft = (arr, x, lo, hi, key) => {
    while (lo < hi) { const mid = (lo + hi) >> 1; if (richCompare('<', valAt(arr, mid, key), x)) lo = mid + 1; else hi = mid; }
    return lo;
  };
  const parse = (args, kwargs) => {
    const arr = unwrap(args[0]).items;
    const lo = args.length > 2 && args[2] !== NONE ? Number(numToBigInt(args[2])) : 0;
    const hi = args.length > 3 && args[3] !== NONE ? Number(numToBigInt(args[3])) : arr.length;
    const key = kwargs && kwargs.has('key') && kwargs.get('key') !== NONE ? kwargs.get('key') : null;
    return { arr, x: args[1], lo, hi, key };
  };
  // For bisect, x is already in key-space; key is applied only to elements.
  const bl = bfn('bisect_left', (a, kw) => { const { arr, x, lo, hi, key } = parse(a, kw); return BigInt(bisectLeft(arr, x, lo, hi, key)); });
  const br = bfn('bisect_right', (a, kw) => { const { arr, x, lo, hi, key } = parse(a, kw); return BigInt(bisectRight(arr, x, lo, hi, key)); });
  const il = bfn('insort_left', (a, kw) => { const { arr, x, lo, hi, key } = parse(a, kw); arr.splice(bisectLeft(arr, key ? pyCall(key, [x]) : x, lo, hi, key), 0, x); return NONE; });
  const ir = bfn('insort_right', (a, kw) => { const { arr, x, lo, hi, key } = parse(a, kw); arr.splice(bisectRight(arr, key ? pyCall(key, [x]) : x, lo, hi, key), 0, x); return NONE; });
  return mkmod('bisect', {
    bisect_left: bl, bisect_right: br, bisect: br,
    insort_left: il, insort_right: ir, insort: ir,
  });
});

// ---------- heapq ----------

reg('heapq', () => {
  const siftdown = (heap, startpos, pos) => {
    const newitem = heap[pos];
    while (pos > startpos) {
      const parentpos = (pos - 1) >> 1;
      const parent = heap[parentpos];
      if (richCompare('<', newitem, parent)) { heap[pos] = parent; pos = parentpos; continue; }
      break;
    }
    heap[pos] = newitem;
  };
  const siftup = (heap, pos) => {
    const endpos = heap.length;
    const startpos = pos;
    const newitem = heap[pos];
    let childpos = 2 * pos + 1;
    while (childpos < endpos) {
      const rightpos = childpos + 1;
      if (rightpos < endpos && !richCompare('<', heap[childpos], heap[rightpos])) childpos = rightpos;
      heap[pos] = heap[childpos];
      pos = childpos;
      childpos = 2 * pos + 1;
    }
    heap[pos] = newitem;
    siftdown(heap, startpos, pos);
  };
  const heapify = bfn('heapify', (args) => {
    const h = unwrap(args[0]).items;
    for (let i = (h.length >> 1) - 1; i >= 0; i--) siftup(h, i);
    return NONE;
  });
  const heappush = bfn('heappush', (args) => {
    const h = unwrap(args[0]).items; h.push(args[1]); siftdown(h, 0, h.length - 1); return NONE;
  });
  const heappop = bfn('heappop', (args) => {
    const h = unwrap(args[0]).items;
    if (!h.length) raiseError('IndexError', 'index out of range');
    const last = h.pop();
    if (!h.length) return last;
    const ret = h[0]; h[0] = last; siftup(h, 0); return ret;
  });
  const heapreplace = bfn('heapreplace', (args) => {
    const h = unwrap(args[0]).items;
    if (!h.length) raiseError('IndexError', 'index out of range');
    const ret = h[0]; h[0] = args[1]; siftup(h, 0); return ret;
  });
  const heappushpop = bfn('heappushpop', (args) => {
    const h = unwrap(args[0]).items; let item = args[1];
    if (h.length && richCompare('<', h[0], item)) { const t = h[0]; h[0] = item; item = t; siftup(h, 0); }
    return item;
  });
  const sortedBy = (iterable, key, reverse) => {
    const arr = iterToArray(iterable).map((v, i) => ({ v, i, k: key ? pyCall(key, [v]) : v }));
    arr.sort((a, b) => {
      const c = richCompare('<', a.k, b.k) ? -1 : richCompare('<', b.k, a.k) ? 1 : 0;
      return (reverse ? -c : c) || (a.i - b.i);
    });
    return arr.map((x) => x.v);
  };
  const nlargest = bfn('nlargest', (args, kwargs) => {
    const n = Number(numToBigInt(args[0]));
    const key = kwargs && kwargs.has('key') && kwargs.get('key') !== NONE ? kwargs.get('key') : null;
    return new PyList(sortedBy(args[1], key, true).slice(0, Math.max(0, n)));
  });
  const nsmallest = bfn('nsmallest', (args, kwargs) => {
    const n = Number(numToBigInt(args[0]));
    const key = kwargs && kwargs.has('key') && kwargs.get('key') !== NONE ? kwargs.get('key') : null;
    return new PyList(sortedBy(args[1], key, false).slice(0, Math.max(0, n)));
  });
  const merge = bfn('merge', (args, kwargs) => {
    const key = kwargs && kwargs.has('key') && kwargs.get('key') !== NONE ? kwargs.get('key') : null;
    const reverse = kwargs && kwargs.has('reverse') && pyTruthy(kwargs.get('reverse'));
    const all = [];
    for (const it of args) for (const x of iterToArray(it)) all.push(x);
    const merged = sortedBy(new PyList(all), key, reverse);
    let i = 0;
    return new PyIterator(() => (i < merged.length ? merged[i++] : DONE), 'merge');
  });
  return mkmod('heapq', {
    heapify, heappush, heappop, heapreplace, heappushpop, nlargest, nsmallest, merge,
  });
});

// ---------- copy ----------

reg('copy', () => {
  const shallow = (v) => {
    if (v instanceof PyInstance) {
      const h = mroLookup(v.cls, '__copy__');
      if (h && !h.owner.builtin) return pyCall(bindClassAttr(h.value, v), []);
      const inst = new PyInstance(v.cls);
      if (v.payload !== undefined) {
        const p = v.payload;
        inst.payload = p instanceof PyList ? new PyList([...p.items])
          : p instanceof PyTuple ? new PyTuple([...p.items])
            : p instanceof PyDict ? p.copy()
              : p instanceof PySet ? p.copy(p.frozen) : p;
      }
      for (const [k, val] of v.attrs) inst.attrs.set(k, val);
      return inst;
    }
    if (v instanceof PyList) return new PyList([...v.items]);
    if (v instanceof PyDict) return v.copy();
    if (v instanceof PySet) return v.copy(v.frozen);
    return v; // tuples & immutables: same object
  };
  const deep = (v, memo) => {
    if (v instanceof PyInstance) {
      const h = mroLookup(v.cls, '__deepcopy__');
      if (h && !h.owner.builtin) return pyCall(bindClassAttr(h.value, v), [memo]);
      const inst = new PyInstance(v.cls);
      if (v.payload !== undefined) inst.payload = deepPayload(v.payload, memo);
      for (const [k, val] of v.attrs) inst.attrs.set(k, deep(val, memo));
      return inst;
    }
    if (v instanceof PyList) return new PyList(v.items.map((x) => deep(x, memo)));
    if (v instanceof PyTuple) return new PyTuple(v.items.map((x) => deep(x, memo)));
    if (v instanceof PyDict) {
      const d = new PyDict();
      for (const [k, val] of v.entries()) d.set(deep(k, memo), deep(val, memo));
      return d;
    }
    if (v instanceof PySet) {
      const s = new PySet(v.frozen);
      for (const x of v.keys()) s.add(deep(x, memo));
      return s;
    }
    return v;
  };
  const deepPayload = (p, memo) => (p instanceof PyList || p instanceof PyTuple || p instanceof PyDict || p instanceof PySet) ? deep(p, memo) : p;
  return mkmod('copy', {
    copy: bfn('copy', (args) => shallow(args[0])),
    deepcopy: bfn('deepcopy', (args) => deep(args[0], new PyDict())),
  });
});

reg('collections.abc', () => mkmod('collections.abc', {}));

// ---------- threading (synchronous model: start() runs the target inline) ----------

reg('threading', () => {
  const Thread = new PyType('Thread', [TYPE_OBJECT], new Map(), { module: 'threading' });
  Thread.attrs.set('__init__', new PyBuiltin('__init__', (self, args, kwargs) => {
    self.attrs.set('_target', kwargs && kwargs.has('target') ? kwargs.get('target') : (args.length ? args[0] : NONE));
    self.attrs.set('_args', kwargs && kwargs.has('args') ? kwargs.get('args') : new PyTuple([]));
    self.attrs.set('_kwargs', kwargs && kwargs.has('kwargs') ? kwargs.get('kwargs') : NONE);
    self.attrs.set('name', kwargs && kwargs.has('name') ? kwargs.get('name') : 'Thread-1');
    self._started = false;
    return NONE;
  }, true));
  Thread.attrs.set('start', new PyBuiltin('start', (self) => {
    self._started = true;
    // A subclass may override run(); otherwise call the target.
    const runHit = mroLookup(self.cls, 'run');
    if (runHit && !runHit.owner.builtin) { pyCall(bindClassAttr(runHit.value, self), []); return NONE; }
    const target = self.attrs.get('_target');
    if (target && target !== NONE) {
      const a = iterToArray(self.attrs.get('_args'));
      const kw = self.attrs.get('_kwargs');
      const kwMap = kw !== NONE && unwrap(kw) instanceof PyDict ? new Map([...unwrap(kw).entries()].filter(([k]) => typeof k === 'string')) : null;
      pyCall(target, a, kwMap);
    }
    return NONE;
  }, true));
  Thread.attrs.set('run', new PyBuiltin('run', (self) => {
    const target = self.attrs.get('_target');
    if (target && target !== NONE) pyCall(target, iterToArray(self.attrs.get('_args')), null);
    return NONE;
  }, true));
  Thread.attrs.set('join', new PyBuiltin('join', () => NONE, true));
  Thread.attrs.set('is_alive', new PyBuiltin('is_alive', () => false, true));
  Thread.attrs.set('getName', new PyBuiltin('getName', (self) => self.attrs.get('name'), true));

  const makeLock = (name) => {
    const L = new PyType(name, [TYPE_OBJECT], new Map(), { module: 'threading' });
    L.construct = () => new PyInstance(L);
    L.attrs.set('acquire', new PyBuiltin('acquire', () => true, true));
    L.attrs.set('release', new PyBuiltin('release', () => NONE, true));
    L.attrs.set('__enter__', new PyBuiltin('__enter__', (self) => self, true));
    L.attrs.set('__exit__', new PyBuiltin('__exit__', () => false, true));
    L.attrs.set('locked', new PyBuiltin('locked', () => false, true));
    return L;
  };
  const Lock = makeLock('lock');
  const RLock = makeLock('RLock');

  const Event = new PyType('Event', [TYPE_OBJECT], new Map(), { module: 'threading' });
  Event.construct = () => { const i = new PyInstance(Event); i._flag = false; return i; };
  Event.attrs.set('set', new PyBuiltin('set', (self) => { self._flag = true; return NONE; }, true));
  Event.attrs.set('clear', new PyBuiltin('clear', (self) => { self._flag = false; return NONE; }, true));
  Event.attrs.set('is_set', new PyBuiltin('is_set', (self) => !!self._flag, true));
  Event.attrs.set('wait', new PyBuiltin('wait', (self) => !!self._flag, true));

  return mkmod('threading', {
    Thread,
    Lock: bfn('Lock', () => new PyInstance(Lock)),
    RLock: bfn('RLock', () => new PyInstance(RLock)),
    Event,
    get_ident: bfn('get_ident', () => 1n),
    active_count: bfn('active_count', () => 1n),
    current_thread: bfn('current_thread', () => { const t = new PyInstance(Thread); t.attrs.set('name', 'MainThread'); return t; }),
  });
});

// ---------- multiprocessing (synchronous model) ----------

reg('multiprocessing', () => {
  const Process = new PyType('Process', [TYPE_OBJECT], new Map(), { module: 'multiprocessing' });
  Process.attrs.set('__init__', new PyBuiltin('__init__', (self, args, kwargs) => {
    self.attrs.set('_target', kwargs && kwargs.has('target') ? kwargs.get('target') : (args.length ? args[0] : NONE));
    self.attrs.set('_args', kwargs && kwargs.has('args') ? kwargs.get('args') : new PyTuple([]));
    return NONE;
  }, true));
  Process.attrs.set('start', new PyBuiltin('start', (self) => {
    const t = self.attrs.get('_target');
    if (t && t !== NONE) pyCall(t, iterToArray(self.attrs.get('_args')), null);
    return NONE;
  }, true));
  Process.attrs.set('join', new PyBuiltin('join', () => NONE, true));
  Process.attrs.set('is_alive', new PyBuiltin('is_alive', () => false, true));

  const Pool = new PyType('Pool', [TYPE_OBJECT], new Map(), { module: 'multiprocessing' });
  Pool.construct = () => new PyInstance(Pool);
  Pool.attrs.set('map', new PyBuiltin('map', (self, args) => {
    const fn = args[0];
    return new PyList(iterToArray(args[1]).map((x) => pyCall(fn, [x], null)));
  }, true));
  Pool.attrs.set('apply', new PyBuiltin('apply', (self, args) => pyCall(args[0], args.length > 1 ? iterToArray(args[1]) : [], null), true));
  Pool.attrs.set('starmap', new PyBuiltin('starmap', (self, args) => {
    const fn = args[0];
    return new PyList(iterToArray(args[1]).map((x) => pyCall(fn, iterToArray(x), null)));
  }, true));
  Pool.attrs.set('close', new PyBuiltin('close', () => NONE, true));
  Pool.attrs.set('join', new PyBuiltin('join', () => NONE, true));
  Pool.attrs.set('terminate', new PyBuiltin('terminate', () => NONE, true));
  Pool.attrs.set('__enter__', new PyBuiltin('__enter__', (self) => self, true));
  Pool.attrs.set('__exit__', new PyBuiltin('__exit__', () => false, true));

  return mkmod('multiprocessing', {
    Process,
    Pool: bfn('Pool', () => new PyInstance(Pool)),
    cpu_count: bfn('cpu_count', () => 1n),
  });
});

// ---------- decimal ----------

reg('decimal', () => {
  const PREC = 28; // default context precision
  const Decimal = new PyType('Decimal', [TYPE_OBJECT], new Map(), { module: 'decimal' });
  // internal: sign (0/1), coeff (BigInt >=0), exp (int)
  const mk = (sign, coeff, exp) => {
    const inst = new PyInstance(Decimal);
    inst._sign = sign; inst._coeff = coeff; inst._exp = exp;
    return inst;
  };
  const digitsLen = (n) => (n === 0n ? 1 : n.toString().length);
  // round coeff to PREC significant digits (ROUND_HALF_EVEN), adjusting exp.
  const roundCtx = (sign, coeff, exp) => {
    const dl = digitsLen(coeff);
    if (dl <= PREC) return mk(sign, coeff, exp);
    const drop = dl - PREC;
    const p = 10n ** BigInt(drop);
    let q = coeff / p; const r = coeff % p;
    const half = p / 2n;
    if (r > half || (r === half && (q % 2n) === 1n)) q += 1n;
    return mk(sign, q, exp + drop);
  };
  const parseStr = (s) => {
    s = s.trim();
    let sign = 0;
    if (s[0] === '+') s = s.slice(1);
    else if (s[0] === '-') { sign = 1; s = s.slice(1); }
    let exp = 0;
    const em = s.match(/[eE]([+-]?\d+)$/);
    if (em) { exp = parseInt(em[1], 10); s = s.slice(0, em.index); }
    let coeffStr;
    const dot = s.indexOf('.');
    if (dot === -1) coeffStr = s;
    else { const frac = s.length - dot - 1; exp -= frac; coeffStr = s.slice(0, dot) + s.slice(dot + 1); }
    if (!/^\d+$/.test(coeffStr)) raiseError('ArithmeticError', `invalid literal for Decimal: '${s}'`);
    return mk(sign, BigInt(coeffStr), exp);
  };
  const toDec = (v) => {
    if (v instanceof PyInstance && v.cls === Decimal) return v;
    const u = unwrap(v);
    if (typeof u === 'bigint') return mk(u < 0n ? 1 : 0, u < 0n ? -u : u, 0);
    if (typeof u === 'boolean') return mk(0, u ? 1n : 0n, 0);
    if (typeof u === 'string') return parseStr(u);
    return null;
  };
  Decimal.construct = (args) => {
    if (args.length === 0) return mk(0, 0n, 0);
    const d = toDec(args[0]);
    if (!d) raiseError('TypeError', 'conversion from float to Decimal is not supported here');
    return d;
  };
  const signed = (d) => (d._sign ? -d._coeff : d._coeff);
  // align two decimals to a common (minimum) exponent
  const align = (a, b) => {
    const e = Math.min(a._exp, b._exp);
    const ca = signed(a) * 10n ** BigInt(a._exp - e);
    const cb = signed(b) * 10n ** BigInt(b._exp - e);
    return [ca, cb, e];
  };
  const fromSigned = (val, exp) => roundCtx(val < 0n ? 1 : 0, val < 0n ? -val : val, exp);
  const addOp = (a, b) => { const [ca, cb, e] = align(a, b); return fromSigned(ca + cb, e); };
  const subOp = (a, b) => { const [ca, cb, e] = align(a, b); return fromSigned(ca - cb, e); };
  const mulOp = (a, b) => fromSigned(signed(a) * signed(b), a._exp + b._exp);
  const divOp = (a, b) => {
    if (b._coeff === 0n) raiseError('ZeroDivisionError', 'division by zero');
    if (a._coeff === 0n) return mk(0, 0n, 0);
    // scale numerator for precision
    const sa = a._coeff, sb = b._coeff;
    const shift = PREC + digitsLen(sb) - digitsLen(sa) + 1;
    let num = sa, exp = a._exp - b._exp;
    if (shift > 0) { num *= 10n ** BigInt(shift); exp -= shift; }
    let q = num / sb; const r = num % sb;
    // round half even on remainder
    const twice = r * 2n;
    if (twice > sb || (twice === sb && (q % 2n) === 1n)) q += 1n;
    const sign = a._sign ^ b._sign;
    const res = roundCtx(sign, q, exp);
    // For an exact quotient, drop trailing zeros toward the ideal exponent.
    const idealExp = a._exp - b._exp;
    while (res._coeff % 10n === 0n && res._coeff !== 0n && res._exp < idealExp) {
      res._coeff /= 10n; res._exp += 1;
    }
    return res;
  };
  const decToStr = (d) => {
    const coeffStr = d._coeff.toString();
    const exp = d._exp;
    const adjusted = exp + coeffStr.length - 1;
    let s;
    if (exp <= 0 && adjusted >= -6) {
      if (exp === 0) s = coeffStr;
      else {
        const pointPos = coeffStr.length + exp;
        if (pointPos > 0) s = coeffStr.slice(0, pointPos) + '.' + coeffStr.slice(pointPos);
        else s = '0.' + '0'.repeat(-pointPos) + coeffStr;
      }
    } else {
      let mant = coeffStr[0];
      if (coeffStr.length > 1) mant += '.' + coeffStr.slice(1);
      s = mant + 'E' + (adjusted >= 0 ? '+' : '-') + Math.abs(adjusted);
    }
    return (d._sign ? '-' : '') + s;
  };
  Decimal.attrs.set('__str__', new PyBuiltin('__str__', (s) => decToStr(s), true));
  Decimal.attrs.set('__repr__', new PyBuiltin('__repr__', (s) => `Decimal('${decToStr(s)}')`, true));
  Decimal.attrs.set('__float__', new PyBuiltin('__float__', (s) => Number(decToStr(s)), true));
  Decimal.attrs.set('__int__', new PyBuiltin('__int__', (s) => { const v = signed(s); return s._exp >= 0 ? v * 10n ** BigInt(s._exp) : v / 10n ** BigInt(-s._exp); }, true));
  Decimal.attrs.set('__neg__', new PyBuiltin('__neg__', (s) => mk(s._sign ^ 1, s._coeff, s._exp), true));
  Decimal.attrs.set('__abs__', new PyBuiltin('__abs__', (s) => mk(0, s._coeff, s._exp), true));
  const binOpD = (name, fn) => Decimal.attrs.set(name, new PyBuiltin(name, (s, a) => { const o = toDec(a[0]); return o ? fn(s, o) : NOT_IMPLEMENTED; }, true));
  const rbinOpD = (name, fn) => Decimal.attrs.set(name, new PyBuiltin(name, (s, a) => { const o = toDec(a[0]); return o ? fn(o, s) : NOT_IMPLEMENTED; }, true));
  binOpD('__add__', addOp); rbinOpD('__radd__', addOp);
  binOpD('__sub__', subOp); rbinOpD('__rsub__', subOp);
  binOpD('__mul__', mulOp); rbinOpD('__rmul__', mulOp);
  binOpD('__truediv__', divOp); rbinOpD('__rtruediv__', divOp);
  const cmpD = (a, b) => { const [ca, cb] = align(a, b); return ca < cb ? -1 : ca > cb ? 1 : 0; };
  Decimal.attrs.set('__eq__', new PyBuiltin('__eq__', (s, a) => { const o = toDec(a[0]); return o ? cmpD(s, o) === 0 : NOT_IMPLEMENTED; }, true));
  for (const [nm, t] of [['__lt__', (c) => c < 0], ['__le__', (c) => c <= 0], ['__gt__', (c) => c > 0], ['__ge__', (c) => c >= 0]]) {
    Decimal.attrs.set(nm, new PyBuiltin(nm, (s, a) => { const o = toDec(a[0]); return o ? t(cmpD(s, o)) : NOT_IMPLEMENTED; }, true));
  }
  Decimal.attrs.set('__hash__', new PyBuiltin('__hash__', (s) => signed(s) + BigInt(s._exp), true));
  Decimal.attrs.set('__bool__', new PyBuiltin('__bool__', (s) => s._coeff !== 0n, true));
  Decimal.attrs.set('quantize', new PyBuiltin('quantize', (s, a) => {
    const exemplar = toDec(a[0]);
    const targetExp = exemplar._exp;
    let val = signed(s); let exp = s._exp;
    if (targetExp > exp) {
      const drop = targetExp - exp;
      const p = 10n ** BigInt(drop);
      let q = val / p; const r = ((val % p) + p) % p;
      const half = p / 2n;
      if (r > half || (r === half && (((q % 2n) + 2n) % 2n) === 1n)) q += (val < 0n ? -1n : 1n);
      return fromSigned(q, targetExp);
    }
    val *= 10n ** BigInt(exp - targetExp);
    return fromSigned(val, targetExp);
  }, true));

  return mkmod('decimal', {
    Decimal,
    getcontext: bfn('getcontext', () => { const c = new PyInstance(new PyType('Context', [TYPE_OBJECT], new Map(), { module: 'decimal' })); c.attrs.set('prec', BigInt(PREC)); return c; }),
  });
});

// ---------- datetime ----------

reg('datetime', () => {
  const classMethodSet = (T, name, fn) => T.attrs.set(name, new PyClassMethod(new PyBuiltin(name, fn, true)));
  const isLeap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const MDAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const dim = (y, m) => (m === 2 && isLeap(y) ? 29 : MDAYS[m - 1]);
  const toOrd = (y, m, d) => {
    let n = 0;
    for (let yy = 1; yy < y; yy++) n += isLeap(yy) ? 366 : 365;
    for (let mm = 1; mm < m; mm++) n += dim(y, mm);
    return n + d;
  };
  const fromOrd = (n) => {
    let y = 1;
    for (;;) { const dy = isLeap(y) ? 366 : 365; if (n > dy) { n -= dy; y++; } else break; }
    let m = 1;
    for (;;) { const dm = dim(y, m); if (n > dm) { n -= dm; m++; } else break; }
    return [y, m, n];
  };
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  const DAYNAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const MONNAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  const timedelta = new PyType('timedelta', [TYPE_OBJECT], new Map(), { module: 'datetime' });
  const mkDelta = (days, seconds, micros) => {
    // normalize
    let us = micros + seconds * 1000000 + days * 86400000000;
    let d = Math.floor(us / 86400000000); us -= d * 86400000000;
    let s = Math.floor(us / 1000000); us -= s * 1000000;
    const inst = new PyInstance(timedelta);
    inst._d = d; inst._s = s; inst._us = us;
    return inst;
  };
  timedelta.construct = (args, kwargs) => {
    const g = (i, name, mul) => {
      let v = 0;
      if (args.length > i && args[i] !== NONE) v = Number(args[i] instanceof PyInstance ? numToBigInt(args[i]) : unwrap(args[i]));
      if (kwargs && kwargs.has(name)) v = Number(unwrap(kwargs.get(name)));
      return v * mul;
    };
    let us = 0;
    us += g(0, 'days', 86400000000);
    us += g(1, 'seconds', 1000000);
    us += g(2, 'microseconds', 1);
    us += g(3, 'milliseconds', 1000);
    us += g(4, 'minutes', 60000000);
    us += g(5, 'hours', 3600000000);
    us += g(6, 'weeks', 604800000000);
    return mkDelta(0, 0, Math.round(us));
  };
  const deltaUs = (x) => x._d * 86400000000 + x._s * 1000000 + x._us;
  timedelta.attrs.set('days', new PyProperty(new PyBuiltin('days', (s) => BigInt(s._d), true)));
  timedelta.attrs.set('seconds', new PyProperty(new PyBuiltin('seconds', (s) => BigInt(s._s), true)));
  timedelta.attrs.set('microseconds', new PyProperty(new PyBuiltin('microseconds', (s) => BigInt(s._us), true)));
  timedelta.attrs.set('total_seconds', new PyBuiltin('total_seconds', (s) => deltaUs(s) / 1000000, true));
  timedelta.attrs.set('__add__', new PyBuiltin('__add__', (s, a) => (a[0] instanceof PyInstance && a[0].cls === timedelta ? mkDelta(0, 0, deltaUs(s) + deltaUs(a[0])) : NOT_IMPLEMENTED), true));
  timedelta.attrs.set('__sub__', new PyBuiltin('__sub__', (s, a) => (a[0] instanceof PyInstance && a[0].cls === timedelta ? mkDelta(0, 0, deltaUs(s) - deltaUs(a[0])) : NOT_IMPLEMENTED), true));
  timedelta.attrs.set('__mul__', new PyBuiltin('__mul__', (s, a) => mkDelta(0, 0, deltaUs(s) * Number(unwrap(a[0]))), true));
  timedelta.attrs.set('__neg__', new PyBuiltin('__neg__', (s) => mkDelta(0, 0, -deltaUs(s)), true));
  timedelta.attrs.set('__eq__', new PyBuiltin('__eq__', (s, a) => (a[0] instanceof PyInstance && a[0].cls === timedelta ? deltaUs(s) === deltaUs(a[0]) : NOT_IMPLEMENTED), true));
  for (const [nm, t] of [['__lt__', (c) => c < 0], ['__le__', (c) => c <= 0], ['__gt__', (c) => c > 0], ['__ge__', (c) => c >= 0]]) {
    timedelta.attrs.set(nm, new PyBuiltin(nm, (s, a) => { if (!(a[0] instanceof PyInstance && a[0].cls === timedelta)) return NOT_IMPLEMENTED; return t(deltaUs(s) - deltaUs(a[0])); }, true));
  }
  timedelta.attrs.set('__hash__', new PyBuiltin('__hash__', (s) => BigInt(deltaUs(s)), true));
  timedelta.attrs.set('__bool__', new PyBuiltin('__bool__', (s) => deltaUs(s) !== 0, true));
  timedelta.attrs.set('__repr__', new PyBuiltin('__repr__', (s) => {
    const parts = [];
    if (s._d) parts.push(`days=${s._d}`);
    if (s._s) parts.push(`seconds=${s._s}`);
    if (s._us) parts.push(`microseconds=${s._us}`);
    return `datetime.timedelta(${parts.length ? parts.join(', ') : '0'})`;
  }, true));
  timedelta.attrs.set('__str__', new PyBuiltin('__str__', (s) => {
    let neg = deltaUs(s) < 0;
    let d = s._d, sec = s._s, us = s._us;
    if (neg) { /* CPython normalizes negatives differently; keep simple */ }
    const hh = Math.floor(sec / 3600), mm = Math.floor((sec % 3600) / 60), ss = sec % 60;
    let out = '';
    if (d !== 0) out += `${d} day${Math.abs(d) === 1 ? '' : 's'}, `;
    out += `${hh}:${pad(mm)}:${pad(ss)}`;
    if (us) out += '.' + pad(us, 6);
    return out;
  }, true));

  const dateType = new PyType('date', [TYPE_OBJECT], new Map(), { module: 'datetime' });
  const mkDate = (cls, y, m, d) => { const inst = new PyInstance(cls); inst._y = y; inst._m = m; inst._d = d; inst._dt = false; return inst; };
  dateType.construct = (args) => mkDate(dateType, Number(numToBigInt(args[0])), Number(numToBigInt(args[1])), Number(numToBigInt(args[2])));
  const dateProps = (cls) => {
    cls.attrs.set('year', new PyProperty(new PyBuiltin('year', (s) => BigInt(s._y), true)));
    cls.attrs.set('month', new PyProperty(new PyBuiltin('month', (s) => BigInt(s._m), true)));
    cls.attrs.set('day', new PyProperty(new PyBuiltin('day', (s) => BigInt(s._d), true)));
    cls.attrs.set('weekday', new PyBuiltin('weekday', (s) => BigInt((toOrd(s._y, s._m, s._d) + 6) % 7), true));
    cls.attrs.set('isoweekday', new PyBuiltin('isoweekday', (s) => BigInt(((toOrd(s._y, s._m, s._d) + 6) % 7) + 1), true));
    cls.attrs.set('toordinal', new PyBuiltin('toordinal', (s) => BigInt(toOrd(s._y, s._m, s._d)), true));
    cls.attrs.set('replace', new PyBuiltin('replace', (s, a, kw) => {
      const y = kw && kw.has('year') ? Number(numToBigInt(kw.get('year'))) : s._y;
      const m = kw && kw.has('month') ? Number(numToBigInt(kw.get('month'))) : s._m;
      const d = kw && kw.has('day') ? Number(numToBigInt(kw.get('day'))) : s._d;
      return mkDate(cls, y, m, d);
    }, true));
  };
  dateProps(dateType);
  const dateStr = (s) => `${pad(s._y, 4)}-${pad(s._m)}-${pad(s._d)}`;
  dateType.attrs.set('isoformat', new PyBuiltin('isoformat', (s) => dateStr(s), true));
  dateType.attrs.set('__str__', new PyBuiltin('__str__', (s) => dateStr(s), true));
  dateType.attrs.set('__repr__', new PyBuiltin('__repr__', (s) => `datetime.date(${s._y}, ${s._m}, ${s._d})`, true));
  const cmpDate = (a, b) => { const oa = toOrd(a._y, a._m, a._d), ob = toOrd(b._y, b._m, b._d); return oa < ob ? -1 : oa > ob ? 1 : 0; };
  dateType.attrs.set('__eq__', new PyBuiltin('__eq__', (s, a) => (a[0] instanceof PyInstance && a[0]._y !== undefined ? cmpDate(s, a[0]) === 0 : NOT_IMPLEMENTED), true));
  for (const [nm, t] of [['__lt__', (c) => c < 0], ['__le__', (c) => c <= 0], ['__gt__', (c) => c > 0], ['__ge__', (c) => c >= 0]]) {
    dateType.attrs.set(nm, new PyBuiltin(nm, (s, a) => (a[0] instanceof PyInstance && a[0]._y !== undefined ? t(cmpDate(s, a[0])) : NOT_IMPLEMENTED), true));
  }
  dateType.attrs.set('__hash__', new PyBuiltin('__hash__', (s) => BigInt(toOrd(s._y, s._m, s._d)), true));
  dateType.attrs.set('__add__', new PyBuiltin('__add__', (s, a) => {
    if (a[0] instanceof PyInstance && a[0].cls === timedelta) { const [y, m, d] = fromOrd(toOrd(s._y, s._m, s._d) + a[0]._d); return mkDate(dateType, y, m, d); }
    return NOT_IMPLEMENTED;
  }, true));
  dateType.attrs.set('__sub__', new PyBuiltin('__sub__', (s, a) => {
    const o = a[0];
    if (o instanceof PyInstance && o.cls === timedelta) { const [y, m, d] = fromOrd(toOrd(s._y, s._m, s._d) - o._d); return mkDate(dateType, y, m, d); }
    if (o instanceof PyInstance && o._y !== undefined) return mkDelta(toOrd(s._y, s._m, s._d) - toOrd(o._y, o._m, o._d), 0, 0);
    return NOT_IMPLEMENTED;
  }, true));
  const strftime = (s) => new PyBuiltin('strftime', (self, a) => {
    const fmt = unwrap(a[0]);
    const wd = (toOrd(self._y, self._m, self._d) + 6) % 7;
    const hh = self._hh || 0, mm = self._mm || 0, ss = self._ss || 0;
    return fmt.replace(/%(.)/g, (_, c) => {
      switch (c) {
        case 'Y': return pad(self._y, 4); case 'm': return pad(self._m); case 'd': return pad(self._d);
        case 'H': return pad(hh); case 'M': return pad(mm); case 'S': return pad(ss);
        case 'y': return pad(self._y % 100); case 'j': return pad(toOrd(self._y, self._m, self._d) - toOrd(self._y, 1, 1) + 1, 3);
        case 'A': return DAYNAMES[wd]; case 'a': return DAYNAMES[wd].slice(0, 3);
        case 'B': return MONNAMES[self._m - 1]; case 'b': return MONNAMES[self._m - 1].slice(0, 3);
        case 'w': return String((wd + 1) % 7); case '%': return '%';
        default: return '%' + c;
      }
    });
  }, true);
  dateType.attrs.set('strftime', strftime());
  classMethodSet(dateType, 'fromordinal', (cls, a) => { const [y, m, d] = fromOrd(Number(numToBigInt(a[0]))); return mkDate(dateType, y, m, d); });
  classMethodSet(dateType, 'fromisoformat', (cls, a) => { const [y, m, d] = unwrap(a[0]).split('-').map(Number); return mkDate(dateType, y, m, d); });

  const datetimeType = new PyType('datetime', [dateType], new Map(), { module: 'datetime' });
  const mkDT = (y, m, d, hh, mm, ss, us) => { const inst = new PyInstance(datetimeType); inst._y = y; inst._m = m; inst._d = d; inst._hh = hh; inst._mm = mm; inst._ss = ss; inst._us = us; inst._dt = true; return inst; };
  datetimeType.construct = (args) => {
    const n = (i, def) => (args.length > i && args[i] !== NONE ? Number(numToBigInt(args[i])) : def);
    return mkDT(n(0, 1), n(1, 1), n(2, 1), n(3, 0), n(4, 0), n(5, 0), n(6, 0));
  };
  dateProps(datetimeType);
  datetimeType.attrs.set('hour', new PyProperty(new PyBuiltin('hour', (s) => BigInt(s._hh), true)));
  datetimeType.attrs.set('minute', new PyProperty(new PyBuiltin('minute', (s) => BigInt(s._mm), true)));
  datetimeType.attrs.set('second', new PyProperty(new PyBuiltin('second', (s) => BigInt(s._ss), true)));
  datetimeType.attrs.set('microsecond', new PyProperty(new PyBuiltin('microsecond', (s) => BigInt(s._us), true)));
  const dtIso = (s, sep) => `${pad(s._y, 4)}-${pad(s._m)}-${pad(s._d)}${sep}${pad(s._hh)}:${pad(s._mm)}:${pad(s._ss)}` + (s._us ? '.' + pad(s._us, 6) : '');
  datetimeType.attrs.set('isoformat', new PyBuiltin('isoformat', (s, a) => dtIso(s, a.length ? unwrap(a[0]) : 'T'), true));
  datetimeType.attrs.set('__str__', new PyBuiltin('__str__', (s) => dtIso(s, ' '), true));
  datetimeType.attrs.set('__repr__', new PyBuiltin('__repr__', (s) => {
    const parts = [s._y, s._m, s._d, s._hh, s._mm];
    if (s._ss || s._us) parts.push(s._ss);
    if (s._us) parts.push(s._us);
    return `datetime.datetime(${parts.join(', ')})`;
  }, true));
  datetimeType.attrs.set('date', new PyBuiltin('date', (s) => mkDate(dateType, s._y, s._m, s._d), true));
  datetimeType.attrs.set('strftime', strftime());
  classMethodSet(datetimeType, 'fromisoformat', (cls, a) => {
    const str = unwrap(a[0]);
    const [datePart, timePart] = str.split(/[T ]/);
    const [y, m, d] = datePart.split('-').map(Number);
    let hh = 0, mm = 0, ss = 0, us = 0;
    if (timePart) {
      const [hms, frac] = timePart.split('.');
      [hh, mm, ss] = hms.split(':').map(Number);
      if (frac) us = Number(frac.padEnd(6, '0').slice(0, 6));
    }
    return mkDT(y, m, d, hh, mm, ss || 0, us);
  });
  classMethodSet(datetimeType, 'combine', (cls, a) => { const d = a[0], t = a[1]; return mkDT(d._y, d._m, d._d, t._hh || 0, t._mm || 0, t._ss || 0, t._us || 0); });

  const timeType = new PyType('time', [TYPE_OBJECT], new Map(), { module: 'datetime' });
  timeType.construct = (args) => {
    const n = (i, def) => (args.length > i && args[i] !== NONE ? Number(numToBigInt(args[i])) : def);
    const inst = new PyInstance(timeType); inst._hh = n(0, 0); inst._mm = n(1, 0); inst._ss = n(2, 0); inst._us = n(3, 0); return inst;
  };
  timeType.attrs.set('hour', new PyProperty(new PyBuiltin('hour', (s) => BigInt(s._hh), true)));
  timeType.attrs.set('minute', new PyProperty(new PyBuiltin('minute', (s) => BigInt(s._mm), true)));
  timeType.attrs.set('second', new PyProperty(new PyBuiltin('second', (s) => BigInt(s._ss), true)));
  timeType.attrs.set('microsecond', new PyProperty(new PyBuiltin('microsecond', (s) => BigInt(s._us), true)));
  const timeIso = (s) => `${pad(s._hh)}:${pad(s._mm)}:${pad(s._ss)}` + (s._us ? '.' + pad(s._us, 6) : '');
  timeType.attrs.set('isoformat', new PyBuiltin('isoformat', (s) => timeIso(s), true));
  timeType.attrs.set('__str__', new PyBuiltin('__str__', (s) => timeIso(s), true));
  timeType.attrs.set('__repr__', new PyBuiltin('__repr__', (s) => `datetime.time(${s._hh}, ${s._mm}${s._ss || s._us ? ', ' + s._ss : ''}${s._us ? ', ' + s._us : ''})`, true));

  return mkmod('datetime', { date: dateType, time: timeType, datetime: datetimeType, timedelta, MINYEAR: 1n, MAXYEAR: 9999n });
});

// ---------- os / os.path ----------

function osPathEntries() {
  const norm = (p) => {
    const isAbs = p.startsWith('/');
    const parts = p.split('/');
    const out = [];
    for (const seg of parts) {
      if (seg === '' || seg === '.') continue;
      if (seg === '..') {
        if (out.length && out[out.length - 1] !== '..') out.pop();
        else if (!isAbs) out.push('..');
      } else out.push(seg);
    }
    let res = out.join('/');
    if (isAbs) res = '/' + res;
    return res || (isAbs ? '/' : '.');
  };
  return {
    join: bfn('join', (args) => {
      let path = unwrap(args[0]);
      for (let i = 1; i < args.length; i++) {
        const seg = unwrap(args[i]);
        if (seg.startsWith('/')) path = seg;
        else if (path === '' || path.endsWith('/')) path += seg;
        else path += '/' + seg;
      }
      return path;
    }),
    basename: bfn('basename', (args) => { const p = unwrap(args[0]); const i = p.lastIndexOf('/'); return i === -1 ? p : p.slice(i + 1); }),
    dirname: bfn('dirname', (args) => { const p = unwrap(args[0]); const i = p.lastIndexOf('/'); return i === -1 ? '' : (i === 0 ? '/' : p.slice(0, i)); }),
    split: bfn('split', (args) => { const p = unwrap(args[0]); const i = p.lastIndexOf('/'); if (i === -1) return new PyTuple(['', p]); const head = i === 0 ? '/' : p.slice(0, i); return new PyTuple([head, p.slice(i + 1)]); }),
    splitext: bfn('splitext', (args) => {
      const p = unwrap(args[0]); const slash = p.lastIndexOf('/');
      const base = p.slice(slash + 1); const dot = base.lastIndexOf('.');
      if (dot <= 0) return new PyTuple([p, '']);
      return new PyTuple([p.slice(0, slash + 1 + dot), base.slice(dot)]);
    }),
    isabs: bfn('isabs', (args) => unwrap(args[0]).startsWith('/')),
    normpath: bfn('normpath', (args) => norm(unwrap(args[0]))),
    abspath: bfn('abspath', (args) => { const p = unwrap(args[0]); return norm(p.startsWith('/') ? p : '/' + p); }),
    expanduser: bfn('expanduser', (args) => unwrap(args[0])),
    commonprefix: bfn('commonprefix', (args) => {
      const list = iterToArray(args[0]).map(unwrap);
      if (!list.length) return '';
      let prefix = list[0];
      for (const s of list) { let i = 0; while (i < prefix.length && i < s.length && prefix[i] === s[i]) i++; prefix = prefix.slice(0, i); }
      return prefix;
    }),
    sep: '/',
  };
}
reg('os.path', () => mkmod('os.path', osPathEntries()));
reg('os', (env) => {
  const environ = (env && env.environ) || {};
  const m = mkmod('os', {
    sep: '/',
    linesep: '\n',
    name: 'posix',
    getcwd: bfn('getcwd', () => (env && env.cwd) || '/'),
    environ: (() => { const d = new PyDict(); for (const [k, v] of Object.entries(environ)) d.set(k, String(v)); return d; })(),
    getenv: bfn('getenv', (args) => { const v = environ[unwrap(args[0])]; return v === undefined ? (args.length > 1 ? args[1] : NONE) : String(v); }),
  });
  m.attrs.set('path', mkmod('os.path', osPathEntries()));
  return m;
});

// ---------- pathlib ----------

reg('pathlib', () => {
  const PurePath = new PyType('PurePosixPath', [TYPE_OBJECT], new Map(), { module: 'pathlib' });
  const Path = new PyType('PosixPath', [PurePath], new Map(), { module: 'pathlib' });
  const normParts = (str) => {
    const isAbs = str.startsWith('/');
    const segs = str.split('/').filter((s) => s !== '' && s !== '.');
    return { isAbs, segs };
  };
  const mkPath = (cls, str) => { const inst = new PyInstance(cls); inst._p = str || '.'; return inst; };
  const buildPath = (cls, args) => {
    const parts = [];
    for (const a of args) {
      const s = a instanceof PyInstance && a._p !== undefined ? a._p : unwrap(a);
      parts.push(String(s));
    }
    let joined = '';
    for (const seg of parts) {
      if (seg.startsWith('/')) joined = seg;
      else if (joined === '' || joined.endsWith('/')) joined += seg;
      else joined += '/' + seg;
    }
    // normalize redundant slashes/dots (but keep '..')
    const { isAbs, segs } = normParts(joined || '.');
    let res = segs.join('/');
    if (isAbs) res = '/' + res;
    return mkPath(cls, res || (isAbs ? '/' : '.'));
  };
  for (const cls of [PurePath, Path]) {
    cls.construct = (args) => buildPath(cls, args);
    cls.attrs.set('__str__', new PyBuiltin('__str__', (self) => self._p, true));
    cls.attrs.set('__repr__', new PyBuiltin('__repr__', (self) => `${cls.name}(${pyRepr(self._p)})`, true));
    cls.attrs.set('__eq__', new PyBuiltin('__eq__', (self, a) => (a[0] instanceof PyInstance && a[0]._p !== undefined ? self._p === a[0]._p : NOT_IMPLEMENTED), true));
    cls.attrs.set('__hash__', new PyBuiltin('__hash__', (self) => BigInt(self._p.length), true));
    cls.attrs.set('__truediv__', new PyBuiltin('__truediv__', (self, a) => buildPath(cls, [self, a[0]]), true));
    cls.attrs.set('name', new PyProperty(new PyBuiltin('name', (self) => { const i = self._p.lastIndexOf('/'); const b = i === -1 ? self._p : self._p.slice(i + 1); return b === '/' ? '' : b; }, true)));
    cls.attrs.set('parent', new PyProperty(new PyBuiltin('parent', (self) => { const i = self._p.lastIndexOf('/'); if (i === -1) return mkPath(cls, '.'); if (i === 0) return mkPath(cls, '/'); return mkPath(cls, self._p.slice(0, i)); }, true)));
    cls.attrs.set('suffix', new PyProperty(new PyBuiltin('suffix', (self) => { const i = self._p.lastIndexOf('/'); const base = self._p.slice(i + 1); const dot = base.lastIndexOf('.'); return dot > 0 ? base.slice(dot) : ''; }, true)));
    cls.attrs.set('stem', new PyProperty(new PyBuiltin('stem', (self) => { const i = self._p.lastIndexOf('/'); const base = self._p.slice(i + 1); const dot = base.lastIndexOf('.'); return dot > 0 ? base.slice(0, dot) : base; }, true)));
    cls.attrs.set('parts', new PyProperty(new PyBuiltin('parts', (self) => { const { isAbs, segs } = normParts(self._p); return new PyTuple(isAbs ? ['/', ...segs] : segs); }, true)));
    cls.attrs.set('is_absolute', new PyBuiltin('is_absolute', (self) => self._p.startsWith('/'), true));
    cls.attrs.set('joinpath', new PyBuiltin('joinpath', (self, a) => buildPath(cls, [self, ...a]), true));
    cls.attrs.set('with_suffix', new PyBuiltin('with_suffix', (self, a) => { const suf = unwrap(a[0]); const i = self._p.lastIndexOf('/'); const base = self._p.slice(i + 1); const dot = base.lastIndexOf('.'); const stem = dot > 0 ? base.slice(0, dot) : base; return mkPath(cls, (i === -1 ? '' : self._p.slice(0, i + 1)) + stem + suf); }, true));
    cls.attrs.set('with_name', new PyBuiltin('with_name', (self, a) => { const i = self._p.lastIndexOf('/'); return mkPath(cls, (i === -1 ? '' : self._p.slice(0, i + 1)) + unwrap(a[0])); }, true));
  }
  return mkmod('pathlib', { Path, PurePath, PurePosixPath: PurePath, PosixPath: Path });
});

// ---------- pprint ----------

reg('pprint', () => {
  // repr with dict keys optionally sorted (recursively).
  const reprSorted = (obj, sortDicts) => {
    const u = unwrap(obj);
    if (u instanceof PyDict) {
      const entries = [...u.entries()];
      if (sortDicts) entries.sort((a, b) => (richCompare('<', a[0], b[0]) ? -1 : richCompare('<', b[0], a[0]) ? 1 : 0));
      return '{' + entries.map(([k, v]) => reprSorted(k, sortDicts) + ': ' + reprSorted(v, sortDicts)).join(', ') + '}';
    }
    if (u instanceof PyList) return '[' + u.items.map((x) => reprSorted(x, sortDicts)).join(', ') + ']';
    if (u instanceof PyTuple) {
      const parts = u.items.map((x) => reprSorted(x, sortDicts));
      return '(' + parts.join(', ') + (parts.length === 1 ? ',' : '') + ')';
    }
    if (u instanceof PySet && !u.frozen) {
      if (!u.size) return 'set()';
      const ks = u.keysArray().slice().sort((a, b) => (richCompare('<', a, b) ? -1 : richCompare('<', b, a) ? 1 : 0));
      return '{' + ks.map((x) => reprSorted(x, sortDicts)).join(', ') + '}';
    }
    return pyRepr(obj);
  };
  const fmt = (obj, indent, width, sortDicts) => {
    const oneline = reprSorted(obj, sortDicts);
    if (indent + oneline.length <= width && !oneline.includes('\n')) return oneline;
    const u = unwrap(obj);
    if (u instanceof PyDict) {
      const entries = [...u.entries()];
      if (sortDicts) entries.sort((a, b) => (richCompare('<', a[0], b[0]) ? -1 : richCompare('<', b[0], a[0]) ? 1 : 0));
      if (!entries.length) return '{}';
      const inner = indent + 1;
      const pad = ' '.repeat(inner);
      const lines = entries.map(([k, v]) => {
        const kr = reprSorted(k, sortDicts) + ': ';
        return kr + fmt(v, inner + kr.length, width, sortDicts);
      });
      return '{' + lines.join(',\n' + pad) + '}';
    }
    if (u instanceof PyList || u instanceof PyTuple) {
      const items = u.items;
      if (!items.length) return u instanceof PyList ? '[]' : '()';
      const open = u instanceof PyList ? '[' : '(';
      const close = u instanceof PyList ? ']' : ')';
      const inner = indent + 1;
      const pad = ' '.repeat(inner);
      const lines = items.map((x) => fmt(x, inner, width, sortDicts));
      let body = lines.join(',\n' + pad);
      if (u instanceof PyTuple && items.length === 1) body += ',';
      return open + body + close;
    }
    return oneline;
  };
  const getKwNum = (kwargs, name, def) => (kwargs && kwargs.has(name) && kwargs.get(name) !== NONE ? Number(numToBigInt(kwargs.get(name))) : def);
  const getKwBool = (kwargs, name, def) => (kwargs && kwargs.has(name) ? pyTruthy(kwargs.get(name)) : def);
  const pformat = (args, kwargs) => {
    const width = getKwNum(kwargs, 'width', 80);
    const sortDicts = getKwBool(kwargs, 'sort_dicts', true);
    return fmt(args[0], 0, width, sortDicts);
  };
  return mkmod('pprint', {
    pformat: bfn('pformat', (args, kwargs) => pformat(args, kwargs)),
    pprint: bfn('pprint', (args, kwargs) => { IO.write(pformat(args, kwargs) + '\n'); return NONE; }),
  });
});

// ---------- re ----------

reg('re', () => {
  const I = 2n, M = 8n, S = 16n, X = 64n;
  // Translate a Python regex to JS: named groups, backrefs, \A/\Z, verbose.
  const translate = (pat, flags) => {
    let p = pat;
    if (flags & X) {
      // VERBOSE: strip unescaped whitespace and # comments (outside classes).
      let out = ''; let inClass = false;
      for (let i = 0; i < p.length; i++) {
        const c = p[i];
        if (c === '\\') { out += c + (p[i + 1] || ''); i++; continue; }
        if (c === '[') inClass = true;
        if (c === ']') inClass = false;
        if (!inClass && /\s/.test(c)) continue;
        if (!inClass && c === '#') { while (i < p.length && p[i] !== '\n') i++; continue; }
        out += c;
      }
      p = out;
    }
    p = p.replace(/\(\?P<([A-Za-z_]\w*)>/g, '(?<$1>');
    p = p.replace(/\(\?P=([A-Za-z_]\w*)\)/g, '\\k<$1>');
    p = p.replace(/\\A/g, '^').replace(/\\Z/g, '$');
    return p;
  };
  const jsFlags = (flags) => {
    let f = 'dg';
    if (flags & I) f += 'i';
    if (flags & M) f += 'm';
    if (flags & S) f += 's';
    return f;
  };

  const MatchType = new PyType('Match', [TYPE_OBJECT], new Map(), { module: 're' });
  const makeMatch = (m, input) => {
    const inst = new PyInstance(MatchType);
    inst._m = m; inst._input = input;
    return inst;
  };
  const groupVal = (self, g) => {
    const m = self._m;
    if (typeof g === 'bigint' || typeof g === 'boolean') {
      const n = Number(numToBigInt(g));
      const v = m[n];
      return v === undefined ? NONE : v;
    }
    const name = unwrap(g);
    const v = m.groups ? m.groups[name] : undefined;
    if (v === undefined && (!m.groups || !(name in m.groups))) raiseError('IndexError', 'no such group');
    return v === undefined ? NONE : v;
  };
  MatchType.attrs.set('group', new PyBuiltin('group', (self, args) => {
    if (args.length <= 1) return groupVal(self, args.length ? args[0] : 0n);
    return new PyTuple(args.map((g) => groupVal(self, g)));
  }, true));
  MatchType.attrs.set('groups', new PyBuiltin('groups', (self, args) => {
    const def = args.length ? args[0] : NONE;
    return new PyTuple(self._m.slice(1).map((v) => (v === undefined ? def : v)));
  }, true));
  MatchType.attrs.set('groupdict', new PyBuiltin('groupdict', (self, args) => {
    const def = args.length ? args[0] : NONE;
    const d = new PyDict();
    const g = self._m.groups || {};
    for (const k of Object.keys(g)) d.set(k, g[k] === undefined ? def : g[k]);
    return d;
  }, true));
  const spanOf = (self, g) => {
    const n = g === undefined ? 0 : (typeof g === 'bigint' ? Number(g) : g);
    const idx = self._m.indices && self._m.indices[n];
    return idx ? [idx[0], idx[1]] : [-1, -1];
  };
  MatchType.attrs.set('start', new PyBuiltin('start', (self, args) => BigInt(spanOf(self, args[0])[0]), true));
  MatchType.attrs.set('end', new PyBuiltin('end', (self, args) => BigInt(spanOf(self, args[0])[1]), true));
  MatchType.attrs.set('span', new PyBuiltin('span', (self, args) => { const s = spanOf(self, args[0]); return new PyTuple([BigInt(s[0]), BigInt(s[1])]); }, true));
  MatchType.attrs.set('__repr__', new PyBuiltin('__repr__', (self) => {
    const s = spanOf(self, 0);
    return `<re.Match object; span=(${s[0]}, ${s[1]}), match=${pyRepr(self._m[0])}>`;
  }, true));

  const compiledFlags = (self) => self._flags;
  const reExec = (pat, flags, input, anchored, full) => {
    const re = new RegExp(translate(pat, flags), jsFlags(flags) + (anchored ? 'y' : ''));
    re.lastIndex = 0;
    const m = re.exec(input);
    if (!m) return NONE;
    if (anchored && m.index !== 0) return NONE;
    if (full && m[0].length !== input.length) return NONE;
    return makeMatch(m, input);
  };
  const PatternType = new PyType('Pattern', [TYPE_OBJECT], new Map(), { module: 're' });
  const makePattern = (pat, flags) => {
    const inst = new PyInstance(PatternType);
    inst._pat = unwrap(pat); inst._flags = flags;
    return inst;
  };
  PatternType.attrs.set('match', new PyBuiltin('match', (self, args) => reExec(self._pat, self._flags, unwrap(args[0]), true, false), true));
  PatternType.attrs.set('fullmatch', new PyBuiltin('fullmatch', (self, args) => reExec(self._pat, self._flags, unwrap(args[0]), true, true), true));
  PatternType.attrs.set('search', new PyBuiltin('search', (self, args) => reExec(self._pat, self._flags, unwrap(args[0]), false, false), true));
  PatternType.attrs.set('findall', new PyBuiltin('findall', (self, args) => reFindall(self._pat, self._flags, unwrap(args[0])), true));
  PatternType.attrs.set('finditer', new PyBuiltin('finditer', (self, args) => reFinditer(self._pat, self._flags, unwrap(args[0])), true));
  PatternType.attrs.set('sub', new PyBuiltin('sub', (self, args) => reSub(self._pat, self._flags, args[0], unwrap(args[1]), args.length > 2 ? Number(numToBigInt(args[2])) : 0), true));
  PatternType.attrs.set('split', new PyBuiltin('split', (self, args) => reSplit(self._pat, self._flags, unwrap(args[0]), args.length > 1 ? Number(numToBigInt(args[1])) : 0), true));
  PatternType.attrs.set('pattern', new PyProperty(new PyBuiltin('pattern', (self) => self._pat, true)));

  const allMatches = (pat, flags, input) => {
    const re = new RegExp(translate(pat, flags), jsFlags(flags));
    const out = []; let m;
    while ((m = re.exec(input)) !== null) {
      out.push(m);
      if (m[0] === '') re.lastIndex++;
    }
    return out;
  };
  const reFindall = (pat, flags, input) => {
    const ms = allMatches(pat, flags, input);
    return new PyList(ms.map((m) => {
      if (m.length === 1) return m[0];
      if (m.length === 2) return m[1] === undefined ? '' : m[1];
      return new PyTuple(m.slice(1).map((v) => (v === undefined ? '' : v)));
    }));
  };
  const reFinditer = (pat, flags, input) => {
    const ms = allMatches(pat, flags, input);
    let i = 0;
    return new PyIterator(() => (i < ms.length ? makeMatch(ms[i++], input) : DONE), 'callable_iterator');
  };
  const reSub = (pat, flags, repl, input, count) => {
    const ms = allMatches(pat, flags, input);
    let out = ''; let last = 0; let n = 0;
    for (const m of ms) {
      if (count && n >= count) break;
      out += input.slice(last, m.index);
      if (typeof unwrap(repl) === 'string') {
        out += unwrap(repl).replace(/\\(\d+)|\\g<([A-Za-z_]\w*)>/g, (_, num, name) => {
          if (num !== undefined) return m[Number(num)] || '';
          return (m.groups && m.groups[name]) || '';
        });
      } else {
        out += unwrap(pyCall(repl, [makeMatch(m, input)]));
      }
      last = m.index + m[0].length;
      n++;
    }
    out += input.slice(last);
    return out;
  };
  const reSplit = (pat, flags, input, maxsplit) => {
    const ms = allMatches(pat, flags, input);
    const parts = []; let last = 0; let n = 0;
    for (const m of ms) {
      if (maxsplit && n >= maxsplit) break;
      if (m[0] === '') continue;
      parts.push(input.slice(last, m.index));
      for (let i = 1; i < m.length; i++) parts.push(m[i] === undefined ? NONE : m[i]);
      last = m.index + m[0].length;
      n++;
    }
    parts.push(input.slice(last));
    return new PyList(parts);
  };

  const getFlags = (args, idx) => (args.length > idx && args[idx] !== NONE ? numToBigInt(args[idx]) : 0n);
  return mkmod('re', {
    compile: bfn('compile', (args) => makePattern(args[0], getFlags(args, 1))),
    match: bfn('match', (args) => reExec(unwrap(args[0]), getFlags(args, 2), unwrap(args[1]), true, false)),
    fullmatch: bfn('fullmatch', (args) => reExec(unwrap(args[0]), getFlags(args, 2), unwrap(args[1]), true, true)),
    search: bfn('search', (args) => reExec(unwrap(args[0]), getFlags(args, 2), unwrap(args[1]), false, false)),
    findall: bfn('findall', (args) => reFindall(unwrap(args[0]), getFlags(args, 2), unwrap(args[1]))),
    finditer: bfn('finditer', (args) => reFinditer(unwrap(args[0]), getFlags(args, 2), unwrap(args[1]))),
    sub: bfn('sub', (args) => reSub(unwrap(args[0]), getFlags(args, 4), args[1], unwrap(args[2]), args.length > 3 ? Number(numToBigInt(args[3])) : 0)),
    split: bfn('split', (args) => reSplit(unwrap(args[0]), getFlags(args, 3), unwrap(args[1]), args.length > 2 ? Number(numToBigInt(args[2])) : 0)),
    escape: bfn('escape', (args) => unwrap(args[0]).replace(/[.^$*+?()[\]{}|\\\-#&~]/g, '\\$&')),
    IGNORECASE: I, I, MULTILINE: M, M, DOTALL: S, S, VERBOSE: X, X,
    A: 256n, ASCII: 256n,
  });
});

// ---------- enum ----------

reg('enum', () => {
  const AutoType = new PyType('auto', [TYPE_OBJECT], new Map(), { module: 'enum' });
  AutoType.construct = () => new PyInstance(AutoType);

  const isMethodLike = (v) => v instanceof PyFunction || v instanceof PyBuiltin
    || v instanceof PyProperty || v instanceof PyClassMethod || v instanceof PyStaticMethod;

  const makeBase = (name, intLike) => {
    const Base = new PyType(name, [TYPE_OBJECT], new Map(), { module: 'enum' });
    Base.attrs.set('name', new PyProperty(new PyBuiltin('name', (self) => self.attrs.get('_name_'), true)));
    Base.attrs.set('value', new PyProperty(new PyBuiltin('value', (self) => self.attrs.get('_value_'), true)));
    Base.attrs.set('__repr__', new PyBuiltin('__repr__', (self) =>
      `<${self.cls.name}.${self.attrs.get('_name_')}: ${pyRepr(self.attrs.get('_value_'))}>`, true));
    Base.attrs.set('__str__', new PyBuiltin('__str__', (self) =>
      `${self.cls.name}.${self.attrs.get('_name_')}`, true));
    if (intLike) {
      Base.attrs.set('__str__', new PyBuiltin('__str__', (self) => pyStr(self.attrs.get('_value_')), true));
      Base.attrs.set('__hash__', new PyBuiltin('__hash__', (self) => numToBigInt(self.attrs.get('_value_')), true));
      Base.attrs.set('__int__', new PyBuiltin('__int__', (self) => numToBigInt(self.attrs.get('_value_')), true));
      Base.attrs.set('__index__', new PyBuiltin('__index__', (self) => numToBigInt(self.attrs.get('_value_')), true));
    } else {
      Base.attrs.set('__hash__', new PyBuiltin('__hash__', (self) => BigInt(self.attrs.get('_enumId') || 0), true));
    }
    Base.attrs.set('__init_subclass__', new PyClassMethod(new PyBuiltin('__init_subclass__', (cls) => {
      const members = new Map();
      const byValue = new Map();
      const list = [];
      let autoCounter = 0n;
      let idCounter = 0;
      for (const [n, val] of [...cls.attrs]) {
        if (n.startsWith('_') || isMethodLike(val)) continue;
        let value = val;
        if (val instanceof PyInstance && val.cls === AutoType) { value = ++autoCounter; }
        else if (typeof val === 'bigint') { autoCounter = val; }
        const vk = hashKey(value);
        if (byValue.has(vk)) { // alias
          const existing = byValue.get(vk);
          cls.attrs.set(n, existing);
          members.set(n, existing);
          continue;
        }
        const member = new PyInstance(cls);
        member.attrs.set('_name_', n);
        member.attrs.set('_value_', value);
        member.attrs.set('_enumId', ++idCounter);
        if (intLike) member.payload = value;
        cls.attrs.set(n, member);
        members.set(n, member);
        byValue.set(vk, member);
        list.push(member);
      }
      cls._enumMembers = members;
      cls._enumList = list;
      const mm = new PyDict();
      for (const [n, m] of members) mm.set(n, m);
      cls.attrs.set('__members__', mm);
      cls.construct = (args) => {
        if (args.length !== 1) raiseError('TypeError', `${cls.name} expected 1 argument`);
        const arg = args[0];
        if (arg instanceof PyInstance && arg.cls === cls) return arg;
        const m = byValue.get(hashKey(arg));
        if (m) return m;
        raiseError('ValueError', `${pyRepr(arg)} is not a valid ${cls.name}`);
      };
      return NONE;
    }, true)));
    return Base;
  };

  const Enum = makeBase('Enum', false);
  const IntEnum = new PyType('IntEnum', [Enum], new Map(), { module: 'enum' });
  // IntEnum reuses Enum's machinery but compares as int.
  const IntEnumBase = makeBase('IntEnum', true);
  for (const [k, v] of IntEnumBase.attrs) IntEnum.attrs.set(k, v);

  return mkmod('enum', {
    Enum,
    IntEnum,
    auto: AutoType,
    unique: bfn('unique', (a) => a[0]),
  });
});

// ---------- fractions ----------

reg('fractions', () => {
  const bgcd = (a, b) => { a = a < 0n ? -a : a; b = b < 0n ? -b : b; while (b) { [a, b] = [b, a % b]; } return a; };
  const Fraction = new PyType('Fraction', [TYPE_OBJECT], new Map(), { module: 'fractions' });
  const make = (n, d) => {
    if (d === 0n) raiseError('ZeroDivisionError', 'Fraction(%s, 0)');
    if (d < 0n) { n = -n; d = -d; }
    const g = bgcd(n, d) || 1n;
    const inst = new PyInstance(Fraction);
    inst._n = n / g; inst._d = d / g;
    return inst;
  };
  // Parse a float into an exact numerator/denominator pair.
  const floatToFrac = (x) => {
    if (!Number.isFinite(x)) raiseError('OverflowError', 'cannot convert to Fraction');
    if (Number.isInteger(x)) return [BigInt(x), 1n];
    const buf = new DataView(new ArrayBuffer(8));
    buf.setFloat64(0, x);
    const bits = buf.getBigUint64(0);
    const sign = (bits >> 63n) ? -1n : 1n;
    const exp = Number((bits >> 52n) & 0x7ffn);
    let mant = bits & 0xfffffffffffffn;
    let e;
    if (exp === 0) { e = -1074; } else { mant |= 0x10000000000000n; e = exp - 1075; }
    let n = sign * mant, d = 1n;
    if (e >= 0) n <<= BigInt(e); else d <<= BigInt(-e);
    const g = bgcd(n, d) || 1n;
    return [n / g, d / g];
  };
  const asFrac = (v) => {
    if (typeof v === 'bigint') return [v, 1n];
    if (typeof v === 'boolean') return [v ? 1n : 0n, 1n];
    if (v instanceof PyInstance && v.cls === Fraction) return [v._n, v._d];
    return null;
  };
  Fraction.construct = (args) => {
    if (args.length === 0) return make(0n, 1n);
    const a = args[0];
    if (args.length >= 2) {
      const fn = asFrac(a); const fd = asFrac(args[1]);
      if (!fn || !fd) raiseError('TypeError', 'both arguments should be Rational instances');
      return make(fn[0] * fd[1], fn[1] * fd[0]);
    }
    const u = unwrap(a);
    if (typeof u === 'string') {
      const s = u.trim();
      let m = s.match(/^([+-]?\d+)\s*\/\s*(\d+)$/);
      if (m) return make(BigInt(m[1]), BigInt(m[2]));
      m = s.match(/^([+-]?)(\d*)\.(\d+)$/);
      if (m) { const sign = m[1] === '-' ? -1n : 1n; const ip = m[2] || '0'; const fp = m[3]; return make(sign * BigInt(ip + fp), 10n ** BigInt(fp.length)); }
      m = s.match(/^[+-]?\d+$/);
      if (m) return make(BigInt(s), 1n);
      raiseError('ValueError', `Invalid literal for Fraction: ${pyRepr(u)}`);
    }
    if (typeof u === 'number') { const [n, d] = floatToFrac(u); return make(n, d); }
    const f = asFrac(a);
    if (f) return make(f[0], f[1]);
    raiseError('TypeError', 'argument should be a string or a Rational instance');
  };
  Fraction.attrs.set('numerator', new PyProperty(new PyBuiltin('numerator', (self) => self._n, true)));
  Fraction.attrs.set('denominator', new PyProperty(new PyBuiltin('denominator', (self) => self._d, true)));
  Fraction.attrs.set('__repr__', new PyBuiltin('__repr__', (self) => `Fraction(${self._n}, ${self._d})`, true));
  Fraction.attrs.set('__str__', new PyBuiltin('__str__', (self) => (self._d === 1n ? `${self._n}` : `${self._n}/${self._d}`), true));
  Fraction.attrs.set('__float__', new PyBuiltin('__float__', (self) => Number(self._n) / Number(self._d), true));
  Fraction.attrs.set('__int__', new PyBuiltin('__int__', (self) => self._n / self._d, true));
  Fraction.attrs.set('__neg__', new PyBuiltin('__neg__', (self) => make(-self._n, self._d), true));
  Fraction.attrs.set('__abs__', new PyBuiltin('__abs__', (self) => make(self._n < 0n ? -self._n : self._n, self._d), true));
  Fraction.attrs.set('__bool__', new PyBuiltin('__bool__', (self) => self._n !== 0n, true));
  Fraction.attrs.set('__hash__', new PyBuiltin('__hash__', (self) => (self._d === 1n ? self._n : Number(self._n) / Number(self._d) * 1n), true));
  const toF = (self) => Number(self._n) / Number(self._d);
  const arith = (name, ratFn, floatOp, reflected) => {
    Fraction.attrs.set(name, new PyBuiltin(name, (self, args) => {
      const o = args[0];
      if (typeof unwrap(o) === 'number') return reflected ? binOp(floatOp, unwrap(o), toF(self)) : binOp(floatOp, toF(self), unwrap(o));
      const fo = asFrac(o);
      if (!fo) return NOT_IMPLEMENTED;
      const a = [self._n, self._d];
      return reflected ? ratFn(fo, a) : ratFn(a, fo);
    }, true));
  };
  arith('__add__', (a, b) => make(a[0] * b[1] + b[0] * a[1], a[1] * b[1]), '+', false);
  arith('__radd__', (a, b) => make(a[0] * b[1] + b[0] * a[1], a[1] * b[1]), '+', true);
  arith('__sub__', (a, b) => make(a[0] * b[1] - b[0] * a[1], a[1] * b[1]), '-', false);
  arith('__rsub__', (a, b) => make(a[0] * b[1] - b[0] * a[1], a[1] * b[1]), '-', true);
  arith('__mul__', (a, b) => make(a[0] * b[0], a[1] * b[1]), '*', false);
  arith('__rmul__', (a, b) => make(a[0] * b[0], a[1] * b[1]), '*', true);
  arith('__truediv__', (a, b) => make(a[0] * b[1], a[1] * b[0]), '/', false);
  arith('__rtruediv__', (a, b) => make(a[0] * b[1], a[1] * b[0]), '/', true);
  const cmpVal = (self, o) => {
    const fo = asFrac(o);
    if (fo) { const l = self._n * fo[1]; const r = fo[0] * self._d; return l < r ? -1 : l > r ? 1 : 0; }
    if (typeof unwrap(o) === 'number') { const a = toF(self); const b = unwrap(o); return a < b ? -1 : a > b ? 1 : 0; }
    return null;
  };
  Fraction.attrs.set('__eq__', new PyBuiltin('__eq__', (self, args) => { const c = cmpVal(self, args[0]); return c === null ? NOT_IMPLEMENTED : c === 0; }, true));
  for (const [name, test] of [['__lt__', (c) => c < 0], ['__le__', (c) => c <= 0], ['__gt__', (c) => c > 0], ['__ge__', (c) => c >= 0]]) {
    Fraction.attrs.set(name, new PyBuiltin(name, (self, args) => { const c = cmpVal(self, args[0]); return c === null ? NOT_IMPLEMENTED : test(c); }, true));
  }
  return mkmod('fractions', { Fraction });
});

// ---------- textwrap ----------

reg('textwrap', () => {
  const wrapText = (text, width) => {
    const words = text.split(/\s+/).filter((w) => w.length);
    const lines = [];
    let cur = '';
    for (const w of words) {
      if (!cur) cur = w;
      else if (cur.length + 1 + w.length <= width) cur += ' ' + w;
      else { lines.push(cur); cur = w; }
    }
    if (cur) lines.push(cur);
    return lines;
  };
  const getWidth = (args, kwargs, idx) => {
    if (args.length > idx && args[idx] !== NONE) return Number(numToBigInt(args[idx]));
    if (kwargs && kwargs.has('width')) return Number(numToBigInt(kwargs.get('width')));
    return 70;
  };
  return mkmod('textwrap', {
    wrap: bfn('wrap', (args, kwargs) => new PyList(wrapText(unwrap(args[0]), getWidth(args, kwargs, 1)))),
    fill: bfn('fill', (args, kwargs) => wrapText(unwrap(args[0]), getWidth(args, kwargs, 1)).join('\n')),
    shorten: bfn('shorten', (args, kwargs) => {
      const width = getWidth(args, kwargs, 1);
      const ph = kwargs && kwargs.has('placeholder') ? unwrap(kwargs.get('placeholder')) : ' [...]';
      const words = unwrap(args[0]).split(/\s+/).filter((w) => w.length);
      let s = words.join(' ');
      if (s.length <= width) return s;
      const out = [];
      for (const w of words) {
        const cand = out.concat(w).join(' ');
        if (cand.length + ph.length > width) break;
        out.push(w);
      }
      return out.length ? out.join(' ') + ph : ph.trimStart();
    }),
    dedent: bfn('dedent', (args) => {
      const lines = unwrap(args[0]).split('\n');
      let prefix = null;
      for (const line of lines) {
        if (!line.trim().length) continue;
        const m = line.match(/^[ \t]*/)[0];
        if (prefix === null) prefix = m;
        else { let i = 0; while (i < prefix.length && i < m.length && prefix[i] === m[i]) i++; prefix = prefix.slice(0, i); }
      }
      prefix = prefix || '';
      return lines.map((l) => (l.trim().length ? l.slice(prefix.length) : l.replace(/^[ \t]+$/, ''))).join('\n');
    }),
    indent: bfn('indent', (args) => {
      const prefix = unwrap(args[1]);
      return unwrap(args[0]).split('\n').map((l, i, arr) => (l.length || i < arr.length - 1 ? (l.trim().length ? prefix + l : l) : l)).join('\n');
    }),
  });
});

// Shared utilities for sibling module files (math, itertools, ...) to import.
export {
  reg, mkmod, bfn, getKw,
  NONE, NOT_IMPLEMENTED, DONE,
  PyList, PyTuple, PyDict, PySet, PyBuiltin, PyModule, PyType, PyInstance,
  PyProperty, PyIterator, PyError, TYPE_OBJECT, EXC,
  raiseError, pyCall, numToBigInt, bigIntToNumber, iterToArray, pyTruthy,
  pyEq, pyStr, pyRepr, typeOf, unwrap, isNum, hashKey, richCompare,
  binOp, unaryOp, getItem, getAttr, pyIter, floatRepr,
};
