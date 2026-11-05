import { describe, it, expect } from 'vitest';
import { CellState } from '../src/state';
import { boxGripper } from '../src/cell/objects';

describe('cell objects', () => {
  it('new cells get Gripper 1 on UT1', () => {
    const s = new CellState();
    expect(s.objects.filter((o) => o.tool === 1).map((o) => o.name)).toEqual(['Gripper 1 body', 'Gripper 1 finger L', 'Gripper 1 finger R']);
    expect(s.tools[0].pose.z).toBe(116);
  });
  it('older saved cells swap the box gripper for Gripper 1 once', () => {
    const old = new CellState();
    old.objects = boxGripper(1);
    old.tools[0] = { comment: 'Gripper TCP', pose: { x: 0, y: 0, z: 120, w: 0, p: 0, r: 0 } };
    old.tools[2] = { comment: '', pose: { x: 0, y: 0, z: 0, w: 0, p: 0, r: 0 } };
    const snap = JSON.parse(JSON.stringify({ ...old.snapshot(), presets: undefined }));
    const s = new CellState();
    s.restore(snap);
    expect(s.objects.filter((o) => o.tool === 1).every((o) => o.kind === 'mesh')).toBe(true);
    expect(s.objects.filter((o) => o.tool === 3)).toHaveLength(4);
    expect(s.tools[0]).toMatchObject({ comment: 'Gripper 1', pose: { z: 116 } });
    expect(s.presets).toContain('gripper1');
  });
  it('keeps a user-modified UT1 tool', () => {
    const old = new CellState();
    old.objects = [...boxGripper(1), { ...boxGripper(1)[0], name: 'My plate' }];
    const s = new CellState();
    s.restore(JSON.parse(JSON.stringify({ ...old.snapshot(), presets: undefined })));
    expect(s.objects.some((o) => o.name === 'My plate')).toBe(true);
    expect(s.objects.some((o) => o.kind === 'mesh')).toBe(false);
  });
});

describe('work envelope', async () => {
  const { envelope, inEnvelope } = await import('../src/kin/envelope');
  const { LRMATE_200IC } = await import('../src/kin/robot');
  it('LR Mate 200iC wrist-center reach is about 0.7 m and excludes points next to the base', () => {
    const e = envelope(LRMATE_200IC);
    const maxR = Math.max(...e.profile.map(([r, z]) => Math.hypot(r, z)));
    expect(maxR).toBeGreaterThan(600);
    expect(maxR).toBeLessThan(720);
    expect(inEnvelope(LRMATE_200IC, [450, 0, 0])).toBe(true);
    expect(inEnvelope(LRMATE_200IC, [1200, 0, 0])).toBe(false);
    expect(inEnvelope(LRMATE_200IC, [-400, 100, 0])).toBe(true);
    expect(inEnvelope(LRMATE_200IC, [-500, 0, 0])).toBe(false);
  });
});
