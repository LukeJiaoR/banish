/* Versioned climate adaptation: deterministic weather, field work and save boundaries. */
'use strict';
const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
const {loadGame}=require('./helpers/playability');
const ROOT=path.resolve(__dirname,'..'),copy=x=>JSON.parse(JSON.stringify(x));let passed=0;
function fresh(type='fair',seed=1,options={},root=ROOT){
  const G=loadGame(root);assert(G.newGame(seed,{climate:type,...options}).ok);
  // Crop-specific boundary fixtures retain v5 climate with fixed legacy heating.
  G.game.heatRules=null;G.game.orchardRules=null;G.game.orchardHarvestRules=null;
   // Explicit synthetic v5 scope, not a historical-engine migration test.
  const w=G.world;
  // Controlled crop-only fixture removes new river metadata before flattening.
  if(w.waterNavigation){delete w.tradeVoyages;delete w.waterNavigation;w.mapVersion=3;}
  for(const k of ['water','rock','road','mountain'])w[k].fill(0);w.bgrid.fill(-1);w.treeIdx.fill(-1);w.trees=[];w.buildings=[];w.bmap={};w.citizens=[];w.cmap={};w.families=[];w.marked.clear();w.markedRocks.clear();w.rockCleared=[];G.bumpNavigation(w);if(root===ROOT)assert.equal(G.serializeGame().v,5);
  G.game.h=12;G.rng=()=>.5;G.addBuilding('storage',2,2,{instant:true,free:true});Object.assign(G.game.res,{wood:500,stone:500,iron:500,grain:100,food:100,tools:300,firewood:200});
  const c=G.spawnCitizen({x:8,y:10,age:30,sex:'m'}),h=G.addBuilding('house',4,10,{instant:true,free:true}).b,f={id:G.nextId(),members:[c.id],coupleIds:[],houseId:h.id};c.familyId=f.id;h.family=f.id;w.families=[f];
  G.game.townLedger=G.newTownLedger(G.game);G.game.industryLedger=G.newIndustryLedger(G.game);
  return {G,c};
}
function field(G,crop='wheat',x=10,y=10){const r=G.addBuilding('farm',x,y,{farmSize:[4,4],instant:true,free:true});assert(r.ok,r.reason);const b=r.b;G.game.unlocks[crop]=true;G.setWorkerLimit(b,0);for(const c of G.world.citizens)if(c.job===b.id)G.releaseWorker(c);G.resetFarm(b);assert(G.setFarmCrop(b,crop));return b;}
function planted(b,growth=.6,tiles=b.farm.length){b.farm.forEach((f,i)=>{f.sown=i<tiles;});b.sownAll=tiles===b.farm.length;b.sowingCommitted=true;b.growth=b.sownAll?growth:0;}
function setDay(G,d){G.game.day=d;G.game.season=G.seasonOf(d);G.game.year=Math.floor(d/G.YEAR_DAYS)+1;if(G.game.climate)G.game.climate.lastDay=d;G.game.townLedger=G.newTownLedger(G.game);G.game.industryLedger=G.newIndustryLedger(G.game);G.advanceDeer();}
const saved=G=>copy(G.serializeGame());
function restored(G,d){
 const relevant=save=>({climate:save.game.climate,res:save.game.res,ledger:save.game.townLedger,industry:save.game.industryLedger,fields:save.buildings.filter(b=>b.type==='farm').map(b=>({id:b.id,farm:b.farm,growth:b.growth,sownAll:b.sownAll,harvestDone:b.harvestDone,sowingCommitted:b.sowingCommitted,cropType:b.cropType,cropChoice:b.cropChoice,earlyHarvestYield:b.earlyHarvestYield})),cargo:save.citizens.map(c=>c.carry)});
 assert.deepEqual(relevant(saved(G)),relevant(d));const canonical=saved(G);G.applySaveData(canonical);assert.deepEqual(saved(G),canonical);
}
function test(name,fn){fn();passed++;console.log('ok '+name);}
function stocks(G){return JSON.stringify({res:G.game.res,ledger:G.game.townLedger,industry:G.game.industryLedger,carry:G.world.citizens.map(c=>c.carry)});}
function coldDay(G,crop='wheat'){const line=G.CROP_TEMPERATURES[crop].frostBelow;for(let d=25;d<36;d++)if(G.temperatureFor(G.world.seed,d,G.game.climate.type)<line)return d;throw Error('fixture needs autumn frost');}
function step(G,c,done,max=10000){for(let i=0;i<max&&!done();i++)G.stepCitizen(c,.1);assert(done(),'real worker flow did not complete');}

