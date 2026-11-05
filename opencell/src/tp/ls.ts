// Export a program as a FANUC-style ASCII .LS file (loadable by controllers / simulators with the ASCII program loader).
import { TPProgram, TPPos, cfgText } from './program';

const f3 = (v: number) => v.toFixed(3).padStart(10);
const two = (n: number) => String(n).padStart(2, '0');

function stamp(d: Date) {
  return `DATE ${two(d.getFullYear() % 100)}-${two(d.getMonth() + 1)}-${two(d.getDate())}  TIME ${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`;
}

function posBlock(n: number, p: TPPos, cmt?: string) {
  const head = `P[${n}${cmt ? `:"${cmt}"` : ''}]{\n   GP1:\n`;
  const ext = p.ext?.length ? `,\n\t${p.ext.map((v, i) => `E${i + 1}= ${f3(v)}  mm`).join(',\t')}` : '';
  if (p.joint) {
    const j = p.joint.map((v) => f3(v));
    return `${head}\tUF : ${p.uf}, UT : ${p.ut},\t\n\tJ1= ${j[0]} deg,\tJ2= ${j[1]} deg,\tJ3= ${j[2]} deg,\n\tJ4= ${j[3]} deg,\tJ5= ${j[4]} deg,\tJ6= ${j[5]} deg${ext}\n};\n`;
  }
  const c = p.cart!;
  return `${head}\tUF : ${p.uf}, UT : ${p.ut},\t\tCONFIG : '${cfgText(c.cfg)}',\n` +
    `\tX = ${f3(c.pose.x)}  mm,\tY = ${f3(c.pose.y)}  mm,\tZ = ${f3(c.pose.z)}  mm,\n` +
    `\tW = ${f3(c.pose.w)} deg,\tP = ${f3(c.pose.p)} deg,\tR = ${f3(c.pose.r)} deg${ext}\n};\n`;
}

export function toLS(p: TPProgram, now = new Date(p.modified || Date.now())) {
  const cmt = new Map<number, string>();
  for (const l of p.lines) for (const m of l.matchAll(/(?<![A-Z])P\[(\d+):([^\]]*)\]/g)) if (!cmt.has(+m[1])) cmt.set(+m[1], m[2]);
  const mn = p.lines.map((l, i) => `${String(i + 1).padStart(4)}:  ${l} ;`).join('\n');
  const pos = Object.keys(p.pos).map(Number).sort((a, b) => a - b).map((n) => posBlock(n, p.pos[n], cmt.get(n))).join('');
  return `/PROG  ${p.name}
/ATTR
OWNER\t\t= MNEDITOR;
COMMENT\t\t= "${p.comment.slice(0, 16)}";
PROG_SIZE\t= 0;
CREATE\t\t= ${stamp(now)};
MODIFIED\t= ${stamp(now)};
FILE_NAME\t= ;
VERSION\t\t= 0;
LINE_COUNT\t= ${p.lines.length};
MEMORY_SIZE\t= 0;
PROTECT\t\t= READ_WRITE;
TCD:  STACK_SIZE\t= 0,
      TASK_PRIORITY\t= 50,
      TIME_SLICE\t= 0,
      BUSY_LAMP_OFF\t= 0,
      ABORT_REQUEST\t= 0,
      PAUSE_REQUEST\t= 0;
DEFAULT_GROUP\t= 1,*,*,*,*;
CONTROL_CODE\t= 00000000 00000000;
/MN
${mn}
/POS
${pos}/END
`.replace(/\n/g, '\r\n');
}
