#!/usr/bin/env node
/* OpenRung bridge: exposes the browser's virtual controller over Modbus TCP and OPC UA.
   The OpenRung page connects here over WebSocket, sends tag values every 200 ms, and receives writes.
   MIT License. */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const arg = (name, def) => { const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : process.env['OPENRUNG_' + name.toUpperCase()] || def; };
const WS_PORT = +arg('port', 8502);
const MB_PORT = +arg('modbus', 5020);
const UA_PORT = +arg('opcua', 4840);
const MAP_FILE = path.resolve(arg('map', path.join(__dirname, 'openrung-map.json')));

/* ---- tag table and Modbus address map ----
   BOOL tags are coils (and discrete inputs) from address 0 up.
   Every other tag takes two holding registers (and input registers): DINT/INT/SINT as a signed 32-bit integer,
   REAL as a 32-bit float, high word first. The map is saved so addresses stay put between runs. */
const tags = new Map();            // path -> {type, value}
let map = {coils:[], regs:[]};     // coils: [path], regs: [path] (each takes 2 registers)
try { map = JSON.parse(fs.readFileSync(MAP_FILE, 'utf8')); } catch (e) {}
let mapDirty = false;
function ensureMapped(p, type){
  if (type === 'BOOL'){ if (!map.coils.includes(p)){ map.coils.push(p); mapDirty = true; } }
  else if (!map.regs.includes(p)){ map.regs.push(p); mapDirty = true; }
}
setInterval(() => { if (mapDirty){ mapDirty = false; fs.writeFile(MAP_FILE, JSON.stringify(map, null, 1), () => {}); } }, 2000);

let page = null, mode = '', lastSeen = 0;
function write(p, value){
  const t = tags.get(p); if (!t) return false;
  if (!page || page.readyState !== 1) return false;
  t.value = t.type === 'BOOL' ? (value ? 1 : 0) : Number(value);
  page.send(JSON.stringify({type:'write', path:p, value:t.value}));
  return true;
}
const words = (type, v) => {
  const b = Buffer.alloc(4);
  if (type === 'REAL') b.writeFloatBE(Number(v) || 0); else b.writeInt32BE(Math.trunc(Number(v) || 0) | 0);
  return [b.readUInt16BE(0), b.readUInt16BE(2)];
};
const fromWords = (type, hi, lo) => { const b = Buffer.alloc(4); b.writeUInt16BE(hi & 0xffff, 0); b.writeUInt16BE(lo & 0xffff, 2); return type === 'REAL' ? b.readFloatBE(0) : b.readInt32BE(0); };
function regWord(addr){
  const p = map.regs[addr >> 1]; const t = p && tags.get(p);
  return t ? words(t.type, t.value)[addr & 1] : 0;
}
function setRegWord(addr, w){
  const p = map.regs[addr >> 1]; const t = p && tags.get(p); if (!t) return;
  const cur = words(t.type, t.value); cur[addr & 1] = w;
  write(p, fromWords(t.type, cur[0], cur[1]));
}

