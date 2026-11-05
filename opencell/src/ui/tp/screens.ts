// Pendant screens: SELECT, POSITION, DATA, I/O, SETUP Frames, position detail, ALARM.
import { Screen, PendantApi, Key, esc, fmt, scrollIntoView } from './core';
import { newProgram, validProgramName, TPPos, cfgText, TPProgram } from '../../tp/program';
import { frameToPose, poseToFrame, compose, invert, XYZWPR, Frame } from '../../kin/math';
import { configString, fk, fkFlange, Joints, ikFlange, sameConfig, Config, turnOf } from '../../kin/robot';
import { IOPort, FrameEntry } from '../../state';
import { lite } from '../../tp/interp';
import { tcpFromPoints, toolOrientation, userFrameFromPoints, FrameTeachError } from '../../kin/frames';
import { recordPos } from './edit';

const AX = ['X', 'Y', 'Z', 'W', 'P', 'R'];
const KEYS = ['x', 'y', 'z', 'w', 'p', 'r'] as const;

// ---------------------------------------------------------------- SELECT

export class SelectScreen implements Screen {
  id = 'SELECT';
  row = 0;
  constructor(private api: PendantApi) {}
  private names() { return Object.keys(this.api.s.programs).sort(); }
  title() { return 'Select'; }
  titleRight() { return `${this.names().length} programs`; }
  pages() { return 1; }
  fkeys() { return ['', 'CREATE', 'DELETE', 'COPY', 'DETAIL']; }
  show() { const i = this.names().indexOf(this.api.s.selected); if (i >= 0) this.row = i; }
  render(body: HTMLElement) {
    const s = this.api.s;
    const names = this.names();
    this.row = Math.min(this.row, Math.max(0, names.length - 1));
    body.innerHTML = `<table>${names.map((n, i) => {
      const p = s.programs[n];
      return `<tr class="${i === this.row ? 'cur' : ''}" data-r="${i}"><td class="n">${i + 1}</td><td>${n === s.selected ? '*' : ''}</td><td>${esc(n)}</td><td>${esc(p.comment)}</td><td class="n">${p.lines.length}</td></tr>`;
    }).join('')}</table><div class="hint">ENTER opens the program in EDIT. Lines shown on the right.</div>`;
    body.querySelectorAll<HTMLElement>('[data-r]').forEach((r) => {
      r.addEventListener('click', () => { this.row = +r.dataset.r!; this.api.redraw(); });
      r.addEventListener('dblclick', () => { this.row = +r.dataset.r!; this.key('ENTER'); });
    });
    scrollIntoView(body);
  }
  key(k: Key): boolean {
    const names = this.names();
    if (k === 'UP') { this.row = Math.max(0, this.row - 1); return true; }
    if (k === 'DOWN') { this.row = Math.min(names.length - 1, this.row + 1); return true; }
    if (k === 'ENTER' && names[this.row]) {
      if (this.api.interp.running) { this.api.prompt('Program is running', 'warn'); return true; }
      this.api.s.selected = names[this.row];
      this.api.interp.setCursor(names[this.row], 0);
      this.api.s.emit();
      this.api.open('EDIT');
      return true;
    }
    return false;
  }
  fkey(i: number) {
    const s = this.api.s;
    const name = this.names()[this.row];
    const askName = (title: string, cb: (n: string) => void) => this.api.askText(title, '', (v) => {
      const n = v.trim().toUpperCase();
      if (!validProgramName(n)) { this.api.prompt('Name: letters, digits, _ ; start with a letter (max 36)', 'warn'); return; }
      if (s.programs[n]) { this.api.prompt(`${n} already exists`, 'warn'); return; }
      cb(n);
    });
    if (i === 2) askName('Program name:', (n) => { s.programs[n] = newProgram(n); s.selected = n; s.emit(); this.api.open('EDIT'); });
    if (i === 3 && name) this.api.confirm(`Delete ${name}?`, () => {
      delete s.programs[name];
      if (s.selected === name) s.selected = this.names()[0] ?? '';
      s.emit();
    });
    if (i === 4 && name) askName(`Copy ${name} to:`, (n) => { s.programs[n] = { ...JSON.parse(JSON.stringify(s.programs[name])), name: n }; s.emit(); });
    if (i === 5 && name) this.api.askText(`Comment for ${name}:`, s.programs[name].comment, (v) => { s.programs[name].comment = v.slice(0, 16); s.emit(); });
  }
}

