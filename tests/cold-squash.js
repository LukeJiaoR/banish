/* Cold squash: bounded winter continuation, real crop/cargo work and safe old saves. */
'use strict';
const assert=require('node:assert/strict'),path=require('node:path');const {loadGame}=require('./helpers/playability');let passed=0;
function fresh(){const G=loadGame(path.resolve(__dirname,'..'));G.newGame(1);G.game.climate=null;G.game.heatRules=null;delete G.game.startConfig.climate; // Legacy calendar contract.
const w=G.world;for(const k of ['water','rock','road'])w[k].fill(0);w.bgrid.fill(-1);w.treeIdx.fill(-1);w.trees=[];w.buildings=[];w.bmap={};w.citizens=[];w.cmap={};w.families=[];w.marked.clear();w.markedRocks.clear();G.bumpNavigation(w);G.game.h=12;G.rng=()=>.5;G.addBuilding('storage',2,2,{instant:true,free:true});Object.assign(G.game.res,{wood:500,stone:500,iron:500,grain:100,food:100,tools:30,firewood:200});const c=G.spawnCitizen({x:8,y:10,age:30,sex:'m'}),h=G.addBuilding('house',4,10,{instant:true,free:true}).b,f={id:G.nextId(),members:[c.id],coupleIds:[],houseId:h.id};c.familyId=f.id;h.family=f.id;w.families=[f];const gen=G.genWorld;G.genWorld=(seed,opt)=>{const nw=gen(seed,opt);nw.water.set(w.water);nw.rock.set(w.rock);return nw;};return {G,c};}
function field(G,crop='squash',x=10,y=10,size=[4,4]){const r=G.addBuilding('farm',x,y,{farmSize:size,instant:true,free:true});assert(r.ok,r.reason);const b=r.b;if(crop!=='wheat')G.game.unlocks[crop]=true;G.setWorkerLimit(b,0);G.resetFarm(b);for(const c of G.world.citizens)if(c.job===b.id)G.requestTask(c);const season=G.game.season;G.game.season=0;assert(G.setFarmCrop(b,crop));G.game.season=season;return b;}
function ripe(G,b,growth=1){for(const f of b.farm)f.sown=true;b.sownAll=true;b.growth=growth;}
function assign(G,b,c){G.setWorkerLimit(b,1);G.assignWorker(b,c);G.requestTask(c);}
function day(G,d){G.game.day=d;G.game.season=G.seasonOf(d);G.game.year=Math.floor(d/48)+1;G.game.townLedger=G.newTownLedger(G.game);}
const save=G=>JSON.parse(JSON.stringify(G.serializeGame()));
function until(G,p,max=10000){for(let i=0;i<max&&!p();i++)G.advanceSim(.1);assert(p(),'actual simulation did not reach expected state');}
function step(G,c,p,max=10000){for(let i=0;i<max&&!p();i++)G.stepCitizen(c,.1);assert(p(),'worker did not reach expected state');}
function post(G){for(let x=10;x<14;x++)G.world.water[G.world.N+x]=1;G.bumpNavigation(G.world);const b=G.addBuilding('tradingpost',10,2,{instant:true,free:true}).b;G.ensureEconomyBuilding(b);return b;}
function test(name,fn){fn();passed++;console.log('ok '+name);}

function flow(G,type='vegetables'){const l=G.game.townLedger,rows=[...l.days,{...l.current,closing:G.ledgerStock(G.game)}];return G.ledgerTotals(rows)[type];}
function conserved(G){const f=flow(G),cargo=G.world.citizens.reduce((n,c)=>n+(c.carry?.type==='vegetables'?c.carry.qty:0),0);assert(Math.abs(f.produced-f.received-f.discarded-cargo)<1e-8,JSON.stringify({flow:f,cargo}));}

