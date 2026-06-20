#!/usr/bin/env node
// v8python CLI entry point (invoke via the ./v8python launcher).
//   ./v8python script.py [args...]   run a file
//   ./v8python                       interactive REPL (see repl.js)

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { runModule, FileSys, ENV, PySyntaxError } from './interp.js';
import { IO } from './builtins.js';
import {
  PyError, pyStr, typeOf, isInstanceOf, EXC, NONE,
  unwrap, FileOps, PyFile, raiseError,
} from './objects.js';

// ---------- I/O wiring ----------

IO.write = (s) => process.stdout.write(s);
IO.writeErr = (s) => process.stderr.write(s);

// Synchronous, line-buffered stdin reader.
let stdinBuffer = '';
let stdinEOF = false;
function readLineSync() {
  if (stdinEOF) {
    const nl = stdinBuffer.indexOf('\n');
    if (nl === -1) {
      if (stdinBuffer.length === 0) return null;
      const rest = stdinBuffer; stdinBuffer = '';
      return rest;
    }
  }
  for (;;) {
    const nl = stdinBuffer.indexOf('\n');
    if (nl !== -1) {
      const line = stdinBuffer.slice(0, nl + 1);
      stdinBuffer = stdinBuffer.slice(nl + 1);
      return line;
    }
    if (stdinEOF) {
      if (stdinBuffer.length === 0) return null;
      const rest = stdinBuffer; stdinBuffer = '';
      return rest;
    }
    const chunk = Buffer.alloc(65536);
    let n;
    try {
      n = fs.readSync(0, chunk, 0, chunk.length, null);
    } catch (e) {
      if (e.code === 'EAGAIN') { continue; }
      if (e.code === 'EOF') { stdinEOF = true; continue; }
      throw e;
    }
    if (n === 0) { stdinEOF = true; continue; }
    stdinBuffer += chunk.toString('utf8', 0, n);
  }
}
IO.readLine = readLineSync;

// ---------- file operations ----------

FileOps.open = (filePath, mode) => {
  const isRead = mode.includes('r');
  const isAppend = mode.includes('a');
  const isWrite = mode.includes('w');
  const handle = { fd: null, content: '', pos: 0 };
  try {
    if (isRead) {
      handle.content = fs.readFileSync(filePath, 'utf8');
      handle.pos = 0;
    } else if (isWrite) {
      handle.fd = fs.openSync(filePath, 'w');
    } else if (isAppend) {
      handle.fd = fs.openSync(filePath, 'a');
    } else {
      handle.content = fs.readFileSync(filePath, 'utf8');
    }
  } catch (e) {
    if (e.code === 'ENOENT') raiseError('FileNotFoundError', `[Errno 2] No such file or directory: '${filePath}'`);
    if (e.code === 'EACCES') raiseError('PermissionError', `[Errno 13] Permission denied: '${filePath}'`);
    if (e.code === 'EISDIR') raiseError('IsADirectoryError', `[Errno 21] Is a directory: '${filePath}'`);
    raiseError('OSError', String(e.message));
  }
  return new PyFile(handle, filePath, mode);
};

FileOps.read = (f, size) => {
  const h = f.handle;
  if (size === undefined || size < 0) {
    const rest = h.content.slice(h.pos);
    h.pos = h.content.length;
    return rest;
  }
  const rest = h.content.slice(h.pos, h.pos + size);
  h.pos += size;
  return rest;
};

FileOps.readLine = (f) => {
  const h = f.handle;
  if (h.pos >= h.content.length) return null;
  const nl = h.content.indexOf('\n', h.pos);
  if (nl === -1) {
    const rest = h.content.slice(h.pos);
    h.pos = h.content.length;
    return rest;
  }
  const line = h.content.slice(h.pos, nl + 1);
  h.pos = nl + 1;
  return line;
};

FileOps.write = (f, s) => {
  const h = f.handle;
  if (h.fd !== null) {
    fs.writeSync(h.fd, s);
  } else {
    raiseError('OSError', 'not writable');
  }
};

FileOps.close = (f) => {
  if (f.closed) return;
  f.closed = true;
  if (f.handle.fd !== null) {
    try { fs.closeSync(f.handle.fd); } catch (e) { /* ignore */ }
  }
};

// ---------- traceback printing ----------

export function printTraceback(err) {
  if (err instanceof PySyntaxError) {
    process.stderr.write(`  File "${err.filename}", line ${err.line}\n`);
    const label = /unexpected indent|unindent|expected an indented/.test(err.pyMessage || '')
      ? 'IndentationError' : 'SyntaxError';
    process.stderr.write(`${label}: ${err.pyMessage}\n`);
    return;
  }
  if (!(err instanceof PyError)) throw err;

  const exc = err.pyExc;
  process.stderr.write('Traceback (most recent call last):\n');
  // err.tb has innermost first; print outermost first (most recent call last).
  const frames = [...err.tb].reverse();
  for (const fr of frames) {
    process.stderr.write(`  File "${fr.file}", line ${fr.line}, in ${fr.name}\n`);
  }
  const typeName = exc.cls.name;
  let msg = '';
  try { msg = pyStr(exc); } catch (e) { msg = ''; }
  process.stderr.write(msg === '' ? `${typeName}\n` : `${typeName}: ${msg}\n`);
}

// ---------- main ----------

function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    // Defer to REPL module if present; otherwise inform the user.
    import('./repl.js').then((repl) => {
      repl.startRepl({ printTraceback });
    }).catch((e) => {
      process.stderr.write('REPL is not available: ' + e.message + '\n');
      process.exitCode = 2;
    });
    return;
  }

  const scriptPath = args[0];
  const scriptArgs = args.slice(1);

  let src;
  try {
    src = fs.readFileSync(scriptPath, 'utf8');
  } catch (e) {
    process.stderr.write(`v8python: can't open file '${scriptPath}': ${e.message}\n`);
    process.exitCode = 2;
    return;
  }

  FileSys.readFile = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return null; } };
  FileSys.scriptDir = path.dirname(path.resolve(scriptPath));
  FileSys.joinPath = (a, b) => path.join(a, b);
  ENV.argv = [scriptPath, ...scriptArgs];

  try {
    runModule(src, scriptPath, { argv: ENV.argv });
  } catch (e) {
    if (e instanceof PyError && isInstanceOf(e.pyExc, EXC.SystemExit)) {
      const code = e.pyExc.attrs.get('code');
      if (code === undefined || code === NONE) {
        process.exitCode = 0;
      } else if (typeof code === 'bigint') {
        process.exitCode = Number(code);
      } else if (typeof code === 'boolean') {
        process.exitCode = code ? 1 : 0;
      } else {
        process.stderr.write(pyStr(code) + '\n');
        process.exitCode = 1;
      }
      return;
    }
    printTraceback(e);
    process.exitCode = 1;
  }
}

main();
