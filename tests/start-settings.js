'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const ROOT=path.resolve(__dirname,'..');let passed=0;
const copy=x=>JSON.parse(JSON.stringify(x));
function load(root=ROOT){
  const events=[],stored=new Map(),elements=new Map();
  const element=id=>{if(!elements.has(id)){const classes=new Set(['hidden']);elements.set(id,{id,classList:{add:k=>classes.add(k),remove:k=>classes.delete(k),contains:k=>classes.has(k)},addEventListener(){},querySelectorAll:()=>[]});}return elements.get(id);};
  const ctx={console,setTimeout,clearTimeout,innerWidth:1200,innerHeight:800,addEventListener(){},document:{getElementById:element},localStorage:{getItem:k=>stored.get(k)||null,setItem(k,v){events.push(['save',k]);stored.set(k,v);},removeItem(k){events.push(['remove',k]);stored.delete(k);}}};
  ctx.window=ctx;vm.createContext(ctx);
  for(const name of ['core','defs','map','sim','fire','supply','main'])vm.runInContext(fs.readFileSync(path.join(root,'js',name+'.js'),'utf8'),ctx,{filename:name+'.js'});
  const G=ctx.G;
  G.ui={toast:(...x)=>events.push(['toast',...x]),hideInfo:()=>events.push(['hideInfo']),setToolActive:()=>events.push(['setToolActive']),refreshHUD:()=>events.push(['refreshHUD'])};
  G.markGroundDirty=()=>{};G.T2S=()=>[0,0];G.cam={x:0,y:0,z:1};G.groundDirty={clear:()=>events.push(['ground'])};
  G.deleteServerSaveQuiet=k=>events.push(['serverDelete',k]);const realAutosave=G.autosave;G.autosave=()=>{};
  return {G,events,stored,element,ctx,realAutosave};
}
function fresh(preset='hard'){const t=load();assert(t.G.newGame(1,{preset}).ok);t.events.length=0;return t;}
const saved=G=>copy(G.serializeGame());
function test(name,fn){fn();passed++;console.log('ok '+name);}
function unchanged(G,before){assert.equal(G.world,before.world);assert.equal(G.game,before.game);assert.equal(G.rng,before.rng);assert.equal(G._peekUid(),before.uid);assert.equal(G.autosaveBlocked,before.blocked);assert.equal(JSON.stringify(G.serializeGame()),before.save);}
function snapshot(G){return {world:G.world,game:G.game,rng:G.rng,uid:G._peekUid(),blocked:G.autosaveBlocked,save:JSON.stringify(G.serializeGame())};}
function fieldTown(){
  const t=fresh(),{G}=t,w=G.world;
  for(const k of ['water','rock','road'])w[k].fill(0);w.bgrid.fill(-1);w.treeIdx.fill(-1);w.trees=[];w.buildings=[];w.bmap={};w.citizens=[];w.cmap={};w.families=[];w.marked.clear();w.markedRocks.clear();w.rockCleared=[];G.bumpNavigation(w);
  G.game.h=12;G.addBuilding('storage',2,2,{instant:true,free:true});
  const c=G.spawnCitizen({x:8,y:10,age:30,sex:'m'}),h=G.addBuilding('house',4,10,{instant:true,free:true}).b;
  const f={id:G.nextId(),members:[c.id],coupleIds:[],houseId:h.id};c.familyId=f.id;h.family=f.id;w.families=[f];
  const farm=G.addBuilding('farm',10,10,{farmSize:[4,4],instant:true,free:true}).b;
  G.setWorkerLimit(farm,1);c.job=farm.id;farm.workers=[c.id];
  // Preserve the controlled fixture's terrain when the real save loader rebuilds it.
  const gen=G.genWorld;G.genWorld=(seed,opt)=>{const nw=gen(seed,opt);nw.water.set(w.water);nw.rock.set(w.rock);return nw;};
  return {...t,c,farm};
}
function until(G,c,check,max=6000){for(let i=0;i<max&&!check();i++)G.stepCitizen(c,.1);assert(check(),'expected actual citizen work to finish');}

