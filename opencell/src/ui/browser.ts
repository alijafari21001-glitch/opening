// Cell Browser: tree of the workcell (robot, tooling, frames, programs, fixtures, parts, obstacles)
// and a properties panel to add and edit boxes, cylinders and imported CAD.
import { CellState } from '../state';
import { ROBOT_MODELS } from '../kin/robot';
import { Pendant } from './tp/pendant';
import { Viewer } from '../scene/viewer';
import { CellObject, ObjRole, box, cylinder, ROLE_LABEL, newId, UNIT_MM, MeshUnit, gripper1, GRIPPER1_TCP, pointer, POINTER_TCP, fence, conveyor, worker } from '../cell/objects';
import { inEnvelope } from '../kin/envelope';
import { maxReach as maxReachOf } from '../kin/robot';
import { importCad, CAD_ACCEPT, ImportTarget } from '../cell/importer';
import { deleteMesh } from '../cell/meshStore';
import { esc } from './tp/core';
import { matToWpr } from '../kin/math';
import { toLS } from '../tp/ls';
import { download } from './download';

interface Node { id: string; label: string; ico: string; children?: Node[]; badge?: string; dim?: boolean }

const CATS: [ObjRole, string, string][] = [['machine', 'machines', 'Machines'], ['fixture', 'fixtures', 'Fixtures'], ['part', 'parts', 'Parts'], ['obstacle', 'obstacles', 'Obstacles'], ['worker', 'workers', 'Workers']];
const CAT_ICO: Record<string, string> = { machine: '⚙', fixture: '▭', part: '▣', obstacle: '▲', worker: '🧍' };
const KEYS = ['x', 'y', 'z', 'w', 'p', 'r'] as const;

export class CellBrowser {
  private open = new Set(['robot', 'tooling', 'programs', 'tg:1', 'machines', 'fixtures', 'parts', 'obstacles', 'workers']);
  private sel = 'robot';
  /** UTOOL whose tooling is being edited from the Tooling node. */
  private toolEdit = 1;
  private treeEl: HTMLElement;
  private propsEl: HTMLElement;
  private fileInput: HTMLInputElement;
  private treeKey = '';
  private propsKey = '';

  constructor(el: HTMLElement, private s: CellState, private pendant: Pendant, private viewer: Viewer) {
    el.innerHTML = `<h3>Cell Browser</h3><div class="treewrap"></div><div class="props"></div><input type="file" id="cad-file" accept="${CAD_ACCEPT}" multiple hidden>`;
    this.treeEl = el.querySelector('.treewrap')!;
    this.propsEl = el.querySelector('.props')!;
    this.fileInput = el.querySelector('#cad-file')!;
    this.fileInput.addEventListener('change', () => { this.importFiles([...(this.fileInput.files ?? [])]); this.fileInput.value = ''; });
    s.onChange(() => this.render());
    viewer.onPick = (id) => { this.select(id ? `obj:${id}` : this.sel.startsWith('obj:') ? 'robot' : this.sel); };
    this.render();
  }

  /** Where new objects / dropped files go, based on the current selection. */
  target(): ImportTarget {
    const o = this.s.obj(this.s.selectedObj);
    if (o) return { role: o.role, tool: o.tool };
    if (this.sel === 'tooling') return { role: 'tool', tool: this.toolEdit };
    if (this.sel.startsWith('tg:')) return { role: 'tool', tool: +this.sel.slice(3) };
    const cat = CATS.find((c) => c[1] === this.sel);
    return { role: cat ? cat[0] : 'fixture' };
  }

  async importFiles(files: File[]) {
    const t = this.target();
    for (const f of files) {
      const o = await importCad(this.s, f, t);
      if (o) { this.sel = `obj:${o.id}`; this.open.add(o.role === 'tool' ? `tg:${o.tool}` : CATS.find((c) => c[0] === o.role)![1]); }
    }
    this.render(true);
  }

