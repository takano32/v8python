// Tree-walking evaluator. Every exec/eval function is a JS generator function
// so that Python `yield` expressions can suspend execution: yielded values
// propagate up the yield* chain to the PyGenerator that drives the body.
// Calls from JS code into Python (dunders, sorted key=...) use runGen, which
// drives a call to completion synchronously (no yields can escape a call
// boundary: a generator function's body only runs inside a PyGenerator).

import { parse, parseExpression, PySyntaxError } from './parser.js';
import {
  NONE, NOT_IMPLEMENTED, PY_ELLIPSIS, DONE,
  PyList, PyTuple, PyDict, PySet, PyRange, PySlice, PyFunction, PyBuiltin,
  PyBoundMethod, PyType, PyInstance, PyModule, PyProperty, PyClassMethod,
  PyStaticMethod, PySuper, PyIterator, PyGenerator, PyError,
  TYPE_OBJECT, TYPE_TYPE, EXC, makeExc, raiseError, isExceptionType,
  typeOf, isInstanceOf, isSubclassOf, unwrap, setCallHook,
  pyEq, richCompare, pyTruthy, getAttr, setAttr, delAttr,
  pyIter, iterToArray, pyRepr, pyStr, pyFormat, pyContains,
  binOp, unaryOp, getItem, setItem, delItem, mroLookup, bindClassAttr,
  numToBigInt,
} from './objects.js';
import { BUILTINS, IO } from './builtins.js';
import { STDLIB } from './stdlib.js';

// ---------- scopes ----------

const MODULE_INFO = { locals: null, globals: new Set(), nonlocals: new Set(), isClass: false, isComprehension: false };

export class Scope {
  constructor(parent, info, moduleScope) {
    this.vars = new Map();
    this.parent = parent;
    this.info = info || MODULE_INFO;
    this.moduleScope = moduleScope || this;
  }
}

function loadName(scope, name) {
  const info = scope.info;
  if (info.locals !== null) {
    if (info.globals.has(name)) {
      const g = scope.moduleScope.vars;
      if (g.has(name)) return g.get(name);
      if (BUILTINS.has(name)) return BUILTINS.get(name);
      raiseError('NameError', `name '${name}' is not defined`);
    }
    if (info.nonlocals.has(name)) {
      const owner = findNonlocalOwner(scope, name);
      if (owner && owner.vars.has(name)) return owner.vars.get(name);
      raiseError('NameError', `cannot access free variable '${name}' where it is not associated with a value in enclosing scope`);
    }
    if (info.locals.has(name)) {
      if (scope.vars.has(name)) return scope.vars.get(name);
      throw new PyError(makeUnboundLocal(name));
    }
  }
  for (let s = scope; s; s = s.parent) {
    if (s !== scope && s.info.isClass) continue;
    if (s.vars.has(name)) return s.vars.get(name);
  }
  if (BUILTINS.has(name)) return BUILTINS.get(name);
  raiseError('NameError', `name '${name}' is not defined`);
}

function makeUnboundLocal(name) {
  const inst = new PyInstance(EXC.UnboundLocalError);
  inst.attrs.set('args', new PyTuple([
    `cannot access local variable '${name}' where it is not associated with a value`,
  ]));
  return inst;
}

function findNonlocalOwner(scope, name) {
  for (let s = scope.parent; s; s = s.parent) {
    if (s.info.isClass) continue;
    if (s.info.locals === null) return null; // reached module scope
    if (s.info.locals.has(name)) return s;
  }
  return null;
}

function storeName(scope, name, value) {
  const info = scope.info;
  if (info.globals.has(name)) {
    scope.moduleScope.vars.set(name, value);
    return;
  }
  if (info.nonlocals.has(name)) {
    const owner = findNonlocalOwner(scope, name);
    if (!owner) raiseError('SyntaxError', `no binding for nonlocal '${name}' found`);
    owner.vars.set(name, value);
    return;
  }
  if (info.isComprehension && info.locals !== null && !info.locals.has(name)) {
    // Walrus inside a comprehension binds in the enclosing scope.
    storeName(scope.parent, name, value);
    return;
  }
  scope.vars.set(name, value);
}

function deleteName(scope, name) {
  const info = scope.info;
  if (info.globals.has(name)) {
    if (!scope.moduleScope.vars.delete(name)) {
      raiseError('NameError', `name '${name}' is not defined`);
    }
    return;
  }
  if (info.nonlocals.has(name)) {
    const owner = findNonlocalOwner(scope, name);
    if (!owner || !owner.vars.delete(name)) {
      raiseError('NameError', `name '${name}' is not defined`);
    }
    return;
  }
  if (!scope.vars.delete(name)) {
    if (info.locals !== null && info.locals.has(name)) {
      throw new PyError(makeUnboundLocal(name));
    }
    raiseError('NameError', `name '${name}' is not defined`);
  }
}

// ---------- frames ----------

const FRAMES = [];
const RECURSION_LIMIT = 1000;

function topFrame() { return FRAMES[FRAMES.length - 1]; }

// ---------- driving generators from JS ----------

export function runGen(gen) {
  const r = gen.next();
  if (!r.done) {
    throw new Error('internal error: yield escaped a call boundary');
  }
  return r.value;
}

export function pyCallSync(callable, args = [], kwargs = null) {
  return runGen(callValue(callable, args, kwargs));
}

// ---------- calling ----------

