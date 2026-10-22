/* Controlled heating-rule/save/ownership tests. Real-life multi-season labor
 * evidence lives separately in winter-heating-seasons.js. */
'use strict';
const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
const {loadGame}=require('./helpers/playability');
const ROOT=path.resolve(__dirname,'..'),OLD=process.env.BANISH_HEAT_BASELINE_ROOT?path.resolve(process.env.BANISH_HEAT_BASELINE_ROOT):null;
const copy=x=>JSON.parse(JSON.stringify(x)),near=(a,b)=>assert(Math.abs(a-b)<1e-7,`${a} != ${b}`);let passed=0;
const save=G=>copy(G.serializeGame());
function test(name,fn){fn();passed++;console.log('ok '+name);}
function fresh(type='fair',seed=1,root=ROOT){
 const G=loadGame(root);assert(G.newGame(seed,{climate:type}).ok);const w=G.world;
 for(const k of ['water','rock','road','mountain'])w[k].fill(0);w.bgrid.fill(-1);w.treeIdx.fill(-1);w.trees=[];w.buildings=[];w.bmap={};w.citizens=[];w.cmap={};w.families=[];w.marked.clear();w.markedRocks.clear();w.rockCleared=[];G.bumpNavigation(w);
 G.game.h=12;G.rng=()=>.5;G.addBuilding('storage',2,2,{instant:true,free:true});Object.assign(G.game.res,{wood:500,stone:500,iron:500,grain:1000,food:1000,tools:300,firewood:200,coal:100});
 G.game.townLedger=G.newTownLedger(G.game);G.game.industryLedger=G.newIndustryLedger(G.game);return G;
}
function home(G,type='house',x=10,y=10){const b=G.addBuilding(type,x,y,{instant:true,free:true}).b;assert(b);const c=G.spawnCitizen({x:x-1,y,age:30,sex:'m'}),f={id:G.nextId(),members:[c.id],houseId:b.id,coupleIds:[]};G.world.families.push(f);c.familyId=f.id;if(type!=='boarding')b.family=f.id;return {b,c,f};}
// Controlled calendar setup explicitly runs both daily rules; it is not a
// survival simulation or a direct rewrite of their last-settled markers.
function day(G,d){G.game.day=d;G.game.season=G.seasonOf(d);G.game.year=Math.floor(d/48)+1;G.game.h=12;G.game.townLedger=G.newTownLedger(G.game);G.game.industryLedger=G.newIndustryLedger(G.game);G.advanceDeer();G.advanceCropClimate();if(G.advanceHomeHeating)G.advanceHomeHeating();if(G.advanceOrchardClimate)G.advanceOrchardClimate();}
function winter(G){day(G,35);G.game.h=23.9;G.advanceSim(.2);assert.equal(G.game.day,36);}
function stable(G){const before=save(G),w=G.world,g=G.game,rng=G.rng,uid=G._peekUid();return bad=>{assert.throws(()=>G.applySaveData(bad));assert.equal(G.world,w);assert.equal(G.game,g);assert.equal(G.rng,rng);assert.equal(G._peekUid(),uid);assert.deepEqual(save(G),before);};}
function inventories(G){const out={wood:G.game.res.firewood,coal:G.game.res.coal};for(const b of G.world.buildings){out.wood+=b.supplyStock?.firewood||0;out.coal+=b.supplyStock?.coal||0;}return out;}

test('genuine new villages use v8 and independent heat-v1; crop/weather version stays v1',()=>{
 const G=loadGame(ROOT);assert(G.newGame(0).ok);assert.equal(G.game.climate.type,'fair');assert.deepEqual(copy(G.game.heatRules),{v:1,lastDay:0});assert.equal(save(G).v,8);assert.equal(G.game.climate.v,1);G.applySaveData(save(G));assert.equal(save(G).v,8);
 for(const type of ['mild','fair','harsh']){assert(G.newGame(17,{climate:type}).ok);assert.equal(save(G).v,8);assert.equal(G.game.heatRules.v,1);}
});