test('new game defaults Fair; all climates validate, quote and seed repeat without consuming live RNG',()=>{
 const {G}=fresh();assert(G.newGame(0).ok);assert.equal(G.game.climate.type,'fair');assert.equal(G.game.startConfig.climate,'fair');assert.equal(saved(G).v,10);assert.deepEqual({...G.game.heatRules},{v:1,lastDay:0});
 for(const type of Object.keys(G.CLIMATES)){const q=G.startConfigQuote({seed:0,climate:type});assert(q.ok);assert(q.key.includes(type));assert.equal(q.config.climate,type);assert(q.climateSummary.name.includes(type[0].toUpperCase()+type.slice(1)));}
 let calls=0;G.rng=()=>{calls++;return .2;};for(let d=0;d<1000;d++)for(const type of Object.keys(G.CLIMATES))assert.equal(G.temperatureFor(0,d,type),G.temperatureFor(0,d,type));assert.equal(calls,0);
 for(const climate of [null,'legacy','Fair','toString',1,{}])assert(!G.startConfigQuote({seed:1,climate}).ok);
 const before=saved(G);for(const climate of [null,'bad'])assert(!G.newGame(1,{climate}).ok);assert.deepEqual(saved(G),before);
 assert.throws(()=>G.temperatureFor(0,0,'fair',2));assert.throws(()=>G.temperatureFor(0,-1,'fair'));
});

test('pause, repeated reads and saves never reroll weather, apply frost or advance the day',()=>{
 const {G}=fresh('harsh'),b=field(G);planted(b);setDay(G,coldDay(G));G.game.paused=true;
 const before=saved(G),weather=copy(G.climateWeather());for(let i=0;i<5;i++){G.advanceSim(48);G.climateWeather();G.farmClimateSummary(b);saved(G);}assert.deepEqual(saved(G),before);assert.deepEqual(copy(G.climateWeather()),weather);
 G.applySaveData(before);assert.deepEqual(copy(G.climateWeather()),weather);assert.equal(G.world.bmap[b.id].farm.filter(f=>f.frostLost).length,0);restored(G,before);
});

test('same seed/day/version is stable across climate reload and ordering; different years and seeds vary',()=>{
 const {G}=fresh();const sequence=(seed,type)=>Array.from({length:144},(_,d)=>G.temperatureFor(seed,d,type));
 for(const seed of [0,1,17,-2147483648,4294967295])for(const type of Object.keys(G.CLIMATES)){const first=sequence(seed,type);for(let d=143;d>=0;d--)assert.equal(G.temperatureFor(seed,d,type),first[d]);assert.notDeepEqual(first.slice(0,48),first.slice(48,96));}
 assert.notDeepEqual(sequence(1,'fair'),sequence(2,'fair'));for(let d=0;d<144;d++){assert(G.temperatureFor(1,d,'mild')>=G.temperatureFor(1,d,'fair'));assert(G.temperatureFor(1,d,'fair')>=G.temperatureFor(1,d,'harsh'));}
});

test('frost only marks potential tiles once, preserves crop commitment and next-year choice, and leaves all ledgers/cargo unchanged',()=>{
 const {G,c}=fresh('harsh'),b=field(G);planted(b);const day=coldDay(G);setDay(G,day);G.game.climate.lastDay=day-1;
 G.game.unlocks.beans=true;assert(G.setFarmCrop(b,'beans'));c.carry={type:'grain',qty:14};const before=stocks(G);
 G.advanceCropClimate();const lost=b.farm.filter(f=>f.frostLost).length;assert(lost>0&&lost<16);assert.equal(stocks(G),before);assert.equal(b.cropType,'wheat');assert.equal(b.cropChoice,'beans');assert(b.sowingCommitted);assert(b.sownAll);
 const after=JSON.stringify(b);G.advanceCropClimate();assert.equal(JSON.stringify(b),after);assert.equal(stocks(G),before);assert.equal(G.farmSummary(b).harvested,0);
});