  private nodes(): Node[] {
    const s = this.s;
    const objNode = (o: CellObject): Node => {
      const kids = s.objects.filter((c) => c.parent === o.id);
      return {
        id: `obj:${o.id}`, label: o.name, ico: o.kind === 'box' ? '▭' : o.kind === 'cylinder' ? '◯' : '⬢', dim: o.hidden,
        badge: o.finger ? 'finger' : undefined, children: kids.length ? kids.map(objNode) : undefined,
      };
    };
    const top = (o: CellObject) => !o.parent || !s.obj(o.parent);
    const others = s.robots.map((r, i) => ({ i, node: { id: `robot:${i}`, label: `Robot ${i + 1}: ${r.name} (${r.model.name}${r.rail ? ' + rail' : ''})`, ico: '🦾' } as Node })).filter((n) => n.i !== s.active);
    const toolNums = [...new Set([s.utool, ...s.objects.filter((o) => o.role === 'tool' && (o.robot ?? 0) === s.active).map((o) => o.tool ?? 1)])].filter((n) => n >= 1).sort((a, b) => a - b);
    return [
      { id: 'cell', label: `Workcell: ${s.world.name}`, ico: '🏭' },
      ...others.filter((n) => n.i < s.active).map((n) => n.node),
      { id: 'robot', label: s.robots.length > 1 ? `Robot ${s.active + 1}: ${s.ctrl.name} (${s.model.name}${s.ctrl.rail ? ' + rail' : ''})` : `Robot: ${s.model.name}`, ico: '🦾', badge: s.robots.length > 1 ? 'pendant' : undefined, children: [
        { id: 'tooling', label: 'Tooling', ico: '🔧', children: toolNums.map((n) => ({
          id: `tg:${n}`, label: `UT${n}${s.tools[n - 1]?.comment ? ` [${s.tools[n - 1].comment}]` : ''}`, ico: '✋',
          badge: s.utool === n ? 'active' : undefined,
          children: s.objects.filter((o) => o.role === 'tool' && o.tool === n && (o.robot ?? 0) === s.active && top(o)).map(objNode),
        })) },
        { id: 'uframes', label: 'User Frames', ico: '⌗', children: s.users.map((u, i) => ({
          id: `uf:${i + 1}`, label: `UFrame ${i + 1}${u.comment ? ` [${u.comment}]` : ''}`, ico: '⌗',
          dim: !u.comment && u.pose.x === 0 && u.pose.y === 0 && u.pose.z === 0, badge: s.uframe === i + 1 ? 'active' : undefined,
        })) },
        { id: 'utools', label: 'Tool Frames', ico: '⊕', children: s.tools.map((t, i) => ({
          id: `ut:${i + 1}`, label: `UTool ${i + 1}${t.comment ? ` [${t.comment}]` : ''}`, ico: '⊕',
          dim: !t.comment && t.pose.x === 0 && t.pose.y === 0 && t.pose.z === 0, badge: s.utool === i + 1 ? 'active' : undefined,
        })) },
        { id: 'programs', label: 'Programs', ico: '📄', children: Object.keys(s.programs).sort().map((n) => ({
          id: `prog:${n}`, label: `${n}${s.programs[n].comment ? ` [${s.programs[n].comment}]` : ''}`, ico: '▤', badge: s.selected === n ? 'sel' : undefined,
        })) },
      ] },
      ...others.filter((n) => n.i > s.active).map((n) => n.node),
      ...CATS.map(([role, id, label]) => ({ id, label, ico: CAT_ICO[role], children: s.objects.filter((o) => o.role === role && top(o)).map(objNode) })),
    ];
  }