// ---------------------------------------------------------------- POSITION

export class PosnScreen implements Screen {
  id = 'POSN';
  disp: 'JNT' | 'USER' | 'WORLD' = 'JNT';
  constructor(private api: PendantApi) {}
  title() { return 'POSITION'; }
  titleRight() { const s = this.api.s; return this.disp === 'JNT' ? 'Joint' : this.disp === 'USER' ? `User  UF:${s.uframe} UT:${s.utool}` : `World  UT:${s.utool}`; }
  fkeys() { return ['JNT', 'USER', 'WORLD', '', '']; }
  show() { const c = this.api.s.coord; this.disp = c === 'JOINT' ? 'JNT' : c === 'WORLD' || c === 'JGFRM' ? 'WORLD' : 'USER'; }
  render(body: HTMLElement) {
    const s = this.api.s;
    const w = s.warnings();
    const warn = [w.wrist && 'Wrist singularity (J5 near 0)', w.shoulder && 'Shoulder singularity (wrist over J1 axis)', w.elbow && 'Arm near full reach'].filter(Boolean);
    let rows: string;
    if (this.disp === 'JNT') {
      rows = s.q.map((v, i) => {
        const [lo, hi] = s.model.limits[i];
        const near = v - lo < 5 || hi - v < 5;
        return `<tr><td>J${i + 1}</td><td class="n ${near ? 'warn' : ''}">${fmt(v)}</td><td>deg</td><td class="hint">${lo} .. ${hi}</td></tr>`;
      }).join('');
    } else {
      const p: XYZWPR = this.disp === 'USER' ? s.tcpUser() : frameToPose(s.tcpWorld());
      rows = KEYS.map((k, i) => `<tr><td>${AX[i]}</td><td class="n">${fmt(p[k])}</td><td>${i < 3 ? 'mm' : 'deg'}</td></tr>`).join('');
    }
    if (s.ctrl.rail) rows += `<tr><td>E1</td><td class="n">${fmt(s.e[0] ?? 0)}</td><td>mm</td><td class="hint">rail 0 .. ${s.ctrl.rail.length}</td></tr>`;
    body.innerHTML = `<table>${rows}</table>
      <div style="margin-top:6px">CONF: ${configString(s.config())}</div>
      ${warn.map((t) => `<div class="warn">⚠ ${t}</div>`).join('')}`;
  }
  key() { return false; }
  fkey(i: number) { const d = (['JNT', 'USER', 'WORLD'] as const)[i - 1]; if (d) this.disp = d; }
}

// ---------------------------------------------------------------- position helpers

/** Joint values of a stored position (converting from Cartesian with its frames). */
export function posToJoints(api: PendantApi, pos: TPPos): Joints | string {
  const s = api.s;
  if (pos.joint) return [...pos.joint] as Joints;
  const uf = pos.uf < 0 ? s.uframe : pos.uf, ut = pos.ut < 0 ? s.utool : pos.ut;
  const world = s.toArm(compose(s.userFrame(uf), poseToFrame(pos.cart!.pose)), pos.ext ?? s.e);
  const sols = ikFlange(s.model, compose(world, invert(s.toolFrame(ut))), s.q);
  if (typeof sols === 'string') return 'Position not reachable';
  const c = pos.cart!.cfg;
  const m = sols.find((x) => sameConfig(x.config, c as Config));
  if (!m) return 'Not reachable with its configuration';
  const q = [...m.q] as Joints;
  [3, 5, 0].forEach((j, k) => { const cand = q[j] - 360 * (turnOf(q[j]) - c.turns[k]); const [lo, hi] = s.model.limits[j]; if (cand >= lo && cand <= hi) q[j] = cand; });
  return q;
}
function jointsToCart(api: PendantApi, q: Joints, uf: number, ut: number, e?: number[]) {
  const s = api.s;
  const f = compose(invert(s.userFrame(uf < 0 ? s.uframe : uf)), compose(s.railFrame(e ?? s.e), fk(s.model, q, s.toolFrame(ut < 0 ? s.utool : ut))));
  return { pose: frameToPose(f), cfg: lite(s.config(q)) };
}

// ---------------------------------------------------------------- POSITION DETAIL (P[n] / PR[n])

