// Recursive-descent parser producing an AST, plus a scope-analysis pass
// that annotates function/lambda/comprehension nodes with local-variable info.

import { tokenize, PySyntaxError } from './lexer.js';

export { PySyntaxError };

const AUG_OPS = {
  '+=': '+', '-=': '-', '*=': '*', '/=': '/', '//=': '//', '%=': '%',
  '@=': '@', '&=': '&', '|=': '|', '^=': '^', '>>=': '>>', '<<=': '<<', '**=': '**',
};

class Parser {
  constructor(tokens, filename) {
    this.tokens = tokens;
    this.pos = 0;
    this.filename = filename;
  }

  peek(offset = 0) { return this.tokens[this.pos + offset]; }
  next() { return this.tokens[this.pos++]; }

  err(msg, tok = this.peek()) {
    throw new PySyntaxError(msg, this.filename, tok ? tok.line : 0, tok ? tok.col : 0);
  }

  at(type, value) {
    const t = this.peek();
    if (!t || t.type !== type) return false;
    if (value !== undefined && t.value !== value) return false;
    return true;
  }
  atOp(value) { return this.at('OP', value); }
  atKw(value) { return this.at('KEYWORD', value); }

  accept(type, value) {
    if (this.at(type, value)) return this.next();
    return null;
  }
  acceptOp(value) { return this.accept('OP', value); }
  acceptKw(value) { return this.accept('KEYWORD', value); }

  expect(type, value, what) {
    const t = this.peek();
    if (this.at(type, value)) return this.next();
    this.err(what || `invalid syntax (expected ${value || type})`);
  }
  expectOp(value) { return this.expect('OP', value, `invalid syntax (expected '${value}')`); }
  expectKw(value) { return this.expect('KEYWORD', value, `invalid syntax (expected '${value}')`); }

  expectName() {
    const t = this.peek();
    if (!this.at('NAME')) this.err('invalid syntax (expected name)');
    return this.next().value;
  }

  // ---------- module ----------

  parseModule() {
    const body = [];
    while (!this.at('EOF')) {
      if (this.accept('NEWLINE')) continue;
      body.push(...this.parseStatement());
    }
    return { type: 'Module', body };
  }

  // Returns a list of statements (simple statements can be `;`-separated).
  parseStatement() {
    const t = this.peek();
    if (t.type === 'KEYWORD') {
      switch (t.value) {
        case 'if': return [this.parseIf()];
        case 'while': return [this.parseWhile()];
        case 'for': return [this.parseFor()];
        case 'try': return [this.parseTry()];
        case 'with': return [this.parseWith()];
        case 'def': return [this.parseFunctionDef([])];
        case 'class': return [this.parseClassDef([])];
        case 'async': {
          this.err("'async' is not supported");
          break;
        }
      }
    }
    if (this.atOp('@')) return [this.parseDecorated()];
    return this.parseSimpleStatements();
  }

  parseSimpleStatements() {
    const stmts = [this.parseSimpleStatement()];
    while (this.acceptOp(';')) {
      if (this.at('NEWLINE') || this.at('EOF')) break;
      stmts.push(this.parseSimpleStatement());
    }
    if (!this.accept('NEWLINE') && !this.at('EOF') && !this.at('DEDENT')) {
      this.err('invalid syntax');
    }
    return stmts;
  }

  parseSimpleStatement() {
    const t = this.peek();
    const line = t.line;
    if (t.type === 'KEYWORD') {
      switch (t.value) {
        case 'pass': this.next(); return { type: 'Pass', line };
        case 'break': this.next(); return { type: 'Break', line };
        case 'continue': this.next(); return { type: 'Continue', line };
        case 'return': {
          this.next();
          let value = null;
          if (!this.at('NEWLINE') && !this.atOp(';') && !this.at('EOF') && !this.at('DEDENT')) {
            value = this.parseTestListStarAllowYield();
          }
          return { type: 'Return', value, line };
        }
        case 'raise': {
          this.next();
          let exc = null, cause = null;
          if (!this.at('NEWLINE') && !this.atOp(';') && !this.at('EOF') && !this.at('DEDENT')) {
            exc = this.parseTest();
            if (this.acceptKw('from')) cause = this.parseTest();
          }
          return { type: 'Raise', exc, cause, line };
        }
        case 'global': {
          this.next();
          const names = [this.expectName()];
          while (this.acceptOp(',')) names.push(this.expectName());
          return { type: 'Global', names, line };
        }
        case 'nonlocal': {
          this.next();
          const names = [this.expectName()];
          while (this.acceptOp(',')) names.push(this.expectName());
          return { type: 'Nonlocal', names, line };
        }
        case 'del': {
          this.next();
          const targets = [this.toTarget(this.parsePostfix(), 'delete')];
          while (this.acceptOp(',')) {
            if (this.at('NEWLINE') || this.atOp(';')) break;
            targets.push(this.toTarget(this.parsePostfix(), 'delete'));
          }
          return { type: 'Delete', targets, line };
        }
        case 'assert': {
          this.next();
          const test = this.parseTest();
          let msg = null;
          if (this.acceptOp(',')) msg = this.parseTest();
          return { type: 'Assert', test, msg, line };
        }
        case 'import': return this.parseImport();
        case 'from': return this.parseImportFrom();
      }
    }
    return this.parseExprStatement();
  }

