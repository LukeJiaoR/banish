/* Orchard #75: source-spaced areas, physical workers, and conservative saves. */
'use strict';
const assert=require('node:assert/strict'),path=require('node:path');
const {loadGame}=require('./helpers/playability');
const clone=x=>JSON.parse(JSON.stringify(x)),saved=G=>clone(G.serializeGame());
const near=(a,b)=>assert(Math.abs(a-b)<1e-7,`${a} != ${b}`);let passed=0;
function test(name,fn){fn();console.log('ok '+name);passed++;}
function fresh(){
  const G=loadGame(path.resolve(__dirname,'..'));G.newGame(1);const w=G.world;
  for(const k of ['water','rock','road'])w[k].fill(0);
  w.bgrid.fill(-1);w.treeIdx.fill(-1);w.trees=[];w.buildings=[];w.bmap={};w.citizens=[];w.cmap={};w.families=[];w.marked.clear();w.markedRocks.clear();
  G.bumpNavigation(w);G.game.h=12;G.rng=()=>.5;
  G.addBuilding('storage',2,2,{instant:true,free:true});
  for(const k of G.RES_KEYS)G.game.res[k]=0;G.game.res.tools=100;G.game.res.wood=500;
  G.game.unlocks.orchard=G.game.unlocks.apple=G.game.unlocks.pear=true;
  const gen=G.genWorld;G.genWorld=(seed,opt)=>{const nw=gen(seed,opt);nw.water.set(w.water);nw.rock.set(w.rock);return nw;};
  G.game.townLedger=G.newTownLedger(G.game);G.hasOpenModal=()=>false;return G;
}
function plot(G,size=[15,15],instant=true,x=10,y=10){
  const result=G.addBuilding('orchard',x,y,{orchardSize:size,instant});assert(result.ok,result.reason);return result.b;
}
function workers(G,b,count){
  const cs=[];for(let i=0;i<count;i++){const c=G.spawnCitizen({x:b.x-1,y:b.y+i,age:30,sex:i%2?'f':'m'});G.assignWorker(b,c);cs.push(c);}return cs;
}
function until(G,cs,done,max=40000){for(let i=0;i<max&&!done();i++)for(const c of cs)G.stepCitizen(c,.1);assert(done(),'physical orchard workers did not finish');}
function clockAt(G,day){G.game.day=day;G.game.year=Math.floor(day/G.YEAR_DAYS)+1;G.game.season=Math.floor(day/G.SEASON_DAYS)%4;G.game.h=12;G.game.townLedger=G.newTownLedger(G.game);}
function fullFruit(G,b,type='apple'){
  clockAt(G,24);for(const t of b.orchardTrees)Object.assign(t,{type,planted:true,age:G.ORCHARD.matureDays,tendedDay:24});
  b.orchardDay=23;G.advanceOrchard(b);
}
function inventory(G,b,type){return (b?.orchardTrees||[]).filter(t=>G.orchardOutput(t)===type).reduce((n,t)=>n+t.fruit,0)+(G.game.res[type]||0)+G.world.citizens.reduce((n,c)=>n+(c.carry?.type===type?c.carry.qty:0),0);}
test('five reference geometries and integer work points use two east-west / three north-south spacing',()=>{
  const G=fresh();
  for(const [w,h,columns,rows,count] of [[4,4,2,2,4],[15,4,8,2,16],[4,13,2,5,10],[13,4,7,2,14],[15,15,8,5,40]]){
    const b={x:10,y:20,w,h,orchardSize:[w,h]},layout=G.orchardLayout(b),def=G.buildingDefinition({...b,type:'orchard'});
    assert.deepEqual(clone(layout),{columns,rows,count,legacy:false});assert.equal(G.orchardTreeCount(b),count);
    assert.equal(def.cost.wood,w+h);assert.equal(def.buildWork,w*h);assert.equal(def.jobs,Math.min(3,Math.ceil(w*h/72)));
    const points=Array.from({length:count},(_,i)=>G.orchardPoint(b,i));assert.equal(new Set(points.map(p=>p.x+','+p.y)).size,count);
    for(let i=0;i<count;i++){const p=points[i];assert(Number.isInteger(p.x)&&Number.isInteger(p.y));assert(p.x>=b.x&&p.x<b.x+w&&p.y>=b.y&&p.y<b.y+h);if(i%columns)assert.equal(p.x-points[i-1].x,2);if(i>=columns)assert.equal(p.y-points[i-columns].y,3);}
  }
  assert.equal(G.initialOrchardWorkers([8,9]),1);assert.equal(G.initialOrchardWorkers([5,15]),2);assert.equal(G.initialOrchardWorkers([12,12]),2);assert.equal(G.initialOrchardWorkers([10,15]),3);
  assert.equal(G.orchardDefinition(),G.BDEF.orchard);assert.equal(G.initialOrchardWorkers(),2);
});
test('bounds, wrong types and invalid placement preserve the world and material balance',()=>{
  const G=fresh(),w=G.world;
  for(const size of [null,[],[4],[4,4,4],[3,4],[16,4],[4,3],[4,16],[4.5,4],['4',4],[,4],[4,,]]){
    assert.equal(G.orchardDefinition(size),null);const before=JSON.stringify(saved(G));assert(!G.addBuilding('orchard',10,10,{orchardSize:size}).ok);assert.equal(JSON.stringify(saved(G)),before);
  }
  assert(!G.addBuilding('house',10,10,{orchardSize:[4,4]}).ok);assert(!G.addBuilding('orchard',10,10,{orchardSize:[4,4],pastureSize:[7,7]}).ok);
  assert(!G.canPlace(w,'orchard',10.5,10,[4,4]).ok);assert(!G.canPlace(w,'orchard',w.N-14,0,[15,15]).ok);
  for(const kind of ['water','rock','bgrid']){const i=24*w.N+24,before=w[kind][i];w[kind][i]=kind==='bgrid'?9:1;assert(!G.canPlace(w,'orchard',10,10,[15,15]).ok);w[kind][i]=before;}
  assert(G.canPlace(w,'orchard',10,10,[15,15]).ok);
});
test('preview is read-only, stale costs and tree clearing require re-review, confirm builds once',()=>{
  const G=fresh(),w=G.world;G.setTool('orchard');const before=JSON.stringify(saved(G));G.selectOrchardCorner(24,13);G.selectOrchardCorner(10,10);
  const first=G.orchardPlanStatus();assert(first.ok);assert.equal(first.count,16);assert.equal(first.workers,1);assert.equal(first.cost.wood,19);assert.equal(first.work,60);assert.equal(JSON.stringify(saved(G)),before);
  G.game.res.wood--;assert(!G.confirmOrchardPlan(first).ok);const next=G.orchardPlanStatus();
  const tree={x:24,y:13,i:13*w.N+24,b:-48};w.trees.push(tree);w.treeIdx[tree.i]=0;assert(!G.confirmOrchardPlan(next).ok);
  const final=G.orchardPlanStatus();assert.equal(final.trees,1);const result=G.confirmOrchardPlan(final);assert(result.ok);assert.equal(result.b.orchardTrees.length,16);assert.deepEqual(clone(result.b.orchardSize),[15,4]);
  const count=w.buildings.length,wood=G.game.res.wood;assert(!G.confirmOrchardPlan(final).ok);assert.equal(w.buildings.length,count);assert.equal(G.game.res.wood,wood);assert.equal(G.orchardPlan,null);
});
test('two and three farmers physically clear, construct, plant, care four years, then harvest and haul exactly once',()=>{
  for(const [size,n] of [[[9,9],2],[[15,15],3]]){
    const G=fresh(),w=G.world,[width,height]=size,tree={x:10+width-1,y:10+height-1,b:-48};tree.i=tree.y*w.N+tree.x;w.trees.push(tree);w.treeIdx[tree.i]=0;G.bumpNavigation(w);
    G.addBuilding('storage',30,2,{instant:true,free:true});
    const b=plot(G,size,false),count=G.orchardTreeCount(b),cs=workers(G,b,n);
    assert.equal(G.siteTrees(b).length,1);assert.equal(G.game.res.wood,500);assert.deepEqual(clone(b.construction.required),{wood:width+height});assert.deepEqual(clone(b.construction.onsite),{});assert.equal(b.totalWork,width*height);G.finishBuilding(b);assert.equal(b.state,'site');
    until(G,cs,()=>G.siteTrees(b).length===0);assert.equal(b.workLeft,width*height);
    until(G,cs,()=>b.state==='ok');assert.equal(b.workLeft,0);assert.equal(b.progress,1);assert.equal(G.workerMaximumOf(b),n);assert.equal(b.construction.consumed,true);assert.equal(G.game.res.wood,500-width-height+G.TREE_LOGS);
    assert(G.setOrchardType(b,'apple'));
    until(G,cs,()=>b.orchardTrees.every(t=>t.planted));assert.equal(b.orchardYield,0);
    // The first tasks accepted at completion keep the old seed choice. Future slots use apples.
    assert(b.orchardTrees.some(t=>t.type==='apple'));
    for(let day=1;day<=G.ORCHARD.matureDays;day++){
      clockAt(G,day);G.advanceOrchard(b);for(const c of cs)G.requestTask(c);
      until(G,cs,()=>b.orchardTrees.every(t=>t.age>=G.ORCHARD.matureDays||t.tendedDay===day));
      assert.equal(b.orchardYield,0,'no fruit before the first mature autumn');
    }
    assert(b.orchardTrees.every(t=>t.age>=G.ORCHARD.matureDays));clockAt(G,216);G.advanceOrchard(b);assert.equal(b.orchardYield,count*20);
    const production={};for(const type of ['apples','vegetables'])production[type]=inventory(G,b,type);
    for(const c of cs)G.requestTask(c);assert.equal(new Set(cs.map(c=>c.task.ti)).size,n);
    const accepted=cs.map(c=>c.task);until(G,cs,()=>b.orchardYield===0&&cs.every(c=>!c.carry));
    for(let i=0;i<cs.length;i++)G.completeOrchardTask(cs[i],accepted[i]);
    near(G.game.res.apples+G.game.res.vegetables,count*20);near(G.game.res.food,count*20);
    for(const type of ['apples','vegetables'])near(inventory(G,b,type),production[type]);
    console.log(JSON.stringify({area:size,workers:n,trees:count,firstHarvestDay:216,fruitDelivered:count*20}));
  }
});
test('all forty lifespans remain twelve to twenty years and update only the expired slot',()=>{
  const G=fresh(),b=plot(G);fullFruit(G,b);const old=b.orchardTrees.slice();
  for(let i=0;i<40;i++){assert.equal(G.orchardLifetime(i)/G.YEAR_DAYS,12+i%9);b.orchardTrees[i].age=G.orchardLifetime(i)-2;}
  b.orchardTrees[39].age++;G.game.day++;G.advanceOrchard(b);assert.equal(b.orchardTrees[39].planted,false);assert.equal(b.orchardTrees[39].cycle,1);
  for(let i=0;i<39;i++)assert.equal(b.orchardTrees[i],old[i]);assert.equal(G.orchardSummary(b).count,40);
});
test('variety changes only future tasks; forty trees and picked cargo survive round-trips',()=>{
  const G=fresh(),b=plot(G),cs=workers(G,b,3),accepted=cs.map(c=>c.task),ids=cs.map(c=>c.id);
  assert(G.setOrchardType(b,'pear'));assert(G.setOrchardReplant(b,false));until(G,cs,()=>accepted.every(t=>t.tree.planted));
  for(const t of accepted)assert.equal(t.tree.type,'legacy');assert.equal(b.orchardTrees.filter(t=>t.planted).length,3);
  for(const c of cs)G.releaseWorker(c);fullFruit(G,b,'pear');G.setWorkerLimit(b,3);for(const c of cs)G.assignWorker(b,c);
  until(G,cs,()=>cs.every(c=>!!c.carry));const budget=inventory(G,b,'pears');assert.equal(budget,800);
  const snapshot=saved(G),stored=snapshot.buildings.find(x=>x.id===b.id);assert.deepEqual(stored.orchardSize,[15,15]);assert.equal(stored.w,15);assert.equal(stored.h,15);
  for(let i=0;i<3;i++)G.applySaveData(saved(G));const loaded=G.world.bmap[b.id];assert.equal(loaded.orchardTrees.length,40);assert.equal(G.workerMaximumOf(loaded),3);near(inventory(G,loaded,'pears'),budget);
  for(const id of ids)assert.equal(G.world.cmap[id].carry.type,'pears');
});
test('picked fruit remains conserved through full-store partial hauling, zero staffing, demolition and reload',()=>{
  const G=fresh(),b=plot(G),cs=workers(G,b,3);for(const c of cs)G.releaseWorker(c);fullFruit(G,b);for(const c of cs)G.assignWorker(b,c);
  until(G,cs,()=>cs.every(c=>c.carry?.qty===20));assert.equal(b.orchardYield,740);G.setWorkerLimit(b,0);
  G.game.res.grain=G.game.res.food=G.storageCap()-7;G.game.townLedger=G.newTownLedger(G.game);until(G,cs,()=>cs.every(c=>c.state==='waitStorage'));near(G.game.res.apples,7);near(cs.reduce((n,c)=>n+c.carry.qty,0),53);
  G.removeBuilding(b);for(let i=0;i<2;i++)G.applySaveData(saved(G));const loaded=cs.map(c=>G.world.cmap[c.id]);assert.equal(G.world.bmap[b.id],undefined);near(loaded.reduce((n,c)=>n+c.carry.qty,0),53);
  G.game.res.grain-=53;G.game.res.food-=53;G.reconcileFood(G.game);until(G,loaded,()=>loaded.every(c=>!c.carry));near(G.game.res.apples,60);near(G.townLedgerSummary().current.totals.apples.received,60);
});
test('area cost, construction progress and cancellation refund survive saves without gifting wood',()=>{
  const G=fresh(),size=[15,15],b=plot(G,size,false);size[0]=4;assert.equal(b.w,15);assert.equal(b.orchardSize[0],15);assert.equal(b.paidCost.wood,30);
  G.applySaveData(saved(G));const loaded=G.world.bmap[b.id];G.removeBuilding(loaded);assert.equal(G.game.res.wood,500);G.removeBuilding(loaded);assert.equal(G.game.res.wood,500);
  const started=plot(G,[15,15],false),cs=workers(G,started,3);
  until(G,cs,()=>started.progress>0);assert(started.constructionStarted);assert(started.construction.consumed);assert.equal(G.game.res.wood,470);const left=started.workLeft;
  G.applySaveData(saved(G));assert.equal(G.world.bmap[started.id].workLeft,left);G.removeBuilding(G.world.bmap[started.id]);assert.equal(G.game.res.wood,485);assert.equal(G.game.constructionLost.wood,15);
});
test('malformed area records reject atomically, including shape-stripped dense-legacy forgeries',()=>{
  const G=fresh(),b=plot(G),base=saved(G),world=G.world,game=G.game;
  const edits=[q=>q.orchardSize=null,q=>q.orchardSize='15,15',q=>q.orchardSize=[15,16],q=>q.orchardSize=[15,15,15],q=>q.orchardSize=['15',15],q=>q.w='15',q=>q.h=14,q=>delete q.w,q=>delete q.h,q=>q.totalWork=36,q=>q.workLeft=1,q=>q.progress=.9,q=>q.paidCost.wood=12,q=>q.paidCost.stone=1,q=>delete q.paidCost,q=>q.workerLimit=4,q=>q.orchardTrees.pop(),q=>q.orchardTrees=null,q=>delete q.orchardTrees,q=>q.orchardTrees[39].age=G.orchardLifetime(39),q=>q.orchardTrees[0].planted='false',q=>q.orchardYield=801,q=>{delete q.orchardSize;delete q.w;delete q.h;},q=>{delete q.orchardSize;delete q.w;delete q.h;q.orchardTrees=q.orchardTrees.slice(0,9);},q=>{delete q.orchardSize;delete q.w;delete q.h;delete q.orchardTrees;}];
  for(const edit of edits){const d=clone(base);edit(d.buildings.find(q=>q.id===b.id));assert.throws(()=>G.applySaveData(d));assert.equal(G.world,world);assert.equal(G.game,game);}
  const d=clone(base);d.buildings[0].orchardSize=[4,4];assert.throws(()=>G.applySaveData(d));assert.equal(G.world,world);
  const site=plot(G,[4,4],false,30,30),sd=saved(G),q=sd.buildings.find(q=>q.id===site.id);q.orchardTrees[0].planted=true;assert.throws(()=>G.applySaveData(sd));assert.equal(G.world,world);
});

