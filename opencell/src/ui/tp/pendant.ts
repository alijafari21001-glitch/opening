// Virtual teach pendant shell: screen, status line, function keys, hard keys, popups and entry.
import { CellState, COORDS, OVERRIDES } from '../../state';
import { Jogger } from '../../jog';
import { Interpreter } from '../../tp/interp';
import { Screen, PendantApi, Key, esc } from './core';
import { EditScreen } from './edit';
import { SelectScreen, PosnScreen, DataScreen, IOScreen, FramesScreen, PosDetailScreen, AlarmScreen } from './screens';

type Overlay =
  | { kind: 'num'; prompt: string; buf: string; cb: (v: number) => void }
  | { kind: 'text'; prompt: string; cb: (v: string) => void }
  | { kind: 'choice'; title: string; items: string[]; sel: number; cb: (i: number) => void }
  | { kind: 'confirm'; msg: string; cb: () => void };

const AX = ['X', 'Y', 'Z', 'W', 'P', 'R'];

export class Pendant implements PendantApi {
  private screens: Record<string, Screen>;
  private screen: Screen;
  private history: string[] = [];
  private page = 0;
  private overlay: Overlay | null = null;
  private promptMsg = { text: '', level: 'info' as 'info' | 'warn' };
  private shiftHeld = false;
  private shiftLatched = false;
  private dirty = false;
  private el: HTMLElement;
  private body!: HTMLElement;
  edit: EditScreen;
  frames: FramesScreen;

  constructor(el: HTMLElement, public s: CellState, public jog: Jogger, public interp: Interpreter) {
    this.el = el;
    this.edit = new EditScreen(this);
    this.frames = new FramesScreen(this);
    this.screens = {
      EDIT: this.edit, SELECT: new SelectScreen(this), POSN: new PosnScreen(this), DATA: new DataScreen(this),
      IO: new IOScreen(this), FRAMES: this.frames, POSDETAIL: new PosDetailScreen(this), ALARM: new AlarmScreen(this),
    };
    this.screen = this.screens.EDIT;
    this.layout();
    s.onChange(() => { if (this.interp.running && this.screen === this.edit) this.edit.follow(); this.redraw(); });
    s.onLog((e) => {
      if (e.level !== 'info') this.prompt(e.text, 'warn');
      // a paused/stopped alarm line goes away once the robot runs again
      else if (/Program resumed|started at line/.test(e.text) && this.promptMsg?.level === 'warn' && /Program paused/.test(this.promptMsg.text)) this.prompt('');
    });
    interp.onChange(() => this.redraw());
    this.bindKeyboard();
    this.screen.show?.();
    this.redraw();
  }

  get shift() { return this.s.shift; }

  // ------------------------------------------------------------ api
  askNumber(prompt: string, cb: (v: number) => void, first?: string) { this.overlay = { kind: 'num', prompt, buf: first ?? '', cb }; this.redraw(); }
  askText(prompt: string, initial: string, cb: (v: string) => void) {
    this.overlay = { kind: 'text', prompt, cb };
    this.renderNow();
    const inp = this.el.querySelector<HTMLInputElement>('.tp-prompt input');
    if (inp) { inp.value = initial; inp.focus(); inp.select(); }
  }
  choose(title: string, items: string[], cb: (i: number) => void, sel = 0) { this.overlay = { kind: 'choice', title, items, sel, cb }; this.redraw(); }
  confirm(msg: string, cb: () => void) { this.overlay = { kind: 'confirm', msg, cb }; this.redraw(); }
  prompt(text: string, level: 'info' | 'warn' = 'info') { this.promptMsg = { text, level }; this.redraw(); }
  open(id: string, arg?: unknown) {
    const sc = this.screens[id];
    if (!sc) return;
    if (this.screen.id !== id) this.history.push(this.screen.id);
    if (this.history.length > 20) this.history.shift();
    this.screen = sc;
    this.page = 0;
    if (id === 'POSDETAIL' && arg) (sc as PosDetailScreen).arg = arg as PosDetailScreen['arg'];
    sc.show?.();
    this.redraw();
  }
  back() {
    const id = this.history.pop();
    if (id) { this.screen = this.screens[id]; this.page = 0; this.screen.show?.(); }
    this.redraw();
  }
  redraw() {
    if (this.dirty) return;
    this.dirty = true;
    requestAnimationFrame(() => this.renderNow());
  }
  /** Open a frame's detail screen (from the Cell Browser). */
  openFrame(kind: 'TOOL' | 'USER', n: number) { this.frames.open(kind, n); this.open('FRAMES'); }

