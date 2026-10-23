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
 const report=[];
 const candidate=G.SPR.get('storage-a-v2');let variant='legacy';
 const b=w.buildings.find(b=>b.type==='storage'),allBuildings=w.buildings.slice(),calls=[];
 const helper=G.sprDraw;G.sprDraw=function(ctx,n,cx,by,o){if(n==='storage')calls.push({name:n,cx,by,width:o.w,alpha:ctx.globalAlpha});return helper(ctx,n,cx,by,o)};
 const people=w.citizens.filter(c=>c.age>=G.ADULT_AGE).slice(0,4),spots=[[b.x+1,b.y-1],[b.x+3,b.y+1],[b.x+1,b.y+3],[b.x-1,b.y+1]];
 people.forEach((c,i)=>{c.x=spots[i][0];c.y=spots[i][1];c.state='idle';c.path=null;c.task=null;c.camped=false});
 for(const version of ['legacy','candidate'])for(const mode of ['completed','preview'])for(const z of [1,2]){
 variant=version;if(version==='legacy')G.SPR.map.delete('storage-a-v2');else G.SPR.map.set('storage-a-v2',candidate);w.buildings=mode==='preview'?allBuildings.filter(v=>v!==b):allBuildings.slice();G.tool=mode==='preview'?{kind:'build',type:'storage'}:null;
 // Only placement-state fixture is stubbed; production G.frame sorting and preview drawing execute unchanged.
 G.currentBuildingPlacement=()=>mode==='preview'?{type:'storage',ox:b.x,oy:b.y}:null;G.buildingPlacementStatus=()=>({ok:true});
 G.game.season=1;G.cv=createCanvas(1100,720);G.cv.clientWidth=1100;G.cv.clientHeight=720;G.ctx=G.cv.getContext('2d');G.dpr=1;G.cam.z=z;const [cx,cy]=G.T2S(b.x+1.5,b.y+1.5);G.cam.x=550-cx*z;G.cam.y=460-cy*z;G.groundScale=.5;G.needGround=true;calls.length=0;
 const before=JSON.stringify(G.serializeGame());G.frame(0);assert.equal(JSON.stringify(G.serializeGame()),before);assert(calls.length,'production storage draw not reached');
 const raw=`${version}-${mode}-z${z}.png`;fs.writeFileSync(path.join(out,raw),G.cv.toBuffer('image/png'));
 const ctx=G.ctx;ctx.save();ctx.translate(G.cam.x,G.cam.y);ctx.scale(z,z);
 const corners=[[b.x,b.y],[b.x+3,b.y],[b.x+3,b.y+3],[b.x,b.y+3]].map(p=>G.T2S(...p));
 ctx.strokeStyle='#ff3ca0';ctx.lineWidth=1.5/z;ctx.beginPath();corners.forEach((p,i)=>i?ctx.lineTo(...p):ctx.moveTo(...p));ctx.closePath();ctx.stroke();
 ctx.font=(13/z)+'px sans-serif';corners.forEach((p,i)=>{ctx.fillStyle='#ff3ca0';ctx.beginPath();ctx.arc(...p,3/z,0,7);ctx.fill();ctx.fillText(['T hidden','R obscured','B anchor','L visible'][i],p[0]+5/z,p[1]-5/z)});
 spots.forEach((p,i)=>{const q=G.T2S(...p);q[1]+=16;ctx.strokeStyle='#00e9ff';ctx.beginPath();ctx.arc(...q,4/z,0,7);ctx.stroke();ctx.fillStyle='#00e9ff';ctx.fillText('P'+(i+1),q[0]+5/z,q[1]+12/z)});ctx.restore();
 const file=`${version}-${mode}-overlay-z${z}.png`;fs.writeFileSync(path.join(out,file),G.cv.toBuffer('image/png'));report.push({file,raw,variant:version,mode,zoom:z,camera:{...G.cam},calls:calls.slice(),people:spots,saveUnchanged:true,previewPlacementEligibility:'fixture stub; not tested',browserVerified:false});
 }
 for(const version of ['legacy','candidate'])for(const z of [1,2]){const a=report.find(r=>r.variant===version&&r.zoom===z&&r.mode==='completed').calls[0],p=report.find(r=>r.variant===version&&r.zoom===z&&r.mode==='preview').calls[0];assert.equal(a.cx,p.cx);assert.equal(a.by,p.by);assert.equal(a.width,p.width);assert(Math.abs(p.alpha-.65)<.01);}
 fs.writeFileSync(path.join(out,'projection-audit.json'),JSON.stringify(report,null,2));console.log('8 production frames; completed/preview same helper, anchor, width; all saves unchanged. Placement eligibility intentionally not claimed.');
})().catch(e=>{console.error(e);process.exitCode=1});
