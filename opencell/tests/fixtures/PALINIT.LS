/PROG  PALINIT
/ATTR
OWNER		= MNEDITOR;
COMMENT		= "Init PRs and Rs";
PROG_SIZE	= 0;
CREATE		= DATE 26-11-02  TIME 12:00:00;
MODIFIED	= DATE 26-11-02  TIME 12:00:00;
FILE_NAME	= ;
VERSION		= 0;
LINE_COUNT	= 19;
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
   1:  !Run ONCE before palletizing ;
   2:  !Makes PR99 a zero Cartesian PR ;
   3:  PR[99:Zero]=LPOS ;
   4:  PR[99:Zero]=PR[99:Zero]-PR[99:Zero] ;
   5:  !PR98 = 0,0,100,0,0,0 ;
   6:  PR[98:Z Offset]=PR[99:Zero] ;
   7:  PR[98,3:Z Offset]=100 ;
   8:  PR[3:Working Offset]=PR[99:Zero] ;
   9:  !Pallet indices ;
  10:  R[1:Column Index]=0 ;
  11:  R[2:Row Index]=0 ;
  12:  R[3:Layer Index]=0 ;
  13:  !Part 5 settings (change any time) ;
  14:  R[5:Num Columns]=3 ;
  15:  R[6:Num Rows]=2 ;
  16:  R[7:Num Layers]=2 ;
  17:  R[8:Box X mm]=300 ;
  18:  R[9:Box Y mm]=250 ;
  19:  R[10:Box Z mm]=200 ;
/POS
/END
