// Bottom bar: run controls (like the simulator's cycle start panel), cycle time, and the alarm/message log.
import { CellState, LogEntry, OVERRIDES, Mode } from '../state';
import { Interpreter } from '../tp/interp';

export class RunBar {
  private logEl: HTMLElement;
  private root: HTMLElement;
  constructor(el: HTMLElement, private s: CellState, private interp: Interpreter) {
    this.root = el;
    el.innerHTML = `
      <div class="runctl">
        <div class="row">
          <label class="muted" for="rb-prog">Program</label>
          <select id="rb-prog"></select>
          <label class="muted" for="rb-mode">Mode</label>
          <select id="rb-mode"><option>T1</option><option>T2</option><option>AUTO</option></select>
        </div>
        <div class="row">
          <button id="rb-run" title="Cycle start from the top (or resume)">▶ Run</button>
          <button id="rb-hold" title="HOLD">❚❚ Hold</button>
          <button id="rb-sbwd" title="Step backward one motion">◀ Step</button>
          <button id="rb-sfwd" title="Execute one line">Step ▶</button>
          <button id="rb-abort" title="Abort the program">■ Abort</button>
          <button id="rb-reset" title="Clear alarms">Reset</button>
        </div>
        <div class="row">
          <label class="muted" for="rb-ov">Override</label><input id="rb-ov" type="range" min="0" max="${OVERRIDES.length - 1}" step="1"><span class="ov ct"></span>
          <span class="muted" style="margin-left:auto">Cycle</span><span class="ct cyc">0.00 s</span>
        </div>
        <div class="row muted stat"></div>
      </div>
      <div class="log" aria-live="polite"></div>`;
    this.logEl = el.querySelector('.log')!;
    const $ = <T extends HTMLElement>(id: string) => el.querySelector('#' + id) as T;
    $('rb-run').addEventListener('click', () => {
      if (interp.status === 'PAUSED') interp.resume(); else interp.start(s.selected, 0);
    });
    $('rb-hold').addEventListener('click', () => interp.hold());
    $('rb-sfwd').addEventListener('click', () => {
      if (interp.status === 'PAUSED') interp.resume({ step: true });
      else interp.start(s.selected, interp.cursor?.prog === s.selected ? interp.cursor.line : 0, { step: true });
    });
    $('rb-sbwd').addEventListener('click', () => interp.backward(s.selected, interp.cursor?.prog === s.selected ? interp.cursor.line : 0));
    $('rb-abort').addEventListener('click', () => interp.abort());
    $('rb-reset').addEventListener('click', () => { interp.reset(); s.message('info', 'RESET'); s.emit(); });
    $<HTMLSelectElement>('rb-prog').addEventListener('change', (e) => {
      if (interp.running) return;
      s.selected = (e.target as HTMLSelectElement).value; interp.setCursor(s.selected, 0); s.emit();
    });
    $<HTMLSelectElement>('rb-mode').addEventListener('change', (e) => { s.mode = (e.target as HTMLSelectElement).value as Mode; s.emit(); });
    $<HTMLInputElement>('rb-ov').addEventListener('input', (e) => { s.override = OVERRIDES[+(e.target as HTMLInputElement).value]; s.emit(); });
    s.onLog((e) => this.add(e));
    s.onChange(() => this.refresh());
    interp.onChange(() => this.refresh());
    this.refresh();
  }
  private refresh() {
    const s = this.s, it = this.interp, el = this.root;
    const o = s.override;
    el.querySelector('.ov')!.textContent = typeof o === 'number' ? `${o}%` : o;
    const ov = el.querySelector('#rb-ov') as HTMLInputElement;
    if (document.activeElement !== ov) ov.value = String(OVERRIDES.indexOf(o));
    const sel = el.querySelector('#rb-prog') as HTMLSelectElement;
    const names = Object.keys(s.programs).sort();
    if (sel.options.length !== names.length || [...sel.options].some((op, i) => op.value !== names[i])) { sel.textContent = ''; for (const n of names) sel.append(new Option(n, n)); }
    sel.value = s.selected;
    sel.disabled = it.running;
    (el.querySelector('#rb-mode') as HTMLSelectElement).value = s.mode;
    el.querySelector('.cyc')!.textContent = `${(it.running || it.status === 'PAUSED' ? it.cycleTime : it.lastCycle).toFixed(2)} s`;
    const c = it.cursor;
    el.querySelector('.stat')!.textContent = `${it.status}${c ? ` · ${c.prog} line ${c.line + 1}` : ''}${it.fault ? ' · FAULT (press Reset)' : ''}${s.stepMode ? ' · STEP' : ''}`;
    (el.querySelector('#rb-run') as HTMLButtonElement).textContent = it.status === 'PAUSED' ? '▶ Resume' : '▶ Run';
  }
  private add(e: LogEntry) {
    const d = document.createElement('div');
    d.className = e.level;
    const t = e.t.toLocaleTimeString([], { hour12: false });
    d.innerHTML = `<span class="t">${t}</span>${e.level === 'alarm' ? 'ALARM ' : e.level === 'warn' ? 'WARN  ' : ''}`;
    d.append(document.createTextNode(e.text));
    this.logEl.append(d);
    while (this.logEl.childElementCount > 300) this.logEl.firstElementChild!.remove();
    this.logEl.scrollTop = this.logEl.scrollHeight;
  }
}
