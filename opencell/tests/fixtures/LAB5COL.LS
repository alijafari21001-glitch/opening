/PROG  LAB5COL
/ATTR
OWNER		= MNEDITOR;
COMMENT		= "Lab5 collision t";
PROG_SIZE	= 0;
CREATE		= DATE 26-10-28  TIME 12:00:00;
MODIFIED	= DATE 26-10-28  TIME 12:00:00;
FILE_NAME	= ;
VERSION		= 0;
LINE_COUNT	= 8;
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
   1:  !Step 7.3: the pointer runs into ;
   2:  !the Cube. Expect it to turn red. ;
   3:  UFRAME_NUM=0 ;
   4:  UTOOL_NUM=1 ;
   5:  J P[1:HOME] 30% FINE ;
   6:  J P[2:Into Cube] 10% FINE ;
   7:  WAIT 2.00(sec) ;
   8:  J P[1:HOME] 30% FINE ;
/POS
P[1:"HOME"]{
   GP1:
	UF : 0, UT : 1,	
	J1=      0.000 deg,	J2=      0.000 deg,	J3=      0.000 deg,
	J4=      0.000 deg,	J5=    -90.000 deg,	J6=      0.000 deg
};
P[2:"Into Cube"]{
   GP1:
	UF : 0, UT : 1,	
	J1=     10.200 deg,	J2=     30.000 deg,	J3=      0.000 deg,
	J4=      0.000 deg,	J5=    -90.000 deg,	J6=      0.000 deg
};
/END
