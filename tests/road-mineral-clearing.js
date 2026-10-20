'use strict';
const assert=require('node:assert/strict'),path=require('node:path'),{loadGame}=require('./helpers/playability');
const copy=x=>JSON.parse(JSON.stringify(x));let passed=0;
function test(name,fn){fn();passed++;console.log('ok '+name);}
function fresh(surface='stone'){
 const G=loadGame(path.resolve(__dirname,'..'));G.world=G.emptyWorld(1,2);G.game=G.newGameState({v:2,preset:'hard',seed:1,terrain:'mountain'});G.game.h=12;G.game.res.stone=100;G.game.res.iron=20;G.game.res.grain=G.game.res.food=1000;G.world.start={x:6,y:6};G.rng=()=>.5;G.addBuilding('storage',3,8,{instant:true,free:true});const c=G.spawnCitizen({x:6,y:10,age:30,sex:'m'});G.initializeDeer();const w=G.world;
 w.rock[10*w.N+8]=1;w.rock[10*w.N+10]=2;G.tool={kind:'road',surface};G.selectRoadEndpoint(8,10);G.selectRoadEndpoint(10,10);return {G,w,c};
}
function confirm(f){const {G}=f,s=G.roadPlanStatus(),intent={plan:s.plan,mode:'clear',trees:s.trees.map(p=>p.y*G.world.N+p.x).join(','),rocks:G.roadRockSignature(s)};const q=G.confirmRoadPlan(intent);assert(q.ok,q.reason);return q.b;}
function until(G,fn,limit=25000){for(let i=0;i<limit&&!fn();i++){G.scheduleJobs();for(const c of [...G.world.citizens])G.stepCitizen(c,.02);}assert(fn(),'expected actual task completion');}
function total(G,b,type){return G.game.res[type]+(b?.construction.onsite[type]||0)+(type==='stone'?(b?.roadWork.cells.filter(p=>p.used).length||0):0)+G.world.citizens.reduce((n,c)=>n+(c.carry?.type===type?c.carry.qty:0),0)+(G.game.constructionLost[type]||0);}
for(const surface of ['dirt','stone'])test(surface+' preview crosses stone and iron read-only; a single worker mines, hauls and paves',()=>{
 const f=fresh(surface),{G,w,c}=f,before=copy(G.serializeGame());assert.equal(G.roadPlan.result.path.length,3);assert.equal(G.roadPlan.result.clearRocks.length,2);assert.equal(G.roadPlanStatus().rocks.length,2);assert.equal(w.markedRocks.size,0);assert.deepEqual(copy(G.serializeGame()),before);
 const b=confirm(f);assert.equal(G.constructionCanStaff(b,c),false);assert.equal(c.job,null);assert.equal(w.markedRocks.size,2);assert.equal(G.roadWorkSummary(b).clearing,2);assert.equal(G.game.res.stone,100);
 until(G,()=>!!c.carry);assert.equal(b.progress,0);assert.equal(G.game.res.stone,100);assert.equal(c.carry.type,'stone');assert.equal(c.carry.qty,G.ROCK_STONE);
 until(G,()=>!w.bmap[b.id]);assert.equal(w.road[10*w.N+8],surface==='stone'?2:1);assert.equal(w.road[10*w.N+10],surface==='stone'?2:1);assert.equal(w.markedRocks.size,0);assert.equal(total(G,b,'stone'),100+G.ROCK_STONE);assert.equal(total(G,b,'iron'),20+G.ROCK_IRON);
});
test('changed mineral type or newly appearing mineral rejects old explicit confirmation',()=>{
 for(const change of ['type','new']){const f=fresh(),{G,w}=f,s=G.roadPlanStatus(),intent={plan:s.plan,mode:'clear',trees:'',rocks:G.roadRockSignature(s)};w.rock[10*w.N+(change==='type'?8:9)]=2;assert.equal(G.confirmRoadPlan(intent).ok,false);assert.equal(w.markedRocks.size,0);assert(!w.buildings.some(b=>b.type==='roadwork'));}
});
test('pause preserves mining marks and cargo; resume paves without creating minerals',()=>{
 const f=fresh(),{G,w}=f,b=confirm(f);G.setConstructionPaused(b,true);until(G,()=>w.markedRocks.size===0&&!w.citizens.some(c=>c.carry));assert.equal(b.progress,0);assert.equal(w.road.some(Boolean),false);G.setConstructionPaused(b,false);until(G,()=>!w.bmap[b.id]);assert.equal(total(G,b,'stone'),100+G.ROCK_STONE);assert.equal(total(G,b,'iron'),20+G.ROCK_IRON);
});
test('cancel road retains independent mining and cannot resurrect paving',()=>{
 const f=fresh(),{G,w}=f,b=confirm(f);until(G,()=>w.citizens.some(c=>c.carry));const stock=G.game.res.stone;assert(G.cancelRoadWork(b));assert.equal(G.game.res.stone,stock);until(G,()=>w.markedRocks.size===0&&!w.citizens.some(c=>c.carry));assert.equal(w.road.some(Boolean),false);assert.equal(G.game.res.stone,100+G.ROCK_STONE);assert.equal(G.game.res.iron,20+G.ROCK_IRON);
});
test('overlapping confirmations reuse one mark and one project, then cancel marks survives save',()=>{
 const f=fresh(),{G,w}=f,b=confirm(f),q=G.addRoadWork(b.roadWork.cells,'stone');assert(q.ok);assert.equal(q.queued,0);assert.equal(q.markedRocks,0);assert.equal(w.markedRocks.size,2);G.cancelResourceMarks('rocks');assert.equal(w.markedRocks.size,0);assert.match(G.roadWorkSummary(b).status,/标记已撤销/);G.applySaveData(copy(G.serializeGame()));assert.equal(G.world.markedRocks.size,0);assert.equal(G.roadWorkClearance(G.world,G.world.bmap[b.id]).length,2);
});
test('mineral cap rejects mixed tree and mineral batch atomically',()=>{
 const f=fresh(),{G,w}=f;G.addTree(w,9,10,-200);for(let i=0;w.markedRocks.size<300;i++)w.markedRocks.add(i);const before=copy(G.serializeGame());assert.equal(G.confirmRoadPlan().ok,false);assert.deepEqual(copy(G.serializeGame()),before);assert.equal(w.marked.size,0);
});
test('full mineral storage leaves ground and road untouched until room exists',()=>{
 const f=fresh(),{G,w}=f,b=confirm(f);G.game.res.stone=G.storageCap('stone');G.game.res.iron=G.storageCap('iron');for(let i=0;i<300;i++){G.scheduleJobs();G.stepCitizen(f.c,.02);}assert.equal(w.markedRocks.size,2);assert.equal(b.progress,0);assert.equal(w.rock[10*w.N+8],1);assert.equal(w.rock[10*w.N+10],2);G.game.res.stone=100;G.game.res.iron=20;until(G,()=>!w.bmap[b.id]);assert.equal(total(G,b,'stone'),100+G.ROCK_STONE);
});
test('mining cargo saves repeatedly while unfinished mineral keeps road material ledger empty',()=>{
 const f=fresh(),{G}=f;let b=confirm(f);until(G,()=>!!G.world.citizens[0].carry);for(let i=0;i<3;i++){G.applySaveData(copy(G.serializeGame()));b=G.world.bmap[b.id];assert.equal(G.roadWorkClearance(G.world,b).length,1);assert.equal(b.progress,0);assert.equal(G.game.res.stone,100);assert.equal(total(G,b,'stone'),100+G.ROCK_STONE);}until(G,()=>!G.world.bmap[b.id]);assert.equal(total(G,b,'stone'),100+G.ROCK_STONE);assert.equal(total(G,b,'iron'),20+G.ROCK_IRON);
});
test('mineral-clearing save rejects forged progress, onsite or in-flight materials and invalid terrain atomically',()=>{
 const f=fresh(),{G}=f,b=confirm(f),good=copy(G.serializeGame()),row=d=>d.buildings.find(x=>x.id===b.id);
 for(const change of [d=>row(d).construction.onsite.stone=1,d=>{row(d).roadWork.cells[1].used=true;row(d).constructionStarted=true;},d=>d.citizens[0].carry={type:'stone',qty:1,constructionId:b.id,staffingReturn:true},d=>d.terrain.water[10*d.N+8]=1,d=>d.terrain.mountain[10*d.N+8]=1,d=>row(d).roadWork.cells[1].x=8]){const bad=copy(good);change(bad);assert.throws(()=>G.applySaveData(bad));assert.deepEqual(copy(G.serializeGame()),good);}
});
console.log(`Road mineral clearing: ${passed} focused suites passed.`);
