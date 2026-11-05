import { describe, it, expect } from 'vitest';
import { readTag } from '../src/bus/plcbus';

const v = { c: { Start: 1, Count: 6, Arr: [0, 7], Local: undefined, T1: { ACC: 250, DN: 1 } } as Record<string, unknown>, p: { MainProgram: { Done: 1 } } };
describe('readTag', () => {
  it('reads controller, member, array, bit and program tags', () => {
    expect(readTag(v, 'Start')).toBe(1);
    expect(readTag(v, 'T1.ACC')).toBe(250);
    expect(readTag(v, 'Arr[1]')).toBe(7);
    expect(readTag(v, 'Count.1')).toBe(1);
    expect(readTag(v, 'Count.0')).toBe(0);
    expect(readTag(v, 'Program:MainProgram.Done')).toBe(1);
    expect(readTag(v, 'Nope')).toBeUndefined();
  });
});
