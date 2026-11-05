import * as THREE from 'three';
import './style.css';
import { CellState } from './state';
import { Jogger } from './jog';
import { Viewer } from './scene/viewer';
import { Pendant } from './ui/tp/pendant';
import { CellBrowser } from './ui/browser';
import { RunBar } from './ui/runbar';
import { Interpreter } from './tp/interp';
import { configString } from './kin/robot';
import { loadLab5, lab5Program, lab5CollisionProgram, LAB5_ON } from './labs/lab5';
import { lab5Checks, LAB5_STEP1 } from './labs/lab5check';
import { toLS } from './tp/ls';
import { download } from './ui/download';
import { Pl01Sim } from './sim/pl01';
import { loadPl01 } from './labs/pl01';
import { PlcBus } from './bus/plcbus';
import { PlcLinkUI } from './ui/plclink';
import { TPFilesUI } from './ui/tpfiles';
import { LibraryUI } from './ui/library';
import { loadDemo } from './labs/demo';
import { DemoSim } from './sim/demo';
import { SensorSim } from './sim/sensors';
import { CellsUI } from './ui/cells';
import { loadLab5 as _l5 } from './labs/lab5';

const state = new CellState();
state.load();
// A page can ship a ready-made cell (e.g. the finished Lab 5): window.OPENCELL_PRESET = { id, cell }.
// It loads once per browser; after that the viewer's own saved work wins.
type Vec = [number, number, number];
const preset = (window as unknown as { OPENCELL_PRESET?: { id: string; cell: ReturnType<CellState['snapshot']>; camera?: { target: Vec; from: Vec } } }).OPENCELL_PRESET;
if (preset) {
  let seen = false;
  try { seen = localStorage.getItem('opencell.preset') === preset.id; } catch { /* storage unavailable */ }
  if (!seen) {
    state.restore(preset.cell);
    try { localStorage.setItem('opencell.preset', preset.id); } catch { /* storage unavailable */ }
  }
}
const jog = new Jogger(state);
const plcBus = new PlcBus(state);
new PlcLinkUI(state, plcBus, document.querySelector('#btn-plc') as HTMLElement);
new LibraryUI(state, document.querySelector('#btn-lib') as HTMLElement);
new TPFilesUI(state, document.querySelector('#btn-tp') as HTMLElement);
// Scripting / test hook (also used by the app shell).
(window as unknown as { openCell: unknown }).openCell = { state, plcBus };
// One interpreter per robot controller (each sees the cell through its own view); `interp` is whichever one the pendant is on.
let dirty = false;
const interps: Interpreter[] = [];
const itListeners: (() => void)[] = [];
function syncInterps() {
  while (interps.length > state.robots.length) interps.pop();
  while (interps.length < state.robots.length) {
    const v = state.view(interps.length);
    v.emit = () => { dirty = true; };
    const it = new Interpreter(v);
    itListeners.forEach((f) => it.onChange(f));
    interps.push(it);
  }
}
syncInterps();
const interp = new Proxy({} as Interpreter, {
  get(_, k) {
    syncInterps();
    if (k === 'onChange') return (f: () => void) => { itListeners.push(f); interps.forEach((i) => i.onChange(f)); };
    const it = interps[state.active] ?? interps[0];
    const v = (it as unknown as Record<string | symbol, unknown>)[k];
    return typeof v === 'function' ? v.bind(it) : v;
  },
  set(_, k, v) { (interps[state.active] as unknown as Record<string | symbol, unknown>)[k] = v; return true; },
});
jog.busy = () => (interp.running ? 'Program is running. HOLD or ABORT it before jogging.' : null);
const $ = (s: string) => document.querySelector(s) as HTMLElement;

new RunBar($('#runbar'), state, interp);
const viewer = new Viewer($('#view'), state, jog);
viewer.isRunning = () => interp.running;
if (preset) viewer.frame(preset.camera?.target ?? [350, 0, -120], preset.camera?.from ?? [1900, -2300, 1500]);
const pendant = new Pendant($('#pendant'), state, jog, interp);
const browser = new CellBrowser($('#browser'), state, pendant, viewer);

// Drop CAD files (STL / OBJ / GLB) on the 3D view.
const view = $('#view');
view.addEventListener('dragover', (e) => { e.preventDefault(); view.classList.add('drop'); });
view.addEventListener('dragleave', () => view.classList.remove('drop'));
view.addEventListener('drop', (e) => {
  e.preventDefault();
  view.classList.remove('drop');
  const files = [...(e.dataTransfer?.files ?? [])];
  if (files.length) browser.importFiles(files);
});

