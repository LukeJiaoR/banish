/* Permanent crop seeds, seasonal crop identity and actual field delivery. */
'use strict';
const assert=require('node:assert/strict'),path=require('node:path');
const {loadGame}=require('./helpers/playability');let passed=0;
function fresh(){
  const G=loadGame(path.resolve(__dirname,'..'));G.newGame(1);const w=G.world;
  for(const key of ['water','rock','road'])w[key].fill(0);w.bgrid.fill(-1);w.treeIdx.fill(-1);
  w.trees=[];w.buildings=[];w.bmap={};w.citizens=[];w.cmap={};w.families=[];w.marked.clear();w.markedRocks.clear();G.bumpNavigation(w);
  G.game.h=12;G.rng=()=>.5;G.addBuilding('storage',2,2,{instant:true,free:true});
  const generate=G.genWorld;G.genWorld=(seed,opt)=>{const nw=generate(seed,opt);nw.water.set(w.water);nw.rock.set(w.rock);return nw;};return G;
}
function addCitizen(G,b,x=9,y=10){const c=G.spawnCitizen({x,y,age:30,sex:'m'});if(b){c.job=b.id;b.workers.push(c.id);}return c;}
function setup(){const G=fresh(),b=G.addBuilding('farm',10,10,{instant:true,free:true}).b,c=addCitizen(G,b);return {G,b,c};}
function trade(G){for(let x=10;x<14;x++)G.world.water[1*G.world.N+x]=1;G.bumpNavigation(G.world);const b=G.addBuilding('tradingpost',10,2,{instant:true,free:true}).b;G.ensureEconomyBuilding(b);b.merchant={leaveDay:100,stock:{cabbageSeed:1,orchardSeed:1}};return b;}
function dispatch(G,b,c){c.task=G.makeTask(b,c);assert(c.task);G.sendTo(c,c.task.tx,c.task.ty);}
function until(G,c,predicate,limit=15000){for(let i=0;i<limit&&!predicate();i++)G.stepCitizen(c,.1);assert(predicate(),'expected progress did not occur');}
const snapshot=G=>JSON.parse(JSON.stringify(G.serializeGame()));
function ripe(G,b){for(const f of b.farm){f.sown=true;f.harvested=false;}b.sownAll=true;b.growth=1;b.harvestDone=false;G.game.season=2;G.game.day=24;G.game.townLedger=G.newTownLedger(G.game);}
function test(name,fn){fn();passed++;console.log('ok '+name);}

