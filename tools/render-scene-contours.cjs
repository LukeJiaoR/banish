'use strict';
// Offline production Canvas comparison. No browser, UI layout or device claim.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const {createCanvas,loadImage}=require('@napi-rs/canvas');
const root=path.resolve(__dirname,'..'),out=process.argv[2];
if(!out)throw Error('Output directory required');fs.mkdirSync(out,{recursive:true});
const context={console,performance,setTimeout(){},clearTimeout(){},addEventListener(){},document:{createElement:()=>createCanvas(1,1)},localStorage:{getItem(){return null}},matchMedia:()=>({matches:true})};context.window=context;vm.createContext(context);
for(const name of ['core','defs','map','sim','fire','supply','sprites','render','main'])vm.runInContext(fs.readFileSync(path.join(root,'js',name+'.js'),'utf8'),context,{filename:name+'.js'});
const G=context.G;G.ui={refreshPlacement(){},refreshHarvest(){},hideInfo(){},setToolActive(){},refreshHUD(){},toast(){}};
(async()=>{
for(const dir of fs.readdirSync(path.join(root,'assets'))){const folder=path.join(root,'assets',dir);if(!fs.statSync(folder).isDirectory())continue;for(const file of fs.readdirSync(folder).filter(x=>x.endsWith('.png')))G.SPR.map.set(file.slice(0,-4),await loadImage(path.join(folder,file)));}
const {createScene,pose}=require('./riverbay-lab/scene');const scene=createScene(G);if(scene.failures.length)throw Error(JSON.stringify(scene.failures));pose(scene,6.5);
// Add a legal, unoccupied northern ridge to the authored fixture, not a played save.
for(let y=1;y<=6;y++)for(let x=8;x<=16;x++){const i=y*32+x;if(G.world.bgrid[i]>=0||G.world.water[i])throw Error('Occupied ridge');G.world.mountain[i]=1;}
G.world.trees=G.world.trees.filter(t=>!G.isMountain(G.world,t.x,t.y));G.world.treeIdx.fill(-1);G.world.trees.forEach((t,i)=>G.world.treeIdx[t.y*32+t.x]=i);
// Pin the comparison to the merged UI baseline, never to a moving remote ref.
const baselineCommit='5710d96';
const baseline=require('node:child_process').execFileSync('git',['show',baselineCommit+':js/render.js'],{cwd:root,encoding:'utf8'});
const candidate=fs.readFileSync(path.join(root,'js/render.js'),'utf8');
const report={engine:'@napi-rs/canvas, offline production renderer; not browser or physical phone validation',baselineCommit, candidateRendererSha256:crypto.createHash('sha256').update(candidate).digest('hex'), scene:{kind:scene.kind,buildings:G.world.buildings.length,citizens:G.world.citizens.length,trees:G.world.trees.length,mountainTiles:G.world.mountain.reduce((a,b)=>a+b,0)},cases:[]};
const gameState=()=>JSON.stringify([G.world,G.game],(k,v)=>['_chimney','_psx','_fx'].includes(k)?undefined:v);
for(const season of [0,1,2,3])for(const [viewport,width,height]of [['desktop',1227,763],['narrow',390,620]])for(const zoom of [.75,1,2]){
const canvases=[];
for(const choice of ['baseline','candidate']){
vm.runInContext(choice==='baseline'?baseline:candidate,context,{filename:choice+'-render.js'});
G.game.season=season;G.cv=createCanvas(width,height);G.cv.clientWidth=width;G.cv.clientHeight=height;G.ctx=G.cv.getContext('2d');G.dpr=1;G.cam.z=zoom;const [x,y]=G.T2S(14,14);G.cam.x=width*.5-x*zoom;G.cam.y=height*.48-y*zoom;G.groundScale=.68;G.needGround=true;
const before=gameState();G.frame(0);if(before!==gameState())throw Error('Renderer changed gameplay state');
const filename=`${viewport}-s${season}-z${zoom}-${choice}.png`;fs.writeFileSync(path.join(out,filename),G.cv.toBuffer('image/png'));canvases.push(G.cv);report.cases.push({season,viewport,width,height,zoom,choice,filename,gameplayUnchanged:true});
}
const pair=createCanvas(width*2,height+26),ctx=pair.getContext('2d');ctx.fillStyle='#20231f';ctx.fillRect(0,0,pair.width,pair.height);ctx.fillStyle='#fff';ctx.font='14px sans-serif';canvases.forEach((cv,i)=>{ctx.fillText(['main 5710d96 / offline','contour candidate / offline'][i],i*width+10,18);ctx.drawImage(cv,i*width,26);});fs.writeFileSync(path.join(out,`${viewport}-s${season}-z${zoom}-compare.png`),pair.toBuffer('image/png'));
}
// Add legal original dock/bridge sprites to inspect coast contacts. These are
// authored fixture operations, not a claim of completed live-game play.
let dock=null,bridge=null;G.game.res.wood=G.game.res.stone=10000;
for(let y=2;y<30&&!dock;y++)for(let x=2;x<28&&!dock;x++)if(G.canPlace(G.world,'dock',x,y).ok){const r=G.addBuilding('dock',x,y,{instant:true,free:true});if(r.ok)dock=r.b;}
for(let y=2;y<30&&!bridge;y++)for(let x=2;x<28&&!bridge;x++)for(let length=2;length<9&&!bridge&&x+length<31;length++){
 const start={x,y},end={x:x+length,y};if(!G.planBridge(G.world,start,end).ok)continue;const r=G.addBridge(start,end);if(r.ok){r.b.workLeft=0;r.b.construction.consumed=true;G.finishBuilding(r.b);if(r.b.state!=='ok')throw Error('Authored completed bridge fixture failed');bridge=r.b;}
}
if(!dock||!bridge)throw Error('Legal dock/bridge fixture unavailable');
for(const season of [1,3]){
 const canvases=[];
 for(const choice of ['baseline','candidate']){
  vm.runInContext(choice==='baseline'?baseline:candidate,context,{filename:choice+'-render.js'});
  G.game.season=season;G.cv=createCanvas(1227,763);G.cv.clientWidth=1227;G.cv.clientHeight=763;G.ctx=G.cv.getContext('2d');G.dpr=1;G.cam.z=1;const [x,y]=G.T2S(18,18);G.cam.x=613-x;G.cam.y=390-y;G.groundScale=.68;G.needGround=true;
  const before=gameState();G.frame(0);if(before!==gameState())throw Error('Structures render changed gameplay state');const filename=`structures-s${season}-${choice}.png`;fs.writeFileSync(path.join(out,filename),G.cv.toBuffer('image/png'));canvases.push(G.cv);report.cases.push({fixture:'authored legal dock and completed bridge; construction completion set for visual fixture, not simulated play',season,choice,filename,dock:{x:dock.x,y:dock.y},bridge:{x:bridge.x,y:bridge.y,w:bridge.w,h:bridge.h},gameplayUnchanged:true});
 }
 const pair=createCanvas(2454,789),c=pair.getContext('2d');c.fillStyle='#20231f';c.fillRect(0,0,2454,789);c.fillStyle='#fff';c.font='14px sans-serif';canvases.forEach((cv,i)=>{c.fillText(['main5710d96 dock + bridge / offline','candidate dock + bridge / offline'][i],i*1227+10,18);c.drawImage(cv,i*1227,26);});fs.writeFileSync(path.join(out,`structures-s${season}-compare.png`),pair.toBuffer('image/png'));
}
// Additional real map ridge: the authored rectangle is not representative of
// generated mountain silhouettes. Same seed, focus and state for both renders.
G.world=G.genWorld(0,{terrain:'mountain'});G.game=G.newGameState();G.game.h=10;G.game.paused=true;
const w=G.world,near=[];
for(let y=3;y<w.N-3;y++)for(let x=3;x<w.N-3;x++)if(G.isMountain(w,x,y)){
 let count=0;for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++)count+=!!G.isMountain(w,x+dx,y+dy);
 if(count>=20)near.push({x,y,d:Math.hypot(x-w.N/2,y-w.N/2)});
}
near.sort((a,b)=>a.d-b.d);const focus=near[0];if(!focus)throw Error('No real generated ridge');
for(const season of [1,3]){
 const canvases=[];
 for(const choice of ['baseline','candidate']){
  vm.runInContext(choice==='baseline'?baseline:candidate,context,{filename:choice+'-render.js'});
  G.game.season=season;G.cv=createCanvas(1227,763);G.cv.clientWidth=1227;G.cv.clientHeight=763;G.ctx=G.cv.getContext('2d');G.dpr=1;G.cam.z=1;const [x,y]=G.T2S(focus.x,focus.y);G.cam.x=613-x;G.cam.y=390-y;G.groundScale=.5;G.needGround=true;
  const before=gameState();G.frame(0);if(before!==gameState())throw Error('Real-map render changed gameplay state');
  const groundBuildMs=[];for(let n=0;n<3;n++){G.needGround=true;const start=performance.now();G.buildGround();groundBuildMs.push(performance.now()-start);}
  const filename=`real-ridge-s${season}-${choice}.png`;fs.writeFileSync(path.join(out,filename),G.cv.toBuffer('image/png'));canvases.push(G.cv);report.cases.push({fixture:'real generated seed0 mountain map',focus,season,choice,filename,groundBuildMs,groundCanvas:[G._gcv.width,G._gcv.height],gameplayUnchanged:true});
 }
 const pair=createCanvas(2454,789),c=pair.getContext('2d');c.fillStyle='#20231f';c.fillRect(0,0,2454,789);c.fillStyle='#fff';c.font='14px sans-serif';canvases.forEach((cv,i)=>{c.fillText(['main5710d96 real seed0 / offline','candidate real seed0 / offline'][i],i*1227+10,18);c.drawImage(cv,i*1227,26);});fs.writeFileSync(path.join(out,`real-ridge-s${season}-compare.png`),pair.toBuffer('image/png'));
}
fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report.scene));console.log(`${report.cases.length} offline render cases passed`);
})().catch(e=>{console.error(e);process.exitCode=1;});