const hud = $('#hud');
function updateHud() {
  const p = state.tcpWorld().p, w = state.warnings();
  hud.innerHTML = `TCP (world, UT${state.utool}) X ${p[0].toFixed(1)}  Y ${p[1].toFixed(1)}  Z ${p[2].toFixed(1)} mm · ${configString(state.config())}` +
    (w.wrist ? ' · <span class="w">wrist singularity</span>' : '') +
    (w.shoulder ? ' · <span class="w">shoulder singularity</span>' : '') +
    (w.elbow ? ' · <span class="w">near reach limit</span>' : '');
}
state.onChange(() => { viewer.update(); updateHud(); });

document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((b) =>
  b.addEventListener('click', () => viewer.view(b.dataset.view as 'iso')));
const gizmoBtns = document.querySelectorAll<HTMLButtonElement>('[data-gizmo]');
function setGizmo(m: 'off' | 'translate' | 'rotate') {
  viewer.setGizmo(m);
  gizmoBtns.forEach((b) => b.classList.toggle('on', b.dataset.gizmo === m));
}
gizmoBtns.forEach((b) => b.addEventListener('click', () => setGizmo(b.dataset.gizmo as 'off')));
setGizmo('translate');
const traceBtn = $('#btn-trace');
traceBtn.classList.add('on');
traceBtn.addEventListener('click', () => { viewer.traceOn = !viewer.traceOn; traceBtn.classList.toggle('on', viewer.traceOn); });
$('#btn-clear').addEventListener('click', () => viewer.clearTrace());

const help = $('#help') as HTMLDialogElement;
help.innerHTML = `
  <h2>OpenCell help</h2>
  <h3>Jogging</h3>
  <ul>
    <li>Hold <kbd>SHIFT</kbd> (pendant key, or the keyboard Shift key) and press a jog key. The pendant SHIFT key can be clicked to latch it.</li>
    <li><b>COORD</b> cycles JOINT, JGFRM, WORLD, TOOL, USER. <b>SHIFT+COORD</b> opens the jog menu to pick the tool, jog and user frame numbers.</li>
    <li><b>-% / +%</b> change override (SHIFT jumps VFINE, FINE, 5, 50, 100). VFINE and FINE move one small step per press.</li>
    <li><b>Mouse jog</b> (top bar): drag the arrows or rings at the TCP. Arrows follow the COORD system. Shift + drag in the view also moves the TCP.</li>
  </ul>
  <h3>Teaching a program</h3>
  <ol>
    <li><b>SELECT</b>, then F2 <b>CREATE</b> and type a name. The program opens in <b>EDIT</b>.</li>
    <li>Jog to a point and press F1 <b>POINT</b> (SHIFT+F1 repeats the last template). The new line records P[n].</li>
    <li>Cursor onto an item (arrows) and type a number, or press F4 <b>[CHOICE]</b> to change J/L, FINE/CNT, units and so on.</li>
    <li><b>SHIFT+F5 TOUCHUP</b> re-records the point on the cursor line.</li>
    <li><b>NEXT</b> shows F1 <b>[INST]</b> (registers, I/O, IF/SELECT, WAIT, LBL/JMP, CALL, FOR, Offset...), F2 <b>[EDCMD]</b> (insert, delete, copy, paste, undo, renumber), F3 <b>TEXT</b> (type a whole line), F4 <b>POSITION</b>.</li>
    <li>Run it: <b>SHIFT+FWD</b> from the cursor line (keep SHIFT held), <b>STEP</b> for single lines, <b>SHIFT+BWD</b> to go back, <b>HOLD</b> to pause, <b>RESET</b> to clear an alarm. The Run button below runs it like cycle start.</li>
  </ol>
  <h3>Tooling and cell objects</h3>
  <ul>
    <li>Select <b>Tooling</b> in the Cell Browser, pick the UTOOL, then add boxes, cylinders or a CAD file. Bodies are placed relative to the faceplate (+Z points out of the flange).</li>
    <li>Drop <b>STL, OBJ or GLB</b> files on the 3D view. They go to whatever is selected in the Cell Browser (a UTOOL, Fixtures, Parts or Obstacles). From SolidWorks or Inventor, save as STL in millimetres.</li>
    <li>Click an object in the view to select it, then drag the arrows (Mouse jog: Move) or rings (Rotate) to place it. It snaps to 10 mm / 15°. Exact values go in the properties panel.</li>
    <li><b>Machines</b> are objects with links: attach a box or cylinder to a machine with <b>Attached to (parent)</b> and it moves with it. The Obstacles, Fixtures and Workers folders have library items (fence, conveyor, worker).</li>
    <li>Select the robot to set <b>Show work envelope</b> (wrist-center reach), <b>Show robot collisions</b> (touching objects turn red and an alarm line is logged), <b>Teach tool visible</b> and <b>Lock all location values</b>. <b>Check envelope</b> lists what is inside.</li>
    <li><b>Labs</b> loads ready-made lab cells. <b>Save cell</b> / <b>Open cell</b> keep the whole cell in a file. Select a program in the Cell Browser to download it as a <b>.LS</b> file.</li>
    <li><b>TCP at tip</b> sets the UTOOL frame to the end of the tool bodies. Mark gripper fingers so they open and close with the gripper I/O (next stage).</li>
  </ul>
  <h3>Keyboard</h3>
  <p>Arrows, Enter, Backspace, 0-9 . - go to the pendant. F1-F5 are the function keys, Esc or Page Up is PREV, Page Down is NEXT.</p>
  <p>OpenCell is an independent open-source project. It is not affiliated with or endorsed by FANUC.</p>
  <form method="dialog"><button>Close</button></form>`;
