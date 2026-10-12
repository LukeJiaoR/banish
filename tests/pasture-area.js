/* Area pastures: real construction, density, staffing, delivery and atomic saves. */
'use strict';
const assert=require('node:assert/strict'),path=require('node:path');
const {loadGame}=require('./helpers/playability');
let passed=0;
const near=(a,b)=>assert(Math.abs(a-b)<1e-8,`${a} != ${b}`);
const data=G=>JSON.parse(JSON.stringify(G.serializeGame()));
const clone=x=>JSON.parse(JSON.stringify(x));
function test(name,fn){fn();passed++;console.log('ok '+name);}
function fresh(){
  const G=loadGame(path.resolve(__dirname,'..'));G.newGame(1);const w=G.world;
  for(const k of ['water','rock','road'])w[k].fill(0);
  w.bgrid.fill(-1);w.treeIdx.fill(-1);w.trees=[];w.buildings=[];w.bmap={};
  w.citizens=[];w.cmap={};w.families=[];w.marked.clear();w.markedRocks.clear();
  G.bumpNavigation(w);G.game.h=12;G.rng=()=>.5;
  G.addBuilding('storage',2,2,{instant:true,free:true});
  for(const k of G.RES_KEYS)G.game.res[k]=0;G.game.res.tools=100;
  const generate=G.genWorld;
  G.genWorld=(seed,opt)=>{const nw=generate(seed,opt);nw.water.set(w.water);nw.rock.set(w.rock);return nw;};
  return G;
}
function pen(G,size=[20,20],type='sheep',x=10,y=10){
  const opt={instant:true,free:true};if(size!==undefined)opt.pastureSize=size;
  const result=G.addBuilding('pasture',x,y,opt);assert(result.ok,result.reason);
  assert(G.setPastureType(result.b,type));return result.b;
}
function legacy(G,type='sheep',x=10,y=10){
  const result=G.addBuilding('pasture',x,y,{instant:true,free:true});assert(result.ok,result.reason);
  assert(G.setPastureType(result.b,type));return result.b;
}
function workers(G,b,count){
  const cs=[];
  for(let i=0;i<count;i++){const c=G.spawnCitizen({x:b.x-2,y:b.y+i,age:30,sex:i%2?'m':'f'});c.job=b.id;b.workers.push(c.id);cs.push(c);}
  return cs;
}
function until(G,cs,done,limit=20000){
  for(let i=0;i<limit&&!done();i++)for(const c of cs)G.stepCitizen(c,.1);
  assert(done(),'expected real pasture progress missing');
}
function next(G){G.closeTownLedgerDay();G.game.day++;G.advanceTownEconomy();}
function careAll(G,b,cs){
  const care=G.completeEconomyWork,seen=new Set();
  G.completeEconomyWork=(c,t)=>{if(t.b===b&&G.atPastureWork(c,t))seen.add(c.id);return care(c,t);};
  for(const c of cs)G.requestTask(c);
  until(G,cs,()=>seen.size===cs.length);G.completeEconomyWork=care;
}
test('explicit dimensions use original density and area threshold, without changing legacy definitions',()=>{
  const G=fresh(),old=JSON.stringify(G.BDEF.pasture);
  for(let w=7;w<=20;w++)for(let h=7;h<=20;h++){
    const d=G.pastureDefinition([w,h]);assert.equal(d.w,w);assert.equal(d.h,h);
    assert.equal(d.cost.wood,Math.ceil(30*(w+h)/12));assert.equal(d.buildWork,Math.ceil(50*w*h/36));
    assert.equal(d.jobs,w*h>=200?2:1);assert.equal(G.initialPastureWorkers([w,h]),d.jobs);
    for(const [type,density] of Object.entries({cattle:20,sheep:16,chicken:6}))assert.equal(G.pastureCapacity({type:'pasture',pastureSize:[w,h]},type),Math.floor(w*h/density));
  }
  assert.equal(JSON.stringify(G.BDEF.pasture),old);assert.equal(G.pastureDefinition(),G.BDEF.pasture);
  assert.equal(G.initialPastureWorkers(),1);assert.equal(G.initialPastureWorkers([10,19]),1);assert.equal(G.initialPastureWorkers([10,20]),2);
  for(const size of [null,[],[7],[7,7,7],[6,7],[21,7],[7,6],[7,21],[7.1,8],['7',8],[,7],[7,,]])assert.equal(G.pastureDefinition(size),null);
});
test('new placement checks every tile and rejects invalid options atomically; farm dimensions stay unchanged',()=>{
  const G=fresh(),w=G.world;G.game.res.wood=500;
  for(const opt of [{pastureSize:[6,7]},{pastureSize:[7,21]},{pastureSize:null},{pastureSize:[7,7],farmSize:[8,8]}]){
    const before=JSON.stringify(data(G));assert(!G.addBuilding('pasture',10,10,opt).ok);assert.equal(JSON.stringify(data(G)),before);
  }
  assert(!G.addBuilding('house',10,10,{pastureSize:[7,7]}).ok);
  assert(!G.canPlace(w,'pasture',10.5,10,[7,7]).ok);assert(!G.canPlace(w,'pasture',w.N-19,0,[20,20]).ok);
  for(const kind of ['water','rock','bgrid']){
    const at=29*w.N+29,old=w[kind][at];w[kind][at]=kind==='bgrid'?123:1;
    assert(!G.canPlace(w,'pasture',10,10,[20,20]).ok);w[kind][at]=old;
  }
  assert(G.canPlace(w,'pasture',10,10,[20,20]).ok);assert(G.canPlace(w,'farm',10,10,[4,15]).ok);
  assert.equal(G.farmDefinition([4,15]).buildWork,G.BDEF.farm.buildWork*60/64);
});
test('7×7 and 20×20 sites pay exact adapted cost, clear a far-corner tree and really finish their full work',()=>{
  for(const size of [[7,7],[20,20]]){
    const G=fresh(),w=G.world,[width,height]=size,x=10+width-1,y=10+height-1;
    const tree={i:y*w.N+x,x,y,b:-G.YEAR_DAYS};w.treeIdx[tree.i]=0;w.trees.push(tree);G.bumpNavigation(w);
    G.game.res.wood=500;const d=G.pastureDefinition(size),result=G.addBuilding('pasture',10,10,{pastureSize:size});
    assert(result.ok,result.reason);const b=result.b,cs=workers(G,b,4);
    assert.equal(b.totalWork,d.buildWork);assert.equal(b.workLeft,d.buildWork);assert.equal(G.game.res.wood,500-d.cost.wood);
    assert.equal(b.workerLimit,d.jobs);assert.equal(G.workerLimitOf(b),4);assert.equal(G.siteTrees(b).length,1);
    assert.equal(w.bgrid[(10+height-1)*w.N+10+width-1],b.id);assert.equal(b.w*b.h,width*height);
    assert(!G.stockPasture(b,1));G.finishBuilding(b);assert.equal(b.state,'site');
    for(const c of cs)G.requestTask(c);until(G,cs,()=>G.siteTrees(b).length===0);
    assert(b.constructionStarted);assert.equal(b.state,'site');assert.equal(b.workLeft,d.buildWork);
    until(G,cs,()=>b.state==='ok');assert.equal(b.workLeft,0);assert.equal(b.progress,1);
    assert.equal(G.workerMaximumOf(b),d.jobs);assert(b.workers.length<=d.jobs);
    assert(G.game.res.wood>=500-d.cost.wood);G.applySaveData(data(G));
    const loaded=G.world.bmap[b.id];assert.deepEqual(Array.from(loaded.pastureSize),size);assert.equal(loaded.totalWork,d.buildWork);
  }
});
test('new sites copy size input, persist payment and cancellation refunds only their own cost once',()=>{
  const G=fresh(),size=[7,7];G.game.res.wood=200;
  const b=G.addBuilding('pasture',10,10,{pastureSize:size}).b;size[0]=20;
  assert.equal(b.w,7);assert.equal(b.pastureSize[0],7);assert.equal(G.game.res.wood,165);
  G.applySaveData(data(G));const loaded=G.world.bmap[b.id];assert.equal(loaded.workLeft,69);assert.equal(loaded.paidCost.wood,35);
  G.removeBuilding(loaded);assert.equal(G.game.res.wood,200);G.removeBuilding(loaded);assert.equal(G.game.res.wood,200);
  const started=G.addBuilding('pasture',10,10,{pastureSize:[20,20]}).b;started.constructionStarted=true;
  started.workLeft-=4;started.progress=1-started.workLeft/started.totalWork;
  G.applySaveData(data(G));G.removeBuilding(G.world.bmap[started.id]);assert.equal(G.game.res.wood,150);
});
test('all three species obey each actual area cap for stock, targets, breeding and save/load',()=>{
  for(const size of [[7,7],[20,20]])for(const type of ['cattle','sheep','chicken']){
    const G=fresh(),b=pen(G,size,type),cap=Math.floor(size[0]*size[1]/G.PASTURE_DENSITY[type]);
    assert.equal(b.animalTarget,Math.min(8,G.pastureCapacity(b,'sheep'),cap));
    G.game.livestock[type]=cap+1;assert(!G.stockPasture(b,cap+1));assert.equal(G.game.livestock[type],cap+1);
    assert(G.stockPasture(b,cap));assert.equal(b.animals,cap);assert.equal(G.game.livestock[type],1);
    assert(!G.stockPasture(b,1));assert(G.setPastureTarget(b,cap));assert(!G.setPastureTarget(b,cap+1));
    const cs=workers(G,b,1);careAll(G,b,cs);if(cap>2)b.animals=cap-1;b.animalGrowth=1;next(G);assert.equal(b.animals,cap);
    const summary=G.pastureSummary(b);assert.equal(summary.cap,cap);assert.equal(summary.capacityRule,'area');
    assert.equal(summary.area,size[0]*size[1]);assert.equal(summary.tilesPerAnimal,G.PASTURE_DENSITY[type]);
    G.applySaveData(data(G));assert.equal(G.world.bmap[b.id].animals,cap);assert.equal(G.pastureCapacity(G.world.bmap[b.id]),cap);
  }
});
test('large plots offer two genuine worker slots, small and legacy plots one, all through existing controls',()=>{
  const G=fresh(),big=pen(G,[10,20]),small=pen(G,[10,19],'sheep',30),old=legacy(G,'sheep',45);
  for(const [b,max] of [[big,2],[small,1],[old,1]]){
    assert.equal(G.buildingDefinition(b).jobs,max);assert.equal(G.workerLimitOf(b),max);assert.equal(G.workforceSummary(b).maximum,max);
    assert(!G.setWorkerLimit(b,max+1));assert(G.setWorkerLimit(b,0));assert.equal(G.workerLimitOf(b),0);
    assert(G.setWorkerLimit(b,max));assert.equal(G.pastureSummary(b).workerMaximum,max);
  }
  G.applySaveData(data(G));assert.equal(G.workerLimitOf(G.world.bmap[big.id]),2);assert.equal(G.workerLimitOf(G.world.bmap[old.id]),1);
});
test('automatic scheduling fills both large-pasture jobs and respects a lowered limit after save/load',()=>{
  const G=fresh(),b=pen(G,[10,20]);G.game.livestock.sheep=2;assert(G.stockPasture(b,2));
  for(let i=0;i<4;i++)G.spawnCitizen({x:8,y:10+i,age:30,sex:i%2?'m':'f'});
  G.scheduleJobs();assert.equal(b.workers.length,2);assert.equal(G.workforceSummary(b).current,2);
  const cs=b.workers.map(id=>G.world.cmap[id]);careAll(G,b,cs);
  assert(G.setWorkerLimit(b,1));until(G,cs,()=>G.workforceWorkers(b).length===1);
  G.applySaveData(data(G));const loaded=G.world.bmap[b.id];G.scheduleJobs();
  assert.equal(loaded.workerLimit,1);assert.equal(loaded.workers.length,1);
  assert(G.setWorkerLimit(loaded,2));G.scheduleJobs();assert.equal(loaded.workers.length,2);
});
test('one and two real herders tend at the boundary without doubling per-animal daily eggs, wool or births',()=>{
  for(const type of ['sheep','chicken']){
    const production=[];
    for(const count of [1,2]){
      const G=fresh(),b=pen(G,[20,20],type);b.animals=4;b.animalTarget=G.pastureCapacity(b);
      const cs=workers(G,b,count);careAll(G,b,cs);assert(cs.every(c=>c.task?.economy==='pasture'));
      next(G);production.push({eggs:b.pastureProducts.eggs||0,wool:b.woolReady,growth:b.animalGrowth});
      assert.equal(G.game.res.eggs,0);assert.equal(G.game.res.wool,0);
      if(type==='chicken'){assert.equal(b.pastureProducts.eggs,2);G.advanceChickenEggs(b);assert.equal(b.pastureProducts.eggs,2);}
      else near(b.woolReady,4/G.SEASON_DAYS);
    }
    assert.deepEqual(production[0],production[1]);
  }
});
test('two herders withdraw bounded disjoint egg batches and preserve both cargo owners through reload and downstaffing',()=>{
  const G=fresh(),b=pen(G,[20,20],'chicken');b.animals=4;b.animalTarget=66;b.pastureProducts.eggs=30;
  const cs=workers(G,b,2);for(const c of cs)G.requestTask(c);
  until(G,cs,()=>cs.every(c=>c.carry?.type==='eggs'));
  assert.equal(cs.reduce((n,c)=>n+c.carry.qty,0),30);assert(cs.every(c=>c.carry.qty<=20));assert.equal(b.pastureProducts.eggs,0);
  assert.equal(G.game.res.eggs,0);assert(G.setWorkerLimit(b,1));G.applySaveData(data(G));
  const loaded=cs.map(c=>G.world.cmap[c.id]);assert.equal(loaded.reduce((n,c)=>n+c.carry.qty,0),30);
  until(G,loaded,()=>G.game.res.eggs===30);assert.equal(G.game.res.food,30);assert(loaded.every(c=>!c.carry));
  assert.equal(G.world.bmap[b.id].animals,4);assert.equal(G.world.bmap[b.id].workerLimit,1);
});
test('two herders shear the same pending wool only once and deliver both independent cargo batches',()=>{
  const G=fresh(),b=pen(G);b.animals=4;b.animalTarget=25;b.woolReady=12;
  const cs=workers(G,b,2);for(const c of cs)G.requestTask(c);
  until(G,cs,()=>cs.every(c=>c.carry?.type==='wool'));
  assert.equal(cs.reduce((n,c)=>n+c.carry.qty,0),12);assert.equal(b.woolReady,0);assert.equal(G.game.res.wool,0);
  until(G,cs,()=>G.game.res.wool===12);assert.equal(b.produced.wool,12);assert.equal(b.animals,4);
});
test('split and whole-herd transfer use destination capacity across all three species and conserve source products',()=>{
  for(const type of ['sheep','cattle','chicken']){
    const G=fresh(),a=pen(G,[20,20],type),small=pen(G,[7,7],type,40),big=pen(G,[20,20],type,60);
    a.animals=G.pastureCapacity(a);a.animalTarget=a.animals;
    assert(!G.pastureSplitFacts(a,small).ok);assert(!G.pastureEmptyFacts(a,small).ok);
    const count=a.animals,bank=JSON.stringify(G.game.livestock),q=G.pastureSplitQuote(a,big);assert(q.ok,q.reason);
    a.pastureProducts.meat=1;assert(G.splitPasture(a,big,q.key).ok);assert.equal(a.animals+big.animals,count);
    assert.equal(a.pastureProducts.meat,1);assert.equal(big.pastureProducts.meat,0);assert.equal(JSON.stringify(G.game.livestock),bank);
    const empty=pen(G,[20,20],type,10,40),eq=G.pastureEmptyQuote(big,empty);assert(eq.ok,eq.reason);
    assert(G.emptyPasture(big,empty,eq.key).ok);assert.equal(big.animals,0);assert.equal(a.animals+empty.animals,count);
  }
});
test('both transfer quotes reject changed source/destination area and orientation even while the herd still fits',()=>{
  for(const operation of ['Split','Empty'])for(const changed of ['source','target']){
    const G=fresh(),a=pen(G),b=pen(G,[20,20],'sheep',40);a.animals=10;a.animalTarget=25;
    const q=G['pasture'+operation+'Quote'](a,b);assert(q.ok,q.reason);
    const edit=changed==='source'?a:b;edit.pastureSize=[19,20];edit.w=19;
    assert(G['pasture'+operation+'Quote'](a,b).ok);
    const before=JSON.stringify(data(G));assert(!G[operation.toLowerCase()+'Pasture'](a,b,q.key).ok);assert.equal(JSON.stringify(data(G)),before);
  }
  const G=fresh(),a=pen(G),b=pen(G,[19,20],'sheep',40);a.animals=10;
  const q=G.pastureSplitQuote(a,b),cap=G.pastureCapacity(b);b.pastureSize=[20,19];b.w=20;b.h=19;
  assert.equal(G.pastureCapacity(b),cap);assert(!G.splitPasture(a,b,q.key).ok);
});
test('legacy no-size saves keep 6×6 identity, species caps, one job, old worksite cost and all pending products',()=>{
  for(const [type,cap] of [['sheep',12],['cattle',10],['chicken',24]]){
    const G=fresh(),b=legacy(G,type);b.animals=cap;b.animalTarget=cap;b.animalGrowth=.4;
    if(type==='sheep')b.woolReady=7;if(type==='chicken'){b.pastureProducts.eggs=8;b.eggProgress=.5;}
    const site=G.addBuilding('pasture',30,10,{free:true}).b;site.paidCost={wood:30};site.workLeft=40;site.progress=.2;site.constructionStarted=true;
    const save=data(G);assert.equal(save.buildings.find(x=>x.id===b.id).pastureSize,undefined);G.applySaveData(save);
    const loaded=G.world.bmap[b.id];assert.equal(loaded.w,6);assert.equal(loaded.h,6);assert.equal(G.pastureCapacity(loaded),cap);
    assert.equal(loaded.animals,cap);assert.equal(loaded.animalGrowth,.4);assert.equal(G.workerMaximumOf(loaded),1);assert.equal(G.pastureSummary(loaded).capacityRule,'legacy');
    assert.equal(G.world.bmap[site.id].workLeft,40);assert.equal(G.world.bmap[site.id].paidCost.wood,30);
    if(type==='sheep')assert.equal(loaded.woolReady,7);if(type==='chicken'){assert.equal(loaded.pastureProducts.eggs,8);assert.equal(loaded.eggProgress,.5);}
  }
});
test('explicit-size saves reject invalid identity, footprint, work, payment, staffing and live stock atomically',()=>{
  const G=fresh(),b=pen(G,[7,7]),saved=data(G),world=G.world,game=G.game;
  const edits=[
    x=>x.pastureSize=[6,7],x=>x.pastureSize=[20,21],x=>x.pastureSize=[7.5,7],x=>x.pastureSize=[7],x=>x.pastureSize=null,
    x=>x.w=8,x=>x.h=8,x=>delete x.pastureSize,x=>delete x.w,x=>delete x.h,x=>x.x=G.world.N-6,x=>{x.x=2;x.y=2;},
    x=>x.totalWork++,x=>x.workLeft=1,x=>x.workLeft=-1,x=>x.progress=.5,x=>delete x.totalWork,
    x=>x.paidCost={wood:36},x=>x.paidCost={stone:1},x=>delete x.paidCost,
    x=>x.workerLimit=2,x=>x.workerLimit=.5,x=>x.animals=4,x=>x.animalTarget=4,
    x=>{x.state='site';x.workLeft=x.totalWork;x.progress=0;x.animals=1;},
  ];
  for(const edit of edits){const bad=clone(saved);edit(bad.buildings.find(x=>x.id===b.id));assert.throws(()=>G.applySaveData(bad));assert.equal(G.world,world);assert.equal(G.game,game);}
  const nonPasture=clone(saved);nonPasture.buildings[0].pastureSize=[7,7];assert.throws(()=>G.applySaveData(nonPasture));assert.equal(G.world,world);
  const treeSave=clone(saved);treeSave.trees.push([10*G.world.N+10,10,10,0]);assert.throws(()=>G.applySaveData(treeSave));assert.equal(G.world,world);
  G.world.water[10*G.world.N+10]=1;assert.throws(()=>G.applySaveData(saved));assert.equal(G.world,world);G.world.water[10*G.world.N+10]=0;
  G.world.rock[10*G.world.N+10]=1;assert.throws(()=>G.applySaveData(saved));assert.equal(G.world,world);G.world.rock[10*G.world.N+10]=0;
});
test('joint deletion of all new shape fields cannot upgrade a new plot into dense legacy capacity',()=>{
  for(const instant of [false,true]){const G=fresh();G.game.res.wood=35;const placed=G.addBuilding('pasture',10,10,{pastureSize:[7,7],instant});assert(placed.ok,placed.reason);const b=placed.b,saved=data(G),world=G.world,game=G.game;
    for(const omitWork of [false,true]){const bad=clone(saved),record=bad.buildings.find(x=>x.id===b.id);delete record.pastureSize;delete record.w;delete record.h;if(omitWork)delete record.totalWork;
      assert.throws(()=>G.applySaveData(bad));assert.equal(G.world,world);assert.equal(G.game,game);}
  }
});
test('area save round-trips active livestock disease without replay or dropping chicken eggs',()=>{
  const G=fresh(),b=pen(G,[20,20],'chicken');b.animals=40;b.animalTarget=66;b.pastureProducts.eggs=12;b.eggProgress=.5;
  while(G.game.day<12)next(G);G.game.pasturePests={enabled:true,graceUntil:12,lastDay:12};b.pastureInfestation={animalType:'chicken',startedDay:12,lost:0};
  for(let i=0;i<3;i++)G.applySaveData(data(G));const loaded=G.world.bmap[b.id];
  assert.equal(loaded.animals,40);assert.equal(loaded.pastureProducts.eggs,12);assert.equal(loaded.eggProgress,.5);
  assert.equal(loaded.pastureInfestation.startedDay,12);assert.equal(loaded.pastureInfestation.lost,0);assert.equal(G.pastureCapacity(loaded),66);
});
test('reading area facts and summaries never mutates livestock, products, tasks or save data',()=>{
  const G=fresh(),a=pen(G),b=pen(G,[20,20],'sheep',40);a.animals=10;const before=JSON.stringify(data(G));
  for(let i=0;i<3;i++){G.pastureSummary(a);G.pastureSummary(b);G.pastureSplitQuote(a,b);G.pastureEmptyQuote(a,b);G.workforceSummary(a);G.pastureCapacity(a);}
  assert.equal(JSON.stringify(data(G)),before);
});
console.log(`Pasture area: ${passed} passed`);
