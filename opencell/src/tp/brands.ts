// Translate OpenCell (FANUC-style TP) programs to other robot languages:
//   ABB RAPID (.mod), Yaskawa Motoman INFORM (.JBI), Universal Robots URScript (.script).
// The translation is line by line from the parsed TP statements. What a language can't express is written as a
// comment and listed as a warning. Positions are written as Cartesian poses in the OpenCell world / user frame;
// joint positions are converted with the FANUC model's kinematics. Touch up positions on the target robot.
import type { RobotCtrl } from '../state';
import { TPProgram, TPPos } from './program';
import { parseLine, Expr, Stmt, Idx, PosRef } from './parser';
import { fk } from '../kin/robot';
import { Frame, Mat3, XYZWPR, compose, invert, poseToFrame, frameToPose } from '../kin/math';

export type Brand = 'abb' | 'yaskawa' | 'ur';
export const BRANDS: { id: Brand; name: string; ext: string; lang: string }[] = [
  { id: 'abb', name: 'ABB', ext: 'mod', lang: 'RAPID' },
  { id: 'yaskawa', name: 'Yaskawa Motoman', ext: 'JBI', lang: 'INFORM' },
  { id: 'ur', name: 'Universal Robots (cobot)', ext: 'script', lang: 'URScript' },
];
export interface Translation { files: { name: string; data: string }[]; warnings: string[] }

const n3 = (v: number) => (Math.round(v * 1000) / 1000).toString();
const ix = (i: Idx) => (typeof i === 'number' ? i : i === null ? 0 : NaN);
const DEG = Math.PI / 180;

function quat(R: Mat3): [number, number, number, number] {
  const [a, b, c, d, e, f, g, h, k] = R;
  const t = a + e + k;
  let w, x, y, z;
  if (t > 0) { const s = Math.sqrt(t + 1) * 2; w = s / 4; x = (h - f) / s; y = (c - g) / s; z = (d - b) / s; }
  else if (a > e && a > k) { const s = Math.sqrt(1 + a - e - k) * 2; w = (h - f) / s; x = s / 4; y = (b + d) / s; z = (c + g) / s; }
  else if (e > k) { const s = Math.sqrt(1 + e - a - k) * 2; w = (c - g) / s; x = (b + d) / s; y = s / 4; z = (f + h) / s; }
  else { const s = Math.sqrt(1 + k - a - e) * 2; w = (d - b) / s; x = (c + g) / s; y = (f + h) / s; z = s / 4; }
  if (w < 0) { w = -w; x = -x; y = -y; z = -z; }
  return [w, x, y, z];
}
export function rotvec(R: Mat3): [number, number, number] {
  const [w, x, y, z] = quat(R);
  const s = Math.sqrt(1 - Math.min(1, w * w));
  const ang = 2 * Math.acos(Math.min(1, w));
  return s < 1e-9 ? [0, 0, 0] : [x / s * ang, y / s * ang, z / s * ang];
}

/** A taught position as a Cartesian pose in its user frame (joint positions go through forward kinematics). */
function cartOf(r: RobotCtrl, p: TPPos): { pose: XYZWPR; uf: number; ut: number; fromJoint: boolean } {
  if (p.cart) return { pose: p.cart.pose, uf: p.uf, ut: p.ut, fromJoint: false };
  const tool = p.ut > 0 ? poseToFrame(r.tools[p.ut - 1].pose) : { R: [1, 0, 0, 0, 1, 0, 0, 0, 1] as Mat3, p: [0, 0, 0] as [number, number, number] };
  let f: Frame = fk(r.model, p.joint as [number, number, number, number, number, number], tool);
  if (p.ext?.[0]) f = { R: f.R, p: [f.p[0] + p.ext[0], f.p[1], f.p[2]] };
  if (p.uf > 0) f = compose(invert(poseToFrame(r.users[p.uf - 1].pose)), f);
  return { pose: frameToPose(f), uf: p.uf, ut: p.ut, fromJoint: true };
}

interface Ctx { r: RobotCtrl; prog: TPProgram; warn: (s: string) => void; line: number }
const stmts = (p: TPProgram) => p.lines.map((l, i) => ({ src: l, i: i + 1, ...parseLine(l) }));
const posOf = (c: Ctx, t: PosRef): TPPos | undefined => (t.reg === 'P' ? c.prog.pos[ix(t.idx)] : c.r.PR[ix(t.idx)]?.v);