$('#btn-help').addEventListener('click', () => help.showModal());

// Cell files: the whole state as JSON (imported CAD meshes stay in this browser's storage).
// A blank start: one robot (LR Mate default), its tooling, no line, no machines.
function emptyCell() {
  interps.forEach((it) => it.abort?.());
  if (sim) sim.running = false;
  state.restore(new CellState().snapshot());
  state.world.sim = undefined;
  state.world.name = 'My cell';
  state.save();
  try { localStorage.setItem('opencell.preset', preset?.id ?? 'pl01'); localStorage.setItem('opencell.cellName', 'My cell'); } catch { /* storage unavailable */ }
  location.reload();
}
const cells = new CellsUI(state, [
  { name: 'Empty cell (one robot)', desc: 'A fresh cell with one LR Mate robot and nothing else', load: () => emptyCell() },
  { name: 'PL-01 production line', desc: 'Both robots taught, 3 forklifts, wrapper, packing, CNCs (factory reset of the line)', load: () => resetLine() },
  { name: 'PLC + robot demo cell', desc: 'Conveyor, photo-eye and LR Mate wired to the PLC', load: () => { interps.forEach((it) => it.abort?.()); loadDemo(state); state.save(); location.reload(); } },
  ...(LAB5_ON ? [{ name: 'Lab 5 workcell', desc: 'LR Mate 200iC with the Cube and boxes', load: () => { _l5(state); state.world.sim = undefined; state.save(); location.reload(); } }] : []),
]);
$('#btn-save').addEventListener('click', () => cells.open());
const cellFile = $('#cell-file') as HTMLInputElement;
$('#btn-open').addEventListener('click', () => cellFile.click());
cellFile.addEventListener('change', async () => {
  const f = cellFile.files?.[0];
  cellFile.value = '';
  if (!f) return;
  try {
    state.restore(JSON.parse(await f.text()));
    state.message('info', `Opened cell ${f.name}`);
    state.emit();
  } catch { state.message('alarm', `${f.name} is not an OpenCell cell file`); }
});

