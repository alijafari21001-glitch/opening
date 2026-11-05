import { describe, it, expect } from 'vitest';
import { newRobot } from '../src/state';
import { check, setupProgram, pack } from '../src/tp/handlingpro';
import { parseLine } from '../src/tp/parser';
import { fromLS } from '../src/tp/lsimport';
import { zip, crc32 } from '../src/ui/zip';
import { demoProgram } from '../src/labs/demo';

describe('HandlingPRO export', () => {
  it('flags long names, missing CALL targets and empty fields', () => {
    const r = newRobot();
    r.programs = { DEMO: demoProgram(), LONGNAME_MAIN: { name: 'LONGNAME_MAIN', comment: '', lines: ['CALL NOPE', 'J P[9] 100% FINE', 'DO[...]=ON'], pos: {}, modified: 0 } };
    const f = check(r).filter((x) => x.prog === 'LONGNAME_MAIN').map((x) => x.text).join('\n');
    expect(f).toMatch(/8/); expect(f).toMatch(/calls NOPE/); expect(f).toMatch(/P\[9\]/); expect(f).toMatch(/empty field/);
    expect(check(r).filter((x) => x.prog === 'DEMO')).toEqual([]);
  });
  it('setup program parses and writes frames, PRs and Rs', () => {
    const r = newRobot();
    r.tools[0] = { comment: 'Gripper', pose: { x: 0, y: 0, z: 116, w: 0, p: 0, r: 0 } };
    r.PR[10] = { cmt: 'Home', v: { uf: 0, ut: 1, joint: [0, 0, 0, 0, -90, 0] } };
    r.PR[2] = { cmt: 'Pallet base', v: { uf: 1, ut: 1, cart: { pose: { x: 150.5, y: 125, z: 200, w: 0, p: 0, r: 0 }, cfg: { flip: false, up: true, front: true, turns: [0, 0, 0] } } } };
    r.R[5] = { v: 3, cmt: 'Columns' };
    const p = setupProgram(r);
    for (const l of p.lines) expect(parseLine(l).error, l).toBeUndefined();
    const t = p.lines.join('\n');
    expect(t).toContain('PR[100,3:OC scratch]=116'); expect(t).toContain('UTOOL[1]=PR[100:OC scratch]');
    expect(t).toContain('PR[10,5:Home]=(-90)'); expect(t).toContain('PR[2,1:Pallet base]=150.5'); expect(t).toContain('R[5:Columns]=3');
  });
  it('pack has every program, the setup program and a readme, and each .LS reads back', () => {
    const r = newRobot(); r.programs = { DEMO: demoProgram() };
    const files = pack(r);
    expect(files.map((f) => f.name)).toEqual(['DEMO.LS', 'OCSETUP.LS', 'README.txt']);
    expect(fromLS(files[0].data).prog.lines).toEqual(demoProgram().lines);
    const z = zip(files);
    expect(new DataView(z.buffer).getUint32(0, true)).toBe(0x04034b50);
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });
});
