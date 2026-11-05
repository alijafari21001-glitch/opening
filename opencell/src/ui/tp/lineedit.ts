// Item-level editing of one TP line, the way the pendant does it: the cursor sits on an item
// (an index, a value, a keyword choice) and the user types a number or picks from a choice list.
import { parseLine, Tok, Role, SPEED_UNITS, OUT_PORTS, RefPort } from '../../tp/parser';

export type ItemKind = 'num' | 'choice' | 'text';
export interface Item {
  kind: ItemKind; role: Role; tok: Tok;
  hs: number; he: number;        // highlight span
  rs: number; re: number;        // span replaced by a typed number
  numeric: boolean;              // typing digits edits it
}

const ARITH = ['+', '-', '*', '/', 'DIV', 'MOD'];
const CHOICE_ROLES: Role[] = ['motype', 'unit', 'term', 'cmp', 'logic', 'dir', 'timer', 'option', 'ioval', 'prog', 'target'];

export function itemsOf(line: string): Item[] {
  const { toks } = parseLine(line);
  const items: Item[] = [];
  for (const t of toks) {
    const r = t.role;
    if (!r || r === 'kw') continue;
    if (r === 'op' && !ARITH.includes(t.v.toUpperCase())) continue;
    if (r === 'text') {
      if (t.k === 'ref') items.push({ kind: 'text', role: r, tok: t, hs: t.is!, he: t.ie!, rs: t.is!, re: t.ie!, numeric: false });
      else items.push({ kind: 'text', role: r, tok: t, hs: t.s, he: t.e, rs: t.s, re: t.e, numeric: false });
      continue;
    }
    if (t.k === 'ref') {
      const hasIdx = t.is !== undefined;
      const choice = r === 'value' || r === 'target' || (r === 'index' && isPortName(t.name!));
      items.push({ kind: choice ? 'choice' : 'num', role: r, tok: t, hs: t.s, he: t.e, rs: hasIdx ? t.is! : t.s, re: hasIdx ? t.ie! : t.e, numeric: hasIdx });
      continue;
    }
    if (t.k === 'num' || t.k === 'ph') {
      const choice = r === 'value' || r === 'prog' || r === 'target';
      items.push({ kind: choice ? 'choice' : 'num', role: r, tok: t, hs: t.s, he: t.e, rs: t.s, re: t.e, numeric: r !== 'prog' && r !== 'target' });
      continue;
    }
    if (CHOICE_ROLES.includes(r) || r === 'op' || r === 'value') {
      items.push({ kind: 'choice', role: r, tok: t, hs: t.s, he: t.e, rs: t.s, re: t.e, numeric: false });
    }
  }
  return items;
}

function isPortName(n: string) { return ['DI', 'DO', 'RI', 'RO', 'UI', 'UO', 'SI', 'SO', 'GI', 'GO', 'F', 'AI', 'AO'].includes(n); }

export const replace = (line: string, s: number, e: number, rep: string) => line.slice(0, s) + rep + line.slice(e);

export function fmtNum(v: number) { return Number.isInteger(v) ? String(v) : String(+v.toFixed(3)); }

/** Apply a typed number to an item. */
export function applyNumber(line: string, it: Item, v: number): string {
  if (it.tok.k === 'ref' || ['index', 'target'].includes(it.role)) v = Math.max(0, Math.round(v));
  if (it.role === 'cnt') v = Math.max(0, Math.min(100, Math.round(v)));
  return replace(line, it.rs, it.re, fmtNum(v));
}

const OPERANDS: [string, string][] = [
  ['Constant', '...'], ['R[ ]', 'R[...]'], ['DI[ ]', 'DI[...]'], ['DO[ ]', 'DO[...]'], ['RI[ ]', 'RI[...]'], ['RO[ ]', 'RO[...]'],
  ['GI[ ]', 'GI[...]'], ['F[ ]', 'F[...]'], ['AR[ ]', 'AR[...]'], ['PR[i,j]', 'PR[...,...]'], ['TIMER[ ]', 'TIMER[...]'],
  ['ON', 'ON'], ['OFF', 'OFF'], ['PR[ ]', 'PR[...]'], ['P[ ]', 'P[...]'], ['LPOS', 'LPOS'], ['JPOS', 'JPOS'],
];

export interface Choice { label: string; apply: (line: string) => string; thenNumber?: boolean }

