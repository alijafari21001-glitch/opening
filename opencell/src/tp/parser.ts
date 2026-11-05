// Teach pendant (TP) line parser. One source line -> tokens (with editor roles) + a statement AST.
// The syntax follows FANUC TP / .LS conventions (without the leading line number and trailing ';').

export type Idx = number | { reg: 'R' | 'AR'; n: number } | null; // null = "..." placeholder

export type Role =
  | 'motype' | 'target' | 'speed' | 'unit' | 'term' | 'cnt' | 'option'
  | 'index' | 'value' | 'ioval' | 'op' | 'cmp' | 'logic' | 'prog' | 'text' | 'kw' | 'dir' | 'pulse' | 'timer';

export interface Tok {
  k: 'ident' | 'num' | 'ref' | 'op' | 'unit' | 'ph' | 'text';
  v: string; s: number; e: number;
  name?: string; idx?: Idx; idx2?: number | null; cmt?: string;
  /** span of the first index inside brackets (for numeric editing) */
  is?: number; ie?: number;
  role?: Role;
}

export type RefPort = 'R' | 'PR' | 'P' | 'AR' | 'DI' | 'DO' | 'RI' | 'RO' | 'UI' | 'UO' | 'SI' | 'SO' | 'F' | 'GI' | 'GO' | 'AI' | 'AO' | 'TIMER' | 'SR' | 'M';

export type Expr =
  | { k: 'num'; v: number }
  | { k: 'bool'; v: boolean }
  | { k: 'ref'; port: RefPort; idx: Idx; idx2?: number | null }
  | { k: 'sys'; name: string }
  | { k: 'lpos' } | { k: 'jpos' }
  | { k: 'ph' }
  | { k: 'neg'; a: Expr }
  | { k: 'not'; a: Expr }
  | { k: 'bin'; op: string; a: Expr; b: Expr };

export interface PosRef { reg: 'P' | 'PR'; idx: Idx }

export type Speed = { v: number | Expr; unit: string };
export type Term = { fine: true } | { fine: false; cnt: number | Expr };

export type Stmt =
  | { k: 'blank' }
  | { k: 'remark'; text: string }
  | { k: 'disabled'; text: string }
  | { k: 'motion'; type: 'J' | 'L' | 'C'; target: PosRef; via?: PosRef; speed: Speed; term: Term;
      offset?: { kind: 'Offset' | 'Tool_Offset'; pr: Idx | undefined }; opts: string[] }
  | { k: 'label'; n: Idx; cmt?: string }
  | { k: 'jmp'; n: Idx }
  | { k: 'call'; prog: string; args: Expr[] }
  | { k: 'assign'; port: RefPort | 'SYS'; idx: Idx; idx2?: number | null; sys?: string; expr: Expr }
  | { k: 'pulse'; port: RefPort; idx: Idx; width?: number }
  | { k: 'frame_num'; which: 'UFRAME_NUM' | 'UTOOL_NUM'; expr: Expr }
  | { k: 'frame_set'; which: 'UFRAME' | 'UTOOL'; n: Idx; expr: Expr }
  | { k: 'override'; v: Expr }
  | { k: 'payload'; n: Idx }
  | { k: 'timer'; n: Idx; op: 'START' | 'STOP' | 'RESET' }
  | { k: 'offset_cond'; kind: 'Offset' | 'Tool_Offset'; pr: Idx }
  | { k: 'wait_time'; t: Expr }
  | { k: 'wait'; cond: Expr; timeoutLbl?: Idx }
  | { k: 'if'; cond: Expr; then: Stmt }
  | { k: 'if_then'; cond: Expr }
  | { k: 'else' } | { k: 'endif' }
  | { k: 'select'; reg: Idx; v: Expr; then: Stmt }
  | { k: 'case'; v: Expr; then: Stmt }
  | { k: 'case_else'; then: Stmt }
  | { k: 'for'; reg: Idx; from: Expr; to: Expr; down: boolean }
  | { k: 'endfor' }
  | { k: 'end' } | { k: 'abort' } | { k: 'pause' }
  | { k: 'message'; text: string };

export class ParseError extends Error {
  constructor(msg: string, public pos: number) { super(msg); }
}

