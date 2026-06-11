// Core object model: value classes, type system (C3 MRO), attribute access,
// operator dispatch, hashing/equality, iteration, repr/str/format.
//
// Value representation:
//   int   -> BigInt          float -> JS number      bool -> JS boolean
//   str   -> JS string       None  -> NONE sentinel
//   list/tuple/dict/set/...  -> classes below
//
// Calls back into Python code (dunders etc.) go through a hook that the
// interpreter installs at startup (setCallHook).

import {
  floatRepr, formatFixedAbs, formatSigAbs, groupDigits,
} from './fmt.js';

// ---------- sentinels ----------

export const NONE = Object.freeze({ __none__: true });
export const NOT_IMPLEMENTED = Object.freeze({ __notimplemented__: true });
export const PY_ELLIPSIS = Object.freeze({ __ellipsis__: true });
export const DONE = Symbol('iteration-done');

// ---------- value classes ----------

export class PyList { constructor(items = []) { this.items = items; } }
export class PyTuple { constructor(items = []) { this.items = items; } }

export class PyRange {
  constructor(start, stop, step) { this.start = start; this.stop = stop; this.step = step; }
  length() {
    const { start, stop, step } = this;
    if (step > 0n) return stop > start ? (stop - start + step - 1n) / step : 0n;
    return start > stop ? (start - stop - step - 1n) / (-step) : 0n;
  }
  item(i) { return this.start + this.step * i; }
}

export class PySlice {
  constructor(start, stop, step) { this.start = start; this.stop = stop; this.step = step; }
}

export class PyFunction {
  constructor(name, params, body, closure, scopeInfo, isGenerator) {
    this.name = name;
    this.params = params;
    this.body = body;
    this.closure = closure;
    this.scopeInfo = scopeInfo;
    this.isGenerator = isGenerator;
    this.definingClass = null;
    this.attrs = new Map();
    this.doc = NONE;
  }
}

export class PyBuiltin {
  constructor(name, fn, isMethod = false) {
    this.name = name;
    this.fn = fn; // plain: fn(args, kwargs); method: fn(self, args, kwargs)
    this.isMethod = isMethod;
  }
}

export class PyBoundMethod {
  constructor(func, self) { this.func = func; this.self = self; }
}

export class PyType {
  constructor(name, bases, attrs = new Map(), opts = {}) {
    this.name = name;
    this.bases = bases;
    this.attrs = attrs;
    this.builtin = !!opts.builtin;
    this.module = opts.module || 'builtins';
    this.construct = opts.construct || null;       // builtin constructor
    this.payloadFactory = opts.payloadFactory || null; // for subclassing builtins
    this.mro = bases.length ? computeMro(this) : [this];
  }
}

export class PyInstance {
  constructor(cls) {
    this.cls = cls;
    this.attrs = new Map();
    this.payload = null; // for subclasses of list/dict/set/tuple/str
  }
}

export class PyModule {
  constructor(name, attrs = new Map()) { this.name = name; this.attrs = attrs; }
}

export class PyProperty {
  constructor(fget, fset, fdel, doc) {
    this.fget = fget || NONE;
    this.fset = fset || NONE;
    this.fdel = fdel || NONE;
    this.doc = doc || NONE;
  }
}

export class PyClassMethod { constructor(func) { this.func = func; } }
export class PyStaticMethod { constructor(func) { this.func = func; } }

export class PySuper {
  constructor(startType, obj) { this.startType = startType; this.obj = obj; }
}

// Generic JS-backed iterator (result of iter(), enumerate(), zip(), map(), ...)
export class PyIterator {
  constructor(nextFn, typeName = 'iterator') {
    this.nextFn = nextFn; // returns a value or DONE
    this.typeName = typeName;
  }
}

export class PyGenerator {
  constructor(it, name = '<genexpr>') {
    this.it = it; // JS iterator: next(v) -> {done, value}; yields Python values
    this.name = name;
    this.state = 'created'; // created | running | suspended | done
  }

  nextValue(sendVal) {
    if (this.state === 'done') return DONE;
    if (this.state === 'running') raiseError('ValueError', 'generator already executing');
    if (this.state === 'created' && sendVal !== NONE && sendVal !== undefined) {
      raiseError('TypeError', "can't send non-None value to a just-started generator");
    }
    this.state = 'running';
    let r;
    try {
      r = this.it.next(sendVal === undefined ? NONE : sendVal);
    } catch (e) {
      this.state = 'done';
      if (e instanceof PyError && isInstanceOf(e.pyExc, EXC.StopIteration)) {
        // PEP 479
        const re = makeExc('RuntimeError', 'generator raised StopIteration');
        throw new PyError(re);
      }
      throw e;
    }
    if (r.done) {
      this.state = 'done';
      this.returnValue = r.value === undefined ? NONE : r.value;
      return DONE;
    }
    this.state = 'suspended';
    return r.value;
  }

  throwIn(excInst) {
    if (this.state === 'done') throw new PyError(excInst);
    if (this.state === 'running') raiseError('ValueError', 'generator already executing');
    this.state = 'running';
    let r;
    try {
      r = this.it.throw(new PyError(excInst));
    } catch (e) {
      this.state = 'done';
      throw e;
    }
    if (r.done) {
      this.state = 'done';
      this.returnValue = r.value === undefined ? NONE : r.value;
      return DONE;
    }
    this.state = 'suspended';
    return r.value;
  }

  close() {
    if (this.state === 'done' || this.state === 'created') {
      this.state = 'done';
      return;
    }
    try {
      const r = this.throwIn(makeExc('GeneratorExit'));
      if (r !== DONE) raiseError('RuntimeError', 'generator ignored GeneratorExit');
    } catch (e) {
      if (e instanceof PyError &&
          (isInstanceOf(e.pyExc, EXC.GeneratorExit) || isInstanceOf(e.pyExc, EXC.StopIteration))) {
        return;
      }
      throw e;
    }
  }
}

// File object (CLI installs real I/O; stays unused otherwise)
export class PyFile {
  constructor(handle, name, mode) {
    this.handle = handle;
    this.name = name;
    this.mode = mode;
    this.closed = false;
  }
}

// ---------- python exception wrapper ----------

export class PyError extends Error {
  constructor(pyExc) {
    super('python-exception');
    this.pyExc = pyExc; // PyInstance of an exception class
    this.tb = [];       // [{file, line, name}]
  }
}

// ---------- call hook (installed by interpreter) ----------

let callHook = null;
export function setCallHook(fn) { callHook = fn; }
export function pyCall(callable, args = [], kwargs = null) {
  return callHook(callable, args, kwargs);
}
export function pyCallMethod(obj, name, args = [], kwargs = null) {
  return pyCall(getAttr(obj, name), args, kwargs);
}

// ---------- object ids ----------

const idMap = new WeakMap();
let nextId = 1;
export function objId(v) {
  if (v === null || typeof v !== 'object') {
    return 0; // primitives: ids are not meaningful
  }
  let id = idMap.get(v);
  if (id === undefined) {
    id = nextId++;
    idMap.set(v, id);
  }
  return id;
}
export function fakeAddress(v) {
  return '0x' + (objId(v) * 48 + 0x7f2c00000000).toString(16);
}

// ---------- C3 linearization ----------

export function computeMro(cls) {
  const seqs = cls.bases.map((b) => [...b.mro]);
  seqs.push([...cls.bases]);
  const result = [cls];
  while (seqs.some((s) => s.length)) {
    let candidate = null;
    for (const seq of seqs) {
      if (!seq.length) continue;
      const head = seq[0];
      const inTail = seqs.some((s) => s.indexOf(head) > 0);
      if (!inTail) { candidate = head; break; }
    }
    if (!candidate) {
      raiseError('TypeError', 'Cannot create a consistent method resolution order (MRO)');
    }
    result.push(candidate);
    for (const seq of seqs) {
      if (seq[0] === candidate) seq.shift();
    }
  }
  return result;
}

// ---------- builtin type objects ----------

function bt(name, bases, opts = {}) {
  return new PyType(name, bases, new Map(), { builtin: true, ...opts });
}

export const TYPE_OBJECT = bt('object', []);
export const TYPE_TYPE = bt('type', [TYPE_OBJECT]);
export const TYPE_INT = bt('int', [TYPE_OBJECT]);
export const TYPE_BOOL = bt('bool', [TYPE_INT]);
export const TYPE_FLOAT = bt('float', [TYPE_OBJECT]);
export const TYPE_STR = bt('str', [TYPE_OBJECT]);
export const TYPE_LIST = bt('list', [TYPE_OBJECT], { payloadFactory: () => new PyList([]) });
export const TYPE_TUPLE = bt('tuple', [TYPE_OBJECT], { payloadFactory: () => new PyTuple([]) });
export const TYPE_DICT = bt('dict', [TYPE_OBJECT], { payloadFactory: () => new PyDict() });
export const TYPE_SET = bt('set', [TYPE_OBJECT], { payloadFactory: () => new PySet() });
export const TYPE_FROZENSET = bt('frozenset', [TYPE_OBJECT]);
export const TYPE_RANGE = bt('range', [TYPE_OBJECT]);
export const TYPE_SLICE = bt('slice', [TYPE_OBJECT]);
export const TYPE_NONE = bt('NoneType', [TYPE_OBJECT]);
export const TYPE_FUNCTION = bt('function', [TYPE_OBJECT]);
export const TYPE_BUILTIN = bt('builtin_function_or_method', [TYPE_OBJECT]);
export const TYPE_METHOD = bt('method', [TYPE_OBJECT]);
export const TYPE_GENERATOR = bt('generator', [TYPE_OBJECT]);
export const TYPE_MODULE = bt('module', [TYPE_OBJECT]);
export const TYPE_PROPERTY = bt('property', [TYPE_OBJECT]);
export const TYPE_CLASSMETHOD = bt('classmethod', [TYPE_OBJECT]);
export const TYPE_STATICMETHOD = bt('staticmethod', [TYPE_OBJECT]);
export const TYPE_SUPER = bt('super', [TYPE_OBJECT]);
export const TYPE_ITERATOR = bt('iterator', [TYPE_OBJECT]);
export const TYPE_ELLIPSIS = bt('ellipsis', [TYPE_OBJECT]);
export const TYPE_NOTIMPLEMENTED = bt('NotImplementedType', [TYPE_OBJECT]);
export const TYPE_FILE = bt('TextIOWrapper', [TYPE_OBJECT]);

// ---------- exception types ----------

export const EXC = {};
function exc(name, base) {
  const t = bt(name, [base]);
  EXC[name] = t;
  return t;
}

