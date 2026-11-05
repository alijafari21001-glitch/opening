/PROG  LAB5VER
/ATTR
OWNER		= MNEDITOR;
COMMENT		= "Lab5 verify cell";
PROG_SIZE	= 0;
CREATE		= DATE 26-10-28  TIME 12:00:00;
MODIFIED	= DATE 26-10-28  TIME 12:00:00;
FILE_NAME	= ;
VERSION		= 0;
LINE_COUNT	= 14;
MEMORY_SIZE	= 0;
PROTECT		= READ_WRITE;
TCD:  STACK_SIZE	= 0,
      TASK_PRIORITY	= 50,
      TIME_SLICE	= 0,
      BUSY_LAMP_OFF	= 0,
      ABORT_REQUEST	= 0,
      PAUSE_REQUEST	= 0;
DEFAULT_GROUP	= 1,*,*,*,*;
CONTROL_CODE	= 00000000 00000000;
/MN
   1:  !Lab 5 cell verification ;
   2:  !UTOOL 1 = pointer, TCP Z150 ;
   3:  UFRAME_NUM=0 ;
   4:  UTOOL_NUM=1 ;
   5:  J P[1:HOME] 30% FINE ;
   6:  J P[2:Above cube] 30% CNT50 ;
   7:  L P[3:Touch TopStick] 100mm/sec FINE ;
   8:  WAIT 1.00(sec) ;
   9:  L P[2:Above cube] 200mm/sec CNT50 ;
  10:  J P[4:Above conveyor] 30% CNT50 ;
  11:  L P[5:Touch belt] 100mm/sec FINE ;
  12:  WAIT 1.00(sec) ;
  13:  L P[4:Above conveyor] 200mm/sec CNT50 ;
  14:  J P[1:HOME] 30% FINE ;
/POS
P[1:"HOME"]{
   GP1:
	UF : 0, UT : 1,	
	J1=      0.000 deg,	J2=      0.000 deg,	J3=      0.000 deg,
	J4=      0.000 deg,	J5=    -90.000 deg,	J6=      0.000 deg
};
P[2:"Above cube"]{
   GP1:
	UF : 0, UT : 1,		CONFIG : 'N U T, 0, 0, 0',
	X =    515.000  mm,	Y =     95.500  mm,	Z =    200.000  mm,
	W =    180.000 deg,	P =      0.000 deg,	R =      0.000 deg
};
P[3:"Touch TopStick"]{
   GP1:
	UF : 0, UT : 1,		CONFIG : 'N U T, 0, 0, 0',
	X =    515.000  mm,	Y =     95.500  mm,	Z =    183.000  mm,
	W =    180.000 deg,	P =      0.000 deg,	R =      0.000 deg
};
P[4:"Above conveyor"]{
   GP1:
	UF : 0, UT : 1,		CONFIG : 'N U T, 0, 0, 0',
	X =    300.000  mm,	Y =   -430.000  mm,	Z =     90.000  mm,
	W =    180.000 deg,	P =      0.000 deg,	R =      0.000 deg
};
P[5:"Touch belt"]{
   GP1:
	UF : 0, UT : 1,		CONFIG : 'N U T, 0, 0, 0',
	X =    300.000  mm,	Y =   -430.000  mm,	Z =    -28.000  mm,
	W =    180.000 deg,	P =      0.000 deg,	R =      0.000 deg
};
/END
