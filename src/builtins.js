// Builtin functions, type constructors, and method tables for builtin types.

import {
  NONE, NOT_IMPLEMENTED, PY_ELLIPSIS, DONE,
  PyList, PyTuple, PyDict, PySet, PyRange, PySlice, PyFunction, PyBuiltin,
  PyBoundMethod, PyType, PyInstance, PyModule, PyProperty, PyClassMethod,
  PyStaticMethod, PySuper, PyIterator, PyGenerator, PyError, PyFile,
  TYPE_OBJECT, TYPE_TYPE, TYPE_INT, TYPE_BOOL, TYPE_FLOAT, TYPE_STR,
  TYPE_LIST, TYPE_TUPLE, TYPE_DICT, TYPE_SET, TYPE_FROZENSET, TYPE_RANGE,
  TYPE_SLICE, TYPE_NONE, TYPE_GENERATOR, TYPE_ITERATOR, TYPE_PROPERTY,
  TYPE_CLASSMETHOD, TYPE_STATICMETHOD, TYPE_FILE, TYPE_MODULE,
  EXC, makeExc, raiseError, keyErrorExc, isExceptionType,
  typeOf, isInstanceOf, isSubclassOf, unwrap, hashKey, hashValue,
  pyEq, richCompare, pyTruthy, pyCall, pyCallMethod, getAttr, setAttr, delAttr, hasAttr,
  pyIter, iterToArray, pyRepr, pyStr, pyFormat, pyLen, binOp,
  numToBigInt, toJsIndex, bigIntToNumber, isNum, cmpNum, objId,
  getItem, setItem, computeSlice, mroLookup, bindClassAttr, FileOps,
} from './objects.js';
import {
  floatRepr, roundHalfEvenToInt, roundToDigits, floatParts, exactScaled,
} from './fmt.js';

// ---------- I/O abstraction (CLI installs real implementations) ----------

export const IO = {
  write: (s) => { throw new Error('no stdout configured'); },
  writeErr: (s) => { throw new Error('no stderr configured'); },
  readLine: null, // () => string|null
};

// ---------- helpers ----------

function fn(name, f) { return new PyBuiltin(name, f); }
function meth(type, name, f) { type.attrs.set(name, new PyBuiltin(name, f, true)); }
function classMeth(type, name, f) { type.attrs.set(name, new PyClassMethod(new PyBuiltin(name, f, true))); }

function noKw(name, kwargs) {
  if (kwargs && kwargs.size > 0) {
    raiseError('TypeError', `${name}() takes no keyword arguments`);
  }
}

function checkArgs(name, args, min, max) {
  if (args.length < min || (max !== undefined && args.length > max)) {
    if (min === max || max === undefined) {
      raiseError('TypeError', `${name}() takes exactly ${min} argument${min === 1 ? '' : 's'} (${args.length} given)`);
    }
    raiseError('TypeError', `${name}() takes ${min} to ${max} arguments (${args.length} given)`);
  }
}

function kwOnly(kwargs, allowed, fname) {
  const out = {};
  if (!kwargs) return out;
  for (const [k, v] of kwargs) {
    if (!allowed.includes(k)) {
      raiseError('TypeError', `${fname}() got an unexpected keyword argument '${k}'`);
    }
    out[k] = v;
  }
  return out;
}

// Build an unwrap-and-typecheck helper for a builtin-method `self` argument.
function makeAsType(typeName, pred) {
  return (self, methName) => {
    const v = unwrap(self);
    if (!pred(v)) {
      raiseError('TypeError', `descriptor '${methName}' requires a '${typeName}' object but received a '${typeOf(self).name}'`);
    }
    return v;
  };
}
const asStr = makeAsType('str', (v) => typeof v === 'string');
const asList = makeAsType('list', (v) => v instanceof PyList);
const asDict = makeAsType('dict', (v) => v instanceof PyDict);
const asSet = makeAsType('set', (v) => v instanceof PySet);

const cp = (s) => [...s]; // code point array

// Python-style start/end adjustment for find/index/count/...
function adjustIndices(len, start, end) {
  let s = start === undefined || start === NONE ? 0 : toJsIndex(start);
  let e = end === undefined || end === NONE ? len : toJsIndex(end);
  if (s < 0) s = Math.max(0, s + len);
  if (e < 0) e = Math.max(0, e + len);
  if (e > len) e = len;
  if (s > len) s = len;
  return [s, e];
}

// ---------- int / float constructors ----------

function parseIntLiteral(s, base) {
  let t = s.trim().replace(/[  -​]/g, '');
  let sign = 1n;
  if (t.startsWith('+')) t = t.slice(1);
  else if (t.startsWith('-')) { sign = -1n; t = t.slice(1); }
  let b = base;
  const lower = t.toLowerCase();
  if (b === 0) {
    if (lower.startsWith('0x')) { b = 16; t = t.slice(2); }
    else if (lower.startsWith('0o')) { b = 8; t = t.slice(2); }
    else if (lower.startsWith('0b')) { b = 2; t = t.slice(2); }
    else if (/^0+$/.test(t)) { return 0n; }
    else if (t.startsWith('0') && t.length > 1) return null;
    else b = 10;
  } else if (b === 16 && lower.startsWith('0x')) t = t.slice(2);
  else if (b === 8 && lower.startsWith('0o')) t = t.slice(2);
  else if (b === 2 && lower.startsWith('0b')) t = t.slice(2);

  if (t.includes('__') || t.startsWith('_') || t.endsWith('_')) return null;
  t = t.replace(/_/g, '');
  if (t.length === 0) return null;

  const digits = '0123456789abcdefghijklmnopqrstuvwxyz'.slice(0, b);
  let result = 0n;
  const bb = BigInt(b);
  for (const ch of t.toLowerCase()) {
    const d = digits.indexOf(ch);
    if (d === -1) return null;
    result = result * bb + BigInt(d);
  }
  return sign * result;
}

function intConstruct(args, kwargs) {
  const kw = kwOnly(kwargs, ['base'], 'int');
  checkArgs('int', args, 0, 2);
  if (args.length === 0) return 0n;
  let base = null;
  if (args.length === 2) base = args[1];
  if (kw.base !== undefined) base = kw.base;
  const v = args[0];
  if (base !== null) {
    const b = Number(numToBigInt(base));
    if (b !== 0 && (b < 2 || b > 36)) raiseError('ValueError', 'int() base must be >= 2 and <= 36, or 0');
    if (typeof v !== 'string') {
      raiseError('TypeError', "int() can't convert non-string with explicit base");
    }
    const r = parseIntLiteral(v, b);
    if (r === null) raiseError('ValueError', `invalid literal for int() with base ${b}: ${pyRepr(v)}`);
    return r;
  }
  const uv = unwrap(v);
  if (typeof uv === 'bigint') return uv;
  if (typeof uv === 'boolean') return uv ? 1n : 0n;
  if (typeof uv === 'number') {
    if (Number.isNaN(uv)) raiseError('ValueError', 'cannot convert float NaN to integer');
    if (!Number.isFinite(uv)) raiseError('OverflowError', 'cannot convert float infinity to integer');
    return BigInt(Math.trunc(uv));
  }
  if (typeof uv === 'string') {
    const r = parseIntLiteral(uv, 10);
    if (r === null) raiseError('ValueError', `invalid literal for int() with base 10: ${pyRepr(uv)}`);
    return r;
  }
  if (v instanceof PyInstance) {
    const hit = mroLookup(v.cls, '__int__');
    if (hit && !hit.owner.builtin) {
      const r = pyCall(bindClassAttr(hit.value, v), []);
      if (typeof r === 'bigint') return r;
      if (typeof r === 'boolean') return r ? 1n : 0n;
      raiseError('TypeError', `__int__ returned non-int (type ${typeOf(r).name})`);
    }
    const idx = mroLookup(v.cls, '__index__');
    if (idx && !idx.owner.builtin) return numToBigInt(v);
  }
  raiseError('TypeError', `int() argument must be a string, a bytes-like object or a real number, not '${typeOf(v).name}'`);
}

function floatConstruct(args, kwargs) {
  noKw('float', kwargs);
  checkArgs('float', args, 0, 1);
  if (args.length === 0) return 0;
  const v = args[0];
  const uv = unwrap(v);
  if (typeof uv === 'number') return uv;
  if (typeof uv === 'bigint') return bigIntToNumber(uv);
  if (typeof uv === 'boolean') return uv ? 1 : 0;
  if (typeof uv === 'string') {
    let t = uv.trim();
    const m = t.toLowerCase();
    let sign = 1;
    let body = m;
    if (body.startsWith('+')) body = body.slice(1);
    else if (body.startsWith('-')) { sign = -1; body = body.slice(1); }
    if (body === 'inf' || body === 'infinity') return sign * Infinity;
    if (body === 'nan') return NaN;
    if (/^(\d(_?\d)*)?(\.(\d(_?\d)*)?)?(e[-+]?\d(_?\d)*)?$/.test(body) && /\d/.test(body)) {
      const r = parseFloat(body.replace(/_/g, ''));
      if (!Number.isNaN(r)) return sign * r;
    }
    raiseError('ValueError', `could not convert string to float: ${pyRepr(uv)}`);
  }
  if (v instanceof PyInstance) {
    const hit = mroLookup(v.cls, '__float__');
    if (hit && !hit.owner.builtin) {
      const r = pyCall(bindClassAttr(hit.value, v), []);
      if (typeof r === 'number') return r;
      if (typeof r === 'bigint') return bigIntToNumber(r);
      raiseError('TypeError', `__float__ returned non-float (type ${typeOf(r).name})`);
    }
  }
  raiseError('TypeError', `float() argument must be a string or a real number, not '${typeOf(v).name}'`);
}

