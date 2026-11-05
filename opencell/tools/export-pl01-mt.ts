// Writes the PL-01 rail robot (machine tender) programs as .LS files plus its taught PR values.
// Run: npx vite-node tools/export-pl01-mt.ts <outDir>
import { writeFileSync, mkdirSync } from 'node:fs';
import { pl01Robots, MT_R, MT_PR } from '../src/labs/pl01';
import { toLS } from '../src/tp/ls';

const out = process.argv[2] ?? 'pl01-mt';
mkdirSync(out, { recursive: true });
const mt = pl01Robots()[1];
const when = new Date(2026, 10, 5, 12, 0, 0);
for (const p of Object.values(mt.programs)) writeFileSync(`${out}/${p.name}.LS`, toLS(p, when));

const f = (n: number) => n.toFixed(1).padStart(8);
const rows: string[] = ['Taught position registers (UFRAME 0, UTOOL 1):'];
for (const [i, cmt] of Object.entries(MT_PR)) {
  const v = mt.PR[+i].v;
  if (!v) { rows.push(`  PR[${i}:${cmt}]  (set by MTINIT / calculated)`); continue; }
  const e = v.ext?.[0] !== undefined ? `  E1 ${f(v.ext[0])}` : '';
  if (v.cart) { const p = v.cart.pose; rows.push(`  PR[${i}:${cmt}]  X ${f(p.x)} Y ${f(p.y)} Z ${f(p.z)} W ${f(p.w)} P ${f(p.p)} R ${f(p.r)}${e}`); }
  else rows.push(`  PR[${i}:${cmt}]  JPOS ${v.joint!.map((q, j) => `J${j + 1} ${f(q)}`).join(' ')}${e}`);
}
rows.push('', 'Registers:');
for (const [i, [cmt, v]] of Object.entries(MT_R)) rows.push(`  R[${i}:${cmt}]${v !== undefined ? ` = ${v}` : ''}`);
writeFileSync(`${out}/REGISTERS.txt`, rows.join('\n') + '\n');
console.log(Object.keys(mt.programs).join(' '));