export const SPEED_UNITS = ['%', 'mm/sec', 'cm/min', 'inch/min', 'deg/sec', 'sec', 'msec'];
const PORTS: RefPort[] = ['R', 'PR', 'P', 'AR', 'DI', 'DO', 'RI', 'RO', 'UI', 'UO', 'SI', 'SO', 'F', 'GI', 'GO', 'AI', 'AO', 'TIMER', 'SR', 'M'];
export const IO_PORTS: RefPort[] = ['DI', 'DO', 'RI', 'RO', 'UI', 'UO', 'SI', 'SO', 'F', 'GI', 'GO', 'AI', 'AO'];
export const OUT_PORTS: RefPort[] = ['DO', 'RO', 'UO', 'SO', 'F', 'GO', 'AO'];

// ---------------------------------------------------------------- lexer

export function lex(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === ' ' || c === '\t') { i++; continue; }
    if (src.startsWith('...', i)) { out.push({ k: 'ph', v: '...', s: i, e: i + 3 }); i += 3; continue; }
    const prev = out[out.length - 1];
    // Units directly after a number or inside "(sec)"
    const unitCtx = prev && (prev.k === 'num' || prev.k === 'ref' || prev.k === 'ph' || (prev.k === 'op' && prev.v === '('));
    if (unitCtx) {
      const m = /^(mm\/sec|cm\/min|inch\/min|deg\/sec|msec|sec|%)/.exec(src.slice(i));
      if (m) { out.push({ k: 'unit', v: m[1], s: i, e: i + m[1].length }); i += m[1].length; continue; }
    }
    if (/[0-9.]/.test(c) && !(c === '.' && !/[0-9]/.test(src[i + 1] ?? ''))) {
      const m = /^[0-9]*\.?[0-9]*/.exec(src.slice(i))!;
      out.push({ k: 'num', v: m[0], s: i, e: i + m[0].length });
      i += m[0].length;
      continue;
    }
    if (/[A-Za-z_$]/.test(c)) {
      const m = /^[A-Za-z_$][A-Za-z0-9_$.]*/.exec(src.slice(i))!;
      const word = m[0];
      const s = i;
      i += word.length;
      if (src[i] === '[') {
        // NAME[ ... ]
        const close = src.indexOf(']', i);
        if (close < 0) throw new ParseError(`Missing ']' after ${word}`, i);
        const inner = src.slice(i + 1, close);
        const t: Tok = { k: 'ref', v: src.slice(s, close + 1), s, e: close + 1, name: word.toUpperCase() };
        const base = i + 1;
        if (t.name === 'MESSAGE') { t.cmt = inner; t.is = base; t.ie = close; }
        else parseRefInner(t, inner, base);
        // nested ref like LBL[R[1]] closes with "]]"
        if (typeof t.idx === 'object' && t.idx && src[close + 1] === ']') { t.e = close + 2; t.v = src.slice(s, close + 2); }
        out.push(t);
        i = t.e;
        continue;
      }
      const cm = /^(CNT|ACC)(\d+)$/i.exec(word);
      if (cm) {
        out.push({ k: 'ident', v: cm[1].toUpperCase(), s, e: s + 3 });
        out.push({ k: 'num', v: cm[2], s: s + 3, e: i });
        continue;
      }
      out.push({ k: 'ident', v: word, s, e: i });
      continue;
    }
    const two = src.slice(i, i + 2);
    if (two === '<>' || two === '<=' || two === '>=') { out.push({ k: 'op', v: two, s: i, e: i + 2 }); i += 2; continue; }
    if ('=<>+-*/(),:'.includes(c)) { out.push({ k: 'op', v: c, s: i, e: i + 1 }); i++; continue; }
    if (c === ';') { i++; continue; }
    throw new ParseError(`Unexpected character '${c}'`, i);
  }
  return out;
}

