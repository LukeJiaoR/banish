/* Cargo must survive partial/full storage. Run node tests/mineral-cargo.js [checkout]. */
'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const { loadGame } = require('./helpers/playability');
const G = loadGame(root);
let passed = 0;
function fresh() {
  const N = 30;
  G.world = { seed: 1, N, water: new Uint8Array(N*N), rock: new Uint8Array(N*N), road: new Uint8Array(N*N), bgrid: new Int32Array(N*N).fill(-1), treeIdx: new Int32Array(N*N).fill(-1), trees: [], rockCleared: [], marked: new Set(), markedRocks: new Set(), buildings: [], bmap: {}, citizens: [], cmap: {}, families: [], start: { x: 15, y: 15 } };
  G.game = G.newGameState(); G.game.h = 12;
}
function building(type, x=2, y=2, w=3, h=3) {
  const b = { id: G.nextId(), type, x, y, w, h, state: 'ok', workers: [], family: null, noWork: false };
  G.world.buildings.push(b); G.world.bmap[b.id] = b;
  for (let yy=y;yy<y+h;yy++) for(let xx=x;xx<x+w;xx++) G.world.bgrid[yy*G.world.N+xx]=b.id;
  return b;
}
function citizen(x=1,y=2) { return G.spawnCitizen({x,y,age:30,sex:'m'}); }
function step(c, hours=10) { for(let n=0;n<Math.round(hours*10);n++) G.stepCitizen(c,0.1); }
function test(name, fn) { fresh(); fn(); passed++; console.log('ok ' + name); }