TYPE_INT.construct = intConstruct;
TYPE_FLOAT.construct = floatConstruct;
TYPE_BOOL.construct = (args, kwargs) => {
  noKw('bool', kwargs);
  checkArgs('bool', args, 0, 1);
  return args.length === 0 ? false : pyTruthy(args[0]);
};
TYPE_STR.construct = (args, kwargs) => {
  checkArgs('str', args, 0, 3);
  return args.length === 0 ? '' : pyStr(args[0]);
};
TYPE_LIST.construct = (args, kwargs) => {
  noKw('list', kwargs);
  checkArgs('list', args, 0, 1);
  return new PyList(args.length === 0 ? [] : iterToArray(args[0]));
};
TYPE_TUPLE.construct = (args, kwargs) => {
  noKw('tuple', kwargs);
  checkArgs('tuple', args, 0, 1);
  if (args.length === 0) return new PyTuple([]);
  if (args[0] instanceof PyTuple) return args[0];
  return new PyTuple(iterToArray(args[0]));
};
TYPE_DICT.construct = (args, kwargs) => {
  checkArgs('dict', args, 0, 1);
  const d = new PyDict();
  if (args.length === 1) dictUpdateFrom(d, args[0]);
  if (kwargs) for (const [k, v] of kwargs) d.set(k, v);
  return d;
};
TYPE_SET.construct = (args, kwargs) => {
  noKw('set', kwargs);
  checkArgs('set', args, 0, 1);
  const s = new PySet();
  if (args.length === 1) for (const x of iterToArray(args[0])) s.add(x);
  return s;
};
TYPE_FROZENSET.construct = (args, kwargs) => {
  noKw('frozenset', kwargs);
  checkArgs('frozenset', args, 0, 1);
  const s = new PySet(true);
  if (args.length === 1) for (const x of iterToArray(args[0])) s.add(x);
  return s;
};
TYPE_RANGE.construct = (args, kwargs) => {
  noKw('range', kwargs);
  checkArgs('range', args, 1, 3);
  if (args.length === 1) return new PyRange(0n, numToBigInt(args[0]), 1n);
  const start = numToBigInt(args[0]);
  const stop = numToBigInt(args[1]);
  const step = args.length === 3 ? numToBigInt(args[2]) : 1n;
  if (step === 0n) raiseError('ValueError', 'range() arg 3 must not be zero');
  return new PyRange(start, stop, step);
};
TYPE_SLICE.construct = (args, kwargs) => {
  noKw('slice', kwargs);
  checkArgs('slice', args, 1, 3);
  if (args.length === 1) return new PySlice(NONE, args[0], NONE);
  return new PySlice(args[0], args[1], args.length === 3 ? args[2] : NONE);
};
TYPE_OBJECT.construct = (args, kwargs) => {
  if (args.length || (kwargs && kwargs.size)) {
    raiseError('TypeError', 'object() takes no arguments');
  }
  return new PyInstance(TYPE_OBJECT);
};
TYPE_PROPERTY.construct = (args, kwargs) => {
  const kw = kwOnly(kwargs, ['fget', 'fset', 'fdel', 'doc'], 'property');
  return new PyProperty(
    args[0] !== undefined ? args[0] : kw.fget,
    args[1] !== undefined ? args[1] : kw.fset,
    args[2] !== undefined ? args[2] : kw.fdel,
    args[3] !== undefined ? args[3] : kw.doc,
  );
};
TYPE_CLASSMETHOD.construct = (args) => new PyClassMethod(args[0]);
TYPE_STATICMETHOD.construct = (args) => new PyStaticMethod(args[0]);
TYPE_TYPE.construct = (args, kwargs) => {
  if (args.length === 1) return typeOf(args[0]);
  checkArgs('type', args, 3, 3);
  const [name, basesT, ns] = args;
  if (typeof name !== 'string') raiseError('TypeError', 'type() argument 1 must be str');
  const bases = basesT instanceof PyTuple ? [...basesT.items] : null;
  if (!bases) raiseError('TypeError', 'type() argument 2 must be tuple');
  const attrs = new Map();
  if (ns instanceof PyDict) {
    for (const [k, v] of ns.entries()) {
      if (typeof k === 'string') attrs.set(k, v);
    }
  }
  const effectiveBases = bases.length ? bases : [TYPE_OBJECT];
  return new PyType(name, effectiveBases, attrs, { module: '__main__' });
};

// Exception type constructors.
for (const t of Object.values(EXC)) {
  t.construct = ((cls) => (args, kwargs) => {
    const inst = new PyInstance(cls);
    inst.attrs.set('args', new PyTuple([...args]));
    return inst;
  })(t);
}

function dictUpdateFrom(d, src) {
  const usrc = unwrap(src);
  if (usrc instanceof PyDict) {
    for (const [k, v] of usrc.entries()) d.set(k, v);
    return;
  }
  if (src instanceof PyInstance && hasAttr(src, 'keys')) {
    const keys = iterToArray(pyCallMethod(src, 'keys', []));
    for (const k of keys) d.set(k, getItem(src, k));
    return;
  }
  let i = 0;
  for (const pair of iterToArray(src)) {
    const items = iterToArray(pair);
    if (items.length !== 2) {
      raiseError('ValueError', `dictionary update sequence element #${i} has length ${items.length}; 2 is required`);
    }
    d.set(items[0], items[1]);
    i++;
  }
}

// ---------- str methods ----------

function isSpaceChar(ch) { return /\s/u.test(ch); }

function doStrip(s, chars, left, right) {
  const arr = cp(s);
  const test = chars === undefined || chars === NONE
    ? isSpaceChar
    : (ch) => chars.includes(ch);
  let i = 0, j = arr.length;
  if (left) while (i < j && test(arr[i])) i++;
  if (right) while (j > i && test(arr[j - 1])) j--;
  return arr.slice(i, j).join('');
}

function strFindIndex(s, sub, start, end, fromRight) {
  const arr = cp(s);
  const subArr = cp(sub);
  const [st, en] = adjustIndices(arr.length, start, end);
  const hay = arr.slice(st, en).join('');
  const idx = fromRight ? hay.lastIndexOf(sub) : hay.indexOf(sub);
  if (idx === -1) return -1;
  // Convert UTF-16 offset back to code point offset.
  return st + cp(hay.slice(0, idx)).length;
}

function strSplitWhitespace(s, maxsplit) {
  const out = [];
  let cur = '';
  let count = 0;
  const arr = cp(s);
  let i = 0;
  while (i < arr.length) {
    while (i < arr.length && isSpaceChar(arr[i])) i++;
    if (i >= arr.length) break;
    if (maxsplit >= 0 && count >= maxsplit) {
      out.push(arr.slice(i).join(''));
      return out;
    }
    cur = '';
    while (i < arr.length && !isSpaceChar(arr[i])) { cur += arr[i]; i++; }
    out.push(cur);
    count++;
  }
  return out;
}