EXC.BaseException = bt('BaseException', [TYPE_OBJECT]);
exc('Exception', EXC.BaseException);
exc('SystemExit', EXC.BaseException);
exc('KeyboardInterrupt', EXC.BaseException);
exc('GeneratorExit', EXC.BaseException);
exc('ArithmeticError', EXC.Exception);
exc('ZeroDivisionError', EXC.ArithmeticError);
exc('OverflowError', EXC.ArithmeticError);
exc('FloatingPointError', EXC.ArithmeticError);
exc('AssertionError', EXC.Exception);
exc('AttributeError', EXC.Exception);
exc('BufferError', EXC.Exception);
exc('EOFError', EXC.Exception);
exc('ImportError', EXC.Exception);
exc('ModuleNotFoundError', EXC.ImportError);
exc('LookupError', EXC.Exception);
exc('IndexError', EXC.LookupError);
exc('KeyError', EXC.LookupError);
exc('MemoryError', EXC.Exception);
exc('NameError', EXC.Exception);
exc('UnboundLocalError', EXC.NameError);
exc('OSError', EXC.Exception);
exc('FileNotFoundError', EXC.OSError);
exc('FileExistsError', EXC.OSError);
exc('PermissionError', EXC.OSError);
exc('ReferenceError', EXC.Exception);
exc('RuntimeError', EXC.Exception);
exc('NotImplementedError', EXC.RuntimeError);
exc('RecursionError', EXC.RuntimeError);
exc('StopIteration', EXC.Exception);
exc('StopAsyncIteration', EXC.Exception);
exc('SyntaxError', EXC.Exception);
exc('IndentationError', EXC.SyntaxError);
exc('TabError', EXC.IndentationError);
exc('SystemError', EXC.Exception);
exc('TypeError', EXC.Exception);
exc('ValueError', EXC.Exception);
exc('UnicodeError', EXC.ValueError);
exc('UnicodeDecodeError', EXC.UnicodeError);
exc('UnicodeEncodeError', EXC.UnicodeError);
exc('Warning', EXC.Exception);
exc('DeprecationWarning', EXC.Warning);
exc('UserWarning', EXC.Warning);
exc('FutureWarning', EXC.Warning);
exc('RuntimeWarning', EXC.Warning);

export function makeExc(typeName, msg) {
  const cls = EXC[typeName];
  if (!cls) throw new Error(`internal: unknown exception type ${typeName}`);
  const inst = new PyInstance(cls);
  inst.attrs.set('args', new PyTuple(msg === undefined ? [] : [msg]));
  return inst;
}

export function raiseError(typeName, msg) {
  throw new PyError(makeExc(typeName, msg));
}

export function isExceptionType(t) {
  return t instanceof PyType && t.mro.includes(EXC.BaseException);
}

// ---------- typeOf ----------

export function typeOf(v) {
  switch (typeof v) {
    case 'bigint': return TYPE_INT;
    case 'boolean': return TYPE_BOOL;
    case 'number': return TYPE_FLOAT;
    case 'string': return TYPE_STR;
  }
  if (v === NONE) return TYPE_NONE;
  if (v === NOT_IMPLEMENTED) return TYPE_NOTIMPLEMENTED;
  if (v === PY_ELLIPSIS) return TYPE_ELLIPSIS;
  if (v instanceof PyInstance) return v.cls;
  if (v instanceof PyList) return TYPE_LIST;
  if (v instanceof PyTuple) return TYPE_TUPLE;
  if (v instanceof PyDict) return TYPE_DICT;
  if (v instanceof PySet) return v.frozen ? TYPE_FROZENSET : TYPE_SET;
  if (v instanceof PyRange) return TYPE_RANGE;
  if (v instanceof PySlice) return TYPE_SLICE;
  if (v instanceof PyType) return TYPE_TYPE;
  if (v instanceof PyFunction) return TYPE_FUNCTION;
  if (v instanceof PyBuiltin) return TYPE_BUILTIN;
  if (v instanceof PyBoundMethod) return TYPE_METHOD;
  if (v instanceof PyGenerator) return TYPE_GENERATOR;
  if (v instanceof PyModule) return TYPE_MODULE;
  if (v instanceof PyProperty) return TYPE_PROPERTY;
  if (v instanceof PyClassMethod) return TYPE_CLASSMETHOD;
  if (v instanceof PyStaticMethod) return TYPE_STATICMETHOD;
  if (v instanceof PySuper) return TYPE_SUPER;
  if (v instanceof PyIterator) return TYPE_ITERATOR;
  if (v instanceof PyFile) return TYPE_FILE;
  throw new Error(`internal: typeOf unknown value ${String(v)}`);
}

export function isSubclassOf(a, b) {
  if (!(a instanceof PyType)) return false;
  if (b instanceof PyTuple) return b.items.some((t) => isSubclassOf(a, t));
  return a.mro.includes(b);
}

export function isInstanceOf(v, t) {
  if (t instanceof PyTuple) return t.items.some((tt) => isInstanceOf(v, tt));
  if (!(t instanceof PyType)) raiseError('TypeError', 'isinstance() arg 2 must be a type or tuple of types');
  return isSubclassOf(typeOf(v), t);
}

// Unwrap a builtin-subclass instance to its payload.
export function unwrap(v) {
  if (v instanceof PyInstance && v.payload !== null) return v.payload;
  return v;
}

// ---------- hashing / dict keys ----------

function userDunder(v, name) {
  // Returns {value, owner} for a dunder defined by a *user* class, else null.
  if (!(v instanceof PyInstance)) return null;
  const hit = mroLookup(v.cls, name);
  if (hit && !hit.owner.builtin) return hit;
  return null;
}

export function hashKey(v) {
  switch (typeof v) {
    case 'bigint': return 'i:' + v.toString();
    case 'boolean': return v ? 'i:1' : 'i:0';
    case 'number':
      if (Number.isNaN(v)) return 'f:nan';
      if (!Number.isFinite(v)) return v > 0 ? 'f:inf' : 'f:-inf';
      if (Number.isInteger(v)) return 'i:' + BigInt(v).toString();
      return 'f:' + String(v);
    case 'string': return 's:' + v;
  }
  if (v === NONE) return 'n';
  if (v === PY_ELLIPSIS) return 'e';
  if (v instanceof PyTuple) {
    return 't:' + JSON.stringify(v.items.map(hashKey));
  }
  if (v instanceof PySet && v.frozen) {
    const keys = [...v.map.keys()].sort();
    return 'fs:' + JSON.stringify(keys);
  }
  if (v instanceof PyList) raiseError('TypeError', "unhashable type: 'list'");
  if (v instanceof PyDict) raiseError('TypeError', "unhashable type: 'dict'");
  if (v instanceof PySet) raiseError('TypeError', "unhashable type: 'set'");
  if (v instanceof PySlice) raiseError('TypeError', "unhashable type: 'slice'");
  if (v instanceof PyInstance) {
    const hashHit = userDunder(v, '__hash__');
    if (hashHit) {
      if (hashHit.value === NONE) {
        raiseError('TypeError', `unhashable type: '${v.cls.name}'`);
      }
      const h = pyCall(hashHit.value, [v]);
      if (typeof h !== 'bigint' && typeof h !== 'boolean') {
        raiseError('TypeError', '__hash__ method should return an integer');
      }
      return 'h:' + h.toString();
    }
    const eqHit = userDunder(v, '__eq__');
    if (eqHit) raiseError('TypeError', `unhashable type: '${v.cls.name}'`);
    if (v.payload instanceof PyList || v.payload instanceof PyDict ||
        (v.payload instanceof PySet && !v.payload.frozen)) {
      raiseError('TypeError', `unhashable type: '${v.cls.name}'`);
    }
    if (v.payload !== null) return hashKey(v.payload);
    return 'o:' + objId(v);
  }
  // Functions, types, modules, generators, ranges...
  if (v instanceof PyRange) return `r:${v.start},${v.stop},${v.step}`;
  return 'o:' + objId(v);
}

// hash() builtin value (a Python int).
export function hashValue(v) {
  switch (typeof v) {
    case 'bigint': return BigInt.asIntN(62, v) || 2n; // mimic "never -1" lightly
    case 'boolean': return v ? 1n : 0n;
    case 'number': {
      if (Number.isInteger(v)) return BigInt(v);
      const s = hashKey(v);
      return stringHash(s);
    }
    case 'string': return stringHash(v);
  }
  if (v === NONE) return 0n;
  if (v instanceof PyInstance) {
    const hit = userDunder(v, '__hash__');
    if (hit) {
      if (hit.value === NONE) raiseError('TypeError', `unhashable type: '${v.cls.name}'`);
      const h = pyCall(hit.value, [v]);
      if (typeof h !== 'bigint' && typeof h !== 'boolean') {
        raiseError('TypeError', '__hash__ method should return an integer');
      }
      return typeof h === 'boolean' ? (h ? 1n : 0n) : h;
    }
  }
  return stringHash(hashKey(v));
}

function stringHash(s) {
  let h = 5381n;
  for (let i = 0; i < s.length; i++) {
    h = (h * 33n + BigInt(s.charCodeAt(i))) & 0x3fffffffffffffn;
  }
  return h;
}

// ---------- dict / set ----------

export class PyDict {
  constructor() {
    this.map = new Map(); // canon -> [{key, value}]
    this.size = 0;
  }

  getEntry(key) {
    const canon = hashKey(key);
    const bucket = this.map.get(canon);
    if (!bucket) return undefined;
    if (canon[0] === 'h') {
      for (const e of bucket) if (pyEq(e.key, key)) return e;
      return undefined;
    }
    return bucket[0];
  }

  get(key) {
    const e = this.getEntry(key);
    return e ? e.value : undefined;
  }

  has(key) { return this.getEntry(key) !== undefined; }

  set(key, value) {
    const canon = hashKey(key);
    let bucket = this.map.get(canon);
    if (!bucket) {
      this.map.set(canon, [{ key, value }]);
      this.size++;
      return;
    }
    if (canon[0] === 'h') {
      for (const e of bucket) {
        if (pyEq(e.key, key)) { e.value = value; return; }
      }
      bucket.push({ key, value });
      this.size++;
      return;
    }
    bucket[0].value = value;
  }

  delete(key) {
    const canon = hashKey(key);
    const bucket = this.map.get(canon);
    if (!bucket) return false;
    if (canon[0] === 'h') {
      for (let i = 0; i < bucket.length; i++) {
        if (pyEq(bucket[i].key, key)) {
          bucket.splice(i, 1);
          if (!bucket.length) this.map.delete(canon);
          this.size--;
          return true;
        }
      }
      return false;
    }
    this.map.delete(canon);
    this.size--;
    return true;
  }

