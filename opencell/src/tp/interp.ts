// TP program interpreter: runs programs line by line, drives motion, I/O, registers and flow control.
import { CellState, IOPort } from '../state';
import { parseLine, Stmt, Expr, Idx, PosRef } from './parser';
import { TPPos, TPProgram, CfgLite } from './program';
import { Move, MoveExt } from '../motion';
import { Frame, XYZWPR, poseToFrame, compose, invert } from '../kin/math';
import { Joints, ikFlange, fk, configOf, turnOf, sameConfig, Config } from '../kin/robot';

export type RunStatus = 'IDLE' | 'RUNNING' | 'PAUSED' | 'ABORTED';

export class TPError extends Error {}

type PosVal = ({ kind: 'cart'; pose: XYZWPR; cfg: CfgLite } | { kind: 'joint'; q: number[] }) & { e?: number[] };
type Val = number | boolean | PosVal;

interface CallFrame { prog: string; pc: number; args: number[]; fors: { line: number; reg: number; to: number; down: boolean }[]; retAfter?: number }

interface Compiled { stmts: Stmt[]; errors: (string | undefined)[]; labels: Map<number, number>; match: Map<number, number>; elseOf: Map<number, number> }

const POS_KEYS = ['x', 'y', 'z', 'w', 'p', 'r'] as const;

export class Interpreter {
  status: RunStatus = 'IDLE';
  stack: CallFrame[] = [];
  move: Move | null = null;
  /** Line the robot was last moved to (for BWD). */
  atLine: number | null = null;
  cycleTime = 0;
  lastCycle = 0;
  fault = false;
  /** Run only while SHIFT is held (teach pendant execution in T1/T2). */
  fromPendant = false;
  private wait: { until?: number; cond?: Expr; timeoutAt?: number; timeoutLbl?: Idx } | null = null;
  private clock = 0;
  private pulses: { port: IOPort; idx: number; at: number }[] = [];
  private timers = new Map<number, { start: number | null; acc: number }>();
  private offsetCond: { Offset?: Idx; Tool_Offset?: Idx } = {};
  private cache = new WeakMap<string[], { key: string; c: Compiled }>();
  private stepOne = false;
  private listeners = new Set<() => void>();

  constructor(private s: CellState) {}

  onChange(f: () => void) { this.listeners.add(f); }
  private changed() { for (const f of this.listeners) f(); }

  get frame(): CallFrame | undefined { return this.stack[this.stack.length - 1]; }
  get running() { return this.status === 'RUNNING'; }
  /** Program and line (0-based) currently executing or next to execute. */
  get cursor(): { prog: string; line: number } | null { const f = this.frame; return f ? { prog: f.prog, line: f.pc } : null; }

  compile(p: TPProgram): Compiled {
    const hit = this.cache.get(p.lines);
    const key = p.lines.join('\n');
    if (hit && hit.key === key) return hit.c;
    const stmts: Stmt[] = [], errors: (string | undefined)[] = [];
    const labels = new Map<number, number>(), match = new Map<number, number>(), elseOf = new Map<number, number>();
    const forSt: number[] = [], ifSt: number[] = [];
    p.lines.forEach((l, i) => {
      const r = parseLine(l);
      stmts.push(r.stmt);
      errors.push(r.error);
      const st = r.stmt;
      if (st.k === 'label' && typeof st.n === 'number') labels.set(st.n, i);
      if (st.k === 'for') forSt.push(i);
      if (st.k === 'endfor') { const f = forSt.pop(); if (f !== undefined) { match.set(f, i); match.set(i, f); } }
      if (st.k === 'if_then') ifSt.push(i);
      if (st.k === 'else' && ifSt.length) elseOf.set(ifSt[ifSt.length - 1], i);
      if (st.k === 'endif') { const f = ifSt.pop(); if (f !== undefined) { match.set(f, i); const e = elseOf.get(f); if (e !== undefined) match.set(e, i); } }
    });
    const c = { stmts, errors, labels, match, elseOf };
    this.cache.set(p.lines, { key, c });
    return c;
  }

  // ------------------------------------------------------------ control

