'use strict';
const assert=require('node:assert/strict'),path=require('node:path');
const {loadGame}=require('./helpers/playability');let passed=0;
function fresh(){const G=loadGame(path.resolve(__dirname,'..'));G.newGame(1);const w=G.world;for(const k of ['water','rock','road'])w[k].fill(0);w.roadCount=0;w.roadBounds=null;w.bgrid.fill(-1);w.treeIdx.fill(-1);for(const k of ['trees','citizens','buildings','families'])w[k]=[];w.cmap={};w.bmap={};w.marked.clear();w.markedRocks.clear();G.game.h=12;G.rng=()=>0;G.addBuilding('storage',1,1,{instant:true,free:true});return G;}
function owned(G,k){return G.game.res[k]+G.world.citizens.reduce((n,c)=>n+(c.carry?.type===k?c.carry.qty:0),0);}
function worker(G,b,x=2,y=10){const c=G.spawnCitizen({x,y,age:25,sex:'m'});c.job=b.id;b.workers.push(c.id);return c;}
function test(name,f){f();passed++;console.log('ok '+name);}
test('new solid construction releases old physical tree claim, keeps partial cargo, and builders actually clear it',()=>{
 const G=fresh(),w=G.world,hut=G.addBuilding('forester',20,20,{instant:true,free:true}).b;
 G.addTree(w,8,10,-200);for(let y=8;y<12;y++)for(let x=11;x<15;x++)G.addTree(w,x,y,-200);
 const c=worker(G,hut);G.requestTask(c);const old=c.task;assert.equal(old.tx,8);assert.equal(old.ty,10);c.carry={type:'wood',qty:3};const wood=owned(G,'wood');
 for(let n=0;n<4;n++)G.spawnCitizen({x:4,y:10+n,age:25,sex:'m'});
 const site=G.addBuilding('house',8,10).b;assert(site);assert.notEqual(c.task,old);assert.notEqual(c.pausedTask,old);assert.equal(owned(G,'wood'),wood-G.BDEF.house.cost.wood);
 assert(w.citizens.some(x=>x.task?.kind==='clearSite'&&x.task.tree===old.tree),'a builder takes the released tree');
 let removals=0;const remove=G.removeTree;G.removeTree=(world,x,y)=>{if(x===8&&y===10)removals++;return remove(world,x,y);};
 for(let n=0;n<1200&&site.state!=='ok';n++)G.advanceSim(.05);
 assert.equal(removals,1);assert.equal(G.siteTrees(site).length,0);assert(site.progress>0||site.state==='ok');
});
test('paused physical tree task cannot resume at a nearby substitute after footprint changes',()=>{
 const G=fresh(),w=G.world,hut=G.addBuilding('forester',20,20,{instant:true,free:true}).b;G.addTree(w,8,10,-200);for(let y=8;y<12;y++)for(let x=11;x<15;x++)G.addTree(w,x,y,-200);
 const c=worker(G,hut);G.requestTask(c);const old=c.task;old.workLeft=2;c.pausedTask=old;c.task=null;c.state='rest';c.carry={type:'wood',qty:3};G.addBuilding('house',8,10,{free:true});
 c.pausedTask=old;assert.equal(G.resumeTask(c),false);assert.equal(c.task,null);assert.notEqual(c.state,'work');assert.equal(c.carry.qty,3);assert.equal(old.workLeft,2);
 c.task=old;G.sendTo(c,old.tx,old.ty);assert.equal(c.task,null);assert.notEqual(c.state,'work');
});
for(const type of ['gatherer','hunting'])test(type+' forest work never becomes completed hut-door work when its forest tile is covered',()=>{
 const G=fresh(),w=G.world,b=G.addBuilding(type,20,20,{instant:true,free:true}).b;for(let y=13;y<=16;y++)for(let x=13;x<=16;x++)G.addTree(w,x,y,-200);
 const c=worker(G,b,10,15);G.requestTask(c);const old=c.task;assert(old&&old.kind==='work');const food=owned(G,'food');
 assert(G.canPlace(w,'house',old.tx,old.ty).ok);assert(G.addBuilding('house',old.tx,old.ty,{free:true}).ok);
 assert.notEqual(c.task,old);assert.equal(owned(G,'food'),food);
 c.pausedTask=old;c.task=null;assert.equal(G.resumeTask(c),false);assert.equal(c.task,null);
 c.task=old;c.state='walk';c.walkKind='task';c.path=[{x:old.tx,y:old.ty}];c.pi=0;G.detourCitizen(c,.1);assert.equal(c.task,null);assert.equal(owned(G,'food'),food);
});
test('covered near mark does not block an available far mark or reserve the only worker forever',()=>{
 const G=fresh(),w=G.world;for(const x of [8,12]){G.addTree(w,x,10,-200);G.markFellAt(w,x,10);}
 const site=G.addBuilding('house',8,10).b;assert(site);const c=G.spawnCitizen({x:5,y:10,age:25,sex:'m'});G.scheduleJobs();const wood=owned(G,'wood');
 assert.equal(G.pickMarkedTree(w,c.x,c.y).x,12);
 for(let n=0;n<100;n++)G.advanceSim(.05);
 assert.equal(c.job,null);assert.equal(c.task?.kind,'chop');assert.equal(c.task.tx,12);assert.equal(c.task.ty,10);
 assert(w.marked.has(10*w.N+8));assert(w.marked.has(10*w.N+12));assert.equal(owned(G,'wood'),wood);
});
for(const food of [10,32])test(`fully covered food forest with ${food} food releases workers for real clearing`,()=>{
 const G=fresh(),w=G.world;G.rng=()=>.5;const hut=G.addBuilding('gatherer',20,22,{instant:true,free:true}).b;
 for(let y=18;y<=19;y++)for(let x=18;x<=20;x++)G.addTree(w,x,y,-200);
 for(let n=0;n<2;n++)G.assignWorker(hut,G.spawnCitizen({x:18+n,y:22,age:25,sex:'m'}));G.game.res.food=food;
 const site=G.addBuilding('storage',18,18).b;assert(site);const wood=owned(G,'wood');
 assert.equal(G.jobCanProduce(hut),false);
 for(let n=0;n<(food===10?960:1920);n++)G.advanceSim(.1);
 const remaining=G.siteTrees(site).length;assert(remaining<6);
 if(food===32){assert.equal(remaining,0);assert(site.progress>0||site.state==='ok');}
 else assert(site.workers.length>0);
 assert.equal(hut.workers.length,0);assert.equal(hut.produced?.food||0,0);
 assert.equal(owned(G,'wood'),wood+(6-remaining)*G.TREE_LOGS);assert(G.game.res.food<=food);
});
test('partly covered food forest keeps genuinely usable trees and excludes covered targets',()=>{
 const G=fresh(),w=G.world;G.rng=()=>.5;const hut=G.addBuilding('gatherer',20,22,{instant:true,free:true}).b;
 for(let y=18;y<=19;y++)for(let x=18;x<=20;x++)G.addTree(w,x,y,-200);
 G.addTree(w,18,24,-200);
 const c=G.spawnCitizen({x:18,y:22,age:25,sex:'m'});assert(G.addBuilding('storage',18,18).ok);
 assert.equal(G.jobCanProduce(hut),true);const t=G.makeTask(hut,c);assert(t);assert.equal(G.tileBlocked(w,t.tx,t.ty),false);assert(t.ty>=24);
});
test('hunting eligibility rejects a wholly covered mature forest but retains one real target',()=>{
 const G=fresh(),w=G.world;G.rng=()=>.5;const hut=G.addBuilding('hunting',24,22,{instant:true,free:true}).b;
 for(let y=18;y<=20;y++)for(let x=18;x<=21;x++)G.addTree(w,x,y,-200);
 G.game.res.wood=120;G.game.res.stone=60;assert(G.addBuilding('boarding',18,18).ok);
 const c=G.spawnCitizen({x:16,y:23,age:25,sex:'m'});assert.equal(G.jobCanProduce(hut),false);assert.equal(G.makeTask(hut,c),null);assert.equal(hut.noWork,true);
 G.addTree(w,22,18,-200);assert.equal(G.jobCanProduce(hut),true);const t=G.makeTask(hut,c);assert(t);assert.equal(t.tx,22);assert.equal(t.ty,18);
});
console.log(`Task endpoint contract: ${passed} passed`);
