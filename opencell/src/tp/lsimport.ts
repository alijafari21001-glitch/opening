// Read a FANUC-style ASCII .LS program (as written by a controller, ROBOGUIDE / HandlingPRO or toLS) into a TPProgram.
import { TPProgram, TPPos, CfgLite, newProgram } from './program';
import { parseLine } from './parser';

export interface LSImport { prog: TPProgram; warnings: string[] }

const num = (s: string | undefined) => (s === undefined ? NaN : parseFloat(s));

export function parseCfg(s: string): CfgLite {
  // 'N U T, 0, 0, 0' (also 'NUT 000' style or 'F D B, -1, 0, 1')
  const letters = s.replace(/[^A-Za-z]/g, '').toUpperCase();
  const turns = (s.match(/-?\d+/g) ?? []).map(Number);
  return {
    flip: letters[0] === 'F', up: letters[1] !== 'D', front: letters[2] !== 'B',
    turns: [turns[0] ?? 0, turns[1] ?? 0, turns[2] ?? 0],
  };
}

function parsePos(body: string, warnings: string[], n: number): TPPos | null {
  // only group 1 is read; other groups are reported
  const groups = body.split(/GP(\d+)\s*:/).slice(1);
  let gp1 = '';
  for (let i = 0; i < groups.length; i += 2) {
    if (groups[i] === '1') gp1 = groups[i + 1];
    else warnings.push(`P[${n}] has group ${groups[i]} data, which is not imported`);
  }
  if (!gp1) gp1 = body;
  const uf = parseInt(/UF\s*:\s*(-?\d+)/.exec(gp1)?.[1] ?? '0', 10);
  const ut = parseInt(/UT\s*:\s*(-?\d+)/.exec(gp1)?.[1] ?? '1', 10);
  const v = (k: string) => num(new RegExp(`(?:^|[\\s,])${k}\\s*=\\s*(-?[\\d.]+)`).exec(gp1)?.[1]);
  const ext: number[] = [];
  for (let e = 1; e <= 3; e++) { const x = v(`E${e}`); if (!Number.isNaN(x)) ext.push(x); }
  const out: TPPos = { uf, ut };
  if (ext.length) out.ext = ext;
  if (/J1\s*=/.test(gp1)) {
    const j = [1, 2, 3, 4, 5, 6].map((k) => v(`J${k}`));
    if (j.some(Number.isNaN)) { warnings.push(`P[${n}] has an unreadable joint position`); return null; }
    out.joint = j;
    return out;
  }
  const [x, y, z, w, p, r] = ['X', 'Y', 'Z', 'W', 'P', 'R'].map(v);
  if ([x, y, z, w, p, r].some(Number.isNaN)) { warnings.push(`P[${n}] has an unreadable Cartesian position`); return null; }
  const cfg = parseCfg(/CONFIG\s*:\s*'([^']*)'/.exec(gp1)?.[1] ?? 'N U T, 0, 0, 0');
  out.cart = { pose: { x, y, z, w, p, r }, cfg };
  return out;
}

export function fromLS(text: string): LSImport {
  const warnings: string[] = [];
  const src = text.replace(/\r\n?/g, '\n');
  const name = /\/PROG\s+([A-Za-z0-9_]+)/.exec(src)?.[1]?.toUpperCase();
  if (!name) throw new Error('Not a .LS program: no /PROG line');
  const prog = newProgram(name, /COMMENT\s*=\s*"([^"]*)"/.exec(src)?.[1] ?? '');
  if (/\/PROG\s+\S+\s+Macro/i.test(src)) warnings.push(`${name} is a macro on the controller; it imports as a normal program`);

  const sec = (tag: string) => {
    const i = src.indexOf(`/${tag}`);
    if (i < 0) return '';
    const rest = src.slice(i + tag.length + 1);
    const j = rest.search(/\n\/(PROG|ATTR|APPL|MN|POS|END)\b/);
    return j < 0 ? rest : rest.slice(0, j);
  };

  // /MN: "  12:  L P[1] 100mm/sec FINE ;"; long lines continue on lines starting with ":"
  const lines: string[] = [];
  for (const raw of sec('MN').split('\n')) {
    const m = /^\s*(\d+)?\s*:\s?(.*)$/.exec(raw);
    if (!m) continue;
    let body = m[2].replace(/\s*;\s*$/, '');
    if (m[1] === undefined) { if (lines.length) lines[lines.length - 1] += ' ' + body.trim(); continue; }
    body = body.replace(/^\s+/, '');
    lines.push(body);
  }
  prog.lines = lines.map((l) => l.replace(/\s+$/, ''));

  // /POS: P[n:"cmt"]{ ... };
  for (const m of sec('POS').matchAll(/P\[(\d+)(?::"([^"]*)")?\]\s*\{([\s\S]*?)\};/g)) {
    const n = +m[1];
    const p = parsePos(m[3], warnings, n);
    if (p) { if (m[2]) p.cmt = m[2]; prog.pos[n] = p; }
  }

  prog.lines.forEach((l, i) => {
    const r = parseLine(l);
    if (r.error) warnings.push(`${name} line ${i + 1}: ${r.error} (${l})`);
  });
  for (const l of prog.lines) for (const m of l.matchAll(/(?<![A-Z])P\[(\d+)/g)) {
    if (!prog.pos[+m[1]]) { warnings.push(`${name}: P[${m[1]}] is used but has no position (record it before running)`); break; }
  }
  prog.modified = Date.now();
  return { prog, warnings };
}