  /** Start (or restart) a program at a line. */
  start(prog: string, line = 0, opts: { step?: boolean; pendant?: boolean } = {}) {
    if (this.fault) { this.s.message('warn', 'Press RESET to clear the fault first'); return; }
    if (!this.s.programs[prog]) { this.s.message('alarm', `Program ${prog} not found`); return; }
    if (this.status === 'PAUSED' && this.frame?.prog === prog && this.frame.pc === line) { this.resume(opts); return; }
    this.stack = [{ prog, pc: line, args: [], fors: [] }];
    this.move = null; this.wait = null;
    this.cycleTime = 0;
    this.fromPendant = !!opts.pendant;
    this.stepOne = !!opts.step || this.s.stepMode;
    this.status = 'RUNNING';
    this.s.message('info', `${prog} started at line ${line + 1}${this.stepOne ? ' (step)' : ''}`);
    this.changed();
  }
  resume(opts: { step?: boolean; pendant?: boolean } = {}) {
    if (this.fault) { this.s.message('warn', 'Press RESET to clear the fault first'); return; }
    if (this.status !== 'PAUSED') return;
    this.fromPendant = !!opts.pendant;
    this.stepOne = !!opts.step || this.s.stepMode;
    this.status = 'RUNNING';
    this.s.message('info', 'Program resumed');
    this.changed();
  }
  hold(reason = 'HOLD') {
    if (this.status !== 'RUNNING') return;
    this.status = 'PAUSED';
    this.s.message('warn', `Program paused (${reason})`);
    this.changed();
  }
  abort() {
    if (this.status === 'IDLE' || this.status === 'ABORTED') { this.stack = []; this.status = 'ABORTED'; this.changed(); return; }
    this.status = 'ABORTED';
    this.move = null; this.wait = null;
    this.s.message('warn', 'Program aborted');
    this.changed();
  }
  reset() {
    this.fault = false;
    this.changed();
  }
  /** Move the cursor of a paused/idle program (EDIT screen). */
  setCursor(prog: string, line: number) {
    if (this.running) return;
    if (this.frame && this.frame.prog === prog && this.status === 'PAUSED') { this.frame.pc = line; this.move = null; this.wait = null; }
    else { this.stack = [{ prog, pc: line, args: [], fors: [] }]; this.status = 'IDLE'; }
  }
  /** Release a WAIT (FCTN > RELEASE WAIT). */
  releaseWait() { if (this.wait) { this.wait = null; this.frame && this.frame.pc++; this.s.message('info', 'WAIT released'); } }

  /** BWD: move back to the previous motion line of the current program. */
  backward(prog: string, fromLine: number) {
    if (this.running || this.fault) return;
    const p = this.s.programs[prog];
    if (!p) return;
    const c = this.compile(p);
    const from = this.atLine !== null && this.frame?.prog === prog ? Math.min(this.atLine, fromLine) : fromLine;
    let j = from - 1;
    while (j >= 0 && c.stmts[j].k !== 'motion') j--;
    if (j < 0) { this.s.message('warn', 'BWD: top of program, no earlier motion'); return; }
    this.stack = [{ prog, pc: j, args: [], fors: [] }];
    try {
      const st = c.stmts[j] as Extract<Stmt, { k: 'motion' }>;
      // BWD of a circular move returns along a joint path to its via/start point.
      this.move = this.makeMove({ ...st, term: { fine: true }, type: st.type === 'C' ? 'J' : st.type, speed: st.type === 'C' ? { v: 50, unit: '%' } : st.speed });
      this.atLine = j;
      this.bwdPending = true;
      this.stepOne = true;
      this.status = 'RUNNING';
    } catch (e) { this.error(e); }
    this.changed();
  }
  private bwdPending = false;

  private error(e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    const f = this.frame;
    this.s.message('alarm', `${f ? `${f.prog} line ${f.pc + 1}: ` : ''}${msg}`);
    this.fault = true;
    this.move = null;
    if (this.status === 'RUNNING') this.status = 'PAUSED';
    this.changed();
  }

  // ------------------------------------------------------------ main loop

