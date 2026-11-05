const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage();
  p.on('pageerror', e => console.log('ERR', e.message));
  await p.goto(process.env.PLC_URL || 'http://127.0.0.1:8090/workbench/plc.html'); await p.waitForTimeout(1200);
  const out = await p.evaluate(() => {
    const q = emptyProject('PL01_Line');
    const T = (n, t, d, v) => { const g = newTag(n, t, 0, d); if (v !== undefined) g.value = v; q.tags.push(g); };
    // field I/O from the panels (OpenPanel writes these; names match the panel I/O lists)
    T('EStop_OK','BOOL','MCP-1 DI I0: line E-stop ES1 healthy'); T('Line_Start_PB','BOOL','MCP-1 DI I1: PB1 START'); T('Line_Stop_PB','BOOL','MCP-1 DI I2: PB2 STOP (NC, 1 = not pressed)');
    T('Conv_Running','BOOL','MCP-1 DI I3: M1 aux, case conveyors running'); T('OL_OK','BOOL','MCP-1 DI I4: OL1 + OL2 95-96 closed'); T('Pal_Running','BOOL','MCP-1 DI I5: M2 aux, pallet lines running');
    T('Reset_PB','BOOL','MCP-1 DI I6: PB3 RESET');
    T('Conv_Run','BOOL','MCP-1 DO O0: contactor M1 coil'); T('Pal_Run','BOOL','MCP-1 DO O1: contactor M2 coil');
    T('Light_Green','BOOL','MCP-1 DO O2: stack light green'); T('Light_Amber','BOOL','MCP-1 DO O3: stack light amber'); T('Light_Red','BOOL','MCP-1 DO O4: stack light red');
    for (const n of [1, 2]){ const r = n === 1 ? 'palletizer' : 'machine tender';
      T(`R${n}_Safety_OK`,'BOOL',`RCP-${n} DI I0: pendant E-stop and fence gate closed`); T(`R${n}_Servo_On`,'BOOL',`RCP-${n} DI I1: K1 aux, ${r} servo power on`);
      T(`R${n}_Enable`,'BOOL',`RCP-${n} DO O0: K1 servo contactor coil`); T(`R${n}_Lamp_Run`,'BOOL',`RCP-${n} DO O1: SERVO RUN lamp`);
      T(`R${n}_Running`,'BOOL',`RCP-${n} DI I2: robot DO program running (wired)`); T(`R${n}_Fault`,'BOOL',`RCP-${n} DI I3: robot DO fault (wired)`);
      T(`R${n}_Run_Cmd`,'BOOL',`RCP-${n} DO O2: robot UI start / enable`); T(`R${n}_DO_Running`,'BOOL',`Robot output (OpenCell): ${r} program running`); T(`R${n}_DO_Fault`,'BOOL',`Robot output (OpenCell): ${r} alarm`);
      T(`R${n}_DI_Run`,'BOOL',`Robot input (OpenPanel): UI enable seen at the robot`);
      T(`R${n}_Servo_Tmr`,'TIMER',`K1 did not pull in`); T(`R${n}_Servo_Fault`,'BOOL',`RCP-${n} K1 commanded but no feedback`); }
    // HMI
    T('HMI_Start','BOOL','HMI / line panel Start'); T('HMI_Stop','BOOL','HMI Stop'); T('HMI_New_Order','BOOL','HMI New order');
    // line
    T('Safety_OK','BOOL','E-stop and overloads healthy'); T('Line_Run','BOOL','Line running (seal-in)'); T('New_Order','BOOL','Start a new order (read by OpenCell)');
    T('Fault','BOOL','Any fault'); T('Blink','TIMER','Stack light flasher'); T('Blink_On','BOOL','Flasher bit'); T('Jam_Tmr','TIMER','Conveyor commanded but M1 aux missing');
    T('Order_Pallets','DINT','Pallets in the order (0 = run continuously)', 6); T('Cases_Per_Pallet','DINT','Cases per pallet (R[8] on the palletizer)', 12);
    T('Parts_Per_Case','DINT','Finished parts packed per case', 2); T('CNC_Cycle','DINT','VMC cycle time, s', 28);
    // status from the line (OpenCell writes these)
    for (const [n, d] of [['Case_At_Pick','Case at the palletizer pick (robot DI[1])'],['Pallet_A_Ready','Pallet A at the station (DI[2])'],['Pallet_B_Ready','Pallet B at the station (DI[3])'],
      ['VMC1_Running','VMC1 cutting'],['VMC2_Running','VMC2 cutting'],['VMC3_Running','VMC3 cutting'],['VMC1_Door_Open','VMC1 door open'],['VMC2_Door_Open','VMC2 door open'],['VMC3_Door_Open','VMC3 door open'],
      ['Wrapper_Busy','Stretch wrapper running'],['Order_Done','All order pallets are on the truck']]) T(n, 'BOOL', d + ' (from OpenCell)');
    for (const [n, d] of [['Disp_A_Count','Empty pallets in dispenser A'],['Disp_B_Count','Empty pallets in dispenser B'],['Cases_Done','Cases palletized'],['Parts_Done','Parts finished by the VMCs'],
      ['Parts_Packed','Parts packed into cases'],['Pallets_Wrapped','Pallets wrapped this order'],['Pallets_Loaded','Pallets on the truck this order'],['Trailer_Count','Pallets in the trailer'],['Return_Parts','Parts on the return belt']]) T(n, 'DINT', d + ' (from OpenCell)');
    const pr = q.programs[0];
    const R = (name, rungs) => ({name, type:'RLL', rungs:rungs.map(([comment, text]) => ({comment, text}))});
    pr.routines = [
      R('MainRoutine', [['PL-01 line. Each routine matches one cabinet drawing in the Panel tab: Safety + Line = MCP-1, Palletizer_R1 = RCP-1, MachineTending_R2 = RCP-2.', 'JSR(Safety,0)JSR(Line,0)JSR(Palletizer_R1,0)JSR(MachineTending_R2,0)JSR(Order,0);']]),
      R('Safety', [
        ['MCP-1: line E-stop ES1 (DI I0) and both motor overloads OL1/OL2 (DI I4) must be healthy.', 'XIC(EStop_OK)XIC(OL_OK)OTE(Safety_OK);'],
        ['Conveyor contactor M1 commanded but its aux contact (DI I3) never closes: jam / contactor fault after 2 s.', 'XIC(Conv_Run)XIO(Conv_Running)TON(Jam_Tmr,2000,0);'],
        ['Any fault.', '[XIO(Safety_OK) ,XIC(Jam_Tmr.DN) ,XIC(R1_Fault) ,XIC(R2_Fault) ,XIC(R1_Servo_Fault) ,XIC(R2_Servo_Fault) ]OTE(Fault);'],
        ['0.5 s flasher for the stack light.', 'XIO(Blink.DN)TON(Blink,500,0);'],
        ['', 'XIC(Blink.DN)XIO(Blink_On)OTL(Blink_On);'],
        ['', 'XIC(Blink.DN)XIC(Blink_On)XIO(Blink.EN)OTU(Blink_On);'],
      ]),
      R('Line', [
        ['Start (PB1 or HMI) / stop (PB2 is NC, or HMI) seal-in. Drops on any safety fault.', '[XIC(Line_Start_PB) ,XIC(HMI_Start) ,XIC(Line_Run) ]XIC(Line_Stop_PB)XIO(HMI_Stop)XIC(Safety_OK)XIO(Jam_Tmr.DN)OTE(Line_Run);'],
        ['MCP-1 DO O0: contactor M1, case conveyors (MTR1). OpenCell runs the belts only while M1 aux (Conv_Running) is on.', 'XIC(Line_Run)OTE(Conv_Run);'],
        ['MCP-1 DO O1: contactor M2, pallet lines, transfer and wrapper (MTR2).', 'XIC(Line_Run)OTE(Pal_Run);'],
        ['Stack light green: running.', 'XIC(Line_Run)XIC(Conv_Running)XIO(Fault)OTE(Light_Green);'],
        ['Stack light amber: stopped and healthy, or order complete.', '[XIO(Line_Run) ,XIC(Order_Done) ]XIO(Fault)OTE(Light_Amber);'],
        ['Stack light red: flashes on any fault.', 'XIC(Fault)XIC(Blink_On)OTE(Light_Red);'],
      ]),
      R('Palletizer_R1', [
        ['RCP-1 DO O0: servo contactor K1 for the R-2000iC palletizer. Needs the line running and the pendant E-stop + fence gate (DI I0). OpenCell holds PAL_MAIN while K1 aux (R1_Servo_On) is off.', 'XIC(Line_Run)XIC(R1_Safety_OK)OTE(R1_Enable);'],
        ['K1 commanded but no feedback for 2 s.', 'XIC(R1_Enable)XIO(R1_Servo_On)TON(R1_Servo_Tmr,2000,0);'],
        ['', 'XIC(R1_Servo_Tmr.DN)OTE(R1_Servo_Fault);'],
        ['RCP-1 DO O1: SERVO RUN lamp while PAL_MAIN runs.', 'XIC(R1_Servo_On)XIC(R1_Running)OTE(R1_Lamp_Run);'],
        ['RCP-1 DO O2: robot UI start / enable, wired to the robot input. The robot only runs its program while this input is on.', 'XIC(Line_Run)XIC(R1_Servo_On)XIO(R1_Servo_Fault)OTE(R1_Run_Cmd);'],
      ]),
      R('MachineTending_R2', [
        ['RCP-2 DO O0: servo contactor K1 for the M-20iA machine tender on its rail.', 'XIC(Line_Run)XIC(R2_Safety_OK)OTE(R2_Enable);'],
        ['K1 commanded but no feedback for 2 s.', 'XIC(R2_Enable)XIO(R2_Servo_On)TON(R2_Servo_Tmr,2000,0);'],
        ['', 'XIC(R2_Servo_Tmr.DN)OTE(R2_Servo_Fault);'],
        ['RCP-2 DO O1: SERVO RUN lamp while MTMAIN runs.', 'XIC(R2_Servo_On)XIC(R2_Running)OTE(R2_Lamp_Run);'],
        ['RCP-2 DO O2: robot UI start / enable, wired to the robot input. The robot only runs its program while this input is on.', 'XIC(Line_Run)XIC(R2_Servo_On)XIO(R2_Servo_Fault)OTE(R2_Run_Cmd);'],
      ]),
      R('Order', [
        ['New order from the HMI or PB3 RESET: OpenCell resets its order counters and the dispensers release pallets again.', '[XIC(HMI_New_Order) ,XIC(Reset_PB) ]OTE(New_Order);'],
        ['Keep the order settings in range (the HMI and the line panel both write them).', 'LES(Cases_Per_Pallet,1)MOV(1,Cases_Per_Pallet);'],
        ['', 'GRT(Cases_Per_Pallet,16)MOV(16,Cases_Per_Pallet);'],
        ['', 'LES(Parts_Per_Case,1)MOV(1,Parts_Per_Case);'],
        ['', 'LES(CNC_Cycle,3)MOV(3,CNC_Cycle);'],
      ]),
    ];
    pr.main = 'MainRoutine';
    const O = (t, x, y, w, h, extra) => ({id:newId(), t, x, y, w, h, tag:'', ...JSON.parse(JSON.stringify(HT[t].d)), ...extra});
    const nav = (x, y, i, label) => O('nav', x, y, 5, 2, {target:i, label});
    const navs = y => [nav(0, y, 0, 'Line'), nav(6, y, 1, 'Order'), nav(12, y, 2, 'Palletizer R1'), nav(18, y, 3, 'Tending R2'), nav(24, y, 4, 'Alarms')];
    q.hmi.screens = [
      {name:'Line overview', objs:[
        O('text', 0, 0, 24, 2, {label:'PL-01 line', size:'l'}),
        O('mom', 0, 3, 4, 2, {tag:'HMI_Start', label:'Start', color:'green'}), O('mom', 5, 3, 4, 2, {tag:'HMI_Stop', label:'Stop', color:'red'}),
        O('lamp', 10, 3, 4, 3, {tag:'Line_Run', label:'Running', color:'green'}), O('lamp', 15, 3, 4, 3, {tag:'Safety_OK', label:'Safety OK', color:'green'}), O('lamp', 20, 3, 4, 3, {tag:'Fault', label:'Fault', color:'red'}),
        O('lamp', 25, 3, 4, 3, {tag:'Conv_Running', label:'M1 conveyors', color:'blue'}), O('lamp', 25, 7, 4, 3, {tag:'Pal_Running', label:'M2 pallets', color:'blue'}),
        O('num', 0, 7, 5, 2, {tag:'Cases_Done', label:'Cases'}), O('num', 6, 7, 6, 2, {tag:'Pallets_Loaded', label:'On truck'}), O('num', 13, 7, 5, 2, {tag:'Parts_Done', label:'Parts cut'}), O('num', 19, 7, 5, 2, {tag:'Parts_Packed', label:'Packed'}),
        O('num', 0, 10, 5, 2, {tag:'Disp_A_Count', label:'Empty A'}), O('num', 6, 10, 6, 2, {tag:'Disp_B_Count', label:'Empty B'}), O('num', 13, 10, 5, 2, {tag:'Return_Parts', label:'On belt'}), O('num', 19, 10, 5, 2, {tag:'Trailer_Count', label:'In trailer'}),
        O('lamp', 0, 13, 4, 3, {tag:'Light_Green', label:'Green', color:'green'}), O('lamp', 5, 13, 4, 3, {tag:'Light_Amber', label:'Amber', color:'amber'}), O('lamp', 10, 13, 4, 3, {tag:'Light_Red', label:'Red', color:'red'}),
        O('lamp', 15, 13, 4, 3, {tag:'Wrapper_Busy', label:'Wrapping', color:'blue'}), O('lamp', 20, 13, 4, 3, {tag:'Order_Done', label:'Order done', color:'green'}),
        ...navs(17)]},
      {name:'Order', objs:[
        O('text', 0, 0, 24, 2, {label:'Customer order', size:'l'}),
        O('entry', 0, 3, 6, 3, {tag:'Order_Pallets', label:'Pallets (0 = run on)', min:0, max:99}), O('entry', 7, 3, 6, 3, {tag:'Cases_Per_Pallet', label:'Cases per pallet', min:1, max:16}),
        O('entry', 14, 3, 6, 3, {tag:'Parts_Per_Case', label:'Parts per case', min:1, max:6}), O('entry', 21, 3, 6, 3, {tag:'CNC_Cycle', label:'CNC cycle s', min:3, max:300}),
        O('num', 0, 8, 6, 2, {tag:'Pallets_Wrapped', label:'Wrapped'}), O('num', 7, 8, 6, 2, {tag:'Pallets_Loaded', label:'On truck'}), O('lamp', 14, 8, 4, 3, {tag:'Order_Done', label:'Order done', color:'green'}),
        O('mom', 20, 8, 6, 2, {tag:'HMI_New_Order', label:'New order', color:'blue'}),
        O('bar', 28, 3, 2, 8, {tag:'Pallets_Loaded', label:'Loaded', min:0, max:16, color:'green'}),
        ...navs(17)]},
      {name:'Palletizer R1', objs:[
        O('text', 0, 0, 30, 2, {label:'Palletizer R1 (R-2000iC) · cabinet RCP-1', size:'l'}),
        O('lamp', 0, 3, 4, 3, {tag:'R1_Safety_OK', label:'Safety', color:'green'}), O('lamp', 5, 3, 4, 3, {tag:'R1_Enable', label:'K1 cmd', color:'blue'}), O('lamp', 10, 3, 4, 3, {tag:'R1_Servo_On', label:'Servo on', color:'green'}),
        O('lamp', 15, 3, 4, 3, {tag:'R1_Running', label:'PAL_MAIN', color:'green'}), O('lamp', 20, 3, 4, 3, {tag:'R1_Fault', label:'Robot alarm', color:'red'}), O('lamp', 25, 3, 4, 3, {tag:'R1_Servo_Fault', label:'K1 fault', color:'red'}),
        O('lamp', 0, 8, 4, 3, {tag:'Case_At_Pick', label:'Case at pick', color:'amber'}), O('lamp', 5, 8, 4, 3, {tag:'Pallet_A_Ready', label:'Pallet A', color:'blue'}), O('lamp', 10, 8, 4, 3, {tag:'Pallet_B_Ready', label:'Pallet B', color:'blue'}),
        O('lamp', 15, 8, 4, 3, {tag:'Wrapper_Busy', label:'Wrapper', color:'blue'}), O('num', 20, 8, 5, 2, {tag:'Cases_Done', label:'Cases'}), O('entry', 26, 8, 5, 3, {tag:'Cases_Per_Pallet', label:'Per pallet', min:1, max:16}),
        O('num', 0, 12, 5, 2, {tag:'Disp_A_Count', label:'Empty A'}), O('num', 6, 12, 5, 2, {tag:'Disp_B_Count', label:'Empty B'}),
        ...navs(17)]},
      {name:'Machine tending R2', objs:[
        O('text', 0, 0, 30, 2, {label:'Machine tender R2 (M-20iA on rail) · cabinet RCP-2', size:'l'}),
        O('lamp', 0, 3, 4, 3, {tag:'R2_Safety_OK', label:'Safety', color:'green'}), O('lamp', 5, 3, 4, 3, {tag:'R2_Enable', label:'K1 cmd', color:'blue'}), O('lamp', 10, 3, 4, 3, {tag:'R2_Servo_On', label:'Servo on', color:'green'}),
        O('lamp', 15, 3, 4, 3, {tag:'R2_Running', label:'MTMAIN', color:'green'}), O('lamp', 20, 3, 4, 3, {tag:'R2_Fault', label:'Robot alarm', color:'red'}), O('lamp', 25, 3, 4, 3, {tag:'R2_Servo_Fault', label:'K1 fault', color:'red'}),
        O('lamp', 0, 8, 4, 3, {tag:'VMC1_Running', label:'VMC1', color:'green'}), O('lamp', 5, 8, 4, 3, {tag:'VMC2_Running', label:'VMC2', color:'green'}), O('lamp', 10, 8, 4, 3, {tag:'VMC3_Running', label:'VMC3', color:'green'}),
        O('lamp', 15, 8, 4, 3, {tag:'VMC1_Door_Open', label:'Door 1', color:'amber'}), O('lamp', 20, 8, 4, 3, {tag:'VMC2_Door_Open', label:'Door 2', color:'amber'}), O('lamp', 25, 8, 4, 3, {tag:'VMC3_Door_Open', label:'Door 3', color:'amber'}),
        O('num', 0, 12, 5, 2, {tag:'Parts_Done', label:'Parts cut'}), O('num', 6, 12, 5, 2, {tag:'Return_Parts', label:'On belt'}), O('num', 12, 12, 5, 2, {tag:'Parts_Packed', label:'Packed'}),
        O('entry', 18, 12, 6, 3, {tag:'CNC_Cycle', label:'CNC cycle s', min:3, max:300}), O('entry', 25, 12, 5, 3, {tag:'Parts_Per_Case', label:'Per case', min:1, max:6}),
        ...navs(17)]},
      {name:'Alarms', objs:[O('text', 0, 0, 24, 2, {label:'Alarms', size:'l'}), O('alarms', 0, 3, 30, 12, {}), ...navs(17)]},
    ];
    const A = (tag, cond, value, msg, sev) => q.hmi.alarms.push({id:newId(), tag, cond, value, msg, sev});
    q.hmi.alarms = [];
    A('EStop_OK', 'off', 0, 'MCP-1: line E-stop ES1 pressed or its circuit is open (DI I0)', 'High');
    A('OL_OK', 'off', 0, 'MCP-1: motor overload OL1 or OL2 tripped (DI I4)', 'High');
    A('Jam_Tmr.DN', 'on', 0, 'MCP-1: M1 commanded but no aux feedback (contactor, coil or DI I3)', 'High');
    for (const n of [1, 2]){ const r = n === 1 ? 'R1 palletizer' : 'R2 machine tender';
      A(`R${n}_Safety_OK`, 'off', 0, `RCP-${n}: ${r} pendant E-stop or fence gate open (DI I0)`, 'High');
      A(`R${n}_Servo_Fault`, 'on', 0, `RCP-${n}: K1 servo contactor commanded, no feedback (DI I1)`, 'High');
      A(`R${n}_Fault`, 'on', 0, `${r}: robot fault output on (DI I3)`, 'High'); }
    A('Disp_A_Count', '<', 1, 'Pallet dispenser A empty', 'Medium');
    A('Disp_B_Count', '<', 1, 'Pallet dispenser B empty', 'Medium');
    A('Order_Done', 'on', 0, 'Order complete, all pallets on the truck', 'Low');
    P = normalize(q); reparseAll();
    const errs = []; for (const r of P.programs[0].routines) for (const g of r.rungs) if (g.err) errs.push(r.name + ': ' + g.err);
    return {errs, json:JSON.stringify({format:'openrung-project', version:2, savedAt:new Date().toISOString(), project:JSON.parse(snapshot())})};
  });
  console.log('errors', JSON.stringify(out.errs));
  require('fs').writeFileSync(require('path').join(__dirname, '..', 'PL01_Line.openrung.json'), out.json);
  await b.close();
})();
