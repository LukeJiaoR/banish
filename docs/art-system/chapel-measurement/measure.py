from PIL import Image,ImageDraw,ImageFont
import json,math,hashlib
from pathlib import Path
root=Path(__file__).resolve().parents[3];out=Path(__file__).parent
src=Image.open(root/'assets/buildings/chapel.png');k=207.36/448
rows=[{'id':'outer plinth silhouette','points':[[224,481],[440,393]],'uncertainty_each_axis':3}, {'id':'wall bed joint, interrupted by pilasters','points':[[243,431],[413,362]],'uncertainty_each_axis':4}]
for r in rows:
 (x,y),(u,v)=r['points'];dx=u-x;dy=y-v;e=r['uncertainty_each_axis'];r.update(slope=dy/dx,angle_degrees=math.degrees(math.atan(dy/dx)),slope_range=[(dy-2*e)/(dx+2*e),(dy+2*e)/(dx-2*e)],native_endpoint_delta_vs_2to1=(dx*.5-dy)*k)
font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',16)
# Diagnostic only, source unchanged. White compositing respects alpha.
im=Image.new('RGB',(1000,1100),'#eee9dd');im.paste(src.resize((896,992)),(52,70),src.resize((896,992)).getchannel('A'));d=ImageDraw.Draw(im)
d.text((20,10),'CHAPEL: source 2x diagnostic (not native scale)',fill='black',font=font)
for r,c in zip(rows,['#ed2070','#0068cf']):
 a,b=r['points'];p=(52+2*a[0],70+2*a[1]);q=(52+2*b[0],70+2*b[1]);d.line((*p,*q),fill=c,width=3)
 for X,Y in [p,q]:d.ellipse((X-5,Y-5,X+5,Y+5),outline=c,width=2)
 z=(q[0],p[1]-(b[0]-a[0]));d.line((*p,*z),fill='#159b88',width=2)
d.text((20,1070),'Pink: silhouette; blue: wall joint; teal: 2:1. Roof slopes excluded.',fill='black',font=font);im.save(out/'chapel-lines.png')
# Native diagnostic: left unmarked actual image; right identical pixels + 2:1 footprint and selected joint.
im=Image.new('RGB',(1300,1050),'#e8e3d5');d=ImageDraw.Draw(im);d.text((20,12),'CHAPEL actual renderer dimensions | left untouched / right guides only',fill='black',font=font)
for z,baseline in [(.75,240),(1,545),(2,1030)]:
 width=207.36*z;height=496*k*z
 for x,guide in [(300,False),(950,True)]:
  B=baseline;top=B+6*z-height;pic=src.resize((round(width),round(height)),Image.Resampling.LANCZOS);im.paste(pic,(round(x-width/2),round(top)),pic.getchannel('A'))
  if guide:
   d.line([(x,B),(x+96*z,B-48*z),(x,B-96*z),(x-96*z,B-48*z),(x,B)],fill='#159b88',width=1)
   for r,c in zip(rows,['#ed2070','#0068cf']):
    a,b=r['points'];d.line((x-width/2+a[0]*k*z,top+a[1]*k*z,x-width/2+b[0]*k*z,top+b[1]*k*z),fill=c,width=1)
 d.text((20,baseline-round(height)),f'{z}x zoom; width {width:.2f}px',fill='black',font=font)
im.save(out/'chapel-native-comparison.png')
report={'source_sha256':hashlib.sha256((root/'assets/buildings/chapel.png').read_bytes()).hexdigest(),'method':'Manual endpoints on alpha-composited PNG; interrupted wall-plane bed joint excludes protruding pilaster seams. Approximate endpoints, not fitted or architectural truth. Guide is comparison, not mandated correction.','rows':rows,'anchors':{'chapel':{'canvas_bottom':496,'front_tip':483,'scale':k,'required_offset':13*k,'actual_offset':6},'market':{'canvas_bottom':320,'front_tip':317,'scale':.5,'required_offset':1.5,'actual_offset':1.5}},'status':'Measurement only. No runtime or asset edits. Original native visual assessment required before any correction.'}
(out/'measurement.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))