  tick(dt: number) {
    this.clock += dt;
    // pulses and timers run regardless of program state
    if (this.pulses.length) {
      const due = this.pulses.filter((p) => p.at <= this.clock);
      if (due.length) {
        for (const p of due) this.s.io[p.port][p.idx] = 0;
        this.pulses = this.pulses.filter((p) => p.at > this.clock);
        this.s.emit();
      }
    }
    if (this.status !== 'RUNNING') return;
    if (this.fromPendant && this.s.mode !== 'AUTO' && !this.s.shift) { this.hold('SHIFT released'); return; }
    this.cycleTime += dt;
    try {
      let budget = 2000;
      while (this.status === 'RUNNING' && budget-- > 0) {
        if (this.move) {
          if (dt <= 0) break;
          this.move.update(dt);
          this.s.q = this.move.q;
          if (this.move.e.length) this.s.e = this.move.e;
          dt = 0;
          if (!this.move.done) break;
          this.move = null;
          if (this.bwdPending) { this.bwdPending = false; this.finishStep(); break; }
          this.frame!.pc++;
          if (this.stepOne) { this.finishStep(); break; }
          continue;
        }
        if (this.wait) {
          if (!this.checkWait()) break;
          if (this.stepOne) { this.finishStep(); break; }
          continue;
        }
        const f = this.frame;
        if (!f) { this.finish(); break; }
        const p = this.s.programs[f.prog];
        if (!p) throw new TPError(`Program ${f.prog} not found`);
        if (f.pc >= p.lines.length) { this.ret(); continue; }
        const c = this.compile(p);
        if (c.errors[f.pc]) throw new TPError(`Syntax error: ${c.errors[f.pc]}`);
        const before = this.stack.length;
        const blocked = this.exec(c.stmts[f.pc], c, f);
        if (blocked) {
          if (this.move || this.wait) { if (this.move) this.atLine = f.pc; continue; }
          break;
        }
        if (this.stepOne && this.status === 'RUNNING' && this.stack.length <= before) { this.finishStep(); break; }
      }
      this.s.emit();
    } catch (e) { this.error(e); this.s.emit(); }
  }

  private finishStep() { if (this.status === 'RUNNING') { this.status = 'PAUSED'; this.changed(); } }

  private finish() {
    this.status = 'IDLE';
    this.lastCycle = this.cycleTime;
    this.s.message('info', `Program finished. Cycle time ${this.cycleTime.toFixed(2)} s`);
    this.stack = [];
    this.changed();
  }
  private ret() {
    const done = this.stack.pop();
    const caller = this.frame;
    if (!caller) {
      this.status = 'IDLE';
      this.lastCycle = this.cycleTime;
      this.s.message('info', `${done?.prog ?? 'Program'} finished. Cycle time ${this.cycleTime.toFixed(2)} s`);
      this.changed();
      return;
    }
    caller.pc = caller.retAfter ?? caller.pc + 1;
    caller.retAfter = undefined;
  }

  private checkWait(): boolean {
    const w = this.wait!;
    if (w.until !== undefined) { if (this.clock < w.until) return false; }
    else if (w.cond) {
      if (!truthy(this.eval(w.cond))) {
        if (w.timeoutAt !== undefined && this.clock >= w.timeoutAt) {
          this.wait = null;
          this.jump(w.timeoutLbl ?? null);
          this.s.message('warn', 'WAIT timed out, jumping to timeout label');
          return true;
        }
        return false;
      }
    }
    this.wait = null;
    this.frame!.pc++;
    return true;
  }

  // ------------------------------------------------------------ statements

