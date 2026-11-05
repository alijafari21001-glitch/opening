# Splits the PL-01 layout STL into colored groups by connected-component size; run comp step first (see make-pl01.ts).
import numpy as np,sys,gzip,base64,json,struct
src=sys.argv[1]
d=open(src,'rb').read()
rec=np.frombuffer(d[84:],dtype=np.dtype([('n','<3f4'),('v','<9f4'),('a','<u2')]))
cid=np.load('cid.npy');mn=np.load('mn.npy');mx=np.load('mx.npy');s=np.round(mx-mn).astype(int)
xy=np.sort(s[:,:2],1); z=s[:,2]
cat=np.full(len(s),'equipment',dtype=object)
cat[(mx[:,2]<=25)]='markings'
cat[(mx[:,2]<=0)]='floor'
fence=((xy[:,0]<=6)&(xy[:,1]<=6)&(z>1800)&(z<2300))|((xy[:,0]<=60)&(xy[:,1]<=60)&(z>=2150)&(z<=2250))
cat[fence]='fence'
roll=((xy[:,0]==50)&(xy[:,1]==50)&(z==600))|((xy[:,0]==12)&(xy[:,1]==12)&(z==616))|((xy[:,0]==50)&(xy[:,1]==600)&(z==50))|((xy[:,0]==12)&(xy[:,1]==616)&(z==12))
cat[roll]='rollers'
bins=(xy[:,0]==400)&(xy[:,1]==480)&((z==240)|(z==200))
cat[bins]='bins'
case=(abs(xy[:,0]-400)<=5)&(abs(xy[:,1]-600)<=5)&(abs(z-400)<=5)
case|=(abs(xy[:,0]-400)<=5)&(abs(xy[:,1]-400)<=5)&(abs(z-600)<=5)
cat[case]='cases'
pal=((xy[:,0]==100)&(xy[:,1]==1016)&(z==16))|((xy[:,0]==100)&(xy[:,1]==1219)&(z==16))
cat[pal]='pallets'
tc=cat[cid]
out={}
for k in sorted(set(cat)):
    r=rec[tc==k]
    if not len(r): continue
    b=b'OpenCell PL-01 '+k.encode(); b=b.ljust(80,b' ')+struct.pack('<I',len(r))+r.tobytes()
    open(f'pl01_{k}.stl','wb').write(b)
    out[k]=base64.b64encode(gzip.compress(b,9)).decode()
    print(k,(cat==k).sum(),len(r),len(out[k]))
json.dump(out,open('meshes.json','w'))