const labs = $('#labs') as HTMLDialogElement;
const hasPl01 = !!(window as unknown as { OPENCELL_MESHES?: Record<string, string> }).OPENCELL_MESHES?.['page:pl01-equipment'];
labs.innerHTML = `
  <h2>Labs</h2>
  ${LAB5_ON ? `<div class="lab">
    <h3>Lab 5: Virtual workcell design and verification</h3>
    <p>Builds the whole lab from the LR200Ver3 cell: LR Mate 200iC, the Cube with its HighStick, LowStick and TopStick links,
    a blue box and a brown box with their parts, personalized floor and grid, pointer tool on UTOOL 1, conveyor, safety fence and worker,
    saved as myCellAJV1 with the step 7 robot settings. LAB5VER touches the top stick and the belt; LAB5COL runs into the Cube for step 7.3.</p>
    <p class="note">Loading replaces the robot, tooling and cell objects. Programs, registers and I/O stay. Use Save cell first to keep the current cell.</p>
    <div class="btns"><button id="lab5-load" class="primary">Load Lab 5 cell</button><button id="lab5-ls">LAB5VER.LS</button><button id="lab5-col">LAB5COL.LS</button><button id="lab5-rep">Lab 5 report</button></div>
    <h4>Checklist</h4>
    <table class="checks" id="lab5-checks"></table>
    <h4>Step 1: from LR200Ver3.frw</h4>
    <table class="checks">${LAB5_STEP1.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('')}</table>
  </div>` : ''}
  <div class="lab">
    <h3>PLC + robot demo cell</h3>
    <p>An infeed conveyor and photo-eye wired to the OpenRung PLC, and an LR Mate 200iD that picks each part and drops it in a bin.
    The PLC runs the conveyor (Conv_Motor), reads the eye (Part_At_Pick) and tells the robot to pick (Robot_Start → DI[1]).
    The robot answers on DO[1] → Robot_Picked. Without a PLC the cell wires itself so it still runs.</p>
    <div class="btns"><button id="demo-load" class="primary">Load demo cell</button></div>
  </div>
  ${hasPl01 ? `<div class="lab">
    <h3>PL-01 production line</h3>
    <p>The 40 x 25 m factory with two working robots: an R-2000iC/210L palletizer (group 1) and an M-20iA on an 11.5 m rail tending three VMCs (group 2).
    Conveyors, pallets, the stretch wrapper, the forklift and the people are animated by the line, which talks to the robots over I/O.</p>
    <div class="btns"><button id="pl01-load" class="primary">Load PL-01 line</button></div>
  </div>` : ''}
  <form method="dialog"><button>Close</button></form>`;
const checks = () => lab5Checks(state, (o) => viewer.cell.corners(o), viewer.toolTip(1)?.z ?? null);
function renderChecks() {
  if (!labs.open || !LAB5_ON) return;
  $('#lab5-checks').innerHTML = checks().map((c) =>
    `<tr class="${c.ok ? 'ok' : 'no'}"><td>${c.ok ? '✓' : '○'}</td><td>${c.step}</td><td>${c.title}<div class="d">${c.detail}</div></td></tr>`).join('');
}
state.onChange(renderChecks);
$('#btn-labs').addEventListener('click', () => { labs.showModal(); renderChecks(); });
document.querySelector('#lab5-load')?.addEventListener('click', () => { loadLab5(state); interp.setCursor('LAB5VER', 0); pendant.open('EDIT'); viewer.frame([350, 0, -120], [1900, -2300, 1500]); renderChecks(); });
document.querySelector('#pl01-load')?.addEventListener('click', resetLine);
$('#demo-load').addEventListener('click', () => { interps.forEach((it) => it.abort?.()); loadDemo(state); state.save(); location.reload(); });
document.querySelector('#lab5-ls')?.addEventListener('click', () => download('LAB5VER.LS', toLS(lab5Program())));
document.querySelector('#lab5-col')?.addEventListener('click', () => download('LAB5COL.LS', toLS(lab5CollisionProgram())));
document.querySelector('#lab5-rep')?.addEventListener('click', () => {
  const md = `# Lab 5: Virtual workcell design and verification\n\nCell ${state.world.name}, robot ${state.model.name}, ${new Date().toLocaleString()}\n\n` +
    `## Step 1 (from LR200Ver3.frw)\n\n| Item | Value |\n| --- | --- |\n${LAB5_STEP1.map(([k, v]) => `| ${k} | ${v} |`).join('\n')}\n\n` +
    `## Steps 2 to 7\n\n| Step | Check | Result | Detail |\n| --- | --- | --- | --- |\n${checks().map((c) => `| ${c.step} | ${c.title} | ${c.ok ? 'done' : 'not done'} | ${c.detail} |`).join('\n')}\n`;
  download(`Lab5_${state.world.name}.md`, md, 'text/markdown');
});

