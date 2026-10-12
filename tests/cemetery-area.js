/* Issue #83: table-based cemetery areas, original-grave ownership and atomic saves. */
'use strict';
const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
const {loadGame}=require('./helpers/playability');
const root=path.resolve(__dirname,'..'),copy=x=>JSON.parse(JSON.stringify(x)),saved=G=>copy(G.serializeGame());let passed=0;
function test(name,fn){fn();passed++;console.log('ok '+name);}
function fresh(source=root){
  const G=loadGame(source);G.newGame(1);const w=G.world;
  for(const k of ['water','rock','road'])w[k].fill(0);w.bgrid.fill(-1);w.treeIdx.fill(-1);w.trees=[];w.buildings=[];w.bmap={};w.citizens=[];w.cmap={};w.families=[];w.marked.clear();w.markedRocks.clear();
  G.bumpNavigation(w);G.game.h=12;G.rng=()=>.5;G.addBuilding('storage',2,2,{instant:true,free:true});
  for(const k of G.RES_KEYS)G.game.res[k]=0;Object.assign(G.game.res,{wood:400,stone:500,tools:100,grain:500,food:500});
  G.game.townLedger=G.newTownLedger(G.game);G.hasOpenModal=()=>false;
  const gen=G.genWorld;G.genWorld=(seed,opt)=>{const nw=gen(seed,opt);nw.water.set(w.water);nw.rock.set(w.rock);return nw;};return G;
}
function plot(G,size=[7,7],instant=true,x=10,y=10){const r=G.addBuilding('cemetery',x,y,{...(size?{cemeterySize:size}:{}),instant});assert(r.ok,r.reason);return r.b;}
const person=(G,x=6,y=10)=>G.spawnCitizen({x,y,age:30,sex:'m'});
function burial(G,b,name='旧姓名'){const c=person(G,b.x-1,b.y);c.name=name;G.killCitizen(c,'老逝');assert(b.graves.some(r=>r.name===name));return b.graves.find(r=>r.name===name);}
function until(G,done,max=30000){for(let i=0;i<max&&!done();i++)for(const c of [...G.world.citizens])G.stepCitizen(c,.1);assert(done(),'physical construction/cargo did not finish');}
function day(G,n){G.game.day=n;G.game.year=Math.floor(n/G.YEAR_DAYS)+1;G.game.season=Math.floor(n/G.SEASON_DAYS)%4;G.game.h=12;G.game.townLedger=G.newTownLedger(G.game);}
const remnants=G=>G.world.buildings.filter(b=>b.type==='graveremnant');
function totalStone(G){return G.game.res.stone+(G.game.constructionLost.stone||0)+G.world.buildings.reduce((n,b)=>n+(G.constructionEntitlement(b).stone||0),0)+G.world.citizens.reduce((n,c)=>n+(G.constructionCargo(c)&&c.carry.type==='stone'?c.carry.qty:0),0);}
function retire(G,b){const q=G.cemeteryRemovalQuote(b);assert(q.ok,q.reason);assert(G.removeBuilding(b,q.key));return q;}