  /** Execute one statement. Returns true when execution must wait (motion, WAIT, pause...). */
  private exec(st: Stmt, c: Compiled, f: CallFrame): boolean {
    const s = this.s;
    switch (st.k) {
      case 'blank': case 'remark': case 'disabled': case 'label': case 'endif':
        f.pc++; return false;
      case 'motion':
        this.move = this.makeMove(st);
        return true;
      case 'jmp': this.jump(st.n); return false;
      case 'call': this.call(st.prog, st.args.map((a) => num(this.eval(a))), f.pc + 1); return false;
      case 'assign': this.assign(st); f.pc++; return false;
      case 'pulse': {
        const idx = this.index(st.idx);
        s.io[st.port as IOPort][idx] = 1;
        const w = st.width ?? (s.sys.$DEFPULSE ?? 4) / 10;
        this.pulses.push({ port: st.port as IOPort, idx, at: this.clock + w });
        f.pc++; return false;
      }
      case 'frame_num': {
        const n = Math.round(num(this.eval(st.expr)));
        if (st.which === 'UFRAME_NUM') { if (n < 0 || n > 9) throw new TPError(`UFRAME_NUM ${n} out of range (0-9)`); s.uframe = n; }
        else { if (n < 0 || n > 10) throw new TPError(`UTOOL_NUM ${n} out of range (0-10)`); s.utool = n; }
        f.pc++; return false;
      }
      case 'frame_set': {
        const n = this.index(st.n);
        const v = this.eval(st.expr);
        if (typeof v !== 'object' || v.kind !== 'cart') throw new TPError(`${st.which}[${n}] needs a Cartesian position register`);
        const list = st.which === 'UFRAME' ? s.users : s.tools;
        if (n < 1 || n > list.length) throw new TPError(`${st.which}[${n}] does not exist`);
        list[n - 1].pose = { ...v.pose };
        f.pc++; return false;
      }
      case 'override': {
        const v = Math.round(num(this.eval(st.v)));
        s.override = Math.max(1, Math.min(100, v));
        f.pc++; return false;
      }
      case 'payload': f.pc++; return false; // accepted, no dynamics
      case 'timer': {
        const n = this.index(st.n);
        const t = this.timers.get(n) ?? { start: null, acc: 0 };
        if (st.op === 'START') { if (t.start === null) t.start = this.clock; }
        else if (st.op === 'STOP') { if (t.start !== null) { t.acc += this.clock - t.start; t.start = null; } }
        else { t.acc = 0; t.start = t.start !== null ? this.clock : null; }
        this.timers.set(n, t);
        f.pc++; return false;
      }
      case 'offset_cond': this.offsetCond[st.kind] = st.pr; f.pc++; return false;
      case 'wait_time': this.wait = { until: this.clock + num(this.eval(st.t)) }; return true;
      case 'wait': {
        if (truthy(this.eval(st.cond))) { f.pc++; return false; }
        const timeout = st.timeoutLbl !== undefined ? (s.sys.$WAITTMOUT ?? 3000) / 100 : undefined;
        this.wait = { cond: st.cond, timeoutAt: timeout !== undefined ? this.clock + timeout : undefined, timeoutLbl: st.timeoutLbl };
        return true;
      }
      case 'if':
        if (truthy(this.eval(st.cond))) return this.action(st.then, c, f, f.pc + 1);
        f.pc++; return false;
      case 'if_then':
        if (truthy(this.eval(st.cond))) { f.pc++; return false; }
        { const e = c.elseOf.get(f.pc), m = c.match.get(f.pc); if (m === undefined) throw new TPError('IF ... THEN without ENDIF'); f.pc = (e ?? m) + 1; }
        return false;
      case 'else': { const m = c.match.get(f.pc); if (m === undefined) throw new TPError('ELSE without ENDIF'); f.pc = m + 1; return false; }
      case 'select': {
        const v = num(this.eval({ k: 'ref', port: 'R', idx: st.reg }));
        let end = f.pc + 1;
        while (end < c.stmts.length && (c.stmts[end].k === 'case' || c.stmts[end].k === 'case_else')) end++;
        if (num(this.eval(st.v)) === v) return this.action(st.then, c, f, end);
        for (let i = f.pc + 1; i < end; i++) {
          const cs = c.stmts[i];
          if (cs.k === 'case' && num(this.eval(cs.v)) === v) return this.action(cs.then, c, f, end);
          if (cs.k === 'case_else') return this.action(cs.then, c, f, end);
        }
        f.pc = end; return false;
      }
      case 'case': case 'case_else': f.pc++; return false; // reached only by falling through a SELECT group
      case 'for': {
        const reg = this.index(st.reg);
        const from = num(this.eval(st.from)), to = num(this.eval(st.to));
        const m = c.match.get(f.pc);
        if (m === undefined) throw new TPError('FOR without ENDFOR');
        s.R[reg].v = from;
        if (st.down ? from < to : from > to) { f.pc = m + 1; return false; }
        f.fors.push({ line: f.pc, reg, to, down: st.down });
        f.pc++; return false;
      }
      case 'endfor': {
        const lp = f.fors[f.fors.length - 1];
        const m = c.match.get(f.pc);
        if (!lp || lp.line !== m) throw new TPError('ENDFOR without FOR');
        s.R[lp.reg].v += lp.down ? -1 : 1;
        const v = s.R[lp.reg].v;
        if (lp.down ? v >= lp.to : v <= lp.to) f.pc = lp.line + 1;
        else { f.fors.pop(); f.pc++; }
        return false;
      }
      case 'end': this.ret(); return false;
      case 'abort': this.status = 'ABORTED'; this.s.message('warn', `ABORT at line ${f.pc + 1}`); this.changed(); return true;
      case 'pause': f.pc++; this.status = 'PAUSED'; this.s.message('warn', `PAUSE at line ${f.pc}`); this.changed(); return true;
      case 'message': this.s.message('info', `MESSAGE: ${st.text}`); f.pc++; return false;
    }
  }

