// Cells: named cells kept in this browser, so you can switch between layouts and programs without files.
// Each entry is a full cell snapshot (robots, programs, registers, I/O, objects, PLC links). Files still work (download / open).
import type { CellState } from '../state';
import { download } from './download';

const KEY = 'opencell.cells';
const CUR = 'opencell.cellName';
type Entry = { savedAt: string; cell: unknown };

function all(): Record<string, Entry> { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; } }
function put(v: Record<string, Entry>) { localStorage.setItem(KEY, JSON.stringify(v)); }
export function currentCellName(): string { try { return localStorage.getItem(CUR) || ''; } catch { return ''; } }
function setCurrent(n: string) { try { localStorage.setItem(CUR, n); } catch { /* storage unavailable */ } }
const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

export class CellsUI {
  readonly dlg = document.createElement('dialog');
  constructor(private s: CellState, private builtins: { name: string; desc: string; load: () => void }[]) {
    this.dlg.className = 'cellsdlg';
    document.body.appendChild(this.dlg);
    this.dlg.addEventListener('click', (e) => this.onClick(e));
    window.addEventListener('keydown', (e) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      if (k === 's') { e.preventDefault(); this.quickSave(); }
      else if (k === 'o') { e.preventDefault(); this.open(); }
    });
  }
  open() { this.render(); if (!this.dlg.open) this.dlg.showModal(); }

  /** Ctrl+S: save over the cell you are in, or ask for a name the first time. */
  quickSave() {
    const n = currentCellName() || prompt('Save this cell as', this.s.world.name || 'My cell')?.trim();
    if (!n) return;
    this.save(n);
  }
  save(name: string) {
    const v = all();
    v[name] = { savedAt: new Date().toISOString(), cell: this.s.snapshot() };
    try { put(v); } catch { this.s.message('alarm', 'Could not save: browser storage is full or blocked. Use Download instead.'); return; }
    setCurrent(name);
    this.s.message('info', `Saved cell "${name}" in this browser (Ctrl+S saves again, Ctrl+O switches cells)`);
    this.render();
  }
  private load(name: string) {
    const e = all()[name];
    if (!e) return;
    this.s.restore(e.cell as Parameters<CellState['restore']>[0]);
    this.s.save();
    setCurrent(name);
    location.reload();
  }

  private render() {
    const v = all(), cur = currentCellName();
    const rows = Object.entries(v).sort((a, b) => b[1].savedAt.localeCompare(a[1].savedAt)).map(([n, e]) => `
      <tr class="${n === cur ? 'cur' : ''}"><td><b>${esc(n)}</b>${n === cur ? ' <span class="tag">open</span>' : ''}<div class="d">${new Date(e.savedAt).toLocaleString()}</div></td>
      <td class="acts"><button data-a="open" data-n="${esc(n)}" class="primary">Open</button><button data-a="over" data-n="${esc(n)}" title="Save the current cell over this one">Save here</button>
      <button data-a="dl" data-n="${esc(n)}" title="Download as a .opencell.json file">Download</button><button data-a="del" data-n="${esc(n)}" title="Delete from this browser">Delete</button></td></tr>`).join('');
    this.dlg.innerHTML = `<h2>Cells</h2>
      <p class="note">Your cells are saved in this browser. Switching reloads the cell with its robots, programs, registers and objects. Ctrl+S saves, Ctrl+O opens this list.</p>
      <div class="saveas"><input id="cell-name" placeholder="Name" value="${esc(cur || this.s.world.name || 'My cell')}"><button data-a="saveas" class="primary">Save current cell</button>
      <button data-a="file" title="Download the current cell as a file">Download file</button></div>
      <h3>Saved cells</h3>
      ${rows ? `<table class="cells">${rows}</table>` : '<p class="note">Nothing saved yet.</p>'}
      <h3>Start from</h3>
      <table class="cells">${this.builtins.map((b, i) => `<tr><td><b>${esc(b.name)}</b><div class="d">${esc(b.desc)}</div></td><td class="acts"><button data-a="builtin" data-i="${i}">Load</button></td></tr>`).join('')}</table>
      <form method="dialog"><button>Close</button></form>`;
  }

  private onClick(e: Event) {
    const b = (e.target as HTMLElement).closest('button[data-a]') as HTMLButtonElement | null;
    if (!b) return;
    const a = b.dataset.a!, n = b.dataset.n ?? '';
    if (a === 'saveas') { const nm = (this.dlg.querySelector('#cell-name') as HTMLInputElement).value.trim(); if (nm) this.save(nm); }
    else if (a === 'file') download(`${this.s.world.name || 'cell'}.opencell.json`, JSON.stringify(this.s.snapshot(), null, 1), 'application/json');
    else if (a === 'open') this.load(n);
    else if (a === 'over') { if (confirm(`Replace "${n}" with the current cell?`)) this.save(n); }
    else if (a === 'dl') download(`${n}.opencell.json`, JSON.stringify(all()[n]?.cell, null, 1), 'application/json');
    else if (a === 'del') { if (confirm(`Delete "${n}" from this browser?`)) { const v = all(); delete v[n]; put(v); if (currentCellName() === n) setCurrent(''); this.render(); } }
    else if (a === 'builtin') { setCurrent(''); this.builtins[+b.dataset.i!].load(); }
  }
}