export class PosDetailScreen implements Screen {
  id = 'POSDETAIL';
  arg: { kind: 'P' | 'PR'; prog?: string; idx: number } = { kind: 'P', idx: 1 };
  row = 1;
  constructor(private api: PendantApi) {}
  private get(): TPPos | undefined {
    const s = this.api.s;
    return this.arg.kind === 'P' ? s.programs[this.arg.prog!]?.pos[this.arg.idx] : s.PR[this.arg.idx]?.v;
  }
  private set(v: TPPos | undefined) {
    const s = this.api.s;
    if (this.arg.kind === 'P') { const p = s.programs[this.arg.prog!]; if (v) p.pos[this.arg.idx] = v; else delete p.pos[this.arg.idx]; p.modified = Date.now(); }
    else s.PR[this.arg.idx].v = v;
    s.emit();
  }
  title() { return `Position Detail`; }
  titleRight() { return `${this.arg.kind}[${this.arg.idx}]`; }
  fkeys() { return ['', '', '', 'DONE', '[REPRE]']; }
  show() { this.row = 1; }
  render(body: HTMLElement) {
    const pos = this.get();
    const s = this.api.s;
    const cmt = this.arg.kind === 'P' ? pos?.cmt ?? '' : s.PR[this.arg.idx].cmt;
    const frames = pos ? (pos.uf < 0 ? 'UF:F UT:F (current)' : `UF:${pos.uf} UT:${pos.ut}`) : '';
    let rows = `<tr class="${this.row === 0 ? 'cur' : ''}"><td>Comment</td><td colspan="2">[${esc(cmt)}]</td></tr>`;
    if (!pos) rows += `<tr><td colspan="3">Uninitialized. Enter a value or record it (SHIFT+TOUCHUP / RECORD).</td></tr>`;
    else if (pos.joint) rows += pos.joint.map((v, i) => `<tr class="${this.row === i + 1 ? 'cur' : ''}"><td>J${i + 1}</td><td class="n">${fmt(v)}</td><td>deg</td></tr>`).join('');
    else {
      rows += KEYS.map((k, i) => `<tr class="${this.row === i + 1 ? 'cur' : ''}"><td>${AX[i]}</td><td class="n">${fmt(pos.cart!.pose[k])}</td><td>${i < 3 ? 'mm' : 'deg'}</td></tr>`).join('');
      rows += `<tr class="${this.row === 7 ? 'cur' : ''}"><td>CONF</td><td colspan="2">${cfgText(pos.cart!.cfg)}</td></tr>`;
    }
    if (pos?.ext) rows += pos.ext.map((v, i) => `<tr class="${this.row === (pos.joint ? 7 : 8) + i ? 'cur' : ''}"><td>E${i + 1}</td><td class="n">${fmt(v)}</td><td>mm</td></tr>`).join('');
    body.innerHTML = `<div>${this.arg.kind}[${this.arg.idx}]  ${frames}  ${pos ? (pos.joint ? 'JOINT' : 'CARTESIAN') : ''}</div><table>${rows}</table>
      <div class="hint">Type a number to change the value at the cursor. ENTER on CONF changes the configuration. F5 converts Cartesian / Joint.</div>`;
  }
  key(k: Key): boolean {
    const pos = this.get();
    const max = (!pos ? 0 : pos.joint ? 6 : 7) + (pos?.ext?.length ?? 0);
    const er = pos?.joint ? 7 : 8;
    if (k === 'UP') { this.row = Math.max(0, this.row - 1); return true; }
    if (k === 'DOWN') { this.row = Math.min(max, this.row + 1); return true; }
    if (k === 'PREV') { this.api.back(); return true; }
    if (this.row === 0 && (k === 'ENTER')) {
      const s = this.api.s;
      const cur = this.arg.kind === 'P' ? pos?.cmt ?? '' : s.PR[this.arg.idx].cmt;
      this.api.askText('Comment:', cur, (v) => {
        if (this.arg.kind === 'P') { if (pos) { pos.cmt = v; this.set(pos); } } else { s.PR[this.arg.idx].cmt = v.slice(0, 16); s.emit(); }
      });
      return true;
    }
    if (this.row === 7 && pos?.cart && k === 'ENTER') {
      const opts = ['N U T', 'N D T', 'F U T', 'F D T', 'N U B', 'N D B', 'F U B', 'F D B'];
      this.api.choose('Configuration', opts, (i) => {
        const [f, u, t] = opts[i].split(' ');
        pos.cart!.cfg = { ...pos.cart!.cfg, flip: f === 'F', up: u === 'U', front: t === 'T' };
        this.set(pos);
      });
      return true;
    }
    if (/^[0-9.-]$/.test(k) || k === 'ENTER') {
      const isE = !!pos?.ext && this.row >= er;
      if ((this.row < 1 || this.row > 6) && !isE) return true;
      this.api.askNumber('Enter value:', (v) => {
        let p = this.get();
        if (!p) p = this.arg.kind === 'PR' ? { ...recordPos(this.api), uf: -1, ut: -1 } : recordPos(this.api);
        if (isE && p.ext) p.ext[this.row - er] = v;
        else if (p.joint) p.joint[this.row - 1] = v;
        else (p.cart!.pose as unknown as Record<string, number>)[KEYS[this.row - 1]] = v;
        this.set(p);
      }, k === 'ENTER' ? undefined : k);
      return true;
    }
    return false;
  }
  fkey(i: number) {
    if (i === 4) this.api.back();
    if (i === 5) {
      const pos = this.get();
      if (!pos) return;
      this.api.choose('Representation', ['Cartesian', 'Joint'], (k) => {
        if (k === 1 && !pos.joint) {
          const q = posToJoints(this.api, pos);
          if (typeof q === 'string') { this.api.prompt(q, 'warn'); return; }
          this.set({ uf: pos.uf, ut: pos.ut, joint: q, ext: pos.ext, cmt: pos.cmt });
        } else if (k === 0 && pos.joint) {
          this.set({ uf: pos.uf, ut: pos.ut, cart: jointsToCart(this.api, pos.joint as Joints, pos.uf, pos.ut, pos.ext), ext: pos.ext, cmt: pos.cmt });
        }
      });
    }
  }
}