// ---------------------------------------------------------------- PL-01 production line (animated cell)
let sim: Pl01Sim | null = null;
let simSpeed = 1;
let lastStatus = '';
function resetLine() {
  loadPl01(state);
  state.save();
  try { localStorage.setItem('opencell.preset', (preset?.id ?? 'pl01')); } catch { /* storage unavailable */ }
  location.reload();
}
const linePanel = document.createElement('div');
linePanel.className = 'linepanel';
function lineStatus() {
  const it = (i: number) => interps[i];
  const st = (i: number) => `${state.robots[i]?.name ?? 'Robot ' + (i + 1)}: ${it(i)?.fault ? '<b class="al">ALARM</b>' : it(i)?.status ?? '-'}`;
  const t = linePanel.querySelector('.ls');
  if (!t || !sim) return;
  const f = sim.info, o = sim.order, d = sim.ord;
  const plc = plcBus.connected ? (sim.powered && sim.palPowered ? '<b style="color:#2e7d32">PLC live</b>' : `<b class="al">PLC: ${!sim.powered ? 'case conveyors off (MCP-1 M1)' : 'pallet lines off (MCP-1 M2)'}</b>`) : '<b style="color:#b26a00">No PLC: self-run</b>';
  const html = `${plc} · ${st(0)} · ${st(1)}<br>Order ${o.pallets > 0 ? `${d.loaded}/${o.pallets} pallets on the truck${sim.orderDone ? ' <b style="color:#2e7d32">done</b>' : ''}` : 'continuous'} · wrapped ${d.wrapped} · cases ${sim.stats.cases}<br>
    Parts cut ${sim.stats.parts} · packed ${sim.stats.packed} · on return belt ${f.ret} · empty pallets A ${f.dispA} B ${f.dispB} · trailer ${f.trailer}/16${f.trailerState !== 'docked' ? ` (${f.trailerState})` : ''}`;
  if (html !== lastStatus) { lastStatus = html; t.innerHTML = html; }
}
function startLine() {
  syncInterps();
  state.mode = 'AUTO';
  const mains = ['PAL_MAIN', 'MTMAIN'];
  interps.forEach((it, i) => {
    if (it.fault) it.reset();
    const prog = mains[i];
    if (it.status === 'PAUSED') it.resume();
    else if (!it.running && state.robots[i].programs[prog]) it.start(prog, 0);
  });
  if (sim) sim.running = true;
  state.emit();
}
function stopLine() {
  interps.forEach((it) => it.hold('line stop'));
  if (sim) sim.running = false;
  state.emit();
}
if (state.world.sim === 'pl01' && state.robots.length >= 2) {
  sim = new Pl01Sim(state, viewer.scene, (i) => viewer.flangeOf(i));
  viewer.traceOn = false;
  setGizmo('off');
  traceBtn.classList.remove('on');
  const cams: Record<string, [Vec, Vec]> = {
    Overview: [[9000, 1500, 0], [26000, -21000, 17000]],
    Palletizer: [[14200, -800, 900], [21500, -6500, 6200]],
    'Machine tending': [[-13000, 9300, 600], [-11000, 600, 10500]],
    Packing: [[7000, 7500, 800], [13000, -1000, 7500]],
    'Wrapper + forklifts': [[13500, -9200, 600], [20500, -17500, 7500]],
    'Shipping + trailer': [[-3500, -12000, 500], [5000, -22000, 9500]],
    'Return belt': [[2000, 8500, 600], [4000, -1500, 9000]],
  };
  const ORD: [keyof Pl01Sim["order"], string, string, number, number][] = [
    ['pallets', 'Order_Pallets', 'Pallets in order (0 = run on)', 0, 99], ['perPallet', 'Cases_Per_Pallet', 'Cases per pallet', 1, 16],
    ['partsPerCase', 'Parts_Per_Case', 'Parts per case', 1, 6], ['cncCycle', 'CNC_Cycle', 'CNC cycle (s)', 3, 300]];
  linePanel.innerHTML = `<div class="lh"><b>PL-01 line</b>
      <button data-l="run" title="AUTO mode, start PAL_MAIN on group 1 and MTMAIN on group 2, run the line">▶ Run line</button>
      <button data-l="stop" title="Hold both robots and freeze the line, e.g. to teach">❚❚ Stop</button>
      <select data-l="speed" title="Simulation speed">${[1, 2, 4, 8].map((k) => `<option value="${k}">${k}x</option>`).join('')}</select>
      <button data-l="reset" title="Reload the line with the original robots, programs and points">Reset</button>
      <button data-l="more" title="Order settings">Order ▾</button>
      <button data-l="min" class="lmin" title="Hide this panel (click again to bring it back)">✕</button></div>
    <div class="lo" hidden>${ORD.map(([k, , label, lo, hi]) => `<label>${label}<input type="number" data-o="${k}" min="${lo}" max="${hi}" value="${sim!.order[k]}"></label>`).join('')}
      <button data-l="neworder" title="Reset the order counters and start dispensing pallets again">New order</button></div>
    <div class="lc">${Object.keys(cams).map((k) => `<button data-cam="${k}">${k}</button>`).join('')}</div>
    <div class="ls"></div>`;
  $('#view').appendChild(linePanel);
  // hide / show the line panel; it shrinks to a small "PL-01 line" tab and remembers the choice
  const minBtn = linePanel.querySelector('[data-l="min"]') as HTMLButtonElement;
  const setMin = (m: boolean) => {
    linePanel.classList.toggle('min', m);
    minBtn.textContent = m ? '▸ Show' : '✕';
    minBtn.title = m ? 'Show the line panel' : 'Hide this panel (click again to bring it back)';
    try { localStorage.setItem('opencell.lineMin', m ? '1' : '0'); } catch { /* storage unavailable */ }
  };
  minBtn.addEventListener('click', () => setMin(!linePanel.classList.contains('min')));
  try { if (localStorage.getItem('opencell.lineMin') === '1') setMin(true); } catch { /* storage unavailable */ }
  linePanel.querySelector('[data-l="run"]')!.addEventListener('click', () => { if (plcBus.connected) plcBus.write('HMI_Start', 1), setTimeout(() => plcBus.write('HMI_Start', 0), 400); startLine(); });
  linePanel.querySelector('[data-l="stop"]')!.addEventListener('click', stopLine);
  linePanel.querySelector('[data-l="reset"]')!.addEventListener('click', () => { if (confirm('Reset the line? Your edits to the two robots\' programs and points are replaced.')) resetLine(); });
  linePanel.querySelector('[data-l="speed"]')!.addEventListener('change', (e) => { simSpeed = +(e.target as HTMLSelectElement).value; });
  linePanel.querySelector('[data-l="more"]')!.addEventListener('click', () => { const o = linePanel.querySelector<HTMLElement>('.lo')!; o.hidden = !o.hidden; });
  linePanel.querySelector('[data-l="neworder"]')!.addEventListener('click', () => { sim!.newOrder(); if (plcBus.connected) { plcBus.write('HMI_New_Order', 1); setTimeout(() => plcBus.write('HMI_New_Order', 0), 600); } });
  linePanel.querySelectorAll<HTMLInputElement>('[data-o]').forEach((inp) => inp.addEventListener('change', () => {
    const row = ORD.find((r) => r[0] === inp.dataset.o)!;
    const v = Math.max(row[3], Math.min(row[4], Math.round(+inp.value || 0)));
    inp.value = String(v);
    sim!.order[row[0]] = v;
    if (plcBus.connected) plcBus.write(row[1], v);
  }));
  // keep the inputs in step with the PLC / HMI
  setInterval(() => linePanel.querySelectorAll<HTMLInputElement>('[data-o]').forEach((inp) => { if (document.activeElement !== inp) inp.value = String(sim!.order[inp.dataset.o as keyof Pl01Sim["order"]]); }), 500);
  linePanel.querySelectorAll<HTMLButtonElement>('[data-cam]').forEach((b) => b.addEventListener('click', () => {
    const k = b.dataset.cam!;
    viewer.frame(...cams[k]);
    const g = k === 'Palletizer' ? 0 : k === 'Machine tending' ? 1 : -1;
    if (g >= 0 && state.active !== g) { state.active = g; state.emit(); }
  }));
  // The line talks to OpenRung: status tags out, order and conveyor power (MCP-1 M1) in.
  sim.plc = { live: () => plcBus.connected, tag: (t) => plcBus.tag(t), write: (t, v) => plcBus.write(t, v) };
  // Robots follow the PLC when it is live: Line_Run and each robot's servo power (RCP-n K1) must be on.
  const want = [true, true];
  let autoStarted = false;
  setInterval(() => {
    if (!plcBus.connected || !sim) return;
    // first contact with a running PLC: press Start once so the line comes up by itself
    if (!autoStarted && plcBus.mode === 'RUN') { autoStarted = true; plcBus.write('HMI_Start', 1); setTimeout(() => plcBus.write('HMI_Start', 0), 600); }
    state.robots.forEach((r, i) => {
      const n = i + 1;
      const servo = plcBus.tag(`R${n}_Servo_On`), run = plcBus.tag('Line_Run');
      // Robot UI enable input (RCP-n DO O2 wired through the panel). Older PLC projects without it fall back to Line_Run.
      const ui = plcBus.tag(`R${n}_DI_Run`);
      const w = (run === undefined || !!run) && (servo === undefined || !!servo) && (ui === undefined || !!ui);
      const it = interps[i];
      if (w !== want[i]) {
        want[i] = w;
        if (!w) it?.hold(servo !== undefined && !servo ? `SRVO-001 R${n}: servo power off (RCP-${n} K1)` : run !== undefined && !run ? 'line stopped by the PLC' : `SYST-011 R${n}: UI enable input off (RCP-${n} DO O2)`);
        else { state.mode = 'AUTO'; if (it?.fault) it.reset(); const prog = ['PAL_MAIN', 'MTMAIN'][i]; if (it?.status === 'PAUSED') it.resume(); else if (it && !it.running && r.programs[prog]) it.start(prog, 0); }
        state.emit();
      }
      // robot outputs: wired through the RCP-n drawing to PLC inputs (R_n_Running / R_n_Fault) when the project has them
      const wired = plcBus.tag(`R${n}_DO_Running`) !== undefined;
      plcBus.write(wired ? `R${n}_DO_Running` : `R${n}_Running`, it?.running && it.status !== 'PAUSED' ? 1 : 0);
      plcBus.write(wired ? `R${n}_DO_Fault` : `R${n}_Fault`, it?.fault ? 1 : 0);
    });
  }, 250);
  startLine();
}