test('new and old villages lock squash; exactly one real 2500-value payment permanently unlocks it',()=>{
  const {G}=fresh(),b=G.addBuilding('farm',10,10,{farmSize:[4,4],instant:true,free:true}).b,p=post(G);
  assert.equal(G.game.unlocks.squash,false);assert.equal(G.farmSummary(b).unlocked.squash,false);assert(!G.setFarmCrop(b,'squash'));
  assert.equal(G.TRADE_GOODS.squashSeed.price,2500);p.merchant={leaveDay:12,stock:{squashSeed:1}};
  assert(!G.executeTrade(p,'squashSeed',1,'stone').ok);p.tradeInventory.stone=358;
  assert(!G.executeTrade(p,'squashSeed',2,'stone').ok);const bought=G.executeTrade(p,'squashSeed',1,'stone');
  assert(bought.ok);assert.equal(bought.paid,358);assert.equal(p.tradeInventory.stone,0);assert.equal(G.game.res.stone,500);assert.equal(G.game.res.vegetables,0);
  assert.equal(G.game.unlocks.squash,true);assert(G.setFarmCrop(b,'squash'));assert.equal(G.game.res.squashSeed,undefined);
  p.tradeInventory.stone=358;p.merchant.stock.squashSeed=1;assert(!G.executeTrade(p,'squashSeed',1,'stone').ok);
  assert.equal(p.tradeInventory.stone,358);assert.equal(p.merchant.stock.squashSeed,1);G.applySaveData(save(G));assert.equal(G.game.unlocks.squash,true);
});

test('merchant stock remains exact on load; future seed order charges 3125 and autobuy settles once',()=>{
  const {G}=fresh(),b=post(G);b.merchant={leaveDay:12,stock:{grain:7,beanSeed:1}};G.applySaveData(save(G));let p=G.world.bmap[b.id];
  assert.equal(JSON.stringify(p.merchant.stock),JSON.stringify({grain:7,beanSeed:1}));p.merchant=null;p.nextMerchantDay=0;G.advanceTownEconomy();assert.equal(p.merchant.stock.squashSeed,1);
  p.merchant.id='seeds';p.merchant.arrivedDay=0;assert(G.orderMerchantGoods(p,'squashSeed',1,p.merchant).ok);
  assert.equal(p.tradeInventory.stone||0,0);assert(!G.game.unlocks.squash);p.tradeInventory.stone=1000;
  assert(G.setAutoTrade(p,{enabled:true,good:'squashSeed',qty:1,payment:'stone',maxPrice:3125},G.game).ok);assert(!G.game.unlocks.squash);
  // Settle annual wildlife after this artificial time jump so the later save is valid.
  p.merchant=null;p.nextMerchantDay=48;p.merchantVisits=5;day(G,48);G.advanceDeer();G.advanceTownEconomy();assert.equal(p.merchant.id,'seeds');assert.equal(G.merchantPrice(p,'squashSeed'),3125);
  assert.equal(G.game.unlocks.squash,true);assert.equal(p.tradeInventory.stone,553);assert.equal(p.merchant.stock.squashSeed,0);assert.equal(p.autoTradeLast.paid,447);
  G.runArrivalAutoTrade(p,p.merchant);assert.equal(p.tradeInventory.stone,553);G.applySaveData(save(G));p=G.world.bmap[b.id];G.runArrivalAutoTrade(p,p.merchant);assert.equal(p.tradeInventory.stone,553);
});

test('squash is 24 days and 14 vegetables per tile; growth freezes at winter while all three older crops still frost on day36',()=>{
  const {G}=fresh(),s=field(G),old=['wheat','cabbage','beans'].map((k,i)=>field(G,k,16+i*6,10));
  assert.equal(G.farmGrowDays(s),24);assert.equal(G.farmBaseYield(s),14);assert.equal(G.farmOutput(s),'vegetables');assert.equal(G.CROPS.squash.sprite,'squash');assert.equal(G.CROPS.squash.winterHarvestDays,2);
  for(const b of [s,...old])ripe(G,b,.5);day(G,34);G.endDay();assert(Math.abs(s.growth-(.5+1/24))<1e-9);const frozen=s.growth;
  G.endDay();assert.equal(G.game.day,36);assert.equal(s.growth,frozen);assert.equal(s.farm.filter(f=>f.sown).length,16);
  for(const b of old){assert.equal(b.growth,0);assert(!b.farm.some(f=>f.sown));assert(!G.farmWinterWindow(b).active);}
  G.endDay();assert.equal(s.growth,frozen);assert(G.farmWinterWindow(s).active);
});

