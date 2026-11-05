"""Add the same Content-Security-Policy to every public page (run after each build).
It limits where a page may send data (connect-src) and load code from, so an injected script
could not ship sign-in tokens or projects to a stranger's server."""
import pathlib, re
CSP = ("default-src 'self'; script-src 'self' 'unsafe-inline' blob: https://cdn.jsdelivr.net; worker-src 'self' blob:; "
       "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; "
       "img-src 'self' data: blob:; connect-src 'self' data: blob: https://*.supabase.co wss://*.supabase.co "
       "ws://localhost:* ws://127.0.0.1:* http://localhost:* http://127.0.0.1:*; frame-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'")
META = f'<meta http-equiv="Content-Security-Policy" content="{CSP}">'
root = pathlib.Path(__file__).resolve().parents[2]
for rel in ['index.html', 'openrung/index.html', 'openpanel/index.html', 'workbench/index.html', 'workbench/cell.html', 'workbench/panel.html', 'workbench/plc.html']:
    p = root / rel; s = p.read_text()
    s = re.sub(r'<meta http-equiv="Content-Security-Policy"[^>]*>\n?', '', s)
    m = re.search(r'<meta charset="utf-8">\n?', s, re.I)
    s = s[:m.end()] + META + '\n' + s[m.end():] if m else s.replace('<head>', '<head>\n' + META, 1)
    p.write_text(s); print('csp ->', rel)
