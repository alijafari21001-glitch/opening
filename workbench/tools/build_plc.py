"""Build workbench/plc.html: the OpenRung app (repo root index.html) with the PL-01 project embedded.
Usage (from the repo root): python3 workbench/tools/build_plc.py workbench/PL01_Line.openrung.json"""
import sys, pathlib
root = pathlib.Path(__file__).resolve().parents[2]
src = (root / 'openrung' / 'index.html').read_text()
proj = pathlib.Path(sys.argv[1]).read_text() if len(sys.argv) > 1 else ''
tag = '<script type="application/json" id="startProject"></script>'
assert tag in src, 'startProject slot not found in index.html'
src = src.replace(tag, '<script type="application/json" id="startProject">' + proj.replace('</', '<\\/') + '</script>')
(root / 'workbench' / 'plc.html').write_text(src)
print('wrote workbench/plc.html')
