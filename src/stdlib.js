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
  TYPE_OBJECT, TYPE_DICT, EXC,
  raiseError, pyCall, numToBigInt, bigIntToNumber, iterToArray, pyTruthy,
  pyEq, pyStr, pyRepr, typeOf, unwrap, isNum, hashKey, richCompare,
  binOp, unaryOp, getItem, getAttr, pyIter,
} from './objects.js';
import { floatRepr } from './fmt.js';
import { IO } from './builtins.js';

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
  return mkmod('string', {
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
    contains: bfn('contains', (args) => pyTruthy(richContains(args[1], args[0]))),
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

function richContains(container, item) {
  // operator.contains(a, b) == (b in a). Reuse pyContains via objects? Not exported here;
  // emulate with iteration / pyEq for the common path.
  const c = unwrap(container);
  if (typeof c === 'string') return c.includes(unwrap(item));
  if (c instanceof PyList || c instanceof PyTuple) return c.items.some((x) => pyEq(x, item));
  if (c instanceof PyDict) return c.has(item);
  if (c instanceof PySet) return c.has(item);
  const it = pyIter(container);
  for (;;) {
    const x = it.next();
    if (x === DONE) return false;
    if (pyEq(x, item)) return true;
  }
}

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
    maxsize: 9007199254740991n,
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

  const wraps = bfn('wraps', () => bfn('decorator', (a) => a[0]));

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

  const reduceMod = mkmod('functools', {
    reduce,
    partial,
    wraps,
    lru_cache: lruCache,
    cache,
    cmp_to_key: cmpToKey,
    update_wrapper: bfn('update_wrapper', (args) => args[0]),
    total_ordering: bfn('total_ordering', (args) => args[0]),
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

  const groupby = bfn('groupby', (args) => {
    const arr = iterToArray(args[0]);
    const keyFn = args.length > 1 && args[1] !== NONE ? args[1] : null;
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

  return mkmod('itertools', {
    count, cycle, repeat, chain, islice, product,
    permutations, combinations, combinations_with_replacement: combinationsWR,
    accumulate, zip_longest: zipLongest, groupby, starmap,
    takewhile, dropwhile, filterfalse, pairwise,
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
    const entries = [...self.payload.entries()];
    const sorted = entries
      .map((e, idx) => ({ e, idx }))
      .sort((a, b) => {
        const c = richCompare('>', a.e[1], b.e[1]) ? -1 : richCompare('<', a.e[1], b.e[1]) ? 1 : 0;
        return c !== 0 ? c : a.idx - b.idx;
      })
      .map((x) => new PyTuple([x.e[0], x.e[1]]));
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
    const entries = [...self.payload.entries()];
    if (!entries.length) return 'Counter()';
    const sorted = entries
      .map((e, idx) => ({ e, idx }))
      .sort((a, b) => {
        const c = richCompare('>', a.e[1], b.e[1]) ? -1 : richCompare('<', a.e[1], b.e[1]) ? 1 : 0;
        return c !== 0 ? c : a.idx - b.idx;
      });
    return 'Counter({' + sorted.map((x) => pyRepr(x.e[0]) + ': ' + pyRepr(x.e[1])).join(', ') + '})';
  }, true));

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
  const namedtuple = bfn('namedtuple', (args) => {
    const typename = unwrap(args[0]);
    let fields;
    const fieldsArg = unwrap(args[1]);
    if (typeof fieldsArg === 'string') {
      fields = fieldsArg.replace(/,/g, ' ').split(/\s+/).filter((s) => s.length);
    } else {
      fields = iterToArray(args[1]).map((f) => unwrap(f));
    }
    const NT = new PyType(typename, [TYPE_OBJECT], new Map(), { module: '__main__' });
    NT.construct = (a, kw) => {
      const inst = new PyInstance(NT);
      const vals = new Array(fields.length);
      let filled = 0;
      for (let i = 0; i < a.length && i < fields.length; i++) { vals[i] = a[i]; filled++; }
      if (a.length > fields.length) raiseError('TypeError', `__new__() takes ${fields.length + 1} positional arguments but ${a.length + 1} were given`);
      if (kw) for (const [k, v] of kw) { const fi = fields.indexOf(k); if (fi === -1) raiseError('TypeError', `__new__() got an unexpected keyword argument '${k}'`); vals[fi] = v; if (vals[fi] !== undefined) filled++; }
      for (let i = 0; i < fields.length; i++) if (vals[i] === undefined) raiseError('TypeError', `__new__() missing argument: '${fields[i]}'`);
      inst.payload = new PyTuple(vals);
      return inst;
    };
    fields.forEach((f, i) => {
      NT.attrs.set(f, new PyProperty(new PyBuiltin(f, (self) => self.payload.items[i], true)));
    });
    NT.attrs.set('_fields', new PyTuple(fields.map(String)));
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

  return mkmod('collections', {
    defaultdict: DefaultDict,
    Counter,
    deque: Deque,
    namedtuple,
    OrderedDict: TYPE_DICT,
    abc: mkmod('collections.abc', {}),
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
