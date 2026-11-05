// Field devices of the PLC + robot demo cell (labs/demo.ts): the infeed conveyor, its photo-eye and the parts.
import * as THREE from 'three';
import { CellState } from '../state';
import type { PlcBus } from '../bus/plcbus';
import { BELT, BELT_TOP, PART, PICK, BIN, BIN_FLOOR, DEMO_TAGS } from '../labs/demo';

const SPEED = 150;      // belt, mm/s
const FEED_EVERY = 3.5; // s between new parts while the belt runs
const GAP = 15;         // parts queue this far apart at the end stop

interface Part { g: THREE.Mesh; x: number }

export class DemoSim {
  readonly root = new THREE.Group();
  running = true;
  stats = { fed: 0, binned: 0 };
  motor = false;
  eye = false;
  private parts: Part[] = [];
  private held: THREE.Mesh | null = null;
  private loose: THREE.Mesh[] = [];
  private feedT = FEED_EVERY;
  private prevGrip = 0;
  private mat = new THREE.MeshStandardMaterial({ color: '#e07b24', roughness: 0.6 });
  private geo = new THREE.BoxGeometry(PART, PART, PART);
  private beam: THREE.Mesh;

  constructor(private s: CellState, private bus: PlcBus, scene: THREE.Scene, private flange: () => THREE.Object3D | undefined) {
    scene.add(this.root);
    // photo-eye beam: red while blocked
    this.beam = new THREE.Mesh(new THREE.CylinderGeometry(2, 2, BELT.width + 40, 8), new THREE.MeshBasicMaterial({ color: '#ff3030', transparent: true, opacity: 0.35 }));
    this.beam.position.set(PICK.x, BELT.y, BELT_TOP + 30);
    this.root.add(this.beam);
    this.addPart(PICK.x);
  }

  /** Is the PLC wiring live? Otherwise the cell wires itself so it still runs. */
  get plcLive() { return this.bus.connected && this.bus.tag(DEMO_TAGS.motor) !== undefined; }

  private addPart(x: number) {
    const g = new THREE.Mesh(this.geo, this.mat);
    g.castShadow = true;
    g.position.set(x, BELT.y, BELT_TOP + PART / 2);
    this.root.add(g);
    this.parts.push({ g, x });
    this.parts.sort((a, b) => b.x - a.x);
    this.stats.fed++;
  }

  private tcp(): THREE.Vector3 { const f = this.s.tcpWorld(); return new THREE.Vector3(f.p[0], f.p[1], f.p[2]); }

  tick(dt: number) {
    // eye: a part's body covers the beam
    this.eye = this.parts.some((p) => Math.abs(p.x - PICK.x) < PART / 2);
    const live = this.plcLive;
    this.motor = live ? !!this.bus.tag(DEMO_TAGS.motor) : !this.eye;
    if (live) this.bus.write(DEMO_TAGS.eye, this.eye ? 1 : 0);
    else {
      // self-wired: the eye is the robot's part-ready input
      const di = this.eye ? 1 : 0;
      if (this.s.io.DI[1] !== di) { this.s.io.DI[1] = di; this.s.emit(); }
    }
    (this.beam.material as THREE.MeshBasicMaterial).color.set(this.eye ? '#ff3030' : '#30c030');

    if (this.motor) {
      // move parts toward the end stop, queueing behind the one in front
      let limit = PICK.x;
      for (const p of this.parts) {
        p.x = Math.min(p.x + SPEED * dt, limit);
        limit = p.x - PART - GAP;
        p.g.position.x = p.x;
      }
      this.feedT += dt;
      const first = BELT.x0 + PART / 2 + 10;
      const room = !this.parts.some((p) => p.x < first + PART + GAP);
      if (this.feedT >= FEED_EVERY && room && this.parts.length < 5) { this.feedT = 0; this.addPart(first); }
    }
    this.tickGrip();
  }

  private tickGrip() {
    const r = this.s.robots[0];
    if (!r?.grip) return;
    const on = this.s.io[r.grip.port][r.grip.idx] ? 1 : 0;
    if (on === this.prevGrip) return;
    this.prevGrip = on;
    const fl = this.flange();
    if (!fl) return;
    const tcp = this.tcp();
    if (on && !this.held) {
      const hit = this.parts.find((p) => p.g.position.distanceTo(tcp) < 30);
      const l = this.loose.find((m) => m.getWorldPosition(new THREE.Vector3()).distanceTo(tcp) < 30);
      const g = hit?.g ?? l;
      if (!g) return;
      this.parts = this.parts.filter((p) => p !== hit);
      this.loose = this.loose.filter((m) => m !== l);
      fl.updateWorldMatrix(true, false);
      fl.attach(g);
      this.held = g;
    } else if (!on && this.held) {
      const g = this.held;
      this.held = null;
      this.root.updateWorldMatrix(true, false);
      this.root.attach(g);
      const p = g.position;
      g.rotation.set(0, 0, Math.round(g.rotation.z / (Math.PI / 2)) * (Math.PI / 2));
      const inBin = Math.abs(p.x - BIN.x) < BIN.l / 2 && Math.abs(p.y - BIN.y) < BIN.w / 2;
      if (inBin) {
        // settle on the bin floor in a 4 x 4 pattern, stacking when full
        const n = this.stats.binned++, k = n % 16, layer = Math.floor(n / 16) % 2;
        p.set(BIN.x + ((k % 4) - 1.5) * (PART + 6), BIN.y + (Math.floor(k / 4) - 1.5) * (PART + 6), BIN_FLOOR + 10 + PART / 2 + layer * PART);
        if (n >= 32) { this.root.remove(g); return; }
      }
      this.loose.push(g);
    }
  }

  dispose() { this.root.removeFromParent(); }
}
