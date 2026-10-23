'use strict';
const assert=require('node:assert/strict'),path=require('node:path');const {loadGame}=require('./helpers/playability');let passed=0;
function fresh(){const G=loadGame(path.resolve(__dirname,'..'));G.newGame(1);const w=G.world;delete w.tradeVoyages;delete w.waterNavigation;w.mapVersion=3;for(const k of ['water','rock','road'])w[k].fill(0);w.bgrid.fill(-1);w.treeIdx.fill(-1);w.trees=[];w.buildings=[];w.bmap={};w.citizens=[];w.cmap={};w.families=[];w.marked.clear();w.markedRocks.clear();G.bumpNavigation(w);G.initializeDeer();G.game.h=12;G.rng=()=>.5;G.addBuilding('storage',2,2,{instant:true,free:true});Object.assign(G.game.res,{wood:200,stone:200,iron:100,grain:300,food:300,tools:30,firewood:0,coal:40});const gen=G.genWorld;G.genWorld=(seed,opt)=>{const nw=gen(seed,opt);nw.water.set(w.water);nw.rock.set(w.rock);return nw;};return G;}
const person=(G,x=20,y=10)=>G.spawnCitizen({x,y,age:30,sex:'m'});
const build=(G,type,x=15,y=10)=>{const r=G.addBuilding(type,x,y,{instant:true,free:true});assert(r.ok,r.reason);return r.b;};
const save=G=>JSON.parse(JSON.stringify(G.serializeGame()));
const near=(a,b)=>assert(Math.abs(a-b)<1e-7,a+' != '+b);
function until(G,c,done,n=10000){for(let i=0;i<n&&!done();i++)G.stepCitizen(c,.1);assert(done(),'real task failed to finish');}
function test(name,f){f();passed++;console.log('ok '+name);}

function assign(G,b,c){c.job=b.id;b.workers=[c.id];G.requestTask(c);assert(c.task);return c;}
const amount=(c,type)=>(c.carry?.type===type?c.carry.qty:0)+(c.carry?.extra?.[type]||0);
function load(G,c){const id=c.id;G.applySaveData(save(G));return G.world.cmap[id];}

