// Save text as a file. Inside the claude.ai artifact viewer this goes through its downloads capability
// (which only takes some extensions, so e.g. .LS becomes .LS.txt); elsewhere through a plain link.
type Saver = { save(r: { filename: string; data: string }): Promise<unknown> };
let saver: Promise<Saver | null> | null = null;
function getSaver() {
  const host = (window as unknown as { claude?: { use(n: string): Promise<Saver | null> } }).claude;
  if (!host) return Promise.resolve(null);
  return (saver ??= host.use('downloads').catch(() => null));
}
const ALLOWED = /\.(txt|json|md|csv|html)$/i;

export async function download(name: string, text: string, type = 'text/plain') {
  const s = await getSaver();
  if (s) {
    try { await s.save({ filename: ALLOWED.test(name) ? name : `${name}.txt`, data: text }); } catch { /* declined or unavailable */ }
    return;
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

/** Save binary data (e.g. a .zip). Returns false when the host refused this file type. */
export async function downloadBytes(name: string, bytes: Uint8Array, type = 'application/zip') {
  const blob = new Blob([bytes], { type });
  const s = await getSaver();
  if (s) {
    try { await (s as unknown as { save(r: { filename: string; data: Blob }): Promise<unknown> }).save({ filename: name, data: blob }); return true; }
    catch (e) { return (e as { code?: string })?.code === 'declined'; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  return true;
}
