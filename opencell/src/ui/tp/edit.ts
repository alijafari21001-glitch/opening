// EDIT screen: program listing with item cursor, POINT, TOUCHUP, [INST], [EDCMD], POSITION.
import { Screen, PendantApi, Key, esc, scrollIntoView } from './core';
import { itemsOf, applyNumber, choicesFor, replace, Item } from './lineedit';
import { parseLine } from '../../tp/parser';
import { TPPos, nextFreeP, TPProgram } from '../../tp/program';
import { lite } from '../../tp/interp';

export const POINT_TEMPLATES = ['J P[...] 100% FINE', 'J P[...] 100% CNT100', 'L P[...] 100mm/sec FINE', 'L P[...] 100mm/sec CNT100'];

export const INST: [string, string[]][] = [
  ['Registers', ['R[...]=...', 'R[...]=...+...', 'PR[...]=...', 'PR[...,...]=...']],
  ['I/O', ['DO[...]=...', 'RO[...]=...', 'DO[...]=PULSE,0.5sec', 'R[...]=DI[...]', 'GO[...]=...']],
  ['IF/SELECT', ['IF R[...]=...,JMP LBL[...]', 'IF DI[...]=...,JMP LBL[...]', 'IF R[...]=...,CALL ...', 'IF (...) THEN', 'ELSE', 'ENDIF',
    'SELECT R[...]=...,JMP LBL[...]', '=...,JMP LBL[...]', 'ELSE,JMP LBL[...]']],
  ['WAIT', ['WAIT ...(sec)', 'WAIT DI[...]=...', 'WAIT DI[...]=... TIMEOUT,LBL[...]', 'WAIT R[...]=...']],
  ['JMP/LBL', ['LBL[...]', 'JMP LBL[...]']],
  ['CALL', ['CALL ...']],
  ['FOR/ENDFOR', ['FOR R[...]=... TO ...', 'FOR R[...]=... DOWNTO ...', 'ENDFOR']],
  ['Program control', ['PAUSE', 'ABORT', 'END']],
  ['Miscellaneous', ['MESSAGE[...]', 'OVERRIDE=...%', 'TIMER[...]=START', 'TIMER[...]=STOP', 'TIMER[...]=RESET', 'R[...]=TIMER[...]', 'PAYLOAD[...]', '$WAITTMOUT=...', '!...']],
  ['Offset/Frames', ['OFFSET CONDITION PR[...]', 'TOOL_OFFSET CONDITION PR[...]', 'UFRAME_NUM=...', 'UTOOL_NUM=...', 'UFRAME[...]=PR[...]', 'UTOOL[...]=PR[...]']],
  ['Motion option', ['Offset,PR[...]', 'Tool_Offset,PR[...]', 'Offset']],
];

export function recordPos(api: PendantApi): TPPos {
  const s = api.s;
  const ext = s.extNow();
  return { uf: s.uframe, ut: s.utool, cart: { pose: s.tcpUser(), cfg: lite(s.config()) }, ...(ext ? { ext } : {}) };
}

export class EditScreen implements Screen {
  id = 'EDIT';
  line = 0;
  col = 0;
  private clip: string | null = null;
  private undo: { prog: string; lines: string[]; pos: string }[] = [];
  private lastPoint = 0;

  constructor(private api: PendantApi) {}

  get prog(): TPProgram | undefined { return this.api.s.program; }
  title() { return this.prog ? this.prog.name : 'EDIT'; }
  titleRight() {
    const p = this.prog;
    if (!p) return '';
    const n = Math.min(this.line + 1, p.lines.length + 1);
    return `LINE ${n}  ${this.api.interp.status}`;
  }
  pages() { return 2; }
  fkeys(page: number) {
    const it = this.item();
    if (page === 0) return ['POINT', '', '', it && it.kind === 'choice' ? '[CHOICE]' : '', 'TOUCHUP>'];
    return ['[INST]', '[EDCMD]', 'TEXT', this.posItem() ? 'POSITION' : '', ''];
  }

  show() {
    const p = this.prog;
    if (!p) return;
    const c = this.api.interp.cursor;
    if (c && c.prog === p.name) this.line = c.line;
    this.line = Math.min(this.line, p.lines.length);
  }

  /** Called by the pendant while a program runs so the cursor follows execution. */
  follow() {
    const c = this.api.interp.cursor;
    if (c && this.prog && c.prog === this.prog.name) { this.line = Math.min(c.line, this.prog.lines.length); this.col = 0; }
  }