export function* callValue(callable, args, kwargs) {
  if (callable instanceof PyBuiltin) {
    if (callable.isMethod) {
      if (!args.length) {
        raiseError('TypeError', `descriptor '${callable.name}' of object needs an argument`);
      }
      const r = callable.fn(args[0], args.slice(1), kwargs);
      return r === undefined ? NONE : r;
    }
    const r = callable.fn(args, kwargs);
    return r === undefined ? NONE : r;
  }
  if (callable instanceof PyBoundMethod) {
    const f = callable.func;
    if (f instanceof PyBuiltin) {
      const r = f.fn(callable.self, args, kwargs);
      return r === undefined ? NONE : r;
    }
    if (f instanceof PyFunction) {
      return yield* callFunction(f, [callable.self, ...args], kwargs);
    }
    return yield* callValue(f, [callable.self, ...args], kwargs);
  }
  if (callable instanceof PyFunction) {
    return yield* callFunction(callable, args, kwargs);
  }
  if (callable instanceof PyType) {
    return yield* instantiate(callable, args, kwargs);
  }
  if (callable instanceof PyInstance) {
    const hit = mroLookup(callable.cls, '__call__');
    if (hit) {
      return yield* callValue(bindClassAttr(hit.value, callable), args, kwargs);
    }
    raiseError('TypeError', `'${callable.cls.name}' object is not callable`);
  }
  if (callable instanceof PyClassMethod || callable instanceof PyStaticMethod) {
    return yield* callValue(callable.func, args, kwargs);
  }
  raiseError('TypeError', `'${typeOf(callable).name}' object is not callable`);
}

function* instantiate(cls, args, kwargs) {
  if (cls.construct) {
    return cls.construct(args, kwargs);
  }
  const inst = new PyInstance(cls);
  for (const t of cls.mro) {
    if (t.payloadFactory) {
      inst.payload = t.payloadFactory();
      break;
    }
  }
  const init = mroLookup(cls, '__init__');
  if (init && init.owner !== TYPE_OBJECT) {
    const r = yield* callValue(bindClassAttr(init.value, inst), args, kwargs);
    if (r !== NONE && init.value instanceof PyFunction) {
      raiseError('TypeError', `__init__() should return None, not '${typeOf(r).name}'`);
    }
  } else if (args.length || (kwargs && kwargs.size)) {
    raiseError('TypeError', `${cls.name}() takes no arguments`);
  }
  return inst;
}

function bindParams(fnObj, args, kwargs) {
  const scope = new Scope(fnObj.closure, fnObj.scopeInfo, fnObj.closure.moduleScope);
  const p = fnObj.params;
  const posOnly = p.posOnly || [];
  const allPos = [...posOnly, ...p.pos];
  const fname = fnObj.name;

  let i = 0;
  for (; i < allPos.length && i < args.length; i++) {
    scope.vars.set(allPos[i].name, args[i]);
  }
  if (i < args.length) {
    if (p.varArg) {
      scope.vars.set(p.varArg, new PyTuple(args.slice(i)));
    } else {
      const expected = allPos.length;
      raiseError('TypeError',
        `${fname}() takes ${expected === 0 ? '0 positional arguments' : `${expected} positional argument${expected === 1 ? '' : 's'}`} but ${args.length} ${args.length === 1 ? 'was' : 'were'} given`);
    }
  } else if (p.varArg) {
    scope.vars.set(p.varArg, new PyTuple([]));
  }

  let kwArgDict = null;
  if (p.kwArg) {
    kwArgDict = new PyDict();
    scope.vars.set(p.kwArg, kwArgDict);
  }
  if (kwargs) {
    const posOnlyNames = new Set(posOnly.map((x) => x.name));
    for (const [k, v] of kwargs) {
      if (posOnlyNames.has(k)) {
        if (kwArgDict) { kwArgDict.set(k, v); continue; }
        raiseError('TypeError', `${fname}() got some positional-only arguments passed as keyword arguments: '${k}'`);
      }
      const inPos = p.pos.some((x) => x.name === k);
      const inKwOnly = p.kwOnly.some((x) => x.name === k);
      if (inPos || inKwOnly) {
        if (scope.vars.has(k)) {
          raiseError('TypeError', `${fname}() got multiple values for argument '${k}'`);
        }
        scope.vars.set(k, v);
      } else if (kwArgDict) {
        kwArgDict.set(k, v);
      } else {
        raiseError('TypeError', `${fname}() got an unexpected keyword argument '${k}'`);
      }
    }
  }

  // Defaults & missing checks.
  const missing = [];
  for (const param of allPos) {
    if (!scope.vars.has(param.name)) {
      if (fnObj.defaults.has(param.name)) {
        scope.vars.set(param.name, fnObj.defaults.get(param.name));
      } else {
        missing.push(param.name);
      }
    }
  }
  if (missing.length) {
    raiseError('TypeError',
      `${fname}() missing ${missing.length} required positional argument${missing.length === 1 ? '' : 's'}: ${missing.map((m) => `'${m}'`).join(' and ')}`);
  }
  const missingKw = [];
  for (const param of p.kwOnly) {
    if (!scope.vars.has(param.name)) {
      if (fnObj.defaults.has(param.name)) {
        scope.vars.set(param.name, fnObj.defaults.get(param.name));
      } else {
        missingKw.push(param.name);
      }
    }
  }
  if (missingKw.length) {
    raiseError('TypeError',
      `${fname}() missing ${missingKw.length} required keyword-only argument${missingKw.length === 1 ? '' : 's'}: ${missingKw.map((m) => `'${m}'`).join(' and ')}`);
  }
  return scope;
}

export function* callFunction(fnObj, args, kwargs) {
  if (FRAMES.length >= RECURSION_LIMIT) {
    raiseError('RecursionError', 'maximum recursion depth exceeded');
  }
  const scope = bindParams(fnObj, args, kwargs);
  const frame = {
    name: fnObj.name,
    file: fnObj.filename || '<unknown>',
    line: fnObj.line || 0,
    scope,
    fnObj,
    firstArg: args.length ? args[0] : undefined,
    excStack: [],
  };

  if (fnObj.isGenerator) {
    return new PyGenerator(genBodyRunner(fnObj, scope, frame), fnObj.name);
  }

  FRAMES.push(frame);
  try {
    if (fnObj.isExprBody) {
      return yield* evalExpr(fnObj.body, scope, frame);
    }
    const sig = yield* execBlock(fnObj.body, scope, frame);
    return sig && sig.type === 'return' ? sig.value : NONE;
  } catch (e) {
    if (e instanceof PyError) {
      e.tb.push({ file: frame.file, line: frame.line, name: frame.name });
    }
    if (e instanceof RangeError && String(e.message).includes('call stack')) {
      throw new PyError(makeExc('RecursionError', 'maximum recursion depth exceeded'));
    }
    throw e;
  } finally {
    FRAMES.pop();
  }
}

