// Python lexer: produces a token stream with INDENT/DEDENT tokens,
// f-string parts, and implicit line-joining inside brackets.

export const KEYWORDS = new Set([
  'False', 'None', 'True', 'and', 'as', 'assert', 'async', 'await',
  'break', 'class', 'continue', 'def', 'del', 'elif', 'else', 'except',
  'finally', 'for', 'from', 'global', 'if', 'import', 'in', 'is',
  'lambda', 'nonlocal', 'not', 'or', 'pass', 'raise', 'return', 'try',
  'while', 'with', 'yield',
]);

export class PySyntaxError extends Error {
  constructor(msg, filename, line, col) {
    super(msg);
    this.pyMessage = msg;
    this.filename = filename;
    this.line = line;
    this.col = col;
  }
}

// Longest-match-first operator list.
const OPERATORS = [
  '**=', '//=', '>>=', '<<=', '...',
  '==', '!=', '<=', '>=', '->', ':=',
  '+=', '-=', '*=', '/=', '%=', '@=', '&=', '|=', '^=',
  '**', '//', '<<', '>>',
  '+', '-', '*', '/', '%', '@', '&', '|', '^', '~',
  '<', '>', '(', ')', '[', ']', '{', '}',
  ',', ':', '.', ';', '=',
];

const ID_START = /[\p{ID_Start}_]/u;
const ID_CONTINUE = /[\p{ID_Continue}]/u;

const OPEN_BRACKETS = { '(': ')', '[': ']', '{': '}' };