  private items(): Item[] {
    const p = this.prog;
    if (!p || this.line >= p.lines.length) return [];
    return itemsOf(p.lines[this.line]);
  }
  private item(): Item | undefined { return this.col > 0 ? this.items()[this.col - 1] : undefined; }
  private posItem(): Item | undefined {
    const it = this.item();
    if (it && it.role === 'target' && it.tok.k === 'ref') return it;
    if (this.col === 0) return this.items().find((i) => i.role === 'target' && i.tok.k === 'ref');
    return undefined;
  }

  render(body: HTMLElement) {
    const p = this.prog;
    if (!p) { body.innerHTML = '<div class="hint">No program selected. Press SELECT, then CREATE (F2).</div>'; return; }
    const ic = this.api.interp.cursor;
    const execLine = ic && ic.prog === p.name && this.api.interp.status !== 'IDLE' ? ic.line : -1;
    const rows = p.lines.map((l, i) => {
      const r = parseLine(l);
      const cur = i === this.line;
      const items = cur ? itemsOf(l) : [];
      let html = '';
      if (cur && this.col > 0 && items[this.col - 1]) {
        const it = items[this.col - 1];
        html = esc(l.slice(0, it.hs)) + `<span class="isel">${esc(l.slice(it.hs, it.he)) || '&nbsp;'}</span>` + esc(l.slice(it.he));
      } else html = esc(l);
      const err = r.error ? ' err' : '';
      const remark = r.stmt.k === 'remark' || r.stmt.k === 'disabled' ? ' rem' : '';
      return `<tr class="${cur ? 'cur' : ''}${err}${remark}" data-l="${i}"><td class="ln${cur && this.col === 0 ? ' isel' : ''}">${i + 1}:</td><td class="ex">${i === execLine ? '▶' : ''}</td><td class="code">${html || '&nbsp;'}${p.lines[i].trim() && !r.error && r.stmt.k !== 'remark' && r.stmt.k !== 'disabled' ? ' ;' : ''}</td></tr>`;
    });
    rows.push(`<tr class="${this.line >= p.lines.length ? 'cur' : ''}" data-l="${p.lines.length}"><td class="ln">${p.lines.length + 1}:</td><td></td><td class="code">[End]</td></tr>`);
    body.innerHTML = `<table class="prog">${rows.join('')}</table>`;
    body.querySelectorAll<HTMLElement>('[data-l]').forEach((r) => r.addEventListener('click', () => { this.line = +r.dataset.l!; this.col = 0; this.cursorMoved(); this.api.redraw(); }));
    scrollIntoView(body);
    const cl = p.lines[this.line];
    if (cl !== undefined) {
      const r = parseLine(cl);
      if (r.error) this.api.prompt(`Syntax: ${r.error}`, 'warn');
    }
  }

  private cursorMoved() { this.api.interp.setCursor(this.prog!.name, this.line); }

  private saveUndo() {
    const p = this.prog!;
    this.undo.push({ prog: p.name, lines: [...p.lines], pos: JSON.stringify(p.pos) });
    if (this.undo.length > 50) this.undo.shift();
  }
  private setLine(text: string, focusPlaceholder = true) {
    const p = this.prog!;
    this.saveUndo();
    const old = this.item();
    p.lines[this.line] = text;
    p.modified = Date.now();
    const items = itemsOf(text);
    const ph = focusPlaceholder ? items.findIndex((i) => text.slice(i.hs, i.he).includes('...')) : -1;
    if (ph >= 0) this.col = ph + 1;
    else if (old) { const k = items.findIndex((i) => i.hs >= old.hs); this.col = k >= 0 ? k + 1 : Math.min(this.col, items.length); }
    this.api.s.emit();
    const r = parseLine(text);
    if (r.error) this.api.prompt(`Syntax: ${r.error}`, 'warn');
  }
  private insertLines(lines: string[], at = this.line) {
    const p = this.prog!;
    this.saveUndo();
    p.lines.splice(at, 0, ...lines);
    p.modified = Date.now();
    this.line = at;
    const items = itemsOf(lines[0]);
    const ph = items.findIndex((i) => lines[0].slice(i.hs, i.he).includes('...'));
    this.col = ph >= 0 ? ph + 1 : 0;
    this.api.s.emit();
  }

  private editable(): boolean {
    if (!this.prog) { this.api.prompt('Select a program first', 'warn'); return false; }
    if (this.api.interp.running) { this.api.prompt('Program is running. HOLD it to edit.', 'warn'); return false; }
    return true;
  }