test('only finished woodcutter bay opens, footprint remains occupied and every other building unchanged',()=>{
 const G=fresh(),b=build(G,'woodcutter',12,10),w=G.world;
 for(const [x,y] of [[12,10],[13,10],[12,11]])assert(G.tileBlocked(w,x,y));
 assert(!G.tileBlocked(w,13,11));assert.equal(w.bgrid[11*w.N+13],b.id);assert(!G.canPlaceRoad(w,13,11));assert(!G.canPlace(w,'well',13,11).ok);
 b.state='site';assert(G.tileBlocked(w,13,11));b.state='ok';
 b.type='blacksmith';assert(G.tileBlocked(w,13,11));b.type='woodcutter';
 for(const [x,y] of [[12,10],[13,10],[14,10],[12,11],[14,11],[12,12],[14,12]]){assert(!G.walkEdgeAllowed(w,x,y,13,11));assert(!G.walkEdgeAllowed(w,13,11,x,y));}
 assert(G.walkEdgeAllowed(w,13,12,13,11));assert(G.walkEdgeAllowed(w,13,11,13,12));assert(!G.tunnelSegmentAllowed(w,13.2,11.2,13,12));assert(G.tunnelSegmentAllowed(w,13,11.2,13,12));
 const route=G.findPathToAny(w,8,10,[{x:13,y:11}]);assert(route);assert.equal(JSON.stringify(route.path.slice(-2).map(p=>[p.x,p.y])),JSON.stringify([[13,12],[13,11]]));
 for(let i=1;i<route.path.length;i++)assert(G.walkEdgeAllowed(w,route.path[i-1].x,route.path[i-1].y,route.path[i].x,route.path[i].y));
});
test('physical pickup, door entry, full original work time, exit and six firewood delivery',()=>{
 const G=fresh(),b=build(G,'woodcutter',12,10),c=person(G,8,10);assign(G,b,c);
 let previous={x:c.x,y:c.y},entered=false;
 for(let i=0;i<10000&&!(c.task?.phase==='process'&&c.state==='work');i++){
  if(c.path&&c.path[c.pi])assert(!G.pathStepBlocked(G.world,c,c.path[c.pi]));
  G.stepCitizen(c,.025);assert(Math.hypot(c.x-previous.x,c.y-previous.y)<1,'no teleport');
  if(Math.round(c.x)===13&&Math.round(c.y)===11&&Math.round(previous.y)!==11){assert.equal(Math.round(previous.x),13);assert.equal(Math.round(previous.y),12);entered=true;}
  previous={x:c.x,y:c.y};
 }
 assert(entered);near(c.x,13);near(c.y,11);assert.equal(G.game.res.wood,198);assert.equal(G.fuelAtTask(c,c.task),true);
 const work=c.task.workLeft;assert(work>0);assert.equal(work,c.task.craftWork);
 G.setWorkerLimit(b,0);until(G,c,()=>c.carry?.type==='firewood');assert.equal(c.carry.qty,6);
 until(G,c,()=>!c.carry);assert.equal(G.game.res.firewood,6);assert.equal(c.job,null);
});
test('door blocked falls back outside; boundary workshop retains legal exterior access',()=>{
 const G=fresh(),b=build(G,'woodcutter',12,10),w=G.world,c=person(G,8,10);
 w.water[12*w.N+13]=1;G.bumpNavigation(w);const spot=G.fuelWorkSpot(w,b,c.x,c.y);assert(spot);assert(G.atMedicalDoor(spot,b));assert(!G.findPathToAny(w,c.x,c.y,[{x:13,y:11}]));
 assign(G,b,c);until(G,c,()=>c.task?.phase==='process'&&c.state==='work');assert(G.atMedicalDoor(c,b));assert(G.fuelAtTask(c,c.task));
 const H=fresh(),edge=build(H,'woodcutter',12,H.world.N-2);assert(G.tileBlocked(H.world,13,H.world.N-1));assert(G.fuelWorkSpot(H.world,edge,8,10));
});
test('legacy external in-flight process remains accepted without jumping inside',()=>{
 const G=fresh(),b=build(G,'woodcutter',12,10),c=person(G,8,10),bay=G.fuelWorkSpot;
 G.fuelWorkSpot=(w,b,x,y)=>G.workSpot(w,b,x,y);assign(G,b,c);until(G,c,()=>c.task?.phase==='process'&&c.state==='work');const pos=[c.x,c.y];G.fuelWorkSpot=bay;
 assert(G.atMedicalDoor(c,b));assert(G.fuelAtTask(c,c.task));G.stepCitizen(c,.01);assert.deepEqual([c.x,c.y],pos);
});
test('blocked exit during processing neither consumes batch nor teleports; clear door returns cargo',()=>{
 const G=fresh(),b=build(G,'woodcutter',12,10),c=person(G,8,10);assign(G,b,c);until(G,c,()=>c.task?.phase==='process'&&c.state==='work');
 G.world.water[12*G.world.N+13]=1;G.bumpNavigation(G.world);
 for(let i=0;i<50;i++)G.stepCitizen(c,.1);
 assert.equal(G.game.res.firewood,0);assert.equal(G.game.res.wood,198);assert.equal(c.carry?.type,'wood');assert.equal(c.carry.qty,2);near(c.x,13);near(c.y,11);
 G.setWorkerLimit(b,0);G.world.water[12*G.world.N+13]=0;G.bumpNavigation(G.world);until(G,c,()=>!c.carry);assert.equal(G.game.res.wood,200);assert.equal(G.game.res.firewood,0);
});
test('interior carried batch survives load and demolition without loss or fake completion',()=>{
 const G=fresh(),b=build(G,'woodcutter',12,10);let c=person(G,8,10);assign(G,b,c);until(G,c,()=>c.task?.phase==='process'&&c.state==='work');G.setWorkerLimit(b,0);
 const id=b.id;c=load(G,c);near(c.x,13);near(c.y,11);assert.equal(c.carry.qty,2);G.removeBuilding(G.world.bmap[id]);until(G,c,()=>!c.carry);assert.equal(G.game.res.wood,200);assert.equal(G.game.res.firewood,0);
});
test('blocked exit after completed batch holds six firewood and delivers once after reopening',()=>{
 const G=fresh(),b=build(G,'woodcutter',12,10),c=person(G,8,10);assign(G,b,c);G.setWorkerLimit(b,0);until(G,c,()=>c.carry?.type==='firewood');
 const pos=[c.x,c.y];G.world.water[12*G.world.N+13]=1;G.bumpNavigation(G.world);
 for(let i=0;i<100;i++)G.stepCitizen(c,.1);assert.deepEqual([c.x,c.y],pos);assert.equal(c.carry.qty,6);assert.equal(G.game.res.firewood,0);assert.equal(G.game.res.wood,198);
 G.world.water[12*G.world.N+13]=0;G.bumpNavigation(G.world);until(G,c,()=>!c.carry);assert.equal(G.game.res.firewood,6);assert.equal(G.game.res.wood,198);
});
test('fractional front-door replanning walks through the center and never stalls on axis guard',()=>{
 const G=fresh(),b=build(G,'woodcutter',12,10),c=person(G,13.3,12.3);c.job=b.id;b.workers=[c.id];
 const spot=G.fuelWorkSpot(G.world,b,c.x,c.y);assert.equal(JSON.stringify(spot.route.path),JSON.stringify([{x:13,y:12},{x:13,y:11}]));
 assert(!G.pathStepBlocked(G.world,c,spot.route.path[0]));
 assign(G,b,c);until(G,c,()=>c.task?.phase==='process'&&c.state==='work');near(c.x,13);near(c.y,11);G.setWorkerLimit(b,0);until(G,c,()=>!c.carry&&G.game.res.firewood===6);
});
test('natural diagonal interruption, saved fractional doorway and in-bay return keep real motion',()=>{
 const G=fresh(),b=build(G,'woodcutter',12,10);let c=person(G,14,13);c.job=b.id;b.workers=[c.id];
 // First reach a fractional doorway by ordinary motion, not coordinate assignment.
 G.sendTo(c,13,12);for(let i=0;i<100;i++){G.stepCitizen(c,.005);if(Math.round(c.x)===13&&Math.round(c.y)===12&&c.x!==13&&c.y!==12)break;}
 assert(Math.round(c.x)===13&&Math.round(c.y)===12&&c.x!==13&&c.y!==12);
 const position=[c.x,c.y],data=save(G);G.applySaveData(data);c=G.world.cmap[c.id];near(c.x,position[0]);near(c.y,position[1]);
 const hut=G.world.bmap[b.id],spot=G.fuelWorkSpot(G.world,hut,c.x,c.y);assert.equal(spot.route.path[0].x,13);assert.equal(spot.route.path[0].y,12);
 assign(G,hut,c);until(G,c,()=>c.task?.phase==='process'&&c.state==='work');G.setWorkerLimit(hut,0);until(G,c,()=>c.carry?.type==='firewood');
 // Stop partway through the sole exit edge, then load and physically deliver the output.
 for(let i=0;i<100;i++){G.stepCitizen(c,.005);if(c.x===13&&c.y>11&&c.y<11.5)break;}
 assert.equal(c.x,13);assert(c.y>11&&c.y<11.5);const exitY=c.y;c=load(G,c);near(c.x,13);near(c.y,exitY);assert.equal(c.carry.qty,6);until(G,c,()=>!c.carry);assert.equal(G.game.res.firewood,6);assert.equal(G.game.res.wood,198);
});
test('night rest on a naturally reached fractional doorway resumes through the physical center',()=>{
 const G=fresh(),b=build(G,'woodcutter',12,10),c=person(G,8,10);assign(G,b,c);let found=false;
 for(let i=0;i<20000;i++){G.stepCitizen(c,.005);if(c.task?.phase==='process'&&c.state==='walk'&&Math.round(c.x)===13&&Math.round(c.y)===12&&(Math.abs(c.x-13)>1e-8||c.y>12+1e-8)){found=true;break;}}
 assert(found);const cargo=c.carry,left=c.task.workLeft;G.game.h=23;G.stepCitizen(c,.01);assert.equal(c.state,'rest');G.game.h=12;G.stepCitizen(c,.01);
 assert.equal(c.carry,cargo);assert.equal(c.task.workLeft,left);assert.equal(c.path[0].x,13);assert.equal(c.path[0].y,12);assert(!G.pathStepBlocked(G.world,c,c.path[0]));
 G.setWorkerLimit(b,0);until(G,c,()=>G.game.res.firewood===6&&!c.carry);assert.equal(G.game.res.wood,198);
});
test('native axe reaches contact with constant handle, fixed feet, pause and fallback safety',()=>{
 const fs=require('fs'),vm=require('vm'),G=fresh(),ctx={G,console,performance:{now:()=>0},document:{},setTimeout(){},clearTimeout(){},matchMedia:()=>({matches:false})};
 for(const name of ['sprites','render'])vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,'../js/'+name+'.js'),'utf8'),ctx);
 const b=build(G,'woodcutter',12,10),c=person(G,8,10);assign(G,b,c);until(G,c,()=>c.task?.phase==='process'&&c.state==='work');
 G.SPR.map.set('woodcutter-a-processing-v2',{width:1056,height:704});
 let length;
 for(const phase of [0,Math.PI/4,Math.PI/2,Math.PI,Math.PI*1.5,Math.PI*2]){
  c.animT=phase;const before=JSON.stringify(G.serializeGame()),p=G.woodcutterToolPose(c);assert(p);assert.equal(JSON.stringify(G.serializeGame()),before);near(p.foot[0],64);near(p.foot[1],400);
  length??=p.handleLength;near(p.handleLength,length);near(Math.hypot(p.blade[0]-p.grip[0],p.blade[1]-p.grip[1]),length);assert(length<10);
  if(phase===Math.PI)assert(Math.hypot(p.blade[0]-p.contact[0],p.blade[1]-p.contact[1])<1e-7);
 }
 G.game.paused=true;const p=JSON.stringify(G.woodcutterToolPose(c));for(let i=0;i<20;i++)assert.equal(JSON.stringify(G.woodcutterToolPose(c)),p);
 G.SPR.map.set('woodcutter-a-processing-v2',{width:1,height:1});assert.equal(G.woodcutterToolPose(c),null);
 G.SPR.map.set('woodcutter-a-processing-v2',{width:1056,height:704});c.state='walk';assert.equal(G.woodcutterToolPose(c),null);
});
console.log('Fuel work bay: '+passed+' passed');
