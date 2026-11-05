// Import CAD files (STL, OBJ, GLB) as cell objects or tooling bodies.
import * as THREE from 'three';
import { CellState } from '../state';
import { CellObject, MeshFormat, newId, guessUnit, UNIT_MM, ObjRole, ROLE_COLOR } from './objects';
import { putMesh } from './meshStore';
import { parseMesh } from '../scene/cellScene';

export const CAD_ACCEPT = '.stl,.obj,.glb';

export function formatOf(name: string): MeshFormat | null {
  const ext = name.toLowerCase().split('.').pop();
  return ext === 'stl' || ext === 'obj' || ext === 'glb' ? ext : null;
}

export interface ImportTarget { role: ObjRole; tool?: number }

export async function importCad(s: CellState, file: File, target: ImportTarget): Promise<CellObject | null> {
  const format = formatOf(file.name);
  if (!format) {
    const ext = file.name.split('.').pop()?.toUpperCase();
    if (ext === 'LS') { s.message('warn', `${file.name} is a robot program: load it with TP files in the top bar.`); return null; }
    s.message('warn', `${file.name}: ${ext} files are not supported. Export STL (mm) from your CAD program, e.g. SolidWorks File > Save As > STL, or use OBJ / GLB.`);
    return null;
  }
  if (file.size > 60e6) { s.message('warn', `${file.name} is ${(file.size / 1e6).toFixed(0)} MB. Reduce the mesh resolution and export again (under 60 MB).`); return null; }
  const data = await file.arrayBuffer();
  let obj3d: THREE.Object3D;
  try { obj3d = await parseMesh(data, format); }
  catch (e) { s.message('alarm', `${file.name}: could not read the file (${e instanceof Error ? e.message : e})`); return null; }
  const box = new THREE.Box3().setFromObject(obj3d);
  const size = new THREE.Vector3(); box.getSize(size);
  const unit = guessUnit(Math.max(size.x, size.y, size.z), format);
  const k = UNIT_MM[unit];
  const id = newId('m');
  await putMesh(id, data);
  const name = file.name.replace(/\.[^.]+$/, '').slice(0, 40);
  const onFloor = -s.model.baseZ - box.min.z * k;
  const o: CellObject = {
    id: newId(), name, kind: 'mesh', role: target.role, tool: target.role === 'tool' ? target.tool ?? s.utool : undefined,
    size: [size.x * k, size.y * k, size.z * k], color: target.role === 'tool' ? '#8a96a3' : ROLE_COLOR[target.role],
    pose: target.role === 'tool' ? { x: 0, y: 0, z: 0, w: 0, p: 0, r: 0 } : { x: 450, y: 0, z: onFloor, w: 0, p: 0, r: 0 },
    mesh: { id, file: file.name, unit, format },
  };
  if (o.role === 'tool' && s.active) o.robot = s.active;
  s.objects.push(o);
  s.selectedObj = o.id;
  s.message('info', `Imported ${file.name} (${(size.x * k).toFixed(0)} x ${(size.y * k).toFixed(0)} x ${(size.z * k).toFixed(0)} mm, units ${unit}${unit === 'm' && format !== 'glb' ? ', guessed from the size' : ''})`);
  s.emit();
  return o;
}
