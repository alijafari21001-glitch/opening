import type { CellState } from '../state';
import { fromLS } from '../tp/lsimport';
import { check, pack } from '../tp/handlingpro';
import { zip } from './zip';
import { BRANDS, Brand, translate } from '../tp/brands';
import { toLS } from '../tp/ls';
import { download, downloadBytes } from './download';

const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** "TP files" dialog: load .LS programs, check them for HandlingPRO, export the whole robot as a pack. */
export class TPFilesUI {
  private dlg: HTMLDialogElement;
  private input: HTMLInputElement;
  private shortNames = true;
  private notes: string[] = [];
  private brand: Brand | 'fanuc' = 'abb';
  constructor(private s: CellState, btn: HTMLElement) {
    this.dlg = document.createElement('dialog');
    this.dlg.id = 'tpfiles';
    document.body.appendChild(this.dlg);
    this.input = document.createElement('input');
    this.input.type = 'file'; this.input.id = 'tp-file'; this.input.multiple = true; this.input.accept = '.ls,.LS,.txt'; this.input.hidden = true;
    document.body.appendChild(this.input);
    this.input.addEventListener('change', () => this.load());
    btn.addEventListener('click', () => { this.notes = []; this.render(); this.dlg.showModal(); });
  }

  private async load() {
    const files = [...(this.input.files ?? [])];
    this.input.value = '';
    for (const f of files) {
      try {
        const { prog, warnings } = fromLS(await f.text());
        const had = !!this.s.programs[prog.name];
        this.s.programs[prog.name] = prog;
        this.notes.push(`${had ? 'Replaced' : 'Loaded'} ${prog.name} (${prog.lines.length} lines, ${Object.keys(prog.pos).length} positions) from ${f.name}.`);
        for (const w of warnings) this.notes.push('  ' + w);
        this.s.message('info', `Loaded ${prog.name} from ${f.name}`);
      } catch (e) { this.notes.push(`${f.name}: ${(e as Error).message}`); }
    }
    this.s.emit();
    this.render();
  }

  private brandFiles() {
    const r = this.s.ctrl;
    if (this.brand === 'fanuc') return { files: Object.values(r.programs).map((p) => ({ name: `${p.name}.LS`, data: toLS(p) })), warnings: [] as string[] };
    return translate(r, this.brand, this.s.selected);
  }
  private preview() {
    const t = this.brandFiles();
    const sel = this.s.selected;
    const f = t.files.find((x) => x.name.toUpperCase().startsWith(sel + '.')) ?? t.files[0];
    if (!f) return '';
    return `<div class="note">${esc(f.name)}${t.files.length > 1 ? ` (1 of ${t.files.length} files)` : ''}${t.warnings.length ? ` · ${t.warnings.length} line${t.warnings.length > 1 ? 's' : ''} not translated` : ''}</div>
      <pre class="code">${esc(f.data.replace(/\r/g, ''))}</pre>
      ${t.warnings.length ? `<details><summary class="note">What was not translated</summary><pre class="notes">${esc(t.warnings.join('\n'))}</pre></details>` : ''}`;
  }

  private render() {
    const r = this.s.ctrl;
    const fs = check(r, { shortNames: this.shortNames });
    const errs = fs.filter((f) => f.level === 'error').length;
    const progs = Object.keys(r.programs).sort();
    this.dlg.innerHTML = `
      <h2>TP files</h2>
      <p class="note">Robot <b>${esc(r.name)}</b> (${esc(r.model.name)}), ${progs.length} programs. Programs are FANUC-style ASCII <b>.LS</b> files.</p>
      <h3>Load programs</h3>
      <p class="note">Pick .LS files exported from HandlingPRO, ROBOGUIDE or a controller (several at once is fine). A program with the same name is replaced.</p>
      <div class="btns"><button id="tf-load">Load .LS files…</button></div>
      ${this.notes.length ? `<pre class="notes">${esc(this.notes.join('\n'))}</pre>` : ''}
      <h3>Check for HandlingPRO</h3>
      <label class="chk"><input type="checkbox" id="tf-short" ${this.shortNames ? 'checked' : ''}> Older controller (V7/V8): program names up to 8 characters</label>
      ${fs.length ? `<table class="find">${fs.map((f) => `<tr class="${f.level}"><td>${f.level === 'error' ? '✕' : '!'}</td><td>${esc(f.prog)}</td><td>${esc(f.text)}</td></tr>`).join('')}</table>`
        : '<p class="ok">✓ No problems found. Every program should load.</p>'}
      <h3>Export to HandlingPRO</h3>
      <p class="note">One .zip with every program as .LS, <b>OCSETUP.LS</b> (run it once on the robot: it sets the tool frames, user frames, PRs and registers from this cell) and README.txt with the load steps.</p>
      <div class="btns">
        <button id="tf-zip" class="primary">Download HandlingPRO pack (.zip)</button>
        <button id="tf-each" title="If your browser or viewer blocks .zip files">Download files one by one</button>
        <span class="spacer"></span>
        <form method="dialog"><button>Close</button></form>
      </div>
      <h3>Other robot brands</h3>
      <p class="note">See and download this robot's programs as another brand's language. Positions are written as Cartesian poses: touch them up on the real robot. Lines a language can't express stay as comments and are listed.</p>
      <div class="btns"><select id="tf-brand"><option value="fanuc"${this.brand === 'fanuc' ? ' selected' : ''}>FANUC TP (.LS)</option>${BRANDS.map((b) => `<option value="${b.id}"${b.id === this.brand ? ' selected' : ''}>${b.name} ${b.lang} (.${b.ext})</option>`).join('')}</select>
        <button id="tf-brand-dl">Download</button></div>
      ${this.preview()}
      ${errs ? `<p class="bad">${errs} error${errs > 1 ? 's' : ''} above: those programs will not load until they are fixed. The pack still downloads.</p>` : ''}`;
    this.dlg.querySelector('#tf-brand')!.addEventListener('change', (e) => { this.brand = (e.target as HTMLSelectElement).value as Brand; this.render(); });
    this.dlg.querySelector('#tf-brand-dl')!.addEventListener('click', async () => { for (const f of this.brandFiles().files) await download(f.name, f.data); });
    this.dlg.querySelector('#tf-load')!.addEventListener('click', () => this.input.click());
    this.dlg.querySelector('#tf-short')!.addEventListener('change', (e) => { this.shortNames = (e.target as HTMLInputElement).checked; this.render(); });
    const name = `${(this.s.world.name || 'cell').replace(/[^A-Za-z0-9_-]+/g, '_')}_${r.name.replace(/[^A-Za-z0-9_-]+/g, '_')}_HandlingPRO`;
    this.dlg.querySelector('#tf-zip')!.addEventListener('click', async () => {
      const ok = await downloadBytes(`${name}.zip`, zip(pack(r, { shortNames: this.shortNames })));
      if (!ok) { this.notes.push('This viewer does not save .zip files. Use "Download files one by one".'); this.render(); }
    });
    this.dlg.querySelector('#tf-each')!.addEventListener('click', async () => {
      for (const f of pack(r, { shortNames: this.shortNames })) await download(f.name, f.data);
    });
  }
}