  parseImport() {
    const line = this.peek().line;
    this.expectKw('import');
    const names = [];
    do {
      let name = this.expectName();
      while (this.acceptOp('.')) name += '.' + this.expectName();
      let asname = null;
      if (this.acceptKw('as')) asname = this.expectName();
      names.push({ name, asname });
    } while (this.acceptOp(','));
    return { type: 'Import', names, line };
  }

  parseImportFrom() {
    const line = this.peek().line;
    this.expectKw('from');
    let level = 0;
    while (this.atOp('.') || this.atOp('...')) {
      level += this.next().value.length;
    }
    let module = null;
    if (!this.atKw('import')) {
      module = this.expectName();
      while (this.acceptOp('.')) module += '.' + this.expectName();
    }
    this.expectKw('import');
    if (this.acceptOp('*')) {
      return { type: 'ImportFrom', module, names: '*', level, line };
    }
    const paren = !!this.acceptOp('(');
    const names = [];
    do {
      if (paren && this.atOp(')')) break;
      const name = this.expectName();
      let asname = null;
      if (this.acceptKw('as')) asname = this.expectName();
      names.push({ name, asname });
    } while (this.acceptOp(','));
    if (paren) this.expectOp(')');
    return { type: 'ImportFrom', module, names, level, line };
  }

  parseExprStatement() {
    const line = this.peek().line;
    const first = this.parseTestListStarAllowYield();

    // Annotated assignment: NAME : annotation [= value]
    if (this.atOp(':') && (first.type === 'Name' || first.type === 'Attribute' || first.type === 'Subscript')) {
      this.next();
      this.parseTest(); // annotation: parsed and discarded
      let value = null;
      if (this.acceptOp('=')) value = this.parseTestListStarAllowYield();
      if (value === null) {
        // Pure annotation: declares the name as local but assigns nothing.
        return { type: 'AnnDecl', target: this.toTarget(first, 'assign'), line };
      }
      return { type: 'Assign', targets: [this.toTarget(first, 'assign')], value, line };
    }

    const t = this.peek();
    if (t && t.type === 'OP' && t.value in AUG_OPS) {
      this.next();
      if (first.type !== 'Name' && first.type !== 'Attribute' && first.type !== 'Subscript') {
        this.err(`'${first.type}' is an illegal expression for augmented assignment`);
      }
      const value = this.parseTestListStarAllowYield();
      return { type: 'AugAssign', target: first, op: AUG_OPS[t.value], value, line };
    }

    if (this.atOp('=')) {
      const targets = [this.toTarget(first, 'assign')];
      let value = null;
      while (this.acceptOp('=')) {
        const expr = this.parseTestListStarAllowYield();
        if (this.atOp('=')) {
          targets.push(this.toTarget(expr, 'assign'));
        } else {
          value = expr;
        }
      }
      return { type: 'Assign', targets, value, line };
    }

    return { type: 'ExprStmt', value: first, line };
  }

  // Convert an expression to an assignment/delete target, validating it.
  toTarget(expr, kind) {
    switch (expr.type) {
      case 'Name':
      case 'Attribute':
      case 'Subscript':
        return expr;
      case 'Tuple':
      case 'List': {
        let sawStar = false;
        const elts = expr.elts.map((e) => {
          if (e.type === 'Starred') {
            if (sawStar) this.err('multiple starred expressions in assignment');
            sawStar = true;
            return { type: 'Starred', value: this.toTarget(e.value, kind), line: e.line };
          }
          return this.toTarget(e, kind);
        });
        return { type: expr.type, elts, isTarget: true, line: expr.line };
      }
      case 'Starred':
        this.err('starred assignment target must be in a list or tuple');
        break;
      default:
        this.err(kind === 'delete' ? 'cannot delete this expression' : `cannot assign to ${expr.type.toLowerCase()}`);
    }
  }

  // ---------- compound statements ----------

  parseBlock() {
    if (this.accept('NEWLINE')) {
      this.expect('INDENT', undefined, 'expected an indented block');
      const body = [];
      while (!this.at('DEDENT') && !this.at('EOF')) {
        if (this.accept('NEWLINE')) continue;
        body.push(...this.parseStatement());
      }
      this.expect('DEDENT');
      return body;
    }
    // Inline suite: `if x: y = 1; z = 2`
    return this.parseSimpleStatements();
  }

  // Handles both `if` and `elif` (the latter recurses as a nested If node).
  parseIf(kw = 'if') {
    const line = this.peek().line;
    this.expectKw(kw);
    const test = this.parseNamedExpr();
    this.expectOp(':');
    const body = this.parseBlock();
    let orelse = [];
    if (this.atKw('elif')) {
      orelse = [this.parseIf('elif')];
    } else if (this.acceptKw('else')) {
      this.expectOp(':');
      orelse = this.parseBlock();
    }
    return { type: 'If', test, body, orelse, line };
  }

  parseWhile() {
    const line = this.peek().line;
    this.expectKw('while');
    const test = this.parseNamedExpr();
    this.expectOp(':');
    const body = this.parseBlock();
    let orelse = [];
    if (this.acceptKw('else')) {
      this.expectOp(':');
      orelse = this.parseBlock();
    }
    return { type: 'While', test, body, orelse, line };
  }

  parseFor() {
    const line = this.peek().line;
    this.expectKw('for');
    const target = this.toTarget(this.parseTargetList(), 'assign');
    this.expectKw('in');
    const iter = this.parseTestListStar();
    this.expectOp(':');
    const body = this.parseBlock();
    let orelse = [];
    if (this.acceptKw('else')) {
      this.expectOp(':');
      orelse = this.parseBlock();
    }
    return { type: 'For', target, iter, body, orelse, line };
  }

