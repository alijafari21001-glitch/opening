import type { CellState, IOPort } from '../state';
import { PlcBus, IN_PORTS, OUT_PORTS, type PlcLink } from '../bus/plcbus';

const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** "PLC" button + dialog: wire robot I/O to OpenRung tags and show the link's live state. */
export class PlcLinkUI {
  private dlg: HTMLDialogElement;
  constructor(private s: CellState, private bus: PlcBus, private btn: HTMLElement) {
    this.dlg = document.createElement('dialog');
    this.dlg.id = 'plclink';
    document.body.appendChild(this.dlg);
    btn.addEventListener('click', () => { this.render(); this.dlg.showModal(); });
    bus.onChange(() => { this.badge(); if (this.dlg.open) this.render(); });
    s.onChange(() => { if (this.dlg.open) this.values(); });
    this.badge();
  }

  private badge() {
    this.btn.classList.toggle('on', this.bus.connected);
    this.btn.title = this.bus.connected ? `PLC link: connected (${this.mode()})` : 'PLC link: no OpenRung controller found';
  }
  private mode() { return this.bus.mode === 'RUN' ? 'Run' : this.bus.mode === 'FAULT' ? 'Faulted' : 'Program'; }

  private render() {
    const b = this.bus, L = this.s.plcLinks;
    const opt = (list: IOPort[], cur: IOPort) => list.map((p) => `<option${p === cur ? ' selected' : ''}>${p}</option>`).join('');
    this.dlg.innerHTML = `
      <h2>PLC link</h2>
      <p class="st ${b.connected ? 'ok' : 'no'}">${b.connected
        ? `Connected to the OpenRung controller, mode ${this.mode()}.`
        : 'No controller found. Open OpenRung in another tab of this site (or the PLC tab of the app) and go online.'}</p>
      <p class="note">An <b>input</b> copies a PLC tag into a robot input every 100 ms (DI[1] = Start_Robot).
      An <b>output</b> writes a robot output into a PLC tag (Robot_Done = DO[1]). Use tags the ladder only reads, like input tags or a status BOOL.</p>
      <table class="links">
        <thead><tr><th>Direction</th><th>Robot signal</th><th></th><th>PLC tag</th><th>Value</th><th></th></tr></thead>
        <tbody>${L.map((l, i) => `<tr data-i="${i}">
          <td><select data-k="dir"><option value="in"${l.dir === 'in' ? ' selected' : ''}>PLC → robot</option><option value="out"${l.dir === 'out' ? ' selected' : ''}>robot → PLC</option></select></td>
          <td><select data-k="port">${opt(l.dir === 'in' ? IN_PORTS : OUT_PORTS, l.port)}</select></td>
          <td><input data-k="idx" type="number" min="1" max="512" value="${l.idx}"></td>
          <td><input data-k="tag" value="${esc(l.tag)}" placeholder="Tag name" class="${b.missing.has(l.tag) ? 'bad' : ''}"></td>
          <td class="v" data-v="${i}"></td>
          <td><button data-del="${i}" title="Remove">✕</button></td></tr>`).join('')}
        </tbody>
      </table>
      ${b.missing.size ? `<p class="bad">The controller has no tag named ${[...b.missing].map(esc).join(', ')}.</p>` : ''}
      <div class="btns">
        <button id="pl-add-in">Add PLC → robot</button>
        <button id="pl-add-out">Add robot → PLC</button>
        <span class="spacer"></span>
        <form method="dialog"><button>Close</button></form>
      </div>`;
    this.values();
    const nextIdx = (port: IOPort) => Math.max(0, ...L.filter((l) => l.port === port).map((l) => l.idx)) + 1;
    const add = (l: PlcLink) => { L.push(l); this.s.emit(); this.render(); };
    this.dlg.querySelector('#pl-add-in')!.addEventListener('click', () => add({ dir: 'in', port: 'DI', idx: nextIdx('DI'), tag: '' }));
    this.dlg.querySelector('#pl-add-out')!.addEventListener('click', () => add({ dir: 'out', port: 'DO', idx: nextIdx('DO'), tag: '' }));
    this.dlg.querySelectorAll<HTMLButtonElement>('[data-del]').forEach((el) => el.addEventListener('click', () => {
      L.splice(+el.dataset.del!, 1); this.s.emit(); this.render();
    }));
    this.dlg.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-k]').forEach((el) => el.addEventListener('change', () => {
      const i = +(el.closest('tr') as HTMLElement).dataset.i!, l = L[i], k = el.dataset.k!;
      if (k === 'dir') { l.dir = el.value as 'in' | 'out'; l.port = l.dir === 'in' ? 'DI' : 'DO'; }
      if (k === 'port') l.port = el.value as IOPort;
      if (k === 'idx') l.idx = Math.max(1, Math.min(512, Math.round(+el.value) || 1));
      if (k === 'tag') l.tag = el.value.trim();
      this.s.emit(); this.render();
    }));
  }

  private values() {
    this.s.plcLinks.forEach((l, i) => {
      const td = this.dlg.querySelector(`[data-v="${i}"]`);
      if (td) td.textContent = String(this.s.io[l.port]?.[l.idx] ?? '');
    });
  }
}