  clear() { this.map.clear(); this.size = 0; }

  *entries() {
    for (const bucket of this.map.values()) {
      for (const e of bucket) yield [e.key, e.value];
    }
  }

  keysArray() { return [...this.entries()].map((e) => e[0]); }
  valuesArray() { return [...this.entries()].map((e) => e[1]); }

  copy() {
    const d = new PyDict();
    for (const [k, v] of this.entries()) d.set(k, v);
    return d;
  }

  popLast() {
    let lastCanon = null;
    for (const c of this.map.keys()) lastCanon = c;
    if (lastCanon === null) return undefined;
    const bucket = this.map.get(lastCanon);
    const e = bucket.pop();
    if (!bucket.length) this.map.delete(lastCanon);
    this.size--;
    return e;
  }
}

export class PySet {
  constructor(frozen = false) {
    this.map = new Map(); // canon -> [key] (bucket only for 'h:')
    this.size = 0;
    this.frozen = frozen;
  }

  has(key) {
    const canon = hashKey(key);
    const bucket = this.map.get(canon);
    if (!bucket) return false;
    if (canon[0] === 'h') return bucket.some((k) => pyEq(k, key));
    return true;
  }

  add(key) {
    const canon = hashKey(key);
    let bucket = this.map.get(canon);
    if (!bucket) {
      this.map.set(canon, [key]);
      this.size++;
      return;
    }
    if (canon[0] === 'h') {
      if (!bucket.some((k) => pyEq(k, key))) {
        bucket.push(key);
        this.size++;
      }
    }
  }

  delete(key) {
    const canon = hashKey(key);
    const bucket = this.map.get(canon);
    if (!bucket) return false;
    if (canon[0] === 'h') {
      for (let i = 0; i < bucket.length; i++) {
        if (pyEq(bucket[i], key)) {
          bucket.splice(i, 1);
          if (!bucket.length) this.map.delete(canon);
          this.size--;
          return true;
        }
      }
      return false;
    }
    this.map.delete(canon);
    this.size--;
    return true;
  }

  clear() { this.map.clear(); this.size = 0; }

  *keys() {
    for (const bucket of this.map.values()) {
      for (const k of bucket) yield k;
    }
  }

  keysArray() { return [...this.keys()]; }

  copy(frozen = this.frozen) {
    const s = new PySet(frozen);
    for (const k of this.keys()) s.add(k);
    return s;
  }

  pop() {
    for (const [canon, bucket] of this.map) {
      const k = bucket.shift();
      if (!bucket.length) this.map.delete(canon);
      this.size--;
      return k;
    }
    return undefined;
  }
}

// ---------- truthiness ----------

export function pyTruthy(v) {
  switch (typeof v) {
    case 'boolean': return v;
    case 'bigint': return v !== 0n;
    case 'number': return v !== 0;
    case 'string': return v.length > 0;
  }
  if (v === NONE) return false;
  if (v instanceof PyList || v instanceof PyTuple) return v.items.length > 0;
  if (v instanceof PyDict || v instanceof PySet) return v.size > 0;
  if (v instanceof PyRange) return v.length() > 0n;
  if (v instanceof PyInstance) {
    const boolHit = userDunder(v, '__bool__');
    if (boolHit) {
      const r = pyCall(boolHit.value, [v]);
      if (typeof r !== 'boolean') raiseError('TypeError', `__bool__ should return bool, returned ${typeOf(r).name}`);
      return r;
    }
    const lenHit = userDunder(v, '__len__');
    if (lenHit) {
      const r = pyCall(lenHit.value, [v]);
      return numToBigInt(r) !== 0n;
    }
    if (v.payload !== null) return pyTruthy(v.payload);
    return true;
  }
  return true;
}

// ---------- numbers ----------

export function isNum(v) {
  const t = typeof v;
  return t === 'bigint' || t === 'number' || t === 'boolean';
}

function normNum(v) {
  return typeof v === 'boolean' ? (v ? 1n : 0n) : v;
}

export function numToBigInt(v) {
  if (typeof v === 'bigint') return v;
  if (typeof v === 'boolean') return v ? 1n : 0n;
  if (v instanceof PyInstance) {
    const hit = userDunder(v, '__index__');
    if (hit) {
      const r = pyCall(hit.value, [v]);
      if (typeof r === 'bigint') return r;
      if (typeof r === 'boolean') return r ? 1n : 0n;
      raiseError('TypeError', '__index__ returned non-int');
    }
    if (typeof unwrap(v) === 'bigint') return unwrap(v);
  }
  raiseError('TypeError', `'${typeOf(v).name}' object cannot be interpreted as an integer`);
}

export function toJsIndex(v, what = 'index') {
  const b = numToBigInt(v);
  if (b > 9007199254740991n || b < -9007199254740991n) {
    raiseError('IndexError', `cannot fit '${what}' into an index-sized integer`);
  }
  return Number(b);
}

// Compare BigInt with float exactly. Returns -1, 0, 1 (or NaN-incomparable as 2).
function cmpIntFloat(a, f) {
  if (Number.isNaN(f)) return 2;
  if (f === Infinity) return -1;
  if (f === -Infinity) return 1;
  const fl = Math.floor(f);
  const fb = BigInt(fl);
  if (a < fb) return -1;
  if (a > fb) return 1;
  const frac = f - fl;
  if (frac > 0) return -1;
  return 0;
}

export function cmpNum(a, b) {
  a = normNum(a); b = normNum(b);
  if (typeof a === 'bigint' && typeof b === 'bigint') {
    return a < b ? -1 : a > b ? 1 : 0;
  }
  if (typeof a === 'number' && typeof b === 'number') {
    if (Number.isNaN(a) || Number.isNaN(b)) return 2;
    return a < b ? -1 : a > b ? 1 : 0;
  }
  if (typeof a === 'bigint') return cmpIntFloat(a, b);
  const r = cmpIntFloat(b, a);
  return r === 2 ? 2 : -r;
}

export function bigIntToNumber(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) {
    raiseError('OverflowError', 'int too large to convert to float');
  }
  return n;
}

// ---------- equality ----------

export function pyEq(a, b) {
  if (a === b) {
    if (typeof a === 'number' && Number.isNaN(a)) return false;
    return true;
  }
  if (isNum(a) && isNum(b)) return cmpNum(a, b) === 0;
  if (typeof a === 'string' && typeof b === 'string') return a === b;

  // User-defined __eq__ takes priority.
  if (a instanceof PyInstance || b instanceof PyInstance) {
    const hitA = a instanceof PyInstance ? userDunder(a, '__eq__') : null;
    if (hitA) {
      const r = pyCall(hitA.value, [a, b]);
      if (r !== NOT_IMPLEMENTED) return pyTruthy(r);
    }
    const hitB = b instanceof PyInstance ? userDunder(b, '__eq__') : null;
    if (hitB) {
      const r = pyCall(hitB.value, [b, a]);
      if (r !== NOT_IMPLEMENTED) return pyTruthy(r);
    }
  }

  const ua = unwrap(a);
  const ub = unwrap(b);
  if (ua !== a || ub !== b) {
    if (ua === ub) return true;
    return pyEqNative(ua, ub);
  }
  return pyEqNative(a, b);
}

function pyEqNative(a, b) {
  if (isNum(a) && isNum(b)) return cmpNum(a, b) === 0;
  if (typeof a === 'string' && typeof b === 'string') return a === b;
  if ((a instanceof PyList && b instanceof PyList) ||
      (a instanceof PyTuple && b instanceof PyTuple)) {
    if (a.items.length !== b.items.length) return false;
    for (let i = 0; i < a.items.length; i++) {
      if (!pyEq(a.items[i], b.items[i])) return false;
    }
    return true;
  }
  if (a instanceof PyDict && b instanceof PyDict) {
    if (a.size !== b.size) return false;
    for (const [k, v] of a.entries()) {
      const e = b.getEntry(k);
      if (!e || !pyEq(e.value, v)) return false;
    }
    return true;
  }
  if (a instanceof PySet && b instanceof PySet) {
    if (a.size !== b.size) return false;
    for (const k of a.keys()) if (!b.has(k)) return false;
    return true;
  }
  if (a instanceof PyRange && b instanceof PyRange) {
    const la = a.length(), lb = b.length();
    if (la !== lb) return false;
    if (la === 0n) return true;
    if (a.start !== b.start) return false;
    if (la === 1n) return true;
    return a.step === b.step;
  }
  return a === b;
}

// ---------- ordering ----------

const CMP_DUNDER = { '<': '__lt__', '<=': '__le__', '>': '__gt__', '>=': '__ge__' };
const CMP_REFLECT = { '<': '>', '<=': '>=', '>': '<', '>=': '<=' };

export function richCompare(op, a, b) {
  if (op === '==') return pyEq(a, b);
  if (op === '!=') return !pyEq(a, b);

  if (a instanceof PyInstance || b instanceof PyInstance) {
    const hitA = a instanceof PyInstance ? userDunder(a, CMP_DUNDER[op]) : null;
    if (hitA) {
      const r = pyCall(hitA.value, [a, b]);
      if (r !== NOT_IMPLEMENTED) return pyTruthy(r);
    }
    const rop = CMP_REFLECT[op];
    const hitB = b instanceof PyInstance ? userDunder(b, CMP_DUNDER[rop]) : null;
    if (hitB) {
      const r = pyCall(hitB.value, [b, a]);
      if (r !== NOT_IMPLEMENTED) return pyTruthy(r);
    }
  }

  const ua = unwrap(a), ub = unwrap(b);
  if (isNum(ua) && isNum(ub)) {
    const c = cmpNum(ua, ub);
    if (c === 2) return false; // NaN comparisons
    switch (op) {
      case '<': return c < 0;
      case '<=': return c <= 0;
      case '>': return c > 0;
      case '>=': return c >= 0;
    }
  }
  if (typeof ua === 'string' && typeof ub === 'string') {
    switch (op) {
      case '<': return ua < ub;
      case '<=': return ua <= ub;
      case '>': return ua > ub;
      case '>=': return ua >= ub;
    }
  }
  if ((ua instanceof PyList && ub instanceof PyList) ||
      (ua instanceof PyTuple && ub instanceof PyTuple)) {
    const x = ua.items, y = ub.items;
    const n = Math.min(x.length, y.length);
    for (let i = 0; i < n; i++) {
      if (!pyEq(x[i], y[i])) return richCompare(op, x[i], y[i]);
    }
    switch (op) {
      case '<': return x.length < y.length;
      case '<=': return x.length <= y.length;
      case '>': return x.length > y.length;
      case '>=': return x.length >= y.length;
    }
  }
  if (ua instanceof PySet && ub instanceof PySet) {
    const subset = (s, t) => {
      for (const k of s.keys()) if (!t.has(k)) return false;
      return true;
    };
    switch (op) {
      case '<=': return subset(ua, ub);
      case '<': return ua.size < ub.size && subset(ua, ub);
      case '>=': return subset(ub, ua);
      case '>': return ua.size > ub.size && subset(ub, ua);
    }
  }
  raiseError('TypeError',
    `'${op}' not supported between instances of '${typeOf(a).name}' and '${typeOf(b).name}'`);
}

