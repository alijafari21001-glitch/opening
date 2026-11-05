/PROG  PALLETAJ
/ATTR
OWNER		= MNEDITOR;
COMMENT		= "Pallet AJ Part3";
PROG_SIZE	= 0;
CREATE		= DATE 26-11-02  TIME 12:00:00;
MODIFIED	= DATE 26-11-02  TIME 12:00:00;
FILE_NAME	= ;
VERSION		= 0;
LINE_COUNT	= 74;
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
  26:  !Clearance offset Z600 ;
  27:  PR[97:Clear Offset]=PR[99:Zero] ;
  28:  PR[97,3:Clear Offset]=600 ;
  29:  !Start high above pick ;
  30:  J PR[1:Pick Position] 30% FINE Offset,PR[97:Clear Offset] ;
  31:  LBL[1] ;
  32:  !Pick approach ;
  33:  L PR[1:Pick Position] 500mm/sec FINE Offset,PR[98:Z Offset] ;
  34:  !Pick ;
  35:  L PR[1:Pick Position] 100mm/sec FINE ;
  36:  CALL G_CLOSE ;
  37:  WAIT .30(sec) ;
  38:  !Pick retreat straight up ;
  39:  L PR[1:Pick Position] 500mm/sec FINE Offset,PR[98:Z Offset] ;
  40:  L PR[1:Pick Position] 500mm/sec FINE Offset,PR[97:Clear Offset] ;
  41:  !Calculate pallet offset ;
  42:  PR[3,1:Working Offset]=R[1:Column Index]*300 ;
  43:  PR[3,2:Working Offset]=R[2:Row Index]*250 ;
  44:  PR[3,3:Working Offset]=R[3:Layer Index]*200 ;
  45:  PR[4:Place Position]=PR[2:Pallet Base]+PR[3:Working Offset] ;
  46:  !Travel high over to pallet ;
  47:  J PR[4:Place Position] 50% FINE Offset,PR[97:Clear Offset] ;
  48:  !Place approach straight down ;
  49:  L PR[4:Place Position] 500mm/sec FINE Offset,PR[98:Z Offset] ;
  50:  !Place ;
  51:  L PR[4:Place Position] 100mm/sec FINE ;
  52:  CALL G_OPEN ;
  53:  WAIT .30(sec) ;
  54:  !Save place to LPOS PR ;
  55:  PR[5:LPOS Holder]=LPOS ;
  56:  !Place retreat straight up ;
  57:  L PR[5:LPOS Holder] 500mm/sec FINE Offset,PR[98:Z Offset] ;
  58:  L PR[5:LPOS Holder] 500mm/sec FINE Offset,PR[97:Clear Offset] ;
  59:  !Travel high back to pick ;
  60:  J PR[1:Pick Position] 50% FINE Offset,PR[97:Clear Offset] ;
  61:  !Update indices ;
  62:  R[1:Column Index]=R[1:Column Index]+1 ;
  63:  IF R[1:Column Index]<3,JMP LBL[1] ;
  64:  R[1:Column Index]=0 ;
  65:  R[2:Row Index]=R[2:Row Index]+1 ;
  66:  IF R[2:Row Index]<2,JMP LBL[1] ;
  67:  R[2:Row Index]=0 ;
  68:  R[3:Layer Index]=R[3:Layer Index]+1 ;
  69:  IF R[3:Layer Index]>=2,JMP LBL[99] ;
  70:  JMP LBL[1] ;
  71:  LBL[99] ;
  72:  !Return Home ;
  73:  J PR[10:Home] 30% FINE ;
  74:  END ;
/POS
/END
