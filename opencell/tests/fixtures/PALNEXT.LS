/PROG  PALNEXT
/ATTR
OWNER		= MNEDITOR;
COMMENT		= "Next pallet idx";
PROG_SIZE	= 0;
CREATE		= DATE 26-11-02  TIME 12:00:00;
MODIFIED	= DATE 26-11-02  TIME 12:00:00;
FILE_NAME	= ;
VERSION		= 0;
LINE_COUNT	= 12;
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
   1:  !Step indices, R11=1 when done ;
   2:  R[11:Pallet Done]=0 ;
   3:  R[1:Column Index]=R[1:Column Index]+1 ;
   4:  IF R[1:Column Index]<R[5:Num Columns],JMP LBL[9] ;
   5:  R[1:Column Index]=0 ;
   6:  R[2:Row Index]=R[2:Row Index]+1 ;
   7:  IF R[2:Row Index]<R[6:Num Rows],JMP LBL[9] ;
   8:  R[2:Row Index]=0 ;
   9:  R[3:Layer Index]=R[3:Layer Index]+1 ;
  10:  IF R[3:Layer Index]<R[7:Num Layers],JMP LBL[9] ;
  11:  R[11:Pallet Done]=1 ;
  12:  LBL[9] ;
/POS
/END