function* genBodyRunner(fnObj, scope, frame) {
  const inner = fnObj.isExprBody
    ? exprAsBlock(fnObj, scope, frame)
    : execBlock(fnObj.body, scope, frame);
  let sendVal;
  let mode = 'next';
  let err;
  for (;;) {
    FRAMES.push(frame);
    let r;
    try {
      r = mode === 'throw' ? inner.throw(err) : inner.next(sendVal);
    } catch (e) {
      if (e instanceof PyError) {
        e.tb.push({ file: frame.file, line: frame.line, name: frame.name });
      }
      throw e;
    } finally {
      FRAMES.pop();
    }
    if (r.done) {
      const sig = r.value;
      return sig && sig.type === 'return' ? sig.value : NONE;
    }
    try {
      sendVal = yield r.value;
      mode = 'next';
    } catch (e) {
      mode = 'throw';
      err = e;
    }
  }
}

function* exprAsBlock(fnObj, scope, frame) {
  const v = yield* evalExpr(fnObj.body, scope, frame);
  return { type: 'return', value: v };
}

// ---------- statements ----------

function* execBlock(stmts, scope, frame) {
  for (const stmt of stmts) {
    const sig = yield* execStmt(stmt, scope, frame);
    if (sig) return sig;
  }
  return undefined;
}

function* execStmt(node, scope, frame) {
  frame.line = node.line;
  switch (node.type) {
    case 'ExprStmt':
      yield* evalExpr(node.value, scope, frame);
      return;

    case 'Assign': {
      const value = yield* evalExpr(node.value, scope, frame);
      for (const target of node.targets) {
        yield* assignTarget(target, value, scope, frame);
      }
      return;
    }

    case 'AnnDecl':
      return;

    case 'AugAssign': {
      yield* execAugAssign(node, scope, frame);
      return;
    }

    case 'If': {
      const test = yield* evalExpr(node.test, scope, frame);
      if (pyTruthy(test)) return yield* execBlock(node.body, scope, frame);
      return yield* execBlock(node.orelse, scope, frame);
    }

    case 'While': {
      for (;;) {
        frame.line = node.line;
        const test = yield* evalExpr(node.test, scope, frame);
        if (!pyTruthy(test)) break;
        const sig = yield* execBlock(node.body, scope, frame);
        if (sig) {
          if (sig.type === 'break') return undefined;
          if (sig.type === 'continue') continue;
          return sig;
        }
      }
      return yield* execBlock(node.orelse, scope, frame);
    }

    case 'For': {
      const iterable = yield* evalExpr(node.iter, scope, frame);
      const it = pyIter(iterable);
      for (;;) {
        const v = it.next();
        if (v === DONE) break;
        yield* assignTarget(node.target, v, scope, frame);
        const sig = yield* execBlock(node.body, scope, frame);
        if (sig) {
          if (sig.type === 'break') return undefined;
          if (sig.type === 'continue') continue;
          return sig;
        }
      }
      return yield* execBlock(node.orelse, scope, frame);
    }

    case 'FunctionDef': {
      const fnObj = yield* makeFunction(node, scope, frame, false);
      let value = fnObj;
      for (let i = node.decorators.length - 1; i >= 0; i--) {
        const dec = yield* evalExpr(node.decorators[i], scope, frame);
        value = yield* callValue(dec, [value], null);
      }
      storeName(scope, node.name, value);
      return;
    }

    case 'ClassDef': {
      yield* execClassDef(node, scope, frame);
      return;
    }

    case 'Return': {
      const value = node.value ? yield* evalExpr(node.value, scope, frame) : NONE;
      return { type: 'return', value };
    }

    case 'Pass': return;
    case 'Break': return { type: 'break' };
    case 'Continue': return { type: 'continue' };
    case 'Global': case 'Nonlocal': return;

    case 'Delete': {
      for (const t of node.targets) {
        if (t.type === 'Name') deleteName(scope, t.id);
        else if (t.type === 'Subscript') {
          const obj = yield* evalExpr(t.obj, scope, frame);
          const idx = yield* evalSubscriptIndex(t.index, scope, frame);
          delItem(obj, idx);
        } else if (t.type === 'Attribute') {
          const obj = yield* evalExpr(t.obj, scope, frame);
          delAttr(obj, t.attr);
        } else if (t.type === 'Tuple' || t.type === 'List') {
          for (const e of t.elts) {
            yield* execStmt({ type: 'Delete', targets: [e], line: node.line }, scope, frame);
          }
        }
      }
      return;
    }

    case 'Assert': {
      const v = yield* evalExpr(node.test, scope, frame);
      if (!pyTruthy(v)) {
        const inst = new PyInstance(EXC.AssertionError);
        const msg = node.msg ? yield* evalExpr(node.msg, scope, frame) : undefined;
        inst.attrs.set('args', new PyTuple(msg === undefined ? [] : [msg]));
        throw new PyError(inst);
      }
      return;
    }

    case 'Raise': {
      yield* execRaise(node, scope, frame);
      return;
    }

    case 'Try': {
      return yield* execTry(node, scope, frame);
    }

    case 'With': {
      return yield* execWith(node, 0, scope, frame);
    }

    case 'Import': {
      for (const { name, asname } of node.names) {
        const mod = importModule(name, frame);
        storeName(scope, asname || name.split('.')[0], mod);
      }
      return;
    }

    case 'ImportFrom': {
      if (node.level > 0) {
        raiseError('ImportError', 'relative imports are not supported');
      }
      const mod = importModule(node.module, frame);
      if (node.names === '*') {
        for (const [k, v] of mod.attrs) {
          if (!k.startsWith('_')) storeName(scope, k, v);
        }
        return;
      }
      for (const { name, asname } of node.names) {
        if (!mod.attrs.has(name)) {
          raiseError('ImportError', `cannot import name '${name}' from '${node.module}'`);
        }
        storeName(scope, asname || name, mod.attrs.get(name));
      }
      return;
    }

    default:
      throw new Error(`internal: unknown statement type ${node.type}`);
  }
}