  parseTargetList() {
    const line = this.peek().line;
    const first = this.parseTargetItem();
    if (!this.atOp(',')) return first;
    const elts = [first];
    while (this.acceptOp(',')) {
      if (this.atKw('in') || this.atOp(':') || this.atOp('=')) break;
      elts.push(this.parseTargetItem());
    }
    return { type: 'Tuple', elts, line };
  }

  parseTargetItem() {
    if (this.atOp('*')) {
      const line = this.next().line;
      return { type: 'Starred', value: this.parsePostfix(), line };
    }
    return this.parsePostfix();
  }

  parseTry() {
    const line = this.peek().line;
    this.expectKw('try');
    this.expectOp(':');
    const body = this.parseBlock();
    const handlers = [];
    let orelse = [];
    let finalbody = [];
    while (this.atKw('except')) {
      const hline = this.next().line;
      let excType = null, name = null;
      if (this.atOp('*')) this.err("except* is not supported");
      if (!this.atOp(':')) {
        excType = this.parseTest();
        if (this.acceptKw('as')) name = this.expectName();
      }
      this.expectOp(':');
      const hbody = this.parseBlock();
      handlers.push({ excType, name, body: hbody, line: hline });
    }
    if (this.acceptKw('else')) {
      this.expectOp(':');
      orelse = this.parseBlock();
    }
    if (this.acceptKw('finally')) {
      this.expectOp(':');
      finalbody = this.parseBlock();
    }
    if (handlers.length === 0 && finalbody.length === 0) {
      this.err("expected 'except' or 'finally' block");
    }
    return { type: 'Try', body, handlers, orelse, finalbody, line };
  }

  parseWith() {
    const line = this.peek().line;
    this.expectKw('with');
    const items = [];
    do {
      const ctx = this.parseTest();
      let optionalVars = null;
      if (this.acceptKw('as')) {
        optionalVars = this.toTarget(this.parseTargetItem(), 'assign');
      }
      items.push({ ctx, optionalVars });
    } while (this.acceptOp(','));
    this.expectOp(':');
    const body = this.parseBlock();
    return { type: 'With', items, body, line };
  }

  parseDecorated() {
    const decorators = [];
    while (this.acceptOp('@')) {
      decorators.push(this.parseNamedExpr());
      this.expect('NEWLINE');
      while (this.accept('NEWLINE'));
    }
    if (this.atKw('def')) return this.parseFunctionDef(decorators);
    if (this.atKw('class')) return this.parseClassDef(decorators);
    this.err('invalid decorator target');
  }

  parseFunctionDef(decorators) {
    const line = this.peek().line;
    this.expectKw('def');
    const name = this.expectName();
    this.expectOp('(');
    const params = this.parseParams(')');
    this.expectOp(')');
    if (this.acceptOp('->')) this.parseTest(); // return annotation, ignored
    this.expectOp(':');
    const body = this.parseBlock();
    return { type: 'FunctionDef', name, params, body, decorators, line };
  }

  parseParams(endTok) {
    // Returns {posOnly:[], pos:[{name, default}], varArg, kwOnly:[{name, default}], kwArg}
    // In a lambda (endTok === ':'), parameter annotations are not allowed: a ':'
    // there is the lambda body separator, not an annotation.
    const params = { posOnly: [], pos: [], varArg: null, kwOnly: [], kwArg: null };
    const allowAnnotations = endTok !== ':';
    let seenDefault = false;
    let afterStar = false;
    for (;;) {
      if (this.atOp(endTok) || this.atOp(':')) break;
      if (this.acceptOp('/')) {
        params.posOnly = params.pos;
        params.pos = [];
        if (!this.acceptOp(',')) break;
        continue;
      }
      if (this.acceptOp('*')) {
        if (afterStar) this.err('invalid syntax');
        afterStar = true;
        if (this.at('NAME')) {
          params.varArg = this.expectName();
          if (allowAnnotations && this.acceptOp(':')) this.parseTest();
        }
        if (!this.acceptOp(',')) break;
        continue;
      }
      if (this.acceptOp('**')) {
        params.kwArg = this.expectName();
        if (allowAnnotations && this.acceptOp(':')) this.parseTest();
        this.acceptOp(',');
        break;
      }
      const pname = this.expectName();
      if (allowAnnotations && this.acceptOp(':')) this.parseTest(); // annotation, ignored
      let def = null;
      if (this.acceptOp('=')) {
        def = this.parseTest();
        seenDefault = true;
      } else if (seenDefault && !afterStar) {
        this.err('parameter without a default follows parameter with a default');
      }
      if (afterStar) params.kwOnly.push({ name: pname, default: def });
      else params.pos.push({ name: pname, default: def });
      if (!this.acceptOp(',')) break;
    }
    return params;
  }

  parseClassDef(decorators) {
    const line = this.peek().line;
    this.expectKw('class');
    const name = this.expectName();
    const bases = [];
    const keywords = [];
    if (this.acceptOp('(')) {
      while (!this.atOp(')')) {
        if (this.at('NAME') && this.peek(1) && this.peek(1).type === 'OP' && this.peek(1).value === '=') {
          const kwName = this.expectName();
          this.expectOp('=');
          keywords.push({ name: kwName, value: this.parseTest() });
        } else if (this.acceptOp('**')) {
          this.parseTest(); // **kwargs in class def: ignored
        } else {
          bases.push(this.parseTest());
        }
        if (!this.acceptOp(',')) break;
      }
      this.expectOp(')');
    }
    this.expectOp(':');
    const body = this.parseBlock();
    return { type: 'ClassDef', name, bases, keywords, body, decorators, line };
  }