test('synthetic v6 and v7 empty-village saves preserve their orchard rule boundaries',()=>{
 for(const version of [6,7]){
  const G=loadGame(ROOT);assert(G.newGame(17,{climate:'fair'}).ok);
  const legacy=save(G);legacy.v=version;delete legacy.game.orchardHarvestRules;
  if(version===6)delete legacy.game.orchardRules;
  G.applySaveData(legacy);assert.equal(save(G).v,version);
  assert.equal(G.game.orchardHarvestRules,null);assert.equal(!!G.game.orchardRules,version===7);
  const canonical=save(G);G.applySaveData(canonical);assert.deepEqual(save(G),canonical);
  const forged=copy(canonical);forged.game.orchardHarvestRules={v:1};stable(G)(forged);
 }
});

test('deterministic frozen rule, ordered climate demand, winter-only and Fair baseline calibration',()=>{
 const G=fresh();let calls=0;G.rng=()=>{calls++;return .3;};const sums={mild:[],fair:[],harsh:[]};
 for(let seed=0;seed<64;seed++)for(let year=0;year<5;year++){
  const total={mild:0,fair:0,harsh:0};for(let d=year*48;d<(year+1)*48;d++){
   const values=['mild','fair','harsh'].map(type=>G.heatingNeedFor('house',d,seed,{v:1,type},{v:1}));
   assert(values[0]<=values[1]&&values[1]<=values[2]);for(const [i,type]of ['mild','fair','harsh'].entries()){assert.equal(values[i],G.heatingNeedFor('house',d,seed,{v:1,type},{v:1}));total[type]+=values[i];if(d%48<36)assert.equal(values[i],0);else assert(values[i]>=1.25&&values[i]<=3.75);}
  }for(const type in sums)sums[type].push(total[type]);
 }
 const means=Object.fromEntries(Object.entries(sums).map(([k,v])=>[k,v.reduce((a,b)=>a+b)/v.length]));assert(means.fair>29.5&&means.fair<30.5);assert(means.mild<means.fair&&means.fair<means.harsh);assert.equal(calls,0);
 for(const d of [36,37,80,100000000036]){const h=G.heatingNeedFor('house',d,-2147483648,{v:1,type:'fair'},{v:1});near(G.heatingNeedFor('stonehouse',d,-2147483648,{v:1,type:'fair'},{v:1}),h*2/3);near(G.heatingNeedFor('boarding',d,-2147483648,{v:1,type:'fair'},{v:1}),h*2.5);}
 assert.throws(()=>G.heatingNeedFor('house',36,1,{v:1,type:'fair'},{v:2}));assert.throws(()=>G.heatingNeedFor('house',36,1,{v:2,type:'fair'},{v:1}));
 console.log('calibration '+JSON.stringify(means));
});

test('frozen heat-v1 bills do not depend on later mutable building balances',()=>{
 const G=fresh(),h=home(G,'stonehouse');winter(G);const d=save(G),need=h.b.lastHeating.need;G.BDEF.stonehouse.warmWoodPerYear=999;near(G.homeHeatingNeed(h.b),need);G.applySaveData(d);near(G.world.bmap[h.b.id].lastHeating.need,need);
});

