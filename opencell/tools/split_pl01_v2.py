# PL-01 v2: like split_pl01.py, but takes out what OpenCell animates (2 robots, robot carriage, people,
# forklift, VMC doors, wrapper turntable / film carriage, loads and pallets on the pallet lines, cases on the conveyors).
# The forklift is kept as two meshes (body, fork carriage) in its own frame: fork heel centre on the floor, forks along +X.
# Run in a folder with cid.npy / mn.npy / mx.npy from the connected-component step: python3 split_pl01_v2.py layout.stl
import numpy as np, sys, gzip, base64, json, struct
d = open(sys.argv[1], 'rb').read()
rec = np.frombuffer(d[84:], dtype=np.dtype([('n', '<3f4'), ('v', '<9f4'), ('a', '<u2')]))
cid = np.load('cid.npy'); mn = np.load('mn.npy'); mx = np.load('mx.npy')
n = len(mn); s = np.round(mx - mn).astype(int)
xy = np.sort(s[:, :2], 1); z = s[:, 2]

def inside(x0, x1, y0, y1, z0=-1e9, z1=1e9):
    return (mn[:, 0] >= x0) & (mx[:, 0] <= x1) & (mn[:, 1] >= y0) & (mx[:, 1] <= y1) & (mn[:, 2] >= z0) & (mx[:, 2] <= z1)

drop = np.zeros(n, bool)
# 1 palletizing robot (keep the pedestal and the conveyor end under the old gripper)
pal = inside(33700, 35300, 10950, 14100, 400) & ~((mn[:, 1] >= 13075) & (mx[:, 2] <= 925))
drop |= pal
# 2 track robot + carriage (keep the VMC door handles), door handles of all three VMCs, the doors
drop |= inside(5900, 7700, 20600, 21800, 340)
drop |= inside(0, 13000, 21800, 21860, 1100, 1600) & (s[:, 0] <= 40)
for i in (170, 382, 582, 426, 427): drop[i] = True
# 3 people (head + hard hat mark each figure)
heads = [(3000, 5550), (12000, 18750), (15000, 21300), (23200, 23900), (28200, 23900), (29150, 10350)]
for hx, hy in heads:
    drop |= inside(hx - 360, hx + 360, hy - 360, hy + 360, -1, 1745) & (xy[:, 1] <= 450) & (mx[:, 2] > 30)
# 4 forklift
fork = inside(27600, 31400, 1150, 2450) & (mx[:, 2] > 30)
lift = np.zeros(n, bool)
for i in (2458, 2459, 2428, 2432, 2431, 2445, 2436, 2437, 2438, 2439, 2440, 2441, 2442, 2443, 2446, 2444): lift[i] = True
drop |= fork
# 5 wrapper: turntable, pallet + load on it, film carriage
drop |= inside(22600, 24400, 4400, 6200) & (mx[:, 2] > 30)
for i in (1471, 1466, 1462, 1463, 1509, 1532): drop[i] = True
# 6 pallets and loads on the pallet lines (the dispensers keep their stacks)
drop |= (inside(31980, 33020, 3600, 12300, 515) | inside(35980, 37020, 3600, 12300, 515))
# 7 cases on the conveyors (+ their tape), keep the one on the bench
case = (abs(xy[:, 0] - 400) <= 5) & (abs(xy[:, 1] - 600) <= 5) & (abs(z - 400) <= 5)
for i in np.where(case)[0]:
    if i == 1464: continue
    drop[i] = True
    drop |= inside(mn[i, 0] - 5, mx[i, 0] + 5, mn[i, 1] - 5, mx[i, 1] + 5, mx[i, 2] - 30, mx[i, 2] + 5)
print('dropped components', drop.sum(), 'robot1', pal.sum(), 'forklift', fork.sum())

cat = np.full(n, 'equipment', dtype=object)
cat[(mx[:, 2] <= 25)] = 'markings'
cat[(mx[:, 2] <= 0)] = 'floor'
fence = ((xy[:, 0] <= 6) & (xy[:, 1] <= 6) & (z > 1800) & (z < 2300)) | ((xy[:, 0] <= 60) & (xy[:, 1] <= 60) & (z >= 2150) & (z <= 2250))
cat[fence] = 'fence'
roll = ((xy[:, 0] == 50) & (xy[:, 1] == 50) & (z == 600)) | ((xy[:, 0] == 12) & (xy[:, 1] == 12) & (z == 616)) | ((xy[:, 0] == 50) & (xy[:, 1] == 600) & (z == 50)) | ((xy[:, 0] == 12) & (xy[:, 1] == 616) & (z == 12))
cat[roll] = 'rollers'
cat[(xy[:, 0] == 400) & (xy[:, 1] == 480) & ((z == 240) | (z == 200))] = 'bins'
cat[case] = 'cases'
pal = ((xy[:, 0] == 100) & (xy[:, 1] == 1016) & (z == 16)) | ((xy[:, 0] == 100) & (xy[:, 1] == 1219) & (z == 16))
cat[pal] = 'pallets'
cat[fork & ~lift] = 'forklift_body'
cat[fork & lift] = 'forklift_lift'
cat[drop & ~fork] = 'drop'
tc = cat[cid]
origin = np.array([30200, 1800, 0], np.float32)
out = {}
for k in sorted(set(cat)):
    if k == 'drop': continue
    r = rec[tc == k].copy()
    if not len(r): continue
    if k.startswith('forklift'):
        v = r['v'].reshape(-1, 3, 3) - origin
        r['v'] = v.reshape(-1, 9)
    b = b'OpenCell PL-01 ' + k.encode(); b = b.ljust(80, b' ') + struct.pack('<I', len(r)) + r.tobytes()
    open(f'out/pl01_{k}.stl', 'wb').write(b)
    out[k] = base64.b64encode(gzip.compress(b, 9)).decode()
    print(k, (cat == k).sum(), len(r), len(out[k]))
json.dump(out, open('out/meshes.json', 'w'))