// ============================================================ ABB RAPID
function rapidExpr(e: Expr, c: Ctx): string {
  switch (e.k) {
    case 'num': return n3(e.v);
    case 'bool': return e.v ? 'TRUE' : 'FALSE';
    case 'neg': return `-${rapidExpr(e.a, c)}`;
    case 'not': return `NOT ${rapidExpr(e.a, c)}`;
    case 'bin': {
      const op = ({ AND: 'AND', OR: 'OR', '<>': '<>', '=': '=', MOD: 'MOD', DIV: 'DIV' } as Record<string, string>)[e.op] ?? e.op;
      return `(${rapidExpr(e.a, c)} ${op} ${rapidExpr(e.b, c)})`;
    }
    case 'ref': {
      const n = ix(e.idx);
      if (e.port === 'R') return `R{${n}}`;
      if (e.port === 'PR') { prUsed.add(n); if (e.idx2 && e.idx2 <= 3) return `pr${n}.trans.${'xyz'[e.idx2 - 1]}`; if (!e.idx2) return `pr${n}`; }
      if (['DI', 'RI', 'UI', 'SI'].includes(e.port)) return `DInput(${e.port.toLowerCase()}_${n})`;
      if (['DO', 'RO', 'UO', 'SO'].includes(e.port)) return `DOutput(${e.port.toLowerCase()}_${n})`;
      if (e.port === 'GI') return `GInput(gi_${n})`;
      if (e.port === 'AI') return `AInput(ai_${n})`;
      c.warn(`line ${c.line}: ${e.port}[${n}] has no RAPID equivalent`); return `0`;
    }
    default: c.warn(`line ${c.line}: expression not translated`); return '0';
  }
}
const ON = (e: Expr) => (e.k === 'bool' ? (e.v ? 1 : 0) : e.k === 'num' ? (e.v ? 1 : 0) : null);
const ZONES = [0, 1, 5, 10, 15, 20, 30, 40, 50, 60, 80, 100, 150, 200];
const SPEEDS = [5, 10, 20, 30, 40, 50, 60, 80, 100, 150, 200, 300, 400, 500, 600, 800, 1000, 1500, 2000, 2500, 3000, 4000, 5000, 6000, 7000];
const nearest = (list: number[], v: number) => list.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a));

