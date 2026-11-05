// Runs the whole PL-01 line headless (robots + line simulation) for simulated minutes.
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { CellState } from '../src/state';
import { Interpreter } from '../src/tp/interp';
import { loadPl01 } from '../src/labs/pl01';
import { Pl01Sim } from '../src/sim/pl01';
import { RobotMesh, setFrame } from '../src/scene/robotMesh';
import { compose } from '../src/kin/math';

describe('PL-01 line simulation', () => {
  it('palletizes, ships pallets and machines parts with no robot alarms', () => {
    const s = new CellState();
    loadPl01(s);
    const scene = new THREE.Scene();
    const arms = s.robots.map((r) => { const m = new RobotMesh(r.model); const root = new THREE.Group(); root.matrixAutoUpdate = false; root.add(m.root); scene.add(root); return { m, root }; });
    const pose = () => s.robots.forEach((r, i) => {
      setFrame(arms[i].root, compose(s.baseFrame(i), { R: [1, 0, 0, 0, 1, 0, 0, 0, 1], p: [r.rail ? r.e[0] : 0, 0, 0] }));
      arms[i].m.update(r.q);
      arms[i].root.updateMatrixWorld(true);
    });
    pose();
    const sim = new Pl01Sim(s, scene, (i) => arms[i]?.m.flange);
    const its = s.robots.map((_, i) => new Interpreter(s.view(i)));
    its[0].start('PAL_MAIN'); its[1].start('MTMAIN');
    const dt = 1 / 30;
    for (let t = 0; t < 900; t += dt) {
      for (const it of its) it.tick(dt);
      pose();
      sim.tick(dt);
      for (const it of its) expect(it.fault, s.log.slice(-4).map((l) => l.text).join(' | ')).toBe(false);
    }
    console.log(JSON.stringify(sim.stats), 'R', s.robots[0].R[5].v, s.robots[1].R[20].v);
    expect(sim.stats.cases).toBeGreaterThan(20) // packing now waits for CNC parts on the return belt;
    expect(sim.stats.pallets).toBeGreaterThanOrEqual(2);
    expect(s.robots[1].R[20].v).toBeGreaterThanOrEqual(6);
    expect(sim.stats.parts).toBeGreaterThan(0);
  }, 120000);
});
