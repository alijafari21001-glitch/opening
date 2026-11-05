import type { CellState } from '../state';
import type { ObjRole } from '../cell/objects';
import { LIBRARY, LIB_CATS, buildLib } from '../cell/library';
import { importCad } from '../cell/importer';

const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const ONSHAPE = 'https://cad.onshape.com/documents';

/** "Library" dialog: parametric fences, conveyors, pallets, sensors, machines; your own CAD files; Onshape. */
export class LibraryUI {
  private dlg: HTMLDialogElement;
  private cat = LIB_CATS[0];
  private file: HTMLInputElement;
  private role: ObjRole = 'fixture';
  private placed = 0;
  constructor(private s: CellState, btn: HTMLElement) {
    this.dlg = document.createElement('dialog');
    this.dlg.id = 'library';
    document.body.appendChild(this.dlg);
    this.file = document.createElement('input');
    this.file.type = 'file'; this.file.id = 'lib-file'; this.file.multiple = true; this.file.accept = '.stl,.obj,.glb'; this.file.hidden = true;
    document.body.appendChild(this.file);
    this.file.addEventListener('change', async () => {
      const fs = [...(this.file.files ?? [])]; this.file.value = '';
      for (const f of fs) await importCad(this.s, f, { role: this.role });
      this.s.emit(); this.dlg.close();
    });
    btn.addEventListener('click', () => { this.render(); this.dlg.showModal(); });
  }

  private floor() { const r = this.s.robots[0]; return this.s.world.floorZ ?? r.base.z - r.model.baseZ; }

  private render() {
    const items = this.cat === 'CAD' ? [] : LIBRARY.filter((i) => i.cat === this.cat);
    this.dlg.innerHTML = `
      <div class="lib-head"><h2>Library</h2><form method="dialog"><button>Close</button></form></div>
      <div class="lib-body">
        <nav>${[...LIB_CATS, 'CAD'].map((c) => `<button data-cat="${c}" class="${c === this.cat ? 'cur' : ''}">${c === 'CAD' ? 'Your CAD + Onshape' : c}</button>`).join('')}</nav>
        <div class="lib-items">${this.cat === 'CAD' ? this.cadHtml() : items.map((it) => `
          <div class="card" data-id="${it.id}">
            <h3>${esc(it.name)}</h3><p>${esc(it.desc)}</p>
            ${it.params.length ? `<div class="params">${it.params.map((q) => `<label>${esc(q.label)}<input type="number" data-k="${q.k}" value="${q.def}" step="10"${q.min !== undefined ? ` min="${q.min}"` : ''}> mm</label>`).join('')}</div>` : ''}
            <button class="primary" data-add="${it.id}">Add to cell</button>
          </div>`).join('')}</div>
      </div>
      <p class="note">New items go in front of the robot and are selected: move them with the Move gizmo or the X / Y fields in the Cell Browser.</p>`;
    this.dlg.querySelectorAll<HTMLButtonElement>('[data-cat]').forEach((b) => b.addEventListener('click', () => { this.cat = b.dataset.cat!; this.render(); }));
    this.dlg.querySelectorAll<HTMLButtonElement>('[data-add]').forEach((b) => b.addEventListener('click', () => {
      const card = b.closest('.card') as HTMLElement, p: Record<string, number> = {};
      card.querySelectorAll<HTMLInputElement>('[data-k]').forEach((i) => { p[i.dataset.k!] = +i.value; });
      this.add(b.dataset.add!, p);
    }));
    this.dlg.querySelector('#lib-import')?.addEventListener('click', () => this.file.click());
    this.dlg.querySelector<HTMLSelectElement>('#lib-role')?.addEventListener('change', (e) => { this.role = (e.target as HTMLSelectElement).value as ObjRole; });
  }

  private cadHtml() {
    return `<div class="card wide">
        <h3>Import your CAD</h3>
        <p>STL, OBJ or GLB from SolidWorks, Fusion, Inventor, Onshape or any CAD program. Units are guessed from the size (mm, cm, m or inches) and can be changed after.</p>
        <div class="params"><label>Add as<select id="lib-role">${(['fixture', 'part', 'obstacle', 'machine', 'tool'] as ObjRole[]).map((r) => `<option value="${r}"${r === this.role ? ' selected' : ''}>${r === 'tool' ? 'tooling on the active UTOOL' : r}</option>`).join('')}</select></label></div>
        <button class="primary" id="lib-import">Import CAD files…</button>
      </div>
      <div class="card wide">
        <h3>Design it in Onshape</h3>
        <p>Onshape is a free browser CAD program. Model a gripper, fixture or layout there, then bring it in:</p>
        <ol><li>In Onshape, right-click the Part Studio or Assembly tab and choose <b>Export</b>.</li>
          <li>Format <b>STL</b>, units <b>Millimeter</b>, resolution <b>Fine</b>. Tick "Export as one file" for an assembly.</li>
          <li>Come back here and use <b>Import CAD files</b>.</li></ol>
        <a class="btnlink" href="${ONSHAPE}" target="_blank" rel="noopener">Open Onshape ↗</a>
      </div>`;
  }

  private add(id: string, p: Record<string, number>) {
    const k = this.placed++ % 4;
    const list = buildLib(id, this.floor(), 900 + (k % 2) * 400, (k < 2 ? -1 : 1) * 600, p);
    this.s.objects.push(...list);
    this.s.selectedObj = list[0].id;
    this.s.message('info', `Added ${list[0].name} from the library`);
    this.s.emit();
    this.dlg.close();
  }
}