test('all three building types burn exact daily fuel through each ownership path and coal policy',()=>{
 for(const physical of [false,true])for(const allow of [false,true])for(const type of ['house','stonehouse','boarding'])for(const sufficient of [false,true]){
  const G=fresh('harsh',17),{b}=home(G,type);G.setHeatingPolicy(allow,20);const need=G.homeHeatingNeed(b,36),wood=sufficient&&!allow?need:need/4,coal=sufficient?need:need/8;
  G.game.res.firewood=wood;G.game.res.coal=20+coal;
  if(physical){G.enablePhysicalSupplyPrototype();b.supplyStock.firewood=G.withdrawResource('firewood',wood);b.supplyStock.coal=G.withdrawResource('coal',coal);G.game.res.firewood=100;}
  const before=inventories(G),publicBefore=copy(G.game.res);winter(G);const bill=b.lastHeating;near(bill.need,need);near(bill.wood,wood);near(bill.coal,allow?Math.min(coal,(need-wood)/2):0);assert.equal(b.unheated,bill.wood+bill.coal*2+1e-8<need);
  const after=inventories(G);near(before.wood-after.wood,bill.wood);near(before.coal-after.coal,bill.coal);
  if(physical){near(G.game.res.firewood,publicBefore.firewood);near(G.game.res.coal,publicBefore.coal);near(G.game.supplyUsed.firewood,bill.wood);near(G.game.supplyUsed.coal,bill.coal);near(G.townLedgerSummary().current.totals.firewood.distributedUsed,bill.wood);}
  else{assert(G.game.res.coal>=20);near(G.townLedgerSummary().current.totals.firewood.used,bill.wood);}
  const unchanged=save(G);G.advanceHomeHeating();G.heatHome(b,need);if(physical)G.heatSuppliedHome(b,need);assert.deepEqual(save(G),unchanged);
 }
});

test('empty, building, burning homes are not charged; boarding families share one building bill',()=>{
 const G=fresh(),{b}=home(G,'boarding'),empty=G.addBuilding('house',20,10,{instant:true,free:true}).b,site=G.addBuilding('house',25,10).b,burning=home(G,'house',30,10).b;
 burning.houseFire={incident:1};const c=G.spawnCitizen({x:9,y:11,age:40,sex:'f'}),f={id:G.nextId(),members:[c.id],houseId:b.id,coupleIds:[]};c.familyId=f.id;G.world.families.push(f);G.world.families[0].houseId=b.id;empty.family=null;day(G,35);const stock=G.game.res.firewood;G.game.day=36;G.game.season=3;G.advanceHomeHeating();near(stock-G.game.res.firewood,G.homeHeatingNeed(b));assert(b.lastHeating);for(const h of [empty,site,burning])assert(!h.lastHeating);
});

test('shared public coal competition never spends protected reserve twice',()=>{
 const G=fresh(),a=home(G),b=home(G,'house',15,10);G.setHeatingPolicy(true,20);G.game.res.firewood=0;const need=G.homeHeatingNeed(a.b,36);G.game.res.coal=20+need/2+.1;winter(G);assert(!a.b.unheated&&b.b.unheated);near(a.b.lastHeating.coal,need/2);near(b.b.lastHeating.coal,.1);near(G.game.res.coal,20);
});

test('colder short-funded home retains cold-room behavior and partial burns, without changing spring/autumn exposure',()=>{
 for(const type of ['mild','harsh']){const G=fresh(type,1),{b,c}=home(G);G.game.res.firewood=G.heatingNeedFor('house',36,1,{v:1,type:'mild'},{v:1});winter(G);c.state='rest';c.camped=false;c.cold=1;G.coldStep(c,1);assert(type==='mild'?c.cold<1:c.cold>1);assert.equal(b.unheated,type==='harsh');if(type==='harsh')assert(b.lastHeating.wood>0&&b.lastHeating.wood<b.lastHeating.need);
  for(const day of [28,48]){G.game.day=day;G.game.season=G.seasonOf(day);c.cold=1;const before=G.game.res.firewood;G.advanceHomeHeating();G.coldStep(c,1);assert(c.cold<=1);assert.equal(G.game.res.firewood,before);}
 }
});

test('actual winter day sequence equals full budget; current paid day excluded and spring stops bills',()=>{
 for(const type of ['mild','fair','harsh']){const G=fresh(type,7),{b}=home(G);day(G,35);const total=G.homeHeatingWinterBudget(b),stock=G.game.res.firewood;let bills=0;
  for(let d=36;d<48;d++){G.endDay();const current=G.world.bmap[b.id];bills+=current.lastHeating.wood;near(current.lastHeating.need,G.homeHeatingNeed(current,d));const q=G.townHeatingBudget();near(q.futureWinter,G.homeHeatingTotal(b,d+1,47-d));assert.equal(q.futureDays,47-d);if(d===41)G.applySaveData(save(G));}
  near(stock-G.game.res.firewood,total);near(bills,total);const before=G.game.res.firewood;G.endDay();near(G.game.res.firewood,before);assert(!G.world.bmap[b.id].unheated);assert.equal(G.game.heatRules.lastDay,48);
 }
});

