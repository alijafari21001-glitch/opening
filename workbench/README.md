# Automation Workbench

PL-01 production line in the browser: OpenRung (PLC + HMI), OpenCell (two robots, conveyors, forklifts, CNCs) and OpenPanel (480/120/24 V panels with a multimeter and fault practice), all sharing live I/O.

Open: https://alijafari21001-glitch.github.io/opening/workbench/

- `index.html` shell (tabs, focus, email sign-in), `cell.html`, `panel.html`, `plc.html` the three apps.
- Email sign-in uses Supabase (6-digit code by email). Run `supabase/setup.sql` once, then fill `WB_CLOUD` in `index.html`.

Not affiliated with or endorsed by FANUC, ABB, Yaskawa, Universal Robots or Rockwell Automation. Brand names are used only to describe file compatibility.
