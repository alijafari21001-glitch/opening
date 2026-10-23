# OpenRung

A free, open source ladder logic editor, virtual controller and HMI that runs in a web browser.
It reads and writes the public L5X XML format, so routines move back and forth with Studio 5000.
Independent clean-room project; not affiliated with Rockwell Automation.

**Try it:** https://alijafari21001-glitch.github.io/opening/

![Ladder editor online in Run mode](docs/ladder.png)

![HMI screen with the conveyor demo](docs/hmi.png)

![Virtual I/O rack and process models](docs/io.png)

## Use it
- Open the link above, or download `index.html` and open it in any browser (works offline).
- **Go online** in the top bar, **Download**, then switch the controller to **Run**. The virtual controller runs in a Web Worker and scans every 10 ms; the editor shows live values and power flow.
- The **HMI** tab has a screen designer (buttons, lamps, numeric display and entry, bar graph, tank, multistate, text, screen buttons, trend, alarm list, process view). Design mode edits, Run mode drives the controller.
- A second tab connects to the same controller. Add `#hmi` to the link to open straight into the operator screens.
- **I/O Configuration** holds a virtual rack (DI16, DO16, AI4, AO4 cards) and process models (a conveyor with photo-eyes, a tank with fill and drain) that act as the machine.
- **Project** saves and opens `.json` project files and keeps a recent-projects list; work autosaves in the browser.
- **Sign in** (optional) keeps your projects online, private to your account, so they follow you to any computer. Without an account everything stays in your browser.
- Import L5X: routine, program or controller exports. Export: one ladder or ST routine with its tags and data types as context.

## What it covers
- Instructions: XIC XIO ONS OTE OTL OTU OSR OSF TON TOF RTO CTU CTD RES EQU NEQ GRT GEQ LES LEQ LIM MEQ MOV ADD SUB MUL DIV MOD CPT CLR COP FLL SQO JSR SBR RET NOP AFI
- Structured text routines: assignments, IF/ELSIF/ELSE, CASE, FOR, WHILE, REPEAT, EXIT, RETURN, JSR, math functions.
- Main routine per program; with none set, every routine that no JSR calls runs.
- Controller: Program, Run and Faulted modes, scan time, watchdog, online edits, upload and download.
- Tags: BOOL SINT INT DINT REAL TIMER COUNTER CONTROL, arrays, aliases, user-defined types, bit addressing (`Tag.3`).
- `bridge/`: optional Node.js app that serves the tags over Modbus TCP and OPC UA (see its README).
- Not yet: FBD/SFC routines, AOIs, talking to real hardware.

## Files
- `index.html` is the whole app: one file, no build step.
- `bridge/` is the Modbus TCP / OPC UA helper (`cd bridge && npm install && npm start`).
- `docs/` holds the screenshots.
- `supabase/setup.sql` creates the online projects table with row-level security.

## Turn on accounts (for your own copy)
1. Make a free account at https://supabase.com and create a new project (any name and region; save the database password somewhere).
2. In the project, open **SQL Editor**, click **New query**, paste the contents of `supabase/setup.sql`, and click **Run**.
3. Open **Authentication > URL Configuration**. Set **Site URL** to your OpenRung link (for example `https://alijafari21001-glitch.github.io/opening/`) and add the same link under **Redirect URLs**.
4. Open **Project Settings > API** (or **Data API**). Copy the **Project URL** and the **anon public** key into `CLOUD_CFG` near the top of the accounts section in `index.html`. The anon key is meant to be public; row-level security keeps each user's projects private. Never paste the `service_role` key.
5. Reload OpenRung and click **Sign in > Create account**.

License: MIT