// ---------- attribute access ----------

export function mroLookup(type, name) {
  for (const t of type.mro) {
    if (t.attrs.has(name)) return { value: t.attrs.get(name), owner: t };
  }
  return null;
}

function bindClassAttr(value, inst) {
  if (value instanceof PyFunction) return new PyBoundMethod(value, inst);
  if (value instanceof PyBuiltin && value.isMethod) return new PyBoundMethod(value, inst);
  if (value instanceof PyClassMethod) return new PyBoundMethod(value.func, typeOf(inst));
  if (value instanceof PyStaticMethod) return value.func;
  return value;
}

export function getAttr(obj, name) {
  if (name === '__class__') return typeOf(obj);

  if (obj instanceof PyInstance) {
    // Data descriptors (properties) take priority over the instance dict.
    const hit = mroLookup(obj.cls, name);
    if (hit && hit.value instanceof PyProperty) {
      if (hit.value.fget === NONE) {
        raiseError('AttributeError', `property '${name}' of '${obj.cls.name}' object has no getter`);
      }
      return pyCall(hit.value.fget, [obj]);
    }
    if (obj.attrs.has(name)) return obj.attrs.get(name);
    if (name === '__dict__') {
      const d = new PyDict();
      for (const [k, v] of obj.attrs) d.set(k, v);
      return d;
    }
    if (hit) return bindClassAttr(hit.value, obj);
    const ga = mroLookup(obj.cls, '__getattr__');
    if (ga && !ga.owner.builtin) {
      return pyCall(bindClassAttr(ga.value, obj), [name]);
    }
    raiseError('AttributeError', `'${obj.cls.name}' object has no attribute '${name}'`);
  }

  if (obj instanceof PyType) {
    switch (name) {
      case '__name__': return obj.name;
      case '__qualname__': return obj.name;
      case '__module__': return obj.module;
      case '__mro__': return new PyTuple([...obj.mro]);
      case '__bases__': return new PyTuple([...obj.bases]);
      case '__dict__': {
        const d = new PyDict();
        for (const [k, v] of obj.attrs) d.set(k, v);
        return d;
      }
      case 'mro': return new PyBuiltin('mro', () => new PyList([...obj.mro]));
    }
    const hit = mroLookup(obj, name);
    if (hit) {
      const v = hit.value;
      if (v instanceof PyClassMethod) return new PyBoundMethod(v.func, obj);
      if (v instanceof PyStaticMethod) return v.func;
      return v;
    }
    raiseError('AttributeError', `type object '${obj.name}' has no attribute '${name}'`);
  }

  if (obj instanceof PyModule) {
    if (name === '__name__') return obj.name;
    if (obj.attrs.has(name)) return obj.attrs.get(name);
    raiseError('AttributeError', `module '${obj.name}' has no attribute '${name}'`);
  }

  if (obj instanceof PySuper) {
    const mro = obj.objType.mro;
    const idx = mro.indexOf(obj.startType);
    for (let i = idx + 1; i < mro.length; i++) {
      if (mro[i].attrs.has(name)) {
        const v = mro[i].attrs.get(name);
        if (obj.obj !== NONE && obj.obj instanceof PyType === false) {
          return bindClassAttr(v, obj.obj);
        }
        if (v instanceof PyClassMethod) return new PyBoundMethod(v.func, obj.obj);
        return v;
      }
    }
    raiseError('AttributeError', `'super' object has no attribute '${name}'`);
  }

  if (obj instanceof PyFunction) {
    switch (name) {
      case '__name__': return obj.name;
      case '__qualname__': return obj.name;
      case '__doc__': return obj.doc;
    }
    if (obj.attrs.has(name)) return obj.attrs.get(name);
    raiseError('AttributeError', `'function' object has no attribute '${name}'`);
  }

  if (obj instanceof PyBoundMethod) {
    if (name === '__name__') return obj.func.name;
    if (name === '__self__') return obj.self;
    if (name === '__func__') return obj.func;
    raiseError('AttributeError', `'method' object has no attribute '${name}'`);
  }

  if (obj instanceof PyBuiltin) {
    if (name === '__name__') return obj.name;
    if (obj.attrs && obj.attrs.has(name)) return obj.attrs.get(name);
    raiseError('AttributeError', `'builtin_function_or_method' object has no attribute '${name}'`);
  }

  if (obj instanceof PyProperty) {
    switch (name) {
      case 'fget': return obj.fget;
      case 'fset': return obj.fset;
      case 'fdel': return obj.fdel;
      case 'getter': return new PyBuiltin('getter', (args) => new PyProperty(args[0], obj.fset, obj.fdel, obj.doc));
      case 'setter': return new PyBuiltin('setter', (args) => new PyProperty(obj.fget, args[0], obj.fdel, obj.doc));
      case 'deleter': return new PyBuiltin('deleter', (args) => new PyProperty(obj.fget, obj.fset, args[0], obj.doc));
    }
    raiseError('AttributeError', `'property' object has no attribute '${name}'`);
  }

  if (obj instanceof PySlice) {
    if (name === 'start') return obj.start;
    if (name === 'stop') return obj.stop;
    if (name === 'step') return obj.step;
  }

  if (obj instanceof PyRange) {
    if (name === 'start') return obj.start;
    if (name === 'stop') return obj.stop;
    if (name === 'step') return obj.step;
  }

  // Builtin values: look up a method in the type's table.
  const t = typeOf(obj);
  const hit = mroLookup(t, name);
  if (hit) {
    if (hit.value instanceof PyProperty) {
      if (hit.value.fget === NONE) {
        raiseError('AttributeError', `property '${name}' of '${t.name}' object has no getter`);
      }
      return pyCall(hit.value.fget, [obj]);
    }
    return bindClassAttr(hit.value, obj);
  }
  raiseError('AttributeError', `'${t.name}' object has no attribute '${name}'`);
}

export function setAttr(obj, name, value) {
  if (obj instanceof PyInstance) {
    const hit = mroLookup(obj.cls, name);
    if (hit && hit.value instanceof PyProperty) {
      if (hit.value.fset === NONE) {
        raiseError('AttributeError', `property '${name}' of '${obj.cls.name}' object has no setter`);
      }
      pyCall(hit.value.fset, [obj, value]);
      return;
    }
    const sa = mroLookup(obj.cls, '__setattr__');
    if (sa && !sa.owner.builtin) {
      pyCall(bindClassAttr(sa.value, obj), [name, value]);
      return;
    }
    obj.attrs.set(name, value);
    return;
  }
  if (obj instanceof PyType) {
    if (obj.builtin) {
      raiseError('TypeError', `cannot set '${name}' attribute of immutable type '${obj.name}'`);
    }
    obj.attrs.set(name, value);
    return;
  }
  if (obj instanceof PyModule) { obj.attrs.set(name, value); return; }
  if (obj instanceof PyFunction) { obj.attrs.set(name, value); return; }
  raiseError('AttributeError', `'${typeOf(obj).name}' object has no attribute '${name}'`);
}

export function delAttr(obj, name) {
  if (obj instanceof PyInstance) {
    if (obj.attrs.has(name)) { obj.attrs.delete(name); return; }
    raiseError('AttributeError', `'${obj.cls.name}' object has no attribute '${name}'`);
  }
  if (obj instanceof PyType) {
    if (obj.attrs.has(name)) { obj.attrs.delete(name); return; }
    raiseError('AttributeError', name);
  }
  if (obj instanceof PyModule) {
    if (obj.attrs.has(name)) { obj.attrs.delete(name); return; }
    raiseError('AttributeError', name);
  }
  raiseError('AttributeError', `'${typeOf(obj).name}' object has no attribute '${name}'`);
}

export function hasAttr(obj, name) {
  try {
    getAttr(obj, name);
    return true;
  } catch (e) {
    if (e instanceof PyError && isInstanceOf(e.pyExc, EXC.AttributeError)) return false;
    throw e;
  }
}

// Set when interp creates a super object for attribute lookup.
// PySuper needs objType: the type of the bound object.
Object.defineProperty(PySuper.prototype, 'objType', {
  get() {
    return this.obj instanceof PyType ? this.obj : typeOf(this.obj);
  },
});

// ---------- iteration ----------

export function pyIter(v) {
  const uv = (v instanceof PyInstance && !userDunder(v, '__iter__') && !userDunder(v, '__getitem__'))
    ? unwrap(v) : v;

  if (uv instanceof PyList || uv instanceof PyTuple) {
    let i = 0;
    const arr = uv.items;
    return { next: () => (i < arr.length ? arr[i++] : DONE) };
  }
  if (typeof uv === 'string') {
    const chars = [...uv];
    let i = 0;
    return { next: () => (i < chars.length ? chars[i++] : DONE) };
  }
  if (uv instanceof PyDict) {
    const keys = uv.keysArray();
    let i = 0;
    return { next: () => (i < keys.length ? keys[i++] : DONE) };
  }
  if (uv instanceof PySet) {
    const keys = uv.keysArray();
    let i = 0;
    return { next: () => (i < keys.length ? keys[i++] : DONE) };
  }
  if (uv instanceof PyRange) {
    let cur = uv.start;
    const { stop, step } = uv;
    return {
      next: () => {
        if (step > 0n ? cur >= stop : cur <= stop) return DONE;
        const r = cur;
        cur += step;
        return r;
      },
    };
  }
  if (uv instanceof PyGenerator) {
    return { next: () => uv.nextValue(NONE) };
  }
  if (uv instanceof PyIterator) {
    return { next: uv.nextFn };
  }
  if (uv instanceof PyFile) {
    return { next: () => fileReadLineOrDone(uv) };
  }
  if (v instanceof PyInstance) {
    const iterHit = userDunder(v, '__iter__');
    if (iterHit) {
      const itObj = pyCall(bindClassAttr(iterHit.value, v), []);
      return wrapPyIterObject(itObj);
    }
    const giHit = userDunder(v, '__getitem__');
    if (giHit) {
      let i = 0n;
      const fn = bindClassAttr(giHit.value, v);
      return {
        next: () => {
          try {
            return pyCall(fn, [i++]);
          } catch (e) {
            if (e instanceof PyError && isInstanceOf(e.pyExc, EXC.IndexError)) return DONE;
            throw e;
          }
        },
      };
    }
  }
  raiseError('TypeError', `'${typeOf(v).name}' object is not iterable`);
}