function parseRefInner(t: Tok, inner: string, base: number) {
  // forms: "...", "12", "12:comment", "12,3", "R[4]", "AR[1]", "R[4:cmt]"
  const ind = /^\s*(R|AR)\[(\d+)(?::[^\]]*)?$/i.exec(inner);
  if (ind) {
    t.idx = { reg: ind[1].toUpperCase() as 'R' | 'AR', n: +ind[2] };
    const off = inner.indexOf('[') + 1;
    t.is = base + off; t.ie = base + off + ind[2].length;
    return;
  }
  const m = /^\s*(\.\.\.|\d+)\s*(?:,\s*(\.\.\.|\d+)\s*)?(?::(.*))?$/.exec(inner);
  if (!m) throw new ParseError(`Bad index in ${t.name}[${inner}]`, base);
  const lead = inner.length - inner.trimStart().length;
  t.idx = m[1] === '...' ? null : +m[1];
  t.is = base + lead; t.ie = base + lead + m[1].length;
  if (m[2] !== undefined) t.idx2 = m[2] === '...' ? null : +m[2];
  if (m[3] !== undefined) t.cmt = m[3];
}

// ---------------------------------------------------------------- parser

class P {
  i = 0;
  constructor(public t: Tok[], public src: string) {}
  peek(o = 0) { return this.t[this.i + o]; }
  next() { return this.t[this.i++]; }
  atEnd() { return this.i >= this.t.length; }
  isOp(v: string, o = 0) { const t = this.peek(o); return !!t && t.k === 'op' && t.v === v; }
  isId(v: string, o = 0) { const t = this.peek(o); return !!t && t.k === 'ident' && t.v.toUpperCase() === v; }
  err(msg: string): never { const t = this.peek(); throw new ParseError(msg, t ? t.s : this.src.length); }
  op(v: string) { if (!this.isOp(v)) this.err(`Expected '${v}'`); const t = this.next(); t.role = 'op'; return t; }
  id(v: string, role: Role = 'kw') { if (!this.isId(v)) this.err(`Expected ${v}`); const t = this.next(); t.role = role; return t; }
  ref(names: string[], role: Role = 'index') {
    const t = this.peek();
    if (!t || t.k !== 'ref' || !names.includes(t.name!)) this.err(`Expected ${names.map((n) => n + '[]').join(' or ')}`);
    this.i++; t.role = role; return t;
  }
  end() { if (!this.atEnd()) this.err(`Unexpected '${this.peek().v}'`); }

  // expressions
  expr(): Expr { return this.or(); }
  or(): Expr {
    let a = this.and();
    while (this.isId('OR')) { this.next().role = 'logic'; a = { k: 'bin', op: 'OR', a, b: this.and() }; }
    return a;
  }
  and(): Expr {
    let a = this.cmp();
    while (this.isId('AND')) { this.next().role = 'logic'; a = { k: 'bin', op: 'AND', a, b: this.cmp() }; }
    return a;
  }
  cmp(): Expr {
    let a = this.add();
    const t = this.peek();
    if (t && t.k === 'op' && ['=', '<>', '<', '>', '<=', '>='].includes(t.v)) {
      this.next().role = 'cmp';
      a = { k: 'bin', op: t.v, a, b: this.add() };
    }
    return a;
  }
  add(): Expr {
    let a = this.mul();
    while (this.isOp('+') || this.isOp('-')) { const o = this.next(); o.role = 'op'; a = { k: 'bin', op: o.v, a, b: this.mul() }; }
    return a;
  }
  mul(): Expr {
    let a = this.unary();
    while (this.isOp('*') || this.isOp('/') || this.isId('DIV') || this.isId('MOD')) {
      const o = this.next(); o.role = 'op';
      a = { k: 'bin', op: o.v.toUpperCase(), a, b: this.unary() };
    }
    return a;
  }
  unary(): Expr {
    if (this.isOp('-')) { this.next(); return { k: 'neg', a: this.unary() }; }
    if (this.isId('NOT') || this.isOp('!')) { this.next(); return { k: 'not', a: this.unary() }; }
    return this.primary();
  }
  primary(): Expr {
    const t = this.peek();
    if (!t) this.err('Expected a value');
    if (t.k === 'num') { this.i++; t.role = 'value'; return { k: 'num', v: parseFloat(t.v) }; }
    if (t.k === 'ph') { this.i++; t.role = 'value'; return { k: 'ph' }; }
    if (t.k === 'op' && t.v === '(') { this.i++; const e = this.expr(); this.op(')'); return e; }
    if (t.k === 'ref') {
      if (!PORTS.includes(t.name as RefPort)) this.err(`Unknown register or port ${t.name}[]`);
      this.i++; t.role = 'value';
      return { k: 'ref', port: t.name as RefPort, idx: t.idx ?? null, idx2: t.idx2 };
    }
    if (t.k === 'ident') {
      const u = t.v.toUpperCase();
      if (u === 'ON' || u === 'OFF' || u === 'TRUE' || u === 'FALSE') { this.i++; t.role = 'ioval'; return { k: 'bool', v: u === 'ON' || u === 'TRUE' }; }
      if (u === 'LPOS') { this.i++; t.role = 'value'; return { k: 'lpos' }; }
      if (u === 'JPOS') { this.i++; t.role = 'value'; return { k: 'jpos' }; }
      if (u.startsWith('$')) { this.i++; t.role = 'value'; return { k: 'sys', name: u }; }
    }
    this.err(`Unexpected '${t.v}'`);
  }

