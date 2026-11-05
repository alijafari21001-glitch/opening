/PROG  PALPLACE
/ATTR
OWNER		= MNEDITOR;
COMMENT		= "Place one box";
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
   1:  !Place box at R1 R2 R3 spot ;
   2:  !Calculate pallet offset ;
   3:  PR[3,1:Working Offset]=R[1:Column Index]*R[8:Box X mm] ;
   4:  PR[3,2:Working Offset]=R[2:Row Index]*R[9:Box Y mm] ;
   5:  PR[3,3:Working Offset]=R[3:Layer Index]*R[10:Box Z mm] ;
   6:  !Place position = base + offset ;
   7:  PR[4:Place Position]=PR[2:Pallet Base]+PR[3:Working Offset] ;
   8:  !Place approach ;
   9:  L PR[4:Place Position] 500mm/sec FINE Offset,PR[98:Z Offset] ;
  10:  !Place ;
  11:  L PR[4:Place Position] 100mm/sec FINE ;
  12:  CALL G_OPEN ;
  13:  WAIT .30(sec) ;
  14:  !Save place to LPOS PR ;
  15:  PR[5:LPOS Holder]=LPOS ;
  16:  !Place retreat ;
  17:  L PR[5:LPOS Holder] 500mm/sec FINE Offset,PR[98:Z Offset] ;
  18:  !Home after place ;
  19:  J PR[10:Home] 30% FINE ;
/POS
/END
