/* Daily world-vessel state and exact-once economy contracts; no rendering claim. */
'use strict';
const assert=require('node:assert/strict'),path=require('node:path');
const {loadGame}=require('./helpers/playability');
const ROOT=path.resolve(__dirname,'..'),copy=x=>JSON.parse(JSON.stringify(x)),save=G=>copy(G.serializeGame());
let passed=0;function test(name,fn){fn();passed++;console.log('ok '+name);}
function setup(root=ROOT,minX=10){
 const G=loadGame(root);assert(G.newGame(17,{climate:'fair'}).ok);const w=G.world;let b;
 for(let x=minX;x<w.N-5&&!b;x++)for(let y=1;y<w.N-5&&!b;y++){
  const candidate={x,y,w:4,h:4};candidate.tradeBerth=G.chooseTradeBerth(w,candidate);
  if(!G.tradeWaterAccess(w,candidate).ok)continue;
  const result=G.addBuilding('tradingpost',x,y,{instant:true,free:true});if(result.ok)b=result.b;
 }
 assert(b,'real map has a legal connected post');G.setWorkerLimit(b,0);const id=b.id;
 G.applySaveData(save(G));return {G,id};
}
function next(G){G.game.h=0;G.endDay();}
function until(G,fn,limit=60){for(let n=0;n<limit&&!fn();n++)next(G);assert(fn(),'daily lifecycle did not reach target');}
function roundtrip(G){const d=save(G);G.applySaveData(d);const expected=copy(d);for(const b of expected.buildings)if(b.merchant===null)delete b.merchant; // Existing parser omits an empty optional merchant.
 assert.deepEqual(save(G),expected);}