  posRef(): PosRef {
    const t = this.peek();
    if (t && t.k === 'ph') { this.i++; t.role = 'target'; return { reg: 'P', idx: null }; }
    const r = this.ref(['P', 'PR'], 'target');
    return { reg: r.name as 'P' | 'PR', idx: r.idx ?? null };
  }

  motion(): Stmt {
    const ty = this.next(); ty.role = 'motype';
    const type = ty.v.toUpperCase() as 'J' | 'L' | 'C';
    let target = this.posRef();
    let via: PosRef | undefined;
    if (type === 'C') {
      via = target;
      if (this.isOp(':')) this.next();
      target = this.posRef();
    }
    // speed
    let spd: number | Expr;
    const st = this.peek();
    if (!st) this.err('Expected speed');
    if (st.k === 'num') { this.i++; st.role = 'speed'; spd = parseFloat(st.v); }
    else if (st.k === 'ph') { this.i++; st.role = 'speed'; spd = { k: 'ph' }; }
    else if (st.k === 'ref' && (st.name === 'R' || st.name === 'AR')) { this.i++; st.role = 'speed'; spd = { k: 'ref', port: st.name, idx: st.idx ?? null }; }
    else this.err('Expected speed');
    const ut = this.peek();
    if (!ut || ut.k !== 'unit') this.err('Expected speed unit (%, mm/sec, sec ...)');
    this.i++; ut.role = 'unit';
    if (type === 'J' ? !['%', 'sec', 'msec'].includes(ut.v) : ut.v === '%') this.err(`Speed unit ${ut.v} not allowed for ${type} motion`);
    // termination
    let term: Term;
    if (this.isId('FINE')) { this.next().role = 'term'; term = { fine: true }; }
    else if (this.isId('CNT')) {
      this.next().role = 'term';
      const c = this.peek();
      if (c && c.k === 'num') { this.i++; c.role = 'cnt'; term = { fine: false, cnt: Math.min(100, parseFloat(c.v)) }; }
      else if (c && c.k === 'ref' && c.name === 'R') { this.i++; c.role = 'cnt'; term = { fine: false, cnt: { k: 'ref', port: 'R', idx: c.idx ?? null } }; }
      else if (c && c.k === 'ph') { this.i++; c.role = 'cnt'; term = { fine: false, cnt: 100 }; }
      else this.err('Expected CNT value');
    } else this.err('Expected FINE or CNT');
    // options
    const opts: string[] = [];
    let offset: { kind: 'Offset' | 'Tool_Offset'; pr: Idx | undefined } | undefined;
    while (!this.atEnd()) {
      const o = this.next();
      o.role = 'option';
      const u = o.v.toUpperCase();
      if (u === 'OFFSET' || u === 'TOOL_OFFSET') {
        const kind = u === 'OFFSET' ? 'Offset' : 'Tool_Offset';
        let pr: Idx | undefined;
        if (this.isOp(',')) { this.next(); pr = this.ref(['PR']).idx ?? null; }
        offset = { kind, pr };
      } else if (u === 'ACC') {
        const v = this.peek(); if (v && v.k === 'num') { this.i++; v.role = 'option'; }
        opts.push(`ACC${v?.v ?? ''}`);
      } else {
        // Unsupported options are kept and ignored (warned by the interpreter).
        let raw = o.v;
        while (this.isOp(',')) { this.next(); const x = this.next(); if (x) raw += ',' + x.v; }
        opts.push(raw);
      }
    }
    return { k: 'motion', type, target, via, speed: { v: spd, unit: ut.v }, term, offset, opts };
  }

