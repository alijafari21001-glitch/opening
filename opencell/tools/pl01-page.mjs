// Puts the PL-01 preset (meshes + cell) in front of the app script of the single-file build.
// Run: node tools/pl01-page.mjs dist-single/index.html preset.js out.html
import { readFileSync, writeFileSync } from 'node:fs';
const [, , src, preset, out] = process.argv;
const h = readFileSync(src, 'utf8');
const i = h.indexOf('<script type="module"');
writeFileSync(out, h.slice(0, i) + `<script>${readFileSync(preset, 'utf8')}</script>\n` + h.slice(i));