  key(k: Key, shift: boolean): boolean {
    const p = this.prog;
    if (!p) return false;
    const n = p.lines.length;
    switch (k) {
      case 'UP': if (shift) this.line = Math.max(0, this.line - 8); else this.line = Math.max(0, this.line - 1); this.col = 0; this.cursorMoved(); return true;
      case 'DOWN': if (shift) this.line = Math.min(n, this.line + 8); else this.line = Math.min(n, this.line + 1); this.col = 0; this.cursorMoved(); return true;
      case 'LEFT': this.col = Math.max(0, this.col - 1); return true;
      case 'RIGHT': this.col = Math.min(this.items().length, this.col + 1); return true;
      case 'ITEM': this.api.askNumber('Enter line number:', (v) => { this.line = Math.max(0, Math.min(n, Math.round(v) - 1)); this.col = 0; this.cursorMoved(); this.api.redraw(); }); return true;
      case 'ENTER': {
        const it = this.item();
        if (!it || !this.editable()) return true;
        if (it.kind === 'text') this.editText(it);
        else if (it.kind === 'choice') this.choice(it);
        else if (it.numeric) this.api.askNumber('Enter value:', (v) => this.setLine(applyNumber(p.lines[this.line], it, v)));
        return true;
      }
      default:
        if (/^[0-9.-]$/.test(k)) {
          const it = this.item();
          if (!it || !this.editable()) return true;
          if (it.numeric) { this.api.askNumber('Enter value:', (v) => this.setLine(applyNumber(p.lines[this.line], it, v)), k); return true; }
          if (it.kind === 'choice') { this.choice(it); return true; }
        }
    }
    return false;
  }

