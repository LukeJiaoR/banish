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
 let b;const center=w.buildings[0];for(let radius=2;radius<16&&!b;radius++)for(let dx=-radius;dx<=radius&&!b;dx++)for(let dy=-radius;dy<=radius&&!b;dy++){const r=G.addBuilding('house',center.x+dx,center.y+dy,{instant:true,free:true});if(r.ok)b=r.b;}assert(b,'valid house site required');const assigned=w.families[0];assigned.houseId=b.id;b.family=assigned.id;
 const families=w.families.filter(f=>f.houseId===b.id);const residents=families.flatMap(f=>f.members.map(id=>w.cmap[id])).filter(Boolean);assert(residents.length);
 const report=[];if(process.argv[3]==='winter')G.game.season=3;
 for(const state of ['away','home','vacant']){
  for(const c of residents){c.x=b.x-1;c.y=b.y;c.state=state==='home'?'rest':'idle';c.camped=false;c.path=null;}
  if(state==='vacant')for(const f of families)f.houseId=null;
  assert.equal(G.buildingActivity(b).state,state);
  for(const z of [1,2]){
   const width=1100,height=720;G.cv=createCanvas(width,height);G.cv.clientWidth=width;G.cv.clientHeight=height;G.ctx=G.cv.getContext('2d');G.dpr=1;G.cam.z=z;const [x,y]=G.T2S(b.x+1,b.y+1);G.cam.x=width/2-x*z;G.cam.y=height/2+60-y*z;G.groundScale=.5;G.needGround=true;
   const before=JSON.stringify(G.serializeGame());G.frame(0);assert.equal(JSON.stringify(G.serializeGame()),before);
   const file=state+'-z'+z+'.png';fs.writeFileSync(path.join(out,file),G.cv.toBuffer('image/png'));report.push({file,state,atHome:G.buildingActivity(b).atHome,selected:G.houseArtName(b),saveUnchanged:true});
  }
 }
 fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log('6 real-frame scenes, save unchanged; away/home/vacant verified');
})().catch(e=>{console.error(e);process.exitCode=1;});
