import { describe, it, expect } from 'vitest';
import { CellState } from '../src/state';
import { Interpreter } from '../src/tp/interp';
import { parseLine } from '../src/tp/parser';
import { loadPl01 } from '../src/labs/pl01';

function cell() {
  const s = new CellState();
  loadPl01(s);
  const it = s.robots.map((_, i) => new Interpreter(s.view(i)));
  return { s, it };
}

describe('PL-01 production line', () => {
  it('programs parse', () => {
    const { s } = cell();
    for (const r of s.robots) for (const p of Object.values(r.programs)) p.lines.forEach((l, i) => expect(parseLine(l).error, `${p.name} ${i + 1}: ${l}`).toBeUndefined());
  });

  it('palletizer runs a full pallet A and switches to B', () => {
    const { s, it } = cell();
    s.io.DI[1] = 1; s.io.DI[2] = 1; s.io.DI[3] = 1;
    it[0].start('PAL_MAIN');
    let pulses = 0, prev = 0;
    for (let t = 0; t < 400 && s.robots[0].R[5].v < 14; t += 0.02) {
      it[0].tick(0.02);
      if (s.io.DO[2] && !prev) pulses++;
      prev = s.io.DO[2];
      expect(it[0].fault, s.log.slice(-3).map((l) => l.text).join(' | ')).toBe(false);
    }
    expect(s.robots[0].R[5].v).toBeGreaterThanOrEqual(14);
    expect(pulses).toBe(1);
    expect(s.robots[0].R[3].v).toBe(2);
  });

  it('machine tender serves all three VMCs along the rail', () => {
    const { s, it } = cell();
    s.io.DI[11] = 1; s.io.DI[12] = 1;
    for (const n of [1, 2, 3]) s.io.DI[30 + n] = 1;
    it[1].start('MTMAIN');
    let maxE = 0;
    for (let t = 0; t < 600 && s.robots[1].R[20].v < 3; t += 0.02) {
      for (const n of [1, 2, 3]) s.io.DI[20 + n] = s.io.DO[20 + n];
      it[1].tick(0.02);
      maxE = Math.max(maxE, s.robots[1].e[0]);
      expect(it[1].fault, s.log.slice(-3).map((l) => l.text).join(' | ')).toBe(false);
    }
    expect(s.robots[1].R[20].v).toBe(3);
    expect(maxE).toBeGreaterThan(9000);
    // second round: parts are done, so it unloads to the outfeed first
    for (const n of [1, 2, 3]) s.io.DI[40 + n] = 1;
    for (let t = 0; t < 300 && s.robots[1].R[3].v < 1; t += 0.02) {
      for (const n of [1, 2, 3]) s.io.DI[20 + n] = s.io.DO[20 + n];
      it[1].tick(0.02);
      expect(it[1].fault, s.log.slice(-3).map((l) => l.text).join(' | ')).toBe(false);
    }
    expect(s.robots[1].R[3].v).toBe(1);
  });

  it('keeps a snapshot round trip with two robots and the rail', () => {
    const { s } = cell();
    const t = new CellState();
    t.restore(JSON.parse(JSON.stringify(s.snapshot())));
    expect(t.robots.length).toBe(2);
    expect(t.robots[1].rail?.length).toBe(10600);
    expect(t.robots[1].PR[3].v?.ext?.[0]).toBe(1100);
  });
});