  /** Run the action of IF/SELECT. `after` is where execution continues when the action is not a jump. */
  private action(a: Stmt, c: Compiled, f: CallFrame, after: number): boolean {
    if (a.k === 'jmp') { this.jump(a.n); return false; }
    if (a.k === 'call') { this.call(a.prog, a.args.map((x) => num(this.eval(x))), after); return false; }
    const pc = f.pc;
    const blocked = this.exec(a, c, f);
    if (f.pc === pc + 1) f.pc = after;
    return blocked;
  }

  private jump(n: Idx) {
    const f = this.frame!;
    const lbl = this.index(n);
    const c = this.compile(this.s.programs[f.prog]);
    const i = c.labels.get(lbl);
    if (i === undefined) throw new TPError(`LBL[${lbl}] not found`);
    f.pc = i;
  }

  private call(prog: string, args: number[], retAfter: number) {
    if (!prog) throw new TPError('Instruction incomplete: CALL program not set');
    if (!this.s.programs[prog]) throw new TPError(`CALL: program ${prog} not found`);
    if (this.stack.length > 30) throw new TPError('Too many nested CALLs');
    this.frame!.retAfter = retAfter;
    this.stack.push({ prog, pc: 0, args, fors: [] });
  }

  private assign(st: Extract<Stmt, { k: 'assign' }>) {
    const s = this.s;
    const v = this.eval(st.expr);
    if (st.port === 'SYS') { s.sys[st.sys!] = num(v); return; }
    const idx = this.index(st.idx);
    switch (st.port) {
      case 'R':
        if (typeof v === 'object') throw new TPError('Cannot store a position in R[]');
        if (idx < 1 || idx > 200) throw new TPError(`R[${idx}] out of range`);
        s.R[idx].v = num(v); return;
      case 'PR': {
        if (idx < 1 || idx > 100) throw new TPError(`PR[${idx}] out of range`);
        if (st.idx2 !== undefined) {
          const e = st.idx2;
          if (e === null) throw new TPError('PR[i,j]: element missing');
          const cur = this.prVal(idx);
          if (e > 6) { cur.e = cur.e ?? []; cur.e[e - 7] = num(v); }
          else if (cur.kind === 'cart') { (cur.pose as unknown as Record<string, number>)[POS_KEYS[e - 1]] = num(v); }
          else cur.q[e - 1] = num(v);
          s.PR[idx].v = this.toTP(cur);
          return;
        }
        if (typeof v !== 'object') throw new TPError('PR[] needs a position (P[], PR[], LPOS, JPOS)');
        s.PR[idx].v = this.toTP(v);
        return;
      }
      case 'AR': case 'P': throw new TPError(`${st.port}[] cannot be assigned`);
      case 'SR': throw new TPError('String registers are not supported');
      default: {
        const port = st.port as IOPort;
        if (!s.io[port]) throw new TPError(`Unknown port ${port}`);
        s.io[port][idx] = typeof v === 'boolean' ? (v ? 1 : 0) : num(v);
      }
    }
  }

  // ------------------------------------------------------------ expressions

  index(i: Idx): number {
    if (i === null) throw new TPError('Instruction incomplete: index "..." not set');
    if (typeof i === 'number') return i;
    if (i.reg === 'R') return Math.round(this.s.R[i.n]?.v ?? 0);
    return Math.round(this.frame?.args[i.n - 1] ?? 0);
  }