test('exact first-two-winter-day interval ends at day 38 midnight and expires only once with real remaining tile count',()=>{
  const {G}=fresh(),b=field(G);ripe(G,b);const messages=[];G.ui.toast=t=>messages.push(t);
  day(G,36);G.game.h=0;assert.equal(G.farmWinterWindow(b).hoursRemaining,48);assert.equal(G.farmWinterWindow(b).cutoffDay,38);
  G.game.h=23;assert.equal(G.farmWinterWindow(b).hoursRemaining,25);day(G,37);G.game.h=23.99;
  assert(G.farmHarvestReady(b));assert(Math.abs(G.farmWinterWindow(b).hoursRemaining-.01)<1e-9);
  G.advanceSim(.02);assert.equal(G.game.day,38);assert(!G.farmWinterWindow(b).active);assert(!G.farmHarvestReady(b));assert(!b.farm.some(f=>f.sown));
  const frost=()=>messages.filter(t=>t.includes('收获窗口已结束'));assert.equal(frost().length,1);assert.match(frost()[0],/16格未收作物冻死/);assert.match(frost()[0],/已收获及在途蔬菜不受影响/);
  G.expireWinterFarms();G.endDay();assert.equal(frost().length,1);assert(!G.earlyHarvestQuote(b).ok);
  day(G,84);G.game.h=0;assert.equal(G.farmWinterWindow(b).cutoffDay,86);assert.equal(G.farmWinterWindow(b).hoursRemaining,48);
});

test('mature winter squash is real harvest work with 14 per tile and never free warehouse stock',()=>{
  const {G,c}=fresh(),b=field(G);ripe(G,b);day(G,36);assert(G.farmHarvestReady(b));assert(!G.earlyHarvestQuote(b).ok);assert.match(G.farmSummary(b).status,/冬季收获/);
  assign(G,b,c);assert.equal(c.task.kind,'harvest');const task=c.task;step(G,c,()=>!!c.carry);assert.equal(c.carry.qty,14);assert.equal(c.carry.type,'vegetables');assert.equal(G.game.res.vegetables,0);conserved(G);
  const produced=flow(G).produced;c.task=task;G.completeTask(c);assert.equal(flow(G).produced,produced);conserved(G);
  step(G,c,()=>b.harvestDone&&!c.carry);assert.equal(G.game.res.vegetables,224);assert.equal(flow(G).produced,224);assert.equal(flow(G).received,224);conserved(G);
  assert(!G.makeTask(b,c));assert.match(G.farmSummary(b).status,/冬季不能再播种/);
});

test('immature winter crop has frozen two-stage early harvest and rejects stale day/tool/cutoff quotes',()=>{
  const {G,c}=fresh(),b=field(G);ripe(G,b,.5);day(G,36);assert(!G.farmHarvestReady(b));assert.match(G.farmSummary(b).status,/生长冻结 50%/);
  let q=G.earlyHarvestQuote(b);assert(q.ok);assert.equal(q.base,7);assert.equal(q.estimated,112);assert.equal(q.fullEstimated,224);
  G.endDay();assert.equal(b.growth,.5);assert(!G.beginEarlyHarvest(b,q.key).ok);q=G.earlyHarvestQuote(b);G.game.res.tools=0;assert(!G.beginEarlyHarvest(b,q.key).ok);G.game.res.tools=30;
  q=G.earlyHarvestQuote(b);assert(G.beginEarlyHarvest(b,q.key).ok);assert(!G.beginEarlyHarvest(b,q.key).ok);assert.equal(b.earlyHarvestYield,7);assert.equal(G.game.res.vegetables,0);
  assign(G,b,c);step(G,c,()=>b.harvestDone&&!c.carry);assert.equal(G.game.res.vegetables,112);assert.equal(b.growth,.5);conserved(G);
  const later=field(G,'squash',18,10);ripe(G,later,.5);const late=G.earlyHarvestQuote(later);G.game.h=23.99;G.advanceSim(.02);assert(!G.beginEarlyHarvest(later,late.key).ok);assert(!later.farm.some(f=>f.sown));
});

