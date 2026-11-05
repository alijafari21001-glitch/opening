/PROG  PALMAIN
/ATTR
OWNER		= MNEDITOR;
COMMENT		= "Palletizing main";
PROG_SIZE	= 0;
CREATE		= DATE 26-11-02  TIME 12:00:00;
MODIFIED	= DATE 26-11-02  TIME 12:00:00;
FILE_NAME	= ;
VERSION		= 0;
LINE_COUNT	= 35;
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
   1:  !Set Tool and User Frame ;
   2:  UFRAME_NUM=1 ;
   3:  UTOOL_NUM=1 ;
   4:  !Move to Home ;
   5:  J PR[10:Home] 30% FINE ;
   6:  !Test tool ;
   7:  CALL G_CLOSE ;
   8:  WAIT .50(sec) ;
   9:  CALL G_OPEN ;
  10:  !JPOS safety check J1 +/-170 ;
  11:  PR[6:JPOS Holder]=JPOS ;
  12:  R[4:J1 Angle]=PR[6,1:JPOS Holder] ;
  13:  IF R[4:J1 Angle]>170,JMP LBL[90] ;
  14:  IF R[4:J1 Angle]<(-170),JMP LBL[90] ;
  15:  JMP LBL[91] ;
  16:  LBL[90] ;
  17:  MESSAGE[J1 OUT OF RANGE] ;
  18:  PAUSE ;
  19:  LBL[91] ;
  20:  !Initialize pallet indices ;
  21:  R[1:Column Index]=0 ;
  22:  R[2:Row Index]=0 ;
  23:  R[3:Layer Index]=0 ;
  24:  !Clear Working Offset ;
  25:  PR[3:Working Offset]=PR[99:Zero] ;
  26:  R[11:Pallet Done]=0 ;
  27:  LBL[1] ;
  28:  CALL PALPICK ;
  29:  CALL PALPLACE ;
  30:  CALL PALNEXT ;
  31:  IF R[11:Pallet Done]=0,JMP LBL[1] ;
  32:  LBL[99] ;
  33:  !Return Home ;
  34:  J PR[10:Home] 30% FINE ;
  35:  END ;
/POS
/END