function boats(G,id){return G.world.tradeVoyages.boats.filter(b=>b.postId===id);}
test('new classic v10 saves independently while mountain v8 remains unchanged',()=>{
 const {G}=setup();assert.equal(save(G).v,10);assert.equal(G.world.tradeVoyages.v,1);roundtrip(G);
 assert(G.newGame(17,{terrain:'mountain',climate:'fair'}).ok);assert.equal(save(G).v,8);assert.equal(G.world.tradeVoyages,undefined);
});
test('ingress has no manifest, docking consumes one order and one real auto-purchase, repeated loads never replay',()=>{
 const {G,id}=setup();let b=G.world.bmap[id];b.tradeInventory.stone=1000;b.tradeTargets.stone=1000;
 assert(G.setAutoTrade(b,{...G.defaultAutoTrade(),enabled:true,maxPrice:8},G.game).ok);b.merchantOrders.general={good:'coal',qty:20};
 until(G,()=>boats(G,id).some(x=>x.phase==='ingress'));
 assert.equal(b.merchant,undefined);assert.equal(b.merchantVisits,0);assert.equal(b.tradeInventory.stone,1000);assert(b.merchantOrders.general);roundtrip(G);b=G.world.bmap[id];
 assert.equal(G.arriveMerchant(b),false);until(G,()=>G.world.bmap[id].merchant);b=G.world.bmap[id];
 assert.equal(b.merchantVisits,1);assert.equal(b.merchant.stock.coal,10);assert.equal(b.tradeInventory.coal,10);assert(b.tradeInventory.stone<1000);assert.equal(b.merchantOrders.general,undefined);assert.equal(b.merchant.autoTradeDone,true);
 assert.equal(b.nextMerchantDay,b.merchant.arrivedDay+16);assert.equal(b.merchant.leaveDay,b.merchant.arrivedDay+12);
 const stock=JSON.stringify(b.tradeInventory),receipt=JSON.stringify(b.autoTradeLast);
 for(let i=0;i<3;i++){roundtrip(G);b=G.world.bmap[id];G.advanceTradeVoyages();G.advanceTownEconomy();assert.equal(G.arriveMerchant(b,boats(G,id)[0]),false);assert.equal(JSON.stringify(b.tradeInventory),stock);assert.equal(JSON.stringify(b.autoTradeLast),receipt);assert.equal(b.merchantVisits,1);}
});
test('docked vessel leaves at 12 days, follows exit rather than entry, and disappears once outside',()=>{
 const {G,id}=setup();until(G,()=>G.world.bmap[id].merchant);const b=G.world.bmap[id],shipId=b.merchant.boatId,leave=b.merchant.leaveDay;
 while(G.game.day<leave-1)next(G);assert(G.currentMerchant(b));next(G);assert.equal(G.currentMerchant(b),false);
 let boat=G.world.tradeVoyages.boats.find(x=>x.id===shipId);assert(boat);assert.equal(boat.phase,'egress');assert.equal(boat.route.at(-1),G.world.waterNavigation.exit);roundtrip(G);
 until(G,()=>!G.world.tradeVoyages.boats.some(x=>x.id===shipId));assert(!G.world.tradeVoyages.boats.some(x=>x.id===shipId));
});
test('season autosave observes committed arrival and cannot combine pre-payment with post-arrival goods',()=>{
 const {G,id}=setup();const b=G.world.bmap[id];b.tradeInventory.stone=1000;b.tradeTargets.stone=1000;assert(G.setAutoTrade(b,{...G.defaultAutoTrade(),enabled:true,maxPrice:8},G.game).ok);
 let boundary;G.autosave=()=>{if(G.game.day===12)boundary=save(G);};while(G.game.day<12)next(G);
 assert(boundary);const saved=boundary.buildings.find(x=>x.id===id);assert(saved.merchant);assert.equal(saved.merchant.arrivedDay,12);assert.equal(saved.merchant.autoTradeDone,true);assert.equal(saved.tradeInventory.coal,10);
 G.applySaveData(boundary);roundtrip(G);assert.equal(G.world.bmap[id].tradeInventory.coal,10);assert.equal(G.world.bmap[id].merchantVisits,1);
});
for(const phase of ['ingress','docked'])test(`demolishing ${phase} station leaves an independent egress vessel, without arrival replay`,()=>{
 const {G,id}=setup();until(G,()=>boats(G,id).some(x=>x.phase===phase));const boat=boats(G,id).find(x=>x.phase===phase),shipId=boat.id,b=G.world.bmap[id],visits=b.merchantVisits;
 assert(G.removeBuilding(b));assert.equal(G.world.bmap[id],undefined);const leaving=G.world.tradeVoyages.boats.find(x=>x.id===shipId);assert(leaving);assert.equal(leaving.phase,'egress');roundtrip(G);
 until(G,()=>!G.world.tradeVoyages.boats.some(x=>x.id===shipId));assert.equal(b.merchantVisits,visits);assert.equal(G.world.bmap[id],undefined);
});
test('malformed voyage or uncommitted arrival rejects atomically without spending',()=>{
 const {G,id}=setup();until(G,()=>boats(G,id).some(x=>x.phase==='ingress'));roundtrip(G);const good=save(G),w=G.world,g=G.game;
 const edits=[d=>delete d.tradeVoyages,d=>d.v=9,d=>d.tradeVoyages.lastDay--,d=>d.tradeVoyages.boats.push(copy(d.tradeVoyages.boats[0])),d=>d.tradeVoyages.boats[0].route[0]++,d=>d.tradeVoyages.boats[0].step=d.tradeVoyages.boats[0].route.length-1,d=>d.tradeVoyages.boats[0].postId=99999];
 for(const edit of edits){const d=copy(good);edit(d);assert.throws(()=>G.applySaveData(d));assert.equal(G.world,w);assert.equal(G.game,g);assert.deepEqual(save(G),good);}
});
test('long initial voyage delays docking and rejects impossible same-day launched docked saves',()=>{
 const {G,id}=setup(ROOT,100),b=G.world.bmap[id];b.nextMerchantDay=1;next(G);
 const ship=boats(G,id)[0];assert(ship);assert.equal(ship.phase,'ingress');assert.equal(b.merchant,undefined);assert(ship.route.length>17);
 const earliest=ship.launchDay+Math.ceil((ship.route.length-1)/G.TRADE_VOYAGE.edgesPerDay);
 while(G.game.day<earliest-1){next(G);assert.equal(G.world.bmap[id].merchant,undefined);roundtrip(G);}
 next(G);assert.equal(G.world.bmap[id].merchant.arrivedDay,earliest);assert(earliest>ship.targetDay);roundtrip(G);
 const good=save(G),bad=copy(good);bad.tradeVoyages.boats.find(x=>x.phase==='docked').launchDay=earliest;
 assert.throws(()=>G.applySaveData(bad));assert.deepEqual(save(G),good);
});
if(process.env.BANISH_VOYAGE_BASELINE_ROOT)test('actual v9 world retains its existing merchant and never acquires vessel rules on reload',()=>{
 const {G:old,id}=setup(path.resolve(process.env.BANISH_VOYAGE_BASELINE_ROOT));const b=old.world.bmap[id];b.tradeInventory.stone=1000;b.tradeTargets.stone=1000;assert(old.setAutoTrade(b,{...old.defaultAutoTrade(),enabled:true},old.game).ok);old.arriveMerchant(b);assert(b.merchant);assert.equal(b.tradeInventory.coal,10);b.merchantOrders.general={good:'coal',qty:10};old.applySaveData(save(old));const d=save(old);assert.equal(d.v,9);
 const G=loadGame(ROOT);G.applySaveData(d);assert.deepEqual(save(G),d);assert.equal(G.world.tradeVoyages,undefined);assert.equal(G.world.bmap[id].tradeInventory.coal,10);assert.deepEqual(copy(G.world.bmap[id].merchantOrders),copy(old.world.bmap[id].merchantOrders));next(G);assert.equal(save(G).v,9);assert.equal(G.world.tradeVoyages,undefined);assert.equal(G.world.bmap[id].tradeInventory.coal,10);assert.equal(G.world.bmap[id].merchantVisits,1);
});else console.log('SKIP actual v9 compatibility: set BANISH_VOYAGE_BASELINE_ROOT');
console.log(`Trade vessel lifecycle: ${passed} passed (no visual acceptance)`);
