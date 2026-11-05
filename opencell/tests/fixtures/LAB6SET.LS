/PROG  LAB6SET
/ATTR
OWNER		= MNEDITOR;
COMMENT		= "Set frames and PRs";
PROG_SIZE	= 0;
CREATE		= DATE 26-11-02  TIME 12:00:00;
MODIFIED	= DATE 26-11-02  TIME 12:00:00;
FILE_NAME	= ;
VERSION		= 0;
LINE_COUNT	= 40;
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
   1:  !For myCellAJV1: run ONCE ;
   2:  !Pallet center X854 Y1368 top Z135 ;
   3:  !Zero Cartesian PRs ;
   4:  PR[99:Zero]=LPOS ;
   5:  PR[99:Zero]=PR[99:Zero]-PR[99:Zero] ;
   6:  PR[98:Z Offset]=PR[99:Zero] ;
   7:  PR[98,3:Z Offset]=100 ;
   8:  PR[3:Working Offset]=PR[99:Zero] ;
   9:  !UFRAME 1 = corner of box area ;
  10:  PR[20:UF1 Data]=PR[99:Zero] ;
  11:  PR[20,1:UF1 Data]=404 ;
  12:  PR[20,2:UF1 Data]=1118 ;
  13:  PR[20,3:UF1 Data]=135 ;
  14:  UFRAME[1]=PR[20:UF1 Data] ;
  15:  !PR2 = top centre of first box ;
  16:  !UTOOL1 W-180 so tool down = W0 ;
  17:  PR[2:Pallet Base]=PR[99:Zero] ;
  18:  PR[2,1:Pallet Base]=150 ;
  19:  PR[2,2:Pallet Base]=125 ;
  20:  PR[2,3:Pallet Base]=200 ;
  21:  !PR10 Home joints 0 0 0 0 -90 0 ;
  22:  PR[10:Home]=JPOS ;
  23:  PR[10,1:Home]=0 ;
  24:  PR[10,2:Home]=0 ;
  25:  PR[10,3:Home]=0 ;
  26:  PR[10,4:Home]=0 ;
  27:  PR[10,5:Home]=(-90) ;
  28:  PR[10,6:Home]=0 ;
  29:  !Indices and Part 5 settings ;
  30:  R[1:Column Index]=0 ;
  31:  R[2:Row Index]=0 ;
  32:  R[3:Layer Index]=0 ;
  33:  R[5:Num Columns]=3 ;
  34:  R[6:Num Rows]=2 ;
  35:  R[7:Num Layers]=2 ;
  36:  R[8:Box X mm]=300 ;
  37:  R[9:Box Y mm]=250 ;
  38:  R[10:Box Z mm]=200 ;
  39:  !Still TEACH PR[1] on conveyor ;
  40:  MESSAGE[TEACH PR1 ON CONVEYOR] ;
/POS
/END