// ---------------------------------------------------------------- DATA (R[], PR[])

export class DataScreen implements Screen {
  id = 'DATA';
  type: 'R' | 'PR' = 'R';
  row = 0;
  col = 1;
  constructor(private api: PendantApi) {}
  title() { return this.type === 'R' ? 'DATA Registers' : 'DATA Position Reg'; }
  fkeys() { return this.type === 'R' ? ['[TYPE]', '', '', '', ''] : ['[TYPE]', '', 'RECORD', 'POSITION', 'CLEAR']; }
  render(body: HTMLElement) {
    const s = this.api.s;
    const n = this.type === 'R' ? 200 : 100;
    const rows: string[] = [];
    for (let i = 1; i <= n; i++) {
      const cur = i - 1 === this.row;
      const sel = (c: number) => (cur && this.col === c ? 'isel' : '');
      if (this.type === 'R') rows.push(`<tr class="${cur ? 'cur' : ''}" data-r="${i - 1}"><td>R[${i}:</td><td class="${sel(0)}">${esc(s.R[i].cmt) || '&nbsp;'}</td><td>] =</td><td class="n ${sel(1)}">${+s.R[i].v.toFixed(6)}</td></tr>`);
      else {
        const v = s.PR[i].v;
        rows.push(`<tr class="${cur ? 'cur' : ''}" data-r="${i - 1}"><td>PR[${i}:</td><td class="${sel(0)}">${esc(s.PR[i].cmt) || '&nbsp;'}</td><td>] =</td><td class="${sel(1)}">${v ? (v.joint ? 'JNT' : 'R') : '*'}</td></tr>`);
      }
    }
    body.innerHTML = `<table>${rows.join('')}</table>`;
    body.querySelectorAll<HTMLElement>('[data-r]').forEach((r) => r.addEventListener('click', () => { this.row = +r.dataset.r!; this.api.redraw(); }));
    scrollIntoView(body);
  }
  key(k: Key, shift: boolean): boolean {
    const n = this.type === 'R' ? 200 : 100;
    const s = this.api.s;
    const idx = this.row + 1;
    if (k === 'UP') { this.row = Math.max(0, this.row - (shift ? 10 : 1)); return true; }
    if (k === 'DOWN') { this.row = Math.min(n - 1, this.row + (shift ? 10 : 1)); return true; }
    if (k === 'LEFT') { this.col = 0; return true; }
    if (k === 'RIGHT') { this.col = 1; return true; }
    if (k === 'ENTER' && this.col === 0) {
      const reg = this.type === 'R' ? s.R[idx] : s.PR[idx];
      this.api.askText('Comment:', reg.cmt, (v) => { reg.cmt = v.slice(0, 16); s.emit(); });
      return true;
    }
    if (this.type === 'R' && this.col === 1 && (k === 'ENTER' || /^[0-9.-]$/.test(k))) {
      this.api.askNumber(`R[${idx}] =`, (v) => { s.R[idx].v = v; s.emit(); }, k === 'ENTER' ? undefined : k);
      return true;
    }
    if (this.type === 'PR' && k === 'ENTER') { this.api.open('POSDETAIL', { kind: 'PR', idx }); return true; }
    return false;
  }
  fkey(i: number, shift: boolean) {
    const s = this.api.s;
    const idx = this.row + 1;
    if (i === 1) this.api.choose('TYPE', ['Registers', 'Position Reg'], (k) => { this.type = k === 0 ? 'R' : 'PR'; this.row = 0; this.api.redraw(); });
    if (this.type !== 'PR') return;
    if (i === 3) {
      if (!shift) { this.api.prompt('RECORD: hold SHIFT and press F3', 'warn'); return; }
      s.PR[idx].v = { ...recordPos(this.api), uf: -1, ut: -1 };
      this.api.prompt(`PR[${idx}] recorded`);
      s.emit();
    }
    if (i === 4) this.api.open('POSDETAIL', { kind: 'PR', idx });
    if (i === 5) this.api.confirm(`Clear PR[${idx}]?`, () => { s.PR[idx].v = undefined; s.emit(); });
  }
}

