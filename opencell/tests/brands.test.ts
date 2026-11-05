import { describe, it, expect } from 'vitest';
import { newRobot } from '../src/state';
import { translate, rotvec } from '../src/tp/brands';
import { demoProgram } from '../src/labs/demo';
import { wprToMat } from '../src/kin/math';

const robot = () => { const r = newRobot(); r.programs = { DEMO: demoProgram() }; r.tools[0] = { comment: 'Gripper', pose: { x: 0, y: 0, z: 116, w: 0, p: 0, r: 0 } }; return r; };

describe('other robot languages', () => {
  it('ABB RAPID: module with targets, moves, I/O and the loop', () => {
    const t = translate(robot(), 'abb');
    const m = t.files[0].data;
    expect(t.files[0].name).toBe('DEMO.mod');
    expect(m).toMatch(/^MODULE DEMO_MOD/); expect(m).toContain('PROC DEMO()'); expect(m).toContain('CONST robtarget p3 := [[300,-450');
    expect(m).toContain('MoveL p3, v300, fine, tool1\\WObj:=wobj0;'); expect(m).toContain('WaitDI di_1, 1;'); expect(m).toContain('SetDO do_101, 1;');
    expect(m).toContain('GOTO lbl1;'); expect(m).toContain('R{1} := (R{1} + 1);'); expect(m).toContain('ENDMODULE');
    expect(t.warnings).toEqual([]);
  });
  it('Yaskawa INFORM: job with rectangular positions and instructions', () => {
    const t = translate(robot(), 'yaskawa');
    const j = t.files[0].data;
    expect(j).toContain('//NAME DEMO'); expect(j).toContain('///NPOS 5,0,0,0,0,0'); expect(j).toContain('///RECTAN');
    expect(j).toMatch(/MOVL C00002 V=300\.0\r\n/); expect(j).toContain('WAIT IN#(1)=ON'); expect(j).toContain('DOUT OT#(101) ON');
    expect(j).toContain('INC D001'); expect(j).toContain('JUMP *L1'); expect(j).toContain('TIMER T=0.30');
    expect(t.warnings).toEqual([]);
  });
  it('URScript: the LBL/JMP loop becomes while True, poses in metres', () => {
    const t = translate(robot(), 'ur', 'DEMO');
    const u = t.files[0].data;
    expect(u).toContain('def demo_program():'); expect(u).toContain('while True:  # LBL[1]');
    expect(u).toMatch(/movel\(p\[0\.30000, -0\.45000/); expect(u).toContain('while not (get_standard_digital_in(0) == True):');
    expect(u).toContain('set_standard_digital_out(0, True)'); expect(u.trim().endsWith('end')).toBe(true);
    expect(t.warnings.join('\n')).toMatch(/DO\[101\] mapped/);
  });
  it('rotation vector of W180 is pi about X', () => {
    const v = rotvec(wprToMat(180, 0, 0));
    expect(Math.abs(v[0])).toBeCloseTo(Math.PI, 5); expect(v[1]).toBeCloseTo(0, 5);
  });
});
