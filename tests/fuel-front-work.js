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

// Minimal regression: generic nearest perimeter is behind the roof; fuel apron is in front.
test('open-bay routing fixes the reproduced roof occlusion without changing generic doors',()=>{
 const G=fresh(),b=build(G,'woodcutter',12,10),c=person(G,8,10);
 const old=G.workSpot(G.world,b,c.x,c.y),spot=G.fuelWorkSpot(G.world,b,c.x,c.y);
 assert(old.x+old.y<b.x+b.y+b.w+b.h-2-.5);
 assert(spot.x+spot.y>b.x+b.y+b.w+b.h-2-.5);assert(G.fuelAtWorksite(spot,b));assert.equal(spot.x,b.x+1);assert.equal(spot.y,b.y+1);
 assert.deepEqual({x:old.x,y:old.y},{x:G.workSpot(G.world,b,c.x,c.y).x,y:G.workSpot(G.world,b,c.x,c.y).y});
});
test('front blocked falls back to reachable rear; all sides blocked returns null',()=>{
 const G=fresh(),b=build(G,'woodcutter',12,10),c=person(G,8,10),w=G.world;
 const front=G.fuelWorkSpot(w,b,c.x,c.y);w.water[front.y*w.N+front.x]=1;G.bumpNavigation(w);
 const next=G.fuelWorkSpot(w,b,c.x,c.y);assert(next);assert(next.x!==front.x||next.y!==front.y);
 for(let y=b.y;y<=b.y+b.h;y++)for(let x=b.x;x<=b.x+b.w;x++)if(x===b.x+b.w||y===b.y+b.h)w.water[y*w.N+x]=1;
 G.bumpNavigation(w);const rear=G.fuelWorkSpot(w,b,c.x,c.y);assert(rear);assert(rear.x+rear.y<b.x+b.y+b.w+b.h-2);
 for(let y=b.y-1;y<=b.y+b.h;y++)for(let x=b.x-1;x<=b.x+b.w;x++)if(x===b.x-1||x===b.x+b.w||y===b.y-1||y===b.y+b.h)w.water[y*w.N+x]=1;
 G.bumpNavigation(w);assert.equal(G.fuelWorkSpot(w,b,c.x,c.y),null);
});
test('unreachable front tiles use legal reachable rear, never teleport through barrier',()=>{
 const G=fresh(),b=build(G,'woodcutter',12,10),c=person(G,8,8),w=G.world;
 for(let x=0;x<w.N;x++)w.water[12*w.N+x]=1;
 for(let y=0;y<w.N;y++)w.water[y*w.N+14]=1;
 G.bumpNavigation(w);const spot=G.fuelWorkSpot(w,b,c.x,c.y);assert(spot);assert(spot.x<14&&spot.y<12);assert(G.atMedicalDoor(spot,b));
});
test('front cycle physically returns from storage, keeps recipe and output/leave semantics',()=>{
 const G=fresh(),b=build(G,'woodcutter',12,10),c=person(G,8,10);assign(G,b,c);
 assert.equal(c.task.phase,'fetch');assert.equal(G.game.res.wood,200);
 until(G,c,()=>c.carry?.fuelInput);assert.equal(G.game.res.wood,198);assert.equal(G.game.res.firewood,0);assert.equal(c.state,'walk');
 until(G,c,()=>c.task?.phase==='process'&&c.state==='work');assert(c.x+c.y>b.x+b.y+b.w+b.h-2-.5);assert.equal(G.fuelAtTask(c,c.task),true);
 G.setWorkerLimit(b,0);until(G,c,()=>c.carry?.type==='firewood');assert.equal(c.carry.qty,6);assert.equal(G.game.res.wood,198);
 until(G,c,()=>!c.carry);assert.equal(G.game.res.firewood,6);assert.equal(c.job,null);
});
test('legacy loaded cargo returns once; empty-hand old save starts a new physical front cycle',()=>{
 const G=fresh(),b=build(G,'woodcutter',12,10);let c=person(G,8,10);assign(G,b,c);until(G,c,()=>c.carry?.fuelInput);G.setWorkerLimit(b,0);
 c=load(G,c);assert.equal(c.task,null);until(G,c,()=>!c.carry);assert.equal(G.game.res.wood,200);assert.equal(G.game.res.firewood,0);
 const data=save(G);delete data.citizens[0].carry;G.applySaveData(data);c=G.world.cmap[c.id];const hut=G.world.bmap[b.id];G.setWorkerLimit(hut,1);assign(G,hut,c);
 until(G,c,()=>c.task?.phase==='process'&&c.state==='work');assert(c.x+c.y>hut.x+hut.y+hut.w+hut.h-2-.5);
});
test('all workshop sides closed before pickup does not withdraw any input',()=>{
 const G=fresh(),b=build(G,'woodcutter',12,10),c=person(G,8,10);assign(G,b,c);const t=c.task;
 for(let y=b.y-1;y<=b.y+b.h;y++)for(let x=b.x-1;x<=b.x+b.w;x++)if(x===b.x-1||x===b.x+b.w||y===b.y-1||y===b.y+b.h)G.world.water[y*G.world.N+x]=1;
 G.bumpNavigation(G.world);until(G,c,()=>c.task!==t);assert.equal(G.game.res.wood,200);assert.equal(G.game.res.firewood,0);assert.equal(c.carry,null);
});
console.log('Fuel front work: '+passed+' passed');