meth(TYPE_STR, 'upper', (self) => asStr(self, 'upper').toUpperCase());
meth(TYPE_STR, 'lower', (self) => asStr(self, 'lower').toLowerCase());
meth(TYPE_STR, 'casefold', (self) => asStr(self, 'casefold').toLowerCase());
meth(TYPE_STR, 'capitalize', (self) => {
  const arr = cp(asStr(self, 'capitalize'));
  if (!arr.length) return '';
  return arr[0].toUpperCase() + arr.slice(1).join('').toLowerCase();
});
meth(TYPE_STR, 'title', (self) => {
  const s = asStr(self, 'title');
  let out = '';
  let prevAlpha = false;
  for (const ch of s) {
    const isAlpha = /\p{L}/u.test(ch);
    out += isAlpha ? (prevAlpha ? ch.toLowerCase() : ch.toUpperCase()) : ch;
    prevAlpha = isAlpha;
  }
  return out;
});
meth(TYPE_STR, 'swapcase', (self) => {
  let out = '';
  for (const ch of asStr(self, 'swapcase')) {
    const up = ch.toUpperCase(), low = ch.toLowerCase();
    out += ch === low && ch !== up ? up : ch === up && ch !== low ? low : ch;
  }
  return out;
});
meth(TYPE_STR, 'strip', (self, args) => doStrip(asStr(self, 'strip'), args[0], true, true));
meth(TYPE_STR, 'lstrip', (self, args) => doStrip(asStr(self, 'lstrip'), args[0], true, false));
meth(TYPE_STR, 'rstrip', (self, args) => doStrip(asStr(self, 'rstrip'), args[0], false, true));
meth(TYPE_STR, 'find', (self, args) => BigInt(strFindIndex(asStr(self, 'find'), args[0], args[1], args[2], false)));
meth(TYPE_STR, 'rfind', (self, args) => BigInt(strFindIndex(asStr(self, 'rfind'), args[0], args[1], args[2], true)));
meth(TYPE_STR, 'index', (self, args) => {
  const r = strFindIndex(asStr(self, 'index'), args[0], args[1], args[2], false);
  if (r === -1) raiseError('ValueError', 'substring not found');
  return BigInt(r);
});
meth(TYPE_STR, 'rindex', (self, args) => {
  const r = strFindIndex(asStr(self, 'rindex'), args[0], args[1], args[2], true);
  if (r === -1) raiseError('ValueError', 'substring not found');
  return BigInt(r);
});
meth(TYPE_STR, 'count', (self, args) => {
  const s = asStr(self, 'count');
  const sub = args[0];
  if (typeof sub !== 'string') raiseError('TypeError', 'must be str');
  const arr = cp(s);
  const [st, en] = adjustIndices(arr.length, args[1], args[2]);
  const hay = arr.slice(st, en).join('');
  if (sub === '') return BigInt(cp(hay).length + 1);
  let count = 0, idx = 0;
  for (;;) {
    const i = hay.indexOf(sub, idx);
    if (i === -1) break;
    count++;
    idx = i + sub.length;
  }
  return BigInt(count);
});
meth(TYPE_STR, 'startswith', (self, args) => {
  const s = asStr(self, 'startswith');
  const arr = cp(s);
  const [st, en] = adjustIndices(arr.length, args[1], args[2]);
  const hay = arr.slice(st, en).join('');
  const prefixes = args[0] instanceof PyTuple ? args[0].items : [args[0]];
  return prefixes.some((p) => {
    if (typeof p !== 'string') raiseError('TypeError', 'startswith first arg must be str or a tuple of str');
    return hay.startsWith(p);
  });
});
meth(TYPE_STR, 'endswith', (self, args) => {
  const s = asStr(self, 'endswith');
  const arr = cp(s);
  const [st, en] = adjustIndices(arr.length, args[1], args[2]);
  const hay = arr.slice(st, en).join('');
  const suffixes = args[0] instanceof PyTuple ? args[0].items : [args[0]];
  return suffixes.some((p) => {
    if (typeof p !== 'string') raiseError('TypeError', 'endswith first arg must be str or a tuple of str');
    return hay.endsWith(p);
  });
});
meth(TYPE_STR, 'replace', (self, args) => {
  const s = asStr(self, 'replace');
  const [oldS, newS] = args;
  if (typeof oldS !== 'string' || typeof newS !== 'string') {
    raiseError('TypeError', 'replace() arguments must be str');
  }
  let count = args[2] === undefined || args[2] === NONE ? -1 : Number(numToBigInt(args[2]));
  if (count < 0) count = Infinity;
  if (oldS === '') {
    const arr = cp(s);
    let out = '';
    let done = 0;
    for (let i = 0; i <= arr.length; i++) {
      if (done < count) { out += newS; done++; }
      if (i < arr.length) out += arr[i];
    }
    return out;
  }
  let out = '';
  let idx = 0, done = 0;
  for (;;) {
    const i = done < count ? s.indexOf(oldS, idx) : -1;
    if (i === -1) { out += s.slice(idx); break; }
    out += s.slice(idx, i) + newS;
    idx = i + oldS.length;
    done++;
  }
  return out;
});
meth(TYPE_STR, 'split', (self, args, kwargs) => {
  const s = asStr(self, 'split');
  const kw = kwOnly(kwargs, ['sep', 'maxsplit'], 'split');
  const sep = args[0] !== undefined ? args[0] : (kw.sep !== undefined ? kw.sep : NONE);
  const msArg = args[1] !== undefined ? args[1] : (kw.maxsplit !== undefined ? kw.maxsplit : -1n);
  const maxsplit = Number(numToBigInt(msArg));
  if (sep === NONE) {
    return new PyList(strSplitWhitespace(s, maxsplit));
  }
  if (typeof sep !== 'string') raiseError('TypeError', `must be str or None, not ${typeOf(sep).name}`);
  if (sep === '') raiseError('ValueError', 'empty separator');
  const out = [];
  let idx = 0, count = 0;
  for (;;) {
    if (maxsplit >= 0 && count >= maxsplit) break;
    const i = s.indexOf(sep, idx);
    if (i === -1) break;
    out.push(s.slice(idx, i));
    idx = i + sep.length;
    count++;
  }
  out.push(s.slice(idx));
  return new PyList(out);
});
meth(TYPE_STR, 'rsplit', (self, args, kwargs) => {
  const s = asStr(self, 'rsplit');
  const kw = kwOnly(kwargs, ['sep', 'maxsplit'], 'rsplit');
  const sep = args[0] !== undefined ? args[0] : (kw.sep !== undefined ? kw.sep : NONE);
  const msArg = args[1] !== undefined ? args[1] : (kw.maxsplit !== undefined ? kw.maxsplit : -1n);
  const maxsplit = Number(numToBigInt(msArg));
  if (sep === NONE) {
    if (maxsplit < 0) return new PyList(strSplitWhitespace(s, -1));
    // Split from the right on whitespace.
    const words = strSplitWhitespace(s, -1);
    if (words.length <= maxsplit) return new PyList(words);
    // Rebuild: join the leading part.
    const tail = words.slice(words.length - maxsplit);
    // Find the prefix string up to where tail starts (approximate by re-scanning).
    let remaining = s;
    for (let k = 0; k < tail.length; k++) {
      const i = remaining.lastIndexOf(tail[tail.length - 1 - k]);
      remaining = remaining.slice(0, i);
    }
    return new PyList([doStrip(remaining, undefined, false, true), ...tail]);
  }
  if (typeof sep !== 'string') raiseError('TypeError', `must be str or None, not ${typeOf(sep).name}`);
  if (sep === '') raiseError('ValueError', 'empty separator');
  const parts = [];
  let idx = s.length, count = 0;
  for (;;) {
    if (maxsplit >= 0 && count >= maxsplit) break;
    const i = s.lastIndexOf(sep, idx - sep.length);
    if (i === -1 || idx <= 0) break;
    parts.unshift(s.slice(i + sep.length, idx));
    idx = i;
    count++;
  }
  parts.unshift(s.slice(0, idx));
  return new PyList(parts);
});
meth(TYPE_STR, 'splitlines', (self, args, kwargs) => {
  const s = asStr(self, 'splitlines');
  const kw = kwOnly(kwargs, ['keepends'], 'splitlines');
  const keepends = pyTruthy(args[0] !== undefined ? args[0] : (kw.keepends !== undefined ? kw.keepends : false));
  const out = [];
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '\r' || ch === '\n' || ch === '\v' || ch === '\f' || ch === ' ' || ch === ' ' || ch === '\x1c' || ch === '\x1d' || ch === '\x1e' || ch === '\x85') {
      let endLen = 1;
      if (ch === '\r' && s[i + 1] === '\n') { endLen = 2; }
      out.push(keepends ? cur + s.slice(i, i + endLen) : cur);
      i += endLen - 1;
      cur = '';
    } else {
      cur += ch;
    }
  }
  if (cur !== '') out.push(cur);
  return new PyList(out);
});
meth(TYPE_STR, 'join', (self, args) => {
  const sep = asStr(self, 'join');
  const items = iterToArray(args[0]);
  const parts = items.map((x, i) => {
    const ux = unwrap(x);
    if (typeof ux !== 'string') {
      raiseError('TypeError', `sequence item ${i}: expected str instance, ${typeOf(x).name} found`);
    }
    return ux;
  });
  return parts.join(sep);
});
meth(TYPE_STR, 'partition', (self, args) => {
  const s = asStr(self, 'partition');
  const sep = args[0];
  if (typeof sep !== 'string') raiseError('TypeError', 'must be str');
  if (sep === '') raiseError('ValueError', 'empty separator');
  const i = s.indexOf(sep);
  if (i === -1) return new PyTuple([s, '', '']);
  return new PyTuple([s.slice(0, i), sep, s.slice(i + sep.length)]);
});
meth(TYPE_STR, 'rpartition', (self, args) => {
  const s = asStr(self, 'rpartition');
  const sep = args[0];
  if (typeof sep !== 'string') raiseError('TypeError', 'must be str');
  if (sep === '') raiseError('ValueError', 'empty separator');
  const i = s.lastIndexOf(sep);
  if (i === -1) return new PyTuple(['', '', s]);
  return new PyTuple([s.slice(0, i), sep, s.slice(i + sep.length)]);
});
meth(TYPE_STR, 'removeprefix', (self, args) => {
  const s = asStr(self, 'removeprefix');
  return s.startsWith(args[0]) ? s.slice(args[0].length) : s;
});
meth(TYPE_STR, 'removesuffix', (self, args) => {
  const s = asStr(self, 'removesuffix');
  return args[0] !== '' && s.endsWith(args[0]) ? s.slice(0, s.length - args[0].length) : s;
});
meth(TYPE_STR, 'ljust', (self, args) => {
  const s = asStr(self, 'ljust');
  const w = Number(numToBigInt(args[0]));
  const fill = args[1] === undefined ? ' ' : args[1];
  const len = cp(s).length;
  return len >= w ? s : s + fill.repeat(w - len);
});
meth(TYPE_STR, 'rjust', (self, args) => {
  const s = asStr(self, 'rjust');
  const w = Number(numToBigInt(args[0]));
  const fill = args[1] === undefined ? ' ' : args[1];
  const len = cp(s).length;
  return len >= w ? s : fill.repeat(w - len) + s;
});
meth(TYPE_STR, 'center', (self, args) => {
  const s = asStr(self, 'center');
  const w = Number(numToBigInt(args[0]));
  const fill = args[1] === undefined ? ' ' : args[1];
  const len = cp(s).length;
  if (len >= w) return s;
  const marg = w - len;
  const left = Math.floor(marg / 2) + (marg & w & 1);
  return fill.repeat(left) + s + fill.repeat(marg - left);
});
meth(TYPE_STR, 'zfill', (self, args) => {
  const s = asStr(self, 'zfill');
  const w = Number(numToBigInt(args[0]));
  const len = cp(s).length;
  if (len >= w) return s;
  const sign = s[0] === '+' || s[0] === '-' ? s[0] : '';
  return sign + '0'.repeat(w - len) + s.slice(sign.length);
});
meth(TYPE_STR, 'expandtabs', (self, args, kwargs) => {
  const s = asStr(self, 'expandtabs');
  const kw = kwOnly(kwargs, ['tabsize'], 'expandtabs');
  const tabsize = Number(numToBigInt(args[0] !== undefined ? args[0] : (kw.tabsize !== undefined ? kw.tabsize : 8n)));
  let out = '';
  let col = 0;
  for (const ch of s) {
    if (ch === '\t') {
      const pad = tabsize > 0 ? tabsize - (col % tabsize) : 0;
      out += ' '.repeat(pad);
      col += pad;
    } else if (ch === '\n' || ch === '\r') {
      out += ch;
      col = 0;
    } else {
      out += ch;
      col++;
    }
  }
  return out;
});

