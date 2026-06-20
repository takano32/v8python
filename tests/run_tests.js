#!/usr/bin/env node
// Differential test runner: runs each tests/cases/*.py under both CPython
// (python3) and v8python (node src/cli.js), then compares outputs.
//
// Pass/fail rules:
//   - stdout must match exactly, AND
//   - if both processes exited abnormally, the exception *type name* (the text
//     up to the first ':' on the last non-empty stderr line) must match.
//     CPython adds source-line and caret (^^^) decorations to tracebacks that
//     v8python does not reproduce, so full stderr is never compared.
//
// Usage:
//   node tests/run_tests.js            run all cases
//   node tests/run_tests.js dict       run cases whose filename contains "dict"

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const CASES_DIR = path.join(__dirname, 'cases');

const filter = process.argv[2] || '';

function run(cmd, args, file) {
  try {
    const out = execFileSync(cmd, [...args, file], {
      cwd: ROOT,
      timeout: 10000,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { stdout: out, stderr: '', code: 0 };
  } catch (e) {
    return {
      stdout: e.stdout != null ? e.stdout.toString() : '',
      stderr: e.stderr != null ? e.stderr.toString() : '',
      code: e.status == null ? 1 : e.status,
      timedOut: e.code === 'ETIMEDOUT',
    };
  }
}

function lastNonEmptyLine(s) {
  const lines = s.replace(/\s+$/, '').split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].trim() !== '') return lines[i];
  }
  return '';
}

function excType(stderrText) {
  const line = lastNonEmptyLine(stderrText);
  const colon = line.indexOf(':');
  return colon === -1 ? line.trim() : line.slice(0, colon).trim();
}

function showDiff(expected, actual) {
  const e = expected.split('\n');
  const a = actual.split('\n');
  let first = 0;
  while (first < e.length && first < a.length && e[first] === a[first]) first++;
  const start = Math.max(0, first - 3);
  const end = Math.min(Math.max(e.length, a.length), first + 4);
  const out = [];
  for (let i = start; i < end; i++) {
    if (e[i] !== a[i]) {
      if (e[i] !== undefined) out.push(`    expected| ${e[i]}`);
      if (a[i] !== undefined) out.push(`    actual  | ${a[i]}`);
    } else if (e[i] !== undefined) {
      out.push(`            | ${e[i]}`);
    }
  }
  return out.join('\n');
}

function main() {
  if (!fs.existsSync(CASES_DIR)) {
    console.error('no tests/cases directory');
    process.exit(1);
  }
  let files = fs.readdirSync(CASES_DIR).filter((f) => f.endsWith('.py')).sort();
  if (filter) files = files.filter((f) => f.includes(filter));

  let passed = 0;
  const failures = [];

  for (const f of files) {
    const file = path.join(CASES_DIR, f);
    const cp = run('python3', [], file);
    const v8 = run('node', ['src/cli.js'], file);

    let ok = cp.stdout === v8.stdout;
    let reason = '';
    if (!ok) {
      reason = 'stdout mismatch';
    } else if (cp.code !== 0 || v8.code !== 0) {
      // Both should fail with the same exception type (or both exit cleanly).
      const ct = excType(cp.stderr);
      const vt = excType(v8.stderr);
      if (cp.code !== 0 && v8.code !== 0) {
        if (ct !== vt) { ok = false; reason = `exception type: cpython=${ct} v8=${vt}`; }
      } else if (cp.code !== 0 || v8.code !== 0) {
        // one failed, one didn't
        ok = false;
        reason = `exit code: cpython=${cp.code} v8=${v8.code}`;
      }
    }

    if (ok) {
      passed++;
      console.log(`PASS ${f}`);
    } else {
      console.log(`FAIL ${f}  (${reason})`);
      if (reason === 'stdout mismatch') {
        console.log(showDiff(cp.stdout, v8.stdout));
      } else {
        if (cp.stderr) console.log('    cpython stderr: ' + lastNonEmptyLine(cp.stderr));
        if (v8.stderr) console.log('    v8 stderr:      ' + lastNonEmptyLine(v8.stderr));
      }
      failures.push(f);
    }
  }

  console.log(`\n${passed}/${files.length} passed`);
  if (failures.length) {
    console.log('Failures: ' + failures.join(', '));
    process.exit(1);
  }
}

main();
