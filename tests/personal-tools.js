'use strict';
const assert=require('node:assert/strict'),path=require('node:path');
const {loadGame}=require('./helpers/playability');let passed=0;
function fresh(){const G=loadGame(path.resolve(__dirname,'..'));G.newGame(4);const w=G.world;for(const k of ['water','rock','road'])w[k].fill(0);w.bgrid.fill(-1);w.treeIdx.fill(-1);for(const k of ['trees','citizens','buildings','families'])w[k]=[];w.cmap={};w.bmap={};w.marked.clear();w.markedRocks.clear();G.bumpNavigation(w);G.game.h=6;G.rng=()=>.5;G.addBuilding('storage',2,10,{instant:true,free:true});return G;}
const building=(G,type='stonequarry',x=12,y=10)=>G.addBuilding(type,x,y,{instant:true,free:true}).b;
const person=(G,x=11,y=10)=>G.spawnCitizen({x,y,age:25,sex:'m'});
function enable(G){const q=G.toolModeQuote();assert(q.ok,q.reason);assert(G.enablePersonalTools(q.key,G.game));}
function load(G){const n=G.prepareSaveData(JSON.parse(JSON.stringify(G.serializeGame())));G.world=n.world;G.game=n.game;return n;}
function until(G,p,hours=100){let n=0;while(!p()&&n++<hours*10)G.advanceSim(.1);assert(p(),'timeout '+JSON.stringify(G.world.citizens.map(c=>({x:c.x,y:c.y,state:c.state,kind:c.task?.kind,tool:c.toolType,job:c.job}))));return n/10;}
const near=(a,b)=>assert(Math.abs(a-b)<1e-7,`${a} != ${b}`);
function test(name,fn){fn();passed++;console.log('ok '+name);}
test('old pooled mode and exact remaining wear survive opt-in migration and three loads',()=>{
 const G=fresh();G.game.res.tools=3;G.game.res.steelTools=2;G.game.toolWear=.25;G.game.steelToolWear=.5;
 const q=G.toolModeQuote(),before=JSON.stringify(G.serializeGame());G.toolModeQuote();assert.equal(JSON.stringify(G.serializeGame()),before);enable(G);
 assert.equal(G.game.res.tools,2);assert.equal(G.game.res.steelTools,1);assert.equal(G.toolStock(),5);near(G.toolRemainingHours(),(3-.25)*1920+(2-.5)*3840);
 assert.equal(G.enablePersonalTools(q.key),false);for(let i=0;i<3;i++)load(G);near(G.toolRemainingHours(),11040);assert.equal(G.game.toolWear,0);
});
test('ambiguous old wear refuses migration; fractional spare stock is preserved without inventing a tool',()=>{
 const G=fresh();G.game.res.tools=.5;G.game.toolWear=.25;const before=JSON.stringify(G.serializeGame()),q=G.toolModeQuote();assert(!q.ok);assert(!G.enablePersonalTools(q.key));assert.equal(JSON.stringify(G.serializeGame()),before);
 G.game.toolWear=0;G.game.res.steelTools=0;enable(G);assert.equal(G.game.res.tools,.5);assert.equal(G.toolFetchChoice(),null);load(G);assert.equal(G.game.res.tools,.5);
});
test('two real workers competing for the last tool only equip one at a real warehouse door',()=>{
 const G=fresh(),b=building(G),a=person(G),c=person(G,11,11);G.game.res.tools=1;G.game.res.steelTools=0;enable(G);G.assignWorker(b,a);G.assignWorker(b,c);
 assert.equal(G.game.res.tools,1);assert(!G.toolEquipped(a)&&!G.toolEquipped(c));let picked=false;
 for(let i=0;i<240;i++){G.advanceSim(.1);const equipped=G.world.citizens.filter(G.toolEquipped);near(G.game.res.tools+equipped.length,1);if(equipped.length){picked=true;assert.equal(equipped[0].toolType,'tools');}}
 assert(picked);assert.equal(G.world.citizens.filter(G.toolEquipped).length,1);assert.equal(b.workers.length,2);
});
test('individual work is half speed only for the unequipped worker; steel does not increase speed',()=>{
 const G=fresh(),b=building(G),people=[person(G),person(G,11,11),person(G,11,12)];enable(G);G.game.res.tools=0;
 const progress=[];for(let i=0;i<3;i++){const c=people[i],t=G.makeTask(b,c),spot=G.workSpot(G.world,b,c.x,c.y);c.job=b.id;c.task=t;c.x=spot.x;c.y=spot.y;t.tx=c.x;t.ty=c.y;t.workLeft=10;c.state='work';c.toolType=i===0?null:i===1?'tools':'steelTools';c.toolHours=i===0?0:G.toolLifeHours(c.toolType);G.stepCitizen(c,1);progress.push(10-t.workLeft);if(i)near(c.toolHours,G.toolLifeHours(c.toolType)-1);}
 near(progress[0]*2,progress[1]);near(progress[1],progress[2]);assert.equal(G.toolLifeHours('steelTools'),G.toolLifeHours('tools')*2);
});
test('tool breaking inside a real work tick splits time without over-wearing or losing output',()=>{
 const G=fresh(),b=building(G),c=person(G);enable(G);G.game.res.tools=0;const t=G.makeTask(b,c);c.job=b.id;c.task=t;c.x=t.tx;c.y=t.ty;c.state='work';t.workLeft=2;c.toolType='tools';c.toolHours=.05;G.stepCitizen(c,.1);near(t.workLeft,1.925);assert.equal(c.toolHours,0);assert.equal(c.toolType,null);
 c.toolType='tools';c.toolHours=10;t.workLeft=.02;G.stepCitizen(c,1);near(c.toolHours,9.98);assert(c.carry);assert.equal(c.carry.qty,6);
});
test('real interrupted warehouse trip survives night and load; only pickup removes old half-used tool',()=>{
 const G=fresh(),b=building(G),c=person(G);G.game.res.tools=2;G.game.toolWear=.5;enable(G);G.game.h=21.5;G.assignWorker(b,c);const id=c.id;for(let i=0;i<10;i++)G.advanceSim(.1);assert.equal(G.game.toolRemainders.tools,960);assert.equal(G.game.res.tools,1);
 for(let i=0;i<3;i++)load(G);until(G,()=>G.toolEquipped(G.world.cmap[id]),60);const next=G.world.cmap[id];near(next.toolHours,960);assert.equal(G.game.res.tools,1);assert.equal(G.game.toolRemainders.tools,0);load(G);near(G.world.cmap[id].toolHours,960);
});
test('water-blocked tool pickup preserves stock and job while ordinary production continues',()=>{
 const G=fresh(),b=building(G, 'stonequarry',20),c=person(G,19,10);for(let y=0;y<G.world.N;y++)G.world.water[y*G.world.N+15]=1;G.bumpNavigation(G.world);G.game.res.tools=1;enable(G);G.assignWorker(b,c);assert.equal(c.task.kind,'work');assert.equal(c.job,b.id);assert.match(c.toolWaitReason,/无可达/);
 until(G,()=>!!c.carry,40);assert.equal(c.carry.qty,6);assert.equal(G.game.res.tools,1);assert(!G.toolEquipped(c));
});
test('teachers do not fetch tools, retiring workers cancel unpaid pickup, cargo is never interrupted',()=>{
 const G=fresh(),school=building(G,'school'),teacher=person(G);teacher.educated=true;enable(G);G.assignWorker(school,teacher);assert.notEqual(teacher.task?.kind,'toolFetch');
 const b=building(G,'stonequarry',22),c=person(G,21);G.assignWorker(b,c);assert.equal(c.task.kind,'toolFetch');const stock=G.game.res.tools;G.setWorkerLimit(b,0);assert.equal(c.job,null);assert.equal(c.task,null);assert.equal(G.game.res.tools,stock);
 c.carry={type:'stone',qty:6,staffingReturn:true};G.requestTask(c);assert.equal(c.carry.qty,6);assert.notEqual(c.task?.kind,'toolFetch');
});
test('accepted old work keeps its yield and processing rule during the one-time conversion',()=>{
 const G=fresh(),b=building(G),c=person(G);G.game.res.tools=0;const t=G.makeTask(b,c);c.job=b.id;b.workers=[c.id];c.task=t;c.x=t.tx;c.y=t.ty;c.state='work';t.workLeft=2;assert.equal(t.yield.qty,3);enable(G);G.stepCitizen(c,1);near(t.workLeft,1);G.stepCitizen(c,1);assert.equal(c.carry.qty,3);
});
test('malformed equipment and double-wear snapshots fail atomically; legacy fields may be absent',()=>{
 const G=fresh(),c=person(G);const old=JSON.parse(JSON.stringify(G.serializeGame()));delete old.game.toolMode;delete old.game.toolRemainders;delete old.citizens[0].toolType;delete old.citizens[0].toolHours;assert.equal(G.prepareSaveData(old).game.toolMode,'pooled');enable(G);
 const before=JSON.stringify(G.serializeGame());for(const corrupt of [d=>d.citizens[0].toolType='gold',d=>d.citizens[0].toolHours=1,d=>d.game.toolWear=.1,d=>d.game.toolRemainders.tools=-1,d=>delete d.game.toolRemainders,d=>delete d.citizens[0].toolHours,d=>{d.game.toolMode='pooled';d.game.toolRemainders.tools=5;},d=>{d.citizens[0].toolType='tools';d.citizens[0].toolHours=1921;}]){const data=JSON.parse(before);corrupt(data);assert.throws(()=>G.prepareSaveData(data));assert.equal(JSON.stringify(G.serializeGame()),before);}
});
test('equipped tools stay personal through job changes and death does not create spare stock',()=>{
 const G=fresh(),b=building(G),c=person(G);G.game.res.tools=1;enable(G);G.assignWorker(b,c);until(G,()=>G.toolEquipped(c));const life=c.toolHours;G.releaseWorker(c);assert.equal(c.toolHours,life);assert.equal(G.game.res.tools,0);
 const newcomer=person(G);assert.equal(newcomer.toolHours,0);G.killCitizen(c,'年老去世');assert.equal(G.game.res.tools,0);load(G);assert.equal(G.game.res.tools,0);assert.equal(G.world.cmap[newcomer.id].toolHours,0);
});

