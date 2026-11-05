# PL-01 v3 meshes: v2 with the old stretch wrapper (and its floor hatch) taken out; the sim draws the new one between the pallet lines.
# Run: python3 tools/pl01_v3.py cad/pl01/v2/meshes.json cad/pl01/v3/meshes.json
import sys, json, gzip, base64, struct, os
src, out = sys.argv[1:3]
m = json.load(open(src))
CUT = {'equipment': (22300, 25200, 4100, 6600), 'markings': (20900, 26300, 3800, 6700)}
for key, (x0, x1, y0, y1) in CUT.items():
    b = gzip.decompress(base64.b64decode(m[key]))
    n = struct.unpack('<I', b[80:84])[0]
    keep = []
    for i in range(n):
        o = 84 + 50 * i
        f = struct.unpack('<12f', b[o:o + 48])
        cx = (f[3] + f[6] + f[9]) / 3; cy = (f[4] + f[7] + f[10]) / 3
        if x0 <= cx <= x1 and y0 <= cy <= y1: continue
        keep.append(b[o:o + 50])
    nb = b[:80] + struct.pack('<I', len(keep)) + b''.join(keep)
    m[key] = base64.b64encode(gzip.compress(nb, 9)).decode()
    print(key, n, '->', len(keep))
os.makedirs(os.path.dirname(out), exist_ok=True)
json.dump(m, open(out, 'w'))
