# Automation Workbench

Free, open source automation training that runs in a web browser: a PLC with HMI, a robot cell simulator and electrical panel drawings, all wired to one live production line.

**Try it:** https://alijafari21001-glitch.github.io/opening/

| Tool | What it is | Open |
| --- | --- | --- |
| Workbench | The PL-01 line: palletizer and machine-tending robots, conveyors, CNCs, wrapper, forklifts, the PLC and three cabinets sharing live I/O. Sign in for your own robot cell. | [workbench/](https://alijafari21001-glitch.github.io/opening/workbench/) |
| OpenRung | Ladder / structured text editor, virtual controller and HMI designer; L5X import and export. | [openrung/](https://alijafari21001-glitch.github.io/opening/openrung/) |
| OpenCell | Robot cell simulator with a teach pendant, frames, position registers and .LS import / export. Source in `opencell/`. | inside the workbench |
| OpenPanel | 480 / 120 / 24 V panel drawings, multimeter, wire and I/O lists, fault-finding practice. | [openpanel/](https://alijafari21001-glitch.github.io/opening/openpanel/) |
| Bridge | Optional Node.js helper that serves the PLC tags over Modbus TCP and OPC UA. | `bridge/` |

## Repository layout

```
index.html            landing page
openrung/             OpenRung app (one file, no build step) + its README
openpanel/            OpenPanel app (one file)
opencell/             OpenCell source (TypeScript, three.js, Vite)
workbench/            the built workbench: index.html shell + cell.html, panel.html, plc.html
workbench/tools/      build scripts (PLC project generator, plc.html builder, security headers)
bridge/               Modbus TCP / OPC UA bridge
tests/                end-to-end browser test of the workbench
```

## Build

```
cd opencell && npm ci && npm test            # unit + line simulation tests
npx vite build --mode single                 # dist-single/index.html
npx vite-node tools/make-pl01.ts cad/pl01/v3/meshes.json /tmp/pl01-preset.js
node tools/pl01-page.mjs dist-single/index.html /tmp/pl01-preset.js ../workbench/cell.html
cd .. && python3 workbench/tools/build_plc.py workbench/PL01_Line.openrung.json
python3 workbench/tools/add_csp.py           # security headers on every page
python3 -m http.server 8090 & node tests/workbench.e2e.js   # needs Playwright
```

## Accounts

Email sign-in (a 6-digit code, no password) uses [Supabase](https://supabase.com). Run `workbench/supabase/setup.sql` in a Supabase project and put its Project URL and anon public key in `WB_CLOUD` in `workbench/index.html`. Each user can only read and write their own save (row-level security). See [PRIVACY.md](PRIVACY.md).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Security reports: [SECURITY.md](SECURITY.md).

## Legal

MIT licensed. Independent clean-room project, not affiliated with or endorsed by Rockwell Automation, FANUC, ABB, Yaskawa or Universal Robots. Their names are used only to describe file compatibility; no vendor code, logos or assets are included.