export function tokenize(source, filename = '<string>') {
  // Normalize line endings.
  source = source.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const tokens = [];
  const indentStack = [0];
  let pos = 0;
  let line = 1;
  let col = 0;
  let bracketDepth = 0;
  let atLineStart = true;
  let lineHadTokens = false;

  const err = (msg, l = line, c = col) => {
    throw new PySyntaxError(msg, filename, l, c);
  };

  const push = (type, value) => {
    tokens.push({ type, value, line, col });
    if (type !== 'NEWLINE' && type !== 'INDENT' && type !== 'DEDENT') {
      lineHadTokens = true;
    }
  };

  const peek = (offset = 0) => source[pos + offset];

  function handleIndentation() {
    // Measure indentation of the upcoming line; skip blank/comment lines.
    while (pos < source.length) {
      let indent = 0;
      let p = pos;
      while (p < source.length) {
        const ch = source[p];
        if (ch === ' ') { indent += 1; p++; }
        else if (ch === '\t') { indent = Math.floor(indent / 8 + 1) * 8; p++; }
        else if (ch === '\f') { indent = 0; p++; }
        else break;
      }
      if (p >= source.length) { pos = p; return; }
      const ch = source[p];
      if (ch === '\n') {
        // Blank line: no tokens.
        pos = p + 1;
        line++;
        continue;
      }
      if (ch === '#') {
        // Comment-only line.
        while (p < source.length && source[p] !== '\n') p++;
        pos = p < source.length ? p + 1 : p;
        if (p < source.length) line++;
        continue;
      }
      // Real content; emit INDENT/DEDENT as needed.
      pos = p;
      col = indent;
      const top = indentStack[indentStack.length - 1];
      if (indent > top) {
        indentStack.push(indent);
        push('INDENT', indent);
      } else if (indent < top) {
        while (indentStack.length > 1 && indentStack[indentStack.length - 1] > indent) {
          indentStack.pop();
          push('DEDENT', indent);
        }
        if (indentStack[indentStack.length - 1] !== indent) {
          err('unindent does not match any outer indentation level');
        }
      }
      return;
    }
  }

  function scanName() {
    const startCol = col;
    let s = '';
    while (pos < source.length && ID_CONTINUE.test(source[pos])) {
      s += source[pos];
      pos++; col++;
    }
    return { s, startCol };
  }

  function scanNumber() {
    const startLine = line, startCol = col;
    let s = '';
    const take = () => { s += source[pos]; pos++; col++; };
    let kind = 'int';
    if (peek() === '0' && (peek(1) === 'x' || peek(1) === 'X')) {
      take(); take();
      if (!/[0-9a-fA-F]/.test(peek() || '')) err('invalid hexadecimal literal');
      while (/[0-9a-fA-F_]/.test(peek() || '')) take();
    } else if (peek() === '0' && (peek(1) === 'o' || peek(1) === 'O')) {
      take(); take();
      if (!/[0-7]/.test(peek() || '')) err('invalid octal literal');
      while (/[0-7_]/.test(peek() || '')) take();
    } else if (peek() === '0' && (peek(1) === 'b' || peek(1) === 'B')) {
      take(); take();
      if (!/[01]/.test(peek() || '')) err('invalid binary literal');
      while (/[01_]/.test(peek() || '')) take();
    } else {
      while (/[0-9_]/.test(peek() || '')) take();
      if (peek() === '.' && /[0-9]/.test(peek(1) || '')) {
        kind = 'float';
        take();
        while (/[0-9_]/.test(peek() || '')) take();
      } else if (peek() === '.' && !ID_START.test(peek(1) || 'x')) {
        // "1." style float (not followed by identifier => not attribute access)
        kind = 'float';
        take();
      }
      if (peek() === 'e' || peek() === 'E') {
        const save = { pos, col, s, kind };
        take();
        if (peek() === '+' || peek() === '-') take();
        if (/[0-9]/.test(peek() || '')) {
          kind = 'float';
          while (/[0-9_]/.test(peek() || '')) take();
        } else {
          // Not an exponent; restore.
          ({ pos, col, s, kind } = save);
        }
      }
    }
    if (peek() === 'j' || peek() === 'J') {
      pos++; col++;
      kind = 'imaginary';
    }
    if (s.endsWith('_') || s.includes('__')) err('invalid decimal literal');
    tokens.push({ type: 'NUMBER', value: { kind, text: s }, line: startLine, col: startCol });
    lineHadTokens = true;
  }

  function decodeEscape() {
    // pos points at the char after the backslash.
    const ch = source[pos];
    pos++; col++;
    switch (ch) {
      case 'n': return '\n';
      case 't': return '\t';
      case 'r': return '\r';
      case '\\': return '\\';
      case "'": return "'";
      case '"': return '"';
      case 'a': return '\x07';
      case 'b': return '\b';
      case 'f': return '\f';
      case 'v': return '\v';
      case '0': case '1': case '2': case '3':
      case '4': case '5': case '6': case '7': {
        let oct = ch;
        for (let i = 0; i < 2 && /[0-7]/.test(peek() || ''); i++) {
          oct += source[pos]; pos++; col++;
        }
        return String.fromCharCode(parseInt(oct, 8));
      }
      case 'x': {
        let hex = '';
        for (let i = 0; i < 2; i++) {
          if (!/[0-9a-fA-F]/.test(peek() || '')) err('invalid \\x escape');
          hex += source[pos]; pos++; col++;
        }
        return String.fromCharCode(parseInt(hex, 16));
      }
      case 'u': {
        let hex = '';
        for (let i = 0; i < 4; i++) {
          if (!/[0-9a-fA-F]/.test(peek() || '')) err('invalid \\u escape');
          hex += source[pos]; pos++; col++;
        }
        return String.fromCharCode(parseInt(hex, 16));
      }
      case 'U': {
        let hex = '';
        for (let i = 0; i < 8; i++) {
          if (!/[0-9a-fA-F]/.test(peek() || '')) err('invalid \\U escape');
          hex += source[pos]; pos++; col++;
        }
        return String.fromCodePoint(parseInt(hex, 16));
      }
      case '\n':
        line++; col = 0;
        return '';
      default:
        if (ch === undefined) err('EOL while scanning string literal');
        return '\\' + ch;
    }
  }

  function scanStringBody(quote, triple, raw) {
    // Returns the decoded string contents; consumes the closing quote(s).
    let out = '';
    for (;;) {
      if (pos >= source.length) err('unterminated string literal');
      const ch = source[pos];
      if (ch === '\n') {
        if (!triple) err('EOL while scanning string literal');
        out += '\n';
        pos++; line++; col = 0;
        continue;
      }
      if (ch === '\\') {
        pos++; col++;
        if (raw) {
          const next = source[pos];
          if (next === undefined) err('unterminated string literal');
          if (next === '\n') { out += '\\\n'; pos++; line++; col = 0; }
          else { out += '\\' + next; pos++; col++; }
        } else {
          out += decodeEscape();
        }
        continue;
      }
      if (ch === quote) {
        if (!triple) { pos++; col++; return out; }
        if (source[pos + 1] === quote && source[pos + 2] === quote) {
          pos += 3; col += 3;
          return out;
        }
        out += ch;
        pos++; col++;
        continue;
      }
      out += ch;
      pos++; col++;
    }
  }

  function scanFStringBody(quote, triple, raw) {
    // Returns a list of parts: {type:'str', value} | {type:'expr', code, conv, spec, selfDoc}
    const parts = [];
    let lit = '';
    const flushLit = () => { if (lit) { parts.push({ type: 'str', value: lit }); lit = ''; } };
    for (;;) {
      if (pos >= source.length) err('unterminated f-string literal');
      const ch = source[pos];
      if (ch === '\n') {
        if (!triple) err('EOL while scanning string literal');
        lit += '\n'; pos++; line++; col = 0;
        continue;
      }
      if (ch === '\\') {
        pos++; col++;
        if (raw) {
          const next = source[pos];
          if (next === undefined) err('unterminated string literal');
          lit += '\\' + next;
          if (next === '\n') { line++; col = 0; pos++; } else { pos++; col++; }
        } else {
          lit += decodeEscape();
        }
        continue;
      }
      if (ch === quote) {
        if (!triple) { pos++; col++; flushLit(); return parts; }
        if (source[pos + 1] === quote && source[pos + 2] === quote) {
          pos += 3; col += 3; flushLit(); return parts;
        }
        lit += ch; pos++; col++;
        continue;
      }
      if (ch === '{') {
        if (source[pos + 1] === '{') { lit += '{'; pos += 2; col += 2; continue; }
        flushLit();
        pos++; col++;
        parts.push(scanFStringExpr(quote, triple));
        continue;
      }
      if (ch === '}') {
        if (source[pos + 1] === '}') { lit += '}'; pos += 2; col += 2; continue; }
        err("f-string: single '}' is not allowed");
      }
      lit += ch;
      pos++; col++;
    }
  }

  function scanFStringExpr(quote, triple) {
    // pos is just after '{'. Scan a balanced expression.
    const startPos = pos;
    let code = '';
    let depth = 0;
    let conv = null;
    let selfDoc = false;
    let selfDocText = null;
    const exprLine = line;
    for (;;) {
      if (pos >= source.length) err("f-string: expecting '}'");
      const ch = source[pos];
      if (ch === '\n' && !triple) err("f-string: expecting '}'");
      if (depth === 0 && ch === '}') {
        pos++; col++;
        return { type: 'expr', code, conv, spec: null, selfDoc, selfDocText, line: exprLine };
      }
      if (depth === 0 && ch === '=' && source[pos + 1] !== '=' &&
          !'=!<>+-*/%&|^@:'.includes(code[code.length - 1] || '')) {
        // Self-documenting form: f"{expr=}". Whitespace may surround the '='.
        let q = pos + 1;
        while (source[q] === ' ' || source[q] === '\t') q++;
        const after = source[q];
        if (after === '}' || after === '!' || after === ':') {
          selfDoc = true;
          // The label is the verbatim source from after '{' up to and
          // including the '=' plus any trailing whitespace.
          selfDocText = source.slice(startPos, q);
          col += q - pos;
          pos = q;
          continue;
        }
      }
      if (depth === 0 && ch === '!' && 'rsa'.includes(source[pos + 1] || '') &&
          (source[pos + 2] === '}' || source[pos + 2] === ':')) {
        conv = source[pos + 1];
        pos += 2; col += 2;
        continue;
      }
      if (depth === 0 && ch === ':') {
        pos++; col++;
        const spec = scanFStringSpec(quote, triple);
        return { type: 'expr', code, conv, spec, selfDoc, selfDocText, line: exprLine };
      }
      if (ch === '(' || ch === '[' || ch === '{') { depth++; code += ch; pos++; col++; continue; }
      if (ch === ')' || ch === ']' || ch === '}') { depth--; code += ch; pos++; col++; continue; }
      if (ch === "'" || ch === '"') {
        // Nested string literal inside the expression.
        const q = ch;
        let s = q;
        pos++; col++;
        let trip = false;
        if (source[pos] === q && source[pos + 1] === q) {
          trip = true; s += q + q; pos += 2; col += 2;
        }
        for (;;) {
          if (pos >= source.length) err('unterminated string literal');
          const c2 = source[pos];
          if (c2 === '\\') {
            s += c2 + (source[pos + 1] || '');
            pos += 2; col += 2;
            continue;
          }
          if (c2 === '\n') {
            if (!trip) err('EOL while scanning string literal');
            s += c2; pos++; line++; col = 0;
            continue;
          }
          if (c2 === q) {
            if (!trip) { s += q; pos++; col++; break; }
            if (source[pos + 1] === q && source[pos + 2] === q) {
              s += q + q + q; pos += 3; col += 3; break;
            }
          }
          s += c2; pos++; col++;
        }
        code += s;
        continue;
      }
      if (ch === '\n') { code += ch; pos++; line++; col = 0; continue; }
      code += ch;
      pos++; col++;
    }
  }

  function scanFStringSpec(quote, triple) {
    // Format spec: literal text plus possibly nested {expr} (one level).
    const parts = [];
    let lit = '';
    const flushLit = () => { if (lit) { parts.push({ type: 'str', value: lit }); lit = ''; } };
    for (;;) {
      if (pos >= source.length) err("f-string: expecting '}'");
      const ch = source[pos];
      if (ch === '}') {
        pos++; col++;
        flushLit();
        return parts;
      }
      if (ch === '{') {
        flushLit();
        pos++; col++;
        const inner = scanFStringExpr(quote, triple);
        parts.push(inner);
        continue;
      }
      if (ch === '\n' && !triple) err("f-string: expecting '}'");
      if (ch === '\n') { lit += ch; pos++; line++; col = 0; continue; }
      lit += ch;
      pos++; col++;
    }
  }

  function tryScanString(prefixInfo) {
    // prefixInfo: {raw, fstring, bytes} or null; pos at the quote char.
    const startLine = line, startCol = col;
    const quote = source[pos];
    let triple = false;
    pos++; col++;
    if (source[pos] === quote && source[pos + 1] === quote) {
      triple = true;
      pos += 2; col += 2;
    } else if (source[pos] === quote) {
      // Empty string ''
      pos++; col++;
      if (prefixInfo && prefixInfo.fstring) {
        tokens.push({ type: 'FSTRING', value: { parts: [] }, line: startLine, col: startCol });
      } else {
        tokens.push({ type: 'STRING', value: { value: '', bytes: !!(prefixInfo && prefixInfo.bytes) }, line: startLine, col: startCol });
      }
      lineHadTokens = true;
      return;
    }
    const raw = !!(prefixInfo && prefixInfo.raw);
    if (prefixInfo && prefixInfo.fstring) {
      const parts = scanFStringBody(quote, triple, raw);
      tokens.push({ type: 'FSTRING', value: { parts }, line: startLine, col: startCol });
    } else {
      const value = scanStringBody(quote, triple, raw);
      tokens.push({ type: 'STRING', value: { value, bytes: !!(prefixInfo && prefixInfo.bytes) }, line: startLine, col: startCol });
    }
    lineHadTokens = true;
  }

  // ---- main loop ----
  for (;;) {
    if (atLineStart && bracketDepth === 0) {
      atLineStart = false;
      handleIndentation();
      if (pos >= source.length) break;
    }
    if (pos >= source.length) break;
    const ch = source[pos];

    if (ch === '\n') {
      pos++;
      if (bracketDepth === 0) {
        if (lineHadTokens) push('NEWLINE', null);
        lineHadTokens = false;
        line++;
        col = 0;
        atLineStart = true;
      } else {
        line++;
        col = 0;
      }
      continue;
    }
    if (ch === ' ' || ch === '\t' || ch === '\f') { pos++; col++; continue; }
    if (ch === '#') {
      while (pos < source.length && source[pos] !== '\n') pos++;
      continue;
    }
    if (ch === '\\' && source[pos + 1] === '\n') {
      pos += 2;
      line++;
      col = 0;
      continue;
    }

    // String prefixes / names.
    if (ID_START.test(ch)) {
      const save = { pos, col };
      const { s, startCol } = scanName();
      // Check for string prefix forms (r, b, f, u and combos).
      if (s.length <= 2 && /^[rRbBuUfF]+$/.test(s) && (peek() === '"' || peek() === "'")) {
        const lower = s.toLowerCase();
        const info = {
          raw: lower.includes('r'),
          fstring: lower.includes('f'),
          bytes: lower.includes('b'),
        };
        if (info.bytes && info.fstring) err('invalid string prefix');
        tryScanString(info);
        continue;
      }
      if (KEYWORDS.has(s)) {
        tokens.push({ type: 'KEYWORD', value: s, line, col: startCol });
      } else {
        tokens.push({ type: 'NAME', value: s, line, col: startCol });
      }
      lineHadTokens = true;
      continue;
    }

    if (ch === '"' || ch === "'") {
      tryScanString(null);
      continue;
    }

    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(peek(1) || ''))) {
      scanNumber();
      continue;
    }

    // Operators.
    let matched = null;
    for (const op of OPERATORS) {
      if (source.startsWith(op, pos)) { matched = op; break; }
    }
    if (matched) {
      if (matched in OPEN_BRACKETS) bracketDepth++;
      else if (matched === ')' || matched === ']' || matched === '}') {
        bracketDepth = Math.max(0, bracketDepth - 1);
      }
      push('OP', matched);
      pos += matched.length;
      col += matched.length;
      continue;
    }

    if (ch === '!') err("invalid syntax");
    err(`invalid character ${JSON.stringify(ch)}`);
  }

  // Final NEWLINE + DEDENTs.
  if (lineHadTokens) push('NEWLINE', null);
  while (indentStack.length > 1) {
    indentStack.pop();
    push('DEDENT', 0);
  }
  push('EOF', null);
  return tokens;
}