  // ---------- expressions ----------

  // testlist (or star-expr list) where a bare `yield` expression is also allowed.
  parseTestListStarAllowYield() {
    if (this.atKw('yield')) return this.parseYield();
    return this.parseTestListStar();
  }

  parseYield() {
    const line = this.expectKw('yield').line;
    if (this.acceptKw('from')) {
      const value = this.parseTest();
      return { type: 'YieldFrom', value, line };
    }
    let value = null;
    if (!this.at('NEWLINE') && !this.atOp(')') && !this.atOp(']') && !this.atOp('}') &&
        !this.atOp(';') && !this.atOp(',') && !this.atOp(':') && !this.at('EOF') && !this.at('DEDENT')) {
      value = this.parseTestListStar();
    }
    return { type: 'Yield', value, line };
  }

  // testlist_star_expr: (test|star_expr) (',' (test|star_expr))* [',']
  parseTestListStar() {
    const line = this.peek().line;
    const first = this.parseTestOrStar();
    if (!this.atOp(',')) return first;
    const elts = [first];
    let trailing = false;
    while (this.acceptOp(',')) {
      if (this.at('NEWLINE') || this.atOp('=') || this.atOp(')') || this.atOp(']') ||
          this.atOp('}') || this.atOp(':') || this.atOp(';') || this.at('EOF') || this.at('DEDENT')) {
        trailing = true;
        break;
      }
      elts.push(this.parseTestOrStar());
    }
    return { type: 'Tuple', elts, line, trailing };
  }

  parseTestOrStar() {
    if (this.atOp('*')) {
      const line = this.next().line;
      return { type: 'Starred', value: this.parseOr(), line };
    }
    return this.parseTest();
  }

  parseNamedExpr() {
    const expr = this.parseTest();
    if (this.atOp(':=')) {
      const line = this.next().line;
      if (expr.type !== 'Name') this.err('cannot use assignment expressions with this target');
      const value = this.parseTest();
      return { type: 'NamedExpr', target: expr, value, line };
    }
    return expr;
  }

  parseTest() {
    if (this.atKw('lambda')) return this.parseLambda();
    const line = this.peek().line;
    const expr = this.parseOr();
    if (this.atKw('if')) {
      // Conditional expression — but beware of comprehension 'if' (handled by callers
      // that stop before 'if'... in Python, `x if y else z` requires else).
      this.next();
      const test = this.parseOr();
      this.expectKw('else');
      const orelse = this.parseTest();
      return { type: 'IfExp', test, body: expr, orelse, line };
    }
    if (this.atOp(':=')) {
      const l2 = this.next().line;
      if (expr.type !== 'Name') this.err('cannot use assignment expressions with this target');
      const value = this.parseTest();
      return { type: 'NamedExpr', target: expr, value, line: l2 };
    }
    return expr;
  }

  parseLambda() {
    const line = this.expectKw('lambda').line;
    const params = this.parseParams(':');
    this.expectOp(':');
    const body = this.parseTest();
    return { type: 'Lambda', params, body, line };
  }

  parseOr() {
    let left = this.parseAnd();
    if (!this.atKw('or')) return left;
    const values = [left];
    const line = this.peek().line;
    while (this.acceptKw('or')) values.push(this.parseAnd());
    return { type: 'BoolOp', op: 'or', values, line };
  }

  parseAnd() {
    let left = this.parseNot();
    if (!this.atKw('and')) return left;
    const values = [left];
    const line = this.peek().line;
    while (this.acceptKw('and')) values.push(this.parseNot());
    return { type: 'BoolOp', op: 'and', values, line };
  }

  parseNot() {
    if (this.atKw('not')) {
      const line = this.next().line;
      return { type: 'UnaryOp', op: 'not', operand: this.parseNot(), line };
    }
    return this.parseComparison();
  }

  parseComparison() {
    const line = this.peek().line;
    let left = this.parseBitOr();
    const ops = [];
    const comparators = [];
    for (;;) {
      let op = null;
      if (this.atOp('<')) op = '<';
      else if (this.atOp('>')) op = '>';
      else if (this.atOp('<=')) op = '<=';
      else if (this.atOp('>=')) op = '>=';
      else if (this.atOp('==')) op = '==';
      else if (this.atOp('!=')) op = '!=';
      else if (this.atKw('in')) op = 'in';
      else if (this.atKw('is')) {
        this.next();
        op = this.acceptKw('not') ? 'is not' : 'is';
        ops.push(op);
        comparators.push(this.parseBitOr());
        continue;
      } else if (this.atKw('not')) {
        if (this.peek(1) && this.peek(1).type === 'KEYWORD' && this.peek(1).value === 'in') {
          this.next(); this.next();
          ops.push('not in');
          comparators.push(this.parseBitOr());
          continue;
        }
        break;
      } else break;
      this.next();
      ops.push(op);
      comparators.push(this.parseBitOr());
    }
    if (ops.length === 0) return left;
    return { type: 'Compare', left, ops, comparators, line };
  }

  parseBitOr() {
    let left = this.parseBitXor();
    while (this.atOp('|')) {
      const line = this.next().line;
      left = { type: 'BinOp', op: '|', left, right: this.parseBitXor(), line };
    }
    return left;
  }

  parseBitXor() {
    let left = this.parseBitAnd();
    while (this.atOp('^')) {
      const line = this.next().line;
      left = { type: 'BinOp', op: '^', left, right: this.parseBitAnd(), line };
    }
    return left;
  }