// ---------------------------------------------------------------- live sensors (library photo-eyes, prox, light curtains, mats)
const sensors = new SensorSim(state, viewer.cell, plcBus, () => [...(demo?.root.children ?? [])].filter((c) => c instanceof THREE.Mesh && c.geometry.type === 'BoxGeometry'));
(window as unknown as { openCell: Record<string, unknown> }).openCell.sensors = sensors;
let sensorT = 0;

// ---------------------------------------------------------------- PLC + robot demo cell
// ---------------------------------------------------------------- resizable teach pendant (width saved per browser)
{
  const pane = document.querySelector('#pendant') as HTMLElement | null, app = document.querySelector('#app') as HTMLElement | null;
  if (pane && app) {
    const base = () => (matchMedia('(max-width: 1100px)').matches ? 360 : 410);
    const apply = (w: number | null) => {
      if (w === null) { app.style.removeProperty('--tp-w'); pane.style.removeProperty('--tp-z'); try { localStorage.removeItem('opencell.tpW'); } catch { /* storage unavailable */ } }
      else {
        w = Math.round(Math.max(240, Math.min(700, w)));
        app.style.setProperty('--tp-w', w + 'px'); pane.style.setProperty('--tp-z', (w / base()).toFixed(3));
        try { localStorage.setItem('opencell.tpW', String(w)); } catch { /* storage unavailable */ }
      }
      window.dispatchEvent(new Event('resize'));
    };
    const cur = () => pane.getBoundingClientRect().width;
    const grip = document.createElement('div');
    grip.className = 'tp-grip'; grip.title = 'Drag to resize the teach pendant (double-click: normal size)';
    pane.appendChild(grip);
    grip.addEventListener('pointerdown', (e) => {
      e.preventDefault(); grip.setPointerCapture(e.pointerId); grip.classList.add('on');
      const x0 = e.clientX, w0 = cur();
      const move = (ev: PointerEvent) => apply(w0 + (x0 - ev.clientX));
      const up = () => { grip.classList.remove('on'); grip.removeEventListener('pointermove', move); grip.removeEventListener('pointerup', up); };
      grip.addEventListener('pointermove', move); grip.addEventListener('pointerup', up);
    });
    grip.addEventListener('dblclick', () => apply(null));
    pane.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('[data-tpsize]') as HTMLElement | null; if (!b) return;
      const d = +b.dataset.tpsize!; apply(d === 0 ? null : cur() * (d < 0 ? 0.88 : 1.12));
    });
    let saved: string | null = null; try { saved = localStorage.getItem('opencell.tpW'); } catch { /* storage unavailable */ }
    if (saved && +saved > 0) apply(+saved);
  }
}

