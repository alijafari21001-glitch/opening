import { describe, it, expect } from 'vitest';
import { parseLine } from '../src/tp/parser';
import { CellState } from '../src/state';
import { Interpreter } from '../src/tp/interp';
import { newProgram } from '../src/tp/program';

const ok = (l: string) => { const r = parseLine(l); expect(r.error, `${l}: ${r.error}`).toBeUndefined(); return r.stmt; };

describe('TP parser', () => {
  it('parses motion instructions', () => {
    const j = ok('J P[1] 100% FINE');
    expect(j).toMatchObject({ k: 'motion', type: 'J', target: { reg: 'P', idx: 1 }, speed: { v: 100, unit: '%' }, term: { fine: true } });
    expect(ok('L P[2:Above part] 500mm/sec CNT50')).toMatchObject({ type: 'L', speed: { v: 500, unit: 'mm/sec' }, term: { fine: false, cnt: 50 } });
    expect(ok('L PR[3] 2.5sec FINE Offset,PR[1]')).toMatchObject({ target: { reg: 'PR', idx: 3 }, speed: { unit: 'sec' }, offset: { kind: 'Offset', pr: 1 } });
    expect(ok('L P[4] 100mm/sec FINE Tool_Offset,PR[2]')).toMatchObject({ offset: { kind: 'Tool_Offset', pr: 2 } });
    expect(ok('C P[5] : P[6] 200mm/sec CNT100')).toMatchObject({ type: 'C', via: { idx: 5 }, target: { idx: 6 } });
    expect(ok('J P[1] R[3]% CNT R[4]')).toMatchObject({ speed: { v: { k: 'ref', port: 'R' } }, term: { cnt: { k: 'ref' } } });
    expect(parseLine('J P[1] 500mm/sec FINE').error).toMatch(/not allowed/);
    expect(parseLine('L P[1] 100% FINE').error).toMatch(/not allowed/);
  });
  it('parses registers and math', () => {
    expect(ok('R[1]=R[1]+1')).toMatchObject({ k: 'assign', port: 'R', idx: 1 });
    expect(ok('R[2:Count]=R[3] DIV 2')).toMatchObject({ expr: { k: 'bin', op: 'DIV' } });
    expect(ok('R[2]=R[3] MOD 4')).toMatchObject({ expr: { op: 'MOD' } });
    expect(ok('PR[1,3]=R[5]')).toMatchObject({ port: 'PR', idx: 1, idx2: 3 });
    expect(ok('PR[2]=LPOS')).toMatchObject({ expr: { k: 'lpos' } });
    expect(ok('PR[2]=PR[1]+PR[3]')).toMatchObject({ expr: { k: 'bin', op: '+' } });
    expect(ok('R[R[1]]=5')).toMatchObject({ idx: { reg: 'R', n: 1 } });
  });
  it('parses I/O', () => {
    expect(ok('DO[1]=ON')).toMatchObject({ k: 'assign', port: 'DO', expr: { k: 'bool', v: true } });
    expect(ok('RO[2]=OFF')).toMatchObject({ port: 'RO' });
    expect(ok('DO[3]=PULSE,0.5sec')).toMatchObject({ k: 'pulse', width: 0.5 });
    expect(ok('WAIT DI[1]=ON')).toMatchObject({ k: 'wait' });
    expect(ok('WAIT DI[2]=ON TIMEOUT,LBL[9]')).toMatchObject({ k: 'wait', timeoutLbl: 9 });
    expect(ok('WAIT 1.00(sec)')).toMatchObject({ k: 'wait_time', t: { v: 1 } });
    expect(ok('WAIT DI[1]=ON AND DI[2]=OFF')).toMatchObject({ k: 'wait', cond: { op: 'AND' } });
    expect(ok('$WAITTMOUT=500')).toMatchObject({ k: 'assign', port: 'SYS', sys: '$WAITTMOUT' });
    expect(parseLine('DI[1]=ON').error).toMatch(/input/);
  });
  it('parses flow control', () => {
    expect(ok('LBL[10:Loop]')).toMatchObject({ k: 'label', n: 10, cmt: 'Loop' });
    expect(ok('JMP LBL[10]')).toMatchObject({ k: 'jmp', n: 10 });
    expect(ok('IF R[1]<3,JMP LBL[1]')).toMatchObject({ k: 'if', then: { k: 'jmp' } });
    expect(ok('IF (DI[1]=ON AND R[2]>=1),CALL PICK')).toMatchObject({ then: { k: 'call', prog: 'PICK' } });
    expect(ok('IF DI[1]=OFF,DO[1]=ON')).toMatchObject({ then: { k: 'assign' } });
    expect(ok('SELECT R[1]=1,JMP LBL[1]')).toMatchObject({ k: 'select', reg: 1 });
    expect(ok('=2,CALL PLACE')).toMatchObject({ k: 'case' });
    expect(ok('ELSE,JMP LBL[9]')).toMatchObject({ k: 'case_else' });
    expect(ok('FOR R[1]=1 TO 3')).toMatchObject({ k: 'for', down: false });
    expect(ok('FOR R[1]=R[2] DOWNTO 1')).toMatchObject({ k: 'for', down: true });
    expect(ok('ENDFOR')).toMatchObject({ k: 'endfor' });
    expect(ok('CALL SUB1(1,R[2])')).toMatchObject({ k: 'call', prog: 'SUB1' });
    expect(ok('MESSAGE[Hello world]')).toMatchObject({ k: 'message', text: 'Hello world' });
    for (const l of ['END', 'ABORT', 'PAUSE', 'UFRAME_NUM=1', 'UTOOL_NUM=2', 'PAYLOAD[1]', 'OVERRIDE=50%', 'TIMER[1]=START', 'OFFSET CONDITION PR[1]', '!comment', '', '//J P[1] 100% FINE', 'IF R[1]=1 THEN', 'ELSE', 'ENDIF', 'UFRAME[1]=PR[1]'])
      ok(l);
  });
  it('reports errors with a position', () => {
    const r = parseLine('J P[1] 100% FINNE');
    expect(r.error).toBeTruthy();
    expect(parseLine('FOO BAR').error).toMatch(/Unknown/);
  });
});

