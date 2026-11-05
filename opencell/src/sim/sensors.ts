// Live sensors: every cell object with a `sensor` checks its zone each tick and drives a PLC tag or a robot input.
import * as THREE from 'three';
import type { CellState } from '../state';
import type { CellObject } from '../cell/objects';
import type { CellScene } from '../scene/cellScene';
import type { PlcBus } from '../bus/plcbus';

export class SensorSim {
  /** Last state per sensor object id (true = blocked / detected). */
  readonly state = new Map<string, boolean>();
  private listeners = new Set<() => void>();
  constructor(private s: CellState, private cell: CellScene, private bus: PlcBus, private extra: () => THREE.Object3D[] = () => []) {}
  onChange(f: () => void) { this.listeners.add(f); }

  /** World AABB of a sensor's zone. */
  private zoneBox(o: CellObject): THREE.Box3 | null {
    const g = this.cell.group(o.id);
    if (!g || !o.sensor) return null;
    g.updateWorldMatrix(true, false);
    const [a, b, c, d, e, f] = o.sensor.zone;
    const box = new THREE.Box3();
    for (const x of [a, d]) for (const y of [b, e]) for (const z of [c, f]) box.expandByPoint(new THREE.Vector3(x, y, z).applyMatrix4(g.matrixWorld));
    return box;
  }

  private targets(): THREE.Box3[] {
    const out: THREE.Box3[] = [];
    for (const o of this.s.objects) {
      if (o.hidden || !(o.role === 'part' || o.role === 'worker' || o.role === 'tool')) continue;
      if (o.parent && this.s.obj(o.parent)?.role === o.role) continue; // counted with its root
      const g = this.cell.group(o.id);
      const wb = g && this.cell.worldBox(g);
      if (wb) out.push(new THREE.Box3(new THREE.Vector3(wb[0], wb[1], wb[2]), new THREE.Vector3(wb[3], wb[4], wb[5])));
    }
    for (const m of this.extra()) { const b = new THREE.Box3().setFromObject(m); if (!b.isEmpty()) out.push(b); }
    return out;
  }

  tick() {
    const sensors = this.s.objects.filter((o) => o.sensor);
    if (!sensors.length) return;
    const tg = this.targets();
    let changed = false, ioDirty = false;
    for (const o of sensors) {
      const z = this.zoneBox(o), sn = o.sensor!;
      if (!z) continue;
      const hit = tg.some((b) => b.intersectsBox(z));
      const was = this.state.get(o.id);
      if (was !== hit) {
        this.state.set(o.id, hit); changed = true;
        // beam / field turns red while blocked
        for (const c of this.s.objects) if (c.parent === o.id && /beam|field/i.test(c.name)) c.color = hit ? '#ff3030' : '#30c030';
        if (sn.kind === 'safety mat') o.color = hit ? '#ff8a00' : '#f2c200';
      }
      const v = (hit ? 1 : 0) ^ (sn.invert ? 1 : 0);
      const out = sn.out;
      if (out.to === 'plc') { if (out.tag) this.bus.write(out.tag, v); }
      else if (this.s.io[out.port] && this.s.io[out.port][out.idx] !== v) { this.s.io[out.port][out.idx] = v; ioDirty = true; }
    }
    if (changed || ioDirty) this.s.emit();
    if (changed) for (const f of this.listeners) f();
  }
}