let demo: DemoSim | null = null;
if (state.world.sim === 'demo') {
  demo = new DemoSim(state, plcBus, viewer.scene, () => viewer.flangeOf(0));
  setGizmo('off');
  const panel = document.createElement('div');
  panel.className = 'linepanel';
  panel.innerHTML = `<div class="lh"><b>PLC demo cell</b>
      <button data-d="run" title="AUTO mode and start DEMO">▶ Run robot</button>
      <button data-d="stop" title="Hold the robot">❚❚ Hold</button></div>
    <div class="ls"></div>`;
  $('#view').appendChild(panel);
  panel.querySelector('[data-d="run"]')!.addEventListener('click', () => {
    state.mode = 'AUTO';
    const it = interp;
    if (it.fault) it.reset();
    if (it.status === 'PAUSED') it.resume(); else if (!it.running) it.start('DEMO', 0);
    state.emit();
  });
  panel.querySelector('[data-d="stop"]')!.addEventListener('click', () => { interp.hold('operator hold'); state.emit(); });
  let key = '';
  setInterval(() => {
    if (!demo) return;
    const live = demo.plcLive;
    const k = `${live}${demo.motor}${demo.eye}${demo.stats.binned}${interp.status}${state.io.DI[1]}${state.io.DO[1]}`;
    if (k === key) return; key = k;
    panel.querySelector('.ls')!.innerHTML = `${live ? '<b style="color:#2e7d32">PLC wired</b>' : '<b style="color:#b26a00">No PLC: self-wired</b>'}
      · conveyor ${demo.motor ? 'running' : 'stopped'} · eye ${demo.eye ? 'blocked' : 'clear'}<br>
      DI[1] part ready ${state.io.DI[1] ? 'ON' : 'OFF'} · DO[1] picked ${state.io.DO[1] ? 'ON' : 'OFF'} · robot ${interp.status ?? '-'} · parts in bin ${demo.stats.binned}`;
  }, 200);
}

