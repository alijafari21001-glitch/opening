/* Self-test: pretends to be the OpenRung page, then reads and writes over Modbus TCP the way FUXA would.
   Start the bridge first (npm start), then run: npm test */
'use strict';
const WebSocket = require('ws');
const ModbusRTU = require('modbus-serial');
const WS = process.env.OPENRUNG_URL || 'ws://127.0.0.1:8502', MB = +(process.env.OPENRUNG_MODBUS || 5020);
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const vals = {Start_PB:0, Motor_Run:1, Tank_Level:42.5, Count:7};
  const types = {Start_PB:'BOOL', Motor_Run:'BOOL', Tank_Level:'REAL', Count:'DINT'};
  const ws = new WebSocket(WS); await new Promise((r, j) => { ws.on('open', r); ws.on('error', j); });
  ws.on('message', d => { const m = JSON.parse(d); if (m.type === 'write'){ vals[m.path] = m.value; console.log('  page got write', m.path, '=', m.value); } });
  const push = () => ws.send(JSON.stringify({type:'values', mode:'RUN', tags:Object.keys(vals).map(k => [k, types[k], vals[k]])}));
  push(); const iv = setInterval(push, 200); await sleep(500);
  const map = await (await fetch(WS.replace('ws', 'http') + '/map.json')).json();
  const c = new ModbusRTU(); await c.connectTCP('127.0.0.1', {port:MB}); c.setID(1);
  const ok = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) process.exitCode = 1; };
  const coils = (await c.readCoils(0, map.coils.length)).data;
  ok(coils[map.coils.indexOf('Motor_Run')] === true, 'read coil Motor_Run');
  const ri = map.regs.indexOf('Tank_Level') * 2, regs = (await c.readHoldingRegisters(ri, 2)).data;
  const b = Buffer.alloc(4); b.writeUInt16BE(regs[0], 0); b.writeUInt16BE(regs[1], 2);
  ok(Math.abs(b.readFloatBE(0) - 42.5) < 1e-6, 'read REAL Tank_Level as a float, high word first');
  await c.writeCoil(map.coils.indexOf('Start_PB'), true); await sleep(300);
  ok(vals.Start_PB === 1, 'write coil Start_PB reaches the page');
  const di = map.regs.indexOf('Count') * 2; await c.writeRegisters(di, [0, 1234]); await sleep(300);
  ok(vals.Count === 1234, 'write DINT Count through two registers');
  clearInterval(iv); c.close(() => {}); ws.close(); setTimeout(() => process.exit(), 200);
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