  parseBitAnd() {
    let left = this.parseShift();
    while (this.atOp('&')) {
      const line = this.next().line;
      left = { type: 'BinOp', op: '&', left, right: this.parseShift(), line };
    }
    return left;
  }

  parseShift() {
    let left = this.parseArith();
    while (this.atOp('<<') || this.atOp('>>')) {
      const t = this.next();
      left = { type: 'BinOp', op: t.value, left, right: this.parseArith(), line: t.line };
    }
    return left;
  }

  parseArith() {
    let left = this.parseTerm();
    while (this.atOp('+') || this.atOp('-')) {
      const t = this.next();
      left = { type: 'BinOp', op: t.value, left, right: this.parseTerm(), line: t.line };
    }
    return left;
  }

  parseTerm() {
    let left = this.parseFactor();
    while (this.atOp('*') || this.atOp('/') || this.atOp('//') || this.atOp('%') || this.atOp('@')) {
      const t = this.next();
      left = { type: 'BinOp', op: t.value, left, right: this.parseFactor(), line: t.line };
    }
    return left;
  }

  parseFactor() {
    if (this.atOp('+') || this.atOp('-') || this.atOp('~')) {
      const t = this.next();
      return { type: 'UnaryOp', op: t.value, operand: this.parseFactor(), line: t.line };
    }
    return this.parsePower();
  }

  parsePower() {
    const base = this.parsePostfix();
    if (this.atOp('**')) {
      const line = this.next().line;
      const exp = this.parseFactor(); // right-associative; binds unary on the right
      return { type: 'BinOp', op: '**', left: base, right: exp, line };
    }
    return base;
  }

  parsePostfix() {
    let expr = this.parseAtom();
    for (;;) {
      if (this.atOp('(')) {
        const line = this.next().line;
        const args = this.parseCallArgs();
        this.expectOp(')');
        expr = { type: 'Call', func: expr, args, line };
      } else if (this.atOp('[')) {
        const line = this.next().line;
        const index = this.parseSubscript();
        this.expectOp(']');
        expr = { type: 'Subscript', obj: expr, index, line };
      } else if (this.atOp('.')) {
        const line = this.next().line;
        const name = this.expectName();
        expr = { type: 'Attribute', obj: expr, attr: name, line };
      } else {
        return expr;
      }
    }
  }

  parseCallArgs() {
    const args = [];
    let sawKw = false;
    while (!this.atOp(')')) {
      const line = this.peek().line;
      if (this.acceptOp('*')) {
        args.push({ kind: 'star', value: this.parseTest(), line });
      } else if (this.acceptOp('**')) {
        args.push({ kind: 'dstar', value: this.parseTest(), line });
        sawKw = true;
      } else if (this.at('NAME') && this.peek(1) && this.peek(1).type === 'OP' && this.peek(1).value === '=') {
        const name = this.next().value;
        this.next(); // '='
        args.push({ kind: 'kw', name, value: this.parseTest(), line });
        sawKw = true;
      } else {
        const value = this.parseNamedExpr();
        // Generator expression argument: f(x for x in y)
        if (this.atKw('for') && args.length === 0) {
          const gen = this.parseComprehensionTail(value, 'GeneratorExp');
          args.push({ kind: 'pos', value: gen, line });
          break;
        }
        if (sawKw) this.err('positional argument follows keyword argument');
        args.push({ kind: 'pos', value, line });
      }
      if (!this.acceptOp(',')) break;
    }
    return args;
  }

  parseSubscript() {
    // Possibly a slice, possibly a tuple of items/slices.
    const items = [];
    let isTuple = false;
    do {
      if (this.atOp(']')) { isTuple = true; break; }
      items.push(this.parseSubscriptItem());
      if (this.atOp(',')) isTuple = true;
    } while (this.acceptOp(','));
    if (items.length === 1 && !isTuple) return items[0];
    return { type: 'Tuple', elts: items, line: items.length ? items[0].line : 0 };
  }

  parseSubscriptItem() {
    const line = this.peek().line;
    let lower = null, upper = null, step = null;
    if (!this.atOp(':')) {
      if (this.atOp('*')) {
        this.next();
        return { type: 'Starred', value: this.parseOr(), line };
      }
      lower = this.parseTest();
      if (!this.atOp(':')) return lower;
    }
    this.expectOp(':');
    if (!this.atOp(':') && !this.atOp(']') && !this.atOp(',')) {
      upper = this.parseTest();
    }
    if (this.acceptOp(':')) {
      if (!this.atOp(']') && !this.atOp(',')) step = this.parseTest();
    }
    return { type: 'Slice', lower, upper, step, line };
  }