test('four-day targets, two-day threshold, autumn staging and initial physical allocation share exact windows',()=>{
 for(const type of ['mild','fair','harsh']){const G=fresh(type,7),{b}=home(G);day(G,25);const start=36,target=G.homeHeatingTotal(b,start,4),threshold=G.homeHeatingTotal(b,start,2);near(G.homeSupplyHeat(b,4),target);near(G.supplyNeeds(b).firewood,target);
  const q=G.supplyModeQuote();near(q.rows[0].fuelNeed,threshold);const before=inventories(G);assert(G.enableHouseholdSupply(q.key));near(inventories(G).wood,before.wood);near(b.supplyStock.firewood,threshold);assert(!G.enableHouseholdSupply(q.key));
  b.supplyStock.grain=100;b.supplyStock.firewood=threshold;assert(!G.supplyRestockWanted(b));b.supplyStock.firewood-=.001;assert(G.supplyRestockWanted(b));
  near(G.homeFuelDays(b,threshold),2);near(G.homeFuelDays(b,G.homeHeatingNeed(b,36)/2),.5);winter(G);near(G.homeSupplyHeat(b,4),G.homeHeatingTotal(b,37,4));day(G,46);near(G.homeSupplyHeat(b,4),G.homeHeatingNeed(b,47));day(G,47);near(G.homeSupplyHeat(b,4),0);near(G.homeFuelDays(b,100),0);
 }
});

test('season autosave remains pre-burn, load never catches up, next midnight burns only its day',()=>{
 const G=fresh('harsh',7),{b}=home(G);day(G,35);let auto;G.autosave=()=>{auto=save(G);};G.game.h=23.9;const before=G.game.res.firewood;G.advanceSim(.2);
 assert(auto);assert.equal(auto.game.day,36);assert.equal(auto.game.climate.lastDay,36);assert.equal(auto.game.heatRules.lastDay,35);assert.equal(auto.game.res.firewood,before);assert(!auto.buildings.find(h=>h.id===b.id).lastHeating);near(G.game.res.firewood,before-G.homeHeatingNeed(b,36));assert.equal(G.game.heatRules.lastDay,36);
 G.applySaveData(auto);const snapshot=save(G);for(let i=0;i<3;i++){G.applySaveData(snapshot);assert.deepEqual(save(G),snapshot);}G.advanceSim(.1);assert.equal(G.game.res.firewood,before);assert(!G.world.bmap[b.id].lastHeating);G.endDay();near(G.game.res.firewood,before-G.homeHeatingNeed(G.world.bmap[b.id],37));assert.equal(G.world.bmap[b.id].lastHeating.day,37);
 day(G,47);G.game.h=23.9;G.advanceSim(.2);assert.equal(auto.game.day,48);assert.equal(auto.game.heatRules.lastDay,47);G.applySaveData(auto);assert.equal(G.game.heatRules.lastDay,47);assert.equal(G.game.res.firewood,auto.game.res.firewood);
});

test('pause, summaries, serialize and reload are read-only and cannot change weather, fuel, RNG or bill',()=>{
 const G=fresh('fair',17),created=home(G);winter(G);G.applySaveData(save(G));const b=G.world.bmap[created.b.id];G.game.paused=true;let count=0;G.rng=()=>{count++;return .5;};const before=save(G);for(let i=0;i<10;i++){G.advanceSim(48);G.homeHeatingSummary(b);G.townHeatingBudget();G.supplyNeeds(b);G.householdSupplySummary(b);G.homeHeatingWinterBudget(b);save(G);}assert.equal(count,0);assert.deepEqual(save(G),before);G.applySaveData(before);assert.deepEqual(save(G),before);
});