function rapidStmt(s: Stmt, c: Ctx, out: string[], ind: string, tgt: Map<string, string>): void {
  const o = (t: string) => out.push(ind + t);
  switch (s.k) {
    case 'blank': o(''); return;
    case 'remark': o(`! ${s.text}`); return;
    case 'disabled': o(`! //${s.text}`); return;
    case 'motion': {
      const name = `${s.target.reg === 'P' ? 'p' : 'pr'}${ix(s.target.idx)}`;
      const pos = posOf(c, s.target);
      if (s.target.reg === 'PR') prUsed.add(ix(s.target.idx));
      else if (!pos) c.warn(`line ${c.line}: P[${ix(s.target.idx)}] has no position`);
      else tgt.set(name, robtarget(c.r, pos));
      const sp = typeof s.speed.v === 'number' ? s.speed.v : 100;
      const v = s.speed.unit === '%' ? nearest(SPEEDS, sp * 20) : s.speed.unit === 'mm/sec' ? nearest(SPEEDS, sp) : s.speed.unit === 'cm/min' ? nearest(SPEEDS, sp / 6) : 100;
      const z = s.term.fine ? 'fine' : `z${nearest(ZONES, typeof s.term.cnt === 'number' ? s.term.cnt : 50)}`;
      const ut = s.target.reg === 'PR' ? cur.ut : pos?.ut ?? 1, uf = s.target.reg === 'PR' ? cur.uf : pos?.uf ?? 0;
      let target = name;
      if (s.offset) { const k = ix(s.offset.pr ?? null); prUsed.add(k); target = `Offs(${name},pr${k}.trans.x,pr${k}.trans.y,pr${k}.trans.z)`; if (!offNoted.has(c.prog.name)) { offNoted.add(c.prog.name); c.warn(`Offset,PR[] becomes Offs() (translation part only)`); } }
      if (s.type === 'C' && s.via) o(`MoveC p${ix(s.via.idx)}, ${target}, v${v}, ${z}, tool${ut}\\WObj:=wobj${uf};`);
      else o(`Move${s.type === 'J' ? 'J' : 'L'} ${target}, v${v}, ${z}, tool${ut}\\WObj:=wobj${uf};`);
      if (s.opts.length) c.warn(`line ${c.line}: motion options ${s.opts.join(' ')} dropped`);
      return;
    }
    case 'label': o(`lbl${ix(s.n)}:`); return;
    case 'jmp': o(`GOTO lbl${ix(s.n)};`); return;
    case 'call': o(`${s.prog};`); if (s.args.length) c.warn(`line ${c.line}: CALL arguments dropped`); return;
    case 'assign': {
      const n = ix(s.idx);
      if (s.port === 'R') { o(`R{${n}} := ${rapidExpr(s.expr, c)};`); return; }
      if (s.port === 'PR') {
        prUsed.add(n);
        const e = s.expr;
        if (s.idx2) { if (s.idx2 <= 3) { o(`pr${n}.trans.${'xyz'[s.idx2 - 1]} := ${rapidExpr(e, c)};`); return; } c.warn(`line ${c.line}: PR[${n},${s.idx2}] (rotation / joint element) not translated`); o(`! ${c.prog.lines[c.line - 1]}`); return; }
        if (e.k === 'lpos') { o(`pr${n} := CRobT(\\Tool:=tool1\\WObj:=wobj0);`); return; }
        if (e.k === 'ref' && e.port === 'PR') { prUsed.add(ix(e.idx)); o(`pr${n} := pr${ix(e.idx)};`); return; }
        if (e.k === 'bin' && (e.op === '+' || e.op === '-') && e.a.k === 'ref' && e.a.port === 'PR' && e.b.k === 'ref' && e.b.port === 'PR') {
          const a = ix(e.a.idx), b = ix(e.b.idx), sg = e.op === '+' ? '' : '-'; prUsed.add(a); prUsed.add(b);
          o(`pr${n} := Offs(pr${a}, ${sg}pr${b}.trans.x, ${sg}pr${b}.trans.y, ${sg}pr${b}.trans.z);`); return;
        }
        c.warn(`line ${c.line}: PR assignment not translated`); o(`! ${c.prog.lines[c.line - 1]}`); return;
      }
      if (['DO', 'RO', 'UO', 'SO'].includes(s.port)) { const b = ON(s.expr); o(b === null ? `SetDO ${s.port.toLowerCase()}_${n}, ${rapidExpr(s.expr, c)};` : `SetDO ${s.port.toLowerCase()}_${n}, ${b};`); return; }
      if (s.port === 'GO') { o(`SetGO go_${n}, ${rapidExpr(s.expr, c)};`); return; }
      if (s.port === 'AO') { o(`SetAO ao_${n}, ${rapidExpr(s.expr, c)};`); return; }
      c.warn(`line ${c.line}: ${s.port} assignment not translated`); o(`! ${c.prog.lines[c.line - 1]}`); return;
    }
    case 'pulse': o(`PulseDO${s.width ? `\\PLength:=${n3(s.width)}` : ''} ${s.port.toLowerCase()}_${ix(s.idx)};`); return;
    case 'wait_time': o(`WaitTime ${rapidExpr(s.t, c)};`); return;
    case 'wait': {
      const e = s.cond;
      if (e.k === 'bin' && e.op === '=' && e.a.k === 'ref' && ['DI', 'RI'].includes(e.a.port) && ON(e.b) !== null) { o(`WaitDI ${e.a.port.toLowerCase()}_${ix(e.a.idx)}, ${ON(e.b)};`); return; }
      o(`WaitUntil ${rapidExpr(e, c)};`); return;
    }
    case 'if': {
      const t: string[] = []; rapidStmt(s.then, c, t, '', tgt);
      o(`IF ${rapidExpr(s.cond, c)} ${t.join(' ').trim()}`); return;
    }
    case 'if_then': o(`IF ${rapidExpr(s.cond, c)} THEN`); return;
    case 'else': o('ELSE'); return;
    case 'endif': o('ENDIF'); return;
    case 'for': o(`R{${ix(s.reg)}} := ${rapidExpr(s.from, c)};`); o(`WHILE R{${ix(s.reg)}} ${s.down ? '>=' : '<='} ${rapidExpr(s.to, c)} DO`); forStack.push(`R{${ix(s.reg)}} := R{${ix(s.reg)}} ${s.down ? '-' : '+'} 1;`); return;
    case 'endfor': o(forStack.pop() ?? ''); o('ENDWHILE'); return;
    case 'message': o(`TPWrite "${s.text.replace(/"/g, "'")}";`); return;
    case 'pause': o('Stop;'); return;
    case 'abort': o('EXIT;'); return;
    case 'end': o('RETURN;'); return;
    case 'override': o(`VelSet ${rapidExpr(s.v, c)}, 5000;`); return;
    case 'frame_num': if (s.expr.k === 'num') cur[s.which === 'UTOOL_NUM' ? 'ut' : 'uf'] = s.expr.v; o(`! ${s.which}=${rapidExpr(s.expr, c)} (each move names its tool and work object)`); return;
    default: c.warn(`line ${c.line}: ${s.k} not translated`); o(`! ${c.prog.lines[c.line - 1]}`);
  }
}
const forStack: string[] = [];
const prUsed = new Set<number>();
const offNoted = new Set<string>();
const cur = { ut: 1, uf: 0 };
function robtarget(r: RobotCtrl, pos: TPPos) {
  const q = cartOf(r, pos);
  return `[[${n3(q.pose.x)},${n3(q.pose.y)},${n3(q.pose.z)}],[${quat(poseToFrame(q.pose).R).map((v) => v.toFixed(6)).join(',')}],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]]`;
}