function wrapPyIterObject(itObj) {
  if (itObj instanceof PyGenerator) return { next: () => itObj.nextValue(NONE) };
  if (itObj instanceof PyIterator) return { next: itObj.nextFn };
  if (itObj instanceof PyInstance) {
    const nextHit = mroLookup(itObj.cls, '__next__');
    if (nextHit) {
      const fn = bindClassAttr(nextHit.value, itObj);
      return {
        next: () => {
          try {
            return pyCall(fn, []);
          } catch (e) {
            if (e instanceof PyError && isInstanceOf(e.pyExc, EXC.StopIteration)) return DONE;
            throw e;
          }
        },
      };
    }
  }
  // iter() returned a builtin iterable? Python requires an iterator; accept iterables loosely.
  return pyIter(itObj);
}

export function iterToArray(v, what = 'iterable') {
  const it = pyIter(v);
  const out = [];
  for (;;) {
    const x = it.next();
    if (x === DONE) return out;
    out.push(x);
  }
}

// Installed by the CLI layer; see python.js.
export const FileOps = { readLine: null, write: null, read: null, close: null };

function fileReadLineOrDone(f) {
  const line = FileOps.readLine ? FileOps.readLine(f) : null;
  return line === null ? DONE : line;
}

// ---------- repr / str ----------

const reprStack = new Set();

export function pyRepr(v) {
  switch (typeof v) {
    case 'bigint': return v.toString();
    case 'boolean': return v ? 'True' : 'False';
    case 'number': return floatRepr(v);
    case 'string': return strRepr(v);
  }
  if (v === NONE) return 'None';
  if (v === NOT_IMPLEMENTED) return 'NotImplemented';
  if (v === PY_ELLIPSIS) return 'Ellipsis';

  if (v instanceof PyInstance) {
    const hit = userDunder(v, '__repr__');
    if (hit) {
      const r = pyCall(bindClassAttr(hit.value, v), []);
      if (typeof r !== 'string') raiseError('TypeError', '__repr__ returned non-string');
      return r;
    }
    if (isSubclassOf(v.cls, EXC.BaseException)) {
      const args = v.attrs.get('args') || new PyTuple([]);
      const inner = args.items.map(pyRepr).join(', ');
      return `${v.cls.name}(${inner})`;
    }
    if (v.payload !== null) return pyRepr(v.payload);
    const mod = v.cls.module === 'builtins' ? '__main__' : v.cls.module;
    return `<${mod}.${v.cls.name} object at ${fakeAddress(v)}>`;
  }

  if (v instanceof PyList || v instanceof PyTuple || v instanceof PyDict || v instanceof PySet) {
    if (reprStack.has(v)) {
      if (v instanceof PyList) return '[...]';
      if (v instanceof PyTuple) return '(...)';
      if (v instanceof PyDict) return '{...}';
      return `${typeOf(v).name}(...)`;
    }
    reprStack.add(v);
    try {
      if (v instanceof PyList) {
        return '[' + v.items.map(pyRepr).join(', ') + ']';
      }
      if (v instanceof PyTuple) {
        if (v.items.length === 1) return '(' + pyRepr(v.items[0]) + ',)';
        return '(' + v.items.map(pyRepr).join(', ') + ')';
      }
      if (v instanceof PyDict) {
        const parts = [];
        for (const [k, val] of v.entries()) parts.push(pyRepr(k) + ': ' + pyRepr(val));
        return '{' + parts.join(', ') + '}';
      }
      // set
      if (v.size === 0) return v.frozen ? 'frozenset()' : 'set()';
      const inner = v.keysArray().map(pyRepr).join(', ');
      return v.frozen ? `frozenset({${inner}})` : `{${inner}}`;
    } finally {
      reprStack.delete(v);
    }
  }

  if (v instanceof PyRange) {
    if (v.step === 1n) return `range(${v.start}, ${v.stop})`;
    return `range(${v.start}, ${v.stop}, ${v.step})`;
  }
  if (v instanceof PySlice) {
    return `slice(${pyRepr(v.start)}, ${pyRepr(v.stop)}, ${pyRepr(v.step)})`;
  }
  if (v instanceof PyType) {
    return `<class '${v.module === 'builtins' ? '' : v.module + '.'}${v.name}'>`;
  }
  if (v instanceof PyFunction) return `<function ${v.name} at ${fakeAddress(v)}>`;
  if (v instanceof PyBuiltin) return `<built-in function ${v.name}>`;
  if (v instanceof PyBoundMethod) {
    return `<bound method ${v.func.name} of ${pyRepr(v.self)}>`;
  }
  if (v instanceof PyGenerator) return `<generator object ${v.name} at ${fakeAddress(v)}>`;
  if (v instanceof PyModule) return `<module '${v.name}'>`;
  if (v instanceof PyProperty) return `<property object at ${fakeAddress(v)}>`;
  if (v instanceof PyIterator) return `<${v.typeName} object at ${fakeAddress(v)}>`;
  if (v instanceof PySuper) return `<super: <class '${v.startType.name}'>, <${v.objType.name} object>>`;
  if (v instanceof PyFile) return `<_io.TextIOWrapper name='${v.name}' mode='${v.mode}'>`;
  if (v instanceof PyClassMethod) return `<classmethod object at ${fakeAddress(v)}>`;
  if (v instanceof PyStaticMethod) return `<staticmethod object at ${fakeAddress(v)}>`;
  return String(v);
}

function strRepr(s) {
  let quote = "'";
  if (s.includes("'") && !s.includes('"')) quote = '"';
  let out = quote;
  for (const ch of s) {
    const code = ch.codePointAt(0);
    if (ch === quote) out += '\\' + ch;
    else if (ch === '\\') out += '\\\\';
    else if (ch === '\n') out += '\\n';
    else if (ch === '\r') out += '\\r';
    else if (ch === '\t') out += '\\t';
    else if (code < 0x20 || code === 0x7f) {
      out += '\\x' + code.toString(16).padStart(2, '0');
    } else {
      out += ch;
    }
  }
  return out + quote;
}

export function pyStr(v) {
  if (typeof v === 'string') return v;
  if (v instanceof PyInstance) {
    const hit = userDunder(v, '__str__');
    if (hit) {
      const r = pyCall(bindClassAttr(hit.value, v), []);
      if (typeof r !== 'string') raiseError('TypeError', '__str__ returned non-string');
      return r;
    }
    if (isSubclassOf(v.cls, EXC.BaseException)) {
      const args = v.attrs.get('args') || new PyTuple([]);
      if (args.items.length === 0) return '';
      if (args.items.length === 1) return pyStr(args.items[0]);
      return pyRepr(args);
    }
    if (typeof v.payload === 'string') return v.payload;
  }
  return pyRepr(v);
}

// ---------- format() / format spec mini-language ----------

export function pyFormat(v, spec) {
  if (v instanceof PyInstance) {
    const hit = userDunder(v, '__format__');
    if (hit) {
      const r = pyCall(bindClassAttr(hit.value, v), [spec]);
      if (typeof r !== 'string') raiseError('TypeError', '__format__ must return a str');
      return r;
    }
  }
  const uv = unwrap(v);
  if (spec === '') return pyStr(uv);
  const p = parseFormatSpec(spec);
  if (isNum(uv)) return formatNumber(uv, p);
  const s = pyStr(uv);
  return formatString(s, p);
}

function parseFormatSpec(spec) {
  const p = {
    fill: ' ', align: null, sign: '-', alt: false, zero: false,
    width: 0, grouping: null, precision: null, type: null,
  };
  let i = 0;
  if (spec.length >= 2 && '<>^='.includes(spec[1])) {
    p.fill = spec[0];
    p.align = spec[1];
    i = 2;
  } else if (spec.length >= 1 && '<>^='.includes(spec[0])) {
    p.align = spec[0];
    i = 1;
  }
  if ('+- '.includes(spec[i])) { p.sign = spec[i]; i++; }
  if (spec[i] === 'z') i++; // 'z' (coerce -0): accepted, ignored
  if (spec[i] === '#') { p.alt = true; i++; }
  if (spec[i] === '0') {
    p.zero = true;
    if (!p.align) { p.align = '='; p.fill = '0'; }
    i++;
  }
  let w = '';
  while (i < spec.length && /[0-9]/.test(spec[i])) { w += spec[i]; i++; }
  if (w) p.width = parseInt(w, 10);
  if (spec[i] === ',' || spec[i] === '_') { p.grouping = spec[i]; i++; }
  if (spec[i] === '.') {
    i++;
    let pr = '';
    while (i < spec.length && /[0-9]/.test(spec[i])) { pr += spec[i]; i++; }
    if (!pr) raiseError('ValueError', 'Format specifier missing precision');
    p.precision = parseInt(pr, 10);
  }
  if (i < spec.length) {
    p.type = spec[i];
    i++;
  }
  if (i < spec.length) raiseError('ValueError', `Invalid format specifier '${spec}'`);
  return p;
}

function applyAlign(body, p, isNumeric, signStr = '') {
  const align = p.align || (isNumeric ? '>' : '<');
  const total = signStr.length + body.length;
  if (total >= p.width) return signStr + body;
  const pad = p.width - total;
  const fill = p.fill;
  if (align === '<') return signStr + body + fill.repeat(pad);
  if (align === '>') return fill.repeat(pad) + signStr + body;
  if (align === '^') {
    const left = Math.floor(pad / 2);
    return fill.repeat(left) + signStr + body + fill.repeat(pad - left);
  }
  // '=': padding between sign and digits
  return signStr + fill.repeat(pad) + body;
}

function formatString(s, p) {
  if (p.type !== null && p.type !== 's') {
    raiseError('ValueError', `Unknown format code '${p.type}' for object of type 'str'`);
  }
  if (p.sign !== '-') raiseError('ValueError', 'Sign not allowed in string format specifier');
  if (p.align === '=') raiseError('ValueError', "'=' alignment not allowed in string format specifier");
  let body = s;
  if (p.precision !== null) body = [...body].slice(0, p.precision).join('');
  return applyAlign(body, p, false);
}

