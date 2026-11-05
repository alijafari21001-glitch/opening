// Builds the page preset for the PL-01 production line cell (two robots, taught programs, animated line).
// Run: npx vite-node tools/make-pl01.ts <meshes.json from split_pl01_v2.py> <out.js>
import { readFileSync, writeFileSync } from 'node:fs';
import { CellState } from '../src/state';
import { loadPl01 } from '../src/labs/pl01';

const [meshFile, out] = process.argv.slice(2);
const meshes: Record<string, string> = JSON.parse(readFileSync(meshFile, 'utf8'));
const s = new CellState();
loadPl01(s);
s.message('info', 'PL-01 production line loaded: palletizer (group 1) and machine tender on its rail (group 2).');
const ids = Object.fromEntries(Object.entries(meshes).map(([k, v]) => [`page:pl01-${k}`, v]));
const preset = { id: 'pl01-v4', cell: s.snapshot(), camera: { target: [9000, 1500, 0], from: [26000, -21000, 17000] } };
writeFileSync(out, `window.OPENCELL_MESHES=${JSON.stringify(ids)};\nwindow.OPENCELL_PRESET=${JSON.stringify(preset)};\n`);