test('classic remains the direct-call default with exact current stocks and 5 families / 15 people',()=>{
  const {G}=fresh('classic');assert.equal(G.game.startConfig.preset,'classic');assert.equal(G.world.families.length,5);assert.equal(G.world.citizens.length,15);
  assert.deepEqual(copy(G.world.families.map(f=>f.members.length)),[4,4,3,2,2]);
  const expected=Object.fromEntries(G.RES_KEYS.map(k=>[k,0]));Object.assign(expected,{wood:80,stone:48,grain:500,food:500,firewood:50,tools:15});assert.deepEqual(copy(G.game.res),expected);assert(G.cropUnlocked('wheat'));
  assert(G.newGame(1).ok);assert.equal(G.game.startConfig.preset,'classic');assert.equal(G.world.buildings.length,1);assert.equal(G.world.buildings[0].type,'storage');
});
test('hard starts 4 families / 13 people, cart only, exact reduced stock, no seeds or livestock',()=>{
  const {G}=fresh();assert.deepEqual(copy(G.world.families.map(f=>f.members.length)),[4,4,3,2]);assert.equal(G.world.citizens.length,13);assert.equal(G.world.citizens.filter(c=>c.adult).length,8);
  const expected=Object.fromEntries(G.RES_KEYS.map(k=>[k,0]));Object.assign(expected,{grain:400,food:400,firewood:40,tools:12});assert.deepEqual(copy(G.game.res),expected);
  assert(Object.values(G.game.unlocks).every(x=>x===false));assert(Object.values(G.game.livestock).every(x=>x===0));assert.equal(G.world.buildings.length,1);assert.equal(G.world.buildings[0].type,'storage');assert(G.world.families.every(f=>f.houseId===null));
  assert(G.world.citizens.every(c=>c.clothingLeft===0&&c.clothingType===null&&c.toolType===null));
});
test('pure quote preserves zero and signed range, rejects non-decimal or out-of-range input, owns detached data',()=>{
  const {G,events}=fresh();let calls=0;G.rng=()=>{calls++;return .1;};const before=snapshot(G);
  for(const seed of [0,-2147483648,4294967295,'0','-2147483648','4294967295',' +42 ']){const q=G.startConfigQuote({preset:'hard',seed});assert(q.ok,String(seed));assert.equal(q.config.seed,Number(seed));}
  for(const seed of [null,undefined,'',' ','1.2','1e3','0x10','Infinity',[],{},NaN,Infinity,-2147483649,4294967296,1.2,true])assert(!G.startConfigQuote({preset:'hard',seed}).ok,String(seed));
  for(const preset of ['easy','toString',1,null,{}])assert(!G.startConfigQuote({preset,seed:0}).ok);
  assert(!G.startConfigQuote({v:2,preset:'hard',seed:0}).ok);
  const q=G.startConfigQuote({preset:'hard',seed:0});q.presetSummary.resources.tools=999;q.presetSummary.unlockedSeeds.push('wheat');q.config.preset='classic';
  assert.equal(G.startConfigQuote({preset:'hard',seed:0}).presetSummary.resources.tools,12);assert.equal(calls,0);assert.equal(events.length,0);unchanged(G,before);
});
test('seed zero and the same preset repeat full initial snapshots and map, including IDs after other games',()=>{
  const {G}=fresh();for(const preset of ['classic','hard']){
    assert(G.newGame(0,{preset}).ok);const d=saved(G),map=JSON.stringify([Array.from(G.world.water),Array.from(G.world.rock),G.world.start]);
    G.newGame(1,{preset:preset==='classic'?'hard':'classic'});G.setUid(50000);
    assert(G.newGame(0,{preset}).ok);assert.equal(G.world.seed,0);assert.deepEqual(saved(G),d);assert.equal(JSON.stringify([Array.from(G.world.water),Array.from(G.world.rock),G.world.start]),map);
  }
});
test('invalid direct new-game requests leave world, resources, RNG, IDs, input, saves and UI untouched',()=>{
  const {G,events}=fresh();G.autosaveBlocked=true;G.keys={w:true};G.sel={kind:'c',id:2};G.tool={kind:'fell'};const keys=G.keys,sel=G.sel,tool=G.tool;const before=snapshot(G);
  for(const [seed,options] of [['',{preserveSaves:false}],[null,{}],[1.5,{}],[0,{preset:'easy'}],[4294967296,{preset:'hard'}]]){assert(!G.newGame(seed,options).ok);unchanged(G,before);assert.equal(G.keys,keys);assert.equal(G.sel,sel);assert.equal(G.tool,tool);assert.equal(events.length,0);}
});
test('map, cart, citizen and final scheduling failure all roll back before any UI/save effects or old RNG/UID consumption',()=>{
  for(const failure of ['map','cart','citizen','schedule']){
    const {G,events,stored}=fresh();stored.set(G.AUTOSAVE_KEY,'old-auto');stored.set(G.SAVE_KEY,'manual');G.autosaveBlocked=true;
    let oldRngCalls=0;G.rng=()=>{oldRngCalls++;return .25;};const before=snapshot(G),oldNext=G.nextId,oldSet=G.setUid;
    if(failure==='map')G.genWorld=()=>{G.rng();G.nextId();throw new Error('map failure');};
    if(failure==='cart')G.addBuilding=()=>({ok:false,reason:'cart failure'});
    if(failure==='citizen'){const spawn=G.spawnCitizen;let n=0;G.spawnCitizen=x=>{const c=spawn(x);if(++n===3)throw new Error('citizen failure');return c;};}
    if(failure==='schedule'){const schedule=G.scheduleJobs;let n=0;G.scheduleJobs=()=>{schedule();if(++n===2)throw new Error('schedule failure');};}
    const r=G.newGame(0,{preset:'hard'});assert(!r.ok);assert.match(r.reason,/失败/);unchanged(G,before);assert.equal(G.nextId,oldNext);assert.equal(G.setUid,oldSet);assert.equal(oldRngCalls,0);assert.equal(events.length,0);assert.equal(stored.get(G.AUTOSAVE_KEY),'old-auto');assert.equal(stored.get(G.SAVE_KEY),'manual');
  }
});
test('successful commit removes only autosave once; preserveSaves retains all saves and blocks automatic overwrite',()=>{
  const {G,events,stored}=fresh();stored.set(G.AUTOSAVE_KEY,'old-auto');stored.set(G.SAVE_KEY,'manual');
  assert(G.newGame(0,{preset:'hard',preserveSaves:true}).ok);assert.equal(G.autosaveBlocked,true);assert.equal(stored.get(G.AUTOSAVE_KEY),'old-auto');assert.equal(stored.get(G.SAVE_KEY),'manual');assert(!events.some(e=>e[0]==='remove'||e[0]==='serverDelete'));
  events.length=0;assert(G.newGame(0).ok);assert.equal(G.autosaveBlocked,false);assert.equal(stored.get(G.SAVE_KEY),'manual');assert.equal(stored.has(G.AUTOSAVE_KEY),false);assert.deepEqual(events.filter(e=>['remove','serverDelete'].includes(e[0])),[['remove',G.AUTOSAVE_KEY],['serverDelete','autosave']]);
});
test('final confirmation rejects stale worlds, changed quotes, missing settings and every unrelated modal',()=>{
  const {G,element,events}=fresh(),q=G.startConfigQuote({preset:'hard',seed:0});const request={world:G.world,game:G.game,key:q.key,config:q.config},before=snapshot(G);
  assert(!G.confirmNewGame(request).ok);element('new-game-settings').classList.remove('hidden');
  assert(!G.confirmNewGame({...request,world:{}}).ok);assert(!G.confirmNewGame({...request,game:{}}).ok);assert(!G.confirmNewGame({...request,config:{...q.config,seed:2}}).ok);
  for(const id of ['fb','errs','saves','production-goals','help']){element(id).classList.remove('hidden');assert(!G.confirmNewGame(request).ok);element(id).classList.add('hidden');}
  unchanged(G,before);assert.equal(events.length,0);element('over').classList.remove('hidden');assert.equal(G.topModal().id,'new-game-settings');assert(G.confirmNewGame(request).ok);assert.equal(G.world.seed,0);const next=snapshot(G),n=events.length;assert(!G.confirmNewGame(request).ok);unchanged(G,next);assert.equal(events.length,n);
});
test('settings preview suppresses automatic local/server callbacks, while manual saves and post-cancel autosave keep their contract',()=>{
  const {G,events,stored,element,ctx,realAutosave}=fresh();stored.set(G.AUTOSAVE_KEY,'old-auto');let server=0;
  const saveToServer=G.saveToServer;G.saveToServer=()=>{server++;return Promise.resolve();};
  element('new-game-settings').classList.remove('hidden');for(let i=0;i<3;i++)realAutosave();G.saveGame(G.AUTOSAVE_KEY,true);
  ctx.fetch=()=>{throw new Error('preview must never issue server request');};saveToServer('autosave',true);
  assert.equal(server,0);assert.equal(events.length,0);assert.equal(stored.get(G.AUTOSAVE_KEY),'old-auto');
  G.saveGame(G.SAVE_KEY,true);assert(stored.has(G.SAVE_KEY));element('new-game-settings').classList.add('hidden');realAutosave();assert.equal(server,1);assert.notEqual(stored.get(G.AUTOSAVE_KEY),'old-auto');
});
test('hard config and wheat lock round-trip without resetting progressed stocks or other toggles',()=>{
  const {G}=fresh();G.game.res.wood=17;G.game.res.grain=G.game.res.food=321;G.game.farmPests.enabled=true;const d=saved(G);G.applySaveData(d);
  assert.deepEqual(copy(G.game.startConfig),{v:1,preset:'hard',seed:1});assert.equal(G.game.unlocks.wheat,false);assert.equal(G.game.res.wood,17);assert.equal(G.game.res.food,321);assert(G.game.farmPests.enabled);
  d.game.startConfig.preset='classic';assert.equal(G.game.startConfig.preset,'hard');
});
test('malformed new configs and omitted/invalid wheat flags reject atomically',()=>{
  const {G}=fresh(),d=saved(G),before=snapshot(G);
  for(const edit of [d=>d.game.startConfig.v=2,d=>delete d.game.startConfig.v,d=>delete d.game.startConfig.preset,d=>d.game.startConfig.preset='easy',d=>d.game.startConfig.seed=2,d=>d.game.startConfig.seed='1',d=>d.game.startConfig.extra=true,d=>d.game.startConfig=[],d=>delete d.game.unlocks.wheat,d=>d.game.unlocks.wheat=1,d=>delete d.game.unlocks]){
    const bad=copy(d);edit(bad);assert.throws(()=>G.applySaveData(bad));unchanged(G,before);
  }
});
test('legacy missing config stays unknown; old wheat stays unlocked without granting resources or choosing a preset',()=>{
  const {G}=fresh(),d=saved(G);delete d.game.startConfig;delete d.game.unlocks.wheat;G.applySaveData(d);
  assert.equal(G.game.startConfig,null);assert.equal(G.game.unlocks.wheat,true);assert.deepEqual(copy(G.game.res),d.game.res);assert.equal(G.world.citizens.length,13);
  G.applySaveData(saved(G));assert.equal(G.game.startConfig,null);assert.deepEqual(copy(G.game.res),d.game.res);
  delete G.game.unlocks.wheat;assert(G.cropUnlocked('wheat'));assert.match(G.seedTradeReason('wheatSeed',1),/已永久解锁/);
});
test('empty locked wheat farm saves; fake planted, committed, grown or harvested locked crops reject',()=>{
  const {G,farm}=fieldTown(),d=saved(G);G.applySaveData(d);assert.equal(G.game.unlocks.wheat,false);assert.equal(G.farmHasWork(G.world.bmap[farm.id]),false);const before=snapshot(G);
  for(const edit of [b=>b.farm[0][0]=1,b=>b.farm[0][1]=1,b=>b.sownAll=true,b=>b.sowingCommitted=true,b=>b.growth=.1,b=>b.harvestDone=true,b=>b.earlyHarvestYield=1,b=>b.cropChoice='cabbage']){const bad=copy(d);edit(bad.buildings.find(b=>b.id===farm.id));assert.throws(()=>G.applySaveData(bad));unchanged(G,before);}
});
test('another unlocked seed allows its actual crop while wheat stays locked; locked future choices cannot be injected',()=>{
  const {G,farm}=fieldTown();G.game.unlocks.beans=true;assert(G.setFarmCrop(farm,'beans'));assert.equal(farm.cropType,'beans');assert(!G.cropUnlocked('wheat'));assert(G.farmHasWork(farm));
  const d=saved(G);d.buildings.find(b=>b.id===farm.id).cropChoice='wheat';const before=snapshot(G);assert.throws(()=>G.applySaveData(d));unchanged(G,before);
  G.game.season=3;G.resetFarm(farm,false);G.game.season=0;G.resetFarm(farm,true);assert.equal(farm.cropType,'beans');assert(G.farmHasWork(farm));
});
test('locked farm has no work or choice, cannot complete forged sow or harvest, and stays empty through seasons',()=>{
  const {G,c,farm}=fieldTown();assert(!G.cropUnlocked('wheat'));assert(!G.setFarmCrop(farm,'wheat'));assert(!G.farmHasWork(farm));assert(!G.jobCanProduce(farm));G.requestTask(c);assert(c.task?.kind!=='sow');
  c.task={kind:'sow',b:farm,ti:0,crop:'wheat',cropYear:1};G.completeTask(c);assert(!farm.farm[0].sown);
  farm.sownAll=true;farm.growth=1;farm.farm.forEach(f=>f.sown=true);G.game.season=2;const stock=G.game.res.food;c.task={kind:'harvest',b:farm,ti:0,crop:'wheat',cropYear:1};G.completeTask(c);assert.equal(G.game.res.food,stock);assert(!c.carry);assert(!G.earlyHarvestQuote(farm).ok);assert(!G.farmHarvestReady(farm));
  for(const season of [3,0,1,2]){G.game.season=season;G.resetFarm(farm,true);assert(!G.farmHasWork(farm));assert(farm.farm.every(f=>!f.sown));}
  assert.match(G.farmSummary(farm).status,/种子/);
});
test('hard wheat purchase costs 2500 in real station inventory, permanently unlocks, then real sow / harvest / haul produces grain',()=>{
  const {G,c,farm}=fieldTown(),w=G.world;w.water[7*w.N+20]=1;const r=G.addBuilding('tradingpost',20,8,{instant:true,free:true});assert(r.ok,r.reason);const post=r.b;G.ensureEconomyBuilding(post);G.arriveMerchant(post);
  assert.equal(G.TRADE_GOODS.wheatSeed.price,2500);assert(G.MERCHANTS.seeds.goods.includes('wheatSeed'));post.tradeInventory.firewood=625;G.game.res.firewood=123;G.game.res.grain=G.game.res.food=100;const food=G.game.res.food;
  assert(!G.executeTrade(post,'wheatSeed',2,'firewood').ok);assert(G.executeTrade(post,'wheatSeed',1,'firewood',post.merchant).ok);assert.equal(post.tradeInventory.firewood,0);assert.equal(G.game.res.firewood,123);assert.equal(G.game.res.food,food);assert(G.cropUnlocked('wheat'));assert(!G.executeTrade(post,'wheatSeed',1,'firewood').ok);
  G.applySaveData(saved(G));const b=G.world.bmap[farm.id],cc=G.world.cmap[c.id];assert(G.cropUnlocked('wheat'));assert.equal(G.game.startConfig.preset,'hard');G.setWorkerLimit(b,1);cc.job=b.id;b.workers=[cc.id];G.requestTask(cc);
  until(G,cc,()=>b.sownAll);assert(b.farm.every(f=>f.sown));assert.equal(G.game.res.food,food);
  G.game.season=2;b.growth=1;G.requestTask(cc);until(G,cc,()=>G.game.res.grain===food+16*14);assert(b.harvestDone);assert.equal(G.game.res.food,food+224);assert.equal(G.townLedgerSummary().current.totals.grain.produced,224);assert.equal(G.townLedgerSummary().current.totals.grain.received,224);
});
test('seed orders and automatic buying use existing 25-percent premium and permanent unlock path',()=>{
  const {G}=fieldTown();G.world.water[7*G.world.N+20]=1;let b=G.addBuilding('tradingpost',20,8,{instant:true,free:true}).b;G.ensureEconomyBuilding(b);G.arriveMerchant(b);assert(G.orderMerchantGoods(b,'wheatSeed',1,b.merchant).ok);
  b.tradeInventory.firewood=1000;assert(G.setAutoTrade(b,{enabled:true,good:'wheatSeed',qty:1,payment:'firewood',maxPrice:3125},G.game).ok);assert(!G.cropUnlocked('wheat'));
  G.applySaveData(saved(G));b=G.world.bmap[b.id];assert.equal(b.merchantOrders.general.good,'wheatSeed');assert.equal(b.autoTrade.good,'wheatSeed');
  G.game.day=48;G.game.year=2;G.game.season=0;G.game.townLedger=G.newTownLedger(G.game);b.merchant=null;b.merchantVisits=3;G.arriveMerchant(b);
  assert.equal(G.merchantPrice(b,'wheatSeed'),3125);assert.equal(b.tradeInventory.firewood,218);assert.equal(b.autoTradeLast.paid,782);assert(G.cropUnlocked('wheat'));assert.equal(b.merchant.stock.wheatSeed,0);assert(!G.runArrivalAutoTrade(b,b.merchant));assert.equal(b.tradeInventory.firewood,218);
});
if(process.env.BANISH_BASELINE_ROOT)test('actual unmodified baseline save loads preserving stocks, citizens, families, features and unknown preset',()=>{
  const old=load(path.resolve(process.env.BANISH_BASELINE_ROOT)).G;old.newGame(1);
  const classic=load().G;assert(classic.newGame(1).ok);const initial=saved(classic);delete initial.game.startConfig;delete initial.game.unlocks.wheat;initial.game.v=old.VERSION;assert.deepEqual(initial,saved(old),'classic initial serialized state matches actual baseline');
  old.game.res.wood=11;old.game.res.grain=old.game.res.food=237;old.game.res.tools=7;old.game.unlocks.beans=true;old.game.farmPests.enabled=true;const d=saved(old);assert(!Object.hasOwn(d.game,'startConfig'));assert(!Object.hasOwn(d.game.unlocks,'wheat'));
  old.applySaveData(d);const expected=saved(old);
  const {G}=load();G.applySaveData(d);const loaded=saved(G);assert.equal(G.game.startConfig,null);assert(G.cropUnlocked('wheat'));assert.equal(G.game.farmPests.enabled,true);assert.equal(G.game.unlocks.beans,true);
  for(const key of ['res','stats','hist','buildLog','livestock'])assert.deepEqual(loaded.game[key],d.game[key],key);
  for(const key of ['seed','roads','trees','rockCleared','buildings','families','citizens','nextUid'])assert.deepEqual(loaded[key],expected[key],key);
});
console.log('Start settings: '+passed+' passed');