test('partial sowing loses only planted tiles, never reopens damaged cells or unlocks crop changes',()=>{
 const {G,c}=fresh('harsh'),b=field(G);planted(b,0,2);setDay(G,1);G.game.climate.lastDay--;
 const pending={kind:'sow',b,ti:2,crop:'wheat',cropYear:G.game.year};c.task=pending;c.state='work';
 G.advanceCropClimate();assert(b.farm[0].frostLost&&b.farm[1].frostLost);assert(b.sowingCommitted);assert(!b.sownAll);assert(!b.harvestDone);assert.equal(c.task,pending);assert(G.farmTaskCurrent(pending));
 G.game.unlocks.squash=true;G.setFarmCrop(b,'squash');assert.equal(b.cropType,'wheat');assert.equal(b.cropChoice,'squash');const d=saved(G);G.applySaveData(d);restored(G,d);
});

test('active and paused harvest on frost-lost cells expire, unaffected real carried harvest survives round-trip and delivery',()=>{
 const {G,c}=fresh('harsh'),b=field(G);planted(b,1);setDay(G,26);c.job=b.id;b.workers=[c.id];G.setWorkerLimit(b,1);
 c.task={kind:'harvest',b,ti:0,crop:'wheat',cropYear:1};G.completeTask(c);assert.equal(c.carry.qty,14);assert(b.farm[0].harvested);assert(!b.farm[0].frostLost);
 c.task={kind:'harvest',b,ti:1,crop:'wheat',cropYear:1};c.pausedTask={kind:'harvest',b,ti:2,crop:'wheat',cropYear:1};c.state='work';
 const before=stocks(G);G.damageFrostTiles(b,b.farm.filter(f=>f.sown&&!f.harvested));assert.equal(stocks(G),before);assert.equal(c.task,null);assert.equal(c.pausedTask,null);assert(b.harvestDone);assert.equal(G.farmSummary(b).harvested,1);
 const d=saved(G);G.applySaveData(d);const cc=G.world.cmap[c.id],bb=G.world.bmap[b.id];assert.equal(cc.carry.qty,14);assert.equal(bb.farm.filter(f=>f.frostLost).length,15);
 const stock=G.game.res.grain;G.startHaul(cc);step(G,cc,()=>!cc.carry);assert.equal(G.game.res.grain,stock+14);const l=G.townLedgerSummary().current.totals.grain;assert.equal(l.produced,14);assert.equal(l.received,14);assert.equal(l.discarded,0);assert(!G.farmHasWork(bb));
});


test('frost leaves real harvested food intact until ordinary full-warehouse or death accounting runs once',()=>{
 for(const mode of ['full','death']){
  const {G,c}=fresh('harsh'),b=field(G);planted(b,1);setDay(G,26);c.job=b.id;b.workers=[c.id];G.setWorkerLimit(b,1);c.task={kind:'harvest',b,ti:0,crop:'wheat',cropYear:1};G.completeTask(c);assert.equal(c.carry.qty,14);
  const before=stocks(G);G.damageFrostTiles(b,b.farm.filter(f=>f.sown&&!f.harvested));assert.equal(stocks(G),before);assert.equal(c.carry.qty,14);
  if(mode==='full'){G.game.res.grain=G.game.res.food=G.storageCap('grain');G.startHaul(c);step(G,c,()=>!c.carry);}
  else {G.killCitizen(c,'老去');G.killCitizen(c,'老去');}
  const totals=G.townLedgerSummary().current.totals.grain;assert.equal(totals.produced,14);assert.equal(totals.discarded,14);assert.equal(totals.received,0);assert.equal(c.carry,null);assert.equal(b.farm.filter(f=>f.frostLost).length,15);
 }
});

