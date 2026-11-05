// Public build stand-in: course lab content (Lab 5) is left out of the public site.
import type { CellState } from '../state';
import type { TPProgram } from '../tp/program';
export const LAB5_ON = false;
export function loadLab5(_s: CellState): void { /* not in the public build */ }
export function lab5Program(): TPProgram { throw new Error('not in the public build'); }
export function lab5CollisionProgram(): TPProgram { throw new Error('not in the public build'); }