  parseAtom() {
    const t = this.peek();
    if (!t || t.type === 'EOF') this.err('unexpected EOF while parsing');
    const line = t.line;

    if (t.type === 'NUMBER') {
      this.next();
      if (t.value.kind === 'int') {
        const text = t.value.text.replace(/_/g, '');
        return { type: 'Num', value: BigInt(text), line };
      }
      return { type: 'Num', value: parseFloat(t.value.text.replace(/_/g, '')), line };
    }

    if (t.type === 'STRING' || t.type === 'FSTRING') {
      // Adjacent string concatenation, possibly mixing plain and f-strings.
      const pieces = [];
      let anyF = false;
      let anyBytes = false;
      while (this.at('STRING') || this.at('FSTRING')) {
        const tok = this.next();
        if (tok.type === 'FSTRING') {
          anyF = true;
          pieces.push({ f: true, parts: tok.value.parts });
        } else {
          if (tok.value.bytes) anyBytes = true;
          pieces.push({ f: false, value: tok.value.value });
        }
      }
      if (anyBytes) {
        if (anyF) this.err('cannot mix bytes and nonbytes literals');
        const value = pieces.map((p) => p.value).join('');
        return { type: 'Bytes', value, line };
      }
      if (!anyF) {
        return { type: 'Str', value: pieces.map((p) => p.value).join(''), line };
      }
      // Merge into a single FString node.
      const parts = [];
      for (const p of pieces) {
        if (p.f) {
          for (const part of p.parts) {
            if (part.type === 'str') parts.push(part);
            else parts.push(this.compileFStringExpr(part));
          }
        } else if (p.value) {
          parts.push({ type: 'str', value: p.value });
        }
      }
      return { type: 'FString', parts, line };
    }

    if (t.type === 'NAME') {
      this.next();
      return { type: 'Name', id: t.value, line };
    }

    if (t.type === 'KEYWORD') {
      switch (t.value) {
        case 'True': this.next(); return { type: 'Const', value: true, line };
        case 'False': this.next(); return { type: 'Const', value: false, line };
        case 'None': this.next(); return { type: 'Const', value: null, line };
        case 'lambda': return this.parseLambda();
        case 'not': return this.parseNot();
        case 'yield': return this.parseYield();
        case 'await': this.err("'await' is not supported");
      }
      this.err('invalid syntax');
    }

    if (t.type === 'OP') {
      if (t.value === '(') {
        this.next();
        if (this.acceptOp(')')) return { type: 'Tuple', elts: [], line };
        if (this.atKw('yield')) {
          const y = this.parseYield();
          this.expectOp(')');
          return y;
        }
        const first = this.parseNamedExprOrStar();
        if (this.atKw('for')) {
          const gen = this.parseComprehensionTail(first, 'GeneratorExp');
          this.expectOp(')');
          return gen;
        }
        if (this.atOp(',')) {
          const elts = [first];
          while (this.acceptOp(',')) {
            if (this.atOp(')')) break;
            elts.push(this.parseNamedExprOrStar());
          }
          this.expectOp(')');
          return { type: 'Tuple', elts, line };
        }
        this.expectOp(')');
        // Parenthesized expression: mark so toTarget treats (a) correctly.
        return first;
      }
      if (t.value === '[') {
        this.next();
        if (this.acceptOp(']')) return { type: 'List', elts: [], line };
        const first = this.parseNamedExprOrStar();
        if (this.atKw('for')) {
          const comp = this.parseComprehensionTail(first, 'ListComp');
          this.expectOp(']');
          return comp;
        }
        const elts = [first];
        while (this.acceptOp(',')) {
          if (this.atOp(']')) break;
          elts.push(this.parseNamedExprOrStar());
        }
        this.expectOp(']');
        return { type: 'List', elts, line };
      }
      if (t.value === '{') {
        this.next();
        return this.parseDictOrSet(line);
      }
      if (t.value === '...') {
        this.next();
        return { type: 'Ellipsis', line };
      }
      if (t.value === '-' || t.value === '+' || t.value === '~') {
        return this.parseFactor();
      }
    }
    this.err('invalid syntax');
  }

  parseNamedExprOrStar() {
    if (this.atOp('*')) {
      const line = this.next().line;
      return { type: 'Starred', value: this.parseOr(), line };
    }
    return this.parseNamedExpr();
  }

  parseDictOrSet(line) {
    if (this.acceptOp('}')) return { type: 'Dict', keys: [], values: [], line };
    if (this.acceptOp('**')) {
      const keys = [null];
      const values = [this.parseOr()];
      while (this.acceptOp(',')) {
        if (this.atOp('}')) break;
        if (this.acceptOp('**')) {
          keys.push(null);
          values.push(this.parseOr());
        } else {
          keys.push(this.parseTest());
          this.expectOp(':');
          values.push(this.parseTest());
        }
      }
      this.expectOp('}');
      return { type: 'Dict', keys, values, line };
    }
    const first = this.atOp('*')
      ? (() => { this.next(); return { type: 'Starred', value: this.parseOr(), line }; })()
      : this.parseNamedExpr();
    if (this.atOp(':') && first.type !== 'Starred') {
      this.next();
      const firstVal = this.parseTest();
      if (this.atKw('for')) {
        const comp = this.parseComprehensionTail({ key: first, value: firstVal }, 'DictComp');
        this.expectOp('}');
        return comp;
      }
      const keys = [first];
      const values = [firstVal];
      while (this.acceptOp(',')) {
        if (this.atOp('}')) break;
        if (this.acceptOp('**')) {
          keys.push(null);
          values.push(this.parseOr());
        } else {
          keys.push(this.parseTest());
          this.expectOp(':');
          values.push(this.parseTest());
        }
      }
      this.expectOp('}');
      return { type: 'Dict', keys, values, line };
    }
    if (this.atKw('for')) {
      const comp = this.parseComprehensionTail(first, 'SetComp');
      this.expectOp('}');
      return comp;
    }
    const elts = [first];
    while (this.acceptOp(',')) {
      if (this.atOp('}')) break;
      elts.push(this.parseNamedExprOrStar());
    }
    this.expectOp('}');
    return { type: 'Set', elts, line };
  }