test('all 196 source table dimensions use perimeter stone/work and unique adapted grave cells',()=>{
  const G=fresh();let checked=0;
  for(let w=7;w<=20;w++)for(let h=7;h<=20;h++){
    const b={id:7,x:10,y:10,w,h,cemeterySize:[w,h]},d=G.cemeteryDefinition([w,h]),capacity=(w-4)*Math.floor((h-1)/2);
    assert.deepEqual(copy(d.cost),{stone:2*(w+h)-4});assert.equal(d.buildWork,d.cost.stone);assert.equal(d.jobs,0);assert.equal(G.cemeteryCapacity(b),capacity);
    const points=Array.from({length:capacity},(_,slot)=>G.cemeteryGraveCell(b,slot));assert.equal(new Set(points.map(p=>p.x+','+p.y)).size,capacity);
    for(const p of points)assert(p.x>=b.x+2&&p.x<b.x+w-2&&p.y>b.y&&p.y<b.y+h-1);checked++;
  }
  assert.equal(checked,196);for(const [size,cap]of [[[7,7],9],[[7,20],27],[[20,7],48],[[20,20],144]])assert.equal(G.cemeteryCapacity({cemeterySize:size}),cap);
  assert.equal(G.cemeteryDefinition(),G.BDEF.cemetery);assert.equal(G.cemeteryCapacity({}),8);
  const legacy={x:10,y:10};for(let slot=0;slot<8;slot++)assert.deepEqual(copy(G.cemeteryGravePoint(legacy,slot)),{x:10+.85+(slot%2)*1.7,y:10+.5+Math.floor(slot/2)*.85});
});
test('invalid areas, wrong types and occupied footprints make no world changes',()=>{
  const G=fresh(),w=G.world;
  for(const size of [null,[],[7],[7,7,7],[6,7],[7,21],[7.5,7],['7',7],[,7]]){const before=JSON.stringify(saved(G));assert.equal(G.cemeteryDefinition(size),null);assert(!G.addBuilding('cemetery',10,10,{cemeterySize:size}).ok);assert.equal(JSON.stringify(saved(G)),before);}
  assert(!G.addBuilding('house',10,10,{cemeterySize:[7,7]}).ok);assert(!G.addBuilding('cemetery',10,10,{cemeterySize:[7,7],orchardSize:[7,7]}).ok);
  assert(!G.canPlace(w,'cemetery',10.5,10,[7,7]).ok);assert(!G.canPlace(w,'cemetery',w.N-6,10,[7,7]).ok);
  for(const kind of ['water','rock','bgrid']){const i=16*w.N+16,old=w[kind][i];w[kind][i]=kind==='bgrid'?999:1;assert(!G.canPlace(w,'cemetery',10,10,[7,7]).ok);w[kind][i]=old;}
});
test('two-corner plan is read-only, stale stock/tree changes re-review, and confirm is once-only',()=>{
  const G=fresh();G.setTool('cemetery');const before=JSON.stringify(saved(G));G.selectCemeteryCorner(16,16);G.selectCemeteryCorner(10,10);const first=G.cemeteryPlanStatus();assert(first.ok);assert.equal(first.capacity,9);assert.equal(first.workers,0);assert.equal(first.work,24);assert.deepEqual(copy(first.cost),{stone:24});assert.equal(JSON.stringify(saved(G)),before);
  G.game.res.stone--;assert(!G.confirmCemeteryPlan(first).ok);const second=G.cemeteryPlanStatus();G.addTree(G.world,16,16,-100);assert(!G.confirmCemeteryPlan(second).ok);
  const next=G.cemeteryPlanStatus();assert.equal(next.trees,1);const r=G.confirmCemeteryPlan(next);assert(r.ok);assert.equal(r.b.totalWork,24);assert.deepEqual(copy(r.b.cemeterySize),[7,7]);assert.equal(G.cemeteryPlan,null);assert(!G.confirmCemeteryPlan(next).ok);
  G.selectCemeteryCorner(25,25);G.setTool('road');assert.equal(G.cemeteryPlan,null);assert.equal(G.cemeteryDrag,null);
});
test('new cemetery physically clears, delivers only stone and constructs before any burial capacity',()=>{
  const G=fresh();G.addTree(G.world,16,16,-100);const b=plot(G,[7,7],false),c=person(G);G.assignWorker(b,c);const before=G.game.res.stone,wood=G.game.res.wood;
  assert.equal(before,500);assert.deepEqual(copy(b.construction.required),{stone:24});assert.equal(G.burialPlace(c),null);G.finishBuilding(b);assert.equal(b.state,'site');
  until(G,()=>G.siteTrees(b).length===0);assert.equal(b.workLeft,24);until(G,()=>G.constructionCargo(c));assert.equal(c.carry.type,'stone');assert.equal(b.progress,0);assert.equal(b.construction.onsite.stone||0,0);
  until(G,()=>b.state==='ok');assert.equal(G.game.res.stone,before-24);assert.equal(G.game.res.wood,wood+G.TREE_LOGS);assert.equal(b.workLeft,0);assert.equal(b.progress,1);assert.equal(b.workers.length,0);assert.equal(G.workerMaximumOf(b),0);assert.equal(G.cemeterySummary(b).capacity,9);
});
test('site cancellation conserves accepted stone cargo, onsite materials and stale callbacks',()=>{
  const G=fresh(),b=plot(G,[20,20],false),c=person(G);G.assignWorker(b,c);const total=totalStone(G);
  until(G,()=>b.construction.onsite.stone===20&&G.constructionCargo(c)&&!G.atStorageDoor(c,'stone'));
  const cargo=c.carry,task=c.task,stock=G.game.res.stone;assert(G.removeBuilding(b));assert.equal(G.game.res.stone,stock+20);assert.equal(c.carry,cargo);assert(cargo.constructionReturn);assert.equal(remnants(G).length,0);
  assert.equal(G.completeConstructionMaterial(c,task),false);assert.equal(G.removeBuilding(b),false);assert.equal(totalStone(G),total);
  G.applySaveData(saved(G));const loaded=G.world.cmap[c.id];assert(loaded.carry.constructionReturn);until(G,()=>!loaded.carry);assert.equal(totalStone(G),total);assert.equal(G.game.res.stone,500);
});
test('new construction partial, consumed, completed and accepted cargo survive strict roundtrips',()=>{
  for(const phase of ['cargo','partial','consumed','complete']){
    const G=fresh(),b=plot(G,[7,7],false),c=person(G);G.assignWorker(b,c);
    until(G,()=>phase==='cargo'?G.constructionCargo(c)&&!G.atStorageDoor(c,'stone'):phase==='partial'?b.construction.onsite.stone===20:phase==='consumed'?b.progress>0:b.state==='ok');
    const prior=copy(b),total=totalStone(G),d=saved(G);G.applySaveData(d);const now=G.world.bmap[b.id];assert.equal(now.totalWork,24);assert.equal(now.workLeft,prior.workLeft);assert.equal(now.progress,prior.progress);assert.deepEqual(copy(now.construction),prior.construction);assert.equal(totalStone(G),total);
    if(phase==='cargo')assert(G.world.cmap[c.id].carry.constructionReturn);
  }
});
test('occupied and empty completed cemeteries require fresh confirmation, return actual half once',()=>{
  for(const occupied of [false,true]){
    const G=fresh(),b=plot(G,[7,7]),before=G.game.res.stone;if(occupied)burial(G,b);
    let displayed;G.ui.confirmCemeteryRemoval=(target,q)=>{assert.equal(target,b);displayed=q;};assert.equal(G.removeBuilding(b),false);assert(displayed.ok);assert.equal(G.world.bmap[b.id],b);assert.equal(G.game.res.stone,before);
    const graveRows=copy(b.graves),q=retire(G,b);assert.equal(q.refund.stone,12);assert.equal(q.retainedTiles.length,occupied?1:0);assert.equal(q.releaseTiles.length,49-(occupied?1:0));assert.equal(G.game.res.stone,before+12);assert.equal(remnants(G).length,occupied?1:0);
    if(occupied)assert.deepEqual(copy(remnants(G)[0].grave),graveRows[0]);assert.equal(G.removeBuilding(b,q.key),false);assert.equal(G.finishBuilding(b),false);assert.equal(G.game.res.stone,before+12);
  }
});
test('new death, expiry, refund or world replacement invalidates old demolition quote',()=>{
  const G=fresh(),b=plot(G,[7,7]);let q=G.cemeteryRemovalQuote(b);burial(G,b);assert.equal(G.removeBuilding(b,q.key),false);q=G.cemeteryRemovalQuote(b);day(G,192);assert.equal(G.removeBuilding(b,q.key),false);
  q=G.cemeteryRemovalQuote(b);b.paidCost={};b.construction.required={};assert.equal(G.removeBuilding(b,q.key),false);b.paidCost={stone:24};b.construction.required={stone:24};
  q=G.cemeteryRemovalQuote(b);G.applySaveData(saved(G));const replacement=G.world.bmap[b.id];assert.equal(G.removeBuilding(replacement,q.key),false);assert.equal(G.removeBuilding(b,q.key),false);retire(G,replacement);
});
test('only actual graves retain cells, old roads remain and walking stays passable',()=>{
  const G=fresh(),w=G.world;for(let x=10;x<=16;x++)G.setRoad(w,x,11,2);const b=plot(G,[7,7]);burial(G,b,'甲');day(G,1);burial(G,b,'乙');const before=G.findPathToAny(w,9,11,[{x:17,y:11}]),q=retire(G,b),rs=remnants(G);
  assert.equal(rs.length,2);for(const r of rs){assert(!G.tileBlocked(w,r.x,r.y));assert.equal(w.road[r.y*w.N+r.x],2);assert(!G.canPlaceRoad(w,r.x,r.y));assert(!G.canPlace(w,'cemetery',10,10,[7,7]).ok);assert(!G.canPlace(w,'well',r.x,r.y).ok);assert(!G.planRoad(w,{x:r.x,y:r.y},{x:18,y:r.y}).ok);assert(!G.removeBuilding(r));assert(!G.addBuilding('graveremnant',20,20).ok);}
  const after=G.findPathToAny(w,9,11,[{x:17,y:11}]);assert(before&&after);assert(before.eta>0);assert.equal(after.eta,before.eta);assert(G.canPlace(w,'house',10,14).ok);assert(G.addBuilding('house',10,14,{instant:true,free:true}).ok);assert(G.canPlaceRoad(w,10,10));
  for(const p of q.releaseTiles)if(p.y<14)assert.equal(w.bgrid[p.y*w.N+p.x],-1);
  const road=Array.from(w.road);day(G,192);G.advanceMemorials();assert.equal(remnants(G).length,1);assert.equal(w.bgrid[11*w.N+12],-1);assert.equal(w.bgrid[11*w.N+13],rs[1].id);assert.deepEqual(Array.from(w.road),road);
  day(G,193);G.advanceMemorials();assert.equal(remnants(G).length,0);assert.equal(w.bgrid[11*w.N+13],-1);assert.deepEqual(Array.from(w.road),road);assert(G.world.buildings.some(b=>b.type==='house'));
});
test('legacy edge grave blocks a real bridge bank until expiry, then physical bridge site owns the cell',()=>{
  const G=fresh(),w=G.world;w.water[10*w.N+9]=1;G.bumpNavigation(w);const b=plot(G,null),dead=person(G,10,9);dead.name='桥头旧墓';G.killCitizen(dead,'老逝');assert.equal(b.graves.length,1);retire(G,b);const r=remnants(G)[0],a={x:8,y:10},z={x:10,y:10},builder=person(G,8,9);
  assert.equal(r.x,z.x);assert.equal(r.y,z.y);const before=JSON.stringify(saved(G));assert(!G.bridgeStartStatus(w,z).ok);assert(!G.planBridge(w,a,z).ok);assert(!G.addBridge(a,z).ok);assert.equal(JSON.stringify(saved(G)),before);
  day(G,192);G.advanceMemorials();assert.equal(remnants(G).length,0);assert(G.bridgeStartStatus(w,z).ok);const bridge=G.addBridge(a,z);assert(bridge.ok,bridge.reason);assert.equal(w.bgrid[z.y*w.N+z.x],bridge.b.id);assert(G.tileBlocked(w,9,10));G.assignWorker(bridge.b,builder);until(G,()=>bridge.b.state==='ok');assert(!G.tileBlocked(w,9,10));assert.equal(w.bgrid[z.y*w.N+z.x],bridge.b.id);assert.equal(G.releaseExpiredRemnants(),0);assert.equal(w.bgrid[z.y*w.N+z.x],bridge.b.id);
});
test('legacy eight unique feet and original expiry survive retirement and repeated reload',()=>{
  const G=fresh(),b=plot(G,null),original=[];for(let i=0;i<8;i++){day(G,i);original.push(copy(burial(G,b,'旧'+i)));}assert.equal(G.cemeterySummary(b).capacity,8);const feet=original.map(r=>copy(G.cemeteryGravePoint(b,r.slot)));retire(G,b);assert.equal(remnants(G).length,8);assert.equal(new Set(remnants(G).map(r=>r.x+','+r.y)).size,8);
  for(let n=0;n<3;n++){G.applySaveData(saved(G));const rs=remnants(G);assert.deepEqual(copy(rs.map(r=>r.grave)),original);assert.deepEqual(copy(rs.map(r=>G.remnantGravePoint(r))),feet);assert(rs.every(r=>r.grave.expiresDay===r.grave.deathDay+192));}
  day(G,192);G.applySaveData(saved(G));assert.equal(remnants(G).length,7);assert.equal(G.world.bgrid[10*G.world.N+10],-1);day(G,199);G.applySaveData(saved(G));assert.equal(remnants(G).length,0);
});
test('area capacity reuses expired slots without moving or extending remaining graves',()=>{
  const G=fresh(),b=plot(G,[7,7]);for(let i=0;i<9;i++){day(G,i);burial(G,b,'人'+i);}assert.equal(b.graves.length,9);assert.equal(G.burialPlace(person(G)),null);const still=copy(b.graves.slice(1));day(G,192);G.advanceMemorials();burial(G,b,'新');assert.equal(b.graves.length,9);assert.deepEqual(copy(b.graves.slice(0,8)),still);assert.equal(b.graves[8].slot,0);assert.equal(b.graves[8].expiresDay,384);assert.notEqual(b.graves[8].id,'grave:'+b.id+':0:0');
});
test('malformed area geometry, grave identity, progress, materials and overlaps reject atomically',()=>{
  const G=fresh(),b=plot(G,[7,7]);burial(G,b);const d=saved(G),world=G.world,game=G.game;
  const edits=[r=>r.cemeterySize=[6,7],r=>r.cemeterySize=[7,8],r=>r.w=8,r=>delete r.cemeterySize,r=>r.totalWork++,r=>r.workLeft=1,r=>r.progress=.9,r=>r.paidCost.wood=1,r=>r.paidCost.stone=1,r=>r.construction.required.stone=1,r=>r.graves[0].slot=9,r=>r.graves[0].id='other',r=>delete r.graves[0].id,r=>r.graves[0].expiresDay++,r=>r.graves.push(copy(r.graves[0])),r=>r.state='site'];
  for(const edit of edits){const bad=copy(d);edit(bad.buildings.find(r=>r.id===b.id));assert.throws(()=>G.applySaveData(bad));assert.equal(G.world,world);assert.equal(G.game,game);}
});
test('malformed remnant position, duplicate source/identity, state and refund reject on every load boundary',()=>{
  const G=fresh(),b=plot(G,[7,7]);burial(G,b,'甲');burial(G,b,'乙');retire(G,b);const d=saved(G),world=G.world,game=G.game;
  const edits=[(d,r)=>r.x++,(d,r)=>r.grave.expiresDay++,(d,r)=>r.grave.id='wrong',(d,r)=>r.graveSource.id=r.id,(d,r)=>r.graveSource.x++,(d,r)=>r.graveSource.w=8,(d,r)=>r.graveSource.cemeterySize=[7,8],(d,r)=>r.state='site',(d,r)=>r.totalWork=24,(d,r)=>r.paidCost={stone:24},(d,r)=>r.construction={required:{},onsite:{},consumed:true},(d,r)=>r.workers=[123],(d,r)=>r.w=2,(d,r)=>{const duplicate=copy(r);duplicate.id=100000;d.buildings.push(duplicate);},(d,r)=>{const site=copy(d.buildings[0]);site.id=100000;site.x=r.x;site.y=r.y;d.buildings.push(site);}];
  for(const edit of edits){const bad=copy(d),r=bad.buildings.find(r=>r.type==='graveremnant');edit(bad,r);assert.throws(()=>G.applySaveData(bad));assert.equal(G.world,world);assert.equal(G.game,game);assert.throws(()=>G.prepareSaveData(bad));assert.equal(G.world,world);}
});
test('expired remnant cleanup releases only cells still owned by that entity and preserves road',()=>{
  const G=fresh(),b=plot(G,[7,7]);burial(G,b);retire(G,b);const r=remnants(G)[0],i=r.y*G.world.N+r.x;G.world.bgrid[i]=12345;G.world.road[i]=2;day(G,192);G.releaseExpiredRemnants();assert.equal(G.world.bgrid[i],12345);assert.equal(G.world.road[i],2);assert.equal(remnants(G).length,0);assert.equal(G.releaseExpiredRemnants(),0);
});
test('actual v0.3.72 API fixture preserves legacy partial site, accepted cargo, eight-slot geometry and old graves',()=>{
  const fixture=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/cemetery-v0.3.72.json'),'utf8')),G=fresh(),d=fixture.save;assert.equal(d.game.v,'0.3.72');assert.equal(fixture.provenance.main,'581d98f675d0133226e3f401b22b7bce644fa28f');G.applySaveData(copy(d));
  const oldSite=d.buildings.find(b=>b.id===fixture.provenance.site),site=G.world.bmap[oldSite.id],old=d.buildings.find(b=>b.id===fixture.provenance.cemetery),cem=G.world.bmap[old.id];
  assert.equal(site.w,4);assert.equal(site.h,4);assert.equal(site.cemeterySize,undefined);assert.equal(site.totalWork,80);assert.equal(site.progress,oldSite.progress);assert.equal(site.workLeft,oldSite.workLeft);assert.deepEqual(copy(site.construction),oldSite.construction);assert.deepEqual(copy(site.paidCost),{wood:16,stone:40});
  const accepted=d.citizens.find(c=>c.id===fixture.provenance.citizen).carry,loadedCargo=G.world.cmap[fixture.provenance.citizen].carry;assert.equal(loadedCargo.qty,accepted.qty);assert.equal(loadedCargo.type,accepted.type);assert.equal(loadedCargo.constructionId,fixture.provenance.cargoSite);assert(loadedCargo.constructionReturn);
  assert.equal(G.cemeteryCapacity(cem),8);assert.equal(cem.cemeterySize,undefined);assert.deepEqual(copy(cem.graves).map(({id,...r})=>r),old.graves);assert.deepEqual(copy(G.game.res),d.game.res);
  for(const r of cem.graves)assert.deepEqual(copy(G.cemeteryGravePoint(cem,r.slot)),{x:cem.x+.85+(r.slot%2)*1.7,y:cem.y+.5+Math.floor(r.slot/2)*.85});
  const graves=copy(cem.graves);for(let i=0;i<2;i++)G.applySaveData(saved(G));assert.deepEqual(copy(G.world.bmap[cem.id].graves),graves);retire(G,G.world.bmap[cem.id]);assert.equal(remnants(G).length,old.graves.length);
});
console.log(`Cemetery area: ${passed} passed`);