// ---------------------------------------------------------------- I/O

const IO_TYPES: { label: string; in: IOPort; out: IOPort }[] = [
  { label: 'Digital', in: 'DI', out: 'DO' }, { label: 'Robot', in: 'RI', out: 'RO' }, { label: 'UOP', in: 'UI', out: 'UO' },
  { label: 'Group', in: 'GI', out: 'GO' }, { label: 'Flag', in: 'F', out: 'F' },
];

export class IOScreen implements Screen {
  id = 'IO';
  type = 0;
  out = true;
  row = 0;
  constructor(private api: PendantApi) {}
  get port(): IOPort { const t = IO_TYPES[this.type]; return this.out ? t.out : t.in; }
  title() { return `I/O ${IO_TYPES[this.type].label} ${this.out ? 'Out' : 'In'}`; }
  fkeys() { return ['[TYPE]', IO_TYPES[this.type].in === IO_TYPES[this.type].out ? '' : this.out ? 'IN/OUT' : 'IN/OUT', 'COMMENT', this.isGroup() ? 'VALUE' : 'ON', this.isGroup() ? '' : 'OFF']; }
  private isGroup() { return this.port === 'GI' || this.port === 'GO'; }
  private count() { return this.port.startsWith('R') ? 8 : this.port.startsWith('U') ? 18 : this.isGroup() ? 16 : 512; }
  render(body: HTMLElement) {
    const s = this.api.s;
    const n = this.count();
    const cm = s.ioCmt[this.port] ?? {};
    const sim = !this.out && this.port !== 'F';
    const rows: string[] = [];
    for (let i = 1; i <= n; i++) {
      const v = s.io[this.port][i];
      const val = this.isGroup() ? String(v) : v ? 'ON' : 'OFF';
      rows.push(`<tr class="${i - 1 === this.row ? 'cur' : ''}" data-r="${i - 1}"><td>${this.port}[${String(i).padStart(3, ' ')}]</td><td class="${v ? 'ion' : ''}">${val}</td><td>${sim ? 'S' : ' '}</td><td>[${esc(cm[i] ?? '')}]</td></tr>`);
    }
    body.innerHTML = `<table>${rows.join('')}</table>`;
    body.querySelectorAll<HTMLElement>('[data-r]').forEach((r) => {
      r.addEventListener('click', () => { this.row = +r.dataset.r!; this.api.redraw(); });
      r.addEventListener('dblclick', () => { this.row = +r.dataset.r!; this.toggle(); });
    });
    scrollIntoView(body);
  }
  private toggle() { const s = this.api.s; const a = s.io[this.port]; a[this.row + 1] = a[this.row + 1] ? 0 : 1; s.emit(); }
  key(k: Key, shift: boolean): boolean {
    if (k === 'UP') { this.row = Math.max(0, this.row - (shift ? 10 : 1)); return true; }
    if (k === 'DOWN') { this.row = Math.min(this.count() - 1, this.row + (shift ? 10 : 1)); return true; }
    if (this.isGroup() && (k === 'ENTER' || /^[0-9]$/.test(k))) { this.fkey(4); return true; }
    return false;
  }
  fkey(i: number) {
    const s = this.api.s;
    const idx = this.row + 1;
    if (i === 1) this.api.choose('TYPE', IO_TYPES.map((t) => t.label), (k) => { this.type = k; this.row = 0; this.api.redraw(); });
    if (i === 2) { this.out = !this.out; this.row = 0; }
    if (i === 3) this.api.askText(`Comment ${this.port}[${idx}]:`, s.ioCmt[this.port]?.[idx] ?? '', (v) => { (s.ioCmt[this.port] ??= {})[idx] = v.slice(0, 24); s.emit(); });
    if (i === 4 && this.isGroup()) { this.api.askNumber(`${this.port}[${idx}] =`, (v) => { s.io[this.port][idx] = Math.max(0, Math.round(v)); s.emit(); }); return; }
    if (i === 4 || i === 5) { s.io[this.port][idx] = i === 4 ? 1 : 0; s.emit(); }
  }
}