const INPLACE_DUNDER = {
  '+': '__iadd__', '-': '__isub__', '*': '__imul__', '/': '__itruediv__',
  '//': '__ifloordiv__', '%': '__imod__', '**': '__ipow__',
  '<<': '__ilshift__', '>>': '__irshift__', '&': '__iand__', '|': '__ior__', '^': '__ixor__',
  '@': '__imatmul__',
};

function inplaceBinOp(op, target, value) {
  if (target instanceof PyInstance) {
    const hit = mroLookup(target.cls, INPLACE_DUNDER[op]);
    if (hit && !hit.owner.builtin) {
      const r = pyCallSync(bindClassAttr(hit.value, target), [value]);
      if (r !== NOT_IMPLEMENTED) return r;
    }
  }
  const t = unwrap(target);
  if (t instanceof PyList) {
    if (op === '+') {
      t.items.push(...iterToArray(value));
      return target;
    }
    if (op === '*') {
      const count = Number(numToBigInt(value));
      const orig = [...t.items];
      t.items.length = 0;
      for (let i = 0; i < count; i++) t.items.push(...orig);
      return target;
    }
  }
  if (t instanceof PySet && !t.frozen && unwrap(value) instanceof PySet) {
    const other = unwrap(value);
    if (op === '|') { for (const k of other.keys()) t.add(k); return target; }
    if (op === '&') {
      for (const k of t.keysArray()) if (!other.has(k)) t.delete(k);
      return target;
    }
    if (op === '-') { for (const k of other.keys()) t.delete(k); return target; }
    if (op === '^') {
      for (const k of other.keysArray()) {
        if (t.has(k)) t.delete(k);
        else t.add(k);
      }
      return target;
    }
  }
  if (t instanceof PyDict && op === '|') {
    const other = unwrap(value);
    if (other instanceof PyDict) {
      for (const [k, v] of other.entries()) t.set(k, v);
      return target;
    }
  }
  return binOp(op, target, value);
}

function* execAugAssign(node, scope, frame) {
  const target = node.target;
  if (target.type === 'Name') {
    const cur = loadName(scope, target.id);
    const value = yield* evalExpr(node.value, scope, frame);
    storeName(scope, target.id, inplaceBinOp(node.op, cur, value));
    return;
  }
  if (target.type === 'Attribute') {
    const obj = yield* evalExpr(target.obj, scope, frame);
    const cur = getAttr(obj, target.attr);
    const value = yield* evalExpr(node.value, scope, frame);
    setAttr(obj, target.attr, inplaceBinOp(node.op, cur, value));
    return;
  }
  if (target.type === 'Subscript') {
    const obj = yield* evalExpr(target.obj, scope, frame);
    const idx = yield* evalSubscriptIndex(target.index, scope, frame);
    const cur = getItem(obj, idx);
    const value = yield* evalExpr(node.value, scope, frame);
    setItem(obj, idx, inplaceBinOp(node.op, cur, value));
    return;
  }
  raiseError('SyntaxError', 'illegal expression for augmented assignment');
}

function* execRaise(node, scope, frame) {
  if (!node.exc) {
    for (let i = FRAMES.length - 1; i >= 0; i--) {
      const st = FRAMES[i].excStack;
      if (st && st.length) {
        throw new PyError(st[st.length - 1]);
      }
    }
    raiseError('RuntimeError', 'No active exception to re-raise');
  }
  const excVal = yield* evalExpr(node.exc, scope, frame);
  let inst;
  if (excVal instanceof PyType) {
    if (!isExceptionType(excVal)) {
      raiseError('TypeError', 'exceptions must derive from BaseException');
    }
    inst = yield* callValue(excVal, [], null);
  } else if (excVal instanceof PyInstance && isExceptionType(excVal.cls)) {
    inst = excVal;
  } else {
    raiseError('TypeError', 'exceptions must derive from BaseException');
  }
  if (node.cause) {
    const cause = yield* evalExpr(node.cause, scope, frame);
    inst.attrs.set('__cause__', cause);
  }
  throw new PyError(inst);
}

function excMatches(excInst, typeVal) {
  if (typeVal instanceof PyTuple) {
    return typeVal.items.some((t) => excMatches(excInst, t));
  }
  if (!(typeVal instanceof PyType) || !isExceptionType(typeVal)) {
    raiseError('TypeError', 'catching classes that do not inherit from BaseException is not allowed');
  }
  return isInstanceOf(excInst, typeVal);
}

function* execTry(node, scope, frame) {
  let sig;
  let pending = null; // PyError or JS error to re-raise after finally

  try {
    sig = yield* execBlock(node.body, scope, frame);
    if (!sig && node.orelse.length) {
      sig = yield* execBlock(node.orelse, scope, frame);
    }
  } catch (e) {
    if (!(e instanceof PyError)) {
      if (e instanceof RangeError && String(e.message).includes('call stack')) {
        pending = new PyError(makeExc('RecursionError', 'maximum recursion depth exceeded'));
      } else {
        throw e;
      }
    } else {
      pending = e;
    }
    if (pending) {
      let matched = false;
      for (const handler of node.handlers) {
        let match;
        if (handler.excType) {
          const t = yield* evalExpr(handler.excType, scope, frame);
          match = excMatches(pending.pyExc, t);
        } else {
          match = true;
        }
        if (!match) continue;
        matched = true;
        const exc = pending;
        pending = null;
        frame.excStack.push(exc.pyExc);
        if (handler.name) storeName(scope, handler.name, exc.pyExc);
        try {
          sig = yield* execBlock(handler.body, scope, frame);
        } catch (e2) {
          if (e2 instanceof PyError && !e2.pyExc.attrs.has('__context__')) {
            e2.pyExc.attrs.set('__context__', exc.pyExc);
          }
          pending = e2;
        } finally {
          frame.excStack.pop();
          if (handler.name) {
            scope.vars.delete(handler.name);
          }
        }
        break;
      }
      void matched;
    }
  }

  if (node.finalbody.length) {
    const fsig = yield* execBlock(node.finalbody, scope, frame);
    if (fsig) return fsig; // finally's control flow wins
  }
  if (pending) throw pending;
  return sig;
}