  parseComprehensionTail(elt, type) {
    const line = this.peek().line;
    const generators = [];
    while (this.atKw('for')) {
      this.next();
      const target = this.toTarget(this.parseTargetList(), 'assign');
      this.expectKw('in');
      const iter = this.parseOr();
      const ifs = [];
      while (this.atKw('if')) {
        this.next();
        ifs.push(this.parseOrNamedNoCondExpr());
      }
      generators.push({ target, iter, ifs });
    }
    if (type === 'DictComp') {
      return { type, key: elt.key, value: elt.value, generators, line };
    }
    return { type, elt, generators, line };
  }

  parseOrNamedNoCondExpr() {
    // Condition in a comprehension: or_test, optionally a walrus.
    const expr = this.parseOr();
    if (this.atOp(':=')) {
      const line = this.next().line;
      if (expr.type !== 'Name') this.err('cannot use assignment expressions with this target');
      return { type: 'NamedExpr', target: expr, value: this.parseTest(), line };
    }
    return expr;
  }

  // Compile an f-string {expr} part: parse code into an AST.
  compileFStringExpr(part) {
    const sub = parseExpression(part.code, this.filename, part.line);
    let spec = null;
    if (part.spec) {
      spec = part.spec.map((p) => (p.type === 'str' ? p : this.compileFStringExpr(p)));
    }
    return {
      type: 'fexpr',
      expr: sub,
      conv: part.conv,
      spec,
      selfDoc: part.selfDoc,
      selfDocText: part.selfDocText,
      code: part.code,
    };
  }
}

// ---------- scope analysis ----------
// Annotates Module / FunctionDef / Lambda / comprehension nodes with:
//   scopeInfo = { locals: Set|null, globals: Set, nonlocals: Set, isGenerator: bool }
// Module scope has locals === null (assignments go to globals).

class ScopeRecord {
  constructor(kind) {
    this.kind = kind; // 'module' | 'function' | 'class' | 'comprehension'
    this.assigned = new Set();
    this.globals = new Set();
    this.nonlocals = new Set();
    this.isGenerator = false;
  }
}