  eval(e: Expr): Val {
    const s = this.s;
    switch (e.k) {
      case 'num': return e.v;
      case 'bool': return e.v;
      case 'ph': throw new TPError('Instruction incomplete: value "..." not set');
      case 'neg': return -num(this.eval(e.a));
      case 'not': return !truthy(this.eval(e.a));
      case 'sys': {
        if (!(e.name in s.sys)) throw new TPError(`Unknown system variable ${e.name}`);
        return s.sys[e.name];
      }
      case 'lpos': return { kind: 'cart', pose: s.tcpUser(), cfg: lite(s.config()), e: s.extNow() };
      case 'jpos': return { kind: 'joint', q: [...s.q], e: s.extNow() };
      case 'ref': {
        const i = this.index(e.idx);
        switch (e.port) {
          case 'R': if (i < 1 || i > 200) throw new TPError(`R[${i}] out of range`); return s.R[i].v;
          case 'AR': {
            const a = this.frame?.args[i - 1];
            if (a === undefined) throw new TPError(`AR[${i}] was not passed by CALL`);
            return a;
          }
          case 'PR': {
            const pv = this.prVal(i);
            if (e.idx2 !== undefined) {
              if (e.idx2 === null) throw new TPError('PR[i,j]: element missing');
              if (e.idx2 > 6) return pv.e?.[e.idx2 - 7] ?? 0;
              return pv.kind === 'cart' ? pv.pose[POS_KEYS[e.idx2 - 1]] : pv.q[e.idx2 - 1];
            }
            return pv;
          }
          case 'P': {
            const p = this.frame ? s.programs[this.frame.prog]?.pos[i] : undefined;
            if (!p) throw new TPError(`P[${i}] is not recorded`);
            const pe = p.ext ? [...p.ext] : undefined;
            return p.joint ? { kind: 'joint', q: [...p.joint], e: pe } : { kind: 'cart', pose: { ...p.cart!.pose }, cfg: p.cart!.cfg, e: pe };
          }
          case 'TIMER': {
            const t = this.timers.get(i);
            return t ? t.acc + (t.start !== null ? this.clock - t.start : 0) : 0;
          }
          case 'SR': case 'M': throw new TPError(`${e.port}[] is not supported`);
          default: {
            const v = s.io[e.port as IOPort]?.[i];
            if (v === undefined) throw new TPError(`${e.port}[${i}] does not exist`);
            return ['GI', 'GO', 'AI', 'AO'].includes(e.port) ? v : v !== 0;
          }
        }
      }
      case 'bin': {
        if (e.op === 'AND') return truthy(this.eval(e.a)) && truthy(this.eval(e.b));
        if (e.op === 'OR') return truthy(this.eval(e.a)) || truthy(this.eval(e.b));
        const a = this.eval(e.a), b = this.eval(e.b);
        if (typeof a === 'object' || typeof b === 'object') {
          if (typeof a !== 'object' || typeof b !== 'object' || (e.op !== '+' && e.op !== '-')) throw new TPError('Positions can only be added or subtracted');
          return posArith(a, b, e.op === '+' ? 1 : -1);
        }
        const x = num(a), y = num(b);
        switch (e.op) {
          case '+': return x + y;
          case '-': return x - y;
          case '*': return x * y;
          case '/': if (y === 0) throw new TPError('Division by zero'); return x / y;
          case 'DIV': if (y === 0) throw new TPError('Division by zero'); return Math.trunc(x / y);
          case 'MOD': if (y === 0) throw new TPError('Division by zero'); return x % y;
          case '=': return Math.abs(x - y) < 1e-9;
          case '<>': return Math.abs(x - y) >= 1e-9;
          case '<': return x < y;
          case '>': return x > y;
          case '<=': return x <= y;
          case '>=': return x >= y;
        }
        throw new TPError(`Unknown operator ${e.op}`);
      }
    }
  }

  private prVal(i: number): PosVal {
    const pr = this.s.PR[i];
    if (!pr) throw new TPError(`PR[${i}] out of range`);
    if (!pr.v) return { kind: 'cart', pose: { x: 0, y: 0, z: 0, w: 0, p: 0, r: 0 }, cfg: lite(this.s.config()), e: this.s.ctrl.rail ? [0] : undefined };
    const e = pr.v.ext ? [...pr.v.ext] : undefined;
    return pr.v.joint ? { kind: 'joint', q: [...pr.v.joint], e } : { kind: 'cart', pose: { ...pr.v.cart!.pose }, cfg: { ...pr.v.cart!.cfg }, e };
  }
  private toTP(v: PosVal): TPPos {
    const ext = v.e ? { ext: [...v.e] } : {};
    return v.kind === 'joint' ? { uf: -1, ut: -1, joint: [...v.q], ...ext } : { uf: -1, ut: -1, cart: { pose: { ...v.pose }, cfg: v.cfg }, ...ext };
  }