for (const type of ['stone','iron']) for (const mode of ['adjacent','walking','legacy']) test(`${type}: ${mode} retains partial delivery`, () => {
  if(mode!=='legacy') building('storage');
  G.game.res[type]=499;
  const c=citizen(mode==='walking'?9:1);c.carry={type,qty:10};
  G.startHaul(c);step(c);
  assert.equal(G.game.res[type],500);
  assert.equal(c.carry && c.carry.qty,9,'undeposited cargo must stay with its owner');
  assert.equal(G.game.res[type]+c.carry.qty,509);
  assert.equal(c.task,null);assert.equal(c.state,'waitStorage');
});
test('finite mineral completion preserves all ten units at 499 stock', () => {
  building('storage');G.game.res.stone=499;
  const c=citizen();const i=2*30+1;G.world.rock[i]=1;G.world.markedRocks.add(i);
  G.requestTask(c);assert.equal(c.task.kind,'clearrock');G.completeTask(c);
  assert.equal(G.world.rock[i],0);
  assert.equal(G.game.res.stone+(c.carry?c.carry.qty:0),509);
  assert.equal(c.carry.qty,9);
});
test('two deliveries race for capacity without losing either remainder', () => {
  building('storage');G.game.res.stone=490;
  const a=citizen(9), b=citizen(10);
  a.carry={type:'stone',qty:10};b.carry={type:'stone',qty:10};
  G.startHaul(a);G.startHaul(b);
  assert.equal(a.state,'haul');assert.equal(b.state,'haul');
  step(a);step(b);
  assert.equal(G.game.res.stone,500);assert.equal(a.carry,null);assert.equal(b.carry.qty,10);
});
test('storage becoming full during the walk retains the entire shipment', () => {
  building('storage');G.game.res.iron=480;
  const c=citizen(9);c.carry={type:'iron',qty:10};G.startHaul(c);
  G.game.res.iron=500;step(c);
  assert.equal(G.game.res.iron,500);assert.equal(c.carry.qty,10);assert.equal(c.task,null);
});
test('consuming inventory releases waiting cargo through normal retry', () => {
  building('storage');G.game.res.stone=500;
  const c=citizen();c.carry={type:'stone',qty:9};G.startHaul(c);
  G.game.res.stone-=4;step(c,3);
  assert.equal(G.game.res.stone,500);assert.equal(c.carry.qty,5);
  G.game.res.stone-=5;step(c,3);
  assert.equal(G.game.res.stone,500);assert.equal(c.carry,null);
});
test('a completed new warehouse releases cargo; an unfinished one does not', () => {
  building('storage');G.game.res.stone=500;
  const c=citizen();c.carry={type:'stone',qty:9};G.startHaul(c);
  const other=building('storage',10,10);other.state='site';step(c,3);
  assert.equal(c.carry.qty,9);assert.equal(G.storageCap(),500);
  other.state='ok';step(c,3);
  assert.equal(G.storageCap(),1000);assert.equal(G.game.res.stone,509);assert.equal(c.carry,null);
});
test('full storage does no route searches and cannot recursively resume new work', () => {
  building('storage');G.game.res.stone=500;
  const c=citizen(20);c.carry={type:'stone',qty:10};
  const route=G.storageRoute, find=G.findPath;let routes=0,paths=0;
  G.storageRoute=(...args)=>{routes++;return route(...args);};
  G.findPath=(...args)=>{paths++;return find(...args);};
  try {
    G.startHaul(c);
    for(let n=0;n<10000;n++) G.stepCitizen(c,0.01);
    assert.equal(routes,0);assert.equal(paths,0);assert.equal(c.carry.qty,10);assert.equal(c.task,null);assert.equal(c.state,'waitStorage');
    assert.match(G.cargoWaitReason(c),/仓满.*等待空间/);
  } finally {G.storageRoute=route;G.findPath=find;}
});
test('unreachable delivery is rate-limited, survives, and resumes after a route opens', () => {
  building('storage');G.game.res.stone=0;
  for(let y=0;y<30;y++) G.world.water[y*30+10]=1;
  const c=citizen(20);c.carry={type:'stone',qty:10};
  const route=G.storageRoute;let routes=0;G.storageRoute=(...args)=>{routes++;return route(...args);};
  try {
    G.startHaul(c);for(let n=0;n<100;n++) G.stepCitizen(c,0.01);
    assert.equal(routes,1);assert.equal(c.carry.qty,10);assert.equal(G.game.res.stone,0);
    assert.match(G.cargoWaitReason(c),/等待可达仓库/);
    G.world.water[2*30+10]=0;step(c,20);
    assert.equal(c.carry,null);assert.equal(G.game.res.stone,10);
  } finally {G.storageRoute=route;}
});
test('a removed delivery target reroutes instead of depositing at its former door', () => {
  const original=building('storage');const replacement=building('storage',20,20);G.game.res.stone=0;
  const c=citizen(9);c.carry={type:'stone',qty:10};G.startHaul(c);assert.equal(c.haulTo,original.id);
  original.state='site';G.arrive(c);
  assert.equal(c.haulTo,replacement.id);assert.equal(G.game.res.stone,0);assert.equal(c.carry.qty,10);
  step(c,30);assert.equal(G.game.res.stone,10);assert.equal(c.carry,null);
});
test('full minerals stay in the ground without new claims; another type can proceed', () => {
  const c=citizen();G.game.res.stone=500;G.game.res.iron=0;
  for(const [x,type] of [[1,1],[8,2]]) {G.world.rock[2*30+x]=type;G.world.markedRocks.add(2*30+x);}
  G.requestTask(c);assert.equal(c.task.rock,2);assert.equal(c.task.tx,8);
  assert.equal(G.world.rock[61],1);assert.ok(G.world.markedRocks.has(61));
  c.task=null;c.state='idle';G.game.res.iron=500;G.requestTask(c);assert.equal(c.task,null);
  G.game.res.stone=499;G.requestTask(c);assert.equal(c.task.rock,1);assert.equal(c.task.tx,1);
});
test('full mineral markers neither reserve nor pull the only food worker', () => {
  G.game.res.stone=500;G.game.res.food=0;
  G.world.rock[61]=1;G.world.markedRocks.add(61);
  const dock=building('dock',10,10,2,2),c=citizen();
  G.scheduleJobs();assert.equal(c.job,dock.id);assert.equal(dock.workers.length,1);
  assert.equal(G.world.markReachability.count,0);assert.equal(G.world.markReachability.storageBlocked,1);
  const task=c.task;G.scheduleJobs();assert.equal(c.job,dock.id);assert.equal(c.task,task);
});
test('canceling marks leaves completed cargo intact and prevents more mining', () => {
  building('storage');G.game.res.stone=499;
  for(const x of [1,8]) {G.world.rock[2*30+x]=1;G.world.markedRocks.add(2*30+x);}
  const c=citizen();G.requestTask(c);G.completeTask(c);
  G.cancelResourceMarks('rocks');step(c,10);
  assert.equal(c.carry.qty,9);assert.equal(G.game.res.stone,500);assert.equal(G.world.rock[68],1);
  G.game.res.stone=490;step(c,3);assert.equal(G.game.res.stone,499);assert.equal(c.carry,null);
  assert.equal(c.task,null);
});
test('job changes keep cargo and cannot start construction until delivery', () => {
  building('storage');G.game.res.stone=500;
  const dock=building('dock',10,10,2,2),site=building('house',20,20,2,2);site.state='site';site.workLeft=site.totalWork=30;
  const c=citizen();c.job=dock.id;dock.workers=[c.id];c.carry={type:'stone',qty:9};G.startHaul(c);
  G.releaseWorker(c);assert.equal(c.carry.qty,9);assert.equal(c.job,null);
  G.assignWorker(site,c);assert.equal(c.carry.qty,9);assert.equal(c.task,null);assert.equal(c.job,site.id);
  G.game.res.stone=490;G.requestTask(c);
  assert.equal(c.carry,null);assert.equal(G.game.res.stone,499);assert.equal(c.task.kind,'build');
});
test('nightly rest and waking preserve blocked cargo, then consume space normally', () => {
  building('storage');G.game.res.stone=500;
  const c=citizen();c.carry={type:'stone',qty:9};G.startHaul(c);
  G.game.h=23;step(c,1);assert.equal(c.state,'rest');assert.equal(c.carry.qty,9);
  G.game.h=7;G.stepCitizen(c,0.1);step(c,4);assert.equal(c.carry.qty,9);assert.equal(c.task,null);
  G.game.res.stone=490;step(c,3);assert.equal(c.carry,null);assert.equal(G.game.res.stone,499);
});
test('death keeps the existing loss policy and never remotely deposits cargo', () => {
  building('storage');G.game.res.stone=500;
  const c=citizen();c.carry={type:'stone',qty:9};G.startHaul(c);G.killCitizen(c,'意外');
  assert.equal(G.game.res.stone,500);assert.equal(G.world.cmap[c.id],undefined);assert.equal(G.world.citizens.length,0);
});
test('tools remain uncapped and do not become full-storage waiters', () => {
  building('storage');G.game.res.tools=500;const c=citizen();c.carry={type:'tools',qty:3};
  G.startHaul(c);assert.equal(G.game.res.tools,503);assert.equal(c.carry,null);
});
for(const stores of [true,false]) test(`save/load preserves full-storage carry (${stores?'warehouse':'legacy no warehouse'})`, () => {
  G.newGame(44);G.game.h=12;
  if(!stores) {G.world.buildings=[];G.world.bmap={};G.world.bgrid.fill(-1);}
  const c=G.world.citizens[0];G.game.res.stone=500;c.carry={type:'stone',qty:9};G.startHaul(c);
  const saved=JSON.parse(JSON.stringify(G.serializeGame()));
  G.applySaveData(saved);const restored=G.world.cmap[c.id];
  assert.equal(restored.carry.qty,9);assert.equal(G.game.res.stone,500);assert.equal(restored.haulPending,true);
  assert.equal(restored.task,null);assert.match(G.cargoWaitReason(restored),/仓满/);
  G.game.res.stone=490;step(restored,30);
  assert.equal(restored.carry,null);assert.equal(G.game.res.stone,499);
});
test('old saves without runtime hauling flags still rebuild safe waiting', () => {
  G.newGame(44);const c=G.world.citizens[0];G.game.res.iron=500;c.carry={type:'iron',qty:10};
  const saved=JSON.parse(JSON.stringify(G.serializeGame()));
  for(const record of saved.citizens) {delete record.haulPending;delete record.haulWait;}
  G.applySaveData(saved);const restored=G.world.cmap[c.id];
  assert.equal(restored.carry.qty,10);assert.equal(restored.haulPending,true);assert.equal(G.game.res.iron,500);
});
test('demolishing one warehouse reroutes in-flight minerals and preserves over-cap inventory', () => {
  const original=building('storage'), replacement=building('storage',20,20);G.game.res.iron=800;
  const c=citizen(9);c.carry={type:'iron',qty:10};G.startHaul(c);assert.equal(c.haulTo,original.id);
  G.removeBuilding(original);assert.equal(G.world.bmap[original.id],undefined);assert.equal(G.storageCap(),500);assert.equal(G.game.res.iron,800);
  G.arrive(c);assert.equal(c.carry.qty,10);assert.equal(c.state,'waitStorage');assert.equal(G.game.res.iron,800);
  G.game.res.iron=490;step(c,40);assert.equal(c.carry,null);assert.equal(G.game.res.iron,500);assert.equal(G.world.bmap[replacement.id],replacement);
});
test('food/wood/firewood overflow stays on the old delivery path; this slice does not add their backpressure', () => {
  building('storage');for(const type of ['food','wood','firewood']){G.game.res[type]=499;const c=citizen();c.carry={type,qty:10};G.startHaul(c);assert.equal(G.game.res[type],500);assert.equal(c.carry,null);assert.notEqual(c.state,'waitStorage');}
});
test('mine output keeps its rejected batch and cannot produce again while waiting', () => {
  building('storage');const b=building('mine',10,10),c=citizen();c.job=b.id;b.workers=[c.id];G.game.res.iron=499;
  c.task={kind:'work',b,tx:1,ty:2,yield:{type:'iron',qty:6},work:8};G.completeTask(c);
  assert.equal(G.game.res.iron,500);assert.equal(c.carry.qty,5);step(c,20);assert.equal(c.carry.qty,5);assert.equal(G.game.res.iron,500);assert.equal(c.task,null);
});
function waterForDock(){for(let y=13;y<20;y++)for(let x=10;x<20;x++)G.world.water[y*30+x]=1;}
test('blocked stone carrier does not satisfy labour reservation for a reachable iron mark', () => {
  building('storage');const dock=building('dock',10,10,2,2);waterForDock();G.game.res.stone=500;G.game.res.iron=0;G.game.res.food=400;
  const carrier=citizen();carrier.carry={type:'stone',qty:9};G.startHaul(carrier);
  for(let n=0;n<3;n++)G.assignWorker(dock,citizen(9,10));G.world.rock[68]=2;G.world.markedRocks.add(68);
  for(let n=0;n<10;n++){G.scheduleJobs();for(const c of G.world.citizens)if(!c.task)G.requestTask(c);}
  assert.equal(G.world.citizens.filter(c=>c.task?.kind==='clearrock').length,1);assert.equal(dock.workers.length,2);assert.equal(carrier.carry.qty,9);assert.equal(carrier.job,null);
});
for(const kind of ['dock','house'])test(`blocked cargo frees an empty ${kind} job slot without discarding cargo`, () => {
  building('storage');const b=building(kind,10,10,2,2);if(kind==='dock')waterForDock();else{b.state='site';b.totalWork=b.workLeft=30;}
  G.game.res.stone=500;const carrier=citizen();carrier.carry={type:'stone',qty:9};G.startHaul(carrier);G.assignWorker(b,carrier);
  for(let n=0;n<3;n++)G.assignWorker(b,citizen(9,10));const free=citizen(8,10);G.scheduleJobs();
  assert.equal(carrier.job,null);assert.equal(carrier.carry.qty,9);assert(!b.workers.includes(carrier.id));assert.equal(free.job,b.id);assert.equal(b.workers.length,4);
});
test('an isolated blocked donor does not make the reservation loop reassign forever', () => {
  building('storage');const mine=building('mine',10,10);G.game.res.stone=500;G.game.res.iron=0;G.game.res.food=400;
  const c=citizen();c.carry={type:'stone',qty:9};G.startHaul(c);G.assignWorker(mine,c);G.world.rock[68]=2;G.world.markedRocks.add(68);
  assert.equal(G.pickMarkDonor(G.world,false,['dock','gatherer','hunting'],0),null);
  for(let n=0;n<20;n++)G.scheduleJobs();assert.equal(c.carry.qty,9);assert.equal(c.job,null);assert.equal(c.task,null);
});
test('ordinary in-flight minerals are not classified as blocked labour', () => {
  building('storage');G.game.res.iron=0;const c=citizen(20);c.carry={type:'iron',qty:10};G.startHaul(c);assert.equal(c.state,'haul');assert.equal(G.mineralDeliveryBlocked(c),false);
});
test('night scheduling releases only the blocked job, preserves rest/cargo and reopens eligibility with space', () => {
  building('storage');const dock=building('dock',10,10,2,2);waterForDock();G.game.res.stone=500;const c=citizen();c.carry={type:'stone',qty:9};G.startHaul(c);G.assignWorker(dock,c);
  G.game.h=23;c.state='rest';for(let n=0;n<10;n++){G.scheduleJobs();G.stepCitizen(c,.1);assert.equal(c.state,'rest');assert.equal(c.carry.qty,9);}
  assert.equal(c.job,null);G.game.h=7;G.game.res.stone=490;assert.equal(G.mineralDeliveryBlocked(c),false);G.stepCitizen(c,.1);G.scheduleJobs();step(c,2);assert.equal(c.carry,null);assert.equal(G.game.res.stone,499);assert.equal(c.job,dock.id);
});
console.log(`${passed} mineral cargo scenarios passed`);