  // ------------------------------------------------------------ layout
  private layout() {
    const k = (id: string, label: string, cls = '', title = '') => `<button data-key="${id}" class="${cls}" title="${title}">${label}</button>`;
    this.el.innerHTML = `
      <div class="tp-head">
        <span class="tp-brand">Teach Pendant</span>
        <span class="tp-size" title="Pendant size 0-100 (or drag its left edge; double-click the edge for normal size)"><input type="range" min="0" max="100" step="1" data-tpsize aria-label="Pendant size"><output data-tpsizev></output><button data-tpmin title="Minimize the pendant (the view gets the space)">▁</button></span>
        <label class="tp-switch" title="Teach pendant enable switch"><input type="checkbox" id="tp-enable" checked> TP ON</label>
      </div>
      <div class="tp-screen">
        <div class="tp-status"></div>
        <div class="tp-title"><span class="pt"></span><span class="pr"></span></div>
        <div class="tp-body"></div>
        <div class="tp-popup" hidden></div>
        <div class="tp-prompt"></div>
        <div class="tp-fkeys">${k('PREV', 'PREV', 'nav')}${[1, 2, 3, 4, 5].map((i) => `<button data-f="${i}"></button>`).join('')}${k('NEXT', 'NEXT', 'nav')}</div>
      </div>
      <div class="keys k-main">
        ${k('SHIFT', 'SHIFT', 'shift', 'Click to latch, or hold the Shift key')}${k('MENU', 'MENU')}${k('SELECT', 'SELECT')}${k('EDIT', 'EDIT')}${k('DATA', 'DATA')}${k('FCTN', 'FCTN')}${k('SHIFT', 'SHIFT', 'shift')}
        ${k('STEP', 'STEP', 'step', 'Toggle single step')}${k('HOLD', 'HOLD', 'hold')}${k('FWD', 'FWD', '', 'SHIFT+FWD runs from the cursor line')}${k('BWD', 'BWD', '', 'SHIFT+BWD steps back one motion')}${k('RESET', 'RESET')}${k('BKSP', 'BACK<br>SPACE', 'small')}${k('ITEM', 'ITEM')}
        ${k('7', '7', 'num')}${k('8', '8', 'num')}${k('9', '9', 'num')}<span></span>${k('UP', '▲', 'arr')}<span></span>${k('POSN', 'POSN')}
        ${k('4', '4', 'num')}${k('5', '5', 'num')}${k('6', '6', 'num')}${k('LEFT', '◀', 'arr')}${k('ENTER', 'ENTER', 'enter')}${k('RIGHT', '▶', 'arr')}${k('IO', 'I/O')}
        ${k('1', '1', 'num')}${k('2', '2', 'num')}${k('3', '3', 'num')}<span></span>${k('DOWN', '▼', 'arr')}<span></span>${k('SETUP', 'SET<br>UP', 'small', 'Frame setup')}
        ${k('0', '0', 'num')}${k('.', '.', 'num')}${k('-', '-/,', 'num')}${k('COORD', 'COORD', 'coord', 'SHIFT+COORD opens the jog menu')}${k('OVDN', '-%')}${k('OVUP', '+%')}${k('ALARM', 'ALARM', 'small')}
      </div>
      <div class="keys k-jog">${[0, 1, 2, 3, 4, 5].map((a) => `<button data-jog="${a}" data-dir="-1"></button>`).join('')}${[0, 1, 2, 3, 4, 5].map((a) => `<button data-jog="${a}" data-dir="1"></button>`).join('')}</div>
      <div class="keys k-ext"><button data-key="GROUP" class="grp" title="Switch the pendant to the next robot (motion group)">GROUP</button><button data-jog="6" data-dir="-1">−E1<small>(rail)</small></button><button data-jog="6" data-dir="1">+E1<small>(rail)</small></button></div>`;
    this.body = this.el.querySelector('.tp-body')!;
    this.el.querySelectorAll<HTMLButtonElement>('[data-key]').forEach((b) => b.addEventListener('click', () => this.hardKey(b.dataset.key!)));
    this.el.querySelectorAll<HTMLButtonElement>('[data-f]').forEach((b) => b.addEventListener('click', () => this.fkey(+b.dataset.f!)));
    this.el.querySelectorAll<HTMLButtonElement>('[data-jog]').forEach((b) => this.bindJog(b, +b.dataset.jog!, +b.dataset.dir!));
    const en = this.el.querySelector<HTMLInputElement>('#tp-enable')!;
    en.addEventListener('change', () => { this.s.tpEnabled = en.checked; if (!en.checked) this.jog.stop(); this.s.emit(); });
  }