// Actual v0.3.68 serializer output from main 1b6652a466289e0dcf8fc4dcbcd5e1c4968ccdeb.
// Physical two-worker construction and harvest; a partial site is retained too.
// Fixture was generated with the immutable baseline, not by deleting new shape fields.
const LEGACY_0368={"v":1,"seed":1,"N":128,"mapVersion":1,"game":{"v":"0.3.68","startConfig":{"v":1,"preset":"classic","seed":1},"h":12,"day":24,"season":2,"year":1,"res":{"wood":476,"stone":0,"iron":0,"tools":100,"food":0,"meat":0,"eggs":0,"vegetables":0,"grain":0,"apples":0,"pears":0,"firewood":0,"leather":0,"wool":0,"clothes":0,"herbs":0,"coal":0,"steelTools":0,"ale":0,"warmCoats":0},"stats":{"born":0,"died":0,"deadReasons":{}},"prevFood":200,"foodNet":0,"foodUrgent":true,"warned":{},"supplyMode":"automatic","clothingSupply":false,"heating":{"allowCoal":false,"coalReserve":20},"fishingRules":"shared","fireDisasters":{"enabled":false,"startedDay":null,"graceUntil":0,"lastDay":-1,"nextIgnitionDay":0,"serial":0,"incidentHomes":[]},"farmPests":{"enabled":false,"graceUntil":0,"lastDay":-1},"pasturePests":{"enabled":false,"graceUntil":0,"lastDay":-1},"townLedger":{"v":1,"startDay":24,"startHour":12,"current":{"day":24,"fromHour":12,"partial":true,"opening":{"meat":0,"eggs":0,"vegetables":0,"grain":0,"apples":0,"pears":0,"firewood":0},"flows":{"meat":{"produced":0,"received":0,"used":0,"withdrawn":0,"discarded":0,"distributedUsed":0,"distributedLost":0},"eggs":{"produced":0,"received":0,"used":0,"withdrawn":0,"discarded":0,"distributedUsed":0,"distributedLost":0},"vegetables":{"produced":0,"received":0,"used":0,"withdrawn":0,"discarded":0,"distributedUsed":0,"distributedLost":0},"grain":{"produced":0,"received":0,"used":0,"withdrawn":0,"discarded":0,"distributedUsed":0,"distributedLost":0},"apples":{"produced":0,"received":0,"used":0,"withdrawn":0,"discarded":0,"distributedUsed":0,"distributedLost":0},"pears":{"produced":0,"received":0,"used":0,"withdrawn":0,"discarded":0,"distributedUsed":0,"distributedLost":0},"firewood":{"produced":0,"received":0,"used":0,"withdrawn":0,"discarded":0,"distributedUsed":0,"distributedLost":0}}},"days":[]},"challenges":{"v":1,"completed":{}},"hist":[],"buildLog":[{"d":0,"t":"storage"},{"d":0,"t":"storage"},{"d":0,"t":"orchard"},{"d":24,"t":"orchard"}],"toolMode":"pooled","toolRemainders":{"tools":0,"steelTools":0},"toolWear":0,"steelToolWear":0,"healthStartDay":0,"nomads":{"nextDay":48,"serial":0,"offer":null,"accepted":0,"declined":0},"unlocks":{"wheat":true,"orchard":true,"apple":true,"pear":true,"cabbage":false,"beans":false},"livestock":{"sheep":0,"cattle":0,"chicken":0}},"roads":[],"stoneRoads":[],"trees":[],"marked":[],"markedRocks":[],"rockCleared":[],"buildings":[{"id":22,"type":"storage","x":2,"y":2,"state":"ok","progress":1,"workLeft":0,"totalWork":110,"paidCost":{},"constructionStarted":false,"workers":[],"family":null,"noWork":false,"warnText":""},{"id":23,"type":"orchard","x":10,"y":10,"state":"ok","progress":1,"workLeft":0,"totalWork":36,"paidCost":{"wood":12},"constructionStarted":true,"workers":[],"family":null,"noWork":false,"warnText":"","orchardAge":192,"orchardYield":140,"orchardType":"legacy","orchardTrees":[{"type":"apple","planted":true,"age":192,"fruit":0,"season":1,"tendedDay":23,"cycle":0},{"type":"pear","planted":true,"age":193,"fruit":20,"season":1,"tendedDay":23,"cycle":1},{"type":"apple","planted":true,"age":194,"fruit":20,"season":1,"tendedDay":23,"cycle":0},{"type":"pear","planted":true,"age":195,"fruit":0,"season":1,"tendedDay":23,"cycle":1},{"type":"apple","planted":true,"age":196,"fruit":20,"season":1,"tendedDay":23,"cycle":0},{"type":"pear","planted":true,"age":197,"fruit":20,"season":1,"tendedDay":23,"cycle":1},{"type":"apple","planted":true,"age":198,"fruit":20,"season":1,"tendedDay":23,"cycle":0},{"type":"pear","planted":true,"age":199,"fruit":20,"season":1,"tendedDay":23,"cycle":1},{"type":"apple","planted":true,"age":200,"fruit":20,"season":1,"tendedDay":23,"cycle":0}],"orchardDay":24,"orchardReplant":true},{"id":26,"type":"orchard","x":30,"y":10,"state":"site","progress":0.3472222222222222,"workLeft":23.5,"totalWork":36,"paidCost":{"wood":12},"constructionStarted":true,"workers":[24,25],"family":null,"noWork":false,"warnText":"","orchardAge":0,"orchardYield":0,"orchardType":"legacy","orchardTrees":[{"type":"legacy","planted":false,"age":0,"fruit":0,"season":0,"tendedDay":-1,"cycle":0},{"type":"legacy","planted":false,"age":0,"fruit":0,"season":0,"tendedDay":-1,"cycle":0},{"type":"legacy","planted":false,"age":0,"fruit":0,"season":0,"tendedDay":-1,"cycle":0},{"type":"legacy","planted":false,"age":0,"fruit":0,"season":0,"tendedDay":-1,"cycle":0},{"type":"legacy","planted":false,"age":0,"fruit":0,"season":0,"tendedDay":-1,"cycle":0},{"type":"legacy","planted":false,"age":0,"fruit":0,"season":0,"tendedDay":-1,"cycle":0},{"type":"legacy","planted":false,"age":0,"fruit":0,"season":0,"tendedDay":-1,"cycle":0},{"type":"legacy","planted":false,"age":0,"fruit":0,"season":0,"tendedDay":-1,"cycle":0},{"type":"legacy","planted":false,"age":0,"fruit":0,"season":0,"tendedDay":-1,"cycle":0}],"orchardDay":24,"orchardReplant":true}],"families":[],"citizens":[{"id":24,"name":"许峰","sex":"m","age":30,"adult":true,"x":10.796353247018274,"y":10.796353247018274,"familyId":null,"job":26,"partnerId":null,"parentIds":[],"grandparentIds":[],"ancestorIds":[],"birthFamilyId":null,"student":0,"educated":0,"school":null,"studyHours":0,"studyToday":0,"studyDay":24,"toolType":null,"toolHours":0,"arrivalHallId":null,"hunger":0,"cold":0,"clothingLeft":0,"clothingType":null,"dietVariety":0,"dietScore":1,"happiness":3,"leisureDays":0,"chapelDays":0,"chapelId":null,"health":4,"sickDays":0,"immunityDays":0,"herbCooldown":0,"careHours":0,"camped":0,"carry":{"type":"apples","qty":20,"orchardId":23}},{"id":25,"name":"许露","sex":"f","age":30,"adult":true,"x":11,"y":13,"familyId":null,"job":26,"partnerId":null,"parentIds":[],"grandparentIds":[],"ancestorIds":[],"birthFamilyId":null,"student":0,"educated":0,"school":null,"studyHours":0,"studyToday":0,"studyDay":24,"toolType":null,"toolHours":0,"arrivalHallId":null,"hunger":0,"cold":0,"clothingLeft":0,"clothingType":null,"dietVariety":0,"dietScore":1,"happiness":3,"leisureDays":0,"chapelDays":0,"chapelId":null,"health":4,"sickDays":0,"immunityDays":0,"herbCooldown":0,"careHours":0,"camped":0,"carry":{"type":"pears","qty":20,"orchardId":23}}],"supplyCaches":[],"nextUid":27};
test('real .68 completed and partial-site saves retain nine slots, old points, paid wood, fruit and cargo',()=>{
  const G=fresh(),d=clone(LEGACY_0368),rows=d.buildings.filter(b=>b.type==='orchard');assert.equal(d.game.v,'0.3.68');
  G.applySaveData(d);
  for(const row of rows){const b=G.world.bmap[row.id];assert.equal(b.orchardSize,undefined);assert.deepEqual(clone(G.orchardLayout(b)),{columns:3,rows:3,count:9,legacy:true});assert.equal(G.workerMaximumOf(b),2);assert.equal(b.w,6);assert.equal(b.h,6);assert.equal(b.totalWork,36);assert.equal(b.workLeft,row.workLeft);assert.equal(b.progress,row.progress);assert.equal(b.paidCost.wood,12);assert.deepEqual(clone(b.orchardTrees),row.orchardTrees);
    for(let i=0;i<9;i++)assert.deepEqual(clone(G.orchardPoint(b,i)),{x:b.x+1+i%3*2,y:b.y+1+Math.floor(i/3)*2});
  }
  const stocks=clone(G.game.res),cargo=G.world.citizens.map(c=>clone(c.carry)),built=rows.find(b=>b.state==='ok');
  for(let i=0;i<3;i++)G.applySaveData(saved(G));assert.deepEqual(clone(G.game.res),stocks);assert.deepEqual(G.world.citizens.map(c=>clone(c.carry)),cargo);assert.equal(G.world.bmap[built.id].orchardYield,built.orchardYield);
  const oldSite=rows.find(b=>b.state==='site'),wood=G.game.res.wood;G.removeBuilding(G.world.bmap[oldSite.id]);assert.equal(G.game.res.wood,wood+6);
});
test('genuine legacy aggregate migration preserves partial fruit and mature age across repeated loads',()=>{
  const G=fresh(),d=clone(LEGACY_0368),row=d.buildings.find(b=>b.type==='orchard'&&b.state==='ok');
  for(const k of ['orchardTrees','orchardDay','orchardReplant','orchardWarnYear','orchardType'])delete row[k];
  row.orchardAge=192;row.orchardYield=137;row.orchardSeason=1;row.tendedDay=23;G.applySaveData(d);
  for(let i=0;i<3;i++)G.applySaveData(saved(G));const b=G.world.bmap[row.id];assert.equal(b.orchardTrees.length,9);assert.equal(b.orchardYield,137);assert.equal(b.orchardAge,192);assert(b.orchardTrees.every(t=>t.type==='legacy'&&t.tendedDay===23));assert.equal(G.orchardSummary(b).nextDeath,8*G.YEAR_DAYS);
});
console.log('Orchard area: '+passed+' passed');