function* execWith(node, itemIdx, scope, frame) {
  if (itemIdx >= node.items.length) {
    return yield* execBlock(node.body, scope, frame);
  }
  const item = node.items[itemIdx];
  const mgr = yield* evalExpr(item.ctx, scope, frame);
  let enter, exit;
  try {
    enter = getAttr(mgr, '__enter__');
    exit = getAttr(mgr, '__exit__');
  } catch (e) {
    if (e instanceof PyError && isInstanceOf(e.pyExc, EXC.AttributeError)) {
      raiseError('TypeError',
        `'${typeOf(mgr).name}' object does not support the context manager protocol`);
    }
    throw e;
  }
  const entered = yield* callValue(enter, [], null);
  if (item.optionalVars) {
    yield* assignTarget(item.optionalVars, entered, scope, frame);
  }
  let sig;
  try {
    sig = yield* execWith(node, itemIdx + 1, scope, frame);
  } catch (e) {
    if (e instanceof PyError) {
      const suppress = yield* callValue(exit, [typeOf(e.pyExc), e.pyExc, NONE], null);
      if (pyTruthy(suppress)) return undefined;
    } else {
      yield* callValue(exit, [NONE, NONE, NONE], null);
    }
    throw e;
  }
  yield* callValue(exit, [NONE, NONE, NONE], null);
  return sig;
}

function* makeFunction(node, scope, frame, isLambda) {
  const fnObj = new PyFunction(
    isLambda ? '<lambda>' : node.name,
    node.params,
    isLambda ? node.body : node.body,
    scope,
    {
      locals: node.scopeInfo.locals,
      globals: node.scopeInfo.globals,
      nonlocals: node.scopeInfo.nonlocals,
      isClass: false,
      isComprehension: false,
    },
    node.scopeInfo.isGenerator,
  );
  fnObj.isExprBody = isLambda;
  fnObj.filename = frame.file;
  fnObj.line = node.line;
  fnObj.defaults = new Map();
  const allParams = [...(node.params.posOnly || []), ...node.params.pos, ...node.params.kwOnly];
  for (const p of allParams) {
    if (p.default) {
      fnObj.defaults.set(p.name, yield* evalExpr(p.default, scope, frame));
    }
  }
  // Docstring
  if (!isLambda && node.body.length && node.body[0].type === 'ExprStmt' && node.body[0].value.type === 'Str') {
    fnObj.doc = node.body[0].value.value;
  }
  return fnObj;
}

function* execClassDef(node, scope, frame) {
  const bases = [];
  for (const b of node.bases) {
    const bv = yield* evalExpr(b, scope, frame);
    if (!(bv instanceof PyType)) {
      raiseError('TypeError', `${typeOf(bv).name}() argument 'bases' element is not a class`);
    }
    bases.push(bv);
  }
  // class keywords (e.g. metaclass=...) are accepted and ignored
  for (const k of node.keywords || []) {
    yield* evalExpr(k.value, scope, frame);
  }
  const effectiveBases = bases.length ? bases : [TYPE_OBJECT];

  const classScope = new Scope(scope, {
    locals: node.scopeInfo.locals,
    globals: node.scopeInfo.globals,
    nonlocals: node.scopeInfo.nonlocals,
    isClass: true,
    isComprehension: false,
  }, scope.moduleScope);

  yield* execBlock(node.body, classScope, frame);

  const attrs = new Map(classScope.vars);
  let cls;
  try {
    cls = new PyType(node.name, effectiveBases, attrs, { module: frame.moduleName || '__main__' });
  } catch (e) {
    throw e;
  }
  for (const v of attrs.values()) {
    if (v instanceof PyFunction && !v.definingClass) v.definingClass = cls;
    if (v instanceof PyClassMethod && v.func instanceof PyFunction && !v.func.definingClass) {
      v.func.definingClass = cls;
    }
    if (v instanceof PyStaticMethod && v.func instanceof PyFunction && !v.func.definingClass) {
      v.func.definingClass = cls;
    }
    if (v instanceof PyProperty) {
      for (const f of [v.fget, v.fset, v.fdel]) {
        if (f instanceof PyFunction && !f.definingClass) f.definingClass = cls;
      }
    }
  }
  // Docstring
  if (node.body.length && node.body[0].type === 'ExprStmt' && node.body[0].value.type === 'Str') {
    attrs.set('__doc__', node.body[0].value.value);
  }

  let value = cls;
  for (let i = node.decorators.length - 1; i >= 0; i--) {
    const dec = yield* evalExpr(node.decorators[i], scope, frame);
    value = yield* callValue(dec, [value], null);
  }
  storeName(scope, node.name, value);
}

// ---------- assignment targets ----------

function* assignTarget(target, value, scope, frame) {
  switch (target.type) {
    case 'Name':
      storeName(scope, target.id, value);
      return;
    case 'Tuple':
    case 'List': {
      let items;
      try {
        items = iterToArray(value);
      } catch (e) {
        if (e instanceof PyError && isInstanceOf(e.pyExc, EXC.TypeError)) {
          raiseError('TypeError', `cannot unpack non-iterable ${typeOf(value).name} object`);
        }
        throw e;
      }
      const elts = target.elts;
      const starIdx = elts.findIndex((e) => e.type === 'Starred');
      if (starIdx === -1) {
        if (items.length < elts.length) {
          raiseError('ValueError', `not enough values to unpack (expected ${elts.length}, got ${items.length})`);
        }
        if (items.length > elts.length) {
          raiseError('ValueError', `too many values to unpack (expected ${elts.length})`);
        }
        for (let i = 0; i < elts.length; i++) {
          yield* assignTarget(elts[i], items[i], scope, frame);
        }
      } else {
        const before = elts.slice(0, starIdx);
        const after = elts.slice(starIdx + 1);
        if (items.length < before.length + after.length) {
          raiseError('ValueError',
            `not enough values to unpack (expected at least ${before.length + after.length}, got ${items.length})`);
        }
        for (let i = 0; i < before.length; i++) {
          yield* assignTarget(before[i], items[i], scope, frame);
        }
        const starItems = items.slice(before.length, items.length - after.length);
        yield* assignTarget(elts[starIdx].value, new PyList(starItems), scope, frame);
        for (let i = 0; i < after.length; i++) {
          yield* assignTarget(after[i], items[items.length - after.length + i], scope, frame);
        }
      }
      return;
    }
    case 'Attribute': {
      const obj = yield* evalExpr(target.obj, scope, frame);
      setAttr(obj, target.attr, value);
      return;
    }
    case 'Subscript': {
      const obj = yield* evalExpr(target.obj, scope, frame);
      const idx = yield* evalSubscriptIndex(target.index, scope, frame);
      setItem(obj, idx, value);
      return;
    }
    default:
      raiseError('SyntaxError', `cannot assign to ${target.type}`);
  }
}

