'use strict';
// Isolated production Canvas evidence; no browser, device or play-session claim.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const {createCanvas,loadImage}=require('@napi-rs/canvas');
const root=path.resolve(__dirname,'..'),out=process.argv[2];if(!out)throw Error('output directory required');fs.mkdirSync(out,{recursive:true});
const context={console,performance,setTimeout(){},clearTimeout(){},addEventListener(){},document:{createElement:()=>createCanvas(1,1)},localStorage:{getItem(){return null}},matchMedia:()=>({matches:true})};context.window=context;vm.createContext(context);
for(const n of ['core','defs','map','sim','fire','supply','sprites','render','main'])vm.runInContext(fs.readFileSync(path.join(root,'js',n+'.js'),'utf8'),context);
const G=context.G;G.ui={refreshPlacement(){},refreshHarvest(){},hideInfo(){},setToolActive(){},refreshHUD(){},toast(){}};
(async()=>{
for(const dir of fs.readdirSync(path.join(root,'assets'))){const folder=path.join(root,'assets',dir);if(!fs.statSync(folder).isDirectory())continue;for(const f of fs.readdirSync(folder).filter(x=>x.endsWith('.png')))G.SPR.map.set(f.slice(0,-4),await loadImage(path.join(folder,f)));}
const baseline=require('node:child_process').execFileSync('git',['show','97bb129:js/render.js'],{cwd:root,encoding:'utf8'}),candidate=fs.readFileSync(path.join(root,'js/render.js'),'utf8');
const report={baseline:'97bb129',rendererSha256:crypto.createHash('sha256').update(candidate).digest('hex'),engine:'offline production Canvas, not browser/device',cases:[]};
function stress(){const w=G.emptyWorld(0,0,32);for(const[x,y]of [[8,8],[10,10],[11,11],[12,12],[14,9],[14,10],[15,9]])w.mountain[y*w.N+x]=1;for(let y=15;y<21;y++)for(let x=9;x<20;x++)if(!(x===13&&y===17))w.mountain[y*w.N+x]=1;return w;}
function tunnel(){const w=stress(),b={id:99,type:'tunnel',x:8,y:18,w:13,h:1,tunnelAxis:'x',tunnelStart:0,state:'ok',progress:1,workers:[]};w.bmap[b.id]=b;w.buildings=[b];for(let x=8;x<=20;x++)w.bgrid[18*w.N+x]=b.id;return w;}
for(const fixture of ['real','stress','tunnel'])for(const season of [1,3])for(const narrow of [false,true]){
 const w=fixture==='real'?G.genWorld(0,{terrain:'mountain'}):fixture==='stress'?stress():tunnel();
 const width=narrow?390:1227,height=narrow?620:763,zoom=narrow?.55:1,focus=fixture==='real'?[60,61]:[13,14];
 const label=`${fixture}-s${season}-${narrow?'narrow':'desktop'}`,pair=createCanvas(width*2,height+26),p=pair.getContext('2d');p.fillStyle='#20231f';p.fillRect(0,0,pair.width,pair.height);
 for(const [j,choice]of ['baseline','candidate'].entries()){
  vm.runInContext(choice==='baseline'?baseline:candidate,context);G.world=w;G.game=G.newGameState();G.game.h=10;G.game.paused=true;G.game.season=season;G.cv=createCanvas(width,height);G.ctx=G.cv.getContext('2d');G.cv.clientWidth=width;G.cv.clientHeight=height;G.dpr=1;
  const [x,y]=G.T2S(...focus);G.cam={x:width/2-x*zoom,y:height/2-y*zoom,z:zoom};G.groundScale=.5;G.needGround=true;G.tool=null;G.hover={tx:-1,ty:-1};
  const before=JSON.stringify([G.world,G.game]);G.frame(0);if(before!==JSON.stringify([G.world,G.game]))throw Error('render mutated fixture');
  const name=label+'-'+choice+'.png';fs.writeFileSync(path.join(out,name),G.cv.toBuffer('image/png'));p.fillStyle='#fff';p.font='14px sans-serif';p.fillText(choice+' / offline',j*width+8,18);p.drawImage(G.cv,j*width,26);report.cases.push({fixture,season,narrow,zoom,choice,name});
 }
 fs.writeFileSync(path.join(out,label+'-compare.png'),pair.toBuffer('image/png'));
}
// Exact rejected tile overlay remains available over the relaxed isolated rock.
vm.runInContext(candidate,context);G.world=stress();G.game=G.newGameState();G.game.season=1;G.game.paused=true;G.cv=createCanvas(900,600);G.ctx=G.cv.getContext('2d');G.cv.clientWidth=900;G.cv.clientHeight=600;G.dpr=1;const [x,y]=G.T2S(8,8);G.cam={x:450-x*2,y:280-y*2,z:2};G.groundScale=.5;G.needGround=true;G.tool={kind:'build',type:'house'};G.hover={tx:8,ty:8};if(G.canPlace(G.world,'house',8,8).ok)throw Error('expected rejected mountain placement');G.frame(0);fs.writeFileSync(path.join(out,'blocked-preview.png'),G.cv.toBuffer('image/png'));
fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');
})().catch(e=>{console.error(e);process.exitCode=1;});