  /** Action after "IF ...," or "SELECT ...,": JMP/CALL or a simple statement. */
  action(): Stmt { return this.stmt(); }

  stmt(): Stmt {
    const t = this.peek();
    if (!t) return { k: 'blank' };
    if (t.k === 'op' && t.v === '=') { // SELECT case line
      this.next().role = 'op';
      const v = this.expr();
      this.op(',');
      return { k: 'case', v, then: this.action() };
    }
    if (t.k === 'ident') {
      const u = t.v.toUpperCase();
      const nx = this.peek(1);
      if ((u === 'J' || u === 'L' || u === 'C') && nx && (nx.k === 'ref' && (nx.name === 'P' || nx.name === 'PR') || nx.k === 'ph')) return this.motion();
      switch (u) {
        case 'JMP': { this.next().role = 'kw'; const r = this.ref(['LBL']); return { k: 'jmp', n: r.idx ?? null }; }
        case 'CALL': {
          this.next().role = 'kw';
          const p = this.next();
          if (!p || (p.k !== 'ident' && p.k !== 'ph')) this.err('Expected program name');
          p.role = 'prog';
          const args: Expr[] = [];
          if (this.isOp('(')) {
            this.next();
            if (!this.isOp(')')) { args.push(this.expr()); while (this.isOp(',')) { this.next(); args.push(this.expr()); } }
            this.op(')');
          }
          return { k: 'call', prog: p.k === 'ph' ? '' : p.v.toUpperCase(), args };
        }
        case 'IF': {
          this.next().role = 'kw';
          const cond = this.expr();
          if (this.isId('THEN')) { this.next().role = 'kw'; return { k: 'if_then', cond }; }
          this.op(',');
          return { k: 'if', cond, then: this.action() };
        }
        case 'ELSE':
          this.next().role = 'kw';
          if (this.isOp(',')) { this.next(); return { k: 'case_else', then: this.action() }; }
          return { k: 'else' };
        case 'ENDIF': this.next().role = 'kw'; return { k: 'endif' };
        case 'SELECT': {
          this.next().role = 'kw';
          const r = this.ref(['R']);
          this.op('=');
          const v = this.expr();
          this.op(',');
          return { k: 'select', reg: r.idx ?? null, v, then: this.action() };
        }
        case 'FOR': {
          this.next().role = 'kw';
          const r = this.ref(['R']);
          this.op('=');
          const from = this.expr();
          const d = this.next();
          if (!d || d.k !== 'ident' || !['TO', 'DOWNTO'].includes(d.v.toUpperCase())) this.err('Expected TO or DOWNTO');
          d.role = 'dir';
          return { k: 'for', reg: r.idx ?? null, from, to: this.expr(), down: d.v.toUpperCase() === 'DOWNTO' };
        }
        case 'ENDFOR': this.next().role = 'kw'; return { k: 'endfor' };
        case 'END': this.next().role = 'kw'; return { k: 'end' };
        case 'ABORT': this.next().role = 'kw'; return { k: 'abort' };
        case 'PAUSE': this.next().role = 'kw'; return { k: 'pause' };
        case 'WAIT': {
          this.next().role = 'kw';
          const e = this.expr();
          if (this.isOp('(')) { this.next(); const u2 = this.next(); if (!u2 || u2.k !== 'unit' || u2.v !== 'sec') this.err('Expected (sec)'); u2.role = 'unit'; this.op(')'); return { k: 'wait_time', t: e }; }
          const tu = this.peek();
          if (tu && tu.k === 'unit' && tu.v === 'sec') { this.next().role = 'unit'; return { k: 'wait_time', t: e }; }
          const isCond = e.k === 'bin' && ['=', '<>', '<', '>', '<=', '>=', 'AND', 'OR'].includes(e.op);
          if (!isCond) return { k: 'wait_time', t: e };
          let timeoutLbl: Idx | undefined;
          if (this.isId('TIMEOUT')) { this.next().role = 'kw'; this.op(','); timeoutLbl = this.ref(['LBL']).idx ?? null; }
          return { k: 'wait', cond: e, timeoutLbl };
        }
        case 'UFRAME_NUM': case 'UTOOL_NUM': {
          this.next().role = 'kw'; this.op('=');
          return { k: 'frame_num', which: u, expr: this.expr() };
        }
        case 'OVERRIDE': {
          this.next().role = 'kw'; this.op('=');
          const v = this.expr();
          const pc = this.peek(); if (pc && pc.k === 'unit' && pc.v === '%') this.next().role = 'unit';
          return { k: 'override', v };
        }
        case 'OFFSET': case 'TOOL_OFFSET': {
          this.next().role = 'kw'; this.id('CONDITION');
          const r = this.ref(['PR']);
          return { k: 'offset_cond', kind: u === 'OFFSET' ? 'Offset' : 'Tool_Offset', pr: r.idx ?? null };
        }
      }
      if (u.startsWith('$')) {
        this.next().role = 'kw'; this.op('=');
        return { k: 'assign', port: 'SYS', idx: 0, sys: u, expr: this.expr() };
      }
    }
    if (t.k === 'ref') {
      switch (t.name) {
        case 'LBL': this.next().role = 'index'; return { k: 'label', n: t.idx ?? null, cmt: t.cmt };
        case 'MESSAGE': this.next().role = 'text'; return { k: 'message', text: t.cmt ?? '' };
        case 'PAYLOAD': this.next().role = 'index'; return { k: 'payload', n: t.idx ?? null };
        case 'TIMER': {
          if (!(this.peek(1)?.k === 'op' && this.peek(1)?.v === '=' && this.peek(2)?.k === 'ident')) break;
          this.next().role = 'index'; this.op('=');
          const o = this.next();
          const ou = o?.v.toUpperCase();
          if (!o || !['START', 'STOP', 'RESET'].includes(ou!)) this.err('Expected START, STOP or RESET');
          o.role = 'timer';
          return { k: 'timer', n: t.idx ?? null, op: ou as 'START' };
        }
        case 'UFRAME': case 'UTOOL': {
          this.next().role = 'index'; this.op('=');
          return { k: 'frame_set', which: t.name, n: t.idx ?? null, expr: this.expr() };
        }
      }
      if (PORTS.includes(t.name as RefPort) && t.name !== 'P') {
        this.next().role = 'index';
        this.op('=');
        if (this.isId('PULSE')) {
          this.next().role = 'ioval';
          let width: number | undefined;
          if (this.isOp(',')) {
            this.next();
            const w = this.next();
            if (!w || w.k !== 'num') this.err('Expected pulse width');
            w.role = 'pulse'; width = parseFloat(w.v);
            const su = this.peek(); if (su && su.k === 'unit') this.next().role = 'unit';
          }
          if (!OUT_PORTS.includes(t.name as RefPort)) this.err(`${t.name} is an input`);
          return { k: 'pulse', port: t.name as RefPort, idx: t.idx ?? null, width };
        }
        if (IO_PORTS.includes(t.name as RefPort) && !OUT_PORTS.includes(t.name as RefPort) && t.name !== 'F') this.err(`${t.name} is an input and cannot be set`);
        return { k: 'assign', port: t.name as RefPort, idx: t.idx ?? null, idx2: t.idx2, expr: this.expr() };
      }
    }
    this.err(`Unknown instruction '${t.v}'`);
  }
}

export interface ParsedLine { stmt: Stmt; toks: Tok[]; error?: string; errPos?: number }

/** Parse one TP line (no line number, no trailing ';'). Never throws: errors are returned. */
export function parseLine(src: string): ParsedLine {
  const trimmed = src.trim();
  if (!trimmed) return { stmt: { k: 'blank' }, toks: [] };
  if (trimmed.startsWith('//')) return { stmt: { k: 'disabled', text: trimmed.slice(2) }, toks: [] };
  if (trimmed.startsWith('!')) {
    const s = src.indexOf('!');
    return { stmt: { k: 'remark', text: trimmed.slice(1) }, toks: [{ k: 'text', v: src.slice(s + 1), s: s + 1, e: src.length, role: 'text' }] };
  }
  let toks: Tok[] = [];
  try {
    toks = lex(src);
    const p = new P(toks, src);
    const stmt = p.stmt();
    p.end();
    return { stmt, toks };
  } catch (e) {
    if (e instanceof ParseError) return { stmt: { k: 'blank' }, toks, error: e.message, errPos: e.pos };
    throw e;
  }
}

/** True if a statement (or the action of IF/SELECT) still contains "..." placeholders. */
export function hasPlaceholder(src: string) { return src.includes('...'); }