function run(lines: string[], setup?: (s: CellState) => void, maxT = 60) {
  const s = new CellState();
  s.override = 100;
  s.mode = 'AUTO';
  const p = newProgram('MAIN');
  p.lines = lines;
  s.programs = { MAIN: p };
  setup?.(s);
  const it = new Interpreter(s);
  it.start('MAIN');
  let t = 0;
  while (it.status === 'RUNNING' && t < maxT) { it.tick(0.01); t += 0.01; }
  return { s, it, t };
}

describe('TP interpreter', () => {
  it('does register math, labels and IF', () => {
    const { s, it } = run(['R[1]=0', 'LBL[1]', 'R[1]=R[1]+1', 'IF R[1]<5,JMP LBL[1]', 'R[2]=R[1]*3 DIV 2', 'R[3]=7 MOD 3']);
    expect(it.status).toBe('IDLE');
    expect(s.R[1].v).toBe(5);
    expect(s.R[2].v).toBe(7);
    expect(s.R[3].v).toBe(1);
  });
  it('runs FOR loops (nested) and SELECT', () => {
    const { s } = run(['R[3]=0', 'FOR R[1]=1 TO 3', 'FOR R[2]=2 DOWNTO 1', 'R[3]=R[3]+1', 'ENDFOR', 'ENDFOR',
      'R[4]=2', 'SELECT R[4]=1,JMP LBL[1]', '=2,JMP LBL[2]', 'ELSE,JMP LBL[3]', 'LBL[1]', 'R[5]=1', 'END', 'LBL[2]', 'R[5]=2', 'END', 'LBL[3]', 'R[5]=3']);
    expect(s.R[3].v).toBe(6);
    expect(s.R[5].v).toBe(2);
  });
  it('calls subprograms with arguments and returns', () => {
    const s0 = (s: CellState) => { const sub = newProgram('SUB'); sub.lines = ['R[10]=AR[1]+AR[2]', 'END', 'R[10]=99']; s.programs.SUB = sub; };
    const { s } = run(['CALL SUB(2,R[1])', 'R[11]=1'], (s) => { s0(s); s.R[1].v = 5; });
    expect(s.R[10].v).toBe(7);
    expect(s.R[11].v).toBe(1);
  });
  it('sets outputs, waits on inputs and handles TIMEOUT', () => {
    const { s, t } = run(['$WAITTMOUT=50', 'DO[1]=ON', 'WAIT DI[1]=ON TIMEOUT,LBL[9]', 'R[1]=1', 'END', 'LBL[9]', 'R[1]=9']);
    expect(s.io.DO[1]).toBe(1);
    expect(s.R[1].v).toBe(9);
    expect(t).toBeGreaterThan(0.45);
    const r2 = run(['WAIT DI[1]=ON TIMEOUT,LBL[9]', 'R[1]=1', 'END', 'LBL[9]', 'R[1]=9'], (s) => { s.io.DI[1] = 1; });
    expect(r2.s.R[1].v).toBe(1);
  });
  it('WAIT time takes the right time', () => {
    const { t } = run(['WAIT 0.50(sec)']);
    expect(t).toBeGreaterThan(0.49);
    expect(t).toBeLessThan(0.6);
  });
  it('moves to taught points with J and L and reaches them', () => {
    const { s, it } = run(['UFRAME_NUM=0', 'UTOOL_NUM=1', 'J P[1] 100% FINE', 'L P[2] 500mm/sec FINE'], (s) => {
      const cfg = { flip: false, up: true, front: true, turns: [0, 0, 0] as [number, number, number] };
      s.programs.MAIN.pos = { 1: { uf: 0, ut: 1, cart: { pose: { x: 400, y: 0, z: 100, w: 180, p: 0, r: 0 }, cfg } }, 2: { uf: 0, ut: 1, cart: { pose: { x: 400, y: 200, z: 100, w: 180, p: 0, r: 0 }, cfg } } };
    });
    expect(it.status).toBe('IDLE');
    const p = s.tcpUser();
    expect(p.x).toBeCloseTo(400, 3); expect(p.y).toBeCloseTo(200, 3); expect(p.z).toBeCloseTo(100, 3);
    expect(it.lastCycle).toBeGreaterThan(0.4); // 200 mm at 500 mm/s
  });
  it('applies Offset,PR and refuses frame mismatches', () => {
    const cfg = { flip: false, up: true, front: true, turns: [0, 0, 0] as [number, number, number] };
    const setup = (s: CellState) => {
      s.programs.MAIN.pos = { 1: { uf: 0, ut: 1, cart: { pose: { x: 400, y: 0, z: 100, w: 180, p: 0, r: 0 }, cfg } } };
      s.PR[1].v = { uf: -1, ut: -1, cart: { pose: { x: 0, y: 0, z: 50, w: 0, p: 0, r: 0 }, cfg } };
    };
    const { s } = run(['UTOOL_NUM=1', 'J P[1] 100% FINE Offset,PR[1]'], setup);
    expect(s.tcpUser().z).toBeCloseTo(150, 3);
    const bad = run(['UTOOL_NUM=2', 'J P[1] 100% FINE'], setup);
    expect(bad.it.fault).toBe(true);
    expect(bad.s.log.some((l) => /taught with UF:0 UT:1/.test(l.text))).toBe(true);
  });
  it('PR element access and LPOS', () => {
    const { s } = run(['PR[1]=LPOS', 'PR[1,3]=PR[1,3]+100', 'R[1]=PR[1,3]']);
    expect(s.R[1].v).toBeCloseTo(s.tcpUser().z + 100, 6);
  });
  it('runs a circular move', () => {
    const cfg = { flip: false, up: true, front: true, turns: [0, 0, 0] as [number, number, number] };
    const at = (x: number, y: number) => ({ uf: 0, ut: 1, cart: { pose: { x, y, z: 100, w: 180, p: 0, r: 0 }, cfg } });
    const { s, it } = run(['UTOOL_NUM=1', 'J P[1] 100% FINE', 'C P[2] : P[3] 200mm/sec FINE'], (s) => { s.programs.MAIN.pos = { 1: at(450, 0), 2: at(350, 100), 3: at(250, 0) }; });
    expect(it.fault).toBe(false);
    expect(s.tcpUser().x).toBeCloseTo(250, 3);
  });
  it('step mode stops after each line', () => {
    const s = new CellState();
    const p = newProgram('MAIN'); p.lines = ['R[1]=1', 'R[1]=2', 'R[1]=3']; s.programs = { MAIN: p };
    const it = new Interpreter(s);
    it.start('MAIN', 0, { step: true });
    for (let i = 0; i < 10; i++) it.tick(0.01);
    expect(s.R[1].v).toBe(1);
    expect(it.status).toBe('PAUSED');
    it.resume({ step: true });
    for (let i = 0; i < 10; i++) it.tick(0.01);
    expect(s.R[1].v).toBe(2);
  });
});