test('a genuinely tool-less blacksmith still crafts and delivers the first tools before equipping one',()=>{
 const G=fresh(),b=building(G,'blacksmith'),c=person(G);G.game.res.tools=0;G.game.res.steelTools=0;G.game.res.iron=3;G.game.res.wood=10;enable(G);G.assignWorker(b,c);
 until(G,()=>c.carry?.type==='tools',100);assert.equal(c.carry.qty,2);assert(!G.toolEquipped(c));assert.equal(G.game.res.iron,2);assert.equal(G.game.res.wood,8);
 until(G,()=>G.toolEquipped(c),80);assert.equal(c.toolType,'tools');assert.equal(G.game.res.tools,1);near(c.toolHours,1920);assert.equal(G.game.res.iron,2);assert.equal(G.game.res.wood,8);
});

test('an unpaid tool trip yields to the real household-food need at the morning boundary',()=>{
 const G=fresh(),home=building(G,'house',24,15),b=building(G,'stonequarry',20),c=person(G,19,10),f={id:G.nextId(),members:[c.id],houseId:home.id,coupleIds:[]};c.familyId=f.id;home.family=f.id;G.world.families.push(f);
 G.enablePhysicalSupplyPrototype();home.supplyStock.grain=20;home.supplyStock.firewood=10;enable(G);G.game.h=21.9;G.assignWorker(b,c);assert.equal(c.task.kind,'toolFetch');for(let i=0;i<10;i++)G.advanceSim(.1);assert.equal(c.pausedTask?.kind,'toolFetch');
 home.supplyStock.grain=0;until(G,()=>c.task?.kind==='supply',20);assert.equal(c.job,b.id);assert(!G.toolEquipped(c));assert.equal(G.game.res.tools,15);
});