test('frost invalidates an old early-harvest quote, and confirmed early harvest still loses unpicked cells',()=>{
 const {G}=fresh('harsh'),b=field(G);planted(b,.7);setDay(G,26);const q=G.earlyHarvestQuote(b);assert(q.ok);
 G.damageFrostTiles(b,[b.farm[0]]);assert(!G.beginEarlyHarvest(b,q.key).ok);assert(!b.earlyHarvestYield);
 const next=G.earlyHarvestQuote(b);assert(next.ok);assert(G.beginEarlyHarvest(b,next.key).ok);const yieldBefore=b.earlyHarvestYield,growth=b.growth;
 const day=coldDay(G);setDay(G,day);G.game.climate.lastDay--;G.advanceCropClimate();assert(b.farm.filter(f=>f.frostLost).length>1);assert.equal(b.earlyHarvestYield,yieldBefore);assert.equal(b.growth,growth);
 const d=saved(G);G.applySaveData(d);restored(G,d);
});

test('frost and pests have disjoint losses and neither creates produced or discarded stock',()=>{
 const {G}=fresh('harsh'),b=field(G);planted(b);G.game.farmPests.enabled=true;b.farm[0].harvested=true;b.farm[0].pestLost=true;
 const before=stocks(G);setDay(G,coldDay(G));const afterJump=stocks(G);G.game.climate.lastDay--;G.advanceCropClimate();assert.equal(stocks(G),afterJump);assert(b.farm[0].pestLost&&!b.farm[0].frostLost);assert(b.farm.some(f=>f.frostLost));assert.equal(G.farmSummary(b).harvested,0);
 const d=saved(G);G.applySaveData(d);restored(G,d);
});

test('growth uses temperature factors while winter and early-harvest locks stop growth; squash resists temperatures that hurt wheat and beans',()=>{
 const {G}=fresh('harsh'),w=field(G),s=field(G,'squash',16),beans=field(G,'beans',22);for(const b of [w,s,beans])planted(b,.4);
 assert.equal(G.farmTemperatureFactor(w,0),0);assert.equal(G.farmTemperatureFactor(w,5.5),.5);assert.equal(G.farmTemperatureFactor(w,30),1);
 const day=Array.from({length:11},(_,i)=>25+i).find(d=>{const t=G.temperatureFor(G.world.seed,d,'harsh');return t<0&&t>=-5;});assert(day!==undefined);setDay(G,day);G.game.climate.lastDay--;
 const temperature=G.climateWeather().temperature;G.advanceCropClimate();assert(w.farm.some(f=>f.frostLost));assert(beans.farm.some(f=>f.frostLost));assert(!s.farm.some(f=>f.frostLost));assert(Math.abs(s.growth-(.4+G.farmTemperatureFactor(s,temperature)/24))<1e-9);
 setDay(G,36);G.game.climate.lastDay--;const growth=s.growth;G.advanceCropClimate();assert.equal(s.growth,growth);
});

test('season autosave has climate already settled; loading and reapplying never double-grows or double-frosts',()=>{
 for(const boundary of [12,24,36,48]){const {G}=fresh('harsh'),b=field(G,'squash');planted(b,.6);setDay(G,boundary-1);let captured;
 G.autosave=()=>{captured=saved(G);};G.endDay();assert(captured);assert.equal(captured.game.climate.lastDay,boundary);const candidate=G.prepareSaveData(captured);G.world=candidate.world;G.game=candidate.game;
 const before=JSON.stringify(G.world.bmap[b.id]);G.advanceCropClimate();G.expireWinterFarms();assert.equal(JSON.stringify(G.world.bmap[b.id]),before);if(boundary===48){assert(!G.world.bmap[b.id].farm.some(f=>f.frostLost));assert(!G.world.bmap[b.id].sowingCommitted);}}
});

test('winter cutoff preserves frost history and committed season, never repeats notifications on partial fields',()=>{
 const {G}=fresh('mild'),w=field(G),s=field(G,'squash',16);planted(w,0,3);planted(s,.6);setDay(G,35);let count=0;G.ui.toast=()=>count++;G.endDay();assert(w.farm.slice(0,3).every(f=>f.frostLost));assert(w.sowingCommitted);assert(s.farm.some(f=>!f.harvested));const after=count;G.expireWinterFarms();assert.equal(count,after);
 G.endDay();G.endDay();assert(s.farm.every(f=>f.frostLost));assert(s.harvestDone);assert(s.sowingCommitted);assert(!G.earlyHarvestQuote(s).ok);const d=saved(G);G.applySaveData(d);restored(G,d);
});


