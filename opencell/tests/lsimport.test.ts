import { describe, it, expect } from 'vitest';
// node:fs without @types/node in this project
const fs = (await import(/* @vite-ignore */ 'node:' + 'fs')) as { readFileSync(u: URL, e: string): string; readdirSync(u: URL): string[] };
const { readFileSync, readdirSync } = fs;
import { fromLS } from '../src/tp/lsimport';
import { toLS } from '../src/tp/ls';
import { demoProgram } from '../src/labs/demo';

const dir = new URL('./fixtures/', import.meta.url);
describe('.LS import', () => {
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.LS'))) {
    it(`reads ${f} and writes it back the same`, () => {
      const a = fromLS(readFileSync(new URL(f, dir), 'utf8'));
      expect(a.warnings.filter((w) => !w.includes('has no position'))).toEqual([]);
      expect(a.prog.lines.length).toBeGreaterThan(0);
      const b = fromLS(toLS(a.prog));
      expect(b.prog.lines).toEqual(a.prog.lines);
      expect(b.prog.pos).toEqual(a.prog.pos);
    });
  }
  it('round-trips OpenCell programs with Cartesian and joint points', () => {
    for (const p of [demoProgram()]) {
      const b = fromLS(toLS(p)).prog;
      expect(b.lines).toEqual(p.lines);
      for (const [n, q] of Object.entries(p.pos)) {
        const r = b.pos[+n];
        if (q.joint) expect(r.joint).toEqual(q.joint);
        else expect(r.cart!.pose).toEqual(q.cart!.pose);
      }
    }
  });
  it('joins continuation lines and reads rail E1', () => {
    const t = `/PROG  T1\n/MN\n   1:  L P[1] 100mm/sec FINE\n    :  Offset,PR[2] ;\n/POS\nP[1]{\n   GP1:\n\tUF : 1, UT : 2,\t\tCONFIG : 'F U T, 0, 0, 1',\n\tX = 1.000  mm,\tY = 2.000  mm,\tZ = 3.000  mm,\n\tW = 4.000 deg,\tP = 5.000 deg,\tR = 6.000 deg,\n\tE1= 750.000  mm\n};\n/END\n`;
    const p = fromLS(t).prog;
    expect(p.lines).toEqual(['L P[1] 100mm/sec FINE Offset,PR[2]']);
    expect(p.pos[1]).toMatchObject({ uf: 1, ut: 2, ext: [750], cart: { pose: { x: 1, y: 2, z: 3, w: 4, p: 5, r: 6 }, cfg: { flip: true, turns: [0, 0, 1] } } });
  });
});