function allChars(s, pred) {
  if (s.length === 0) return false;
  for (const ch of s) if (!pred(ch)) return false;
  return true;
}
meth(TYPE_STR, 'isdigit', (self) => allChars(asStr(self, 'isdigit'), (c) => /\p{Nd}/u.test(c)));
meth(TYPE_STR, 'isdecimal', (self) => allChars(asStr(self, 'isdecimal'), (c) => /\p{Nd}/u.test(c)));
meth(TYPE_STR, 'isnumeric', (self) => allChars(asStr(self, 'isnumeric'), (c) => /\p{N}/u.test(c)));
meth(TYPE_STR, 'isalpha', (self) => allChars(asStr(self, 'isalpha'), (c) => /\p{L}/u.test(c)));
meth(TYPE_STR, 'isalnum', (self) => allChars(asStr(self, 'isalnum'), (c) => /[\p{L}\p{N}]/u.test(c)));
meth(TYPE_STR, 'isspace', (self) => allChars(asStr(self, 'isspace'), isSpaceChar));
meth(TYPE_STR, 'isascii', (self) => {
  const s = asStr(self, 'isascii');
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) > 127) return false;
  return true;
});
meth(TYPE_STR, 'islower', (self) => {
  const s = asStr(self, 'islower');
  let cased = false;
  for (const ch of s) {
    const up = ch.toUpperCase(), low = ch.toLowerCase();
    if (up !== low) {
      cased = true;
      if (ch !== low) return false;
    }
  }
  return cased;
});
meth(TYPE_STR, 'isupper', (self) => {
  const s = asStr(self, 'isupper');
  let cased = false;
  for (const ch of s) {
    const up = ch.toUpperCase(), low = ch.toLowerCase();
    if (up !== low) {
      cased = true;
      if (ch !== up) return false;
    }
  }
  return cased;
});
meth(TYPE_STR, 'istitle', (self) => {
  const s = asStr(self, 'istitle');
  let cased = false;
  let prevCased = false;
  for (const ch of s) {
    const up = ch.toUpperCase(), low = ch.toLowerCase();
    const isCased = up !== low;
    if (isCased) {
      cased = true;
      const isUpper = ch === up;
      if (prevCased && isUpper) return false;
      if (!prevCased && !isUpper) return false;
    }
    prevCased = isCased;
  }
  return cased;
});
meth(TYPE_STR, 'isidentifier', (self) => {
  const s = asStr(self, 'isidentifier');
  return /^[\p{ID_Start}_][\p{ID_Continue}]*$/u.test(s);
});
meth(TYPE_STR, 'isprintable', (self) => {
  const s = asStr(self, 'isprintable');
  for (const ch of s) {
    const code = ch.codePointAt(0);
    if (code < 0x20 || code === 0x7f || /\p{Zl}|\p{Zp}|\p{Cc}|\p{Cf}/u.test(ch)) return false;
    if (ch !== ' ' && /\p{Zs}/u.test(ch)) return false;
  }
  return true;
});
meth(TYPE_STR, 'format', (self, args, kwargs) => strFormat(asStr(self, 'format'), args, kwargs));
meth(TYPE_STR, 'format_map', (self, args) => {
  const map = args[0];
  const kw = new Map();
  const d = unwrap(map);
  if (d instanceof PyDict) {
    for (const [k, v] of d.entries()) if (typeof k === 'string') kw.set(k, v);
  }
  return strFormat(asStr(self, 'format_map'), [], kw, map);
});
meth(TYPE_STR, 'encode', (self) => {
  raiseError('NotImplementedError', 'bytes are not supported in this implementation');
});
meth(TYPE_STR, '__len__', (self) => BigInt(cp(asStr(self, '__len__')).length));
meth(TYPE_STR, '__getitem__', (self, args) => getItem(asStr(self, '__getitem__'), args[0]));
meth(TYPE_STR, '__contains__', (self, args) => asStr(self, '__contains__').includes(args[0]));

// str.format implementation
export function strFormat(fmt, args, kwargs, mapping = null) {
  let autoIdx = 0;
  let manual = false;
  let auto = false;

  function resolveField(field) {
    // field: e.g. "0.name[2]" or "name" or ""
    let i = 0;
    let head = '';
    while (i < field.length && field[i] !== '.' && field[i] !== '[') { head += field[i]; i++; }
    let value;
    if (head === '') {
      if (manual) raiseError('ValueError', 'cannot switch from manual field specification to automatic field numbering');
      auto = true;
      if (autoIdx >= args.length) raiseError('IndexError', 'Replacement index out of range for positional args tuple');
      value = args[autoIdx++];
    } else if (/^\d+$/.test(head)) {
      if (auto) raiseError('ValueError', 'cannot switch from automatic field numbering to manual field specification');
      manual = true;
      const idx = parseInt(head, 10);
      if (idx >= args.length) raiseError('IndexError', 'Replacement index out of range for positional args tuple');
      value = args[idx];
    } else {
      if (kwargs && kwargs.has(head)) value = kwargs.get(head);
      else if (mapping) value = getItem(mapping, head);
      else throw new PyError(keyErrorExc(head));
    }
    while (i < field.length) {
      if (field[i] === '.') {
        i++;
        let name = '';
        while (i < field.length && field[i] !== '.' && field[i] !== '[') { name += field[i]; i++; }
        value = getAttr(value, name);
      } else if (field[i] === '[') {
        const close = field.indexOf(']', i);
        if (close === -1) raiseError('ValueError', "Missing ']' in format string");
        const key = field.slice(i + 1, close);
        value = getItem(value, /^\d+$/.test(key) ? BigInt(key) : key);
        i = close + 1;
      } else {
        raiseError('ValueError', 'invalid format string');
      }
    }
    return value;
  }

  function formatChunk(str) {
    let out = '';
    let i = 0;
    while (i < str.length) {
      const ch = str[i];
      if (ch === '{') {
        if (str[i + 1] === '{') { out += '{'; i += 2; continue; }
        // find matching close brace, allowing one nesting level in spec
        let depth = 1;
        let j = i + 1;
        while (j < str.length && depth > 0) {
          if (str[j] === '{') depth++;
          else if (str[j] === '}') depth--;
          if (depth === 0) break;
          j++;
        }
        if (depth !== 0) raiseError('ValueError', "Single '{' encountered in format string");
        const inner = str.slice(i + 1, j);
        out += formatField(inner);
        i = j + 1;
      } else if (ch === '}') {
        if (str[i + 1] === '}') { out += '}'; i += 2; continue; }
        raiseError('ValueError', "Single '}' encountered in format string");
      } else {
        out += ch;
        i++;
      }
    }
    return out;
  }

  function formatField(inner) {
    // inner: field[!conv][:spec]
    let field = inner;
    let conv = null;
    let spec = '';
    const colonIdx = findTopLevelColon(inner);
    if (colonIdx !== -1) {
      field = inner.slice(0, colonIdx);
      spec = inner.slice(colonIdx + 1);
    }
    const bangIdx = field.lastIndexOf('!');
    if (bangIdx !== -1 && bangIdx === field.length - 2 && 'rsa'.includes(field[field.length - 1])) {
      conv = field[field.length - 1];
      field = field.slice(0, bangIdx);
    }
    let value = resolveField(field);
    if (conv === 'r' || conv === 'a') value = pyRepr(value);
    else if (conv === 's') value = pyStr(value);
    // spec may itself contain {nested} fields
    if (spec.includes('{')) spec = formatChunk(spec);
    return pyFormat(value, spec);
  }

  function findTopLevelColon(s) {
    let depth = 0;
    for (let i = 0; i < s.length; i++) {
      if (s[i] === '[') depth++;
      else if (s[i] === ']') depth--;
      else if (s[i] === ':' && depth === 0) return i;
    }
    return -1;
  }

  return formatChunk(fmt);
}

// ---------- list methods ----------