test('winter never sows or completes a stale sow and unfinished fields expire at cutoff',()=>{
  const {G,c}=fresh(),b=field(G);assign(G,b,c);const sow=c.task;assert.equal(sow.kind,'sow');b.farm[1].sown=true;
  day(G,36);assert(!G.farmTaskCurrent(sow));c.task=sow;G.completeTask(c);assert(!b.farm[0].sown);assert(!G.makeTask(b,c));assert(!G.earlyHarvestQuote(b).ok);assert.match(G.farmSummary(b).status,/不能补播/);
  G.endDay();assert.equal(b.growth,0);G.endDay();assert(!b.farm.some(f=>f.sown));assert.equal(b.sowingCommitted,undefined);
});

test('late crop choices cannot rename actual field or harvest and spring applies choice only after reset',()=>{
  const {G,c}=fresh(),b=field(G);assign(G,b,c);const sow=c.task;assert(G.setFarmCrop(b,'wheat'));assert.equal(b.cropType,'squash');assert.equal(sow.crop,'squash');
  ripe(G,b);day(G,35);G.endDay();assert.equal(b.cropType,'squash');assert(G.farmHarvestReady(b));c.task=null;c.path=null;c.state='idle';G.requestTask(c);step(G,c,()=>!!c.carry);const qty=c.carry.qty;
  assert.equal(c.carry.type,'vegetables');day(G,48);G.onSeasonChange(3,0);assert.equal(b.cropType,'wheat');assert.equal(b.cropChoice,'wheat');assert.equal(c.carry.type,'vegetables');assert.equal(c.carry.qty,qty);assert.equal(b.growth,0);
  G.requestTask(c);assert.equal(c.state,'haul');assert.equal(c.carry.type,'vegetables');
  const w=field(G,'wheat',18,10);ripe(G,w);day(G,35);assert(G.setFarmCrop(w,'squash'));assert.equal(w.cropType,'wheat');G.endDay();assert(!w.farm.some(f=>f.sown));assert.equal(w.cropType,'wheat');
});

test('actual partial harvest paused overnight survives cutoff; active and paused old tasks cannot pay twice',()=>{
  const {G,c}=fresh(),b=field(G);ripe(G,b);day(G,37);assign(G,b,c);step(G,c,()=>!!c.carry);const cargo=c.carry,old=c.task;
  assert.equal(cargo.qty,14);assert.equal(old.kind,'harvest');G.game.h=21;G.goHome(c);assert.equal(c.pausedTask,old);
  G.game.h=23.99;G.advanceSim(.02);assert.equal(G.game.day,38);assert.equal(c.task,null);assert.equal(c.pausedTask,null);assert.equal(c.carry,cargo);assert.equal(c.carry.qty,14);assert(!G.farmTaskCurrent(old));
  G.game.h=12;c.task=old;G.completeTask(c);assert.equal(flow(G).produced,14);step(G,c,()=>!c.carry);assert.equal(G.game.res.vegetables,14);conserved(G);
  const active=field(G,'squash',18,10);ripe(G,active);day(G,37);G.releaseWorker(c);assign(G,active,c);step(G,c,()=>c.state==='work');const oldActive=c.task;
  G.game.h=23.99;G.advanceSim(.02);assert.equal(c.task,null);assert(!G.farmTaskCurrent(oldActive));assert(!active.farm.some(f=>f.sown));
});

test('real accepted haul survives reset, cleared field and demolition without conversion or duplicate yield',()=>{
  for(const action of ['reset','demolish']){const {G,c}=fresh(),b=field(G);ripe(G,b);day(G,37);assign(G,b,c);step(G,c,()=>c.state==='haul'&&!!c.carry);const qty=c.carry.qty;assert.equal(qty,28);
    if(action==='reset')G.resetFarm(b,false);else assert(G.removeBuilding(b));
    assert.equal(c.carry.qty,qty);assert.equal(c.carry.type,'vegetables');assert.equal(G.game.res.vegetables,0);step(G,c,()=>!c.carry);assert.equal(G.game.res.vegetables,qty);conserved(G);
  }
});