/** Choice list for an item (empty if the item has none). */
export function choicesFor(line: string, it: Item, programs: string[]): Choice[] {
  const t = it.tok;
  const rep = (v: string, s = it.hs, e = it.he) => (l: string) => replace(l, s, e, v);
  const toks = parseLine(line).toks;
  const ti = toks.indexOf(toks.find((x) => x.s === t.s)!);
  const nxt = toks[ti + 1];
  switch (it.role) {
    case 'motype': return ['J', 'L', 'C'].map((m) => ({ label: m, apply: (l) => changeMotion(l, m as 'J') }));
    case 'unit': {
      const type = toks.find((x) => x.role === 'motype')?.v.toUpperCase();
      const units = type === 'J' ? ['%', 'sec', 'msec'] : type ? SPEED_UNITS.filter((u) => u !== '%') : ['sec'];
      return units.map((u) => ({ label: u, apply: rep(u) }));
    }
    case 'term':
      if (t.v.toUpperCase() === 'FINE') return [{ label: 'FINE', apply: (l) => l }, { label: 'CNT', apply: rep('CNT100') }];
      return [{ label: 'FINE', apply: rep('FINE', t.s, nxt && nxt.role === 'cnt' ? nxt.e : t.e) }, { label: 'CNT', apply: (l) => l }];
    case 'cmp': return ['=', '<>', '<', '>', '<=', '>='].map((o) => ({ label: o, apply: rep(o) }));
    case 'logic': return ['AND', 'OR'].map((o) => ({ label: o, apply: rep(o) }));
    case 'dir': return ['TO', 'DOWNTO'].map((o) => ({ label: o, apply: rep(o) }));
    case 'timer': return ['START', 'STOP', 'RESET'].map((o) => ({ label: o, apply: rep(o) }));
    case 'op': return ARITH.map((o) => ({ label: o, apply: rep(o.length > 1 ? ` ${o} ` : o, it.hs, it.he) }));
    case 'prog': return programs.map((p) => ({ label: p, apply: rep(p) }));
    case 'target': return ['P', 'PR'].map((p) => ({ label: `${p}[ ]`, apply: rep(`${p}[${t.idx ?? '...'}]`) }));
    case 'option': {
      const m = /^(Offset|Tool_Offset)(\s*,\s*PR\[[^\]]*\])?/i.exec(line.slice(t.s));
      const end = t.s + (m ? m[0].length : t.v.length);
      const start = line.slice(0, t.s).trimEnd().length;
      return [
        { label: 'Offset,PR[ ]', apply: rep('Offset,PR[...]', t.s, end) },
        { label: 'Tool_Offset,PR[ ]', apply: rep('Tool_Offset,PR[...]', t.s, end) },
        { label: 'Offset (OFFSET CONDITION)', apply: rep('Offset', t.s, end) },
        { label: 'Delete option', apply: (l) => replace(l, start, end, '') },
      ];
    }
    case 'ioval': {
      const lhs = toks[0];
      const isOutAssign = lhs?.k === 'ref' && OUT_PORTS.includes(lhs.name as RefPort) && toks[1]?.v === '=' && ti === 2;
      const out: Choice[] = [{ label: 'ON', apply: rep('ON') }, { label: 'OFF', apply: rep('OFF') }];
      if (isOutAssign) out.push({ label: 'PULSE', apply: rep('PULSE') }, { label: 'R[ ]', apply: rep('R[...]') }, { label: 'DI[ ]', apply: rep('DI[...]') });
      return out;
    }
    case 'index': {
      if (t.k !== 'ref' || !isPortName(t.name!)) return [];
      const lhs = ti === 0;
      const ports = lhs ? ['DO', 'RO', 'GO', 'F', 'UO', 'SO'] : ['DI', 'DO', 'RI', 'RO', 'GI', 'GO', 'F', 'UI', 'UO'];
      return ports.map((p) => ({ label: `${p}[ ]`, apply: rep(`${p}[${t.idx ?? '...'}]`) }));
    }
    case 'value': {
      const out: Choice[] = OPERANDS.map(([label, v]) => ({ label, apply: rep(v), thenNumber: label === 'Constant' }));
      const last = !nxt || (nxt.k === 'op' && [',', ')'].includes(nxt.v)) || (nxt.k === 'ident' && ['TIMEOUT', 'THEN'].includes(nxt.v.toUpperCase())) || nxt.k === 'unit';
      if (last) for (const o of ARITH) out.push({ label: `${o} ...`, apply: (l) => replace(l, it.he, it.he, o.length > 1 ? ` ${o} ...` : `${o}...`) });
      return out;
    }
  }
  return [];
}

/** Switch a motion line between J, L and C, fixing the speed unit and the via point. */
export function changeMotion(line: string, to: 'J' | 'L' | 'C'): string {
  const r = parseLine(line);
  if (r.stmt.k !== 'motion') return line;
  const st = r.stmt;
  const from = st.type;
  if (from === to) return line;
  const toks = r.toks;
  const tgt = toks.filter((t) => t.role === 'target');
  const target = tgt[tgt.length - 1];
  const sp = toks.find((t) => t.role === 'speed')!;
  const unit = toks.find((t) => t.role === 'unit')!;
  const rest = line.slice(unit.e);
  let speed = line.slice(sp.s, unit.e);
  const val = typeof st.speed.v === 'number' ? st.speed.v : 100;
  if (to === 'J' && !['%', 'sec', 'msec'].includes(st.speed.unit)) speed = `${Math.min(100, Math.round(val))}%`;
  if (to !== 'J' && st.speed.unit === '%') speed = `${val}mm/sec`;
  const tgtText = line.slice(target.s, target.e);
  const pos = to === 'C' ? `${tgtText} : P[...]` : tgtText;
  return `${to} ${pos} ${speed}${rest}`;
}