test('winter cutoff cancels pending first/partial sow tasks without opening a new season or losing carried food',()=>{
 for(const plantedTiles of [0,2]){const {G,c}=fresh('fair'),b=field(G);planted(b,0,plantedTiles);setDay(G,35);c.carry={type:'grain',qty:7};
 c.task={kind:'sow',b,ti:3,crop:'wheat',cropYear:1};c.pausedTask={kind:'sow',b,ti:4,crop:'wheat',cropYear:1};c.state='walk';c.walkKind='task';c.path=[{x:10,y:10}];
 setDay(G,36);const before=stocks(G);G.expireWinterFarms();assert.equal(c.task,null);assert.equal(c.pausedTask,null);assert.equal(c.path,null);assert.equal(c.state,'idle');assert.equal(stocks(G),before);assert(b.sowingCommitted);assert(!G.farmHasWork(b));
 const d=saved(G);G.applySaveData(d);restored(G,d);}
});

test('v5 climate state rejects missing, foreign, contradictory or downgraded markers atomically',()=>{
 const {G}=fresh('harsh'),b=field(G);planted(b);G.damageFrostTiles(b,[b.farm[0]]);const good=saved(G),world=G.world,game=G.game,rng=G.rng,uid=G._peekUid();
 const edits=[d=>delete d.game.climate,d=>d.game.climate=null,d=>d.game.climate.v=2,d=>d.game.climate.type='mild',d=>delete d.game.climate.lastDay,d=>d.game.climate.lastDay=-1,d=>d.game.climate.lastDay=1,d=>d.game.climate.extra=0,d=>d.v=4,d=>delete d.game.startConfig.climate,d=>d.game.startConfig.climate='toString',d=>d.mapVersion=1,d=>d.game.season=1,d=>d.game.year=2,d=>d.buildings.find(x=>x.id===b.id).sownAll='true',d=>d.buildings.find(x=>x.id===b.id).harvestDone=[],d=>d.buildings.find(x=>x.id===b.id).farm[0].pop(),d=>d.buildings.find(x=>x.id===b.id).farm[0][2]=1,d=>d.buildings.find(x=>x.id===b.id).farm[0][0]=0,d=>d.buildings.find(x=>x.id===b.id).sowingCommitted=false];
 for(const edit of edits){const d=copy(good);edit(d);assert.throws(()=>G.applySaveData(d));assert.equal(G.world,world);assert.equal(G.game,game);assert.equal(G.rng,rng);assert.equal(G._peekUid(),uid);assert.deepEqual(saved(G),good);}
});

test('historical mountain fixture and synthetic v2-v4 without climate stay legacy through loads and saves with no immediate crop/stock change',()=>{
 for(const fixture of ['mountain-v0.3.73.json']){const G=loadGame(ROOT),raw=JSON.parse(fs.readFileSync(path.join(ROOT,'tests/fixtures',fixture),'utf8')),d=raw.save||raw;const candidate=G.prepareSaveData(d);G.world=candidate.world;G.game=candidate.game;G.rng=candidate.rng;G.setUid(candidate.nextUid);assert.equal(G.game.climate,null);const before=saved(G);G.advanceCropClimate();assert.deepEqual(saved(G),before);assert.equal(G.climateWeather(),null);}
 for(const terrain of ['classic','mountain'])for(const mapSize of [128,192]){const G=loadGame(ROOT);assert(G.newGame(17,{terrain,mapSize,climate:'mild'}).ok);const d=saved(G);if(d.waterNavigation){delete d.tradeVoyages;delete d.waterNavigation;d.mapVersion=3;}delete d.game.climate;delete d.game.heatRules;delete d.game.orchardRules;delete d.game.orchardHarvestRules;delete d.game.startConfig.climate;d.v=d.mapVersion===3?4:d.N===192?3:2;G.applySaveData(d);assert.equal(G.game.climate,null);restored(G,d);}
});


