// Stores imported CAD files (raw bytes) in IndexedDB so they survive a reload; falls back to memory only.
import { PRESET_MESHES } from './presetMeshes';

const DB = 'opencell-meshes', STORE = 'files';
const mem = new Map<string, ArrayBuffer>();

function open(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    try {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    } catch (e) { rej(e); }
  });
}

export async function putMesh(id: string, data: ArrayBuffer) {
  mem.set(id, data);
  try {
    const db = await open();
    await new Promise<void>((res, rej) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(data, id);
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
  } catch { /* storage unavailable: keep in memory for this session */ }
}

/** Meshes shipped with the page (gzip, base64): window.OPENCELL_MESHES = { id: b64 }. */
async function pageMesh(id: string): Promise<ArrayBuffer | undefined> {
  const b64 = (globalThis as { OPENCELL_MESHES?: Record<string, string> }).OPENCELL_MESHES?.[id];
  if (!b64) return undefined;
  const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return new Response(new Blob([bin]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
}

export async function getMesh(id: string): Promise<ArrayBuffer | undefined> {
  if (mem.has(id)) return mem.get(id);
  const shipped = await pageMesh(id);
  if (shipped) { mem.set(id, shipped); return shipped; }
  const pre = PRESET_MESHES[id];
  if (pre) {
    const bin = atob(pre.b64);
    const buf = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
    mem.set(id, buf.buffer);
    return buf.buffer;
  }
  try {
    const db = await open();
    const v = await new Promise<ArrayBuffer | undefined>((res, rej) => {
      const r = db.transaction(STORE).objectStore(STORE).get(id);
      r.onsuccess = () => res(r.result as ArrayBuffer | undefined);
      r.onerror = () => rej(r.error);
    });
    if (v) mem.set(id, v);
    return v;
  } catch { return undefined; }
}

export async function deleteMesh(id: string) {
  if (id.startsWith('preset:') || id.startsWith('page:')) return;
  mem.delete(id);
  try {
    const db = await open();
    db.transaction(STORE, 'readwrite').objectStore(STORE).delete(id);
  } catch { /* ignore */ }
}