export function analyzeScopes(moduleNode, filename) {
  const stack = [];

  function current() { return stack[stack.length - 1]; }

  function nearestFunctionLike() {
    // For walrus in comprehensions: binds in the nearest enclosing non-comprehension scope.
    for (let i = stack.length - 1; i >= 0; i--) {
      if (stack[i].kind !== 'comprehension') return stack[i];
    }
    return stack[0];
  }

  function addAssigned(name) {
    const s = current();
    if (!s.globals.has(name) && !s.nonlocals.has(name)) s.assigned.add(name);
  }

  function visitTarget(node) {
    if (!node) return;
    switch (node.type) {
      case 'Name': addAssigned(node.id); break;
      case 'Tuple': case 'List': node.elts.forEach(visitTarget); break;
      case 'Starred': visitTarget(node.value); break;
      case 'Attribute': visit(node.obj); break;
      case 'Subscript': visit(node.obj); visitIndex(node.index); break;
    }
  }

  function visitIndex(idx) {
    if (!idx) return;
    if (idx.type === 'Slice') { visit(idx.lower); visit(idx.upper); visit(idx.step); }
    else visit(idx);
  }

  function withScope(kind, node, fn) {
    const rec = new ScopeRecord(kind);
    stack.push(rec);
    fn();
    stack.pop();
    node.scopeInfo = {
      locals: kind === 'module' ? null : rec.assigned,
      globals: rec.globals,
      nonlocals: rec.nonlocals,
      isGenerator: rec.isGenerator,
      isClass: kind === 'class',
    };
  }

  function visitParamsAndBody(node) {
    const { params, body } = node;
    for (const p of [...(params.posOnly || []), ...params.pos]) {
      addAssigned(p.name);
    }
    for (const p of params.kwOnly) addAssigned(p.name);
    if (params.varArg) addAssigned(params.varArg);
    if (params.kwArg) addAssigned(params.kwArg);
    if (Array.isArray(body)) body.forEach(visitStmt);
    else visit(body); // lambda
  }

  function visitFunction(node, kind) {
    // Defaults and decorators evaluate in the enclosing scope.
    const { params } = node;
    for (const p of [...(params.posOnly || []), ...params.pos, ...params.kwOnly]) {
      if (p.default) visit(p.default);
    }
    if (node.decorators) node.decorators.forEach(visit);
    withScope(kind, node, () => visitParamsAndBody(node));
  }

  function visitComprehension(node) {
    // First iterable evaluates in enclosing scope.
    const gens = node.generators;
    visit(gens[0].iter);
    withScope('comprehension', node, () => {
      for (let i = 0; i < gens.length; i++) {
        visitTarget(gens[i].target);
        if (i > 0) visit(gens[i].iter);
        gens[i].ifs.forEach(visit);
      }
      if (node.type === 'DictComp') { visit(node.key); visit(node.value); }
      else visit(node.elt);
    });
  }

  function visitStmt(node) {
    if (!node) return;
    switch (node.type) {
      case 'ExprStmt': visit(node.value); break;
      case 'Assign':
        visit(node.value);
        node.targets.forEach(visitTarget);
        break;
      case 'AnnDecl': visitTarget(node.target); break;
      case 'AugAssign': visit(node.value); visit(node.target); visitTarget(node.target); break;
      case 'If': visit(node.test); node.body.forEach(visitStmt); node.orelse.forEach(visitStmt); break;
      case 'While': visit(node.test); node.body.forEach(visitStmt); node.orelse.forEach(visitStmt); break;
      case 'For':
        visit(node.iter);
        visitTarget(node.target);
        node.body.forEach(visitStmt);
        node.orelse.forEach(visitStmt);
        break;
      case 'FunctionDef':
        addAssigned(node.name);
        visitFunction(node, 'function');
        break;
      case 'ClassDef':
        addAssigned(node.name);
        node.bases.forEach(visit);
        (node.keywords || []).forEach((k) => visit(k.value));
        (node.decorators || []).forEach(visit);
        withScope('class', node, () => node.body.forEach(visitStmt));
        break;
      case 'Return': visit(node.value); break;
      case 'Delete': node.targets.forEach((t) => {
        if (t.type === 'Name') addAssigned(t.id);
        else visitTarget(t);
      }); break;
      case 'Try':
        node.body.forEach(visitStmt);
        for (const h of node.handlers) {
          visit(h.excType);
          if (h.name) addAssigned(h.name);
          h.body.forEach(visitStmt);
        }
        node.orelse.forEach(visitStmt);
        node.finalbody.forEach(visitStmt);
        break;
      case 'With':
        for (const item of node.items) {
          visit(item.ctx);
          if (item.optionalVars) visitTarget(item.optionalVars);
        }
        node.body.forEach(visitStmt);
        break;
      case 'Raise': visit(node.exc); visit(node.cause); break;
      case 'Assert': visit(node.test); visit(node.msg); break;
      case 'Import':
        for (const n of node.names) {
          addAssigned(n.asname || n.name.split('.')[0]);
        }
        break;
      case 'ImportFrom':
        if (node.names !== '*') {
          for (const n of node.names) addAssigned(n.asname || n.name);
        }
        break;
      case 'Global':
        for (const n of node.names) {
          current().globals.add(n);
          current().assigned.delete(n);
        }
        break;
      case 'Nonlocal':
        for (const n of node.names) {
          current().nonlocals.add(n);
          current().assigned.delete(n);
        }
        break;
      case 'Pass': case 'Break': case 'Continue': break;
      default: break;
    }
  }

  function visit(node) {
    if (!node) return;
    switch (node.type) {
      case 'Num': case 'Str': case 'Const': case 'Ellipsis': case 'Bytes': break;
      case 'Name': break;
      case 'FString':
        for (const p of node.parts) {
          if (p.type === 'fexpr') {
            visit(p.expr);
            if (p.spec) p.spec.forEach((sp) => { if (sp.type === 'fexpr') visit(sp.expr); });
          }
        }
        break;
      case 'Tuple': case 'List': case 'Set': node.elts.forEach(visit); break;
      case 'Dict':
        node.keys.forEach((k) => visit(k));
        node.values.forEach(visit);
        break;
      case 'BinOp': visit(node.left); visit(node.right); break;
      case 'UnaryOp': visit(node.operand); break;
      case 'BoolOp': node.values.forEach(visit); break;
      case 'Compare': visit(node.left); node.comparators.forEach(visit); break;
      case 'Call':
        visit(node.func);
        node.args.forEach((a) => visit(a.value));
        break;
      case 'Attribute': visit(node.obj); break;
      case 'Subscript': visit(node.obj); visitIndex(node.index); break;
      case 'Slice': visit(node.lower); visit(node.upper); visit(node.step); break;
      case 'IfExp': visit(node.test); visit(node.body); visit(node.orelse); break;
      case 'Lambda': visitFunction(node, 'function'); break;
      case 'ListComp': case 'SetComp': case 'GeneratorExp': case 'DictComp':
        visitComprehension(node);
        break;
      case 'Yield': case 'YieldFrom': {
        visit(node.value);
        // Mark the nearest function as a generator.
        let found = false;
        for (let i = stack.length - 1; i >= 0; i--) {
          if (stack[i].kind === 'function') { stack[i].isGenerator = true; found = true; break; }
          if (stack[i].kind !== 'comprehension') break;
        }
        if (!found) {
          throw new PySyntaxError("'yield' outside function", filename, node.line, 0);
        }
        break;
      }
      case 'NamedExpr': {
        visit(node.value);
        // Walrus binds in nearest non-comprehension scope.
        const s = nearestFunctionLike();
        if (!s.globals.has(node.target.id) && !s.nonlocals.has(node.target.id)) {
          s.assigned.add(node.target.id);
        }
        break;
      }
      case 'Starred': visit(node.value); break;
      default: break;
    }
  }

  withScope('module', moduleNode, () => moduleNode.body.forEach(visitStmt));
  return moduleNode;
}

// ---------- public API ----------

export function parse(source, filename = '<string>') {
  const tokens = tokenize(source, filename);
  const parser = new Parser(tokens, filename);
  const mod = parser.parseModule();
  analyzeScopes(mod, filename);
  return mod;
}

// Parse a single expression (used by f-strings and the REPL).
export function parseExpression(source, filename = '<fstring>', lineOffset = 1) {
  const tokens = tokenize(source.trim(), filename);
  const parser = new Parser(tokens, filename);
  const expr = parser.parseTestListStar();
  if (!parser.at('NEWLINE') && !parser.at('EOF')) {
    parser.err('invalid syntax in f-string expression');
  }
  // Adjust line numbers roughly to the host line.
  const fix = (n) => {
    if (!n || typeof n !== 'object') return;
    if (typeof n.line === 'number') n.line = lineOffset;
    for (const k of Object.keys(n)) {
      const v = n[k];
      if (Array.isArray(v)) v.forEach(fix);
      else if (v && typeof v === 'object') fix(v);
    }
  };
  fix(expr);
  return expr;
}