test('all four crops use real sow/harvest/haul tasks under climate rules without synthetic production',()=>{
 for(const crop of Object.keys(loadGame(ROOT).CROPS)){
  const {G,c}=fresh('mild'),b=field(G,crop);setDay(G,4);G.setWorkerLimit(b,1);G.assignWorker(b,c);G.requestTask(c);step(G,c,()=>b.sownAll);assert(b.sowingCommitted);assert(b.farm.every(f=>f.sown));
  G.setWorkerLimit(b,0);G.releaseWorker(c);let days=0;while(!G.farmHarvestReady(b)&&days++<34)G.endDay();assert(G.farmHarvestReady(b));assert(b.growth>=1);assert(!b.farm.some(f=>f.frostLost));
  const stock=G.game.res[G.farmOutput(b)],food=G.game.res.food;G.setWorkerLimit(b,1);G.assignWorker(b,c);G.requestTask(c);step(G,c,()=>b.harvestDone&&!c.carry);
  assert.equal(G.game.res[G.farmOutput(b)],stock+16*G.farmBaseYield(b));assert.equal(G.game.res.food,food+16*G.farmBaseYield(b));
  const ledger=G.townLedgerSummary(),rows=[...G.game.townLedger.days,{...G.game.townLedger.current,closing:G.ledgerStock(G.game)}],total=G.ledgerTotals(rows)[G.farmOutput(b)];assert.equal(total.produced,16*G.farmBaseYield(b));assert.equal(total.received,total.produced);assert.equal(total.discarded,0);
 }
});

test('three climates and two seeds run real daily lifecycle for three years, save each season and never apply crop weather twice',()=>{
 for(const type of ['mild','fair','harsh'])for(const seed of [1,17]){
  const {G}=fresh(type,seed),b=field(G);G.game.res.grain=G.game.res.food=1000;G.game.townLedger=G.newTownLedger(G.game);G.game.industryLedger=G.newIndustryLedger(G.game);let losses=0;
  for(let d=1;d<=144;d++){const live=G.world.bmap[b.id];if(d%48===4)planted(live,0);G.endDay();assert.equal(G.game.climate.lastDay,G.game.day);assert(G.game.res.food>=0);assert(live.growth>=0&&live.growth<=1);if(d%48===47)losses+=live.farm.filter(f=>f.frostLost).length;
   if(d%12===0){const snapshot=saved(G),weather=copy(G.climateWeather());G.applySaveData(snapshot);const current=saved(G);G.advanceCropClimate();assert.deepEqual(saved(G),current);assert.deepEqual(copy(G.climateWeather()),weather);}
  }
  assert(losses>0);assert.equal(G.world.citizens.length,1);assert.equal(G.game.stats.died,0);assert.equal(G.game.day,144);
 }
});


if(process.env.BANISH_BASELINE_ROOT){
test('actual baseline seasonal crop saves retain their legacy calendar, field state, cargo and stocks',()=>{
 for(const day of [1,12,25,35,36,37]){
  const {G:old,c}=fresh('fair',1,{},path.resolve(process.env.BANISH_BASELINE_ROOT)),b=field(old,day>=36?'squash':'wheat');planted(b,.6);setDay(old,day);c.carry={type:'grain',qty:7};const d=saved(old);
  const G=loadGame(ROOT);G.applySaveData(d);assert.equal(G.game.climate,null);assert.equal(G.farmClimateSummary(G.world.bmap[b.id]),null);restored(G,d);const before=saved(G);G.advanceCropClimate();assert.deepEqual(saved(G),before);
 }
});

test('old engine rejects v5 instead of ignoring climate and replaying a different crop model',()=>{
 const {G}=fresh(),d=saved(G),old=loadGame(path.resolve(process.env.BANISH_BASELINE_ROOT));assert.throws(()=>old.prepareSaveData(d),/版本不受支持/);
});

}else console.log('SKIP two historical-engine checks: set BANISH_BASELINE_ROOT to a pre-climate checkout');

console.log('Crop climate: '+passed+' passed');