// ---------------------------------------------------------------- SETUP Frames

type FKind = 'TOOL' | 'JOG' | 'USER';
const METHODS: Record<FKind, string[]> = {
  TOOL: ['Direct Entry', 'Three Point', 'Six Point(XZ)', 'Six Point(XY)'],
  USER: ['Direct Entry', 'Three Point', 'Four Point'],
  JOG: ['Direct Entry', 'Three Point'],
};
const POINT_NAMES: Record<string, string[]> = {
  'Three Point TOOL': ['Approach point 1', 'Approach point 2', 'Approach point 3'],
  'Six Point(XZ) TOOL': ['Approach point 1', 'Approach point 2', 'Approach point 3', 'Orient Origin Point', 'X Direction Point', 'Z Direction Point'],
  'Six Point(XY) TOOL': ['Approach point 1', 'Approach point 2', 'Approach point 3', 'Orient Origin Point', 'X Direction Point', 'Y Direction Point'],
  'Three Point USER': ['Orient Origin Point', 'X Direction Point', 'Y Direction Point'],
  'Four Point USER': ['Orient Origin Point', 'X Direction Point', 'Y Direction Point', 'System Origin'],
  'Three Point JOG': ['Orient Origin Point', 'X Direction Point', 'Y Direction Point'],
};