  // ------------------------------------------------------------ motion targets

  /** Resolve a position reference to a world TCP frame (+config) or joint target. */
  resolve(ref: PosRef): { frame?: Frame; cfg?: CfgLite; q?: Joints; e?: number[]; label: string } {
    const s = this.s;
    const i = this.index(ref.idx);
    const label = `${ref.reg}[${i}]`;
    let pos: TPPos | undefined;
    if (ref.reg === 'P') {
      const p = s.programs[this.frame!.prog];
      pos = p.pos[i];
      if (!pos) throw new TPError(`${label} is not recorded (teach it with SHIFT+TOUCHUP)`);
      if (pos.cart && (pos.uf !== s.uframe || pos.ut !== s.utool))
        throw new TPError(`${label} was taught with UF:${pos.uf} UT:${pos.ut} but current is UF:${s.uframe} UT:${s.utool}`);
    } else {
      pos = s.PR[i]?.v;
      if (!pos) throw new TPError(`${label} is not initialized`);
    }
    const e = s.ctrl.rail ? [...(pos.ext ?? s.e)] : undefined;
    if (pos.joint) return { q: [...pos.joint] as Joints, e, label };
    const f = compose(s.userFrame(), poseToFrame(pos.cart!.pose));
    return { frame: f, cfg: pos.cart!.cfg, e, label };
  }

  /** Joint solution for a frame, honoring the stored configuration and turn numbers. */
  solve(frame: Frame, cfg: CfgLite, label: string, e = this.s.e): Joints {
    const s = this.s;
    const sols = ikFlange(s.model, compose(s.toArm(frame, e), invert(s.toolFrame())), s.q);
    if (typeof sols === 'string') throw new TPError(`${label}: position not reachable${sols === 'limits' ? ' (joint limits)' : ''}`);
    const want = { flip: cfg.flip, up: cfg.up, front: cfg.front } as Config;
    const m = sols.filter((x) => sameConfig(x.config, want));
    if (!m.length) throw new TPError(`${label}: not reachable with configuration ${cfg.flip ? 'F' : 'N'} ${cfg.up ? 'U' : 'D'} ${cfg.front ? 'T' : 'B'}`);
    const q = [...m[0].q] as Joints;
    // apply turn numbers (J4, J6, J1) where the limits allow
    const turnIdx = [3, 5, 0];
    turnIdx.forEach((j, k) => {
      const want = cfg.turns[k];
      const cand = q[j] - 360 * (turnOf(q[j]) - want);
      const [lo, hi] = s.model.limits[j];
      if (cand >= lo && cand <= hi) q[j] = cand;
    });
    return q;
  }