function* evalSubscriptIndex(index, scope, frame) {
  if (index.type === 'Slice') {
    const lower = index.lower ? yield* evalExpr(index.lower, scope, frame) : NONE;
    const upper = index.upper ? yield* evalExpr(index.upper, scope, frame) : NONE;
    const step = index.step ? yield* evalExpr(index.step, scope, frame) : NONE;
    return new PySlice(lower, upper, step);
  }
  if (index.type === 'Tuple' && index.elts.some((e) => e.type === 'Slice')) {
    const items = [];
    for (const e of index.elts) {
      items.push(yield* evalSubscriptIndex(e, scope, frame));
    }
    return new PyTuple(items);
  }
  return yield* evalExpr(index, scope, frame);
}

// ---------- expressions ----------

function* evalExpr(node, scope, frame) {
  switch (node.type) {
    case 'Num': return node.value;
    case 'Str': return node.value;
    case 'Const': return node.value === null ? NONE : node.value;
    case 'Ellipsis': return PY_ELLIPSIS;
    case 'Bytes':
      raiseError('NotImplementedError', 'bytes literals are not supported in this implementation');
      return;

    case 'Name': return loadName(scope, node.id);

    case 'FString': {
      let out = '';
      for (const part of node.parts) {
        if (part.type === 'str') {
          out += part.value;
          continue;
        }
        const v = yield* evalExpr(part.expr, scope, frame);
        let spec = null;
        if (part.spec) {
          spec = '';
          for (const sp of part.spec) {
            if (sp.type === 'str') spec += sp.value;
            else {
              const sv = yield* evalExpr(sp.expr, scope, frame);
              spec += pyStr(sv);
            }
          }
        }
        if (part.selfDoc) {
          // selfDocText is the verbatim label including '=' and surrounding spaces.
          out += part.selfDocText != null ? part.selfDocText : part.code + '=';
          if (part.conv === null && spec === null) {
            out += pyRepr(v);
            continue;
          }
        }
        let formatted;
        if (part.conv === 'r') formatted = pyFormat(pyRepr(v), spec || '');
        else if (part.conv === 's') formatted = pyFormat(pyStr(v), spec || '');
        else if (part.conv === 'a') formatted = pyFormat(pyRepr(v), spec || '');
        else formatted = pyFormat(v, spec || '');
        out += formatted;
      }
      return out;
    }

    case 'Tuple': {
      const items = [];
      for (const e of node.elts) {
        if (e.type === 'Starred') {
          items.push(...iterToArray(yield* evalExpr(e.value, scope, frame)));
        } else {
          items.push(yield* evalExpr(e, scope, frame));
        }
      }
      return new PyTuple(items);
    }
    case 'List': {
      const items = [];
      for (const e of node.elts) {
        if (e.type === 'Starred') {
          items.push(...iterToArray(yield* evalExpr(e.value, scope, frame)));
        } else {
          items.push(yield* evalExpr(e, scope, frame));
        }
      }
      return new PyList(items);
    }
    case 'Set': {
      const s = new PySet();
      for (const e of node.elts) {
        if (e.type === 'Starred') {
          for (const x of iterToArray(yield* evalExpr(e.value, scope, frame))) s.add(x);
        } else {
          s.add(yield* evalExpr(e, scope, frame));
        }
      }
      return s;
    }
    case 'Dict': {
      const d = new PyDict();
      for (let i = 0; i < node.keys.length; i++) {
        if (node.keys[i] === null) {
          const other = yield* evalExpr(node.values[i], scope, frame);
          const uo = unwrap(other);
          if (uo instanceof PyDict) {
            for (const [k, v] of uo.entries()) d.set(k, v);
          } else {
            const keys = iterToArray(pyCallSync(getAttr(other, 'keys'), []));
            for (const k of keys) d.set(k, getItem(other, k));
          }
        } else {
          const k = yield* evalExpr(node.keys[i], scope, frame);
          const v = yield* evalExpr(node.values[i], scope, frame);
          d.set(k, v);
        }
      }
      return d;
    }

    case 'BinOp': {
      const left = yield* evalExpr(node.left, scope, frame);
      const right = yield* evalExpr(node.right, scope, frame);
      return binOp(node.op, left, right);
    }

    case 'UnaryOp': {
      const v = yield* evalExpr(node.operand, scope, frame);
      return unaryOp(node.op, v);
    }

    case 'BoolOp': {
      let v;
      for (let i = 0; i < node.values.length; i++) {
        v = yield* evalExpr(node.values[i], scope, frame);
        if (i === node.values.length - 1) return v;
        const t = pyTruthy(v);
        if (node.op === 'and' && !t) return v;
        if (node.op === 'or' && t) return v;
      }
      return v;
    }

    case 'Compare': {
      let left = yield* evalExpr(node.left, scope, frame);
      for (let i = 0; i < node.ops.length; i++) {
        const right = yield* evalExpr(node.comparators[i], scope, frame);
        let r;
        switch (node.ops[i]) {
          case '==': r = pyEq(left, right); break;
          case '!=': r = !pyEq(left, right); break;
          case 'in': r = pyContains(left, right); break;
          case 'not in': r = !pyContains(left, right); break;
          case 'is': r = pyIs(left, right); break;
          case 'is not': r = !pyIs(left, right); break;
          default: r = richCompare(node.ops[i], left, right);
        }
        if (!r) return false;
        left = right;
      }
      return true;
    }

    case 'Call': {
      const func = yield* evalExpr(node.func, scope, frame);
      const args = [];
      let kwargs = null;
      for (const a of node.args) {
        if (a.kind === 'pos') {
          args.push(yield* evalExpr(a.value, scope, frame));
        } else if (a.kind === 'star') {
          args.push(...iterToArray(yield* evalExpr(a.value, scope, frame)));
        } else if (a.kind === 'kw') {
          kwargs = kwargs || new Map();
          if (kwargs.has(a.name)) {
            raiseError('SyntaxError', `keyword argument repeated: ${a.name}`);
          }
          kwargs.set(a.name, yield* evalExpr(a.value, scope, frame));
        } else { // dstar
          const d = unwrap(yield* evalExpr(a.value, scope, frame));
          kwargs = kwargs || new Map();
          if (d instanceof PyDict) {
            for (const [k, v] of d.entries()) {
              if (typeof k !== 'string') {
                raiseError('TypeError', 'keywords must be strings');
              }
              if (kwargs.has(k)) {
                raiseError('TypeError', `got multiple values for keyword argument '${k}'`);
              }
              kwargs.set(k, v);
            }
          } else {
            raiseError('TypeError', `argument of type '${typeOf(d).name}' is not a mapping`);
          }
        }
      }
      return yield* callValue(func, args, kwargs);
    }

    case 'Attribute': {
      const obj = yield* evalExpr(node.obj, scope, frame);
      return getAttr(obj, node.attr);
    }

    case 'Subscript': {
      const obj = yield* evalExpr(node.obj, scope, frame);
      const idx = yield* evalSubscriptIndex(node.index, scope, frame);
      return getItem(obj, idx);
    }

    case 'IfExp': {
      const t = yield* evalExpr(node.test, scope, frame);
      if (pyTruthy(t)) return yield* evalExpr(node.body, scope, frame);
      return yield* evalExpr(node.orelse, scope, frame);
    }

    case 'Lambda': {
      return yield* makeFunction(node, scope, frame, true);
    }

    case 'NamedExpr': {
      const v = yield* evalExpr(node.value, scope, frame);
      storeName(scope, node.target.id, v);
      return v;
    }

    case 'ListComp': {
      const out = new PyList([]);
      yield* runComprehension(node, scope, frame, (v) => out.items.push(v));
      return out;
    }
    case 'SetComp': {
      const out = new PySet();
      yield* runComprehension(node, scope, frame, (v) => out.add(v));
      return out;
    }
    case 'DictComp': {
      const out = new PyDict();
      yield* runComprehension(node, scope, frame, (pair) => out.set(pair[0], pair[1]));
      return out;
    }
    case 'GeneratorExp': {
      return yield* makeGenExp(node, scope, frame);
    }

    case 'Yield': {
      const v = node.value ? yield* evalExpr(node.value, scope, frame) : NONE;
      const sent = yield v;
      return sent === undefined ? NONE : sent;
    }

    case 'YieldFrom': {
      return yield* execYieldFrom(node, scope, frame);
    }

    case 'Starred':
      raiseError('SyntaxError', "can't use starred expression here");
      return;

    default:
      throw new Error(`internal: unknown expression type ${node.type}`);
  }
}

