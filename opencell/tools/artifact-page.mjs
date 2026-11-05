// Turns the single-file build into a body-only page (for hosts that supply their own <html>/<head> skeleton).
import { readFileSync, writeFileSync } from 'node:fs';
const [, , src, out] = process.argv;
let h = readFileSync(src, 'utf8');
h = h.replace(/<!doctype html>/i, '').replace(/<\/?html[^>]*>/gi, '').replace(/<\/?head>/gi, '').replace(/<\/?body>/gi, '')
  .replace(/<meta charset="[^"]*"\s*\/?>/i, '').replace(/<meta name="viewport"[^>]*>/i, '');
writeFileSync(out, h.trim() + '\n');
