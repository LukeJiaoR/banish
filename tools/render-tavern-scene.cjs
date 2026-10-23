'use strict';
// Production Canvas frames from explicit occupancy fixtures; no full daily-cycle/browser claim.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const {createCanvas,loadImage}=require('@napi-rs/canvas'),root=path.resolve(__dirname,'..'),out=process.argv[2];if(!out)throw Error('Output directory required');fs.mkdirSync(out,{recursive:true});
const context={console,performance,setTimeout(){},clearTimeout(){},addEventListener(){},document:{getElementById:()=>({classList:{add(){}}}),createElement:()=>createCanvas(1,1)},localStorage:{getItem(){return null}},matchMedia:()=>({matches:true})};context.window=context;vm.createContext(context);
for(const name of ['core','defs','map','sim','fire','supply','sprites','render','main'])vm.runInContext(fs.readFileSync(path.join(root,'js',name+'.js'),'utf8'),context,{filename:name+'.js'});
const G=context.G;G.autosave=()=>{};G.ui={refreshPlacement(){},refreshHarvest(){},hideInfo(){},setToolActive(){},refreshHUD(){},toast(){}};
(async()=>{
 for(const dir of fs.readdirSync(path.join(root,'assets'))){const folder=path.join(root,'assets',dir);if(!fs.statSync(folder).isDirectory())continue;for(const file of fs.readdirSync(folder).filter(x=>x.endsWith('.png')))G.SPR.map.set(file.slice(0,-4),await loadImage(path.join(folder,file)));}
 assert(G.newGame(17,{climate:'fair',preserveSaves:true}).ok);const w=G.world;

 for(const k of ['water','rock','road'])w[k].fill(0);w.bgrid.fill(-1);w.treeIdx.fill(-1);w.trees=[];w.buildings=[];w.bmap={};w.citizens=[];w.cmap={};w.families=[];G.bumpNavigation(w);G.game.h=12;G.rng=()=>.5;
 G.addBuilding('storage',2,2,{instant:true,free:true});Object.assign(G.game.res,{wood:200,iron:200,grain:1000,apples:1000,pears:1000,food:1000,tools:20});
 const r=G.addBuilding('tavern',12,10,{instant:true,free:true});assert(r.ok);const b=r.b;
 const report=[];let citizen;
 for(const state of ['unstaffed','hosting','fetching','processing','paused','stopped','blocked','winter']){
  if(state==='hosting'){citizen=G.spawnCitizen({x:8,y:10,age:30,sex:'m'});citizen.job=b.id;b.workers=[citizen.id];G.game.res.ale=5;G.game.res.grain=0;G.requestTask(citizen);assert.equal(citizen.task.kind,'host');for(let i=0;i<3000&&citizen.state!=='work';i++)G.stepCitizen(citizen,.05);assert(G.tavernStaff(b));assert.equal(G.tavernArtName(b),'tavern');}
  if(state==='fetching'){citizen.task=null;citizen.state='idle';G.game.res.grain=1000;G.reconcileFood();G.requestTask(citizen);assert.equal(citizen.task.phase,'fetch');}
  if(state==='processing'){for(let i=0;i<3000&&!(citizen.task?.phase==='process'&&citizen.state==='work');i++)G.stepCitizen(citizen,.05);assert.equal(G.tavernArtName(b),'tavern-a-processing');}
  if(state==='paused')G.game.paused=true;
  if(state==='stopped'){G.game.paused=false;citizen.state='idle';}
  if(state==='blocked'){citizen.task=null;citizen.carry=null;G.game.res.grain=0;G.game.res.food=0;assert.equal(G.buildingActivity(b).state,'blocked');}
  if(state==='winter')G.game.season=3;
  for(const z of [1,2]){
   const width=900,height=600;G.cv=createCanvas(width,height);G.cv.clientWidth=width;G.cv.clientHeight=height;G.ctx=G.cv.getContext('2d');G.dpr=1;G.cam.z=z;const [x,y]=G.T2S(b.x+1,b.y+1);G.cam.x=width/2-x*z;G.cam.y=height/2+60-y*z;G.groundScale=.25;G.needGround=!G._gcv||state==='winter';
   const before=JSON.stringify(G.serializeGame());G.frame(0);assert.equal(JSON.stringify(G.serializeGame()),before);
   const file=state+'-z'+z+'.png';fs.writeFileSync(path.join(out,file),G.cv.toBuffer('image/png'));report.push({file,state,selected:G.tavernArtName(b),citizen:citizen?{x:citizen.x,y:citizen.y,state:citizen.state,phase:citizen.task?.phase,depth:citizen.x+citizen.y+.01}:null,buildingDepth:b.x+b.y+b.w+b.h-2-.5,saveUnchanged:true});if(global.gc)global.gc();
  }
 }
 // Paired native-scale drawBuilding views keep camera/footpoint identical.
 const canvas=createCanvas(1000,730),ctx=canvas.getContext('2d');ctx.fillStyle='#e7e3ce';ctx.fillRect(0,0,1000,730);
 for(const z of [1,2])for(const [i,name] of ['tavern','tavern-a-processing'].entries()){
  const x=250+i*500,y=z===1?230:680;const drawn=G.drawCalibratedArt(ctx,name,x,y,(b.w+b.h)*32*z);const alphaSpan=name==='tavern-a-processing'?425:418;assert(Math.abs(drawn[0]*alphaSpan/448-(b.w+b.h)*32*z*G.BUILD_SPR_W[b.type]*418/448)<1e-9,'paired visible silhouette must use the real building footprint at native zoom');ctx.fillStyle='#253d31';ctx.font='15px sans-serif';ctx.fillText(name+' / '+z+'x',x-140,y+24);
 }
 fs.writeFileSync(path.join(out,'paired-calibration.png'),canvas.toBuffer('image/png'));
 fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log('16 real-frame scenes and paired calibration, save unchanged');
})().catch(e=>{console.error(e);process.exitCode=1;});
