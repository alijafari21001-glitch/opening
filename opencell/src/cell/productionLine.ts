// PL-01: Ali's production line layout (Onshape export, mm), split by tools/split_pl01_v2.py into colored meshes.
// The meshes ship with the page (window.OPENCELL_MESHES, ids 'page:pl01-*'). What moves (robots, people, forklift,
// cases, pallets, VMC doors, wrapper) is taken out of the static meshes and animated by src/sim/pl01.ts.
import { CellObject, newId } from './objects';

/** Layout point placed at the cell origin (layout coordinates are mm from the slab corner). */
export const PL01_ORIGIN = { x: 20000, y: 12500 };

/** Groups and colors (gray floor, yellow tape, dark fence, silver rollers, blue bins, cardboard cases, wood pallets). */
export const PL01_PARTS: [key: string, name: string, color: string, opacity?: number][] = [
  ['equipment', 'Machines and equipment', '#a9b1ba'],
  ['floor', 'Floor slab', '#c9cbc7'],
  ['markings', 'Floor tape', '#e2b714'],
  ['fence', 'Safety fence', '#2b2f33', 0.85],
  ['rollers', 'Conveyor rollers', '#d3d7db'],
  ['bins', 'Stacking bins', '#2f6db5'],
  ['cases', 'Shipping cases', '#c49a6c'],
  ['pallets', 'Pallets', '#b08a5a'],
];

export function productionLine(): CellObject[] {
  const root = { x: -PL01_ORIGIN.x, y: -PL01_ORIGIN.y, z: 0, w: 0, p: 0, r: 0 };
  const [first, ...rest] = PL01_PARTS;
  const mk = ([key, name, color, opacity]: typeof first, parent?: string): CellObject => ({
    id: newId(), name, kind: 'mesh', role: 'machine', size: [40000, 25000, 3390], color, opacity, collide: false,
    pose: parent ? { x: 0, y: 0, z: 0, w: 0, p: 0, r: 0 } : root, parent,
    mesh: { id: `page:pl01-${key}`, file: `pl01_${key}.stl`, unit: 'mm', format: 'stl' },
  });
  const top = { ...mk(first), name: 'PL-01 Production Line' };
  return [top, ...rest.map((p) => mk(p, top.id))];
}