meth(TYPE_LIST, 'append', (self, args) => {
  checkArgs('append', args, 1, 1);
  asList(self, 'append').items.push(args[0]);
  return NONE;
});
meth(TYPE_LIST, 'extend', (self, args) => {
  checkArgs('extend', args, 1, 1);
  const l = asList(self, 'extend');
  l.items.push(...iterToArray(args[0]));
  return NONE;
});
meth(TYPE_LIST, 'insert', (self, args) => {
  checkArgs('insert', args, 2, 2);
  const l = asList(self, 'insert');
  let i = Number(numToBigInt(args[0]));
  if (i < 0) i = Math.max(0, i + l.items.length);
  if (i > l.items.length) i = l.items.length;
  l.items.splice(i, 0, args[1]);
  return NONE;
});
meth(TYPE_LIST, 'pop', (self, args) => {
  const l = asList(self, 'pop');
  if (!l.items.length) raiseError('IndexError', 'pop from empty list');
  let i = args.length ? Number(numToBigInt(args[0])) : -1;
  if (i < 0) i += l.items.length;
  if (i < 0 || i >= l.items.length) raiseError('IndexError', 'pop index out of range');
  return l.items.splice(i, 1)[0];
});
meth(TYPE_LIST, 'remove', (self, args) => {
  const l = asList(self, 'remove');
  for (let i = 0; i < l.items.length; i++) {
    if (pyEq(l.items[i], args[0])) {
      l.items.splice(i, 1);
      return NONE;
    }
  }
  raiseError('ValueError', 'list.remove(x): x not in list');
});
meth(TYPE_LIST, 'index', (self, args) => {
  const l = asList(self, 'index');
  const [st, en] = adjustIndices(l.items.length, args[1], args[2]);
  for (let i = st; i < en; i++) {
    if (pyEq(l.items[i], args[0])) return BigInt(i);
  }
  raiseError('ValueError', `${pyRepr(args[0])} is not in list`);
});
meth(TYPE_LIST, 'count', (self, args) => {
  const l = asList(self, 'count');
  return BigInt(l.items.filter((x) => pyEq(x, args[0])).length);
});
meth(TYPE_LIST, 'reverse', (self) => {
  asList(self, 'reverse').items.reverse();
  return NONE;
});
meth(TYPE_LIST, 'clear', (self) => {
  asList(self, 'clear').items.length = 0;
  return NONE;
});
meth(TYPE_LIST, 'copy', (self) => new PyList([...asList(self, 'copy').items]));
meth(TYPE_LIST, 'sort', (self, args, kwargs) => {
  if (args.length) raiseError('TypeError', 'sort() takes no positional arguments');
  const kw = kwOnly(kwargs, ['key', 'reverse'], 'sort');
  const l = asList(self, 'sort');
  pySortInPlace(l.items, kw.key !== undefined ? kw.key : NONE, kw.reverse !== undefined && pyTruthy(kw.reverse));
  return NONE;
});
meth(TYPE_LIST, '__init__', (self, args) => {
  const l = asList(self, '__init__');
  l.items.length = 0;
  if (args.length) l.items.push(...iterToArray(args[0]));
  return NONE;
});
meth(TYPE_LIST, '__len__', (self) => BigInt(asList(self, '__len__').items.length));
meth(TYPE_LIST, '__getitem__', (self, args) => getItem(asList(self, '__getitem__'), args[0]));
meth(TYPE_LIST, '__setitem__', (self, args) => { setItem(asList(self, '__setitem__'), args[0], args[1]); return NONE; });
meth(TYPE_LIST, '__contains__', (self, args) => asList(self, '__contains__').items.some((x) => pyEq(x, args[0])));

export function pySortInPlace(items, keyFn, reverse) {
  let keyed;
  if (keyFn !== NONE) {
    keyed = items.map((x, i) => ({ k: pyCall(keyFn, [x]), v: x, i }));
  } else {
    keyed = items.map((x, i) => ({ k: x, v: x, i }));
  }
  keyed.sort((a, b) => {
    if (richCompare('<', a.k, b.k)) return -1;
    if (richCompare('<', b.k, a.k)) return 1;
    return a.i - b.i; // stability
  });
  if (reverse) {
    // Python reverse=True is a stable reversed sort: sort by key descending,
    // equal keys keep original order. Reversing a stable ascending sort with
    // index tiebreak inverts equal-key order, so re-sort with inverted compare.
    keyed.sort((a, b) => {
      if (richCompare('<', b.k, a.k)) return -1;
      if (richCompare('<', a.k, b.k)) return 1;
      return a.i - b.i;
    });
  }
  for (let i = 0; i < items.length; i++) items[i] = keyed[i].v;
}

// ---------- tuple methods ----------

meth(TYPE_TUPLE, 'count', (self, args) => {
  const t = unwrap(self);
  return BigInt(t.items.filter((x) => pyEq(x, args[0])).length);
});
meth(TYPE_TUPLE, 'index', (self, args) => {
  const t = unwrap(self);
  const [st, en] = adjustIndices(t.items.length, args[1], args[2]);
  for (let i = st; i < en; i++) {
    if (pyEq(t.items[i], args[0])) return BigInt(i);
  }
  raiseError('ValueError', 'tuple.index(x): x not in tuple');
});

// ---------- dict methods ----------

function makeDictView(name, items) {
  const cls = DICT_VIEW_TYPES[name];
  const inst = new PyInstance(cls);
  inst.attrs.set('_items', new PyList(items));
  return inst;
}

function makeViewType(name) {
  const t = new PyType(name, [TYPE_OBJECT], new Map(), { module: 'builtins' });
  t.attrs.set('__repr__', new PyBuiltin('__repr__', (self) => {
    const items = self.attrs.get('_items');
    if (name === 'dict_items') {
      return `dict_items([${items.items.map(pyRepr).join(', ')}])`;
    }
    return `${name}([${items.items.map(pyRepr).join(', ')}])`;
  }, true));
  t.attrs.set('__iter__', new PyBuiltin('__iter__', (self) => {
    const arr = self.attrs.get('_items').items;
    let i = 0;
    return new PyIterator(() => (i < arr.length ? arr[i++] : DONE), name + '_iterator');
  }, true));
  t.attrs.set('__len__', new PyBuiltin('__len__', (self) => BigInt(self.attrs.get('_items').items.length), true));
  t.attrs.set('__contains__', new PyBuiltin('__contains__', (self, args) =>
    self.attrs.get('_items').items.some((x) => pyEq(x, args[0])), true));
  return t;
}

const DICT_VIEW_TYPES = {
  dict_keys: makeViewType('dict_keys'),
  dict_values: makeViewType('dict_values'),
  dict_items: makeViewType('dict_items'),
};

meth(TYPE_DICT, 'keys', (self) => makeDictView('dict_keys', asDict(self, 'keys').keysArray()));
meth(TYPE_DICT, 'values', (self) => makeDictView('dict_values', asDict(self, 'values').valuesArray()));
meth(TYPE_DICT, 'items', (self) => makeDictView('dict_items',
  [...asDict(self, 'items').entries()].map(([k, v]) => new PyTuple([k, v]))));
meth(TYPE_DICT, 'get', (self, args) => {
  checkArgs('get', args, 1, 2);
  const e = asDict(self, 'get').getEntry(args[0]);
  if (e) return e.value;
  return args.length === 2 ? args[1] : NONE;
});
meth(TYPE_DICT, 'pop', (self, args) => {
  checkArgs('pop', args, 1, 2);
  const d = asDict(self, 'pop');
  const e = d.getEntry(args[0]);
  if (e) {
    d.delete(args[0]);
    return e.value;
  }
  if (args.length === 2) return args[1];
  throw new PyError(keyErrorExc(args[0]));
});
meth(TYPE_DICT, 'popitem', (self) => {
  const d = asDict(self, 'popitem');
  const e = d.popLast();
  if (!e) raiseError('KeyError', 'popitem(): dictionary is empty');
  return new PyTuple([e.key, e.value]);
});
meth(TYPE_DICT, 'setdefault', (self, args) => {
  checkArgs('setdefault', args, 1, 2);
  const d = asDict(self, 'setdefault');
  const e = d.getEntry(args[0]);
  if (e) return e.value;
  const dv = args.length === 2 ? args[1] : NONE;
  d.set(args[0], dv);
  return dv;
});
meth(TYPE_DICT, 'update', (self, args, kwargs) => {
  checkArgs('update', args, 0, 1);
  const d = asDict(self, 'update');
  if (args.length) dictUpdateFrom(d, args[0]);
  if (kwargs) for (const [k, v] of kwargs) d.set(k, v);
  return NONE;
});
meth(TYPE_DICT, 'clear', (self) => { asDict(self, 'clear').clear(); return NONE; });
meth(TYPE_DICT, 'copy', (self) => asDict(self, 'copy').copy());
classMeth(TYPE_DICT, 'fromkeys', (cls, args) => {
  checkArgs('fromkeys', args, 1, 2);
  const d = new PyDict();
  const value = args.length === 2 ? args[1] : NONE;
  for (const k of iterToArray(args[0])) d.set(k, value);
  return d;
});
meth(TYPE_DICT, '__init__', (self, args, kwargs) => {
  const d = asDict(self, '__init__');
  if (args.length) dictUpdateFrom(d, args[0]);
  if (kwargs) for (const [k, v] of kwargs) d.set(k, v);
  return NONE;
});
meth(TYPE_DICT, '__len__', (self) => BigInt(asDict(self, '__len__').size));
meth(TYPE_DICT, '__getitem__', (self, args) => getItem(asDict(self, '__getitem__'), args[0]));
meth(TYPE_DICT, '__setitem__', (self, args) => { asDict(self, '__setitem__').set(args[0], args[1]); return NONE; });
meth(TYPE_DICT, '__contains__', (self, args) => asDict(self, '__contains__').has(args[0]));

// ---------- set methods ----------

function setFromIterables(args) {
  const out = [];
  for (const a of args) out.push(...iterToArray(a));
  return out;
}

meth(TYPE_SET, 'add', (self, args) => {
  asSet(self, 'add').add(args[0]);
  return NONE;
});
meth(TYPE_SET, 'discard', (self, args) => {
  asSet(self, 'discard').delete(args[0]);
  return NONE;
});
meth(TYPE_SET, 'remove', (self, args) => {
  if (!asSet(self, 'remove').delete(args[0])) {
    throw new PyError(keyErrorExc(args[0]));
  }
  return NONE;
});
meth(TYPE_SET, 'pop', (self) => {
  const s = asSet(self, 'pop');
  if (!s.size) raiseError('KeyError', 'pop from an empty set');
  return s.pop();
});
meth(TYPE_SET, 'clear', (self) => { asSet(self, 'clear').clear(); return NONE; });
meth(TYPE_SET, 'update', (self, args) => {
  const s = asSet(self, 'update');
  for (const x of setFromIterables(args)) s.add(x);
  return NONE;
});

