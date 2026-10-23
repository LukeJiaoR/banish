"""Technical atlas extraction and common transparent canvas placement only.
No painting, masking, recoloring, or anatomy manipulation; original imagegen alpha retained.
"""
from pathlib import Path
from PIL import Image,ImageDraw
import hashlib,json
here=Path(__file__).resolve().parent;root=here.parents[2];dst=root/'assets/props'
walk=Image.open(here/'generated-walk-atlas.png').convert('RGBA')
idle=Image.open(here/'generated-idle-atlas.png').convert('RGBA')
turn=Image.open(here/'generated-turn-atlas.png').convert('RGBA')
names=['deer','sheep','cattle','chicken'];rows=[0,296,543,810,1100];cols=[0,375,728,1080,1430];irows=[0,416,773,1150,1536]
scales=[116/307,116/298,116/331,116/223];iscales=[.285,.276,.245,.38]
anchors=[[266,266],[262,254],[278,266],[290,245]]
report=[]
def put(name,im,scale,cx,baseline):
 out=Image.new('RGBA',(128,128));scaled=im.resize((round(im.width*scale),round(im.height*scale)),Image.Resampling.LANCZOS)
 x=round(64-cx*scale);y=round(126-baseline*scale);out.alpha_composite(scaled,(x,y));out.save(dst/(name+'.png'))
 report.append({'file':'assets/props/'+name+'.png','sourceScale':scale,'sourceAnchor':[cx,baseline],'canvas':[128,128],'footAnchor':[64,126],'sha256':hashlib.sha256((dst/(name+'.png')).read_bytes()).hexdigest()})
for r,name in enumerate(names):
 baseline=[285,234,254,245][r]
 for c in range(4):
  im=walk.crop((cols[c],rows[r],cols[c+1],rows[r+1]));box=im.getchannel('A').point(lambda a:255 if a>16 else 0).getbbox()
  put(f'{name}_walk_{c}',im,scales[r],(box[0]+box[2])/2,baseline)
 for c,suffix in enumerate(['idle','graze']):
  im=idle.crop((c*512,irows[r],(c+1)*512,irows[r+1]));put(f'{name}_{suffix}',im,iscales[r],anchors[r][c],[393,335,365,326][r])
 tr=r//2;tc=r%2;im=turn.crop((tc*715,tr*550,(tc+1)*715,(tr+1)*550));box=im.getchannel('A').point(lambda a:255 if a>16 else 0).getbbox();target=[100,86,85,118][r]
 put(f'{name}_turn',im,target/(box[3]-box[1]),(box[0]+box[2])/2,box[3])
# Evidence only: native dimensions, then readable 4x comparison; not runtime artwork.
cv=Image.new('RGB',(980,680),'#cad4a7');d=ImageDraw.Draw(cv)
for r,name in enumerate(names):
 d.text((8,r*165+10),name,fill='black')
 for c,suffix in enumerate(['idle','walk_0','walk_1','walk_2','walk_3','graze','turn']):
  im=Image.open(dst/f'{name}_{suffix}.png');native=[26,24,32,16][r];small=im.resize((native,native),Image.Resampling.LANCZOS)
  cv.paste(small,(c*138+50,r*165+35),small);zoom=im.resize((104,104),Image.Resampling.NEAREST);cv.paste(zoom,(c*138+15,r*165+60),zoom);d.text((c*138+20,r*165+14),suffix,fill='black')
cv.save(here/'native-contact-sheet.png');(here/'export-report.json').write_text(json.dumps(report,indent=2)+'\n')
print(f'{len(report)} frames exported, originals unchanged')