test('ordinary full warehouse farm cargo follows explicit discard ledger; withdrawn worker cargo instead waits across load',()=>{
  {const {G,c}=fresh(),b=field(G);ripe(G,b);day(G,37);assign(G,b,c);step(G,c,()=>c.state==='haul'&&!!c.carry);const qty=c.carry.qty;
    G.resetFarm(b,false);G.game.res.food=G.game.res.grain=G.storageCap('grain');step(G,c,()=>!c.carry);assert.equal(G.game.res.vegetables,0);assert.equal(flow(G).discarded,qty);assert.equal(flow(G).received,0);conserved(G);
  }
  {let {G,c}=fresh(),b=field(G);ripe(G,b);day(G,37);assign(G,b,c);step(G,c,()=>!!c.carry);assert.equal(c.carry.qty,14);G.setWorkerLimit(b,0);G.game.res.food=G.game.res.grain=G.storageCap('grain');step(G,c,()=>c.state==='waitStorage');
    const qty=c.carry.qty;assert.equal(qty,28); // The already accepted second tile finishes before withdrawal.
    assert.equal(c.carry.qty,qty);assert(c.carry.staffingReturn);for(let i=0;i<3;i++){G.applySaveData(save(G));c=G.world.cmap[c.id];b=G.world.bmap[b.id];assert.equal(c.carry.qty,qty);assert.equal(flow(G).discarded,0);conserved(G);}
    G.game.res.food=G.game.res.grain=0;step(G,c,()=>!c.carry&&c.job===null);assert.equal(G.game.res.vegetables,qty);assert.equal(flow(G).discarded,0);conserved(G);
  }
});

test('carrier death records remaining food loss once; hunting and supply retain their owner-specific accounting',()=>{
  const {G,c}=fresh(),b=field(G);ripe(G,b);day(G,37);assign(G,b,c);step(G,c,()=>!!c.carry);const qty=c.carry.qty;G.killCitizen(c,'老去');G.killCitizen(c,'老去');
  assert.equal(c.carry,null);assert.equal(G.world.cmap[c.id],undefined);assert.equal(flow(G).discarded,qty);assert.equal(G.game.res.vegetables,0);conserved(G);
  const hunt=G.spawnCitizen({x:8,y:10,age:30,sex:'m'});hunt.carry={type:'meat',qty:12,extra:{leather:4},huntingId:0,staffingReturn:true};G.killCitizen(hunt,'老去');assert.equal(flow(G,'meat').discarded,12);assert.equal(G.game.huntingLost.meat,12);assert.equal(hunt.carry,null);
  const supply=G.spawnCitizen({x:8,y:10,age:30,sex:'m'});supply.carry={type:'vegetables',qty:9,supplyBatch:{kind:'home',to:1},staffingReturn:true};G.killCitizen(supply,'老去');assert.equal(flow(G).discarded,qty);assert.equal(G.world.supplyCaches.reduce((n,s)=>n+s.supplyStock.vegetables,0),9);assert.equal(supply.carry,null);
  const orchard=G.spawnCitizen({x:8,y:10,age:30,sex:'m'});orchard.carry={type:'apples',qty:8,orchardId:2};G.killCitizen(orchard,'老去');G.killCitizen(orchard,'老去');assert.equal(flow(G,'apples').discarded,8);assert.equal(orchard.carry,null);assert.equal(G.game.res.apples,0);
});