for (const T of [TYPE_SET, TYPE_FROZENSET]) {
  meth(T, 'copy', (self) => asSet(self, 'copy').copy());
  meth(T, 'union', (self, args) => {
    const out = asSet(self, 'union').copy(false);
    for (const x of setFromIterables(args)) out.add(x);
    out.frozen = asSet(self, 'union').frozen;
    return out;
  });
  meth(T, 'intersection', (self, args) => {
    const s = asSet(self, 'intersection');
    const others = args.map((a) => new Set(iterToArray(a).map(hashKey)));
    const out = new PySet(s.frozen);
    for (const k of s.keys()) {
      if (others.every((o) => o.has(hashKey(k)))) out.add(k);
    }
    return out;
  });
  meth(T, 'difference', (self, args) => {
    const s = asSet(self, 'difference');
    const others = args.map((a) => new Set(iterToArray(a).map(hashKey)));
    const out = new PySet(s.frozen);
    for (const k of s.keys()) {
      if (!others.some((o) => o.has(hashKey(k)))) out.add(k);
    }
    return out;
  });
  meth(T, 'symmetric_difference', (self, args) => {
    checkArgs('symmetric_difference', args, 1, 1);
    const s = asSet(self, 'symmetric_difference');
    const other = new PySet();
    for (const x of iterToArray(args[0])) other.add(x);
    const out = new PySet(s.frozen);
    for (const k of s.keys()) if (!other.has(k)) out.add(k);
    for (const k of other.keys()) if (!s.has(k)) out.add(k);
    return out;
  });
  meth(T, 'issubset', (self, args) => {
    const s = asSet(self, 'issubset');
    const other = new Set(iterToArray(args[0]).map(hashKey));
    for (const k of s.keys()) if (!other.has(hashKey(k))) return false;
    return true;
  });
  meth(T, 'issuperset', (self, args) => {
    const s = asSet(self, 'issuperset');
    for (const x of iterToArray(args[0])) if (!s.has(x)) return false;
    return true;
  });
  meth(T, 'isdisjoint', (self, args) => {
    const s = asSet(self, 'isdisjoint');
    for (const x of iterToArray(args[0])) if (s.has(x)) return false;
    return true;
  });
}

meth(TYPE_SET, 'intersection_update', (self, args) => {
  const s = asSet(self, 'intersection_update');
  const others = args.map((a) => new Set(iterToArray(a).map(hashKey)));
  for (const k of s.keysArray()) {
    if (!others.every((o) => o.has(hashKey(k)))) s.delete(k);
  }
  return NONE;
});
meth(TYPE_SET, 'difference_update', (self, args) => {
  const s = asSet(self, 'difference_update');
  for (const x of setFromIterables(args)) s.delete(x);
  return NONE;
});
meth(TYPE_SET, 'symmetric_difference_update', (self, args) => {
  const s = asSet(self, 'symmetric_difference_update');
  const other = new PySet();
  for (const x of iterToArray(args[0])) other.add(x);
  for (const k of other.keys()) {
    if (s.has(k)) s.delete(k);
    else s.add(k);
  }
  return NONE;
});

// ---------- int / float methods ----------

meth(TYPE_INT, 'bit_length', (self) => {
  let v = unwrap(self);
  if (typeof v === 'boolean') v = v ? 1n : 0n;
  if (v < 0n) v = -v;
  return BigInt(v === 0n ? 0 : v.toString(2).length);
});
meth(TYPE_INT, 'bit_count', (self) => {
  let v = unwrap(self);
  if (typeof v === 'boolean') v = v ? 1n : 0n;
  if (v < 0n) v = -v;
  let count = 0;
  for (const ch of v.toString(2)) if (ch === '1') count++;
  return BigInt(count);
});
TYPE_INT.attrs.set('real', new PyProperty(new PyBuiltin('real', (self) => numToBigInt(unwrap(self)), true)));
TYPE_INT.attrs.set('imag', new PyProperty(new PyBuiltin('imag', () => 0n, true)));
TYPE_INT.attrs.set('numerator', new PyProperty(new PyBuiltin('numerator', (self) => numToBigInt(unwrap(self)), true)));
TYPE_INT.attrs.set('denominator', new PyProperty(new PyBuiltin('denominator', () => 1n, true)));

meth(TYPE_FLOAT, 'is_integer', (self) => Number.isInteger(unwrap(self)));
meth(TYPE_FLOAT, 'as_integer_ratio', (self) => {
  const x = unwrap(self);
  if (!Number.isFinite(x)) {
    if (Number.isNaN(x)) raiseError('ValueError', 'cannot convert NaN to integer ratio');
    raiseError('OverflowError', 'cannot convert Infinity to integer ratio');
  }
  if (x === 0) return new PyTuple([0n, 1n]);
  const { m, e } = floatParts(Math.abs(x));
  let num = m, den = 1n;
  if (e > 0) num <<= BigInt(e);
  else den <<= BigInt(-e);
  // reduce by gcd (powers of two)
  while (num % 2n === 0n && den % 2n === 0n) { num >>= 1n; den >>= 1n; }
  return new PyTuple([x < 0 ? -num : num, den]);
});
TYPE_FLOAT.attrs.set('real', new PyProperty(new PyBuiltin('real', (self) => unwrap(self), true)));
TYPE_FLOAT.attrs.set('imag', new PyProperty(new PyBuiltin('imag', () => 0.0, true)));

// ---------- generator / iterator methods ----------

meth(TYPE_GENERATOR, '__next__', (self) => {
  const r = self.nextValue(NONE);
  if (r === DONE) throw new PyError(stopIterationExc(self.returnValue));
  return r;
});
meth(TYPE_GENERATOR, '__iter__', (self) => self);
meth(TYPE_GENERATOR, 'send', (self, args) => {
  checkArgs('send', args, 1, 1);
  const r = self.nextValue(args[0]);
  if (r === DONE) throw new PyError(stopIterationExc(self.returnValue));
  return r;
});
meth(TYPE_GENERATOR, 'throw', (self, args) => {
  checkArgs('throw', args, 1, 3);
  let excInst;
  if (args[0] instanceof PyType && isExceptionType(args[0])) {
    excInst = pyCall(args[0], args.length > 1 && args[1] !== NONE ? [args[1]] : []);
  } else if (args[0] instanceof PyInstance && isExceptionType(args[0].cls)) {
    excInst = args[0];
  } else {
    raiseError('TypeError', 'exceptions must be classes or instances deriving from BaseException');
  }
  const r = self.throwIn(excInst);
  if (r === DONE) throw new PyError(stopIterationExc(self.returnValue));
  return r;
});
meth(TYPE_GENERATOR, 'close', (self) => { self.close(); return NONE; });

function stopIterationExc(value) {
  const inst = new PyInstance(EXC.StopIteration);
  const v = value === undefined ? NONE : value;
  inst.attrs.set('args', new PyTuple(v === NONE ? [] : [v]));
  inst.attrs.set('value', v);
  return inst;
}

meth(TYPE_ITERATOR, '__next__', (self) => {
  const r = self.nextFn();
  if (r === DONE) throw new PyError(stopIterationExc(NONE));
  return r;
});
meth(TYPE_ITERATOR, '__iter__', (self) => self);

// ---------- object / exception methods ----------

meth(TYPE_OBJECT, '__init__', () => NONE);
meth(TYPE_OBJECT, '__str__', (self) => pyStr(self));
meth(TYPE_OBJECT, '__repr__', (self) => pyRepr(self));
meth(TYPE_OBJECT, '__eq__', (self, args) => (self === args[0] ? true : NOT_IMPLEMENTED));
meth(TYPE_OBJECT, '__ne__', (self, args) => (self === args[0] ? false : NOT_IMPLEMENTED));
meth(TYPE_OBJECT, '__hash__', (self) => hashValue(self));
meth(TYPE_OBJECT, '__setattr__', (self, args) => {
  if (!(self instanceof PyInstance)) raiseError('TypeError', 'object.__setattr__ requires an instance');
  self.attrs.set(args[0], args[1]);
  return NONE;
});
meth(TYPE_OBJECT, '__getattribute__', (self, args) => getAttr(self, args[0]));

meth(EXC.BaseException, '__init__', (self, args) => {
  self.attrs.set('args', new PyTuple([...args]));
  return NONE;
});

// ---------- file methods ----------

meth(TYPE_FILE, 'read', (self, args) => {
  const size = args.length && args[0] !== NONE ? Number(numToBigInt(args[0])) : -1;
  return FileOps.read(self, size);
});
meth(TYPE_FILE, 'readline', (self) => {
  const line = FileOps.readLine(self);
  return line === null ? '' : line;
});
meth(TYPE_FILE, 'readlines', (self) => {
  const out = [];
  for (;;) {
    const line = FileOps.readLine(self);
    if (line === null) break;
    out.push(line);
  }
  return new PyList(out);
});
meth(TYPE_FILE, 'write', (self, args) => {
  const s = unwrap(args[0]);
  if (typeof s !== 'string') raiseError('TypeError', `write() argument must be str, not ${typeOf(args[0]).name}`);
  FileOps.write(self, s);
  return BigInt(cp(s).length);
});
meth(TYPE_FILE, 'writelines', (self, args) => {
  for (const line of iterToArray(args[0])) {
    FileOps.write(self, unwrap(line));
  }
  return NONE;
});
meth(TYPE_FILE, 'close', (self) => { FileOps.close(self); return NONE; });
meth(TYPE_FILE, 'flush', () => NONE);
meth(TYPE_FILE, '__enter__', (self) => self);
meth(TYPE_FILE, '__exit__', (self) => { FileOps.close(self); return false; });

// ---------- builtin functions ----------