/* ---- WebSocket for the page, plus a small status page ---- */
const server = http.createServer((req, res) => {
  if (req.url === '/map.json'){ res.writeHead(200, {'content-type':'application/json'}); res.end(JSON.stringify(map, null, 1)); return; }
  const rows = (list, kind) => list.map((p, i) => { const t = tags.get(p); return `<tr><td>${kind === 'coil' ? i : i * 2}</td><td>${kind === 'coil' ? 'coil / discrete input' : 'holding / input register ' + (i * 2) + '-' + (i * 2 + 1)}</td><td>${p}</td><td>${t ? t.type : '?'}</td><td>${t ? t.value : ''}</td></tr>`; }).join('');
  res.writeHead(200, {'content-type':'text/html; charset=utf-8'});
  res.end(`<!doctype html><title>OpenRung bridge</title><style>body{font:14px system-ui;margin:24px}td,th{padding:3px 10px;text-align:left;border-bottom:1px solid #ccc}</style>
<h1>OpenRung bridge</h1><p>Page: ${page ? 'connected' : 'not connected'} · controller mode: ${mode || '?'} · Modbus TCP port ${MB_PORT} (unit id any) · OPC UA ${ua ? 'opc.tcp://localhost:' + UA_PORT + '/OpenRung' : 'off'}</p>
<table><tr><th>Address</th><th>Modbus</th><th>Tag</th><th>Type</th><th>Value</th></tr>${rows(map.coils, 'coil')}${rows(map.regs, 'reg')}</table><p><a href="/map.json">map.json</a></p>`);
});
const wss = new WebSocketServer({server});
wss.on('connection', ws => {
  if (page && page.readyState === 1) page.close(1000, 'another page connected');
  page = ws; console.log('[bridge] OpenRung page connected');
  ws.on('message', data => {
    let m; try { m = JSON.parse(data); } catch (e) { return; }
    if (m.type === 'values' && Array.isArray(m.tags)){
      lastSeen = Date.now(); mode = m.mode || '';
      for (const [p, type, value] of m.tags){
        const t = tags.get(p);
        if (t){ t.value = value; t.type = type; } else { tags.set(p, {type, value}); ensureMapped(p, type); if (ua) ua.add(p, type); }
      }
    } else if (m.type === 'hello') console.log('[bridge] project', m.project);
  });
  ws.on('close', () => { if (page === ws){ page = null; console.log('[bridge] page disconnected'); } });
});
server.listen(WS_PORT, () => console.log(`[bridge] waiting for the OpenRung page on ws://127.0.0.1:${WS_PORT}  (status: http://127.0.0.1:${WS_PORT}/)`));

/* ---- Modbus TCP server ---- */
let mbServer = null;
try {
  const ModbusRTU = require('modbus-serial');
  const vector = {
    getCoil: addr => { const t = tags.get(map.coils[addr]); return t ? !!t.value : false; },
    getDiscreteInput: addr => { const t = tags.get(map.coils[addr]); return t ? !!t.value : false; },
    setCoil: (addr, v) => { const p = map.coils[addr]; if (p) write(p, v ? 1 : 0); },
    getHoldingRegister: addr => regWord(addr),
    getInputRegister: addr => regWord(addr),
    setRegister: (addr, v) => setRegWord(addr, v),
  };
  mbServer = new ModbusRTU.ServerTCP(vector, {host:'0.0.0.0', port:MB_PORT, debug:false, unitID:255});
  mbServer.on('socketError', e => console.error('[modbus]', e.message));
  console.log(`[bridge] Modbus TCP server on port ${MB_PORT}`);
} catch (e) { console.error('[bridge] Modbus TCP is off:', e.message); }

/* ---- OPC UA server (optional: npm install node-opcua) ---- */
let ua = null;
(async () => {
  let opcua; try { opcua = require('node-opcua'); } catch (e) { console.log('[bridge] OPC UA is off. Run "npm install node-opcua" to turn it on.'); return; }
  const { OPCUAServer, Variant, DataType, StatusCodes } = opcua;
  const srv = new OPCUAServer({port:UA_PORT, resourcePath:'/OpenRung', buildInfo:{productName:'OpenRung bridge'}});
  await srv.initialize();
  const ns = srv.engine.addressSpace.getOwnNamespace();
  const root = ns.addObject({organizedBy:srv.engine.addressSpace.rootFolder.objects, browseName:'OpenRung'});
  const DT = t => t === 'BOOL' ? DataType.Boolean : t === 'REAL' ? DataType.Float : DataType.Int32;
  ua = {add(p, type){
    ns.addVariable({componentOf:root, browseName:p, nodeId:'s=' + p, dataType:DT(type) === DataType.Boolean ? 'Boolean' : DT(type) === DataType.Float ? 'Float' : 'Int32',
      value:{get:() => { const t = tags.get(p); return new Variant({dataType:DT(type), value:t ? (type === 'BOOL' ? !!t.value : t.value) : 0}); },
        set:v => write(p, type === 'BOOL' ? (v.value ? 1 : 0) : v.value) ? StatusCodes.Good : StatusCodes.BadNotConnected}});
  }};
  for (const [p, t] of tags) ua.add(p, t.type);
  await srv.start();
  console.log(`[bridge] OPC UA server at opc.tcp://localhost:${UA_PORT}/OpenRung`);
})().catch(e => { console.error('[bridge] OPC UA failed to start:', e.message); ua = null; });

process.on('SIGINT', () => { if (mapDirty) fs.writeFileSync(MAP_FILE, JSON.stringify(map, null, 1)); process.exit(0); });
