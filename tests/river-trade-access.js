/* v9 river eligibility contracts. No moving-vessel or browser claim. */
'use strict';
const assert=require('node:assert/strict'),path=require('node:path');
const {loadGame}=require('./helpers/playability');
const ROOT=path.resolve(__dirname,'..'),copy=x=>JSON.parse(JSON.stringify(x));
let passed=0;function test(name,fn){fn();passed++;console.log('ok '+name);}
function village(options={}){const G=loadGame(ROOT);assert(G.newGame(17,{climate:'fair',...options}).ok);return G;}
for(const terrain of ['classic','mountain'])for(const mapSize of [128,192])test(`${terrain}/${mapSize} selects the correct save and preserves orchard/heating rules`,()=>{
 const G=village({terrain,mapSize});G.applySaveData(copy(G.serializeGame()));const d=copy(G.serializeGame()),river=terrain==='classic';
 assert.equal(d.v,river?10:8);assert.equal(d.mapVersion,river?4:2);
 assert.equal(!!d.waterNavigation,river);assert.equal(d.game.orchardHarvestRules.v,1);assert.equal(d.game.orchardRules.v,1);assert.equal(d.game.heatRules.v,1);
 const q=G.startConfigQuote({seed:17,climate:'fair',terrain,mapSize});assert(q.climateSummary.note.includes(river?'v10':'v8'));
 G.applySaveData(d);assert.deepEqual(copy(G.serializeGame()),d);
 if(river){const nav=G.world.waterNavigation,net=G.mainRiverNetwork(G.world);assert(net.parent[nav.exit]>=0);for(const i of G.mainRiverCells(G.world,nav))assert.equal(G.world.water[i],1);}
});
test('v9 rejects missing, sparse, forged or downgraded water identity atomically',()=>{
 const G=village(),good=copy(G.serializeGame()),world=G.world,game=G.game;
 const edits=[d=>delete d.waterNavigation,d=>d.v=8,d=>d.mapVersion=3,d=>d.waterNavigation.v=2,d=>d.waterNavigation.entry++,d=>delete d.waterNavigation.mainRiver[1],d=>d.waterNavigation.mainRiver[1]++,d=>d.waterNavigation.extra=true];
 for(const edit of edits){const bad=copy(good);edit(bad);assert.throws(()=>G.applySaveData(bad));assert.equal(G.world,world);assert.equal(G.game,game);assert.deepEqual(copy(G.serializeGame()),good);}
});
function post(G,x,y){const b={id:G.nextId(),type:'tradingpost',state:'ok',x,y,w:4,h:4};G.ensureEconomyBuilding(b);G.world.buildings.push(b);G.world.bmap[b.id]=b;return b;}
test('isolated lake and invalid berth reject arrival before RNG, orders, stock or automatic purchase',()=>{
 const G=village(),w=G.world;w.water=new Uint8Array(w.N*w.N);G.waterNetworkCache.delete(w);
 // Preserve a separate main channel; add only an isolated one-cell lake beside the post.
 for(const i of G.mainRiverCells(w,w.waterNavigation))w.water[i]=1;
 const b=post(G,2,2),lake=2*w.N+1;w.water[lake]=1;b.tradeBerth=lake;b.merchantVisits=1;
 const merchantId=G.MERCHANT_CYCLE[1],good=G.MERCHANTS[merchantId].goods[0];b.merchantOrders={[merchantId]:{good,qty:5}};b.tradeInventory={firewood:100};
 let rng=0,auto=0;G.rng=()=>{rng++;return .5;};G.runArrivalAutoTrade=()=>{auto++;return false;};
 const before=JSON.stringify({b,res:G.game.res});
 assert.equal(G.tradeWaterAccess(w,b).ok,false);assert.equal(G.arriveMerchant(b),false);
 assert.equal(JSON.stringify({b,res:G.game.res}),before);assert.equal(rng,0);assert.equal(auto,0);
 b.tradeBerth=-1;assert.equal(G.arriveMerchant(b),false);assert.equal(rng,0);assert.equal(auto,0);
});
test('legacy v9 connected berth has an entry route and commits just one arrival',()=>{
 const G=village(),w=G.world,cell=w.waterNavigation.mainRiver[Math.floor(w.waterNavigation.mainRiver.length/2)],x=cell%w.N,y=Math.floor(cell/w.N);
 delete w.tradeVoyages; // Explicit old v9 arrival contract.
 const b=post(G,x,y+3);b.tradeBerth=G.chooseTradeBerth(w,b);assert(G.tradeWaterAccess(w,b).ok);
 const route=G.tradeWaterRoute(w,b);assert.equal(route[0],w.waterNavigation.entry);assert.equal(route.at(-1),b.tradeBerth);
 for(let i=1;i<route.length;i++){assert.equal(w.water[route[i]],1);const a=route[i-1],z=route[i];assert.equal(Math.abs(a%w.N-z%w.N)+Math.abs(Math.floor(a/w.N)-Math.floor(z/w.N)),1);}
 let auto=0;G.runArrivalAutoTrade=()=>{auto++;return false;};G.arriveMerchant(b);assert(b.merchant);assert.equal(b.merchantVisits,1);assert.equal(auto,1);
 const before=JSON.stringify(b);assert.equal(G.arriveMerchant(b),false);assert.equal(JSON.stringify(b),before);assert.equal(auto,1);
});
if(process.env.BANISH_RIVER_BASELINE_ROOT)for(const terrain of ['classic','mountain'])for(const mapSize of [128,192])test(`actual pre-river v8 ${terrain}/${mapSize} does not gain river rules on load/save`,()=>{
 const old=loadGame(path.resolve(process.env.BANISH_RIVER_BASELINE_ROOT));assert(old.newGame(17,{terrain,mapSize,climate:'fair'}).ok);old.applySaveData(copy(old.serializeGame()));const d=copy(old.serializeGame());assert.equal(d.v,8);assert.equal(d.waterNavigation,undefined);
 const G=loadGame(ROOT);G.applySaveData(d);assert.deepEqual(copy(G.serializeGame()),d);assert.equal(G.world.waterNavigation,undefined);assert.equal(G.tradeWaterAccess(G.world,{}).legacy,true);
});else console.log('SKIP actual v8 engine round trips: set BANISH_RIVER_BASELINE_ROOT');
console.log(`River trade access: ${passed} passed (no moving boat or visual acceptance)`);