function pyIs(a, b) {
  if (a === b) return true;
  return false;
}

// ---------- comprehensions ----------

function makeCompScope(node, scope) {
  return new Scope(scope, {
    locals: node.scopeInfo.locals,
    globals: node.scopeInfo.globals,
    nonlocals: node.scopeInfo.nonlocals,
    isClass: false,
    isComprehension: true,
  }, scope.moduleScope);
}

function* runComprehension(node, scope, frame, emit) {
  const gens = node.generators;
  const outerIterable = yield* evalExpr(gens[0].iter, scope, frame);
  const compScope = makeCompScope(node, scope);

  function* runClause(i) {
    if (i === gens.length) {
      if (node.type === 'DictComp') {
        const k = yield* evalExpr(node.key, compScope, frame);
        const v = yield* evalExpr(node.value, compScope, frame);
        emit([k, v]);
      } else {
        emit(yield* evalExpr(node.elt, compScope, frame));
      }
      return;
    }
    const gen = gens[i];
    const it = i === 0 ? pyIter(outerIterable) : pyIter(yield* evalExpr(gen.iter, compScope, frame));
    for (;;) {
      const v = it.next();
      if (v === DONE) break;
      yield* assignTarget(gen.target, v, compScope, frame);
      let pass = true;
      for (const cond of gen.ifs) {
        const c = yield* evalExpr(cond, compScope, frame);
        if (!pyTruthy(c)) { pass = false; break; }
      }
      if (pass) yield* runClause(i + 1);
    }
  }

  yield* runClause(0);
}

function* makeGenExp(node, scope, frame) {
  const gens = node.generators;
  // Outer iterable is evaluated eagerly (Python semantics).
  const outerIterable = yield* evalExpr(gens[0].iter, scope, frame);
  const compScope = makeCompScope(node, scope);
  const genFrame = {
    name: '<genexpr>',
    file: frame.file,
    line: node.line,
    scope: compScope,
    fnObj: null,
    excStack: [],
  };

  function* runClause(i) {
    if (i === gens.length) {
      const v = yield* evalExpr(node.elt, compScope, genFrame);
      yield v;
      return;
    }
    const gen = gens[i];
    const it = i === 0 ? pyIter(outerIterable) : pyIter(yield* evalExpr(gen.iter, compScope, genFrame));
    for (;;) {
      const v = it.next();
      if (v === DONE) break;
      yield* assignTarget(gen.target, v, compScope, genFrame);
      let pass = true;
      for (const cond of gen.ifs) {
        const c = yield* evalExpr(cond, compScope, genFrame);
        if (!pyTruthy(c)) { pass = false; break; }
      }
      if (pass) yield* runClause(i + 1);
    }
  }

  function* body() {
    yield* runClause(0);
    return NONE;
  }

  return new PyGenerator(body(), '<genexpr>');
}

// ---------- yield from ----------

