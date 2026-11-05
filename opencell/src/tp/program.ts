// Program, position and register data as stored by the controller.
import { XYZWPR } from '../kin/math';

export interface CfgLite { flip: boolean; up: boolean; front: boolean; turns: [number, number, number] }

/** A taught position: Cartesian (in a user frame with a tool frame) or joint. */
export interface TPPos {
  uf: number; ut: number;
  cart?: { pose: XYZWPR; cfg: CfgLite };
  joint?: number[];
  /** Extended axes (E1 = rail position, mm) for a robot on a rail. */
  ext?: number[];
  cmt?: string;
}

export interface TPProgram {
  name: string;
  comment: string;
  lines: string[];                 // without line numbers / trailing ';'
  pos: Record<number, TPPos>;      // P[n]
  modified: number;
}

export function newProgram(name: string, comment = ''): TPProgram {
  return { name, comment, lines: [], pos: {}, modified: Date.now() };
}

/** Program names: up to 36 characters, letters, digits and underscore, starting with a letter. */
export function validProgramName(n: string) { return /^[A-Z][A-Z0-9_]{0,35}$/.test(n); }

export function nextFreeP(p: TPProgram) {
  const used = new Set<number>(Object.keys(p.pos).map(Number));
  for (const l of p.lines) for (const m of l.matchAll(/(?<![A-Z])P\[(\d+)/g)) used.add(+m[1]);
  let n = 1;
  while (used.has(n)) n++;
  return n;
}

export function cfgText(c: CfgLite) {
  return `${c.flip ? 'F' : 'N'} ${c.up ? 'U' : 'D'} ${c.front ? 'T' : 'B'}, ${c.turns.join(', ')}`;
}
