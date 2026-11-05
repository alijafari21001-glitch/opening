/PROG  PALLAJ2
/ATTR
OWNER		= MNEDITOR;
COMMENT		= "Pallet AJ Part5";
PROG_SIZE	= 0;
CREATE		= DATE 26-11-02  TIME 12:00:00;
MODIFIED	= DATE 26-11-02  TIME 12:00:00;
FILE_NAME	= ;
VERSION		= 0;
LINE_COUNT	= 68;
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
  26:  LBL[1] ;
  27:  !Pick approach ;
  28:  L PR[1:Pick Position] 500mm/sec FINE Offset,PR[98:Z Offset] ;
  29:  !Pick ;
  30:  L PR[1:Pick Position] 100mm/sec FINE ;
  31:  CALL G_CLOSE ;
  32:  WAIT .30(sec) ;
  33:  !Pick retreat ;
  34:  L PR[1:Pick Position] 500mm/sec FINE Offset,PR[98:Z Offset] ;
  35:  !Home after pick ;
  36:  J PR[10:Home] 30% FINE ;
  37:  !Calculate pallet offset ;
  38:  PR[3,1:Working Offset]=R[1:Column Index]*R[8:Box X mm] ;
  39:  PR[3,2:Working Offset]=R[2:Row Index]*R[9:Box Y mm] ;
  40:  PR[3,3:Working Offset]=R[3:Layer Index]*R[10:Box Z mm] ;
  41:  !Place position = base + offset ;
  42:  PR[4:Place Position]=PR[2:Pallet Base]+PR[3:Working Offset] ;
  43:  !Place approach ;
  44:  L PR[4:Place Position] 500mm/sec FINE Offset,PR[98:Z Offset] ;
  45:  !Place ;
  46:  L PR[4:Place Position] 100mm/sec FINE ;
  47:  CALL G_OPEN ;
  48:  WAIT .30(sec) ;
  49:  !Save place to LPOS PR ;
  50:  PR[5:LPOS Holder]=LPOS ;
  51:  !Place retreat ;
  52:  L PR[5:LPOS Holder] 500mm/sec FINE Offset,PR[98:Z Offset] ;
  53:  !Home after place ;
  54:  J PR[10:Home] 30% FINE ;
  55:  !Update indices ;
  56:  R[1:Column Index]=R[1:Column Index]+1 ;
  57:  IF R[1:Column Index]<R[5:Num Columns],JMP LBL[1] ;
  58:  R[1:Column Index]=0 ;
  59:  R[2:Row Index]=R[2:Row Index]+1 ;
  60:  IF R[2:Row Index]<R[6:Num Rows],JMP LBL[1] ;
  61:  R[2:Row Index]=0 ;
  62:  R[3:Layer Index]=R[3:Layer Index]+1 ;
  63:  IF R[3:Layer Index]>=R[7:Num Layers],JMP LBL[99] ;
  64:  JMP LBL[1] ;
  65:  LBL[99] ;
  66:  !Return Home ;
  67:  J PR[10:Home] 30% FINE ;
  68:  END ;
/POS
/END