test('old fuel batches keep one consistent rule when opting in before or after raw-material pickup',()=>{
 const results=[];
 for(const when of ['fetch','process','new']){const G=fresh(),b=building(G,'woodcutter'),c=person(G);G.game.res.tools=0;G.game.res.steelTools=0;G.game.res.wood=20;G.game.res.firewood=0;
  if(when==='new')enable(G);G.assignWorker(b,c);if(when==='fetch')enable(G);if(when==='process'){until(G,()=>!!c.carry?.fuelInput);enable(G);}
  let workH=0;for(let i=0;i<1000&&!c.carry?.firewoodId;i++){if(c.state==='work'&&c.task?.kind==='fuel'&&c.task.phase==='process'&&G.fuelAtTask(c,c.task))workH+=.1;G.advanceSim(.1);}
  assert(c.carry?.firewoodId);assert.equal(G.game.res.wood,18);assert.equal(c.carry.qty,when==='new'?6:3);assert(Math.abs(workH-(when==='new'?7:3.5))<.100001,'one simulation-tick tolerance');results.push({when,workH:Number(workH.toFixed(1)),firewood:c.carry.qty});
 }
 console.log('Actual fuel migration comparison '+JSON.stringify(results));
});

console.log(`Personal tools: ${passed} passed`);