test('loaded winter crop and actual cargo retain frozen progress, identity and deliver once',()=>{
  let {G,c}=fresh(),b=field(G);ripe(G,b,.5);day(G,36);assert(G.beginEarlyHarvest(b,G.earlyHarvestQuote(b).key).ok);assign(G,b,c);step(G,c,()=>!!c.carry);const qty=c.carry.qty;
  G.setFarmCrop(b,'wheat');for(let i=0;i<3;i++){G.applySaveData(save(G));b=G.world.bmap[b.id];c=G.world.cmap[c.id];assert.equal(b.cropType,'squash');assert.equal(b.cropChoice,'wheat');assert.equal(b.growth,.5);assert.equal(b.earlyHarvestYield,7);assert.equal(c.carry.qty,qty);assert.equal(c.carry.type,'vegetables');conserved(G);}
  step(G,c,()=>b.harvestDone&&!c.carry);assert.equal(G.game.res.vegetables,112);assert.equal(flow(G).produced,112);conserved(G);
  G.applySaveData(save(G));assert.equal(G.game.res.vegetables,112);assert.equal(G.world.bmap[b.id].harvestDone,true);assert(!G.makeTask(G.world.bmap[b.id],G.world.cmap[c.id]));
});

test('legacy absent unlock never grants seed stock or modifies previous fields and food',()=>{
  const {G,c}=fresh(),b=field(G,'cabbage');ripe(G,b,.7);c.carry={type:'vegetables',qty:14};const d=save(G);delete d.game.unlocks.squash;G.applySaveData(d);
  assert.equal(G.game.unlocks.squash,false);assert.equal(G.world.bmap[b.id].cropType,'cabbage');assert.equal(G.world.bmap[b.id].growth,.7);assert.equal(G.world.cmap[c.id].carry.qty,14);assert.equal(G.game.res.vegetables,0);assert.equal(G.game.res.squashSeed,undefined);
});

test('invalid unlock, locked crop, excessive yield and expired planted winter saves reject atomically',()=>{
  const {G}=fresh(),b=field(G);ripe(G,b,.5);day(G,37);G.beginEarlyHarvest(b,G.earlyHarvestQuote(b).key);const base=save(G),world=G.world,game=G.game;
  for(const mutate of [d=>d.game.unlocks.squash='true',d=>d.game.unlocks.squash=false,d=>d.buildings.find(x=>x.id===b.id).earlyHarvestYield=8,d=>d.buildings.find(x=>x.id===b.id).earlyHarvestYield=15,d=>d.buildings.find(x=>x.id===b.id).harvestDone=true,d=>d.buildings.find(x=>x.id===b.id).farm[0][0]=0,d=>d.buildings.find(x=>x.id===b.id).sownAll=false,d=>{d.game.day=38;delete d.game.townLedger;}]){
    const data=JSON.parse(JSON.stringify(base));mutate(data);assert.throws(()=>G.applySaveData(data));assert.equal(G.world,world);assert.equal(G.game,game);assert.equal(G.game.res.vegetables,0);
  }
});

test('actual calendar winter harvest stops at midnight cutoff and conserves stock, cargo, meals and explicit losses',()=>{
  const {G,c}=fresh(),b=field(G,'squash',10,10,[8,8]);ripe(G,b);day(G,35);G.game.h=18;assign(G,b,c);
  const notices=[];G.ui.toast=t=>notices.push(t);let beforeWinter=0;
  while(G.game.day<39){if(G.game.day===35)beforeWinter=flow(G).produced;G.advanceSim(.1);}
  assert.equal(G.game.stats.died,0);assert(flow(G).produced>beforeWinter);assert(flow(G).produced<64*14);assert(!b.farm.some(f=>f.sown));assert.equal(notices.filter(t=>t.includes('收获窗口已结束')).length,1);
  assert.equal(c.task?.kind==='harvest',false);assert.equal(c.pausedTask?.kind==='harvest',false);conserved(G);
  const f=flow(G),cargo=G.world.citizens.reduce((n,c)=>n+(c.carry?.type==='vegetables'?c.carry.qty:0),0);
  assert(Math.abs(f.produced-G.game.res.vegetables-cargo-f.used-f.discarded)<1e-7);
  console.log('  actual calendar: '+JSON.stringify({produced:f.produced,received:f.received,stock:G.game.res.vegetables,carried:cargo,used:f.used,discarded:f.discarded}));
});

console.log('Cold squash: '+passed+' passed');
