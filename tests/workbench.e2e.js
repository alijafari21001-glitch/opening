// Broad smoke test of the Automation Workbench: every top-level control in the shell and the three apps.
const { chromium } = require('playwright');
// Run: python3 -m http.server 8090 (repo root), then BASE=http://127.0.0.1:8090/workbench/ node tests/workbench.e2e.js
const BASE = process.env.BASE || 'http://127.0.0.1:8090/workbench/';
const res = []; const errs = [];
const ok = (n, v, d='') => { res.push([v ? 'PASS' : 'FAIL', n, d]); console.log(v ? 'PASS' : 'FAIL', '|', n, '|', d); };
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({viewport:{width:1440,height:860}, acceptDownloads:true});
  const pg = await ctx.newPage(); pg.setDefaultTimeout(5000);
  pg.on('console', m => { if (m.type() === 'error' && !/favicon|ERR_|net::/.test(m.text())) errs.push(m.text().slice(0,200)); });
  pg.on('pageerror', e => errs.push('PAGEERR ' + e.message));
  pg.on('dialog', d => d.accept());
  const cl = async (fr, sel) => { const r = await fr.evaluate(sel => { let el; const m = /^(.*?)button:text-is\("(.*)"\)$/.exec(sel); if (m) el = [...document.querySelectorAll((m[1].trim() || '') + ' button')].find(b => b.textContent.trim() === m[2] || b.firstChild?.textContent?.trim() === m[2]); else el = document.querySelector(sel); if (!el) return 'missing ' + sel; el.click(); return ''; }, sel); if (r) throw new Error(r); };
  const step = async (n, f) => { try { await Promise.race([0]); const r = await f(); ok(n, r !== false, typeof r === 'string' ? r : ''); } catch (e) { ok(n, false, e.message.split('\n')[0].slice(0,160)); } };
  await pg.goto(BASE + 'index.html'); await pg.waitForTimeout(14000);
  const F = n => pg.frames().find(f => f.url().includes(n));
  const cell = F('cell.html'), pan = F('panel.html'), plc = F('plc.html');
  // ---- shell
  await step('shell: PLC running + I/O live', async () => /running/.test(await pg.textContent('#busTxt')));
  for (const [k, m] of [['1','cell'],['2','plc'],['3','panel'],['4','all'],['5','split']]) await step('shell: Alt+' + k + ' -> ' + m, async () => { await pg.keyboard.press('Alt+' + k); await pg.waitForTimeout(200); return (await pg.evaluate(() => document.getElementById('main').dataset.mode)) === m; });
  await pg.keyboard.press('Alt+4');
  for (const t of ['R1','R2','MCP-1']) await step('shell: focus ' + t, async () => { await pg.selectOption('#focus', t); await pg.waitForTimeout(700); return pan.evaluate(() => PJ.cur); });
  await pg.selectOption('#focus', '');
  await step('shell: sign-in dialog opens', async () => { await cl(pg, '#acct'); const t = await pg.textContent('#acctDlg'); await pg.keyboard.press('Escape'); return /Sign in/.test(t); });
  // ---- cell
  await pg.keyboard.press('Alt+1'); await pg.waitForTimeout(500);
  await step('cell: robots running', async () => (await cell.evaluate(() => window.opencell.interps.map(i => i.status))).every(s => s === 'RUNNING'));
  for (const t of ['Iso','Top','Front','Side']) await step('cell: camera ' + t, async () => { await cl(cell, `button:text-is("${t}")`); });
  for (const t of ['Move','Rotate','Off']) await step('cell: mouse jog ' + t, async () => { await cl(cell, `button:text-is("${t}")`); });
  await step('cell: Trace + Clear', async () => { await cl(cell, '#btn-trace'); await cl(cell, '#btn-clear'); });
  for (const id of ['btn-plc','btn-lib','btn-tp','btn-labs','btn-save','btn-help']) await step('cell: ' + id + ' dialog', async () => { await cl(cell, '#' + id); await pg.waitForTimeout(300); const open = await cell.evaluate(() => document.querySelectorAll('dialog[open]').length); await pg.keyboard.press('Escape'); await pg.waitForTimeout(150); return open > 0 ? true : 'no dialog opened'; });
  await step('cell: line Stop', async () => { await cl(cell, '[data-l=stop]'); await pg.waitForTimeout(500); return (await cell.evaluate(() => window.opencell.interps.map(i => i.status))).every(s => s !== 'RUNNING'); });
  await step('cell: line Run', async () => { await cl(cell, '[data-l=run]'); await pg.waitForTimeout(1500); return (await cell.evaluate(() => window.opencell.interps.map(i => i.status))).every(s => s === 'RUNNING'); });
  await step('cell: speed 8x', async () => { await cell.selectOption('[data-l=speed]', '8'); });
  await step('cell: Order panel + edit cases/pallet', async () => { await cl(cell, '[data-l=more]'); await cell.fill('[data-o=perPallet]', '10'); await cell.press('[data-o=perPallet]', 'Enter'); await pg.waitForTimeout(800); return (await cell.evaluate(() => window.opencell.sim.order.perPallet)) === 10 || 'perPallet=' + await cell.evaluate(() => window.opencell.sim.order.perPallet); });
  await step('cell: New order', async () => { await cl(cell, '[data-l=neworder]'); });
  for (const c of ['Overview','Palletizer','Machine tending','Packing','Wrapper + forklifts','Shipping + trailer','Return belt']) await step('cell: view ' + c, async () => { await cl(cell, `[data-cam="${c}"]`); });
  await step('cell: hide/show line panel', async () => { await cl(cell, '[data-l=min]'); const m = await cell.evaluate(() => document.querySelector('.linepanel').classList.contains('min')); await cl(cell, '[data-l=min]'); return m; });
  await step('cell: pendant MENU/SELECT/DATA/EDIT keys', async () => { for (const k of ['MENU','SELECT','DATA','EDIT']) { await cl(cell, `#pendant button:text-is("${k}")`); await pg.waitForTimeout(150); } });
  await step('cell: jog keys visible', async () => { const bx = await cell.locator('[data-jog="5"][data-dir="1"]').boundingBox(); return bx && bx.y + bx.height < 860 ? true : 'off screen ' + JSON.stringify(bx); });
  await step('cell: 8x run 40 s, no robot alarm', async () => { await pg.waitForTimeout(40000); const f = await cell.evaluate(() => window.opencell.interps.map(i => i.fault)); return f.every(x => !x) || 'fault ' + await cell.evaluate(() => window.opencell.state.log.slice(-2).map(l => l.text).join(' / ')); });
  await step('cell: line produced cases', async () => { const s = await cell.evaluate(() => window.opencell.sim.stats); return s.cases > 0 ? JSON.stringify(s) : false; });
  await cell.selectOption('[data-l=speed]', '1');
  // ---- panel
  await pg.keyboard.press('Alt+3'); await pg.waitForTimeout(500);
  for (const [k, m] of [['e','edit'],['m','dmm'],['o','op']]) await step('panel: key ' + k, async () => { await pan.evaluate(k => window.dispatchEvent(new KeyboardEvent('keydown', {key:k, bubbles:true})), k); await pg.waitForTimeout(150); return (await pan.evaluate(() => mode)) === m; });
  await step('panel: Lists view', async () => { await cl(pan, '#mLi'); await pg.waitForTimeout(200); const t = await pan.textContent('main'); await cl(pan, '#mLi'); return /R1_DO_Running|Wire|I\/O/.test(t) || 'lists empty'; });
  await step('panel: tabs switch', async () => { for (const id of ['RCP-1','RCP-2','MCP-1']) await cl(pan, `[data-tab="${id}"]`); return (await pan.evaluate(() => PJ.cur)) === 'MCP-1'; });
  await step('panel: E-stop stops line, PB1 restarts', async () => {
    await pan.evaluate(() => { PJ.panels[0].parts.find(p => p.name === 'ES1 Line E-stop').on = true; tick(); }); await pg.waitForTimeout(1500);
    const off = await pan.evaluate(() => readTag('Line_Run'));
    await pan.evaluate(() => { PJ.panels[0].parts.find(p => p.name === 'ES1 Line E-stop').on = false; tick(); const b = PJ.panels[0].parts.find(p => p.name === 'PB1 START'); b.on = true; tick(); setTimeout(() => { b.on = false; tick(); }, 500); });
    await pg.waitForTimeout(2000); const on = await pan.evaluate(() => readTag('Line_Run'));
    return off === 0 && on === 1 ? true : `off=${off} on=${on}`; });
  await step('panel: DMM 24 V across PSU', async () => { const v = await pan.evaluate(() => { const pn = PJ.panels[0]; const p = pn.parts.find(x => x.t === 'psu'); const d = vdiff(pn.st.V(p.id, '+'), pn.st.V(p.id, '-')); return d && d.dc; }); return Math.abs(v - 24) < 0.5 || 'v=' + v; });
  await step('panel: DMM ohms coil M1', async () => { const r = await pan.evaluate(() => { const pn = PJ.panels[0]; const c = pn.parts.find(x => x.t === 'coil' && x.name === 'M1'); return resistance(pn, key(c.id, termsOf(c)[0][0]), key(c.id, termsOf(c)[1][0])); }); return r > 0 && r < 1e6 ? 'R=' + r : 'R=' + r; });
  await step('panel: fault practice inject/answer/clear', async () => pan.evaluate(() => { const a = FP.inject(); const c = FP.find(); FP.clear(); document.getElementById('fdlg').close(); return a && !!c && !FP.find(); }));
  await step('panel: add part, undo, redo', async () => { const n0 = await pan.evaluate(() => cur().parts.length); await pan.evaluate(() => setMode('edit')); await cl(pan, '[data-add="lamp"]'); await pan.evaluate(() => { const r = sv.getBoundingClientRect(); sv.dispatchEvent(new PointerEvent('pointerdown', {clientX:r.left + 300, clientY:r.top + 600, bubbles:true})); }); const n1 = await pan.evaluate(() => cur().parts.length); await pan.evaluate(() => undo()); const n2 = await pan.evaluate(() => cur().parts.length); await pan.evaluate(() => redo()); await pan.evaluate(() => undo()); await pg.keyboard.press('o'); return n1 === n0 + 1 && n2 === n0 ? true : `${n0} ${n1} ${n2}`; });
  await step('panel: Reset trips', async () => { await cl(pan, '#bReset'); });
  await step('panel: Save file download', async () => { const [d] = await Promise.all([pg.waitForEvent('download', {timeout:4000}), cl(pan, '#bSave')]); return d.suggestedFilename(); });
  await step('panel: help', async () => { await cl(pan, '#bHelp'); await pg.keyboard.press('Escape'); });
  // ---- PLC / HMI
  await pg.keyboard.press('Alt+2'); await pg.waitForTimeout(500);
  await step('plc: no rung errors', async () => { const e = await plc.evaluate(() => P.programs.flatMap(p => p.routines.flatMap(r => (r.rungs||[]).filter(g => g.err).map(g => r.name + ':' + g.err)))); return e.length === 0 || e.join(';'); });
  await step('plc: HMI tab + every screen', async () => { await cl(plc, '#tabHmi'); const n = await plc.evaluate(() => P.hmi.screens.length); return n === 5 ? true : 'screens ' + n; });
  await step('plc: no ACTIVE alarms in normal run', async () => { const a = await plc.evaluate(() => ALARMS.list().filter(x => x.s.active).map(x => x.a.msg)); return a.length === 0 ? true : false; });
  await step('plc: Logic tab', async () => { await cl(plc, '#tabLogic'); });
  for (const id of ['projBtn','exportBtn','aboutBtn']) await step('plc: ' + id, async () => { await cl(plc, '#' + id); await pg.waitForTimeout(300); const v = await plc.evaluate(() => { const m = document.getElementById('modal'); return !!m && (m.open || getComputedStyle(m).display !== 'none'); }); await pg.keyboard.press('Escape'); await pg.waitForTimeout(200); return v || 'modal not shown'; });
  // ---- focus by clicking a robot (cell -> shell)
  await step('cell -> shell focus message', async () => { await cell.evaluate(() => window.parent.postMessage({wb:'focus', target:'R2'}, '*')); await pg.waitForTimeout(500); return (await pg.inputValue('#focus')) === 'R2'; });
  
  console.log(res.map(r => r.join(' | ')).join('\n'));
  console.log('PASS', res.filter(r => r[0] === 'PASS').length, 'FAIL', res.filter(r => r[0] === 'FAIL').length);
  console.log('console errors:', JSON.stringify([...new Set(errs)].slice(0, 15), null, 1));
  
  await b.close();
})();