function signOf(negative, signMode) {
  if (negative) return '-';
  if (signMode === '+') return '+';
  if (signMode === ' ') return ' ';
  return '';
}

function formatNumber(v, p) {
  const t = p.type;
  if (typeof v === 'boolean') {
    if (t === null || t === 's') {
      // str(bool) unless numeric type code given
      if (t === null && p.precision === null && !p.grouping) {
        return applyAlign(v ? 'True' : 'False', p, false);
      }
    }
    v = v ? 1n : 0n;
  }

  if (typeof v === 'bigint') {
    if (t === null || t === 'd' || t === 'n') {
      const neg = v < 0n;
      let digits = (neg ? -v : v).toString();
      if (p.grouping) digits = groupDigitsZeroAware(digits, p);
      return applyAlign(digits, p, true, signOf(neg, p.sign));
    }
    if (t === 'b' || t === 'o' || t === 'x' || t === 'X') {
      const neg = v < 0n;
      const base = t === 'b' ? 2 : t === 'o' ? 8 : 16;
      let digits = (neg ? -v : v).toString(base);
      if (t === 'X') digits = digits.toUpperCase();
      if (p.grouping === '_') digits = groupDigits(digits, '_', 4);
      if (p.alt) digits = '0' + (t === 'X' ? 'X' : t) + digits;
      return applyAlign(digits, p, true, signOf(neg, p.sign));
    }
    if (t === 'c') {
      return applyAlign(String.fromCodePoint(Number(v)), p, false);
    }
    if ('eEfFgG%'.includes(t)) {
      return formatFloat(bigIntToNumber(v), p);
    }
    raiseError('ValueError', `Unknown format code '${t}' for object of type 'int'`);
  }

  // float
  if (t === null || 'eEfFgG%n'.includes(t)) return formatFloat(v, p);
  raiseError('ValueError', `Unknown format code '${t}' for object of type 'float'`);
}

function groupDigitsZeroAware(digits, p) {
  const sep = p.grouping;
  return groupDigits(digits, sep, 3);
}

function formatFloat(x, p) {
  const t = p.type;
  if (Number.isNaN(x)) {
    const body = (t === 'E' || t === 'F' || t === 'G') ? 'NAN' : 'nan';
    return applyAlign(body, p, true, signOf(false, p.sign));
  }
  if (!Number.isFinite(x)) {
    const body = (t === 'E' || t === 'F' || t === 'G') ? 'INF' : 'inf';
    return applyAlign(body, p, true, signOf(x < 0, p.sign));
  }

  const neg = x < 0 || Object.is(x, -0);
  const ax = Math.abs(x);
  let body;

  if (t === 'f' || t === 'F') {
    const prec = p.precision === null ? 6 : p.precision;
    body = formatFixedAbs(ax, prec);
    if (p.grouping) body = addGroupingToFixed(body, p.grouping);
    if (p.alt && prec === 0) body += '.';
  } else if (t === '%') {
    const prec = p.precision === null ? 6 : p.precision;
    // multiply by 100 exactly via decimal scaling
    body = formatFixedAbs100(ax, prec) + '%';
    if (p.grouping) body = addGroupingToFixed(body, p.grouping);
  } else if (t === 'e' || t === 'E') {
    const prec = p.precision === null ? 6 : p.precision;
    body = formatExp(ax, prec, t === 'E');
  } else if (t === 'g' || t === 'G' || t === 'n' || t === null) {
    const isG = t !== null;
    let prec = p.precision === null ? (isG ? 6 : 17) : p.precision;
    if (prec === 0) prec = 1;
    if (t === null && p.precision === null) {
      // repr-like shortest form
      body = floatRepr(ax);
      if (p.grouping) body = addGroupingToFixed(body, p.grouping);
    } else {
      const { digits, exp } = formatSigAbs(ax, prec);
      if (exp < -4 || exp >= prec) {
        // exponential
        let mant = digits[0] + (digits.length > 1 ? '.' + digits.slice(1) : '');
        if (isG && !p.alt) mant = stripTrailingZeros(mant);
        const absE = Math.abs(exp);
        const eStr = (exp < 0 ? '-' : '+') + (absE < 10 ? '0' + absE : String(absE));
        body = mant + (t === 'G' ? 'E' : 'e') + eStr;
      } else {
        body = sigDigitsToFixed(digits, exp);
        if (isG && !p.alt) body = stripTrailingZeros(body);
        if (p.grouping) body = addGroupingToFixed(body, p.grouping);
      }
    }
  } else {
    raiseError('ValueError', `Unknown format code '${t}' for object of type 'float'`);
  }

  return applyAlign(body, p, true, signOf(neg, p.sign));
}

function formatFixedAbs100(ax, prec) {
  // |x| * 100 with prec digits: scale by 10^(prec+2) then place the point.
  const { exactScaled } = fmtInternals;
  const scaled = exactScaled(ax, prec + 2);
  let digits = scaled.toString();
  if (prec === 0) return digits;
  if (digits.length <= prec) digits = '0'.repeat(prec - digits.length + 1) + digits;
  return digits.slice(0, -prec) + '.' + digits.slice(-prec);
}

function formatExp(ax, prec, upper) {
  let body;
  if (ax === 0) {
    body = prec > 0 ? '0.' + '0'.repeat(prec) + 'e+00' : '0e+00';
  } else {
    const { digits, exp } = formatSigAbs(ax, prec + 1);
    const mant = digits[0] + (prec > 0 ? '.' + digits.slice(1) : '');
    const absE = Math.abs(exp);
    body = mant + 'e' + (exp < 0 ? '-' : '+') + (absE < 10 ? '0' + absE : String(absE));
  }
  return upper ? body.toUpperCase() : body;
}

function sigDigitsToFixed(digits, exp) {
  if (exp >= 0) {
    if (digits.length <= exp + 1) {
      return digits + '0'.repeat(exp + 1 - digits.length);
    }
    return digits.slice(0, exp + 1) + '.' + digits.slice(exp + 1);
  }
  return '0.' + '0'.repeat(-exp - 1) + digits;
}

function stripTrailingZeros(s) {
  if (!s.includes('.')) return s;
  s = s.replace(/0+$/, '');
  if (s.endsWith('.')) s = s.slice(0, -1);
  return s;
}

function addGroupingToFixed(body, sep) {
  const dot = body.indexOf('.');
  const intPart = dot === -1 ? body : body.slice(0, dot);
  const rest = dot === -1 ? '' : body.slice(dot);
  return groupDigits(intPart, sep, 3) + rest;
}

// fmt internals needed above without re-import noise
import * as fmtInternals from './fmt.js';

// ---------- % string formatting ----------

export function strMod(fmt, args) {
  let values;
  let mapping = null;
  if (args instanceof PyTuple) values = [...args.items];
  else if (args instanceof PyDict) { mapping = args; values = []; }
  else values = [args];
  let vi = 0;
  const nextVal = () => {
    if (vi >= values.length) raiseError('TypeError', 'not enough arguments for format string');
    return values[vi++];
  };
  let out = '';
  let i = 0;
  while (i < fmt.length) {
    const ch = fmt[i];
    if (ch !== '%') { out += ch; i++; continue; }
    i++;
    if (fmt[i] === '%') { out += '%'; i++; continue; }
    // %(name)
    let value;
    if (fmt[i] === '(') {
      const end = fmt.indexOf(')', i);
      if (end === -1) raiseError('ValueError', 'incomplete format key');
      const key = fmt.slice(i + 1, end);
      if (!mapping) raiseError('TypeError', 'format requires a mapping');
      const e = mapping.getEntry(key);
      if (!e) throw new PyError(makeExc('KeyError', key));
      value = e.value;
      i = end + 1;
    }
    let flags = '';
    while ('-+ 0#'.includes(fmt[i])) { flags += fmt[i]; i++; }
    let width = 0;
    if (fmt[i] === '*') { width = Number(numToBigInt(nextVal())); i++; }
    else { let w = ''; while (/[0-9]/.test(fmt[i] || '')) { w += fmt[i]; i++; } if (w) width = parseInt(w, 10); }
    let precision = null;
    if (fmt[i] === '.') {
      i++;
      if (fmt[i] === '*') { precision = Number(numToBigInt(nextVal())); i++; }
      else { let pr = ''; while (/[0-9]/.test(fmt[i] || '')) { pr += fmt[i]; i++; } precision = pr ? parseInt(pr, 10) : 0; }
    }
    const conv = fmt[i];
    i++;
    if (value === undefined) value = nextVal();
    out += formatPercentConv(conv, value, flags, width, precision);
  }
  if (!mapping && vi < values.length) {
    raiseError('TypeError', 'not all arguments converted during string formatting');
  }
  return out;
}

function formatPercentConv(conv, value, flags, width, precision) {
  let body, neg = false, numeric = false;
  switch (conv) {
    case 's': body = pyStr(value); break;
    case 'r': body = pyRepr(value); break;
    case 'a': body = pyRepr(value); break;
    case 'c': {
      if (typeof value === 'string') {
        if ([...value].length !== 1) raiseError('TypeError', '%c requires int or char');
        body = value;
      } else {
        body = String.fromCodePoint(Number(numToBigInt(value)));
      }
      break;
    }
    case 'd': case 'i': case 'u': {
      numeric = true;
      let b;
      if (typeof value === 'number') b = BigInt(Math.trunc(value));
      else b = numToBigInt(value);
      neg = b < 0n;
      body = (neg ? -b : b).toString();
      break;
    }
    case 'x': case 'X': case 'o': case 'b': {
      numeric = true;
      const b = numToBigInt(value);
      neg = b < 0n;
      const base = conv === 'o' ? 8 : conv === 'b' ? 2 : 16;
      body = (neg ? -b : b).toString(base);
      if (conv === 'X') body = body.toUpperCase();
      if (flags.includes('#')) body = '0' + conv.toLowerCase() + body;
      break;
    }
    case 'f': case 'F': case 'e': case 'E': case 'g': case 'G': {
      numeric = true;
      let x = typeof value === 'number' ? value : Number(numToBigInt(value));
      neg = x < 0 || Object.is(x, -0);
      const prec = precision === null ? 6 : precision;
      const ax = Math.abs(x);
      if (!Number.isFinite(ax)) {
        body = Number.isNaN(ax) ? 'nan' : 'inf';
        if ('EFG'.includes(conv)) body = body.toUpperCase();
      } else if (conv === 'f' || conv === 'F') {
        body = formatFixedAbs(ax, prec);
      } else if (conv === 'e' || conv === 'E') {
        body = formatExp(ax, prec, conv === 'E');
      } else {
        let pr = prec === 0 ? 1 : prec;
        const { digits, exp } = ax === 0 ? { digits: '0'.repeat(pr), exp: 0 } : formatSigAbs(ax, pr);
        if (exp < -4 || exp >= pr) {
          let mant = digits[0] + (digits.length > 1 ? '.' + digits.slice(1) : '');
          if (!flags.includes('#')) mant = stripTrailingZeros(mant);
          const absE = Math.abs(exp);
          body = mant + (conv === 'G' ? 'E' : 'e') + (exp < 0 ? '-' : '+') + (absE < 10 ? '0' + absE : String(absE));
        } else {
          body = sigDigitsToFixed(digits, exp);
          if (!flags.includes('#')) body = stripTrailingZeros(body);
        }
      }
      break;
    }
    default:
      raiseError('ValueError', `unsupported format character '${conv}'`);
  }
  if (!numeric && precision !== null && conv === 's') {
    body = body.slice(0, precision);
  }
  let sign = '';
  if (numeric) {
    sign = neg ? '-' : flags.includes('+') ? '+' : flags.includes(' ') ? ' ' : '';
  }
  const total = sign.length + body.length;
  if (total >= width) return sign + body;
  const pad = width - total;
  if (flags.includes('-')) return sign + body + ' '.repeat(pad);
  if (flags.includes('0') && numeric) return sign + '0'.repeat(pad) + body;
  return ' '.repeat(pad) + sign + body;
}

