import { describe, it, expect } from 'vitest';
import { LIBRARY, buildLib } from '../src/cell/library';

describe('CAD library', () => {
  it('every item builds with its defaults, children point at a root in the same list', () => {
    for (const it of LIBRARY) {
      const list = buildLib(it.id, -330, 900, 0);
      expect(list.length, it.id).toBeGreaterThan(0);
      const ids = new Set(list.map((o) => o.id));
      for (const o of list.slice(1)) if (o.parent) expect(ids.has(o.parent), `${it.id}/${o.name}`).toBe(true);
      for (const o of list) for (const v of [...o.size, o.pose.x, o.pose.y, o.pose.z]) expect(Number.isFinite(v), `${it.id}/${o.name}`).toBe(true);
    }
  });
  it('uses the given sizes', () => {
    const [top] = buildLib('table', 0, 0, 0, { l: 1500, w: 700, h: 900 });
    expect(top.size).toEqual([1500, 700, 30]); expect(top.pose.z).toBe(870);
  });
});
