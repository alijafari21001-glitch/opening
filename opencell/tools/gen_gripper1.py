"""Generates "Gripper 1" STL files (mm) from parametric shapes.

Based on Gripper_1_Test.stl (round body with two jaws, 150 x 200 mm, in metres), rescaled for an
LR Mate class robot and split into a body and two moving fingers.
Usage: python3 tools/gen_gripper1.py OUT_DIR
"""
import math, struct, sys, os
import numpy as np

def circle(r, n=48):
    return [(r * math.cos(2 * math.pi * i / n), r * math.sin(2 * math.pi * i / n)) for i in range(n)]

def rect(hx, hy):
    return [(-hx, -hy), (hx, -hy), (hx, hy), (-hx, hy)]

def loft(rings):
    """rings: list of (polygon CCW, z). Same vertex count. Returns triangles (closed solid)."""
    tris = []
    for (pa, za), (pb, zb) in zip(rings, rings[1:]):
        n = len(pa)
        for i in range(n):
            j = (i + 1) % n
            a0, a1 = (*pa[i], za), (*pa[j], za)
            b0, b1 = (*pb[i], zb), (*pb[j], zb)
            tris += [(a0, a1, b1), (a0, b1, b0)]
    for (poly, z), top in ((rings[0], False), (rings[-1], True)):
        c = (sum(p[0] for p in poly) / len(poly), sum(p[1] for p in poly) / len(poly), z)
        n = len(poly)
        for i in range(n):
            j = (i + 1) % n
            a, b = (*poly[i], z), (*poly[j], z)
            tris.append((c, a, b) if top else (c, b, a))
    return tris

def prism(shape, z0, z1, ch=0.0):
    """Extrude a circle (('c', r)) or rectangle (('r', hx, hy)) with an optional chamfer on both ends."""
    def at(off):
        return circle(shape[1] - off) if shape[0] == 'c' else rect(shape[1] - off, shape[2] - off)
    if ch <= 0:
        return loft([(at(0), z0), (at(0), z1)])
    return loft([(at(ch), z0), (at(0), z0 + ch), (at(0), z1 - ch), (at(ch), z1)])

def move(tris, dx=0, dy=0, dz=0, R=None):
    out = []
    for t in tris:
        tt = []
        for p in t:
            v = np.array(p, float)
            if R is not None:
                v = R @ v
            tt.append((v[0] + dx, v[1] + dy, v[2] + dz))
        out.append(tuple(tt))
    return out

ROT_X90 = np.array([[1, 0, 0], [0, 0, -1], [0, 1, 0]], float)   # +Z -> -Y

def write_stl(path, tris, name):
    with open(path, 'wb') as f:
        f.write(name.encode()[:80].ljust(80, b' '))
        f.write(struct.pack('<I', len(tris)))
        for a, b, c in tris:
            a, b, c = map(np.array, (a, b, c))
            nrm = np.cross(b - a, c - a)
            l = np.linalg.norm(nrm)
            nrm = nrm / l if l > 0 else nrm
            f.write(struct.pack('<12fH', *nrm, *a, *b, *c, 0))

# ---- dimensions (mm); z = 0 is the robot faceplate
ADAPTER = (0, 10)       # ISO-flange adapter plate, d63
BODY = (10, 60)         # main round body d80 (the original design's cylinder)
RAIL = (60, 68)         # jaw guide rail
FINGER_OPEN_X = 35      # finger centre when open (inner pad gap 56 mm)
CARRIER_H, BLADE_H = 14, 48

def body():
    t = prism(('c', 31.5), *ADAPTER, 1.0)
    t += prism(('c', 40), *BODY, 2.0)
    t += prism(('r', 36, 10), *RAIL, 1.0)
    for k in range(4):                       # cap screws on the top face
        a = math.radians(45 + 90 * k)
        t += move(prism(('c', 4), 0, 4, 0.6), 30 * math.cos(a), 30 * math.sin(a), BODY[1])
    for dx in (-10, 10):                     # air ports (open / close) on the -Y side
        t += move(prism(('c', 4), 0, 9, 0.8), dx, -39, 35, ROT_X90)
    return t

def finger(side):
    """side = -1 (left, -X) or +1 (right, +X). Local origin: carrier bottom centre."""
    t = prism(('r', 9, 12), 0, CARRIER_H, 1.0)
    t += prism(('r', 5, 11), CARRIER_H, CARRIER_H + BLADE_H, 1.5)
    # grip pad on the inner face near the tip
    t += move(prism(('r', 1.2, 9), CARRIER_H + 22, CARRIER_H + BLADE_H - 2, 0.4), -side * 6.2, 0, 0)
    return t

if __name__ == '__main__':
    out = sys.argv[1] if len(sys.argv) > 1 else '.'
    os.makedirs(out, exist_ok=True)
    b, fl, fr = body(), finger(-1), finger(1)
    write_stl(f'{out}/gripper1_body.stl', b, 'OpenCell Gripper 1 body (mm)')
    write_stl(f'{out}/gripper1_finger_left.stl', fl, 'OpenCell Gripper 1 finger L (mm)')
    write_stl(f'{out}/gripper1_finger_right.stl', fr, 'OpenCell Gripper 1 finger R (mm)')
    asm = b + move(fl, -FINGER_OPEN_X, 0, RAIL[1]) + move(fr, FINGER_OPEN_X, 0, RAIL[1])
    write_stl(f'{out}/Gripper_1_v2_assembly.stl', asm, 'OpenCell Gripper 1 assembly, open (mm)')
    tip = RAIL[1] + CARRIER_H + BLADE_H
    print('triangles', len(b), len(fl), len(asm), 'tip z', tip, 'pad centre z', RAIL[1] + CARRIER_H + 22 + (BLADE_H - 24) / 2)