// ---------- subscription ----------

export function computeSlice(slice, len) {
  // Returns {start, stop, step} as JS numbers, CPython algorithm.
  let step = slice.step === NONE ? 1 : toJsIndex(slice.step);
  if (step === 0) raiseError('ValueError', 'slice step cannot be zero');
  let start, stop;
  const defStart = step > 0 ? 0 : len - 1;
  // For a negative step with an omitted stop, the loop bound is -1 so that
  // index 0 is included (the loop condition is `i > stop`).
  const defStop = step > 0 ? len : -1;
  if (slice.start === NONE) start = defStart;
  else {
    start = toJsIndex(slice.start);
    if (start < 0) start += len;
    if (start < 0) start = step > 0 ? 0 : -1;
    if (start >= len) start = step > 0 ? len : len - 1;
  }
  if (slice.stop === NONE) stop = defStop;
  else {
    stop = toJsIndex(slice.stop);
    if (stop < 0) stop += len;
    if (stop < 0) stop = step > 0 ? 0 : -1;
    if (stop >= len) stop = step > 0 ? len : len - 1;
  }
  return { start, stop, step };
}

function sliceIndices(slice, len) {
  const { start, stop, step } = computeSlice(slice, len);
  const idx = [];
  if (step > 0) {
    for (let i = start; i < stop; i += step) idx.push(i);
  } else {
    for (let i = start; i > stop; i += step) idx.push(i);
  }
  return idx;
}

export function getItem(obj, index) {
  if (obj instanceof PyInstance) {
    const hit = userDunder(obj, '__getitem__');
    if (hit) return pyCall(bindClassAttr(hit.value, obj), [index]);
  }
  const o = unwrap(obj);

  if (o instanceof PyList || o instanceof PyTuple) {
    const arr = o.items;
    if (index instanceof PySlice) {
      const items = sliceIndices(index, arr.length).map((i) => arr[i]);
      return o instanceof PyList ? new PyList(items) : new PyTuple(items);
    }
    const i = normIndex(index, arr.length, typeOf(o).name);
    return arr[i];
  }
  if (typeof o === 'string') {
    const chars = [...o];
    if (index instanceof PySlice) {
      return sliceIndices(index, chars.length).map((i) => chars[i]).join('');
    }
    const i = normIndex(index, chars.length, 'string');
    return chars[i];
  }
  if (o instanceof PyDict) {
    const e = o.getEntry(index);
    if (e === undefined) {
      // defaultdict support: __missing__
      if (obj instanceof PyInstance) {
        const mh = mroLookup(obj.cls, '__missing__');
        if (mh) return pyCall(bindClassAttr(mh.value, obj), [index]);
      }
      if (o.defaultFactory !== undefined) {
        const dv = o.defaultFactory === NONE
          ? (() => { throw new PyError(keyErrorExc(index)); })()
          : pyCall(o.defaultFactory, []);
        o.set(index, dv);
        return dv;
      }
      throw new PyError(keyErrorExc(index));
    }
    return e.value;
  }
  if (o instanceof PyRange) {
    if (index instanceof PySlice) {
      const len = Number(o.length());
      const { start, stop, step } = computeSlice(index, len);
      const newStart = o.start + o.step * BigInt(start);
      const newStop = o.start + o.step * BigInt(stop);
      const newStep = o.step * BigInt(step);
      return new PyRange(newStart, newStop, newStep);
    }
    let i = numToBigInt(index);
    const len = o.length();
    if (i < 0n) i += len;
    if (i < 0n || i >= len) raiseError('IndexError', 'range object index out of range');
    return o.item(i);
  }
  if (o instanceof PyType) {
    // Generic alias (list[int] etc): return the type itself, tolerantly.
    return o;
  }
  raiseError('TypeError', `'${typeOf(obj).name}' object is not subscriptable`);
}

export function keyErrorExc(key) {
  const inst = new PyInstance(EXC.KeyError);
  inst.attrs.set('args', new PyTuple([key]));
  return inst;
}

function normIndex(index, len, typeName) {
  let i;
  if (typeof index === 'bigint') i = index;
  else if (typeof index === 'boolean') i = index ? 1n : 0n;
  else if (index instanceof PyInstance) i = numToBigInt(index);
  else if (typeof index === 'number') {
    raiseError('TypeError', `${typeName === 'string' ? 'string' : 'list'} indices must be integers or slices, not float`);
  } else {
    raiseError('TypeError', `${typeName === 'string' ? 'string' : typeName} indices must be integers or slices, not ${typeOf(index).name}`);
  }
  if (i < 0n) i += BigInt(len);
  if (i < 0n || i >= BigInt(len)) {
    raiseError('IndexError', `${typeName === 'str' ? 'string' : typeName} index out of range`);
  }
  return Number(i);
}

export function setItem(obj, index, value) {
  if (obj instanceof PyInstance) {
    const hit = userDunder(obj, '__setitem__');
    if (hit) { pyCall(bindClassAttr(hit.value, obj), [index, value]); return; }
  }
  const o = unwrap(obj);
  if (o instanceof PyList) {
    const arr = o.items;
    if (index instanceof PySlice) {
      const values = iterToArray(value);
      const { start, stop, step } = computeSlice(index, arr.length);
      if (step === 1) {
        arr.splice(start, Math.max(0, stop - start), ...values);
      } else {
        const idx = sliceIndices(index, arr.length);
        if (idx.length !== values.length) {
          raiseError('ValueError',
            `attempt to assign sequence of size ${values.length} to extended slice of size ${idx.length}`);
        }
        idx.forEach((i, k) => { arr[i] = values[k]; });
      }
      return;
    }
    const i = normIndex(index, arr.length, 'list');
    arr[i] = value;
    return;
  }
  if (o instanceof PyDict) {
    o.set(index, value);
    return;
  }
  if (o instanceof PyTuple) {
    raiseError('TypeError', "'tuple' object does not support item assignment");
  }
  if (typeof o === 'string') {
    raiseError('TypeError', "'str' object does not support item assignment");
  }
  raiseError('TypeError', `'${typeOf(obj).name}' object does not support item assignment`);
}

export function delItem(obj, index) {
  if (obj instanceof PyInstance) {
    const hit = userDunder(obj, '__delitem__');
    if (hit) { pyCall(bindClassAttr(hit.value, obj), [index]); return; }
  }
  const o = unwrap(obj);
  if (o instanceof PyList) {
    const arr = o.items;
    if (index instanceof PySlice) {
      const idx = sliceIndices(index, arr.length).sort((a, b) => b - a);
      for (const i of idx) arr.splice(i, 1);
      return;
    }
    const i = normIndex(index, arr.length, 'list');
    arr.splice(i, 1);
    return;
  }
  if (o instanceof PyDict) {
    if (!o.delete(index)) throw new PyError(keyErrorExc(index));
    return;
  }
  raiseError('TypeError', `'${typeOf(obj).name}' object doesn't support item deletion`);
}

// ---------- contains ----------

export function pyContains(item, container) {
  if (container instanceof PyInstance) {
    const hit = userDunder(container, '__contains__');
    if (hit) return pyTruthy(pyCall(bindClassAttr(hit.value, container), [item]));
  }
  const c = unwrap(container);
  if (typeof c === 'string') {
    if (typeof item !== 'string') {
      raiseError('TypeError', `'in <string>' requires string as left operand, not ${typeOf(item).name}`);
    }
    return c.includes(item);
  }
  if (c instanceof PyList || c instanceof PyTuple) {
    return c.items.some((x) => pyEq(x, item));
  }
  if (c instanceof PyDict) return c.has(item);
  if (c instanceof PySet) return c.has(item);
  if (c instanceof PyRange) {
    if (typeof item === 'bigint' || typeof item === 'boolean') {
      const i = typeof item === 'boolean' ? (item ? 1n : 0n) : item;
      const { start, stop, step } = c;
      if (step > 0n) {
        return i >= start && i < stop && (i - start) % step === 0n;
      }
      return i <= start && i > stop && (start - i) % (-step) === 0n;
    }
  }
  // generic iteration
  const it = pyIter(container);
  for (;;) {
    const x = it.next();
    if (x === DONE) return false;
    if (pyEq(x, item)) return true;
  }
}

// ---------- binary operators ----------

const BINOP_DUNDER = {
  '+': ['__add__', '__radd__'], '-': ['__sub__', '__rsub__'],
  '*': ['__mul__', '__rmul__'], '/': ['__truediv__', '__rtruediv__'],
  '//': ['__floordiv__', '__rfloordiv__'], '%': ['__mod__', '__rmod__'],
  '**': ['__pow__', '__rpow__'], '<<': ['__lshift__', '__rlshift__'],
  '>>': ['__rshift__', '__rrshift__'], '&': ['__and__', '__rand__'],
  '|': ['__or__', '__ror__'], '^': ['__xor__', '__rxor__'],
  '@': ['__matmul__', '__rmatmul__'],
};

