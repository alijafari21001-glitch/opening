/PROG  PALPICK
/ATTR
OWNER		= MNEDITOR;
COMMENT		= "Pick one box";
PROG_SIZE	= 0;
CREATE		= DATE 26-11-02  TIME 12:00:00;
MODIFIED	= DATE 26-11-02  TIME 12:00:00;
FILE_NAME	= ;
VERSION		= 0;
LINE_COUNT	= 11;
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
   1:  !Pick one box from PR1 ;
   2:  !Pick approach ;
   3:  L PR[1:Pick Position] 500mm/sec FINE Offset,PR[98:Z Offset] ;
   4:  !Pick ;
   5:  L PR[1:Pick Position] 100mm/sec FINE ;
   6:  CALL G_CLOSE ;
   7:  WAIT .30(sec) ;
   8:  !Pick retreat ;
   9:  L PR[1:Pick Position] 500mm/sec FINE Offset,PR[98:Z Offset] ;
  10:  !Home after pick ;
  11:  J PR[10:Home] 30% FINE ;
/POS
/END