  private editText(it: Item) {
    const p = this.prog!;
    const l = p.lines[this.line];
    const cur = l.slice(it.rs, it.re);
    this.api.askText('Enter text:', cur === '...' ? '' : cur, (v) => this.setLine(replace(l, it.rs, it.re, v.replace(/[\];]/g, '')), false));
  }

  private choice(it: Item) {
    const p = this.prog!;
    const l = p.lines[this.line];
    const ch = choicesFor(l, it, Object.keys(this.api.s.programs).filter((x) => x !== p.name));
    if (!ch.length) { if (it.numeric) this.api.askNumber('Enter value:', (v) => this.setLine(applyNumber(l, it, v))); return; }
    this.api.choose('CHOICE', ch.map((c) => c.label), (i) => {
      const c = ch[i];
      const nl = c.apply(l);
      this.setLine(nl);
      if (c.thenNumber) {
        const it2 = this.item();
        if (it2 && it2.numeric) this.api.askNumber('Enter value:', (v) => this.setLine(applyNumber(p.lines[this.line], it2, v)));
      }
    });
  }

  fkey(i: number, shift: boolean, page: number) {
    if (!this.editable()) return;
    const p = this.prog!;
    if (page === 0) {
      if (i === 1) {
        if (shift) this.point(POINT_TEMPLATES[this.lastPoint]);
        else this.api.choose('POINT (motion template)', POINT_TEMPLATES.map((t) => t.replace('[...]', '[ ]')), (k) => { this.lastPoint = k; this.point(POINT_TEMPLATES[k]); }, this.lastPoint);
      }
      if (i === 4) { const it = this.item(); if (it && it.kind === 'choice') this.choice(it); }
      if (i === 5) {
        if (!shift) { this.api.prompt('TOUCHUP: hold SHIFT and press F5 to record the current position', 'warn'); return; }
        this.touchup();
      }
      return;
    }
    if (i === 1) this.inst();
    if (i === 2) this.edcmd();
    if (i === 3) {
      const l = p.lines[this.line] ?? '';
      const at = this.line;
      const ask = (init: string) => this.api.askText('Edit line text:', init, (v) => {
        const r = parseLine(v);
        if (r.error) { this.api.prompt(`Syntax: ${r.error}`, 'warn'); ask(v); return; }
        if (at >= p.lines.length) this.insertLines([v.trim()], p.lines.length);
        else { this.line = at; this.setLine(v.trim(), false); }
      });
      ask(l);
    }
    if (i === 4) {
      const it = this.posItem();
      if (it && typeof it.tok.idx === 'number') this.api.open('POSDETAIL', { kind: it.tok.name, prog: p.name, idx: it.tok.idx });
    }
  }

  private point(template: string) {
    const p = this.prog!;
    const n = nextFreeP(p);
    p.pos[n] = recordPos(this.api);
    const at = this.line >= p.lines.length ? p.lines.length : this.line + 1;
    this.insertLines([template.replace('P[...]', `P[${n}]`)], at);
    this.col = 0;
    this.api.prompt(`P[${n}] recorded (UF:${p.pos[n].uf} UT:${p.pos[n].ut})`);
    this.api.s.emit();
  }

  private touchup() {
    const p = this.prog!;
    const l = p.lines[this.line];
    const r = l !== undefined ? parseLine(l) : null;
    if (!r || r.stmt.k !== 'motion') { this.api.prompt('TOUCHUP: cursor is not on a motion line', 'warn'); return; }
    const targets = r.toks.filter((t) => t.role === 'target');
    const it = this.item();
    const tok = it && it.role === 'target' ? it.tok : targets[targets.length - 1];
    let idx = tok.idx;
    if (tok.k === 'ph' || idx === null || idx === undefined) {
      idx = nextFreeP(p);
      this.setLine(replace(l, tok.s, tok.e, `P[${idx}]`), false);
    }
    if (typeof idx !== 'number') { this.api.prompt('TOUCHUP: indirect index not supported', 'warn'); return; }
    if (tok.name === 'PR') {
      const v = recordPos(this.api);
      this.api.s.PR[idx].v = { ...v, uf: -1, ut: -1 };
      this.api.prompt(`Position has been recorded to PR[${idx}]`);
    } else {
      p.pos[idx] = { ...recordPos(this.api), cmt: p.pos[idx]?.cmt };
      this.api.prompt(`Position has been recorded to P[${idx}]`);
    }
    p.modified = Date.now();
    this.api.s.emit();
  }

  private inst() {
    this.api.choose('Instruction', INST.map(([c]) => c), (ci) => {
      const [cat, list] = INST[ci];
      this.api.choose(cat, list.map((t) => t.replace(/\.\.\./g, '…')), (ti) => {
        const t = list[ti];
        const p = this.prog!;
        if (cat === 'Motion option') {
          const l = p.lines[this.line];
          if (!l || parseLine(l).stmt.k !== 'motion') { this.api.prompt('Put the cursor on a motion line to add an option', 'warn'); return; }
          this.setLine(`${l.replace(/\s+(Offset|Tool_Offset)(\s*,\s*PR\[[^\]]*\])?/i, '')} ${t}`);
          return;
        }
        if (t === 'CALL ...') {
          const progs = Object.keys(this.api.s.programs).filter((x) => x !== p.name);
          if (!progs.length) { this.insertLines([t]); return; }
          this.api.choose('Program', progs, (k) => this.insertLines([`CALL ${progs[k]}`]));
          return;
        }
        this.insertLines([t]);
        if (t === 'MESSAGE[...]' || t === '!...') { const it = this.item(); if (it) this.editText(it); }
      });
    });
  }

  private edcmd() {
    const p = this.prog!;
    const cmds = ['Insert', 'Delete', 'Copy', 'Cut', 'Paste', 'Remark (on/off)', 'Undo', 'Renumber P[]'];
    this.api.choose('EDCMD', cmds, (i) => {
      const hasLine = this.line < p.lines.length;
      switch (cmds[i]) {
        case 'Insert': this.insertLines(['']); this.api.prompt('1 line inserted'); break;
        case 'Delete':
          if (!hasLine) return;
          this.api.confirm(`Delete line ${this.line + 1}?`, () => { this.saveUndo(); p.lines.splice(this.line, 1); this.col = 0; this.api.s.emit(); });
          break;
        case 'Copy': if (hasLine) { this.clip = p.lines[this.line]; this.api.prompt('Line copied'); } break;
        case 'Cut': if (hasLine) { this.saveUndo(); this.clip = p.lines.splice(this.line, 1)[0]; this.api.prompt('Line cut'); this.api.s.emit(); } break;
        case 'Paste': if (this.clip !== null) { this.insertLines([this.clip]); this.col = 0; this.api.prompt('Pasted before the cursor line (same position IDs)'); } break;
        case 'Remark (on/off)': {
          if (!hasLine) return;
          const l = p.lines[this.line];
          this.setLine(l.trimStart().startsWith('//') ? l.trimStart().slice(2) : `//${l}`, false);
          break;
        }
        case 'Undo': {
          const u = this.undo.pop();
          if (!u || u.prog !== p.name) { this.api.prompt('Nothing to undo', 'warn'); return; }
          p.lines = u.lines; p.pos = JSON.parse(u.pos);
          this.line = Math.min(this.line, p.lines.length); this.col = 0;
          this.api.s.emit();
          break;
        }
        case 'Renumber P[]': this.renumber(); break;
      }
    });
  }

  /** Renumber P[] in order of appearance (like EDCMD > Renumber). */
  private renumber() {
    const p = this.prog!;
    this.saveUndo();
    const map = new Map<number, number>();
    let next = 1;
    for (const l of p.lines) for (const m of l.matchAll(/(?<![A-Z])P\[(\d+)/g)) if (!map.has(+m[1])) map.set(+m[1], next++);
    p.lines = p.lines.map((l) => l.replace(/(?<![A-Z])P\[(\d+)/g, (_, d) => `P[${map.get(+d)}`));
    const pos: TPProgram['pos'] = {};
    for (const [o, nn] of map) if (p.pos[o]) pos[nn] = p.pos[o];
    p.pos = pos;
    this.api.prompt(`Renumbered ${map.size} positions`);
    this.api.s.emit();
  }
}