function toRAPID(r: RobotCtrl, progs: TPProgram[], warn: (s: string) => void) {
  const tgt = new Map<string, string>();
  const body: string[] = [];
  const io = new Set<string>();
  for (const p of progs) {
    body.push(`  PROC ${p.name}()`, `    ! ${p.comment}`);
    for (const st of stmts(p)) {
      const c: Ctx = { r, prog: p, warn: (s) => warn(`${p.name} ${s}`), line: st.i };
      if (st.error) { c.warn(`line ${st.i}: ${st.error}`); body.push(`    ! ${st.src}`); continue; }
      for (const m of st.src.matchAll(/\b(DI|DO|RI|RO|GI|GO|AI|AO)\[(\d+)/g)) io.add(`${m[1].toLowerCase()}_${m[2]}`);
      rapidStmt(st.stmt, c, body, '    ', tgt);
    }
    body.push('  ENDPROC', '');
  }
  const usedT = new Set<number>(), usedW = new Set<number>();
  for (const l of body) { for (const m of l.matchAll(/tool(\d+)/g)) usedT.add(+m[1]); for (const m of l.matchAll(/wobj(\d+)/g)) usedW.add(+m[1]); }
  const fr = (q: XYZWPR) => `[[${n3(q.x)},${n3(q.y)},${n3(q.z)}],[${quat(poseToFrame(q).R).map((v) => v.toFixed(6)).join(',')}]]`;
  const head = [
    `MODULE ${progs[0]?.name ?? 'OPENCELL'}_MOD`,
    `  ! Exported from OpenCell ${new Date().toISOString().slice(0, 10)}. Robot model in OpenCell: ${r.model.name}.`,
    '  ! Positions are in the OpenCell world / user frames: touch them up on the ABB robot.',
    `  ! I/O signals to create in the I/O configuration: ${[...io].join(', ') || 'none'}`,
    '  VAR num R{200};',
    ...[...usedT].filter((n) => n > 0).map((n) => `  PERS tooldata tool${n} := [TRUE,${fr(r.tools[n - 1].pose)},[1,[0,0,50],[1,0,0,0],0,0,0]]; ! ${r.tools[n - 1].comment}`),
    ...[...usedW].filter((n) => n > 0).map((n) => `  PERS wobjdata wobj${n} := [FALSE,TRUE,"",${fr(r.users[n - 1].pose)},[[0,0,0],[1,0,0,0]]]; ! ${r.users[n - 1].comment}`),
    ...[...tgt].map(([k, v]) => `  CONST robtarget ${k} := ${v};`),
    ...[...prUsed].sort((a, b) => a - b).map((n) => `  VAR robtarget pr${n} := ${r.PR[n]?.v ? robtarget(r, r.PR[n].v!) : '[[0,0,0],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]]'}; ! PR[${n}]${r.PR[n]?.cmt ? ' ' + r.PR[n].cmt : ''}`),
    '',
  ];
  if (usedT.has(0)) warn('Some positions use UTOOL 0: written as tool0.');
  return [...head, ...body, 'ENDMODULE', ''].join('\r\n');
}

// ============================================================ Yaskawa INFORM (.JBI)
function informCond(e: Expr, c: Ctx): string | null {
  if (e.k === 'bin' && ['=', '<>', '<', '>', '<=', '>='].includes(e.op) && e.a.k === 'ref') {
    const n = ix(e.a.idx);
    const rhs = e.b.k === 'bool' ? (e.b.v ? 'ON' : 'OFF') : e.b.k === 'num' ? (['DI', 'RI'].includes(e.a.port) ? (e.b.v ? 'ON' : 'OFF') : n3(e.b.v))
      : e.b.k === 'ref' && e.b.port === 'R' ? `D${String(ix(e.b.idx)).padStart(3, '0')}` : null;
    if (rhs === null) return null;
    if (['DI', 'RI'].includes(e.a.port)) return `IN#(${n})${e.op === '<>' ? '<>' : '='}${rhs}`;
    if (['DO', 'RO'].includes(e.a.port)) return `OT#(${n})${e.op === '<>' ? '<>' : '='}${rhs}`;
    if (e.a.port === 'R') return `D${String(n).padStart(3, '0')}${e.op}${rhs}`;
  }
  c.warn(`line ${c.line}: condition not translated`);
  return null;
}
function toJBI(r: RobotCtrl, p: TPProgram, warn: (s: string) => void) {
  const pts: { pose: XYZWPR; uf: number; ut: number }[] = [];
  const key = new Map<string, number>();
  const inst: string[] = ['NOP'];
  const D = (n: number) => `D${String(n).padStart(3, '0')}`;
  const P = (n: number) => `P${String(n).padStart(3, '0')}`;
  for (const st of stmts(p)) {
    const c: Ctx = { r, prog: p, warn: (s) => warn(`${p.name} ${s}`), line: st.i };
    const o = (t: string) => inst.push(t);
    if (st.error) { c.warn(`line ${st.i}: ${st.error}`); o(`'${st.src}`); continue; }
    const s = st.stmt;
    const one = (s: Stmt): string | null => {
      switch (s.k) {
        case 'jmp': return `JUMP *L${ix(s.n)}`;
        case 'call': return `CALL JOB:${s.prog}`;
        default: return null;
      }
    };
    switch (s.k) {
      case 'blank': break;
      case 'remark': o(`'${s.text}`); break;
      case 'motion': {
        const pos = posOf(c, s.target);
        let cn: string;
        if (s.target.reg === 'PR') cn = P(ix(s.target.idx));
        else {
          if (!pos) { c.warn(`line ${st.i}: P[${ix(s.target.idx)}] has no position`); o(`'${st.src}`); break; }
          const k = `P${ix(s.target.idx)}`;
          if (!key.has(k)) { key.set(k, pts.length); pts.push(cartOf(r, pos)); }
          cn = `C${String(key.get(k)).padStart(5, '0')}`;
        }
        const sp = typeof s.speed.v === 'number' ? s.speed.v : 50;
        const pl = s.term.fine ? '' : ` PL=${Math.min(8, Math.round((typeof s.term.cnt === 'number' ? s.term.cnt : 50) / 12.5))}`;
        if (s.offset) { o(`SFTON ${P(ix(s.offset.pr ?? null))}`); }
        if (s.type === 'J') o(`MOVJ ${cn} VJ=${(s.speed.unit === '%' ? sp : 50).toFixed(2)}${pl}`);
        else o(`MOV${s.type === 'C' ? 'C' : 'L'} ${cn} V=${(s.speed.unit === 'mm/sec' ? sp : s.speed.unit === 'cm/min' ? sp / 6 : 250).toFixed(1)}${pl}`);
        if (s.offset) o('SFTOF');
        break;
      }
      case 'label': o(`*L${ix(s.n)}`); break;
      case 'jmp': case 'call': o(one(s)!); break;
      case 'assign': {
        const n = ix(s.idx);
        const b = ON(s.expr);
        if (['DO', 'RO'].includes(s.port) && b !== null) { o(`DOUT OT#(${n}) ${b ? 'ON' : 'OFF'}`); break; }
        if (s.port === 'R') {
          const e = s.expr;
          if (e.k === 'num') { o(`SET ${D(n)} ${n3(e.v)}`); break; }
          if (e.k === 'bin' && e.a.k === 'ref' && e.a.port === 'R' && ix(e.a.idx) === n && e.b.k === 'num' && (e.op === '+' || e.op === '-')) {
            o(e.b.v === 1 ? `${e.op === '+' ? 'INC' : 'DEC'} ${D(n)}` : `${e.op === '+' ? 'ADD' : 'SUB'} ${D(n)} ${n3(e.b.v)}`); break;
          }
          if (e.k === 'ref' && e.port === 'R') { o(`SET ${D(n)} ${D(ix(e.idx))}`); break; }
          if (e.k === 'ref' && e.port === 'PR' && e.idx2) { o(`GETE ${D(n)} ${P(ix(e.idx))} (${e.idx2})`); break; }
        }
        if (s.port === 'PR') {
          const e = s.expr;
          if (s.idx2 && e.k === 'num') { o(`SETE ${P(n)} (${s.idx2}) ${n3(e.v)}`); break; }
          if (s.idx2 && e.k === 'ref' && e.port === 'R') { o(`SETE ${P(n)} (${s.idx2}) ${D(ix(e.idx))}`); break; }
          if (!s.idx2 && e.k === 'ref' && e.port === 'PR') { o(`SET ${P(n)} ${P(ix(e.idx))}`); break; }
          if (!s.idx2 && e.k === 'bin' && (e.op === '+' || e.op === '-') && e.a.k === 'ref' && e.a.port === 'PR' && e.b.k === 'ref' && e.b.port === 'PR') {
            if (ix(e.a.idx) !== n) o(`SET ${P(n)} ${P(ix(e.a.idx))}`);
            o(`${e.op === '+' ? 'ADD' : 'SUB'} ${P(n)} ${P(ix(e.b.idx))}`); break;
          }
          if (!s.idx2 && e.k === 'lpos') { o(`GETS ${P(n)} $PX000`); break; }
        }
        c.warn(`line ${st.i}: assignment not translated`); o(`'${st.src}`); break;
      }
      case 'pulse': o(`PULSE OT#(${ix(s.idx)})${s.width ? ` T=${n3(s.width)}` : ''}`); break;
      case 'wait_time': o(`TIMER T=${s.t.k === 'num' ? s.t.v.toFixed(2) : '1.00'}`); break;
      case 'wait': { const cd = informCond(s.cond, c); o(cd ? `WAIT ${cd}` : `'${st.src}`); break; }
      case 'if': { const cd = informCond(s.cond, c), a = one(s.then); if (cd && a) o(`${a} IF ${cd}`); else { c.warn(`line ${st.i}: IF not translated`); o(`'${st.src}`); } break; }
      case 'message': o(`MSG "${s.text.slice(0, 32)}"`); break;
      case 'pause': o('PAUSE'); break;
      case 'abort': case 'end': o('END'); break;
      case 'frame_num': o(`'${st.src}`); break;
      default: c.warn(`line ${st.i}: ${s.k} not translated`); o(`'${st.src}`);
    }
  }
  if (inst[inst.length - 1] !== 'END') inst.push('END');
  const pos: string[] = [];
  let last = '';
  pts.forEach((q, i) => {
    const h = `${q.uf}/${q.ut}`;
    if (h !== last) {
      last = h;
      if (q.uf > 0) pos.push(`///USER ${q.uf}`);
      pos.push(`///TOOL ${q.ut}`, `///POSTYPE ${q.uf > 0 ? 'USER' : 'ROBOT'}`, '///RECTAN', '///RCONF 0,0,0,0,0,0,0,0');
    }
    const v = q.pose;
    pos.push(`C${String(i).padStart(5, '0')}=${[v.x, v.y, v.z, v.w, v.p, v.r].map((x) => x.toFixed(3)).join(',')}`);
  });
  const d = new Date(), two = (x: number) => String(x).padStart(2, '0');
  return ['/JOB', `//NAME ${p.name}`, '//POS', `///NPOS ${pts.length},0,0,0,0,0`, ...pos, '//INST',
    `///DATE ${d.getFullYear()}/${two(d.getMonth() + 1)}/${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}`,
    `///COMM ${p.comment.slice(0, 32)}`, '///ATTR SC,RW', '///GROUP1 RB1', ...inst, ''].join('\r\n');
}

// ============================================================ Universal Robots URScript
function urExpr(e: Expr, c: Ctx): string {
  switch (e.k) {
    case 'num': return n3(e.v);
    case 'bool': return e.v ? 'True' : 'False';
    case 'neg': return `-${urExpr(e.a, c)}`;
    case 'not': return `not ${urExpr(e.a, c)}`;
    case 'bin': {
      const op = ({ AND: 'and', OR: 'or', '<>': '!=', '=': '==', MOD: '%', DIV: '/' } as Record<string, string>)[e.op] ?? e.op;
      return `(${urExpr(e.a, c)} ${op} ${urExpr(e.b, c)})`;
    }
    case 'ref': {
      const n = ix(e.idx);
      if (e.port === 'R') return `r${n}`;
      if (e.port === 'PR') { prUsed.add(n); if (e.idx2 && e.idx2 <= 3) return `(pr${n}[${e.idx2 - 1}] * 1000)`; if (!e.idx2) return `pr${n}`; }
      if (['DI', 'RI'].includes(e.port)) return `get_standard_digital_in(${(n - 1) % 8})`;
      if (['DO', 'RO'].includes(e.port)) return `get_standard_digital_out(${(n - 1) % 8})`;
      if (e.port === 'AI') return `get_standard_analog_in(${(n - 1) % 2})`;
      c.warn(`line ${c.line}: ${e.port}[${n}] has no URScript equivalent`); return '0';
    }
    default: c.warn(`line ${c.line}: expression not translated`); return '0';
  }
}
function toURScript(r: RobotCtrl, progs: TPProgram[], main: string, warn: (s: string) => void) {
  const regs = new Set<number>();
  const defs: string[] = [];
  for (const p of progs) {
    const list = stmts(p);
    // loops: "LBL[n] ... JMP LBL[n]" (or "IF cond,JMP LBL[n]") back to a label becomes a while loop
    const back = new Map<number, { end: number; cond?: Expr }>();
    list.forEach((st, k) => {
      const s = st.stmt;
      const j = s?.k === 'jmp' ? ix(s.n) : s?.k === 'if' && s.then.k === 'jmp' ? ix(s.then.n) : null;
      if (j === null) return;
      const at = list.findIndex((x) => x.stmt?.k === 'label' && ix(x.stmt.n) === j);
      if (at >= 0 && at < k) back.set(at, { end: k, cond: s.k === 'if' ? s.cond : undefined });
    });
    // "IF cond,JMP LBL[n]" forward to a label: the lines in between run only when cond is false
    const fwd = new Map<number, { to: number; cond: Expr }>();
    list.forEach((st, k) => {
      const s = st.stmt;
      if (s?.k !== 'if' || s.then.k !== 'jmp') return;
      const j = ix(s.then.n);
      const at = list.findIndex((x) => x.stmt?.k === 'label' && ix(x.stmt.n) === j);
      if (at > k) fwd.set(k, { to: at, cond: s.cond });
    });
    const closeAt: number[] = [];
    const out: string[] = [`  def ${p.name.toLowerCase()}():`, `    # ${p.comment}`];
    let ind = '    ';
    const ends: number[] = [];
    list.forEach((st, k) => {
      const c: Ctx = { r, prog: p, warn: (s) => warn(`${p.name} ${s}`), line: st.i };
      const o = (t: string) => out.push(ind + t);
      for (const m of st.src.matchAll(/\bR\[(\d+)/g)) regs.add(+m[1]);
      if (st.error) { c.warn(`line ${st.i}: ${st.error}`); o(`# ${st.src}`); return; }
      const s = st.stmt;
      while (closeAt.length && closeAt[closeAt.length - 1] === k) { closeAt.pop(); ind = ind.slice(2); o('end'); }
      if (fwd.has(k)) { const f = fwd.get(k)!; o(`if not ${urExpr(f.cond, c)}:  # ${st.src}`); ind += '  '; closeAt.push(f.to); return; }
      if (ends.length && ends[ends.length - 1] === k) {
        const b = [...back.values()].find((x) => x.end === k)!;
        if (b.cond) { o(`if not ${urExpr(b.cond, c)}:`); o('  break'); o('end'); }
        ends.pop(); ind = ind.slice(2); o('end'); return;
      }
      switch (s.k) {
        case 'blank': return;
        case 'remark': o(`# ${s.text}`); return;
        case 'label': if (back.has(k)) { o(`while True:  # LBL[${ix(s.n)}]`); ind += '  '; ends.push(back.get(k)!.end); } else o(`# LBL[${ix(s.n)}]`); return;
        case 'jmp': c.warn(`line ${st.i}: forward JMP has no URScript equivalent`); o(`# ${st.src}`); return;
        case 'motion': {
          const pos = posOf(c, s.target);
          const isPR = s.target.reg === 'PR';
          if (!pos && !isPR) { c.warn(`line ${st.i}: P[${ix(s.target.idx)}] has no position`); o(`# ${st.src}`); return; }
          const q = pos ? cartOf(r, pos) : { pose: { x: 0, y: 0, z: 0, w: 0, p: 0, r: 0 }, uf: 0, ut: curTool < 0 ? 1 : curTool, fromJoint: false };
          const rv = rotvec(poseToFrame(q.pose).R);
          let pose = isPR ? (prUsed.add(ix(s.target.idx)), `pr${ix(s.target.idx)}`) : `p[${[q.pose.x / 1000, q.pose.y / 1000, q.pose.z / 1000].map((v) => v.toFixed(5)).join(', ')}, ${rv.map((v) => v.toFixed(5)).join(', ')}]`;
          if (s.offset) { const k = ix(s.offset.pr ?? null); prUsed.add(k); pose = `pose_add(${pose}, p[pr${k}[0], pr${k}[1], pr${k}[2], 0, 0, 0])`; }
          if (q.uf > 0) pose = `pose_trans(uf${q.uf}, ${pose})`;
          const sp = typeof s.speed.v === 'number' ? s.speed.v : 50;
          const blend = s.term.fine ? '' : `, r=${((typeof s.term.cnt === 'number' ? s.term.cnt : 50) / 100 * 0.05).toFixed(3)}`;
          if (q.ut !== curTool) { o(`set_tcp(tcp${q.ut})`); curTool = q.ut; }
          if (s.type === 'J') o(`movej(${pose}, a=1.4, v=${(Math.min(100, sp) / 100 * 3.14).toFixed(2)}${blend})  # ${s.target.reg}[${ix(s.target.idx)}]`);
          else o(`movel(${pose}, a=1.2, v=${((s.speed.unit === 'mm/sec' ? sp : 250) / 1000).toFixed(3)}${blend})  # ${s.target.reg}[${ix(s.target.idx)}]`);
          return;
        }
        case 'call': o(`${s.prog.toLowerCase()}()`); return;
        case 'assign': {
          const n = ix(s.idx);
          if (s.port === 'R') { o(`r${n} = ${urExpr(s.expr, c)}`); return; }
          if (s.port === 'PR') {
            prUsed.add(n);
            const e = s.expr;
            if (s.idx2) { if (s.idx2 <= 3) { o(`pr${n}[${s.idx2 - 1}] = ${urExpr(e, c)} / 1000`); return; } c.warn(`line ${st.i}: PR[${n},${s.idx2}] (rotation / joint element) not translated`); o(`# ${st.src}`); return; }
            if (e.k === 'lpos') { o(`pr${n} = get_actual_tcp_pose()`); return; }
            if (e.k === 'ref' && e.port === 'PR') { prUsed.add(ix(e.idx)); o(`pr${n} = pr${ix(e.idx)}`); return; }
            if (e.k === 'bin' && (e.op === '+' || e.op === '-') && e.a.k === 'ref' && e.a.port === 'PR' && e.b.k === 'ref' && e.b.port === 'PR') {
              const a = ix(e.a.idx), b = ix(e.b.idx); prUsed.add(a); prUsed.add(b);
              o(`pr${n} = p[pr${a}[0] ${e.op} pr${b}[0], pr${a}[1] ${e.op} pr${b}[1], pr${a}[2] ${e.op} pr${b}[2], pr${a}[3], pr${a}[4], pr${a}[5]]`); return;
            }
            c.warn(`line ${st.i}: PR assignment not translated`); o(`# ${st.src}`); return;
          }
          if (['DO', 'RO'].includes(s.port)) { if (n > 8) c.warn(`line ${st.i}: ${s.port}[${n}] mapped to standard output ${(n - 1) % 8}`); const b = ON(s.expr); o(`set_standard_digital_out(${(n - 1) % 8}, ${b === null ? urExpr(s.expr, c) : b ? 'True' : 'False'})`); return; }
          if (s.port === 'AO') { o(`set_standard_analog_out(${(n - 1) % 2}, ${urExpr(s.expr, c)})`); return; }
          c.warn(`line ${st.i}: assignment not translated`); o(`# ${st.src}`); return;
        }
        case 'wait_time': o(`sleep(${urExpr(s.t, c)})`); return;
        case 'wait': o(`while not ${urExpr(s.cond, c)}:`); o('  sync()'); o('end'); return;
        case 'if': {
          if (s.then.k === 'call') { o(`if ${urExpr(s.cond, c)}:`); o(`  ${s.then.prog.toLowerCase()}()`); o('end'); return; }
          c.warn(`line ${st.i}: IF not translated`); o(`# ${st.src}`); return;
        }
        case 'if_then': o(`if ${urExpr(s.cond, c)}:`); ind += '  '; return;
        case 'else': ind = ind.slice(2); o('else:'); ind += '  '; return;
        case 'endif': ind = ind.slice(2); o('end'); return;
        case 'message': o(`popup("${s.text.replace(/"/g, "'")}", blocking=False)`); return;
        case 'pause': o('halt()'); return;
        case 'abort': o('halt()'); return;
        case 'end': o('return None'); return;
        case 'frame_num': o(`# ${st.src}`); return;
        default: c.warn(`line ${st.i}: ${s.k} not translated`); o(`# ${st.src}`);
      }
    });
    while (ends.length) { ends.pop(); ind = ind.slice(2); out.push(ind + 'end'); }
    out.push('  end', '');
    defs.push(...out);
  }
  const tcp = (q: XYZWPR) => { const v = rotvec(poseToFrame(q).R); return `p[${[q.x / 1000, q.y / 1000, q.z / 1000, ...v].map((x) => x.toFixed(5)).join(', ')}]`; };
  return [
    `def ${main.toLowerCase()}_program():`,
    `  # Exported from OpenCell ${new Date().toISOString().slice(0, 10)} (${r.model.name} positions, metres + rotation vectors).`,
    '  # Touch up the positions on the UR robot; DI/DO map to standard digital I/O 0-7.',
    ...r.tools.map((t, i) => `  tcp${i + 1} = ${tcp(t.pose)}${t.comment ? `  # ${t.comment}` : ''}`).filter((_, i) => i === 0 || !isZero(r.tools[i].pose)), '  tcp0 = p[0, 0, 0, 0, 0, 0]',
    ...r.users.map((u, i) => `  uf${i + 1} = ${tcp(u.pose)}`).filter((_, i) => !isZero(r.users[i].pose)),
    ...[...regs].sort((a, b) => a - b).map((n) => `  global r${n} = ${n3(r.R[n]?.v ?? 0)}`),
    ...[...prUsed].sort((a, b) => a - b).map((n) => { const v = r.PR[n]?.v; const q = v ? cartOf(r, v).pose : { x: 0, y: 0, z: 0, w: 0, p: 0, r: 0 }; return `  global pr${n} = ${tcp(q)}${r.PR[n]?.cmt ? '  # ' + r.PR[n].cmt : ''}`; }),
    ...defs,
    `  ${main.toLowerCase()}()`,
    'end', '',
  ].join('\n');
}
let curTool = -1;
const isZero = (q: XYZWPR) => [q.x, q.y, q.z, q.w, q.p, q.r].every((v) => Math.abs(v) < 1e-9);

export function translate(r: RobotCtrl, brand: Brand, main?: string): Translation {
  const warnings: string[] = [];
  const warn = (s: string) => warnings.push(s);
  const progs = Object.values(r.programs).filter((p) => p.name !== 'OCSETUP');
  forStack.length = 0; curTool = -1; prUsed.clear(); offNoted.clear(); cur.ut = 1; cur.uf = 0;
  if (brand === 'abb') return { files: [{ name: `${main ?? progs[0]?.name ?? 'OPENCELL'}.mod`, data: toRAPID(r, progs, warn) }], warnings };
  if (brand === 'yaskawa') return { files: progs.map((p) => ({ name: `${p.name}.JBI`, data: toJBI(r, p, warn) })), warnings };
  const m = main && r.programs[main] ? main : progs[0]?.name ?? 'MAIN';
  return { files: [{ name: `${m.toLowerCase()}.script`, data: toURScript(r, progs, m, warn) }], warnings };
}
export const DEG2RAD = DEG;