test('default wheat is free; cabbage cannot be selected before the permanent seed unlock',()=>{
  const {G,b}=setup();assert.equal(G.farmCropOf(b),'wheat');assert.equal(G.farmOutput(b),'grain');
  assert.equal(G.setFarmCrop(b,'cabbage'),false);assert.equal(G.setFarmCrop(b,'unknown'),false);assert.equal(G.setFarmCrop({...b},'wheat'),false);
  assert.equal(G.farmSummary(b).unlocked.cabbage,false);assert.equal(G.game.res.vegetables,0);
});
test('seed exchange only uses real trade stock, charges once and works within shared capacity',()=>{
  const {G,b}=setup(),post=trade(G);G.game.res.stone=500;
  assert.equal(G.executeTrade(post,'cabbageSeed',1,'stone').ok,false);post.tradeInventory.stone=358;
  const result=G.executeTrade(post,'cabbageSeed',1,'stone');assert.equal(result.paid,358);assert.equal(G.tradeStored(post),0);
  assert.equal(G.game.unlocks.cabbage,true);assert.equal(G.game.res.stone,500);assert(G.setFarmCrop(b,'cabbage'));
  post.tradeInventory.stone=358;post.merchant.stock.cabbageSeed=1;
  assert.equal(G.executeTrade(post,'cabbageSeed',1,'stone').ok,false);assert.equal(post.tradeInventory.stone,358);assert.equal(post.merchant.stock.cabbageSeed,1);
  assert.equal(G.game.res.cabbageSeed,undefined);assert.equal(G.game.res.vegetables,0);
  assert(G.executeTrade(post,'orchardSeed',1,'stone').ok);assert.equal(G.game.unlocks.orchard,true);
});
test('first general merchant includes one cabbage seed; old visiting ships are not rewritten',()=>{
  const G=fresh(),b=trade(G);delete b.merchant.stock.cabbageSeed;
  assert.equal(G.executeTrade(b,'cabbageSeed',1,'stone').ok,false);
  b.merchant=null;b.nextMerchantDay=G.game.day;G.advanceTownEconomy();assert.equal(b.merchant.stock.cabbageSeed,1);
  assert.equal(G.seedTradeReason('cabbageSeed',2),'种子只需购买1份，永久解锁所有对应农田或果园');
});
test('an accepted first sow locks the actual wheat crop before a single tile is planted',()=>{
  const {G,b,c}=setup();G.game.unlocks.cabbage=true;dispatch(G,b,c);const task=c.task;
  assert.equal(task.crop,'wheat');assert.equal(b.farm.some(f=>f.sown),false);assert(G.setFarmCrop(b,'cabbage'));
  assert.equal(G.farmCropOf(b),'wheat');assert.equal(G.cropChoiceOf(b),'cabbage');assert.equal(task.crop,'wheat');
  assert.equal(G.farmSummary(b).pending,true);until(G,c,()=>b.farm.some(f=>f.sown));assert.equal(G.farmOutput(b),'grain');
});
test('unstarted spring or summer field adopts the choice; autumn and winter wait for spring',()=>{
  const {G,b}=setup();G.game.unlocks.cabbage=true;assert(G.setFarmCrop(b,'cabbage'));assert.equal(G.farmCropOf(b),'cabbage');
  G.game.season=1;assert(G.setFarmCrop(b,'wheat'));assert.equal(G.farmCropOf(b),'wheat');
  G.game.season=2;assert(G.setFarmCrop(b,'cabbage'));assert.equal(G.farmCropOf(b),'wheat');G.game.season=3;assert.equal(G.farmCropOf(b),'wheat');
  G.game.season=0;G.game.year++;G.onSeasonChange(3,0);assert.equal(G.farmCropOf(b),'cabbage');assert.equal(G.farmSummary(b).pending,false);
});
test('four real farmers sow a cabbage field and autumn harvest is actually hauled as vegetables',()=>{
  const {G,b,c}=setup();G.game.unlocks.cabbage=true;G.setFarmCrop(b,'cabbage');G.addBuilding('storage',20,10,{instant:true,free:true});
  const cs=[c,...[1,2,3].map(i=>addCitizen(G,b,9,10+i))];for(const a of cs)dispatch(G,b,a);
  for(let i=0;i<20000&&!b.sownAll;i++)for(const a of cs)G.stepCitizen(a,.1);assert(b.sownAll);assert.equal(b.growth,0);
  // End-day growth is still tied to completely planted fields, not a free crop grant.
  G.game.res.food=G.game.res.grain=2000;G.game.res.firewood=500;for(let day=0;day<=G.PROD.farm.growDays;day++)G.endDay();
  assert.equal(b.growth,1);G.game.season=2;G.game.day=24;G.game.res.food=G.game.res.grain=0;G.game.res.vegetables=0;
  for(const a of cs){a.task=null;a.path=null;a.state='idle';a.wanderT=0;}
  for(let i=0;i<30000&&!(b.harvestDone&&cs.every(a=>!a.carry));i++)for(const a of cs)G.stepCitizen(a,.1);
  assert(b.harvestDone);assert.equal(G.game.res.grain,0);assert.equal(G.game.res.vegetables,896);assert.equal(G.game.res.food,896);
  // Both food classes still share warehouse capacity; two existing barns hold the full harvest.
});
test('old wheat crop and carried grain keep their type after queuing cabbage, then next spring changes only the field',()=>{
  const {G,b,c}=setup();G.game.unlocks.cabbage=true;ripe(G,b);G.setFarmCrop(b,'cabbage');
  dispatch(G,b,c);until(G,c,()=>!!c.carry);assert.equal(c.carry.type,'grain');const qty=c.carry.qty;
  G.game.season=0;G.game.year++;G.onSeasonChange(3,0);assert.equal(G.farmCropOf(b),'cabbage');assert.equal(c.carry.type,'grain');assert.equal(c.carry.qty,qty);
  G.requestTask(c);assert.equal(c.state,'haul');assert.equal(c.carry.type,'grain');
});
test('food-specific goals apply to the actual seasonal output and never cancel a committed crop',()=>{
  const {G,b,c}=setup();G.game.unlocks.cabbage=true;G.setProductionGoal('grain',0);G.setFarmCrop(b,'cabbage');assert.equal(G.productionLimited(b),false);
  G.setProductionGoal('vegetables',0);assert.equal(G.makeTask(b,c),null);G.setProductionGoal('vegetables',null);dispatch(G,b,c);
  G.setProductionGoal('vegetables',0);assert(G.goalCommitment(c));assert.equal(G.productionLimited(b),false);assert(G.makeTask(b,c));
  G.setFarmCrop(b,'wheat');assert.equal(G.farmOutput(b),'vegetables');assert.equal(G.productionOutputsOf(b).join(','),'food,vegetables');
});
test('winter frost expires active and paused jobs without converting or deleting already harvested cargo',()=>{
  const {G,b,c}=setup();G.game.unlocks.cabbage=true;G.setFarmCrop(b,'cabbage');ripe(G,b);dispatch(G,b,c);const task=c.task;c.pausedTask=task;c.task=null;c.carry={type:'vegetables',qty:14};
  G.setFarmCrop(b,'wheat');G.game.season=3;G.onSeasonChange(2,3);assert.equal(c.pausedTask,null);assert.equal(c.carry.qty,14);assert.equal(c.carry.type,'vegetables');
  assert.equal(b.farm.some(f=>f.sown),false);assert.equal(G.farmCropOf(b),'cabbage');assert.equal(G.farmTaskCurrent(task),false);
  G.game.season=0;G.game.year++;G.onSeasonChange(3,0);assert.equal(G.farmCropOf(b),'wheat');
});
test('incomplete spring sowing cannot survive winter or reapply a stale task next year',()=>{
  const {G,b,c}=setup();dispatch(G,b,c);const old=c.task;G.game.season=3;G.onSeasonChange(2,3);assert.equal(c.task,null);assert.equal(G.farmTaskCurrent(old),false);
  G.game.season=0;G.game.year++;assert.equal(G.farmTaskCurrent(old),false);
});
test('finishing a crop tile retains the whole yield when restored tools cross the basket threshold',()=>{
  for(const crop of ['wheat','cabbage']){const {G,b,c}=setup();G.game.unlocks.cabbage=true;G.setFarmCrop(b,crop);ripe(G,b);
    const type=G.farmOutput(b);c.carry={type,qty:21};G.game.res.tools=2;dispatch(G,b,c);
    until(G,c,()=>c.carry?.qty===35);assert.equal(c.carry.type,type);assert.equal(c.state,'haul');
  }
});
test('new crops round trip current season, queued choice and carried food; legacy fields remain wheat',()=>{
  const {G,b,c}=setup();G.game.unlocks.cabbage=true;ripe(G,b);G.setFarmCrop(b,'cabbage');c.carry={type:'grain',qty:14};
  let data=snapshot(G),prepared=G.prepareSaveData(data);assert.equal(prepared.world.bmap[b.id].cropType,'wheat');assert.equal(prepared.world.bmap[b.id].cropChoice,'cabbage');assert.equal(prepared.world.cmap[c.id].carry.type,'grain');
  const actual=snapshot(G);actual.buildings.find(x=>x.id===b.id).cropType='cabbage';actual.citizens[0].carry={type:'vegetables',qty:28};const live=G.prepareSaveData(actual);assert.equal(live.world.bmap[b.id].cropType,'cabbage');assert.equal(live.world.cmap[c.id].carry.type,'vegetables');
  delete data.game.unlocks.cabbage;for(const bd of data.buildings){delete bd.cropType;delete bd.cropChoice;}
  prepared=G.prepareSaveData(data);assert.equal(prepared.game.unlocks.cabbage,false);assert.equal(prepared.world.bmap[b.id].cropType,'wheat');assert.equal(prepared.world.bmap[b.id].cropChoice,'wheat');assert.equal(prepared.world.bmap[b.id].growth,1);
});
test('invalid crop ids, unlocked flags and unowned crop states reject an import atomically',()=>{
  const {G,b}=setup(),base=snapshot(G),world=G.world;
  for(const mutate of [d=>d.buildings.find(x=>x.id===b.id).cropType='potato',d=>d.buildings.find(x=>x.id===b.id).cropChoice='cabbage',d=>d.game.unlocks.cabbage='true']){
    const data=JSON.parse(JSON.stringify(base));mutate(data);assert.throws(()=>G.applySaveData(data));assert.equal(G.world,world);
  }
});
test('crop identity fields reject array/object coercion and never retain malformed input references',()=>{
  const {G,b}=setup(),base=snapshot(G),world=G.world,game=G.game;
  for(const field of ['cropType','cropChoice'])for(const value of [['cabbage'],['wheat'],{crop:'cabbage'},true,1,null]){
    const data=JSON.parse(JSON.stringify(base));data.buildings.find(x=>x.id===b.id)[field]=value;
    assert.throws(()=>G.applySaveData(data));assert.equal(G.world,world);assert.equal(G.game,game);
    assert.equal(G.farmCropOf(b),'wheat');assert.equal(G.cropChoiceOf(b),'wheat');assert.equal(G.game.unlocks.cabbage,false);
  }
});
test('existing quarry and trade workers can earn and physically deliver one 2500-value seed payment',()=>{
  const G=fresh(),post=trade(G),quarry=G.addBuilding('stonequarry',10,10,{instant:true,free:true}).b;
  const cs=[addCitizen(G,quarry,9,10),addCitizen(G,quarry,9,11),addCitizen(G,post,9,2)];G.game.res.stone=0;G.setTradeTarget(post,'stone',358);
  let hours=0;for(;hours<576&&(post.tradeInventory.stone||0)<358;hours+=.1)for(const c of cs)G.stepCitizen(c,.1);
  assert((post.tradeInventory.stone||0)>=358,'one year of 12-hour workdays should cover stone payment');
  assert(G.executeTrade(post,'cabbageSeed',1,'stone').ok);assert.equal(G.game.unlocks.cabbage,true);
  console.log(`  economy evidence: 358 stone physically quarried and hauled to trade in ${hours.toFixed(1)} active hours (${(hours/12).toFixed(1)} twelve-hour workdays); construction/subsistence excluded`);
});
console.log(`Crop seeds: ${passed} passed`);