function* execYieldFrom(node, scope, frame) {
  const sub = yield* evalExpr(node.value, scope, frame);
  if (sub instanceof PyGenerator) {
    let send = NONE;
    let mode = 'next';
    let err = null;
    for (;;) {
      let v;
      if (mode === 'throw') {
        if (err instanceof PyError) {
          v = sub.throwIn(err.pyExc);
        } else {
          throw err;
        }
        mode = 'next';
      } else {
        v = sub.nextValue(send);
      }
      if (v === DONE) {
        return sub.returnValue === undefined ? NONE : sub.returnValue;
      }
      try {
        const sent = yield v;
        send = sent === undefined ? NONE : sent;
      } catch (e) {
        mode = 'throw';
        err = e;
      }
    }
  }
  // Plain iterable: forward values; sends are ignored, StopIteration value lost.
  const it = pyIter(sub);
  for (;;) {
    const v = it.next();
    if (v === DONE) return NONE;
    yield v;
  }
}

// ---------- imports ----------

export const sysModules = new Map();
export const FileSys = {
  readFile: null,   // (path) => string | null
  scriptDir: '.',
  joinPath: (a, b) => a + '/' + b,
};
export const ENV = { argv: ['<stdin>'], version: '3.12.0 (v8python)', onExit: null };

export function importModule(name, frame) {
  if (sysModules.has(name)) return sysModules.get(name);
  if (STDLIB.has(name)) {
    const mod = STDLIB.get(name)(ENV);
    sysModules.set(name, mod);
    return mod;
  }
  // File-based import from the script directory.
  if (FileSys.readFile && !name.includes('.')) {
    const path = FileSys.joinPath(FileSys.scriptDir, name + '.py');
    const src = FileSys.readFile(path);
    if (src !== null) {
      const mod = new PyModule(name);
      sysModules.set(name, mod);
      try {
        execModuleSource(src, path, mod, name);
      } catch (e) {
        sysModules.delete(name);
        throw e;
      }
      return mod;
    }
  }
  const inst = new PyInstance(EXC.ModuleNotFoundError);
  inst.attrs.set('args', new PyTuple([`No module named '${name}'`]));
  inst.attrs.set('name', name);
  throw new PyError(inst);
}

function execModuleSource(source, filename, mod, moduleName) {
  const ast = parse(source, filename);
  const scope = new Scope(null, {
    locals: null,
    globals: new Set(),
    nonlocals: new Set(),
    isClass: false,
    isComprehension: false,
  }, null);
  scope.moduleScope = scope;
  scope.vars = mod.attrs; // module attrs are the live module namespace
  scope.vars.set('__name__', moduleName);
  scope.vars.set('__file__', filename);
  const frame = {
    name: '<module>',
    file: filename,
    line: 0,
    scope,
    fnObj: null,
    excStack: [],
    moduleName,
  };
  FRAMES.push(frame);
  try {
    runGen(execBlock(ast.body, scope, frame));
  } catch (e) {
    if (e instanceof PyError) {
      e.tb.push({ file: filename, line: frame.line, name: '<module>' });
    }
    if (e instanceof RangeError && String(e.message).includes('call stack')) {
      const pe = new PyError(makeExc('RecursionError', 'maximum recursion depth exceeded'));
      throw pe;
    }
    throw e;
  } finally {
    FRAMES.pop();
  }
}

// ---------- top-level execution ----------

export function runModule(source, filename, opts = {}) {
  const mod = new PyModule('__main__');
  sysModules.set('__main__', mod);
  if (opts.argv) ENV.argv = opts.argv;
  execModuleSource(source, filename, mod, '__main__');
  return mod;
}

// Execute source in an existing module scope (REPL).
export function runInScope(source, filename, scope, { printExprResults = false } = {}) {
  const ast = parse(source, filename);
  const frame = {
    name: '<module>', file: filename, line: 0, scope, fnObj: null, excStack: [],
    moduleName: '__main__',
  };
  FRAMES.push(frame);
  try {
    for (const stmt of ast.body) {
      if (printExprResults && stmt.type === 'ExprStmt') {
        const v = runGen(evalExpr(stmt.value, scope, frame));
        if (v !== NONE) {
          scope.vars.set('_', v);
          IO.write(pyRepr(v) + '\n');
        }
      } else {
        runGen(execStmt(stmt, scope, frame));
      }
    }
  } catch (e) {
    if (e instanceof PyError) {
      e.tb.push({ file: filename, line: frame.line, name: '<module>' });
    }
    throw e;
  } finally {
    FRAMES.pop();
  }
}

export function makeModuleScope() {
  const scope = new Scope(null, {
    locals: null, globals: new Set(), nonlocals: new Set(), isClass: false, isComprehension: false,
  }, null);
  scope.moduleScope = scope;
  scope.vars.set('__name__', '__main__');
  return scope;
}

// ---------- interpreter-dependent builtins ----------

BUILTINS.set('super', new PyBuiltin('super', (args) => {
  if (args.length >= 2) return new PySuper(args[0], args[1]);
  if (args.length === 1) return new PySuper(args[0], NONE);
  const frame = topFrame();
  if (!frame || !frame.fnObj || !frame.fnObj.definingClass) {
    raiseError('RuntimeError', 'super(): no arguments and no enclosing class');
  }
  if (frame.firstArg === undefined) {
    raiseError('RuntimeError', 'super(): no arguments');
  }
  return new PySuper(frame.fnObj.definingClass, frame.firstArg);
}));

BUILTINS.set('globals', new PyBuiltin('globals', () => {
  const frame = topFrame();
  const d = new PyDict();
  if (frame) {
    for (const [k, v] of frame.scope.moduleScope.vars) d.set(k, v);
  }
  return d;
}));

BUILTINS.set('locals', new PyBuiltin('locals', () => {
  const frame = topFrame();
  const d = new PyDict();
  if (frame) {
    for (const [k, v] of frame.scope.vars) d.set(k, v);
  }
  return d;
}));

BUILTINS.set('__import__', new PyBuiltin('__import__', (args) => {
  return importModule(unwrap(args[0]), topFrame());
}));

// Install the synchronous call hook used by JS-level protocol code.
setCallHook(pyCallSync);

export { PySyntaxError };
