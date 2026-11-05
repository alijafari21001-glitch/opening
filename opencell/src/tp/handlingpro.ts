// Getting a robot's programs into FANUC ROBOGUIDE / HandlingPRO (or a real controller):
//  - check(): what would stop a program loading or running there
//  - setupProgram(): a TP program that recreates tool frames, user frames, PRs and Rs on the controller
//    (frames and registers live in .VR files, which can't be written outside the controller)
//  - pack(): every program as .LS + the setup program + load steps, ready to zip
import type { RobotCtrl } from '../state';
import { TPProgram, newProgram } from './program';
import { parseLine } from './parser';
import { toLS } from './ls';

export type Level = 'error' | 'warn';
export interface Finding { prog: string; level: Level; text: string }
export interface CheckOpts { shortNames: boolean }

const SETUP = 'OCSETUP';
const SCRATCH = 100;

const fmt = (v: number) => {
  const r = Math.round(v * 1000) / 1000;
  return r < 0 ? `(${r})` : String(r);
};
const cmt16 = (s: string) => s.replace(/[\]";]/g, '').slice(0, 16);
const zero = (p: { x: number; y: number; z: number; w: number; p: number; r: number }) => [p.x, p.y, p.z, p.w, p.p, p.r].every((v) => Math.abs(v) < 1e-9);

export function check(r: RobotCtrl, opts: CheckOpts = { shortNames: true }): Finding[] {
  const out: Finding[] = [];
  const names = new Set(Object.keys(r.programs));
  for (const p of Object.values(r.programs)) {
    const add = (level: Level, text: string) => out.push({ prog: p.name, level, text });
    if (!/^[A-Z][A-Z0-9_]*$/.test(p.name)) add('error', 'Name must start with a letter and use only A-Z, 0-9 and _.');
    else if (p.name.length > 36) add('error', 'Name is longer than 36 characters.');
    else if (opts.shortNames && p.name.length > 8) add('warn', `Name has ${p.name.length} characters. Older controllers (V7/V8) take 8.`);
    if (p.comment.length > 16) add('warn', `Program comment is cut to 16 characters ("${p.comment.slice(0, 16)}").`);
    const used = new Set<number>();
    p.lines.forEach((l, i) => {
      const n = i + 1;
      const r0 = parseLine(l);
      if (r0.error) add('error', `Line ${n}: ${r0.error}`);
      if (l.includes('...')) add('error', `Line ${n} still has an empty field (...).`);
      if (/^\s*!/.test(l) && l.trim().length > 33) add('warn', `Line ${n}: remark is longer than 32 characters; the pendant cuts it.`);
      for (const m of l.matchAll(/(?<![A-Z])P\[(\d+)/g)) used.add(+m[1]);
      const call = /^\s*(?:IF .*,\s*)?CALL\s+([A-Z][A-Z0-9_]*)/.exec(l);
      if (call && !names.has(call[1])) add('error', `Line ${n} calls ${call[1]}, which is not in this robot's programs.`);
      if (/UFRAME\[\d+\]|UTOOL\[\d+\]/.test(l) && !/=/.test(l)) { /* frame read, fine */ }
    });
    for (const n of used) if (!p.pos[n]) add('warn', `P[${n}] has no recorded position; it loads as uninitialized.`);
    for (const [k, v] of Object.entries(p.pos)) {
      if (v.cmt && v.cmt.length > 16) add('warn', `P[${k}] comment is cut to 16 characters.`);
      if (v.ext?.length && !r.rail) add('warn', `P[${k}] has extended axis values but this robot has no rail.`);
    }
    if (Object.values(p.pos).some((v) => v.ext?.length)) add('warn', 'Uses the rail (E1): the HandlingPRO robot needs the same extended axis set up in group 1.');
  }
  if (r.programs[SETUP]) out.push({ prog: SETUP, level: 'warn', text: `${SETUP} is replaced by the generated setup program in the pack.` });
  return out;
}

/** TP program that writes this robot's frames, position registers and registers onto the controller. Run it once. */
export function setupProgram(r: RobotCtrl): TPProgram {
  const p = newProgram(SETUP, 'OpenCell setup');
  const L = p.lines;
  const S = `PR[${SCRATCH}:OC scratch]`;
  L.push('!OpenCell setup: run ONCE', '!Frames, PRs and Rs from the cell', `!Uses ${S.replace(/:.*\]/, ']')} as scratch`);
  const zeroScratch = () => { L.push(`${S}=LPOS`, `${S}=${S}-${S}`); };
  const setComps = (target: string, vals: number[]) => vals.forEach((v, i) => { if (Math.abs(v) > 1e-9) L.push(`${target.replace(/\[(\d+)(:[^\]]*)?\]/, (_, n, c) => `[${n},${i + 1}${c ?? ''}]`)}=${fmt(v)}`); });
  const frames = (kind: 'UTOOL' | 'UFRAME', list: { comment: string; pose: { x: number; y: number; z: number; w: number; p: number; r: number } }[]) => {
    list.forEach((f, i) => {
      if (zero(f.pose)) return;
      L.push(`!${kind} ${i + 1}${f.comment ? ' ' + cmt16(f.comment) : ''}`);
      zeroScratch();
      const q = f.pose;
      setComps(S, [q.x, q.y, q.z, q.w, q.p, q.r]);
      L.push(`${kind}[${i + 1}]=${S}`);
    });
  };
  frames('UTOOL', r.tools);
  frames('UFRAME', r.users);
  r.PR.forEach((pr, n) => {
    if (!pr.v || n === SCRATCH || n === 0) return;
    const name = `PR[${n}${pr.cmt ? ':' + cmt16(pr.cmt) : ''}]`;
    L.push(`!${name}`);
    const ext = pr.v.ext ?? [];
    if (pr.v.joint) {
      L.push(`${name}=JPOS`);
      [...pr.v.joint, ...ext].forEach((v, i) => L.push(`${name.replace(/\[(\d+)/, `[$1,${i + 1}`)}=${fmt(v)}`));
    } else if (pr.v.cart) {
      zeroScratch();
      L.push(`${name}=${S}`);
      const q = pr.v.cart.pose;
      setComps(name, [q.x, q.y, q.z, q.w, q.p, q.r, ...ext]);
    }
  });
  r.R.forEach((reg, n) => {
    if (n === 0 || (!reg.v && !reg.cmt)) return;
    L.push(`R[${n}${reg.cmt ? ':' + cmt16(reg.cmt) : ''}]=${fmt(reg.v)}`);
  });
  L.push('MESSAGE[OpenCell setup done]');
  return p;
}

export function readme(r: RobotCtrl, files: string[], findings: Finding[]) {
  const errs = findings.filter((f) => f.level === 'error'), warns = findings.filter((f) => f.level === 'warn');
  return [
    `OpenCell export for ROBOGUIDE / HandlingPRO`,
    `Robot: ${r.name} (${r.model.name})   Exported: ${new Date().toLocaleString()}`,
    '',
    'FILES',
    ...files.map((f) => `  ${f}`),
    '',
    'LOAD INTO HANDLINGPRO',
    '  1. Open your workcell. Make sure the robot model matches and the tool is on the same UTOOL.',
    '  2. Cell Browser > right-click Programs > Load Program (or File > Load on the virtual TP).',
    '     Pick the .LS files. ROBOGUIDE turns each one into a .TP program on the robot.',
    '     If .LS is not offered, the robot needs the ASCII Upload option (Robot Properties > Software Options),',
    '     or convert the files to .TP first with MakeTP (installed with ROBOGUIDE).',
    `  3. Run ${SETUP} once in T1. It sets the tool frames, user frames, position registers and registers`,
    '     to the values from OpenCell (these live in .VR files, which can only be written on the controller).',
    '  4. Check the frames on SETUP > Frames, then run your main program in T1 at low override first.',
    '',
    `CHECK: ${errs.length} errors, ${warns.length} warnings`,
    ...findings.map((f) => `  [${f.level === 'error' ? 'ERROR' : 'warn '}] ${f.prog}: ${f.text}`),
    '',
  ].join('\r\n');
}

export function pack(r: RobotCtrl, opts?: CheckOpts): { name: string; data: string }[] {
  const findings = check(r, opts);
  const progs = Object.values(r.programs).filter((p) => p.name !== SETUP);
  const files = [...progs.map((p) => ({ name: `${p.name}.LS`, data: toLS(p) })), { name: `${SETUP}.LS`, data: toLS(setupProgram(r)) }];
  return [...files, { name: 'README.txt', data: readme(r, files.map((f) => f.name), findings) }];
}