test('historical bills validate against their recorded day and candidate seed, never the live world/current weather',()=>{
 const G=fresh('harsh',17),{b}=home(G);winter(G);const d=save(G),original=copy(d.buildings.find(x=>x.id===b.id).lastHeating);assert(G.newGame(9,{climate:'mild'}).ok);G.applySaveData(d);assert.deepEqual(copy(G.world.bmap[b.id].lastHeating),original);
 // Preserve a legitimate prior-year bill when the home is no longer occupied.
 const h=G.world.bmap[b.id];h.family=null;G.world.families[0].houseId=null;day(G,84);const later=save(G);assert.notEqual(original.need,G.homeHeatingNeed(h,84));G.applySaveData(later);assert.deepEqual(copy(G.world.bmap[b.id].lastHeating),original);
 const reject=stable(G),bad=copy(later);bad.buildings.find(x=>x.id===b.id).lastHeating.need=G.homeHeatingNeed(h,84);reject(bad);
});

test('v8 missing/unknown/downgraded/contradictory rules and forged bills reject atomically',()=>{
 const G=fresh('fair',7),{b}=home(G);winter(G);const good=save(G),reject=stable(G),bill=d=>d.buildings.find(x=>x.id===b.id).lastHeating;
 const edits=[d=>delete d.game.heatRules,d=>d.game.heatRules=null,d=>d.game.heatRules.v=2,d=>d.game.heatRules.extra=true,d=>delete d.game.heatRules.lastDay,d=>d.game.heatRules.lastDay=34,d=>d.game.heatRules.lastDay=37,d=>d.v=5,d=>d.v=4,d=>d.game.heatRules.lastDay=35,d=>bill(d).need+=.01,d=>bill(d).day=35,d=>bill(d).wood=-1,d=>bill(d).coal=Infinity,d=>bill(d).coal=bill(d).need,d=>d.buildings.find(x=>x.id===b.id).unheated=true,d=>{d.seed=99;d.game.startConfig.seed=99;}];
 for(const edit of edits){const bad=copy(good);edit(bad);reject(bad);}G.endDay();const normal=save(G),bad=copy(normal);bad.game.heatRules.lastDay=36;stable(G)(bad);
});

if(OLD)test('actual pre-heating v5 villages stay fixed in both supply modes, and old engine rejects new v8',()=>{
 assert(fs.existsSync(path.join(OLD,'js/main.js')),'actual pre-heating engine is required');
 for(const physical of [false,true]){const old=fresh('harsh',7,OLD),{b}=home(old,'stonehouse');if(physical){old.enablePhysicalSupplyPrototype();b.supplyStock.firewood=50;b.supplyStock.grain=100;}day(old,35);old.game.h=23.9;old.advanceSim(.2);const legacy=save(old);assert.equal(legacy.v,5);assert(!legacy.game.heatRules);near(legacy.buildings.find(x=>x.id===b.id).lastHeating.need,20/12);
  const G=loadGame(ROOT);G.applySaveData(legacy);assert(!G.game.heatRules);assert.equal(save(G).v,5);const before=save(G);G.applySaveData(before);assert.deepEqual(save(G),before);G.endDay();near(G.world.bmap[b.id].lastHeating.need,20/12);
  // Genuine pre-balance receipt remains legal only in an old fixed-heat village.
  const stone=save(G);stone.buildings.find(x=>x.id===b.id).lastHeating={day:37,need:15/12,wood:15/12,coal:0};stone.buildings.find(x=>x.id===b.id).unheated=false;G.applySaveData(stone);near(G.world.bmap[b.id].lastHeating.need,15/12);G.endDay();near(G.world.bmap[b.id].lastHeating.need,20/12);
 }
 const newer=fresh(),legacy=loadGame(OLD);assert.throws(()=>legacy.prepareSaveData(save(newer)),/版本不受支持/);
});
else console.log('SKIP actual v5 engine compatibility: set BANISH_HEAT_BASELINE_ROOT to a pre-heating checkout');
console.log(`Winter heating: ${passed} passed`);
