/* Deterministic logistics regressions. Run node tests/hauling.js [checkout]. */
'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));
global.window = global;
for (const f of ['core', 'defs', 'map', 'sim']) require(path.join(root, 'js', f + '.js'));
function fresh() {
  const N = 30;
  G.world = { seed: 1, N, water: new Uint8Array(N*N), rock: new Uint8Array(N*N), road: new Uint8Array(N*N), bgrid: new Int32Array(N*N).fill(-1), treeIdx: new Int32Array(N*N).fill(-1), trees: [], rockCleared: [], marked: new Set(), markedRocks: new Set(), buildings: [], bmap: {}, citizens: [], cmap: {}, families: [], start: { x: 15, y: 15 } };
  G.game = G.newGameState(); G.game.h = 12;
  G.ui = { toast() {}, refreshHUD() {}, hideInfo() {}, setToolActive() {} };
}
function building(type, x, y, w, h) {
  const b = { id: G.nextId(), type, x, y, w, h, state: 'ok', workers: [], family: null, noWork: false };
  G.world.buildings.push(b); G.world.bmap[b.id] = b;
  for (let j=y;j<y+h;j++) for(let i=x;i<x+w;i++) G.world.bgrid[j*G.world.N+i]=b.id;
  return b;
}
let passed=0;
function test(name, fn) { fresh(); fn(); passed++; console.log('ok ' + name); }
test('two farmers deliver both partial final loads', () => {
  const b=building('farm',2,2,8,8);
  b.farm=[]; for(let y=2;y<10;y++) for(let x=2;x<10;x++) b.farm.push({x,y,sown:true,harvested:true});
  b.farm[62].harvested=b.farm[63].harvested=false;
  b.sownAll=true;b.growth=1;b.harvestDone=false;
  G.game.season=2;G.game.res.food=0;
  const cs=[G.spawnCitizen({x:8,y:9,age:30,sex:'m'}),G.spawnCitizen({x:9,y:9,age:30,sex:'f'})];
  for(const c of cs) {c.job=b.id;b.workers.push(c.id);G.requestTask(c);}
  assert.notEqual(cs[0].task.ti,cs[1].task.ti);
  for(let n=0;n<1000;n++) for(const c of cs) G.stepCitizen(c,0.1);
  assert.equal(G.game.res.food,28);assert.equal(b.harvestDone,true);assert.ok(cs.every(c=>!c.carry));
});
for (const distance of [0, 8]) test(`storage cap on ${distance ? 'walking' : 'immediate'} delivery`, () => {
  building('storage',2,2,3,3);G.game.res.wood=499;
  const c=G.spawnCitizen({x:1+distance,y:2,age:30,sex:'m'});c.carry={type:'wood',qty:10};
  G.startHaul(c);
  for(let n=0;n<100 && c.carry;n++) G.stepCitizen(c,0.1);
  assert.equal(G.game.res.wood,500);assert.equal(c.carry,null);assert.equal(G.game.warned.storageFull,true);
});
test('partial harvest load keeps batching when another tile is available', () => {
  const b=building('farm',2,2,8,8);b.farm=[{x:2,y:2,sown:true,harvested:false},{x:3,y:2,sown:true,harvested:false}];
  b.sownAll=true;b.growth=1;b.harvestDone=false;G.game.season=2;G.game.res.food=0;
  const c=G.spawnCitizen({x:2,y:2,age:30,sex:'m'});c.job=b.id;b.workers=[c.id];G.requestTask(c);G.completeTask(c);
  assert.equal(c.carry.qty,14);assert.equal(c.task.kind,'harvest');assert.equal(G.game.res.food,0);
  G.completeTask(c);assert.equal(G.game.res.food,28);assert.equal(c.carry,null);
});
test('unreachable storage retains cargo instead of teleporting it', () => {
  building('storage',2,2,3,3);G.game.res.wood=0;
  for (let y=0;y<30;y++) G.world.water[y*30+10]=1;
  const c=G.spawnCitizen({x:20,y:2,age:30,sex:'m'});c.carry={type:'wood',qty:10};
  G.startHaul(c);assert.equal(G.game.res.wood,0);assert.equal(c.carry.qty,10);
});
test('reachable farther warehouse bypasses disconnected nearer warehouse', () => {
  const far=building('storage',0,10,3,3), near=building('storage',11,10,3,3);
  for(let y=0;y<30;y++) G.world.water[y*30+10]=1;
  G.game.res.wood=0;
  const c=G.spawnCitizen({x:8,y:10,age:30,sex:'m'});c.carry={type:'wood',qty:10};
  G.startHaul(c);assert.equal(c.haulTo,far.id);
  for(let i=0;i<200&&c.carry;i++) G.stepCitizen(c,0.1);
  assert.equal(G.game.res.wood,10);assert.equal(c.carry,null);
});
test('unreachable closest marks do not block reachable timber and minerals', () => {
  for(let y=0;y<30;y++) G.world.water[y*30+10]=1;
  for(const x of [0,11]) { G.addTree(G.world,x,10,-200);G.markFellAt(G.world,x,10); }
  assert.equal(G.pickMarkedTree(G.world,8,10).x,0);
  for(const x of [0,11]) { G.world.rock[12*30+x]=1;G.markRockAt(G.world,x,12); }
  assert.equal(G.pickMarkedRock(G.world,8,12).x,0);
});
test('limited smith stops consuming wood and restarts after tools wear', () => {
  const b=building('blacksmith',2,2,3,3);const c=G.spawnCitizen({x:1,y:2,age:30,sex:'m'});
  G.game.res.tools=G.PROD.blacksmith.toolLimit;G.game.res.iron=10;
  assert.equal(G.makeTask(b,c),null);assert.equal(b.warnText,'工具已达上限');
  G.scheduleJobs();assert.equal(b.workers.length,0);
  G.game.toolWear=0.999;G.endDay();G.game.h=12;
  assert.equal(G.game.res.tools,G.PROD.blacksmith.toolLimit-1);
  G.scheduleJobs();assert.equal(c.job,b.id);assert.equal(c.task.yield.type,'tools');
  const wood=G.game.res.wood,iron=G.game.res.iron;
  G.completeTask(c);
  assert.equal(G.game.res.wood,wood-2);assert.equal(G.game.res.iron,iron-1);
  assert.equal(G.game.res.tools,G.PROD.blacksmith.toolLimit+1); // one batch may cross target
  assert.equal(G.makeTask(b,c),null);
});
test('raising and disabling tool target take effect on future tasks', () => {
  const b=building('blacksmith',2,2,3,3);const c=G.spawnCitizen({x:1,y:2,age:30,sex:'m'});
  G.game.res.tools=30;G.game.res.iron=10;b.toolLimit=40;
  assert.ok(G.makeTask(b,c));b.toolLimit=0;assert.equal(G.makeTask(b,c),null);
});
test('finished autumn field does not steal the active fuel worker', () => {
  const wood=building('woodcutter',2,2,2,2), farm=building('farm',10,2,8,8);
  farm.sownAll=true;farm.growth=1;farm.harvestDone=true;farm.farm=[];
  G.game.season=2;G.game.day=24;G.game.res.firewood=0;
  const c=G.spawnCitizen({x:1,y:2,age:30,sex:'m'});c.job=wood.id;wood.workers=[c.id];G.requestTask(c);
  for(let i=0;i<3;i++) G.scheduleJobs();
  assert.equal(c.job,wood.id);assert.equal(farm.workers.length,0);
  for(let i=0;i<200;i++) G.advanceSim(0.1);
  assert.ok(G.game.res.firewood>0);
});
test('rock work and farm claims survive overnight pauses', () => {
  G.world.rock[2*30+2]=1;G.markRockAt(G.world,2,2);
  const c=G.spawnCitizen({x:1,y:2,age:30,sex:'m'});G.requestTask(c);c.task.workLeft=1;G.goHome(c);
  assert.equal(G.resumeTask(c),true);assert.equal(c.task.workLeft,1);
  fresh();const farm=building('farm',2,2,8,8);farm.sownAll=false;
  farm.farm=[{x:2,y:2,sown:false,harvested:false},{x:3,y:2,sown:false,harvested:false}];
  const a=G.spawnCitizen({x:2,y:2,age:30,sex:'m'}),b=G.spawnCitizen({x:3,y:2,age:30,sex:'f'});
  a.job=b.job=farm.id;farm.workers=[a.id,b.id];G.requestTask(a);G.goHome(a);G.requestTask(b);
  assert.notEqual(a.pausedTask.ti,b.task.ti);
});
test('marked labor may borrow aggregate food surplus across buildings', () => {
  const a=building('gatherer',2,2,2,2),b=building('gatherer',10,2,2,2);
  for(const hut of [a,b]) for(let i=0;i<4;i++) {
    const c=G.spawnCitizen({x:1,y:2,age:30,sex:'m'});c.job=hut.id;hut.workers.push(c.id);
  }
  const donor=G.pickMarkDonor(G.world,false,['gatherer','dock','hunting'],5);
  assert.ok(donor);assert.ok(a.workers.includes(donor.id)||b.workers.includes(donor.id));
  assert.equal(G.pickMarkDonor(G.world,false,['gatherer','dock','hunting'],8),null);
});
test('low food recalls builders and cannot leak food workers through rebalance', () => {
  const huts=[building('gatherer',2,2,2,2),building('gatherer',12,2,2,2)];
  for(const h of huts) for(let y=h.y-1;y<h.y+5;y++) for(let x=h.x-1;x<h.x+5;x++) G.addTree(G.world,x,y,-200);
  const site=building('house',20,2,2,2);site.state='site';site.workLeft=90;site.totalWork=90;
  building('woodcutter',20,10,2,2);
  for(let n=0;n<10;n++) {
    const c=G.spawnCitizen({x:5,y:5,age:30,sex:'m'});
    const b=n<4?huts[0]:n<6?huts[1]:site;c.job=b.id;b.workers.push(c.id);c.state='idle';
  }
  for(let n=0;n<5;n++) G.spawnCitizen({x:5,y:5,age:5,sex:'f'});
  G.game.res.food=75;
  for(let n=0;n<3;n++) G.scheduleJobs();
  assert.ok(huts.reduce((n,b)=>n+b.workers.length,0)>=8);
  assert.equal(G.game.foodUrgent,true);
  G.game.res.food=15*G.LIFE.eatPerDay*10;G.scheduleJobs();assert.equal(G.game.foodUrgent,true);
  G.game.res.food=15*G.LIFE.eatPerDay*13;G.scheduleJobs();assert.equal(G.game.foodUrgent,false);
  for(let n=0;n<10;n++) G.spawnCitizen({x:5,y:5,age:5,sex:'f'});
  G.game.foodUrgent=true;G.game.res.food=450;G.scheduleJobs();assert.equal(G.game.foodUrgent,false,'recovery remains possible within storage cap');
});
test('empty-input critical jobs never interrupt busy food workers', () => {
  const gather=building('gatherer',10,10,2,2), smith=building('blacksmith',2,2,3,3);
  G.game.res.iron=0;
  for(let y=9;y<15;y++) for(let x=9;x<15;x++) G.addTree(G.world,x,y,-200);
  const workers=[];
  for(let n=0;n<4;n++) { const c=G.spawnCitizen({x:9,y:10,age:30,sex:'m'});c.job=gather.id;gather.workers.push(c.id);G.requestTask(c);workers.push([c,c.task]); }
  for(let n=0;n<8;n++) G.scheduleJobs();
  assert.equal(gather.workers.length,4);assert.equal(smith.workers.length,0);
  for(const [c,task] of workers) assert.equal(c.task,task);
});
test('tools warn before exhaustion and suppress repeated warnings', () => {
  for(let n=0;n<10;n++) G.spawnCitizen({x:9,y:10,age:30,sex:'m'});
  G.game.res.tools=4;G.game.res.food=1000;const warnings=[];G.ui.toast=m=>warnings.push(m);
  G.endDay();G.endDay();
  assert.equal(warnings.filter(m=>m.includes('工具约够')).length,1);assert.ok(G.game.res.tools>0);
});
test('input-starved idle singleton releases to marked resource work', () => {
  const smith=building('blacksmith',2,2,3,3);G.game.res.wood=0;G.game.res.iron=10;
  const c=G.spawnCitizen({x:1,y:2,age:30,sex:'m'});c.job=smith.id;smith.workers=[c.id];
  G.addTree(G.world,8,8,-200);G.markFellAt(G.world,8,8);G.requestTask(c);
  assert.equal(smith.noWork,true);G.scheduleJobs();assert.equal(c.job,null);
  G.requestTask(c);assert.equal(c.task.kind,'chop');
});
global.addEventListener=()=>{};
require(path.join(root,'js/main.js'));
test('tool target save roundtrip and legacy fallback preserve tool wear', () => {
  const b=building('blacksmith',2,2,3,3);b.toolLimit=70;G.game.toolWear=0.45;
  G.spawnCitizen({x:1,y:2,age:30,sex:'m'});
  G.game.foodUrgent=true;G.game.res.food=10*G.LIFE.eatPerDay;
  const saved=JSON.parse(JSON.stringify(G.serializeGame()));
  global.document={getElementById:()=>({classList:{add(){},remove(){},contains:()=>true}})};
  G.ui.hideInfo=()=>{};G.ui.setToolActive=()=>{};G.T2S=()=>[0,0];G.cam={x:0,y:0,z:1};G.groundDirty={clear(){}};G.markGroundDirty=()=>{};
  G.applySaveData(saved);assert.equal(G.world.bmap[b.id].toolLimit,70);assert.equal(G.game.toolWear,0.45);assert.equal(G.game.foodUrgent,true);
  saved.buildings[0].toolLimit='<img src=x onerror=alert(1)>';G.applySaveData(saved);assert.equal(G.world.bmap[b.id].toolLimit,G.PROD.blacksmith.toolLimit);
  delete saved.buildings[0].toolLimit;G.applySaveData(saved);
  assert.equal(G.world.bmap[b.id].toolLimit,G.PROD.blacksmith.toolLimit);assert.equal(G.game.toolWear,0.45);
});
test('64 generated starts have one real storage and 15 reachable citizens', () => {
  global.localStorage={removeItem(){}};
  G.ui.hideInfo=()=>{};G.ui.setToolActive=()=>{};G.T2S=()=>[0,0];G.cam={x:0,y:0,z:1};G.groundDirty={clear(){}};
  for(let seed=1;seed<=64;seed++) {
    G.newGame(seed);
    const iron=[];for(let i=0;i<G.world.rock.length;i++) if(G.world.rock[i]===2&&G.d2(i%G.world.N,Math.floor(i/G.world.N),G.world.start.x,G.world.start.y)<=196) iron.push(i);
    assert.ok(iron.length>=3,`starter iron seed ${seed}`);
    const stores=G.world.buildings.filter(b=>b.type==='storage'&&b.state==='ok');
    assert.equal(stores.length,1,`seed ${seed}`);assert.equal(G.world.citizens.length,15);
    for(const c of G.world.citizens) {
      assert.equal(G.tileBlocked(G.world,Math.round(c.x),Math.round(c.y)),false,`blocked citizen seed ${seed}`);
      const spot=G.workSpot(G.world,stores[0],c.x,c.y);
      assert.ok(spot&&G.findPath(G.world,Math.round(c.x),Math.round(c.y),spot.x,spot.y),`isolated citizen seed ${seed}`);
    }
  }
});
test('map version preserves starter minerals and legacy terrain on reload', () => {
  G.newGame(2);
  assert.equal(G.world.mapVersion,1);
  const saved=JSON.parse(JSON.stringify(G.serializeGame()));
  const before=Array.from(G.world.rock);G.applySaveData(saved);assert.deepEqual(Array.from(G.world.rock),before);
  delete saved.mapVersion;G.applySaveData(saved);assert.equal(G.world.mapVersion,0);
  assert.deepEqual(Array.from(G.world.rock),Array.from(G.genWorld(2,{starterResources:false}).rock));
});
console.log(`${passed} economy regression scenarios passed`);