export function binOp(op, a, b) {
  if (a instanceof PyInstance || b instanceof PyInstance) {
    const [lname, rname] = BINOP_DUNDER[op];
    const ta = typeOf(a), tb = typeOf(b);
    // If b's type is a proper subclass of a's type, try b's reflected first.
    if (tb !== ta && isSubclassOf(tb, ta)) {
      const hitB = b instanceof PyInstance ? userDunder(b, rname) : null;
      if (hitB) {
        const r = pyCall(hitB.value, [b, a]);
        if (r !== NOT_IMPLEMENTED) return r;
      }
    }
    const hitA = a instanceof PyInstance ? userDunder(a, lname) : null;
    if (hitA) {
      const r = pyCall(hitA.value, [a, b]);
      if (r !== NOT_IMPLEMENTED) return r;
    }
    const hitB = b instanceof PyInstance ? userDunder(b, rname) : null;
    if (hitB) {
      const r = pyCall(hitB.value, [b, a]);
      if (r !== NOT_IMPLEMENTED) return r;
    }
  }
  const r = binOpNative(op, unwrap(a), unwrap(b));
  if (r === NOT_IMPLEMENTED) {
    raiseError('TypeError',
      `unsupported operand type(s) for ${op === '**' ? '** or pow()' : op}: '${typeOf(a).name}' and '${typeOf(b).name}'`);
  }
  return r;
}

function binOpNative(op, a, b) {
  // numeric
  if (isNum(a) && isNum(b)) return numBinOp(op, normNum(a), normNum(b));

  if (typeof a === 'string') {
    if (op === '+') {
      if (typeof b !== 'string') {
        raiseError('TypeError', `can only concatenate str (not "${typeOf(b).name}") to str`);
      }
      return a + b;
    }
    if (op === '*') return seqRepeatStr(a, b);
    if (op === '%') return strMod(a, b);
    return NOT_IMPLEMENTED;
  }
  if (typeof b === 'string' && op === '*') return seqRepeatStr(b, a);

  if (a instanceof PyList) {
    if (op === '+') {
      if (!(b instanceof PyList)) {
        raiseError('TypeError', `can only concatenate list (not "${typeOf(b).name}") to list`);
      }
      return new PyList([...a.items, ...b.items]);
    }
    if (op === '*') return new PyList(seqRepeat(a.items, b, 'list'));
    return NOT_IMPLEMENTED;
  }
  if (b instanceof PyList && op === '*') return new PyList(seqRepeat(b.items, a, 'list'));

  if (a instanceof PyTuple) {
    if (op === '+') {
      if (!(b instanceof PyTuple)) {
        raiseError('TypeError', `can only concatenate tuple (not "${typeOf(b).name}") to tuple`);
      }
      return new PyTuple([...a.items, ...b.items]);
    }
    if (op === '*') return new PyTuple(seqRepeat(a.items, b, 'tuple'));
    return NOT_IMPLEMENTED;
  }
  if (b instanceof PyTuple && op === '*') return new PyTuple(seqRepeat(b.items, a, 'tuple'));

  if (a instanceof PyDict && b instanceof PyDict && op === '|') {
    const d = a.copy();
    for (const [k, v] of b.entries()) d.set(k, v);
    return d;
  }

  if (a instanceof PySet && b instanceof PySet) {
    switch (op) {
      case '|': {
        const s = a.copy(a.frozen);
        for (const k of b.keys()) s.add(k);
        return s;
      }
      case '&': {
        const s = new PySet(a.frozen);
        for (const k of a.keys()) if (b.has(k)) s.add(k);
        return s;
      }
      case '-': {
        const s = new PySet(a.frozen);
        for (const k of a.keys()) if (!b.has(k)) s.add(k);
        return s;
      }
      case '^': {
        const s = new PySet(a.frozen);
        for (const k of a.keys()) if (!b.has(k)) s.add(k);
        for (const k of b.keys()) if (!a.has(k)) s.add(k);
        return s;
      }
    }
  }

  return NOT_IMPLEMENTED;
}

function seqRepeatStr(s, n) {
  if (typeof n !== 'bigint' && typeof n !== 'boolean' && !(n instanceof PyInstance)) {
    raiseError('TypeError', `can't multiply sequence by non-int of type '${typeOf(n).name}'`);
  }
  const count = Number(numToBigInt(n));
  if (count <= 0) return '';
  if (count * s.length > 100_000_000) raiseError('MemoryError', 'repeated string is too long');
  return s.repeat(count);
}

function seqRepeat(items, n, what) {
  if (typeof n !== 'bigint' && typeof n !== 'boolean' && !(n instanceof PyInstance)) {
    raiseError('TypeError', `can't multiply sequence by non-int of type '${typeOf(n).name}'`);
  }
  const count = Number(numToBigInt(n));
  const out = [];
  for (let i = 0; i < count; i++) out.push(...items);
  return out;
}

export function numBinOp(op, a, b) {
  const bothInt = typeof a === 'bigint' && typeof b === 'bigint';
  switch (op) {
    case '+': return bothInt ? a + b : asF(a) + asF(b);
    case '-': return bothInt ? a - b : asF(a) - asF(b);
    case '*': return bothInt ? a * b : asF(a) * asF(b);
    case '/': {
      if (bothInt) {
        if (b === 0n) raiseError('ZeroDivisionError', 'division by zero');
        return bigDiv(a, b);
      }
      const fb = asF(b);
      if (fb === 0) raiseError('ZeroDivisionError', 'float division by zero');
      return asF(a) / fb;
    }
    case '//': {
      if (bothInt) {
        if (b === 0n) raiseError('ZeroDivisionError', 'integer division or modulo by zero');
        let q = a / b;
        if (a % b !== 0n && (a < 0n) !== (b < 0n)) q -= 1n;
        return q;
      }
      const fa = asF(a), fb = asF(b);
      if (fb === 0) raiseError('ZeroDivisionError', 'float floor division by zero');
      return Math.floor(fa / fb);
    }
    case '%': {
      if (bothInt) {
        if (b === 0n) raiseError('ZeroDivisionError', 'integer division or modulo by zero');
        const r = a % b;
        return r !== 0n && (r < 0n) !== (b < 0n) ? r + b : r;
      }
      const fa = asF(a), fb = asF(b);
      if (fb === 0) raiseError('ZeroDivisionError', 'float modulo');
      let r = fa % fb;
      if (r !== 0 && (r < 0) !== (fb < 0)) r += fb;
      return r;
    }
    case '**': {
      if (bothInt) {
        if (b < 0n) {
          if (a === 0n) raiseError('ZeroDivisionError', '0.0 cannot be raised to a negative power');
          return Math.pow(Number(a), Number(b));
        }
        if (b > 1_000_000n) raiseError('MemoryError', 'exponent too large');
        return a ** b;
      }
      const fa = asF(a), fb = asF(b);
      if (fa === 0 && fb < 0) raiseError('ZeroDivisionError', '0.0 cannot be raised to a negative power');
      if (fa < 0 && !Number.isInteger(fb)) {
        raiseError('ValueError', 'negative number cannot be raised to a fractional power');
      }
      return Math.pow(fa, fb);
    }
    case '<<': {
      requireIntOp(a, b, op);
      if (b < 0n) raiseError('ValueError', 'negative shift count');
      if (b > 100000n) raiseError('OverflowError', 'shift count too large');
      return a << b;
    }
    case '>>': {
      requireIntOp(a, b, op);
      if (b < 0n) raiseError('ValueError', 'negative shift count');
      return a >> (b > 10000n ? 10000n : b);
    }
    case '&': requireIntOp(a, b, op); return a & b;
    case '|': requireIntOp(a, b, op); return a | b;
    case '^': requireIntOp(a, b, op); return a ^ b;
    case '@': return NOT_IMPLEMENTED;
  }
  return NOT_IMPLEMENTED;
}

function requireIntOp(a, b, op) {
  if (typeof a !== 'bigint' || typeof b !== 'bigint') {
    raiseError('TypeError',
      `unsupported operand type(s) for ${op}: '${typeof a === 'bigint' ? 'int' : 'float'}' and '${typeof b === 'bigint' ? 'int' : 'float'}'`);
  }
}

function asF(v) {
  return typeof v === 'bigint' ? bigIntToNumber(v) : v;
}

function bigDiv(a, b) {
  // True division of two BigInts -> float, with care for large values.
  const fa = Number(a), fb = Number(b);
  if (Number.isFinite(fa) && Number.isFinite(fb)) return fa / fb;
  // Scale down via string lengths.
  const sa = (a < 0n ? -a : a).toString();
  const sb = (b < 0n ? -b : b).toString();
  const shift = Math.max(sa.length, sb.length) - 15;
  const scale = 10n ** BigInt(shift);
  const ra = Number(a / scale), rb = Number(b / scale);
  return ra / rb;
}

// ---------- unary operators ----------

export function unaryOp(op, v) {
  if (op === 'not') return !pyTruthy(v);
  if (v instanceof PyInstance) {
    const name = op === '-' ? '__neg__' : op === '+' ? '__pos__' : '__invert__';
    const hit = userDunder(v, name);
    if (hit) return pyCall(hit.value, [v]);
  }
  const uv = unwrap(v);
  switch (op) {
    case '-':
      if (typeof uv === 'bigint') return -uv;
      if (typeof uv === 'boolean') return uv ? -1n : 0n;
      if (typeof uv === 'number') return -uv;
      break;
    case '+':
      if (typeof uv === 'bigint' || typeof uv === 'number') return uv;
      if (typeof uv === 'boolean') return uv ? 1n : 0n;
      break;
    case '~':
      if (typeof uv === 'bigint') return ~uv;
      if (typeof uv === 'boolean') return uv ? -2n : -1n;
      break;
  }
  raiseError('TypeError', `bad operand type for unary ${op}: '${typeOf(v).name}'`);
}

// ---------- misc exports ----------

export function pyLen(v) {
  if (v instanceof PyInstance) {
    const hit = userDunder(v, '__len__');
    if (hit) {
      const r = pyCall(bindClassAttr(hit.value, v), []);
      const n = numToBigInt(r);
      if (n < 0n) raiseError('ValueError', '__len__() should return >= 0');
      return n;
    }
  }
  const uv = unwrap(v);
  if (typeof uv === 'string') return BigInt([...uv].length);
  if (uv instanceof PyList || uv instanceof PyTuple) return BigInt(uv.items.length);
  if (uv instanceof PyDict || uv instanceof PySet) return BigInt(uv.size);
  if (uv instanceof PyRange) return uv.length();
  raiseError('TypeError', `object of type '${typeOf(v).name}' has no len()`);
}

export { userDunder, bindClassAttr };