export class FramesScreen implements Screen {
  id = 'FRAMES';
  kind: FKind = 'TOOL';
  row = 0;
  detail = false;
  drow = 0;
  method: Record<string, string> = {};
  /** Recorded teach points (joint positions) per frame. */
  points: Record<string, (Joints | undefined)[]> = {};
  constructor(private api: PendantApi) {}
  private list(): FrameEntry[] { const s = this.api.s; return this.kind === 'TOOL' ? s.tools : this.kind === 'USER' ? s.users : s.jogs; }
  private key2() { return `${this.kind}${this.row + 1}`; }
  private active() { const s = this.api.s; return this.kind === 'TOOL' ? s.utool : this.kind === 'USER' ? s.uframe : s.jogFrame; }
  private meth() { return this.method[this.key2()] ?? 'Direct Entry'; }
  title() { return `${this.kind === 'TOOL' ? 'Tool' : this.kind === 'USER' ? 'User' : 'Jog'} Frame Setup${this.detail ? ` / ${this.meth()}` : ''}`; }
  titleRight() { return `Active: ${this.active()}`; }
  fkeys() { return this.detail ? ['', '[METHOD]', 'FRAME', this.meth() === 'Direct Entry' ? '' : 'MOVE_TO', this.meth() === 'Direct Entry' ? '' : 'RECORD'] : ['', 'DETAIL', '[OTHER]', 'CLEAR', 'SETIND']; }
  open(kind: FKind, n: number) { this.kind = kind; this.row = n - 1; this.detail = true; this.drow = 0; }
  render(body: HTMLElement) {
    const list = this.list();
    if (!this.detail) {
      body.innerHTML = `<table>${list.map((f, i) => `<tr class="${i === this.row ? 'cur' : ''}" data-r="${i}"><td class="n">${i + 1}${i + 1 === this.active() ? '*' : ''}</td><td class="n">${f.pose.x.toFixed(1)}</td><td class="n">${f.pose.y.toFixed(1)}</td><td class="n">${f.pose.z.toFixed(1)}</td><td>[${esc(f.comment)}]</td></tr>`).join('')}</table>
        <div class="hint">${this.kind === 'TOOL' ? 'Tool frames are relative to the faceplate.' : 'Frame is relative to WORLD.'} ENTER/F2 for detail, F5 SETIND makes it active, F3 switches Tool / Jog / User.</div>`;
      body.querySelectorAll<HTMLElement>('[data-r]').forEach((r) => {
        r.addEventListener('click', () => { this.row = +r.dataset.r!; this.api.redraw(); });
        r.addEventListener('dblclick', () => { this.row = +r.dataset.r!; this.detail = true; this.drow = 0; this.api.redraw(); });
      });
      return;
    }
    const f = list[this.row];
    const m = this.meth();
    let html = `<div>Frame Number: ${this.row + 1}</div><table>`;
    html += KEYS.map((k, i) => `<tr><td>${AX[i]}:</td><td class="n">${fmt(f.pose[k])}</td></tr>`).join('');
    html += `</table><table style="margin-top:4px">`;
    const rows: string[] = [`Comment: [${esc(f.comment)}]`];
    if (m === 'Direct Entry') KEYS.forEach((k, i) => rows.push(`${AX[i]}: ${fmt(f.pose[k])}`));
    else {
      const names = POINT_NAMES[`${m} ${this.kind}`];
      const pts = this.points[this.key2()] ?? [];
      names.forEach((n, i) => rows.push(`${n}: ${pts[i] ? 'RECORDED' : 'UNINIT'}`));
    }
    html += rows.map((r, i) => `<tr class="${i === this.drow ? 'cur' : ''}" data-d="${i}"><td>${i + 1}</td><td>${r}</td></tr>`).join('') + '</table>';
    html += `<div class="hint">${m === 'Direct Entry' ? 'Cursor to a value and type a number.' : 'Jog to each point, then SHIFT+F5 RECORD. SHIFT+F4 MOVE_TO returns to a recorded point. The frame is computed when all points are recorded.'}</div>`;
    body.innerHTML = html;
    body.querySelectorAll<HTMLElement>('[data-d]').forEach((r) => r.addEventListener('click', () => { this.drow = +r.dataset.d!; this.api.redraw(); }));
  }
  private nRows() { const m = this.meth(); return 1 + (m === 'Direct Entry' ? 6 : POINT_NAMES[`${m} ${this.kind}`].length); }
  key(k: Key): boolean {
    const s = this.api.s;
    const list = this.list();
    if (!this.detail) {
      if (k === 'UP') { this.row = Math.max(0, this.row - 1); return true; }
      if (k === 'DOWN') { this.row = Math.min(list.length - 1, this.row + 1); return true; }
      if (k === 'ENTER') { this.detail = true; this.drow = 0; return true; }
      return false;
    }
    if (k === 'UP') { this.drow = Math.max(0, this.drow - 1); return true; }
    if (k === 'DOWN') { this.drow = Math.min(this.nRows() - 1, this.drow + 1); return true; }
    if (k === 'PREV') { this.detail = false; return true; }
    const f = list[this.row];
    if (this.drow === 0 && k === 'ENTER') { this.api.askText('Comment:', f.comment, (v) => { f.comment = v.slice(0, 16); s.emit(); }); return true; }
    if (this.meth() === 'Direct Entry' && this.drow > 0 && (k === 'ENTER' || /^[0-9.-]$/.test(k))) {
      const key = KEYS[this.drow - 1];
      this.api.askNumber(`${AX[this.drow - 1]}:`, (v) => { f.pose[key] = v; s.emit(); }, k === 'ENTER' ? undefined : k);
      return true;
    }
    return false;
  }
  fkey(i: number, shift: boolean) {
    const s = this.api.s;
    if (!this.detail) {
      if (i === 2) { this.detail = true; this.drow = 0; }
      if (i === 3) this.api.choose('OTHER', ['Tool Frame', 'Jog Frame', 'User Frame'], (k) => { this.kind = (['TOOL', 'JOG', 'USER'] as FKind[])[k]; this.row = 0; this.api.redraw(); });
      if (i === 4) this.api.confirm(`Clear ${this.kind} frame ${this.row + 1}?`, () => { const f = this.list()[this.row]; f.pose = { x: 0, y: 0, z: 0, w: 0, p: 0, r: 0 }; f.comment = ''; s.emit(); });
      if (i === 5) {
        const n = this.row + 1;
        if (this.kind === 'TOOL') s.utool = n; else if (this.kind === 'USER') s.uframe = n; else s.jogFrame = n;
        this.api.prompt(`${this.kind === 'TOOL' ? 'UTOOL_NUM' : this.kind === 'USER' ? 'UFRAME_NUM' : 'Jog frame'} = ${n}`);
        s.emit();
      }
      return;
    }
    if (i === 2) this.api.choose('METHOD', METHODS[this.kind], (k) => { this.method[this.key2()] = METHODS[this.kind][k]; this.drow = 0; this.api.redraw(); });
    if (i === 3) this.detail = false;
    if ((i === 4 || i === 5) && this.meth() !== 'Direct Entry') {
      if (this.drow === 0) { this.api.prompt('Move the cursor to a point line', 'warn'); return; }
      if (!shift) { this.api.prompt(`Hold SHIFT and press F${i}`, 'warn'); return; }
      const pts = (this.points[this.key2()] ??= []);
      if (i === 4) {
        const q = pts[this.drow - 1];
        if (!q) { this.api.prompt('Point not recorded', 'warn'); return; }
        this.api.jog.moveJoints(q);
        return;
      }
      pts[this.drow - 1] = [...s.q] as Joints;
      this.api.prompt(`${POINT_NAMES[`${this.meth()} ${this.kind}`][this.drow - 1]} recorded`);
      this.drow = Math.min(this.nRows() - 1, this.drow + 1);
      this.compute();
    }
  }
  private compute() {
    const s = this.api.s;
    const m = this.meth();
    const names = POINT_NAMES[`${m} ${this.kind}`];
    const pts = this.points[this.key2()] ?? [];
    if (names.some((_, i) => !pts[i])) return;
    const f = this.list()[this.row];
    try {
      if (this.kind === 'TOOL') {
        const fl: Frame[] = pts.slice(0, 3).map((q) => fkFlange(s.model, q!));
        const { t, err } = tcpFromPoints(fl);
        let wpr: [number, number, number] = [0, 0, 0];
        if (m !== 'Three Point') {
          const [o, a, b] = pts.slice(3, 6).map((q) => fkFlange(s.model, q!));
          wpr = toolOrientation(o, a, b, m === 'Six Point(XZ)' ? 'XZ' : 'XY');
        }
        f.pose = { x: t[0], y: t[1], z: t[2], w: wpr[0], p: wpr[1], r: wpr[2] };
        this.api.prompt(`Tool frame ${this.row + 1} computed (point spread ${err.toFixed(2)} mm)`);
      } else {
        const tcp = pts.map((q) => fk(s.model, q!, s.toolFrame()).p);
        f.pose = userFrameFromPoints(tcp[0], tcp[1], tcp[2], m === 'Four Point' ? tcp[3] : undefined);
        this.api.prompt(`${this.kind === 'USER' ? 'User' : 'Jog'} frame ${this.row + 1} computed`);
      }
      s.emit();
    } catch (e) {
      this.api.prompt(e instanceof FrameTeachError ? e.message : String(e), 'warn');
    }
  }
}

// ---------------------------------------------------------------- ALARM

export class AlarmScreen implements Screen {
  id = 'ALARM';
  constructor(private api: PendantApi) {}
  title() { return 'Alarm History'; }
  fkeys() { return ['', '', '', 'CLEAR', '']; }
  render(body: HTMLElement) {
    const items = this.api.s.log.filter((l) => l.level !== 'info').slice(-60).reverse();
    body.innerHTML = items.length
      ? `<table>${items.map((l) => `<tr><td>${l.t.toLocaleTimeString([], { hour12: false })}</td><td class="${l.level === 'alarm' ? 'err' : 'warn'}">${esc(l.text)}</td></tr>`).join('')}</table>`
      : '<div class="hint">No alarms.</div>';
  }
  key() { return false; }
  fkey(i: number) { if (i === 4) { this.api.s.log = this.api.s.log.filter((l) => l.level === 'info'); } }
}

export type { TPProgram };