// Workbench: clicking a robot or an electrical cabinet asks the shell to show its panel drawing, PLC routine and HMI screen.
const toShell = (target: string) => { if (window.parent !== window) window.parent.postMessage({ wb: 'focus', target }, '*'); };
const prevPick = viewer.onPick;
viewer.onPick = (id) => {
  prevPick(id);
  let o = id ? state.obj(id) : undefined;
  while (o?.parent && state.obj(o.parent)) o = state.obj(o.parent);
  const m = o && /^(MCP|RCP)-\d+/.exec(o.name);
  if (m) { toShell(m[0]); state.message('info', `${o!.name}: opened in the Panel tab`); }
};
viewer.onRobotPick = (i) => {
  if (state.active !== i) { state.active = i; state.emit(); }
  toShell(`R${i + 1}`);
};
window.addEventListener('message', (e) => {
  const d = e.data;
  if (e.source !== window.parent || !d) return;
  // the workbench shell: signed-in users start from an empty cell, signed-out visitors get the PL-01 demo
  if (d.wb === 'cell') { if (d.kind === 'empty') emptyCell(); else if (d.kind === 'demo') resetLine(); return; }
  if (d.wb !== 'select' || typeof d.target !== 'string') return;
  const m = /^R(\d)$/.exec(d.target);
  if (m && state.robots[+m[1] - 1]) { state.active = +m[1] - 1; state.emit(); }
});

let last = performance.now();
function loop(t: number) {
  const dt = Math.min(0.05, (t - last) / 1000);
  last = t;
  syncInterps();
  const n = Math.max(1, Math.ceil(dt * simSpeed / 0.05));
  for (let k = 0; k < n; k++) {
    const h = dt * simSpeed / n;
    jog.tick(dt / n);
    for (const it of interps) it.tick(h);
    if (sim && sim.running) sim.tick(h);
    if (demo && demo.running) demo.tick(h);
    sensorT += h;
    if (sensorT >= 0.05) { sensorT = 0; sensors.tick(); }
  }
  if (dirty) { dirty = false; state.emit(); }
  if (sim) lineStatus();
  viewer.render();
  requestAnimationFrame(loop);
}
viewer.update();
updateHud();
state.message('info', `OpenCell ready. Robot ${state.model.name}. Program ${state.selected} is open in EDIT.`);
requestAnimationFrame(loop);
// For scripting and tests from the browser console.
(window as unknown as { opencell: unknown }).opencell = { state, viewer, interp, interps, get sim() { return sim; }, cells };
