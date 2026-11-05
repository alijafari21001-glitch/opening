# OpenCell

Free, open-source robot cell simulator that runs entirely in the browser. No license, no install, no backend.
Built for practicing FANUC-style teach pendant work: jogging, frames, TP programs, pick and place.

> OpenCell is an independent project. It is not affiliated with or endorsed by FANUC. "FANUC" is used only to describe compatibility (TP program syntax, coordinate conventions).

## Status

- [x] Stage 1: robot model (LR Mate 200iD-class, LR Mate 200iC-class, M-10iA-class), FK, analytic IK, FANUC config string, jogging (JOINT/WORLD/TOOL/USER), tool/user frame direct entry, Shift+drag TCP
- [x] Stage 2: teach pendant (SELECT, EDIT with POINT/TOUCHUP/[INST]/[EDCMD]/[CHOICE], DATA, I/O, SETUP frames with 3/4/6-point teaching, jog menu) + TP interpreter
- [~] Stage 3: done: tooling builder (boxes, cylinders, STL/OBJ/GLB CAD per UTOOL, TCP at tip), fixtures/parts/obstacles with move gizmo and snap, drag-and-drop CAD (stored in IndexedDB). To do: gripper I/O + pick/drop, conveyor, collisions, I/O panel
- [~] Stage 4: built-in labs. Lab 5 (workcell design and verification): machines with links, fence / conveyor / worker library, pointer tool, work envelope, collision display, lock locations, envelope check
- [ ] Stage 5: .LS import, video recording, share links (done: .LS export, cell save/open)

## TP instruction coverage

| Group | Supported |
|---|---|
| Motion | `J` / `L` / `C`, `P[n]`, `PR[n]`, `%`, `mm/sec`, `cm/min`, `inch/min`, `deg/sec`, `sec`, `msec`, `FINE`, `CNTn`, `CNT R[n]`, `Offset,PR[n]`, `Tool_Offset,PR[n]`, `OFFSET CONDITION`, `TOOL_OFFSET CONDITION` |
| Registers | `R[n]` with `+ - * / DIV MOD`, `PR[n]=LPOS/JPOS/P[n]/PR[m]±PR[k]`, `PR[n,i]`, indirect `R[R[n]]`, comments `R[n:text]` |
| I/O | `DI DO RI RO UI UO SI SO F GI GO`, `=ON/OFF/PULSE[,t sec]`, `WAIT cond [TIMEOUT,LBL[n]]`, `WAIT t(sec)`, `$WAITTMOUT`, `$DEFPULSE` |
| Flow | `LBL`, `JMP LBL`, `IF ...,JMP/CALL/assign`, `IF (...) THEN / ELSE / ENDIF`, `SELECT / =n / ELSE`, `FOR ... TO/DOWNTO / ENDFOR`, `CALL prog(args)` with `AR[n]`, `END`, `ABORT`, `PAUSE`, `MESSAGE[]`, `!remark`, `//` disabled lines |
| Frames/misc | `UFRAME_NUM`, `UTOOL_NUM`, `UFRAME[n]=PR[m]`, `UTOOL[n]=PR[m]`, `PAYLOAD[n]` (accepted), `OVERRIDE=n%`, `TIMER[n]=START/STOP/RESET` |

Taught positions remember the UFRAME/UTOOL they were recorded in. Running a point with different frame numbers raises an alarm, like the real controller.

## Run

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # unit tests (kinematics)
npm run build    # static site in dist/ (GitHub Pages)
```

## Kinematic conventions

- World origin on the J1 axis at J2 height; mounting surface is 330 mm below (LR Mate 200iD).
- J3 is ground-referenced (J2/J3 interaction), like the real controller.
- All joints at 0: faceplate at X465 Y0 Z365 W-180 P-90 R0. Joints (0,0,0,0,-90,0): tool pointing down, W180 P0 R0.
- Config string `N U T, 0, 0, 0`: Flip/No-flip (J5 sign), Up/Down (elbow), Top/Back (front/back of J1), turn numbers of J4, J6, J1.
- Joint limits are approximate. Check your robot's datasheet.

## License

MIT