  makeMove(st: Extract<Stmt, { k: 'motion' }>): Move {
    const s = this.s;
    const tool = s.toolFrame();
    let tgt = this.resolve(st.target);
    // Offset / Tool_Offset
    const offKind = st.offset?.kind;
    if (offKind) {
      const prIdx = st.offset!.pr !== undefined ? st.offset!.pr : this.offsetCond[offKind];
      if (prIdx === undefined) throw new TPError(`${offKind} without PR (use ${offKind.toUpperCase()} CONDITION PR[n])`);
      const off = this.prVal(this.index(prIdx));
      if (off.kind !== 'cart') throw new TPError(`${offKind} needs a Cartesian PR`);
      const offF = poseToFrame(off.pose);
      if (tgt.q) {
        const f = compose(s.railFrame(tgt.e), fk(s.model, tgt.q, tool));
        tgt = { frame: f, cfg: lite(configOf(s.model, tgt.q)), e: tgt.e, label: tgt.label };
      }
      // On a rail robot the offset's E1 shifts the rail too (PR[n,7]).
      const te = tgt.e && off.e ? tgt.e.map((v, i) => v + (off.e![i] ?? 0)) : tgt.e;
      const uf = s.userFrame();
      const inUser = compose(invert(uf), tgt.frame!);
      const shifted = offKind === 'Offset'
        ? { R: compose(offF, { R: inUser.R, p: [0, 0, 0] }).R, p: [inUser.p[0] + offF.p[0], inUser.p[1] + offF.p[1], inUser.p[2] + offF.p[2]] as [number, number, number] }
        : compose(inUser, offF);
      tgt = { frame: compose(uf, shifted), cfg: tgt.cfg, e: te, label: `${tgt.label} ${offKind}` };
    }
    const speed = typeof st.speed.v === 'number' ? st.speed.v : num(this.eval(st.speed.v));
    if (!(speed > 0)) throw new TPError('Speed must be greater than 0');
    const cnt = st.term.fine || this.stepOne ? null : (typeof st.term.cnt === 'number' ? st.term.cnt : num(this.eval(st.term.cnt)));
    const spec = { type: st.type, speed, unit: st.speed.unit, cnt: cnt === 0 ? null : cnt, override: s.overridePct, t1: s.mode === 'T1' };
    const f0 = s.tcpWorld();
    const rail = s.ctrl.rail;
    const e1 = rail ? [...(tgt.e ?? s.e)] : [];
    if (rail && (e1[0] < -1e-6 || e1[0] > rail.length + 1e-6)) throw new TPError(`${tgt.label}: E1 = ${e1[0].toFixed(1)} mm is outside the rail (0..${rail.length})`);
    const ext: MoveExt | undefined = rail ? { e0: [...s.e], e1, speed: rail.speed } : undefined;
    if (st.opts.length) s.message('warn', `Ignored motion option(s): ${st.opts.join(' ')}`);
    if (st.type === 'J') {
      const q1 = tgt.q ?? this.solve(tgt.frame!, tgt.cfg!, tgt.label, e1);
      for (let j = 0; j < 6; j++) {
        const [lo, hi] = s.model.limits[j];
        if (q1[j] < lo - 1e-6 || q1[j] > hi + 1e-6) throw new TPError(`${tgt.label}: J${j + 1} = ${q1[j].toFixed(1)} is outside its limits`);
      }
      return new Move(s.model, tool, s.q, spec, q1, f0, s.tcpWorld(q1, e1), s.config(), undefined, ext);
    }
    const f1 = tgt.frame ?? s.tcpWorld(tgt.q!, e1);
    const startCfg = s.config();
    if (tgt.cfg && !sameConfig(startCfg, { ...tgt.cfg } as Config))
      throw new TPError(`${tgt.label}: configuration differs from the current one (${tgt.cfg.flip ? 'F' : 'N'}${tgt.cfg.up ? 'U' : 'D'}${tgt.cfg.front ? 'T' : 'B'}); a linear move cannot change it, use J`);
    let via: Frame | undefined;
    if (st.type === 'C' && st.via) {
      const v = this.resolve(st.via);
      via = v.frame ?? s.tcpWorld(v.q!, v.e);
    }
    return new Move(s.model, tool, s.q, spec, null, f0, f1, startCfg, via, ext);
  }
}

// ------------------------------------------------------------ helpers

export function lite(c: Config): CfgLite { return { flip: c.flip, up: c.up, front: c.front, turns: [...c.turns] as [number, number, number] }; }
function num(v: Val): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  throw new TPError('Expected a number, got a position');
}
function truthy(v: Val): boolean { return typeof v === 'boolean' ? v : num(v) !== 0; }
function posArith(a: PosVal, b: PosVal, sign: number): PosVal {
  if (a.kind === 'cart' && b.kind === 'cart') {
    const r = { ...a.pose };
    for (const k of POS_KEYS) r[k] = a.pose[k] + sign * b.pose[k];
    return { kind: 'cart', pose: r, cfg: a.cfg, e: extArith(a.e, b.e, sign) };
  }
  if (a.kind === 'joint' && b.kind === 'joint') return { kind: 'joint', q: a.q.map((v, i) => v + sign * b.q[i]), e: extArith(a.e, b.e, sign) };
  throw new TPError('Cannot mix joint and Cartesian positions');
}

function extArith(a: number[] | undefined, b: number[] | undefined, sign: number) {
  if (!a && !b) return undefined;
  const n = Math.max(a?.length ?? 0, b?.length ?? 0);
  return Array.from({ length: n }, (_, i) => (a?.[i] ?? 0) + sign * (b?.[i] ?? 0));
}
