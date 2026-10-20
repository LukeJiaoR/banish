'use strict';
const assert=require('node:assert/strict'),path=require('node:path'),{loadGame}=require('./helpers/playability');
const copy=x=>JSON.parse(JSON.stringify(x));let passed=0;
function test(name,fn){fn();passed++;console.log('ok '+name);}
function fresh(surface='stone'){
 const G=loadGame(path.resolve(__dirname,'..'));G.world=G.emptyWorld(1,2);G.game=G.newGameState({v:2,preset:'hard',seed:1,terrain:'mountain'});G.game.h=12;G.game.res.stone=100;G.game.res.grain=G.game.res.food=1000;G.world.start={x:6,y:6};G.rng=()=>.5;G.addBuilding('storage',3,8,{instant:true,free:true});const c=G.spawnCitizen({x:6,y:10,age:30,sex:'m'});G.initializeDeer();
 G.addTree(G.world,8,10,-200);G.addTree(G.world,10,10,-200);const q=G.addRoadWork([{x:8,y:10},{x:9,y:10},{x:10,y:10}],surface);assert(q.ok,q.reason);return {G,w:G.world,c,b:q.b};
}
function until(G,fn,limit=20000){for(let i=0;i<limit&&!fn();i++){G.scheduleJobs();for(const c of [...G.world.citizens])G.stepCitizen(c,.02);}assert(fn(),'expected actual task completion');}
function total(G,b){return G.game.res.stone+(b?.construction.onsite.stone||0)+(b?.roadWork.cells.filter(p=>p.used).length||0)+G.world.citizens.reduce((n,c)=>n+(c.carry?.type==='stone'?c.carry.qty:0),0)+(G.game.constructionLost.stone||0);}
for(const surface of ['dirt','stone'])test(surface+' single citizen clears, hauls and builds without a second confirmation or staffing deadlock',()=>{
 const {G,w,c,b}=fresh(surface),wood=G.game.res.wood;assert.equal(G.constructionCanStaff(b,c),false);assert.equal(c.job,null);assert.equal(G.game.res.stone,100);assert.equal(G.roadWorkSummary(b).clearing,2);
 until(G,()=>!w.bmap[b.id]);assert.equal(G.game.res.wood,wood+2*G.TREE_LOGS);assert.equal(w.road[10*w.N+8],surface==='stone'?2:1);assert.equal(w.road[10*w.N+10],surface==='stone'?2:1);assert.equal(G.game.res.stone,surface==='stone'?97:100);assert.equal(total(G,b),100);assert.equal(w.marked.size,0);
});
test('clearing order repeatedly saves and loads; one remaining tree prevents materials and building',()=>{
 let {G,b,c}=fresh();const wood=G.game.res.wood;
 until(G,()=>G.roadWorkTrees(G.world,b).length===1);assert.equal(G.game.res.stone,100);assert.equal(b.progress,0);
 for(let i=0;i<3;i++){G.applySaveData(copy(G.serializeGame()));b=G.world.bmap[b.id];c=G.world.cmap[c.id];assert.equal(G.roadWorkTrees(G.world,b).length,1);assert.equal(G.constructionCanStaff(b,c),false);assert.equal(total(G,b),100);}
 until(G,()=>!G.world.bmap[b.id]);assert.equal(G.game.res.wood,wood+2*G.TREE_LOGS);assert.equal(total(G,b),100);
});
test('pause preserves shared marks and prevents paving until explicitly resumed',()=>{
 const {G,w,b}=fresh();assert(G.setConstructionPaused(b,true));until(G,()=>w.marked.size===0&&!G.world.citizens.some(c=>c.carry));assert.equal(b.progress,0);assert.equal(G.game.res.stone,100);assert.equal(w.road.some(Boolean),false);assert(G.setConstructionPaused(b,false));until(G,()=>!w.bmap[b.id]);assert.equal(total(G,b),100);
});
test('cancelling road preserves independent tree commands but never resurrects the road',()=>{
 const {G,w,b}=fresh();G.addTree(w,13,10,-200);G.markFellAt(w,13,10);assert(G.cancelRoadWork(b));assert.equal(w.marked.size,3);assert.equal(G.cancelRoadWork(b),false);until(G,()=>w.marked.size===0&&!G.world.citizens.some(c=>c.carry));assert.equal(w.road.some(Boolean),false);assert.equal(G.game.res.stone,100);assert.equal(w.buildings.filter(b=>b.type==='roadwork').length,0);
});
test('cancelled tree commands stay cancelled across scheduling and saves, with actionable status',()=>{
 let {G,b}=fresh();G.cancelResourceMarks('trees');for(let i=0;i<10;i++)G.scheduleJobs();assert.equal(G.world.marked.size,0);assert.match(G.roadWorkSummary(b).status,/标记已撤销/);G.applySaveData(copy(G.serializeGame()));b=G.world.bmap[b.id];assert.equal(G.world.marked.size,0);assert.equal(G.roadWorkTrees(G.world,b).length,2);
 for(const p of G.roadWorkTrees(G.world,b))G.markFellAt(G.world,p.x,p.y);until(G,()=>!G.world.bmap[b.id]);assert.equal(total(G,b),100);
});
test('duplicate plan does not create duplicate clearing orders or material entitlement',()=>{
 const {G,w,b}=fresh();const q=G.addRoadWork(b.roadWork.cells,'stone');assert(q.ok);assert.equal(q.queued,0);assert.equal(q.alreadyQueued,3);assert.equal(w.marked.size,2);assert.equal(w.buildings.filter(b=>b.type==='roadwork').length,1);assert.equal(G.game.res.stone,100);
});
test('tree mark cap rejects atomically without reserving ground or scheduling any clearing',()=>{
 const {G,w}=fresh();for(let i=0;w.marked.size<300;i++)w.marked.add(i);G.addTree(w,20,20,-200);const count=w.buildings.length;assert.equal(G.addRoadWork([{x:20,y:20}],'stone').ok,false);assert.equal(w.buildings.length,count);assert.equal(w.marked.size,300);assert.equal(G.roadWorkAt(w,20,20),null);
});
test('save rejects forged work beneath living trees, water conflicts and duplicate ownership atomically',()=>{
 const {G,b}=fresh(),good=copy(G.serializeGame());const row=d=>d.buildings.find(x=>x.id===b.id);
 for(const mutate of [d=>{row(d).construction.onsite.stone=1;},d=>{row(d).roadWork.cells[1].used=true;row(d).constructionStarted=true;},d=>{d.citizens[0].carry={type:'stone',qty:1,constructionId:b.id,staffingReturn:true};},d=>{d.terrain.water[10*d.N+9]=1;},d=>{const r=row(d);r.roadWork.cells[0].used=true;r.roadWork.cells[0].workLeft=.5;r.workLeft-=.5;r.progress=.5/r.totalWork;r.constructionStarted=true;},d=>{row(d).roadWork.cells[0].done=true;row(d).roadWork.cells[0].used=true;row(d).roadWork.cells[0].workLeft=0;},d=>{row(d).roadWork.cells[1].x=8;}]){const bad=copy(good);mutate(bad);assert.throws(()=>G.applySaveData(bad));assert.deepEqual(copy(G.serializeGame()),good);}
 // A new mineral becomes an explicit clearing command, never a free removal.
 G.world.rock[10*G.world.N+9]=1;assert.equal(G.addRoadWork(b.roadWork.cells,'stone').ok,true);assert(G.world.markedRocks.has(10*G.world.N+9));assert.equal(G.world.rock[10*G.world.N+9],1);assert.equal(G.game.res.stone,100);
});
test('trees on reused roads are included in the confirmed clearing command without duplicate road costs',()=>{
 for(const allReused of [false,true]){const {G,w,b}=fresh('dirt');G.cancelRoadWork(b);G.cancelResourceMarks('trees');for(const p of b.roadWork.cells)if(allReused||p.x===8)G.setRoad(w,p.x,p.y,1);
 const q=G.addRoadWork(b.roadWork.cells,'dirt');assert(q.ok);assert.equal(q.marked,2);assert.equal(q.queued,allReused?0:2);assert.equal(q.clearing,true);assert.equal(w.marked.size,2);assert.equal(G.game.res.stone,100);}
});
console.log(`Road clearing continuation: ${passed} focused suites passed.`);