  private bindJog(b: HTMLButtonElement, axis: number, dir: number) {
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      b.setPointerCapture(e.pointerId);
      b.classList.add('held');
      this.jog.start(axis, dir);
    });
    const up = () => { b.classList.remove('held'); this.jog.stop(); };
    b.addEventListener('pointerup', up);
    b.addEventListener('pointercancel', up);
    b.addEventListener('lostpointercapture', up);
  }

  private setShift() {
    this.s.shift = this.shiftHeld || this.shiftLatched;
    if (!this.s.shift) this.jog.stop();
    this.redraw();
  }

  private bindKeyboard() {
    const typing = (e: KeyboardEvent) => ['INPUT', 'SELECT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName ?? '');
    const map: Record<string, string> = {
      ArrowUp: 'UP', ArrowDown: 'DOWN', ArrowLeft: 'LEFT', ArrowRight: 'RIGHT', Enter: 'ENTER', Backspace: 'BKSP',
      Escape: 'PREV', PageUp: 'PREV', PageDown: 'NEXT', '.': '.', '-': '-', ',': '-',
    };
    addEventListener('keydown', (e) => {
      if (e.key === 'Shift') { this.shiftHeld = true; this.setShift(); return; }
      if (typing(e) || e.ctrlKey || e.metaKey || e.altKey) return;
      const f = /^F([1-5])$/.exec(e.key);
      if (f) { e.preventDefault(); this.fkey(+f[1]); return; }
      const key = /^Digit([0-9])$/.exec(e.code)?.[1] ?? /^Numpad([0-9])$/.exec(e.code)?.[1] ?? map[e.key];
      if (key) { e.preventDefault(); this.hardKey(key); }
    });
    addEventListener('keyup', (e) => { if (e.key === 'Shift') { this.shiftHeld = false; this.setShift(); } });
    addEventListener('blur', () => { this.shiftHeld = false; this.setShift(); this.jog.stop(); });
  }

  // ------------------------------------------------------------ keys
  private hardKey(k: string) {
    const s = this.s;
    const ov = this.overlay;
    if (ov && this.overlayKey(k)) { this.redraw(); return; }
    if (ov && ov.kind !== 'num') return;
    if (ov) this.overlay = null;
    switch (k) {
      case 'SHIFT': this.shiftLatched = !this.shiftLatched; this.setShift(); return;
      case 'GROUP':
        if (s.robots.length < 2) return;
        this.jog.stop();
        s.active = (s.active + 1) % s.robots.length;
        s.message('info', `Pendant now on group ${s.active + 1}: ${s.ctrl.name} (${s.model.name})`);
        s.emit();
        break;
      case 'NEXT': { const n = this.screen.pages?.() ?? 1; this.page = (this.page + 1) % n; break; }
      case 'PREV':
        if (this.screen.key('PREV', s.shift)) break;
        this.back(); return;
      case 'MENU': {
        const items: [string, string][] = [['SELECT', 'SELECT'], ['EDIT', 'EDIT'], ['DATA', 'DATA'], ['I/O', 'IO'], ['SETUP Frames', 'FRAMES'], ['ALARM', 'ALARM'], ['POSITION', 'POSN']];
        this.choose('MENU', items.map((i) => i[0]), (i) => this.open(items[i][1]));
        return;
      }
      case 'FCTN': {
        const items = ['ABORT (ALL)', 'RELEASE WAIT', 'TOGGLE STEP', `CHANGE MODE (now ${s.mode})`];
        this.choose('FUNCTION', items, (i) => {
          if (i === 0) this.interp.abort();
          if (i === 1) this.interp.releaseWait();
          if (i === 2) { s.stepMode = !s.stepMode; }
          if (i === 3) this.choose('Mode', ['T1 (250 mm/s limit)', 'T2', 'AUTO'], (m) => { s.mode = (['T1', 'T2', 'AUTO'] as const)[m]; s.emit(); });
          s.emit();
        });
        return;
      }
      case 'SELECT': case 'EDIT': case 'DATA': case 'POSN': case 'ALARM': this.open(k); return;
      case 'IO': this.open('IO'); return;
      case 'SETUP': this.open('FRAMES'); return;
      case 'COORD':
        if (s.shift) { this.jogMenu(); return; }
        s.coord = COORDS[(COORDS.indexOf(s.coord) + 1) % COORDS.length];
        s.emit(); return;
      case 'OVUP': case 'OVDN': {
        const up = k === 'OVUP';
        let i = OVERRIDES.indexOf(s.override);
        if (s.shift) {
          // SHIFT + %: big steps VFINE, FINE, 5, 50, 100
          const big = [0, 1, OVERRIDES.indexOf(5), OVERRIDES.indexOf(50), OVERRIDES.length - 1];
          i = up ? big.find((b) => b > i) ?? i : [...big].reverse().find((b) => b < i) ?? i;
        } else i += up ? 1 : -1;
        s.override = OVERRIDES[Math.max(0, Math.min(OVERRIDES.length - 1, i))];
        s.emit(); return;
      }
      case 'STEP': s.stepMode = !s.stepMode; s.emit(); return;
      case 'HOLD': this.interp.hold(); return;
      case 'RESET': this.interp.reset(); this.promptMsg = { text: '', level: 'info' }; s.message('info', 'RESET'); s.emit(); return;
      case 'FWD': case 'BWD': this.run(k); return;
      default:
        if (!this.screen.key(k as Key, s.shift)) return;
    }
    this.redraw();
  }

  private run(k: 'FWD' | 'BWD') {
    const s = this.s;
    if (!s.tpEnabled) { this.prompt('TP is OFF. Turn TP ON to run from the pendant.', 'warn'); return; }
    if (!s.shift) { this.prompt(`Hold SHIFT and press ${k}`, 'warn'); return; }
    if (this.interp.fault) { this.prompt('Alarm active: press RESET first', 'warn'); return; }
    const prog = s.selected;
    if (!s.programs[prog]) { this.prompt('No program selected (SELECT)', 'warn'); return; }
    const line = this.screen === this.edit ? this.edit.line : this.interp.cursor?.line ?? 0;
    if (k === 'FWD') {
      if (this.interp.running) return;
      this.interp.start(prog, Math.min(line, s.programs[prog].lines.length), { pendant: true });
    } else this.interp.backward(prog, line);
  }

  private jogMenu() {
    const s = this.s;
    const rows = [`Tool  ${s.utool}`, `Jog   ${s.jogFrame}`, `User  ${s.uframe}`];
    this.choose('JOG MENU (frame numbers)', rows, (i) => {
      const [name, lo, hi] = ([['UTOOL', 0, 10], ['Jog frame', 1, 5], ['UFRAME', 0, 9]] as const)[i];
      this.askNumber(`${name} number (${lo}-${hi}):`, (v) => {
        const n = Math.round(v);
        if (n < lo || n > hi) { this.prompt(`Out of range ${lo}-${hi}`, 'warn'); return; }
        if (i === 0) s.utool = n; else if (i === 1) s.jogFrame = n; else s.uframe = n;
        s.emit();
      });
    });
  }

  /** Overlay handles the key; returns true if consumed. */
  private overlayKey(k: string): boolean {
    const o = this.overlay!;
    if (o.kind === 'num') {
      if (/^[0-9]$/.test(k)) { o.buf += k; return true; }
      if (k === '.') { if (!o.buf.includes('.')) o.buf += '.'; return true; }
      if (k === '-') { o.buf = o.buf.startsWith('-') ? o.buf.slice(1) : '-' + o.buf; return true; }
      if (k === 'BKSP') { o.buf = o.buf.slice(0, -1); return true; }
      if (k === 'ENTER') {
        this.overlay = null;
        const v = parseFloat(o.buf);
        if (o.buf !== '' && isFinite(v)) o.cb(v);
        return true;
      }
      if (k === 'PREV' || k === 'UP' || k === 'DOWN' || k === 'LEFT' || k === 'RIGHT') { this.overlay = null; return k === 'PREV'; }
      return false;
    }
    if (o.kind === 'choice') {
      if (k === 'UP') { o.sel = (o.sel + o.items.length - 1) % o.items.length; return true; }
      if (k === 'DOWN') { o.sel = (o.sel + 1) % o.items.length; return true; }
      if (/^[1-9]$/.test(k) && +k <= o.items.length) { this.overlay = null; o.cb(+k - 1); return true; }
      if (k === '0' && o.items.length >= 10) { this.overlay = null; o.cb(9); return true; }
      if (k === 'ENTER') { this.overlay = null; o.cb(o.sel); return true; }
      if (k === 'PREV') { this.overlay = null; return true; }
      return true;
    }
    if (o.kind === 'confirm') { if (k === 'PREV') { this.overlay = null; return true; } return true; }
    if (o.kind === 'text') { if (k === 'PREV') { this.overlay = null; return true; } return true; }
    return false;
  }

  private fkey(i: number) {
    const o = this.overlay;
    if (o?.kind === 'confirm') {
      if (i === 4) { this.overlay = null; o.cb(); }
      if (i === 5) this.overlay = null;
      this.redraw();
      return;
    }
    if (o) return;
    const labels = this.screen.fkeys(this.page);
    if (!labels[i - 1]) return;
    this.screen.fkey(i, this.s.shift, this.page);
    this.redraw();
  }

  // ------------------------------------------------------------ render
  private renderNow() {
    this.dirty = false;
    const s = this.s;
    const it = this.interp;
    const ov = typeof s.override === 'number' ? `${s.override}%` : s.override;
    const cur = it.cursor;
    const prog = cur?.prog ?? s.selected;
    const line = cur ? cur.line + 1 : 0;
    this.el.querySelector('.tp-status')!.innerHTML = `
      <span class="${it.running ? 'on' : ''}">${esc(prog || '-')} ${line ? `L${line}` : ''}</span>
      <span class="${it.status === 'RUNNING' ? 'run' : it.status === 'PAUSED' ? 'on' : ''}">${it.status}</span>
      <span>${s.mode}</span><span class="${s.coord !== 'JOINT' ? 'on' : ''}">${s.coord}</span><span>${ov}</span>
      <span>UT${s.utool} UF${s.uframe}</span>${s.stepMode ? '<span class="on">STEP</span>' : ''}
      <span class="${it.fault ? 'alarm' : ''}">${it.fault ? 'FAULT' : 'OK'}</span>`;
    this.el.querySelector('.tp-title .pt')!.textContent = this.screen.title();
    this.el.querySelector('.tp-title .pr')!.textContent = this.screen.titleRight?.() ?? '';
    this.screen.render(this.body);

    // function keys
    const o = this.overlay;
    const labels = o?.kind === 'confirm' ? ['', '', '', 'YES', 'NO'] : o ? ['', '', '', '', ''] : this.screen.fkeys(this.page);
    const pages = this.screen.pages?.() ?? 1;
    this.el.querySelectorAll<HTMLButtonElement>('[data-f]').forEach((b, i) => { b.textContent = labels[i] ?? ''; b.disabled = !labels[i]; });
    (this.el.querySelector('[data-key="NEXT"]') as HTMLButtonElement).textContent = pages > 1 ? `NEXT ${this.page + 1}/${pages}` : 'NEXT';

    // prompt line / entry
    const pr = this.el.querySelector('.tp-prompt') as HTMLElement;
    if (o?.kind === 'num') pr.innerHTML = `<span class="ask">${esc(o.prompt)}</span> <b>${esc(o.buf)}</b><span class="caret">_</span>`;
    else if (o?.kind === 'text') {
      if (!pr.querySelector('input')) {
        pr.innerHTML = `<span class="ask">${esc(o.prompt)}</span> <input type="text" id="tp-text" spellcheck="false" autocomplete="off">`;
        const inp = pr.querySelector('input')!;
        inp.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); const cb = o.cb; this.overlay = null; cb(inp.value); this.redraw(); }
          if (e.key === 'Escape') { e.preventDefault(); this.overlay = null; this.redraw(); }
        });
      }
    } else if (o?.kind === 'confirm') pr.innerHTML = `<span class="ask">${esc(o.msg)}</span>`;
    else pr.innerHTML = `<span class="${this.promptMsg.level}">${esc(this.promptMsg.text)}</span>`;

    // popup
    const pop = this.el.querySelector('.tp-popup') as HTMLElement;
    if (o?.kind === 'choice') {
      pop.hidden = false;
      pop.innerHTML = `<div class="pt">${esc(o.title)}</div>${o.items.map((t, i) => `<div class="pi ${i === o.sel ? 'cur' : ''}" data-i="${i}">${i < 10 ? (i + 1) % 10 : ' '} ${esc(t)}</div>`).join('')}`;
      pop.querySelectorAll<HTMLElement>('[data-i]').forEach((d) => d.addEventListener('click', () => { const c = o.cb; this.overlay = null; c(+d.dataset.i!); this.redraw(); }));
      pop.querySelector('.pi.cur')?.scrollIntoView({ block: 'nearest' });
    } else pop.hidden = true;

    // hard key states
    this.el.querySelectorAll('.shift').forEach((b) => b.classList.toggle('lit', s.shift));
    this.el.querySelector('.step')!.classList.toggle('lit', s.stepMode);
    this.el.querySelector('[data-key="HOLD"]')!.classList.toggle('lit', it.status === 'PAUSED');
    (this.el.querySelector('#tp-enable') as HTMLInputElement).checked = s.tpEnabled;
    this.el.querySelector('.tp-switch')!.lastChild!.textContent = s.tpEnabled ? ' TP ON' : ' TP OFF';
    const lbl = s.coord === 'JOINT' ? ['J1', 'J2', 'J3', 'J4', 'J5', 'J6'] : AX;
    const ext = this.el.querySelector<HTMLElement>('.k-ext')!;
    ext.hidden = s.robots.length < 2 && !s.ctrl.rail;
    ext.querySelectorAll<HTMLElement>('[data-jog]').forEach((b) => { b.hidden = !s.ctrl.rail; });
    ext.querySelector('.grp')!.innerHTML = `GROUP<small>${s.active + 1}: ${esc(s.ctrl.name)}</small>`;
    this.el.querySelectorAll<HTMLButtonElement>('[data-jog]').forEach((b) => {
      const a = +b.dataset.jog!, d = +b.dataset.dir!;
      if (a === 6) return;
      b.innerHTML = `${d < 0 ? '−' : '+'}${lbl[a]}${s.coord === 'JOINT' ? '' : `<small>(J${a + 1})</small>`}`;
    });
  }
}