export const BUILTINS = new Map();
function bi(name, f) { BUILTINS.set(name, fn(name, f)); }

bi('print', (args, kwargs) => {
  const kw = kwOnly(kwargs, ['sep', 'end', 'file', 'flush'], 'print');
  const sep = kw.sep === undefined || kw.sep === NONE ? ' ' : kw.sep;
  const end = kw.end === undefined || kw.end === NONE ? '\n' : kw.end;
  if (typeof sep !== 'string') raiseError('TypeError', `sep must be None or a string, not ${typeOf(sep).name}`);
  if (typeof end !== 'string') raiseError('TypeError', `end must be None or a string, not ${typeOf(end).name}`);
  const text = args.map(pyStr).join(sep) + end;
  if (kw.file !== undefined && kw.file !== NONE) {
    if (kw.file instanceof PyFile) {
      FileOps.write(kw.file, text);
      return NONE;
    }
    if (kw.file instanceof PyInstance || kw.file instanceof PyModule) {
      pyCallMethod(kw.file, 'write', [text]);
      return NONE;
    }
    // sys.stderr sentinel objects handled via their write method
    if (kw.file && kw.file.isStderr) {
      IO.writeErr(text);
      return NONE;
    }
  }
  IO.write(text);
  return NONE;
});

bi('repr', (args) => { checkArgs('repr', args, 1, 1); return pyRepr(args[0]); });
bi('ascii', (args) => {
  checkArgs('ascii', args, 1, 1);
  const r = pyRepr(args[0]);
  let out = '';
  for (const ch of r) {
    const code = ch.codePointAt(0);
    if (code < 128) out += ch;
    else if (code <= 0xff) out += '\\x' + code.toString(16).padStart(2, '0');
    else if (code <= 0xffff) out += '\\u' + code.toString(16).padStart(4, '0');
    else out += '\\U' + code.toString(16).padStart(8, '0');
  }
  return out;
});
bi('len', (args) => { checkArgs('len', args, 1, 1); return pyLen(args[0]); });
bi('abs', (args) => {
  checkArgs('abs', args, 1, 1);
  const v = args[0];
  if (v instanceof PyInstance) {
    const hit = mroLookup(v.cls, '__abs__');
    if (hit && !hit.owner.builtin) return pyCall(bindClassAttr(hit.value, v), []);
  }
  const uv = unwrap(v);
  if (typeof uv === 'bigint') return uv < 0n ? -uv : uv;
  if (typeof uv === 'boolean') return uv ? 1n : 0n;
  if (typeof uv === 'number') return Math.abs(uv);
  raiseError('TypeError', `bad operand type for abs(): '${typeOf(v).name}'`);
});
bi('min', (args, kwargs) => minMax(args, kwargs, 'min', '<'));
bi('max', (args, kwargs) => minMax(args, kwargs, 'max', '>'));
function minMax(args, kwargs, name, op) {
  const kw = kwOnly(kwargs, ['key', 'default'], name);
  const keyFn = kw.key !== undefined && kw.key !== NONE ? kw.key : null;
  let items;
  if (args.length === 0) raiseError('TypeError', `${name} expected at least 1 argument, got 0`);
  if (args.length === 1) items = iterToArray(args[0]);
  else items = args;
  if (!items.length) {
    if (kw.default !== undefined) return kw.default;
    raiseError('ValueError', `${name}() arg is an empty sequence`);
  }
  let best = items[0];
  let bestKey = keyFn ? pyCall(keyFn, [best]) : best;
  for (let i = 1; i < items.length; i++) {
    const k = keyFn ? pyCall(keyFn, [items[i]]) : items[i];
    if (richCompare(op, k, bestKey)) {
      best = items[i];
      bestKey = k;
    }
  }
  return best;
}
bi('sum', (args, kwargs) => {
  const kw = kwOnly(kwargs, ['start'], 'sum');
  checkArgs('sum', args, 1, 2);
  let acc = args.length === 2 ? args[1] : (kw.start !== undefined ? kw.start : 0n);
  if (typeof unwrap(acc) === 'string') raiseError('TypeError', "sum() can't sum strings [use ''.join(seq) instead]");
  for (const x of iterToArray(args[0])) {
    acc = binOp('+', acc, x);
  }
  return acc;
});
bi('sorted', (args, kwargs) => {
  checkArgs('sorted', args, 1, 1);
  const kw = kwOnly(kwargs, ['key', 'reverse'], 'sorted');
  const items = iterToArray(args[0]);
  pySortInPlace(items, kw.key !== undefined ? kw.key : NONE, kw.reverse !== undefined && pyTruthy(kw.reverse));
  return new PyList(items);
});
bi('reversed', (args) => {
  checkArgs('reversed', args, 1, 1);
  const v = args[0];
  if (v instanceof PyInstance) {
    const hit = mroLookup(v.cls, '__reversed__');
    if (hit && !hit.owner.builtin) {
      const itObj = pyCall(bindClassAttr(hit.value, v), []);
      return itObj;
    }
  }
  const uv = unwrap(v);
  let arr;
  if (uv instanceof PyList || uv instanceof PyTuple) arr = [...uv.items].reverse();
  else if (typeof uv === 'string') arr = cp(uv).reverse();
  else if (uv instanceof PyRange) arr = iterToArray(uv).reverse();
  else if (uv instanceof PyDict) arr = uv.keysArray().reverse();
  else raiseError('TypeError', `'${typeOf(v).name}' object is not reversible`);
  let i = 0;
  return new PyIterator(() => (i < arr.length ? arr[i++] : DONE), 'reversed');
});
bi('round', (args, kwargs) => {
  noKw('round', kwargs);
  checkArgs('round', args, 1, 2);
  const v = args[0];
  const nd = args.length === 2 ? args[1] : undefined;
  if (v instanceof PyInstance) {
    const hit = mroLookup(v.cls, '__round__');
    if (hit && !hit.owner.builtin) {
      return pyCall(bindClassAttr(hit.value, v), nd === undefined ? [] : [nd]);
    }
  }
  const uv = unwrap(v);
  if (typeof uv === 'bigint' || typeof uv === 'boolean') {
    const bv = typeof uv === 'boolean' ? (uv ? 1n : 0n) : uv;
    if (nd === undefined || nd === NONE) return bv;
    const n = Number(numToBigInt(nd));
    if (n >= 0) return bv;
    // round to multiple of 10^-n, half-even
    const p = 10n ** BigInt(-n);
    const q = bv / p;
    const r = bv % p;
    const ar = r < 0n ? -r : r;
    let qq = q;
    const twice = ar * 2n;
    if (twice > p || (twice === p && (q % 2n !== 0n))) {
      qq += bv < 0n ? -1n : 1n;
    }
    return qq * p;
  }
  if (typeof uv === 'number') {
    if (nd === undefined || nd === NONE) {
      if (Number.isNaN(uv)) raiseError('ValueError', 'cannot convert float NaN to integer');
      if (!Number.isFinite(uv)) raiseError('OverflowError', 'cannot convert float infinity to integer');
      return roundHalfEvenToInt(uv);
    }
    return roundToDigits(uv, Number(numToBigInt(nd)));
  }
  raiseError('TypeError', `type ${typeOf(v).name} doesn't define __round__ method`);
});
bi('divmod', (args) => {
  checkArgs('divmod', args, 2, 2);
  const q = binOp('//', args[0], args[1]);
  const r = binOp('%', args[0], args[1]);
  return new PyTuple([q, r]);
});
bi('pow', (args, kwargs) => {
  const kw = kwOnly(kwargs, ['base', 'exp', 'mod'], 'pow');
  let [base, e, mod] = args;
  if (kw.base !== undefined) base = kw.base;
  if (kw.exp !== undefined) e = kw.exp;
  if (kw.mod !== undefined) mod = kw.mod;
  if (mod === undefined || mod === NONE) return binOp('**', base, e);
  const b = numToBigInt(base), ex = numToBigInt(e), m = numToBigInt(mod);
  if (m === 0n) raiseError('ValueError', 'pow() 3rd argument cannot be 0');
  if (ex < 0n) raiseError('ValueError', 'pow() 2nd argument cannot be negative when 3rd argument specified');
  let result = 1n, bb = ((b % m) + m) % m, ee = ex;
  while (ee > 0n) {
    if (ee & 1n) result = (result * bb) % m;
    bb = (bb * bb) % m;
    ee >>= 1n;
  }
  return result;
});
bi('hash', (args) => { checkArgs('hash', args, 1, 1); hashKey(args[0]); return hashValue(args[0]); });
bi('id', (args) => { checkArgs('id', args, 1, 1); return BigInt(objId(args[0]) * 48 + 0x7f2c00000000); });
bi('hex', (args) => {
  const v = numToBigInt(args[0]);
  return v < 0n ? '-0x' + (-v).toString(16) : '0x' + v.toString(16);
});
bi('oct', (args) => {
  const v = numToBigInt(args[0]);
  return v < 0n ? '-0o' + (-v).toString(8) : '0o' + v.toString(8);
});
bi('bin', (args) => {
  const v = numToBigInt(args[0]);
  return v < 0n ? '-0b' + (-v).toString(2) : '0b' + v.toString(2);
});
bi('chr', (args) => {
  const code = Number(numToBigInt(args[0]));
  if (code < 0 || code > 0x10ffff) raiseError('ValueError', 'chr() arg not in range(0x110000)');
  return String.fromCodePoint(code);
});
bi('ord', (args) => {
  checkArgs('ord', args, 1, 1);
  const s = unwrap(args[0]);
  if (typeof s !== 'string') {
    raiseError('TypeError', `ord() expected string of length 1, but ${typeOf(args[0]).name} found`);
  }
  const chars = cp(s);
  if (chars.length !== 1) {
    raiseError('TypeError', `ord() expected a character, but string of length ${chars.length} found`);
  }
  return BigInt(chars[0].codePointAt(0));
});
bi('format', (args) => {
  checkArgs('format', args, 1, 2);
  return pyFormat(args[0], args.length === 2 ? unwrap(args[1]) : '');
});
bi('isinstance', (args) => {
  checkArgs('isinstance', args, 2, 2);
  return isInstanceOf(args[0], args[1]);
});
bi('issubclass', (args) => {
  checkArgs('issubclass', args, 2, 2);
  if (!(args[0] instanceof PyType)) raiseError('TypeError', 'issubclass() arg 1 must be a class');
  return isSubclassOf(args[0], args[1]);
});
bi('getattr', (args) => {
  checkArgs('getattr', args, 2, 3);
  const name = unwrap(args[1]);
  if (typeof name !== 'string') raiseError('TypeError', 'attribute name must be string');
  if (args.length === 3) {
    try {
      return getAttr(args[0], name);
    } catch (e) {
      if (e instanceof PyError && isInstanceOf(e.pyExc, EXC.AttributeError)) return args[2];
      throw e;
    }
  }
  return getAttr(args[0], name);
});
bi('setattr', (args) => {
  checkArgs('setattr', args, 3, 3);
  setAttr(args[0], unwrap(args[1]), args[2]);
  return NONE;
});
bi('delattr', (args) => {
  checkArgs('delattr', args, 2, 2);
  delAttr(args[0], unwrap(args[1]));
  return NONE;
});
bi('hasattr', (args) => {
  checkArgs('hasattr', args, 2, 2);
  return hasAttr(args[0], unwrap(args[1]));
});
bi('callable', (args) => {
  checkArgs('callable', args, 1, 1);
  const v = args[0];
  if (v instanceof PyFunction || v instanceof PyBuiltin || v instanceof PyBoundMethod ||
      v instanceof PyType) return true;
  if (v instanceof PyInstance) return !!mroLookup(v.cls, '__call__');
  return false;
});
bi('iter', (args) => {
  checkArgs('iter', args, 1, 2);
  if (args.length === 2) {
    const [callable, sentinel] = args;
    return new PyIterator(() => {
      const v = pyCall(callable, []);
      return pyEq(v, sentinel) ? DONE : v;
    }, 'callable_iterator');
  }
  const v = args[0];
  if (v instanceof PyGenerator || v instanceof PyIterator) return v;
  const it = pyIter(v);
  return new PyIterator(it.next, 'iterator');
});
bi('next', (args) => {
  checkArgs('next', args, 1, 2);
  const it = args[0];
  let r;
  if (it instanceof PyGenerator) {
    r = it.nextValue(NONE);
    if (r === DONE) {
      if (args.length === 2) return args[1];
      throw new PyError(stopIterationExc(it.returnValue));
    }
    return r;
  }
  if (it instanceof PyIterator) {
    r = it.nextFn();
    if (r === DONE) {
      if (args.length === 2) return args[1];
      throw new PyError(stopIterationExc(NONE));
    }
    return r;
  }
  if (it instanceof PyInstance && mroLookup(it.cls, '__next__')) {
    try {
      return pyCallMethod(it, '__next__', []);
    } catch (e) {
      if (e instanceof PyError && isInstanceOf(e.pyExc, EXC.StopIteration) && args.length === 2) {
        return args[1];
      }
      throw e;
    }
  }
  raiseError('TypeError', `'${typeOf(it).name}' object is not an iterator`);
});
bi('enumerate', (args, kwargs) => {
  const kw = kwOnly(kwargs, ['start'], 'enumerate');
  checkArgs('enumerate', args, 1, 2);
  const it = pyIter(args[0]);
  let i = args.length === 2 ? numToBigInt(args[1]) : (kw.start !== undefined ? numToBigInt(kw.start) : 0n);
  return new PyIterator(() => {
    const v = it.next();
    if (v === DONE) return DONE;
    return new PyTuple([i++, v]);
  }, 'enumerate');
});
bi('zip', (args, kwargs) => {
  const kw = kwOnly(kwargs, ['strict'], 'zip');
  const strict = kw.strict !== undefined && pyTruthy(kw.strict);
  const iters = args.map(pyIter);
  return new PyIterator(() => {
    if (!iters.length) return DONE;
    const row = [];
    for (let i = 0; i < iters.length; i++) {
      const v = iters[i].next();
      if (v === DONE) {
        if (strict && i > 0) {
          raiseError('ValueError', `zip() argument ${i + 1} is shorter than argument${i > 1 ? 's 1-' + i : ' 1'}`);
        }
        if (strict && i === 0) {
          // check the others are also exhausted
          for (let j = 1; j < iters.length; j++) {
            if (iters[j].next() !== DONE) {
              raiseError('ValueError', `zip() argument ${j + 1} is longer than argument${j > 1 ? 's 1-' + j : ' 1'}`);
            }
          }
        }
        return DONE;
      }
      row.push(v);
    }
    return new PyTuple(row);
  }, 'zip');
});
bi('map', (args) => {
  if (args.length < 2) raiseError('TypeError', 'map() must have at least two arguments.');
  const f = args[0];
  const iters = args.slice(1).map(pyIter);
  return new PyIterator(() => {
    const row = [];
    for (const it of iters) {
      const v = it.next();
      if (v === DONE) return DONE;
      row.push(v);
    }
    return pyCall(f, row);
  }, 'map');
});
bi('filter', (args) => {
  checkArgs('filter', args, 2, 2);
  const [f, src] = args;
  const it = pyIter(src);
  return new PyIterator(() => {
    for (;;) {
      const v = it.next();
      if (v === DONE) return DONE;
      const keep = f === NONE ? pyTruthy(v) : pyTruthy(pyCall(f, [v]));
      if (keep) return v;
    }
  }, 'filter');
});
bi('all', (args) => {
  checkArgs('all', args, 1, 1);
  const it = pyIter(args[0]);
  for (;;) {
    const v = it.next();
    if (v === DONE) return true;
    if (!pyTruthy(v)) return false;
  }
});
bi('any', (args) => {
  checkArgs('any', args, 1, 1);
  const it = pyIter(args[0]);
  for (;;) {
    const v = it.next();
    if (v === DONE) return false;
    if (pyTruthy(v)) return true;
  }
});
bi('input', (args) => {
  checkArgs('input', args, 0, 1);
  if (args.length) IO.write(pyStr(args[0]));
  if (!IO.readLine) raiseError('RuntimeError', 'input() is not available');
  const line = IO.readLine();
  if (line === null) raiseError('EOFError', 'EOF when reading a line');
  return line;
});
bi('open', (args, kwargs) => {
  const kw = kwOnly(kwargs, ['mode', 'encoding', 'newline', 'errors', 'buffering'], 'open');
  checkArgs('open', args, 1, 3);
  if (!FileOps.open) raiseError('RuntimeError', 'open() is not available in this environment');
  const path = unwrap(args[0]);
  const mode = args.length >= 2 ? unwrap(args[1]) : (kw.mode !== undefined ? unwrap(kw.mode) : 'r');
  if (/[b]/.test(mode)) raiseError('ValueError', 'binary mode is not supported');
  return FileOps.open(path, mode);
});
bi('dir', (args) => {
  checkArgs('dir', args, 0, 1);
  if (!args.length) raiseError('NotImplementedError', 'dir() without arguments is not supported');
  const v = args[0];
  const names = new Set();
  let t = v instanceof PyType ? v : typeOf(v);
  for (const c of t.mro) for (const k of c.attrs.keys()) names.add(k);
  if (v instanceof PyInstance) for (const k of v.attrs.keys()) names.add(k);
  if (v instanceof PyModule) for (const k of v.attrs.keys()) names.add(k);
  const arr = [...names].sort();
  return new PyList(arr);
});
bi('vars', (args) => {
  checkArgs('vars', args, 1, 1);
  return getAttr(args[0], '__dict__');
});
bi('exec', () => raiseError('NotImplementedError', 'exec() is not supported in this implementation'));
bi('eval', () => raiseError('NotImplementedError', 'eval() is not supported in this implementation'));
bi('compile', () => raiseError('NotImplementedError', 'compile() is not supported in this implementation'));
bi('exit', (args) => { throw new PyError(makeSystemExit(args)); });
bi('quit', (args) => { throw new PyError(makeSystemExit(args)); });

function makeSystemExit(args) {
  const inst = new PyInstance(EXC.SystemExit);
  inst.attrs.set('args', new PyTuple([...args]));
  inst.attrs.set('code', args.length ? args[0] : NONE);
  return inst;
}

// Types & constants in the builtins namespace.
for (const t of [
  TYPE_OBJECT, TYPE_TYPE, TYPE_INT, TYPE_BOOL, TYPE_FLOAT, TYPE_STR, TYPE_LIST,
  TYPE_TUPLE, TYPE_DICT, TYPE_SET, TYPE_FROZENSET, TYPE_RANGE, TYPE_SLICE,
  TYPE_PROPERTY, TYPE_CLASSMETHOD, TYPE_STATICMETHOD,
]) {
  BUILTINS.set(t.name, t);
}
for (const [name, t] of Object.entries(EXC)) BUILTINS.set(name, t);
BUILTINS.set('IOError', EXC.OSError);
BUILTINS.set('EnvironmentError', EXC.OSError);
BUILTINS.set('NotImplemented', NOT_IMPLEMENTED);
BUILTINS.set('Ellipsis', PY_ELLIPSIS);
BUILTINS.set('__name__', '__main__');
BUILTINS.set('__debug__', true);