  private render(force = false) {
    const s = this.s;
    const ns = this.nodes();
    const key = JSON.stringify([ns, this.sel, [...this.open]]);
    if (force || key !== this.treeKey) {
      this.treeKey = key;
      const html = (list: Node[]): string => `<ul class="tree">${list.map((n) => {
        const kids = n.children && n.children.length;
        const isOpen = this.open.has(n.id);
        return `<li><div class="node ${this.sel === n.id ? 'sel' : ''}" data-id="${esc(n.id)}">
          <span class="twisty" data-tw="${esc(n.id)}">${kids ? (isOpen ? '▾' : '▸') : ''}</span>
          <span class="ico">${n.ico}</span><span class="${n.dim ? 'dim' : ''}">${esc(n.label)}</span>
          ${n.badge ? `<span class="badge">${n.badge}</span>` : ''}</div>
          ${kids && isOpen ? html(n.children!) : ''}</li>`;
      }).join('')}</ul>`;
      this.treeEl.innerHTML = html(ns);
      this.treeEl.querySelectorAll<HTMLElement>('[data-tw]').forEach((t) => t.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = t.dataset.tw!;
        if (this.open.has(id)) this.open.delete(id); else this.open.add(id);
        this.render();
      }));
      this.treeEl.querySelectorAll<HTMLElement>('.node').forEach((n) => n.addEventListener('click', () => this.select(n.dataset.id!)));
      this.treeEl.querySelector('.node.sel')?.scrollIntoView({ block: 'nearest' });
    }
    const o = s.obj(s.selectedObj);
    const pkey = JSON.stringify([this.sel, this.toolEdit, o, s.model.id, s.utool, o?.tool ? s.tools[o.tool - 1] : null]);
    if (force || (pkey !== this.propsKey && !this.propsEl.contains(document.activeElement))) {
      this.propsKey = pkey;
      this.renderProps();
    }
  }

  private select(id: string) {
    const s = this.s;
    this.sel = id;
    let [kind, ...rest] = id.split(':');
    const num = rest.join(':');
    if (kind === 'robot' && num) { // another robot: the pendant switches to it (like the GROUP key)
      s.active = +num; this.sel = id = kind = 'robot';
      s.message('info', `Pendant now on group ${s.active + 1}: ${s.ctrl.name} (${s.model.name})`);
    }
    s.selectedObj = kind === 'obj' ? num : null;
    if (kind === 'uf') this.pendant.openFrame('USER', +num);
    if (kind === 'ut') this.pendant.openFrame('TOOL', +num);
    if (kind === 'tg') this.toolEdit = +num;
    if (kind === 'prog' && !this.pendant.interp.running) { s.selected = num; this.pendant.interp.setCursor(num, 0); this.pendant.open('EDIT'); }
    const o = s.obj(s.selectedObj);
    if (o) {
      this.open.add(o.role === 'tool' ? `tg:${o.tool}` : CATS.find((c) => c[0] === o.role)![1]);
      for (let p = s.obj(o.parent ?? null); p; p = s.obj(p.parent ?? null)) this.open.add(`obj:${p.id}`);
    }
    s.emit();
    this.render(true);
  }

  private add(kind: 'box' | 'cylinder') {
    const s = this.s;
    const t = this.target();
    const floor = this.viewer.floorZ(), b = s.ctrl.base;
    let o: CellObject;
    if (t.role === 'tool') {
      const n = t.tool ?? s.utool;
      const top = this.viewer.toolTip(n)?.z ?? 0;
      o = kind === 'box' ? box('Box', 'tool', [40, 40, 40], { x: 0, y: 0, z: top, w: 0, p: 0, r: 0 }, undefined, n)
        : cylinder('Cylinder', 'tool', 40, 40, { x: 0, y: 0, z: top, w: 0, p: 0, r: 0 }, undefined, n);
    } else {
      const sz: Record<ObjRole, [number, number, number]> = { fixture: [400, 300, 200], part: [50, 50, 50], obstacle: [150, 150, 600], tool: [40, 40, 40], machine: [300, 300, 300], worker: [250, 400, 1750] };
      const [x, y, z] = sz[t.role];
      const at = { x: b.x + 450, y: b.y, z: floor, w: 0, p: 0, r: 0 };
      o = kind === 'box' ? box(ROLE_LABEL[t.role], t.role, [x, y, z], at) : cylinder(ROLE_LABEL[t.role], t.role, x, z, at);
    }
    if (o.role === 'tool' && s.active) o.robot = s.active;
    s.objects.push(o);
    this.select(`obj:${o.id}`);
  }

  private renderProps() {
    const s = this.s;
    const P = this.propsEl;
    const o = s.obj(s.selectedObj);
    if (o) { this.objectProps(o); return; }
    if (this.sel === 'tooling' || this.sel.startsWith('tg:')) {
      const n = this.sel.startsWith('tg:') ? +this.sel.slice(3) : this.toolEdit;
      this.toolEdit = n;
      const tf = s.tools[n - 1];
      P.innerHTML = `
        <label for="tg-n">Edit tooling of</label>
        <select id="tg-n">${s.tools.map((t, i) => `<option value="${i + 1}" ${i + 1 === n ? 'selected' : ''}>UTOOL ${i + 1}${t.comment ? ` [${esc(t.comment)}]` : ''}</option>`).join('')}</select>
        <div class="btns">${this.addButtons()}</div>
        <div class="kv">TCP (UT${n}): X ${tf.pose.x.toFixed(1)} Y ${tf.pose.y.toFixed(1)} Z ${tf.pose.z.toFixed(1)}</div>
        <div class="btns"><button id="p-tip" title="Set the TCP of this UTOOL at the tip of its bodies">Set TCP at tool tip</button>
          <button id="p-g1" title="Add Gripper 1 (round two-jaw gripper) to this UTOOL and set its TCP between the pads">+ Gripper 1</button>
          <button id="p-ptr" title="Add a pointer tool to this UTOOL and set its TCP at the tip (Z 150)">+ Pointer</button></div>
        <p class="note">Drop STL / OBJ / GLB files on the 3D view to add them here. The tool of the active UTOOL is drawn (UT1's if it has none).</p>`;
      P.querySelector('#tg-n')!.addEventListener('change', (e) => { this.select(`tg:${(e.target as HTMLSelectElement).value}`); });
      P.querySelector('#p-tip')!.addEventListener('click', () => this.setTip(n));
      P.querySelector('#p-g1')!.addEventListener('click', () => {
        s.objects.push(...gripper1(n).map((o) => ({ ...o, robot: s.active || undefined })));
        s.tools[n - 1] = { comment: 'Gripper 1', pose: { ...GRIPPER1_TCP } };
        s.message('info', `Gripper 1 added to UTOOL ${n} (TCP Z 116, between the pads)`);
        this.open.add(`tg:${n}`);
        s.emit(); this.render(true);
      });
      P.querySelector('#p-ptr')!.addEventListener('click', () => {
        s.objects.push(...pointer(n).map((o) => ({ ...o, robot: s.active || undefined })));
        s.tools[n - 1] = { comment: 'Pointer', pose: { ...POINTER_TCP } };
        s.message('info', `Pointer added to UTOOL ${n} (TCP Z ${POINTER_TCP.z}, at the tip)`);
        this.open.add(`tg:${n}`);
        s.emit(); this.render(true);
      });
      this.bindAdd();
      return;
    }
    const cat = CATS.find((c) => c[1] === this.sel);
    if (cat) {
      const lib: Partial<Record<ObjRole, [string, string][]>> = {
        obstacle: [['fence', '+ Safety fence']], fixture: [['conveyor', '+ Conveyor']], worker: [['worker', '+ Worker']],
      };
      P.innerHTML = `<label>Add ${cat[2].toLowerCase()}</label><div class="btns">${this.addButtons()}</div>
        ${lib[cat[0]] ? `<label>From library</label><div class="btns">${lib[cat[0]]!.map(([k, l]) => `<button data-lib="${k}">${l}</button>`).join('')}</div>` : ''}
        <p class="note">New objects sit on the floor in front of the robot. Click one in the 3D view and drag the arrows to move it (snaps to 10 mm).${cat[0] === 'machine' ? ' Add a box or cylinder to a machine, then set the machine as its parent to make a link.' : ''}</p>`;
      this.bindAdd();
      P.querySelectorAll<HTMLButtonElement>('[data-lib]').forEach((b) => b.addEventListener('click', () => this.addLib(b.dataset.lib!)));
      return;
    }
    if (this.sel === 'cell') {
      const w = s.world;
      P.innerHTML = `
        <label for="w-name">Workcell name</label><input id="w-name" value="${esc(w.name)}" maxlength="40">
        <div class="sub">Floor</div>
        <div class="grid2">
          <label class="f"><span>Size (mm)</span><input type="number" id="w-fsize" value="${w.floorSize}" step="100" min="1000"></label>
          <label class="f"><span>Color</span><input type="color" id="w-fcol" value="${w.floorColor}"></label>
          <label class="f"><span>Height (mm)</span><input type="number" value="${-s.model.baseZ}" disabled title="Floor is at the robot's mounting surface"></label>
        </div>
        <div class="sub">Grid lines</div>
        <div class="grid2">
          <label class="f"><span>Spacing (mm)</span><input type="number" id="w-gsp" value="${w.gridSpacing}" step="10" min="10"></label>
          <label class="f"><span>Color</span><input type="color" id="w-gcol" value="${w.gridColor}"></label>
        </div>
        <p class="note">Save cell names the file after the workcell.</p>`;
      const on = (id: string, ev: string, f: (v: string) => void) => P.querySelector('#' + id)!.addEventListener(ev, (e) => { f((e.target as HTMLInputElement).value); s.emit(); });
      on('w-name', 'change', (v) => { w.name = v.trim().replace(/[^\w-]/g, '') || w.name; });
      on('w-fsize', 'change', (v) => { w.floorSize = Math.max(1000, +v || 4000); });
      on('w-fcol', 'input', (v) => { w.floorColor = v; });
      on('w-gsp', 'change', (v) => { w.gridSpacing = Math.max(10, +v || 100); });
      on('w-gcol', 'input', (v) => { w.gridColor = v; });
      return;
    }
    if (this.sel === 'robot') {
      P.innerHTML = `
        <label for="model">Robot model</label>
        ${s.robots.length > 1 ? `<div class="kv">Group ${s.active + 1} of ${s.robots.length}: <b>${esc(s.ctrl.name)}</b>${s.ctrl.rail ? `, rail E1 0..${s.ctrl.rail.length} mm at ${s.ctrl.rail.speed} mm/s` : ''}. Base X ${s.ctrl.base.x} Y ${s.ctrl.base.y} Z ${s.ctrl.base.z} R ${s.ctrl.base.r}. The pendant, jog keys and Run button work on this robot; GROUP on the pendant switches.</div>` : ''}
        <select id="model">${ROBOT_MODELS.map((m) => `<option value="${m.id}" ${m.id === s.model.id ? 'selected' : ''}>${m.name} (${m.payload} kg)</option>`).join('')}</select>
        ${this.specHtml()}
        <label class="chk"><input type="checkbox" data-opt="teachTool" ${s.opts.teachTool ? 'checked' : ''}> Teach tool visible</label>
        <label class="chk"><input type="checkbox" data-opt="envelope" ${s.opts.envelope ? 'checked' : ''}> Show work envelope</label>
        <label class="chk"><input type="checkbox" data-opt="collisions" ${s.opts.collisions ? 'checked' : ''}> Show robot collisions</label>
        <label class="chk"><input type="checkbox" data-opt="lock" ${s.opts.lock ? 'checked' : ''}> Lock all location values</label>
        <div class="btns"><button id="r-env" title="Which machines, fixtures, obstacles and workers are inside the wrist-center work envelope">Check envelope</button></div>
        <div id="r-envout" class="kv"></div>`;
      P.querySelector('select')!.addEventListener('change', (e) => s.setModel((e.target as HTMLSelectElement).value));
      P.querySelectorAll<HTMLInputElement>('[data-opt]').forEach((c) => c.addEventListener('change', () => {
        s.opts[c.dataset.opt as keyof typeof s.opts] = c.checked; s.emit();
      }));
      P.querySelector('#r-env')!.addEventListener('click', () => { P.querySelector('#r-envout')!.innerHTML = this.envelopeReport(); });
      return;
    }
    if (this.sel.startsWith('prog:') && s.programs[this.sel.slice(5)]) {
      const pr = s.programs[this.sel.slice(5)];
      P.innerHTML = `<label>Program ${esc(pr.name)}</label><div class="kv">${pr.lines.length} lines, ${Object.keys(pr.pos).length} positions</div>
        <div class="btns"><button id="pg-ls" title="ASCII teach pendant program for a real controller or ROBOGUIDE (needs the ASCII Program Loader option)">Download ${esc(pr.name)}.LS</button></div>`;
      P.querySelector('#pg-ls')!.addEventListener('click', () => download(`${pr.name}.LS`, toLS(pr)));
      return;
    }
    P.innerHTML = '<p class="note">Select the robot, Tooling, or a Fixtures / Parts / Obstacles folder to add objects.</p>';
  }

  /** Robot specs: datasheet-style facts, then per-joint range and speed as OpenCell models them. */
  private specHtml() {
    const m = this.s.model, sp = m.spec, k = maxReachOf(m);
    const facts: [string, string][] = sp ? [
      ['Payload', `${m.payload} kg`], ['Reach', `${sp.reach} mm`], ['Repeatability', `±${sp.repeat} mm`], ['Mass', `${sp.mass} kg`], ['Axes', sp.axes],
      ...(sp.wrist ? [['Wrist', sp.wrist] as [string, string]] : []),
    ] : [['Payload', `${m.payload} kg`]];
    const links: [string, string][] = [['J1→J2 offset', `${m.a1} mm`], ['Upper arm J2→J3', `${m.a2} mm`], ['J3 offset', `${m.a3} mm`], ['Forearm J3→wrist', `${m.d4} mm`], ['Wrist→faceplate', `${m.d6} mm`], ['J2 above base', `${m.baseZ} mm`], ['Wrist-center reach (model)', `${Math.round(k - m.d6)} mm`]];
    const row = ([a, b]: [string, string]) => `<tr><td>${a}</td><td>${esc(b)}</td></tr>`;
    return `<div class="sub">Specs (approximate, check the datasheet)</div>
      <table class="spec">${facts.map(row).join('')}</table>
      <div class="sub">Joints: OpenCell limits · datasheet range · max speed</div>
      <table class="spec">${m.limits.map(([lo, hi], i) => `<tr><td>J${i + 1}</td><td>${lo}° .. ${hi}°</td><td>${sp ? `${sp.ranges[i]}°` : ''}</td><td>${m.maxSpeed[i]}°/s</td></tr>`).join('')}</table>
      <div class="sub">Link lengths (kinematic model)</div>
      <table class="spec">${links.map(row).join('')}</table>
      ${sp?.note ? `<p class="note">${esc(sp.note)}</p>` : ''}`;
  }

  private addLib(k: string) {
    const s = this.s, floor = -s.model.baseZ;
    const list = k === 'fence' ? fence(floor, 0, 0, 2600, 2600) : k === 'conveyor' ? conveyor(floor, { x: 300, y: -500, z: 0, w: 0, p: 0, r: 0 }) : worker(floor, 1700, 0);
    s.objects.push(...list);
    s.message('info', `Added ${list[0].name}`);
    this.select(`obj:${list[0].id}`);
  }

  /** Envelope check per top-level object: how many of its box corners and center lie inside the wrist-center envelope. */
  private envelopeReport() {
    const s = this.s;
    const rows: string[] = [];
    for (const o of s.objects) {
      if (o.role === 'tool' || (o.parent && s.obj(o.parent))) continue;
      const g = this.viewer.cell.group(o.id);
      if (!g) continue;
      const bb = this.viewer.cell.worldBox(g);
      if (!bb) continue;
      const pts: [number, number, number][] = [[(bb[0] + bb[3]) / 2, (bb[1] + bb[4]) / 2, bb[5]]];
      for (const x of [bb[0], bb[3]]) for (const y of [bb[1], bb[4]]) for (const z of [bb[2], bb[5]]) pts.push([x, y, z]);
      const n = pts.filter((p) => inEnvelope(s.model, p)).length;
      const st = n === pts.length ? '<b style="color:var(--ok)">inside</b>' : n ? '<b style="color:var(--warn)">partly</b>' : '<b style="color:var(--alarm)">outside</b>';
      rows.push(`<tr><td>${esc(o.name)}</td><td>${ROLE_LABEL[o.role]}</td><td>${st}</td></tr>`);
    }
    return rows.length ? `<table>${rows.join('')}</table>` : 'No cell objects.';
  }

  private addButtons() {
    return `<button data-add="box">+ Box</button><button data-add="cylinder">+ Cylinder</button><button data-add="cad" title="STL, OBJ or GLB">+ CAD file…</button>`;
  }
  private bindAdd() {
    this.propsEl.querySelectorAll<HTMLButtonElement>('[data-add]').forEach((b) => b.addEventListener('click', () => {
      if (b.dataset.add === 'cad') this.fileInput.click();
      else this.add(b.dataset.add as 'box');
    }));
  }

  private setTip(n: number) {
    const tip = this.viewer.toolTip(n);
    if (!tip) { this.s.message('warn', `UTOOL ${n} has no tooling bodies`); return; }
    const t = this.s.tools[n - 1];
    t.pose = { x: tip.x, y: tip.y, z: tip.z, w: 0, p: 0, r: 0 };
    if (!t.comment) t.comment = 'Tool tip';
    this.s.message('info', `UTOOL ${n} set to X ${tip.x} Y ${tip.y} Z ${tip.z} (tool tip). Positions taught with the old TCP will move.`);
    this.s.emit();
  }

  private objectProps(o: CellObject) {
    const s = this.s;
    const P = this.propsEl;
    const num = (id: string, label: string, v: number, step = 1) => `<label class="f"><span>${label}</span><input type="number" id="${id}" value="${+v.toFixed(3)}" step="${step}"></label>`;
    const sizeFields = o.kind === 'box' ? num('sx', 'X', o.size[0]) + num('sy', 'Y', o.size[1]) + num('sz', 'Z', o.size[2])
      : o.kind === 'cylinder' ? num('sx', 'Ø', o.size[0]) + num('sz', 'H', o.size[2])
      : `<label class="f"><span>Unit</span><select id="unit">${(['mm', 'cm', 'm', 'in'] as MeshUnit[]).map((u) => `<option ${u === o.mesh!.unit ? 'selected' : ''}>${u}</option>`).join('')}</select></label>`;
    P.innerHTML = `
      <label for="o-name">${o.kind === 'mesh' ? `CAD: ${esc(o.mesh!.file)}` : o.kind === 'box' ? 'Box' : 'Cylinder'}</label>
      <input id="o-name" value="${esc(o.name)}" maxlength="40">
      <div class="grid2">
        <label class="f"><span>Role</span><select id="o-role">${(['tool', 'machine', 'fixture', 'part', 'obstacle', 'worker'] as ObjRole[]).map((r) => `<option value="${r}" ${r === o.role ? 'selected' : ''}>${ROLE_LABEL[r]}</option>`).join('')}</select></label>
        ${o.role === 'tool' ? `<label class="f"><span>UTOOL</span><select id="o-tool">${s.tools.map((_, i) => `<option ${i + 1 === o.tool ? 'selected' : ''}>${i + 1}</option>`).join('')}</select></label>` : '<span></span>'}
        ${sizeFields}
        <label class="f"><span>Color</span><input type="color" id="o-color" value="${o.color}"></label>
      </div>
      <div class="sub">Position (${o.parent && s.obj(o.parent) ? `relative to ${esc(s.obj(o.parent)!.name)}` : o.role === 'tool' ? `faceplate, UT${o.tool}` : 'world'}) mm / deg${s.opts.lock && o.role !== 'tool' ? ' · locked' : ''}</div>
      <div class="grid3">${KEYS.map((k) => num(`p-${k}`, k.toUpperCase(), o.pose[k])).join('')}</div>
      ${o.role === 'tool' ? `<label class="f"><span>Gripper finger</span><select id="o-finger"><option value="0">No</option><option value="-1" ${o.finger === -1 ? 'selected' : ''}>Left (−X)</option><option value="1" ${o.finger === 1 ? 'selected' : ''}>Right (+X)</option></select></label>` : ''}
      ${o.role !== 'tool' ? `<label class="f"><span>Attached to (parent)</span><select id="o-parent"><option value="">(none: world)</option>${s.objects.filter((p) => p.role !== 'tool' && !s.subtree(o.id).includes(p)).map((p) => `<option value="${p.id}" ${p.id === o.parent ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>` : ''}
      ${o.sensor ? `<div class="sub">Sensor: ${o.sensor.kind} · <b id="o-sens">${(window as unknown as { openCell?: { sensors?: { state: Map<string, boolean> } } }).openCell?.sensors?.state.get(o.id) ? 'DETECTING' : 'clear'}</b></div>
      <div class="grid2">
        <label class="f"><span>Wired to</span><select id="o-sto"><option value="plc" ${o.sensor.out.to === 'plc' ? 'selected' : ''}>PLC tag</option><option value="robot" ${o.sensor.out.to === 'robot' ? 'selected' : ''}>Robot DI</option></select></label>
        ${o.sensor.out.to === 'plc' ? `<label class="f"><span>Tag</span><input id="o-stag" value="${esc(o.sensor.out.tag)}"></label>` : `<label class="f"><span>DI index</span><input id="o-sidx" type="number" min="1" max="512" value="${o.sensor.out.idx}"></label>`}
      </div>
      <label class="chk"><input type="checkbox" id="o-sinv" ${o.sensor.invert ? 'checked' : ''}> ON when clear (fail-safe wiring)</label>` : ''}
      <label class="chk"><input type="checkbox" id="o-hidden" ${o.hidden ? 'checked' : ''}> Hidden</label>
      <div class="btns">
        <button id="o-dup">Duplicate</button>
        ${o.role !== 'tool' ? '<button id="o-floor" title="Put it on the floor">On floor</button>' : `<button id="o-tip" title="Set UTOOL ${o.tool} TCP at the tip of this tool">TCP at tip</button>`}
        <button id="o-del" class="danger">Delete</button>
      </div>`;
    const $ = <T extends HTMLElement>(id: string) => P.querySelector('#' + id) as T | null;
    const commit = () => { s.emit(); };
    if (o.sensor) {
      const sn = o.sensor;
      $<HTMLSelectElement>('o-sto')?.addEventListener('change', (e) => { sn.out = (e.target as HTMLSelectElement).value === 'plc' ? { to: 'plc', tag: 'PE_1' } : { to: 'robot', port: 'DI', idx: 1 }; commit(); this.select(`obj:${o.id}`); });
      $<HTMLInputElement>('o-stag')?.addEventListener('change', (e) => { if (sn.out.to === 'plc') sn.out.tag = (e.target as HTMLInputElement).value.trim(); commit(); });
      $<HTMLInputElement>('o-sidx')?.addEventListener('change', (e) => { if (sn.out.to === 'robot') sn.out.idx = Math.max(1, Math.min(512, Math.round(+(e.target as HTMLInputElement).value) || 1)); commit(); });
      $<HTMLInputElement>('o-sinv')?.addEventListener('change', (e) => { sn.invert = (e.target as HTMLInputElement).checked; commit(); });
    }
    $<HTMLInputElement>('o-name')!.addEventListener('change', (e) => { o.name = (e.target as HTMLInputElement).value.trim() || o.name; commit(); });
    $<HTMLSelectElement>('o-role')!.addEventListener('change', (e) => {
      const r = (e.target as HTMLSelectElement).value as ObjRole;
      if (r === 'tool' && o.role !== 'tool') { o.tool = s.utool || 1; o.pose = { x: 0, y: 0, z: 0, w: 0, p: 0, r: 0 }; }
      if (r !== 'tool' && o.role === 'tool') { o.tool = undefined; o.finger = undefined; o.pose = { x: 450, y: 0, z: -s.model.baseZ, w: 0, p: 0, r: 0 }; }
      o.role = r; this.select(`obj:${o.id}`);
    });
    $<HTMLSelectElement>('o-tool')?.addEventListener('change', (e) => { o.tool = +(e.target as HTMLSelectElement).value; commit(); });
    for (const [id, i] of [['sx', 0], ['sy', 1], ['sz', 2]] as const) {
      $<HTMLInputElement>(id)?.addEventListener('change', (e) => {
        const v = Math.max(0.1, +(e.target as HTMLInputElement).value || 1);
        o.size[i] = v;
        if (o.kind === 'cylinder' && i === 0) o.size[1] = v;
        commit();
      });
    }
    $<HTMLSelectElement>('unit')?.addEventListener('change', (e) => {
      const u = (e.target as HTMLSelectElement).value as MeshUnit;
      const f = UNIT_MM[u] / UNIT_MM[o.mesh!.unit];
      o.size = o.size.map((v) => v * f) as [number, number, number];
      o.mesh!.unit = u; commit();
    });
    $<HTMLInputElement>('o-color')!.addEventListener('input', (e) => { o.color = (e.target as HTMLInputElement).value; commit(); });
    if (s.opts.lock && o.role !== 'tool') KEYS.forEach((k) => { $<HTMLInputElement>(`p-${k}`)!.disabled = true; });
    for (const k of KEYS) $<HTMLInputElement>(`p-${k}`)!.addEventListener('change', (e) => { o.pose[k] = +(e.target as HTMLInputElement).value || 0; commit(); });
    $<HTMLSelectElement>('o-finger')?.addEventListener('change', (e) => { const v = +(e.target as HTMLSelectElement).value; o.finger = v ? (v as -1 | 1) : undefined; commit(); });
    $<HTMLSelectElement>('o-parent')?.addEventListener('change', (e) => {
      const g = this.viewer.cell.group(o.id), pid = (e.target as HTMLSelectElement).value;
      const pg = pid ? this.viewer.cell.group(pid) : this.viewer.cell.world;
      if (g && pg) { // keep it where it is: re-express its pose in the new parent
        import('three').then((T) => {
          g.updateWorldMatrix(true, false); pg.updateWorldMatrix(true, false);
          const m = new T.Matrix4().copy(pg.matrixWorld).invert().multiply(g.matrixWorld);
          const pos = new T.Vector3(), q = new T.Quaternion(), sc = new T.Vector3();
          m.decompose(pos, q, sc);
          const e2 = new T.Matrix4().makeRotationFromQuaternion(q).elements;
          const [w, p, r] = matToWpr([e2[0], e2[4], e2[8], e2[1], e2[5], e2[9], e2[2], e2[6], e2[10]]);
          const rd = (v: number) => Math.round(v * 1000) / 1000;
          o.pose = { x: rd(pos.x), y: rd(pos.y), z: rd(pos.z), w: rd(w), p: rd(p), r: rd(r) };
          o.parent = pid || undefined; this.select(`obj:${o.id}`);
        });
      } else { o.parent = pid || undefined; commit(); }
    });
    $<HTMLInputElement>('o-hidden')!.addEventListener('change', (e) => { o.hidden = (e.target as HTMLInputElement).checked; commit(); });
    $('o-dup')!.addEventListener('click', () => {
      const ids = new Map<string, string>();
      const copies: CellObject[] = s.subtree(o.id).map((x) => { const c: CellObject = JSON.parse(JSON.stringify(x)); ids.set(x.id, c.id = newId()); return c; });
      for (const c of copies) if (c.parent && ids.has(c.parent)) c.parent = ids.get(c.parent);
      const c = copies[0];
      c.name = `${o.name} copy`;
      if (o.role !== 'tool') c.pose.y += o.size[1] + 20;
      s.objects.push(...copies); this.select(`obj:${c.id}`);
    });
    $('o-floor')?.addEventListener('click', () => {
      const g = this.viewer.cell.group(o.id);
      if (!g) return;
      import('three').then((T) => {
        const bb = new T.Box3().setFromObject(g);
        o.pose.z += -s.model.baseZ - bb.min.z; commit();
      });
    });
    $('o-tip')?.addEventListener('click', () => this.setTip(o.tool ?? 1));
    $('o-del')!.addEventListener('click', () => {
      const gone = s.subtree(o.id);
      s.objects = s.objects.filter((x) => !gone.includes(x));
      for (const x of gone) if (x.mesh && !x.mesh.id.startsWith('preset:') && !s.objects.some((y) => y.mesh?.id === x.mesh!.id)) deleteMesh(x.mesh.id);
      s.message('info', `Deleted ${o.name}${gone.length > 1 ? ` and ${gone.length - 1} attached bodies` : ''}`);
      this.select(o.role === 'tool' ? `tg:${o.tool}` : CATS.find((c) => c[0] === o.role)![1]);
    });
  }
}
