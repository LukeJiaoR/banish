'use strict';
/* Focused mountain terrain/start/save contract. Headless simulation, not browser QA. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const {loadGame}=require('./helpers/playability');
const ROOT=path.resolve(__dirname,'..'),copy=x=>JSON.parse(JSON.stringify(x));
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const terrainHash=w=>hash([Array.from(w.water),Array.from(w.rock),w.start]);
let passed=0;function test(name,fn){fn();passed++;console.log('ok '+name);}
function fresh(preset='hard',seed=1){const G=loadGame(ROOT);G.deleteServerSaveQuiet=()=>{};assert(G.newGame(seed,{preset,terrain:'mountain'}).ok);return G;}
const save=G=>copy(G.serializeGame());
const snap=G=>({w:G.world,g:G.game,rng:G.rng,id:G._peekUid(),blocked:G.autosaveBlocked,data:JSON.stringify(G.serializeGame())});
function unchanged(G,s){assert.equal(G.world,s.w);assert.equal(G.game,s.g);assert.equal(G.rng,s.rng);assert.equal(G._peekUid(),s.id);assert.equal(G.autosaveBlocked,s.blocked);assert.equal(JSON.stringify(G.serializeGame()),s.data);}
const at=(w,x,y)=>y*w.N+x;
function fixture(name){return JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures','mountain-'+name+'.json'),'utf8'));}
function until(G,c,done,limit=5000){for(let i=0;i<limit&&!done();i++)G.stepCitizen(c,.1);assert(done(),'actual citizen action did not finish');}
function openWorld(G){const w=G.emptyWorld(1,2);G.world=w;G.game=G.newGameState({v:2,preset:'hard',seed:1,terrain:'mountain'});G.game.h=12;return w;}

test('explicit terrain config owns its version, classic canonical v1 remains unchanged',()=>{
 const G=fresh();assert.deepEqual(copy(G.startConfigQuote({seed:0,preset:'hard',terrain:'classic'}).config),{v:1,preset:'hard',seed:0});
 assert.deepEqual(copy(G.startConfigQuote({seed:0,preset:'hard',terrain:'mountain'}).config),{v:2,preset:'hard',seed:0,terrain:'mountain'});
 for(const input of [{terrain:'volcano'},{terrain:1},{terrain:null},{v:1,terrain:'mountain'},{v:2},{v:2,terrain:'classic'},{v:3,terrain:'mountain'}])assert(!G.startConfigQuote({seed:0,preset:'hard',...input}).ok);
 assert.throws(()=>G.genWorld(1,{terrain:'mountain',mapVersion:1}));assert.throws(()=>G.genWorld(1,{mapVersion:2}));assert.throws(()=>G.genWorld(1,{mapVersion:0,starterResources:true}));
 assert.equal(G.genWorld(1,{mapVersion:0}).mapVersion,0);assert.equal(G.genWorld(1,{mapVersion:1}).mapVersion,1);
 assert(G.newGame(1).ok);assert.equal(G.game.startConfig.v,1);assert.equal(G.serializeGame().v,1);assert.equal(G.world.mountain.reduce((a,b)=>a+b,0),0);
});

test('both presets and fixed/boundary seeds repeat whole initial snapshots without ambient RNG',()=>{
 const G=fresh();let oldCalls=0;G.rng=()=>{oldCalls++;throw Error('old town RNG');};
 for(const preset of ['classic','hard'])for(const seed of [0,1,7,42,999,-1,-2147483648,4294967295]){
  const candidate=G.prepareNewGame({preset,seed,terrain:'mountain'});assert.equal(oldCalls,0);assert(candidate.world.startReport.ok);
  assert(G.newGame(seed,{preset,terrain:'mountain'}).ok);const before=save(G),w=G.world,r=w.startReport;
  assert.equal(w.seed,seed);assert.equal(w.buildings.length,1);assert.equal(w.buildings[0].type,'storage');assert(w.families.every(f=>f.houseId===null));
  assert.equal(w.citizens.length,preset==='hard'?13:15);assert.equal(r.housingPlots,5);assert.equal(r.warehouseDoors,16);assert(r.mountainTiles>1000);
  const stocks=G.START_PRESETS[preset].stocks;for(const key of G.RES_KEYS)if(key!=='food')assert.equal(G.game.res[key],stocks[key]||0);
  for(const key of ['wood','stone','iron'])assert(r.resources[key]>=r.budget.required[key]);assert(r.retainedMature>=G.PROD.gatherer.fullForest);assert(r.shoreTiles>0);
  for(let i=0;i<w.N*w.N;i++)if(w.mountain[i])assert(!w.water[i]&&!w.rock[i]&&w.treeIdx[i]<0&&w.bgrid[i]<0&&!w.road[i]);
  G.newGame(13,{preset:preset==='hard'?'classic':'hard'});G.setUid(40000);
  assert(G.newGame(seed,{preset,terrain:'mountain'}).ok);assert.deepEqual(save(G),before);
 }
});

test('gross startup budget derives actual uneducated build, annual fuel and refill costs',()=>{
 const G=fresh(),b=G.mountainStartBudget('hard');assert.deepEqual(copy(b.gross),{wood:462,stone:184,iron:25});
 assert.deepEqual(copy(G.mountainStartBudget('classic').required),{wood:382,stone:136,iron:25});
 const previous=G.BDEF.house.cost.wood;G.BDEF.house.cost.wood++;assert.equal(G.mountainStartBudget('hard').gross.wood,b.gross.wood+5);G.BDEF.house.cost.wood=previous;
});

test('real warehouse in a one-cell neck invalidates the start after placement',()=>{
 const G=fresh('classic'),w=G.world,s=w.start,c=w.citizens[0],x=Math.round(c.x),y=Math.round(c.y);
 for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)if((dx||dy)&&!(dx===-1&&dy===0))w.mountain[at(w,x+dx,y+dy)]=1;
 const emptyCart={...w,bgrid:w.bgrid.slice(),bmap:{},buildings:[]};emptyCart.bgrid.fill(-1);
 assert(G.findPath(emptyCart,x,y,s.x-2,s.y));assert.equal(G.findPath(w,x,y,s.x-2,s.y),null);
 assert.equal(G.mountainStartReport(w,'classic').ok,false);
});

test('same-radius resources behind mountain, iron-only stone supply, lost plots, grove competition and shore loss fail proof',()=>{
 {const G=fresh(),w=G.world;w.rock.fill(0);for(let y=2;y<=10;y++)for(let x=2;x<=10;x++)w.mountain[at(w,x,y)]=x===2||x===10||y===2||y===10?1:0;
  for(let y=3;y<10;y++)for(let x=3;x<10;x++)w.rock[at(w,x,y)]=(x+y)%2?1:2;assert(!G.mountainStartReport(w,'hard').ok);}
 {const G=fresh(),w=G.world;for(let i=0;i<w.rock.length;i++)if(w.rock[i])w.rock[i]=2;assert.match(G.mountainStartReport(w,'hard').reason,/石/);}
 {const G=fresh(),w=G.world,p=w.startReport.plots[0];w.mountain[at(w,p.x,p.y)]=1;assert(!G.mountainStartReport(w,'hard').ok);}
 {const G=fresh(),w=G.world,p=w.startReport.plots.find(p=>p.type==='gatherer'),R=G.PROD.gatherer.radius;
  for(const t of [...w.trees])if(Math.abs(t.x-p.x)>R||Math.abs(t.y-p.y)>R)G.removeTree(w,t.x,t.y);
  assert.match(G.mountainStartReport(w,'hard').reason,/原木|木材|木/);}
 {const G=fresh();G.world.water.fill(0);assert(!G.mountainStartReport(G.world,'hard').ok);}
});

test('failed generation or actual-start proof rolls back village, stock, RNG, IDs, UI and saves',()=>{
 for(const phase of ['generation','proof']){const G=fresh(),before=snap(G);let effects=0;G.ui.toast=()=>effects++;G.deleteServerSaveQuiet=()=>effects++;
  if(phase==='generation')G.genMountainWorld=()=>{G.rng();G.nextId();throw Error('no valid valley');};else G.mountainStartReport=()=>({ok:false,reason:'no connected birth positions'});
  const r=G.newGame(42,{preset:'classic',terrain:'mountain'});assert(!r.ok);unchanged(G,before);assert.equal(effects,0);
 }
});

test('all ordinary footprints, roads and both bridge banks reject mountain without terrain removal',()=>{
 const G=fresh(),w=openWorld(G),x=20,y=20,i=at(w,x,y);w.mountain[i]=1;
 for(const [type,d]of Object.entries(G.BDEF))if(!d.unbuildable&&type!=='bridge')assert(!G.canPlace(w,type,x,y).ok,type);
 assert(!G.canPlace(w,'farm',x,y,[4,4]).ok);assert(!G.canPlace(w,'pasture',x,y,[7,7]).ok);assert(!G.canPlace(w,'orchard',x,y,[4,4]).ok);assert(!G.canPlace(w,'cemetery',x,y,[7,7]).ok);
 assert(!G.canPlaceRoad(w,x,y));G.setRoad(w,x,y,1);assert.equal(w.road[i],0);assert(!G.planRoad(w,{x,y},{x:x+3,y}).ok);
 for(let xx=x+1;xx<x+4;xx++)w.water[at(w,xx,y)]=1;
 assert(!G.bridgeStartStatus(w,{x,y}).ok);assert(!G.planBridge(w,{x,y},{x:x+4,y}).ok);assert(!G.planBridge(w,{x:x+4,y},{x,y}).ok);
 const stock=copy(G.game.res);G.markRockAt(w,x,y);assert.equal(w.markedRocks.size,0);assert.equal(G.clearRock(w,x,y),false);assert.equal(w.mountain[i],1);assert.deepEqual(copy(G.game.res),stock);
});

test('tree birth, forester plant choices and wildlife habitat exclude mountain',()=>{
 const G=fresh(),w=openWorld(G);w.mountain.fill(1);w.mountain[at(w,20,20)]=0;w.mountain[at(w,22,20)]=0;
 G.addTree(w,21,20,-200);assert.equal(w.trees.length,0);G.addTree(w,20,20,-200);
 assert(!G.deerHabitat(w,21,20));assert(G.deerHabitat(w,22,20));assert.deepEqual(copy(G.nearestPlantSpot(w,20,20,3)),{x:22,y:20});
 assert.equal(G.areaLand(w,21,20,1,1),false);
});

test('path planner and actual walkers obey mountain detours and no-corner crossing',()=>{
 const G=fresh(),w=openWorld(G);for(let y=0;y<w.N;y++)w.mountain[at(w,12,y)]=1;w.mountain[at(w,12,14)]=0;
 const p=G.findPath(w,8,8,16,8);assert(p&&p.some(t=>t.x===12&&t.y===14));
 assert.equal(G.findPath(w,12,8,16,8),null);w.mountain[at(w,12,14)]=1;assert.equal(G.findPath(w,8,8,16,8),null);
 w.mountain.fill(1);for(const [x,y]of [[8,8],[9,9]])w.mountain[at(w,x,y)]=0;assert.equal(G.findPath(w,8,8,9,9),null);assert(G.pathStepBlocked(w,{x:8,y:8},{x:9,y:9}));
});

test('real mineral cargo waits behind a ridge and arrives only after physically walking around it',()=>{
 const G=fresh(),w=openWorld(G);assert(G.addBuilding('storage',2,2,{instant:true,free:true}).ok);
 for(let y=0;y<w.N;y++)w.mountain[at(w,8,y)]=1;
 const c=G.spawnCitizen({x:12,y:5,age:30,sex:'m'});c.carry={type:'iron',qty:10};G.startMineralHaul(c);
 assert.equal(G.game.res.iron,0);assert.equal(c.state,'waitStorage');for(let i=0;i<30;i++)G.stepCitizen(c,.1);assert.equal(c.carry.qty,10);assert.equal(G.game.res.iron,0);
 w.mountain[at(w,8,12)]=0;G.bumpNavigation(w);G.startMineralHaul(c);assert(c.path.some(p=>p.x===8&&p.y===12));
 until(G,c,()=>!c.carry);assert.equal(G.game.res.iron,10);assert(G.atStorageDoor(c,'iron'));assert(!G.isMountain(w,Math.round(c.x),Math.round(c.y)));
});

test('hard-start minerals produce no stock until actual extraction and hauling',()=>{
 const G=fresh(),w=G.world;G.game.h=12;const c=w.citizens[0];
 const i=Array.from(w.rock).map((v,i)=>({v,i})).filter(p=>p.v===1&&!G.tileBlocked(w,p.i%w.N,Math.floor(p.i/w.N))).sort((a,b)=>G.d2(a.i%w.N,Math.floor(a.i/w.N),c.x,c.y)-G.d2(b.i%w.N,Math.floor(b.i/w.N),c.x,c.y))[0].i;
 G.markRockAt(w,i%w.N,Math.floor(i/w.N));G.requestTask(c);assert(c.task);assert.equal(G.game.res.stone,0);
 until(G,c,()=>!!c.carry);assert.equal(w.rock[i],0);assert.equal(c.carry.type,'stone');assert.equal(G.game.res.stone,0);
 until(G,c,()=>!c.carry);assert.equal(G.game.res.stone,G.ROCK_STONE);assert(G.atStorageDoor(c,'stone'));
});

test('road confirmation rechecks the mountain mask after preview',()=>{
 const G=fresh(),w=openWorld(G);G.tool={kind:'road',surface:'dirt'};G.selectRoadEndpoint(4,4);G.selectRoadEndpoint(9,4);assert(G.roadPlan.result.ok);
 w.mountain[at(w,6,4)]=1;const before=copy(G.game.res);assert(!G.roadPlanStatus().ok);assert(!G.confirmRoadPlan().ok);assert.equal(w.road.reduce((a,b)=>a+b,0),0);assert.deepEqual(copy(G.game.res),before);
});

test('authoritative save restores evolved terrain directly, never regenerates or rechecks startup budgets',()=>{
 const G=fresh(),w=G.world,r=w.startReport,p=r.plots[0],rock=Array.from(w.rock).findIndex(v=>v===1);
 G.clearRock(w,rock%w.N,Math.floor(rock/w.N));assert(G.addBuilding('house',p.x,p.y,{free:true,instant:true}).ok);
 const hut=r.plots.find(p=>p.type==='gatherer');for(const t of [...w.trees])if(Math.abs(t.x-hut.x)<=6&&Math.abs(t.y-hut.y)<=6)G.removeTree(w,t.x,t.y);
 G.game.res.wood=17;G.game.res.iron=3;G.game.day=100;G.game.year=3;G.game.townLedger=G.newTownLedger(G.game);const original=save(G),terrain=terrainHash(w),mountain=hash(Array.from(w.mountain));
 assert.equal(original.v,2);assert.equal(original.mapVersion,2);assert(JSON.stringify(original).length<250000);
 G.genWorld=()=>{throw Error('must not generate a mature world');};G.mountainStartReport=()=>{throw Error('must not revalidate a mature start');};
 for(let j=0;j<4;j++){G.applySaveData(copy(j?save(G):original));assert.equal(terrainHash(G.world),terrain);assert.equal(hash(Array.from(G.world.mountain)),mountain);assert.equal(G.game.res.wood,17);assert.equal(G.game.res.iron,3);assert.equal(G.world.rock[rock],0);assert(G.world.rockCleared.includes(rock));assert.equal(G.world.buildings.length,2);assert.equal(G.game.startConfig.terrain,'mountain');}
 original.terrain.mountain.fill(0);assert.notEqual(hash(Array.from(G.world.mountain)),hash(original.terrain.mountain));
});

test('genuine .73 and pre-iron .3.2 fixtures retain terrain and remain root v1 over repeated round trips',()=>{
 for(const name of ['v0.3.73','pre-iron-v0.3.2']){const f=fixture(name),G=fresh();G.applySaveData(copy(f.save));
  assert.equal(terrainHash(G.world),f.provenance.terrainSha256,name);const first=save(G);
  for(let i=0;i<3;i++){G.applySaveData(save(G));assert.equal(terrainHash(G.world),f.provenance.terrainSha256);const d=save(G);assert.equal(d.v,1);assert.equal(d.mapVersion,name==='v0.3.73'?1:0);assert.equal(d.terrain,undefined);assert.equal(G.world.mountain.reduce((a,b)=>a+b,0),0);assert.deepEqual(d.buildings,first.buildings);assert.deepEqual(d.citizens,first.citizens);assert.deepEqual(d.game.res,first.game.res);}
 }
});

test('frozen actual .73 root-version gate rejects mountain v2 even with no tunnels',()=>{
 const G=fresh(),d=save(G),f=fixture('v0.3.73');assert(!d.buildings.some(b=>b.type==='tunnel'));
 const oldGate=new Function('d','bad',f.provenance.rootVersionGate);assert.throws(()=>oldGate(d,x=>{throw Error(x);}),/版本不受支持/);assert.doesNotThrow(()=>oldGate(f.save,x=>{throw Error(x);}));
});

test('malicious v2 terrain shapes, missing fields, markers, values and root mismatches reject atomically',()=>{
 const G=fresh(),good=save(G),before=snap(G),mutations=[
  d=>delete d.terrain,d=>d.terrain=[],d=>d.terrain.extra=1,d=>delete d.terrain.water,d=>d.terrain.water.pop(),d=>d.terrain.rock={},d=>d.terrain.mountain.push(0),
  d=>d.terrain.mountain[0]=2,d=>d.terrain.mountain[0]=true,d=>d.terrain.mountain[0]='1',d=>d.terrain.water[0]=-1,d=>d.terrain.rock[0]=.5,d=>d.terrain.rock[0]=NaN,
  d=>d.terrain.start.x=128,d=>d.terrain.start.y='4',d=>d.terrain.start.z=0,d=>d.N=127,d=>delete d.N,d=>d.mapVersion=1,d=>delete d.mapVersion,d=>d.v=3,d=>d.v=1,
  d=>delete d.game.startConfig,d=>d.game.startConfig.v=1,d=>d.game.startConfig.terrain='classic',d=>delete d.game.startConfig.terrain,d=>d.game.startConfig.seed++,d=>delete d.rockCleared
 ];
 for(const mutate of mutations){const d=copy(good);mutate(d);assert.throws(()=>G.applySaveData(d));unchanged(G,before);}
 for(const mapVersion of [2,3,'1',true,null]){const d=fixture('v0.3.73').save;d.mapVersion=mapVersion;assert.throws(()=>G.applySaveData(d));unchanged(G,before);}
});

test('v2 rejects terrain/entity overlap without nearest-tile relocation or cleared-rock rewriting',()=>{
 const G=fresh(),good=save(G),before=snap(G),w=G.world,m=good.terrain.mountain.findIndex(v=>v===1),tree=good.trees[0][0],b=good.buildings[0],c=good.citizens[0],deer=good.deer.find(d=>d.returnDay===null),rock=good.terrain.rock.findIndex(v=>v===1);
 const mutations=[d=>d.terrain.water[m]=1,d=>d.terrain.rock[m]=1,d=>d.terrain.mountain[tree]=1,d=>d.terrain.mountain[b.y*w.N+b.x]=1,
  d=>d.citizens[0].x=m%w.N,d=>{d.citizens[0].x=m%w.N;d.citizens[0].y=Math.floor(m/w.N);},d=>d.terrain.mountain[Math.round(c.y)*w.N+Math.round(c.x)]=1,
  d=>d.roads.push(m),d=>d.marked.push(m),d=>d.markedRocks.push(m),d=>d.rockCleared.push(m),d=>d.rockCleared.push(rock),d=>d.terrain.water[tree]=1,d=>d.trees[0][0]++,
  d=>{d.terrain.mountain[deer.y*w.N+deer.x]=1;},d=>{Object.assign(d.deer[0],{returnDay:1,x:m%w.N,y:Math.floor(m/w.N),homeX:m%w.N,homeY:Math.floor(m/w.N)});},d=>{d.terrain.rock[tree]=1;},d=>{d.stoneRoads.push(at(w,w.start.x+2,w.start.y));}
 ];
 // The first coordinate-only change is not guaranteed to land on a mountain.
 mutations.splice(4,1);
 for(const mutate of mutations){const d=copy(good);mutate(d);assert.throws(()=>G.applySaveData(d));unchanged(G,before);}
});

test('real homeless camps and recovered cargo on walkable rock retain finite goods in v2',()=>{
 const G=fresh(),w=G.world,c=w.citizens[0],rock=Array.from(w.rock).findIndex(v=>v===1);c.x=rock%w.N;c.y=Math.floor(rock/w.N);
 G.game.supplyMode='physical';G.game.supplyStartedDay=G.game.day;const f=G.familyOf(c),camp=G.supplyFamilyTarget(f,true);assert.equal(camp.x,c.x);
 c.carry={type:'grain',qty:7,staffingReturn:true,supplyBatch:{kind:'return',to:null}};G.recoverCitizenSupply(c);assert.equal(c.carry,null);assert.equal(w.supplyCaches[0].supplyStock.grain,7);
 const d=save(G);G.applySaveData(d);assert.equal(G.world.supplyCaches[0].supplyStock.grain,7);assert.equal(G.world.families.find(a=>a.id===f.id).supplyCamp.x,rock%w.N);
});

test('seedless food grove still produces and physically delivers after harvestable timber is removed',()=>{
 const G=fresh('classic'),w=G.world,p=w.startReport.plots.find(p=>p.type==='gatherer');G.game.h=12;G.game.res.grain=G.game.res.food=100;
 const b=G.addBuilding('gatherer',p.x,p.y).b;assert(b);const c=w.citizens.find(c=>c.job===b.id);assert(c);
 until(G,c,()=>b.state==='ok',10000);assert(b.construction.consumed);assert.equal(G.game.res.wood,50);assert.equal(G.game.res.stone,36);
 for(const t of [...w.trees])if(Math.abs(t.x-p.x)>G.PROD.gatherer.radius||Math.abs(t.y-p.y)>G.PROD.gatherer.radius)G.removeTree(w,t.x,t.y);
 assert(G.treesInRadius(w,p.x,p.y,G.PROD.gatherer.radius,true).length>=G.PROD.gatherer.fullForest);G.scheduleJobs();
 const gatherer=w.citizens.find(c=>c.job===b.id);assert(gatherer);until(G,gatherer,()=>gatherer.carry?.type==='vegetables',10000);const quantity=gatherer.carry.qty;assert.equal(G.game.res.vegetables,0);
 until(G,gatherer,()=>!gatherer.carry);assert.equal(G.game.res.vegetables,quantity);assert(G.atStorageDoor(gatherer,'vegetables'));
});

test('mountain placement cannot evict through a ridge, and sealed homes cannot spawn trapped children',()=>{
 {const G=fresh(),w=openWorld(G);w.mountain.fill(1);for(let y=20;y<22;y++)for(let x=20;x<22;x++)w.mountain[at(w,x,y)]=0;
  w.mountain[at(w,23,20)]=0;const c=G.spawnCitizen({x:20,y:20,age:30,sex:'m'}),uid=G._peekUid(),stock=copy(G.game.res);
  const r=G.addBuilding('house',20,20,{instant:true,free:true});assert(!r.ok);assert.equal(w.buildings.length,0);assert.equal(c.x,20);assert.equal(G._peekUid(),uid);assert.deepEqual(copy(G.game.res),stock);
  w.mountain[at(w,19,20)]=0;assert(G.addBuilding('house',20,20,{instant:true,free:true}).ok);assert.equal(c.x,19);assert.equal(c.y,20);
 }
 {const G=fresh(),w=openWorld(G);w.mountain.fill(1);for(let y=20;y<24;y++)for(let x=20;x<24;x++)w.mountain[at(w,x,y)]=0;
  const c=G.spawnCitizen({x:20,y:20,age:30,sex:'m'});assert(G.addBuilding('farm',20,20,{farmSize:[4,4],instant:true,free:true}).ok);assert.equal(c.x,20);assert.equal(c.y,20);assert(!G.tileBlocked(w,20,20));
 }
 {const G=fresh(),w=G.world,p=w.startReport.plots[0];const house=G.addBuilding('house',p.x,p.y,{instant:true,free:true}).b;assert(house);
  for(let y=house.y-1;y<=house.y+house.h;y++)for(let x=house.x-1;x<=house.x+house.w;x++)if(x<house.x||x>=house.x+house.w||y<house.y||y>=house.y+house.h)w.mountain[at(w,x,y)]=1;
  const count=w.citizens.length;G.rng=()=>0;G.tryBirths();assert.equal(w.citizens.length,count);
 }
});

test('actual bridge construction, recovered goods and later demolition keep water cache ownership saveable',()=>{
 const G=fresh(),w=openWorld(G);G.game.res.wood=20;G.game.res.stone=5;assert(G.addBuilding('storage',2,2,{instant:true,free:true}).ok);
 for(let x=11;x<=13;x++)w.water[at(w,x,10)]=1;
 const c=G.spawnCitizen({x:9,y:10,age:30,sex:'m'}),bridge=G.addBridge({x:10,y:10},{x:14,y:10}).b;assert(bridge);G.scheduleJobs();
 until(G,c,()=>bridge.state==='ok',10000);assert(bridge.construction.consumed);assert.equal(G.game.res.wood,0);assert.equal(G.game.res.stone,0);
 G.sendTo(c,12,10);until(G,c,()=>c.x===12&&c.y===10);
 G.game.supplyMode='physical';G.game.supplyStartedDay=0;const quantity=G.withdrawResource('grain',7);c.carry={type:'grain',qty:quantity,staffingReturn:true,supplyBatch:{kind:'return',to:null}};G.recoverCitizenSupply(c);
 G.sendTo(c,8,10);until(G,c,()=>c.x===8&&c.y===10);assert(G.removeBuilding(bridge));assert.equal(w.supplyCaches[0].x,12);assert.equal(w.water[at(w,12,10)],1);
 G.applySaveData(save(G));assert.equal(G.world.supplyCaches[0].supplyStock.grain,7);assert.equal(G.game.res.grain,393);
});

test('v2 bridge placement under bank residents preserves cargo and its immediate save round-trips',()=>{
 const G=fresh(),w=openWorld(G);G.game.res.wood=20;G.game.res.stone=5;assert(G.addBuilding('storage',2,2,{instant:true,free:true}).ok);
 for(let x=11;x<=13;x++)w.water[at(w,x,10)]=1;
 const c=G.spawnCitizen({x:10,y:10,age:30,sex:'m'});c.carry={type:'grain',qty:G.withdrawResource('grain',7),staffingReturn:true};c.state='haul';const carry=c.carry;
 assert(G.addBridge({x:10,y:10},{x:14,y:10}).ok);assert.equal(c.carry,carry);assert(!G.tileBlocked(w,Math.round(c.x),Math.round(c.y)));assert.notEqual(c.x+','+c.y,'10,10');
 for(let i=0;i<3;i++){G.applySaveData(save(G));const loaded=G.world.cmap[c.id];assert(!G.tileBlocked(G.world,Math.round(loaded.x),Math.round(loaded.y)));assert.equal(loaded.carry.qty,7);assert.equal(G.game.res.grain+loaded.carry.qty,400);}
});
test('v2 bridge cannot seal a bank resident with no real exit even if the other bank has a builder',()=>{
 const G=fresh(),w=openWorld(G);G.game.res.wood=20;G.game.res.stone=5;
 for(let x=11;x<=13;x++)w.water[at(w,x,10)]=1;
 const c=G.spawnCitizen({x:10,y:10,age:30,sex:'m'});G.spawnCitizen({x:15,y:10,age:30,sex:'f'});
 for(let y=9;y<=11;y++)for(let x=9;x<=11;x++)if((x!==10||y!==10)&&!(x===11&&y===10))w.mountain[at(w,x,y)]=1;
 const uid=G._peekUid(),res=JSON.stringify(G.game.res),before=JSON.stringify(Array.from(w.bgrid));const result=G.addBridge({x:10,y:10},{x:14,y:10});
 assert(!result.ok);assert(result.reason.includes('出口'));assert.equal(G._peekUid(),uid);assert.equal(JSON.stringify(G.game.res),res);assert.equal(JSON.stringify(Array.from(w.bgrid)),before);assert.equal(w.buildings.length,0);assert.equal(c.x,10);assert.equal(c.y,10);
});

console.log('Mountain starts: '+passed+' passed (headless focused contracts; no browser or full-suite claim).');
