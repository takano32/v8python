// Interactive REPL for v8python.
// Driven synchronously off IO.readLine (wired up by cli.js).

import { IO } from './builtins.js';
import { makeModuleScope, runInScope, PySyntaxError } from './interp.js';
import { PyError, isInstanceOf, EXC, pyStr, NONE } from './objects.js';

// Scan source to find whether brackets are balanced and we're not inside an
// unterminated string. Returns { depth, inString }.
function scanState(source) {
  let depth = 0;
  let i = 0;
  const n = source.length;
  while (i < n) {
    const ch = source[i];
    if (ch === '#') {
      while (i < n && source[i] !== '\n') i++;
      continue;
    }
    if (ch === "'" || ch === '"') {
      const q = ch;
      const triple = source[i + 1] === q && source[i + 2] === q;
      const close = triple ? q + q + q : q;
      i += triple ? 3 : 1;
      let closed = false;
      while (i < n) {
        if (source[i] === '\\') { i += 2; continue; }
        if (source.startsWith(close, i)) { i += close.length; closed = true; break; }
        i++;
      }
      if (!closed) return { depth, inString: true };
      continue;
    }
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === ')' || ch === ']' || ch === '}') depth--;
    i++;
  }
  return { depth, inString: false };
}

function lastCodeLineEndsWithColon(source) {
  // Strip comments/strings crudely line by line; check the last non-blank line.
  const lines = source.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    let line = lines[i];
    const hash = line.indexOf('#');
    if (hash !== -1) line = line.slice(0, hash);
    if (line.trim() === '') continue;
    return line.trimEnd().endsWith(':');
  }
  return false;
}

function startsCompound(buffer) {
  return /^\s*@/.test(buffer[0]) ||
    buffer.some((l) => {
      let line = l;
      const hash = line.indexOf('#');
      if (hash !== -1) line = line.slice(0, hash);
      return line.trimEnd().endsWith(':');
    });
}

export function startRepl(opts = {}) {
  const printTraceback = opts.printTraceback || defaultPrintTraceback;
  const scope = makeModuleScope();

  process.stdout.write('Python 3.12 (v8python) on V8\nType Python code; Ctrl-D to exit.\n');

  const buffer = [];

  function execute() {
    const source = buffer.join('\n');
    buffer.length = 0;
    if (source.trim() === '') return;
    try {
      runInScope(source, '<stdin>', scope, { printExprResults: true });
    } catch (e) {
      if (e instanceof PyError && isInstanceOf(e.pyExc, EXC.SystemExit)) {
        const code = e.pyExc.attrs.get('code');
        if (code === undefined || code === NONE || code === false) process.exit(0);
        if (typeof code === 'bigint') process.exit(Number(code));
        if (code === true) process.exit(1);
        process.stderr.write(pyStr(code) + '\n');
        process.exit(1);
      }
      printTraceback(e);
    }
  }

  for (;;) {
    process.stdout.write(buffer.length === 0 ? '>>> ' : '... ');
    const line = IO.readLine();
    if (line === null) {
      process.stdout.write('\n');
      break;
    }
    const text = line.replace(/\r?\n$/, '');

    if (buffer.length === 0) {
      if (text.trim() === '') continue;
      buffer.push(text);
      const st = scanState(text);
      if (st.depth > 0 || st.inString || text.trimEnd().endsWith('\\') ||
          lastCodeLineEndsWithColon(text)) {
        continue;
      }
      execute();
    } else {
      if (text.trim() === '') {
        execute();
        continue;
      }
      buffer.push(text);
      const src = buffer.join('\n');
      const st = scanState(src);
      if (st.depth > 0 || st.inString || text.trimEnd().endsWith('\\')) continue;
      if (startsCompound(buffer)) continue; // block: wait for a blank line
      execute();
    }
  }
}

function defaultPrintTraceback(err) {
  if (err instanceof PySyntaxError) {
    process.stderr.write(`  File "${err.filename}", line ${err.line}\n`);
    process.stderr.write(`SyntaxError: ${err.pyMessage}\n`);
    return;
  }
  if (!(err instanceof PyError)) throw err;
  const exc = err.pyExc;
  process.stderr.write('Traceback (most recent call last):\n');
  for (const fr of [...err.tb].reverse()) {
    process.stderr.write(`  File "${fr.file}", line ${fr.line}, in ${fr.name}\n`);
  }
  const typeName = exc.cls.name;
  let msg = '';
  try { msg = pyStr(exc); } catch { msg = ''; }
  process.stderr.write(msg === '' ? `${typeName}\n` : `${typeName}: ${msg}\n`);
}
