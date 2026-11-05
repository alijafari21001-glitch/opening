import type { CellState, IOPort } from '../state';

/**
 * PLC link: robot I/O <-> OpenRung controller tags.
 *
 * OpenRung's virtual PLC speaks on BroadcastChannel 'openrung-plc' ({k:'req',msg} to the controller,
 * {k:'res',msg} back). Every ~100 ms it publishes {op:'values', c, p, mode}. A tag is written with
 * {op:'write', path, value}. Inside the app shell (an iframe) the parent page relays the same
 * messages as {openbus:'req'|'res', msg}, because sandboxed pages cannot share a BroadcastChannel.
 */
export interface PlcLink {
  /** OpenRung tag path, e.g. `Start_PB`, `Local:1:O.Data.0`, `Program:MainProgram.Done`, `Arr[3]`. */
  tag: string;
  port: IOPort;
  idx: number;
  /** 'in': PLC tag drives the robot signal. 'out': robot signal drives the PLC tag. */
  dir: 'in' | 'out';
}

type Vals = { c: Record<string, unknown>; p: Record<string, Record<string, unknown>> };

/** Read a tag path out of the controller's value snapshot. Returns undefined when the path does not exist. */
export function readTag(v: Vals, path: string): number | undefined {
  let p = path.trim();
  let root: Record<string, unknown> = v.c;
  const pm = /^Program:([^.]+)\.(.+)$/.exec(p);
  if (pm) { root = v.p?.[pm[1]] ?? {}; p = pm[2]; }
  // Split "A.B[3].C" and "Local:1:O.Data.0" into steps; a trailing number after a dot is a bit index.
  const steps = p.split('.').flatMap((s) => s.split(/\[|\]/).filter(Boolean));
  let cur: unknown = root;
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    if (typeof cur === 'number') {
      // bit of an integer (DINT.5) only as the last step
      if (i === steps.length - 1 && /^\d+$/.test(s)) return (cur >> +s) & 1;
      return undefined;
    }
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[s];
  }
  if (typeof cur === 'number') return cur;
  if (typeof cur === 'boolean') return cur ? 1 : 0;
  return undefined;
}

export class PlcBus {
  connected = false;
  mode = '';
  lastSeen = 0;
  /** Tags in the latest snapshot that the links could not find. */
  missing = new Set<string>();
  private bc: BroadcastChannel | null = null;
  private framed = false;
  private vals: Vals | null = null;
  private sent = new Map<string, number>();
  private timer = 0;
  private listeners = new Set<() => void>();
  readonly id = 'opencell-' + Math.random().toString(36).slice(2, 8);

  constructor(private s: CellState) {
    this.framed = typeof window !== 'undefined' && window.parent !== window;
    if (this.framed) {
      window.addEventListener('message', (e) => {
        const d = e.data as { openbus?: string; msg?: unknown } | null;
        if (d && d.openbus === 'res') this.onRes(d.msg);
      });
    }
    try {
      this.bc = new BroadcastChannel('openrung-plc');
      this.bc.onmessage = (e) => { const d = e.data as { k?: string; msg?: unknown }; if (d && d.k === 'res') this.onRes(d.msg); };
    } catch { this.bc = null; }
    this.send({ op: 'hello' });
    this.timer = window.setInterval(() => this.tick(), 100);
  }

  get links(): PlcLink[] { return this.s.plcLinks; }
  onChange(f: () => void) { this.listeners.add(f); return () => this.listeners.delete(f); }
  private changed() { for (const f of this.listeners) f(); }

  private send(msg: Record<string, unknown>) {
    msg.from = this.id;
    if (this.framed) window.parent.postMessage({ openbus: 'req', msg }, '*');
    this.bc?.postMessage({ k: 'req', msg });
  }

  private onRes(m: unknown) {
    const msg = m as { op?: string; c?: Record<string, unknown>; p?: Record<string, Record<string, unknown>>; mode?: string } | null;
    if (!msg || msg.op !== 'values' || !msg.c) return;
    const was = this.connected;
    this.vals = { c: msg.c, p: msg.p ?? {} };
    this.mode = msg.mode ?? '';
    this.lastSeen = performance.now();
    this.connected = true;
    this.applyInputs();
    if (!was) { this.s.message('info', 'PLC link: connected to the OpenRung controller'); this.changed(); }
  }

  /** PLC -> robot. */
  private applyInputs() {
    if (!this.vals) return;
    let dirty = false;
    const miss = new Set<string>();
    for (const l of this.links) {
      const v = readTag(this.vals, l.tag);
      if (v === undefined) { miss.add(l.tag); continue; }
      if (l.dir !== 'in') continue;
      const arr = this.s.io[l.port];
      if (!arr || l.idx < 0 || l.idx >= arr.length) continue;
      const nv = isBitPort(l.port) ? (v ? 1 : 0) : v;
      if (arr[l.idx] !== nv) { arr[l.idx] = nv; dirty = true; }
    }
    const mchg = miss.size !== this.missing.size || [...miss].some((t) => !this.missing.has(t));
    this.missing = miss;
    if (dirty) this.s.emit();
    if (mchg) this.changed();
  }

  /** Robot -> PLC: send each output link whenever its value differs from what the PLC last reported. */
  private tick() {
    if (this.connected && performance.now() - this.lastSeen > 2000) {
      this.connected = false; this.s.message('warn', 'PLC link: lost the OpenRung controller'); this.changed();
    }
    if (!this.connected || !this.vals) return;
    for (const l of this.links) {
      if (l.dir !== 'out') continue;
      const v = this.s.io[l.port]?.[l.idx] ?? 0;
      const plc = readTag(this.vals, l.tag);
      if (plc === undefined || plc === v) { this.sent.delete(l.tag); continue; }
      // don't flood: resend the same value at most every 500 ms while the PLC catches up
      const key = l.tag + '=' + v, t = performance.now();
      if ((this.sent.get(key) ?? 0) > t - 500) continue;
      this.sent.set(key, t);
      this.send({ op: 'write', path: l.tag, value: v });
    }
  }

  /** Field devices in the cell (conveyor motors, sensors) read and write PLC tags directly. */
  tag(path: string): number | undefined { return this.connected && this.vals ? readTag(this.vals, path) : undefined; }
  write(path: string, value: number) {
    if (!this.connected || !this.vals) return;
    if (readTag(this.vals, path) === value) { this.sent.delete('f:' + path); return; }
    const key = 'f:' + path + '=' + value, t = performance.now();
    if ((this.sent.get(key) ?? 0) > t - 300) return;
    this.sent.set(key, t);
    this.send({ op: 'write', path, value });
  }

  dispose() { clearInterval(this.timer); this.bc?.close(); }
}

export const isBitPort = (p: IOPort) => !['GI', 'GO', 'AI', 'AO'].includes(p);
/** Ports a PLC tag may drive (robot inputs). */
export const IN_PORTS: IOPort[] = ['DI', 'RI', 'UI', 'GI', 'AI'];
/** Ports the robot drives (robot outputs). */
export const OUT_PORTS: IOPort[] = ['DO', 'RO', 'UO', 'GO', 'AO'];
