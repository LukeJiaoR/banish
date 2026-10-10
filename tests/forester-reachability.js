'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { thinForest } = require('./helpers/forester');
const { loadGame } = require('./helpers/playability');
const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));
let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('ok ' + name); }
  catch (error) { failed++; console.error('FAIL ' + name + ': ' + error.message); }
}
function fresh() {
  const G = loadGame(root), N = 40;
  G.world = { seed: 1, N, water: new Uint8Array(N*N), rock: new Uint8Array(N*N), road: new Uint8Array(N*N), bgrid: new Int32Array(N*N).fill(-1), treeIdx: new Int32Array(N*N).fill(-1), trees: [], rockCleared: [], marked: new Set(), markedRocks: new Set(), buildings: [], bmap: {}, citizens: [], cmap: {}, families: [], start: {x:10,y:10} };
  G.game = G.newGameState(); G.game.h = 12; G.rng = () => 0;
  return G;
}
function hut(G, x=20, y=16) {
  const b = { id:G.nextId(), type:'forester', x,y,w:2,h:2,state:'ok',workers:[],doCut:true,doPlant:true };
  const w=G.world; w.buildings.push(b); w.bmap[b.id]=b;
  for(let yy=y;yy<y+2;yy++) for(let xx=x;xx<x+2;xx++) w.bgrid[yy*w.N+xx]=b.id;
  return b;
}
function worker(G,b,x=16,y=16) { const c=G.spawnCitizen({x,y,age:25,sex:'m'});c.job=b.id;b.workers.push(c.id);return c; }
function forest(G) { for(let y=12;y<16;y++) for(let x=13;x<17;x++) G.addTree(G.world,x,y,-200); }
function river(G,x=18) { for(let y=0;y<G.world.N;y++) G.world.water[y*G.world.N+x]=1; }
function route(G,c,t) { return t && G.findPath(G.world,Math.round(c.x),Math.round(c.y),t.tx,t.ty); }

test('generated seed 2 bypasses the unreachable third tree after real felling and hauling',()=>{
  const {G,b,citizens,origin}=thinForest(root,1),w=G.world,c=citizens[0];
  const mature=G.treesInRadius(w,b.x,b.y,G.PROD.forester.radius,true);
  assert.equal(mature.length,25);
  assert.equal(mature.filter(t=>G.findPath(w,origin.x,origin.y,t.x,t.y)).length,24);
  assert.equal(G.findPath(w,origin.x,origin.y,72,63),null);
  G.game.h=12;G.requestTask(c);
  for(let n=0;n<500&&(b.produced?.wood||0)<4;n++)G.stepCitizen(c,.25);
  assert.equal(b.produced.wood,4);
  for(let n=0;n<200&&c.carry;n++)G.stepCitizen(c,.25);
  G.requestTask(c);
  assert.ok(c.task,'after the first two trees, unreachable (72,63) must not stall dispatch');
  assert.equal(c.task.kind,'chop');assert.notEqual(c.task.tx+','+c.task.ty,'72,63');assert.ok(route(G,c,c.task));
});
test('plant selection skips unreachable first spiral cells',()=>{
  const G=fresh(),b=hut(G),c=worker(G,b);river(G);b.doCut=false;
  const t=G.makeTask(b,c);assert.equal(t.kind,'plant');assert.ok(route(G,c,t));assert.ok(t.tx<18);
});
test('no route returns idle; water and road changes are seen on the next task',()=>{
  const G=fresh(),b=hut(G),c=worker(G,b,1,16);forest(G);river(G,10);b.doPlant=false;
  G.requestTask(c);assert.equal(c.task,null);assert.equal(c.state,'idle');
  G.world.water[16*40+10]=0;G.world.road[16*40+10]=1;
  G.requestTask(c);assert.ok(c.task);assert.ok(route(G,c,c.task));
  G.world.water[16*40+10]=1;G.world.road[16*40+10]=0;
  G.requestTask(c);assert.equal(c.task,null);
});
test('building construction and demolition change task reachability immediately',()=>{
  const G=fresh(),b=hut(G),c=worker(G,b,1,16);forest(G);river(G,10);b.doPlant=false;
  G.world.water[16*40+10]=0;G.requestTask(c);assert.ok(c.task);
  const wall={id:G.nextId(),type:'house',x:10,y:16,w:1,h:1,state:'site',workers:[]};
  G.world.bmap[wall.id]=wall;G.world.bgrid[16*40+10]=wall.id;
  G.requestTask(c);assert.equal(c.task,null);
  delete G.world.bmap[wall.id];G.world.bgrid[16*40+10]=-1;
  G.requestTask(c);assert.ok(c.task);assert.ok(route(G,c,c.task));
});
test('tree disappearance and replacement cannot finish or resume stale work',()=>{
  const G=fresh(),b=hut(G),c=worker(G,b);forest(G);G.requestTask(c);const t=c.task;
  G.goHome(c);G.removeTree(G.world,t.tx,t.ty);G.addTree(G.world,t.tx,t.ty);
  assert.equal(G.resumeTask(c),false);assert.equal(c.task,null);
  const wood=G.game.res.wood;c.task=t;G.completeTask(c);assert.equal(G.game.res.wood,wood);
  assert.notEqual(c.task?.tree,t.tree);
});
test('finite trees, forest floor, configured specialist work and tool/education yields are preserved',()=>{
  for(const educated of [false,true])for(const doPlant of [false,true])for(const tools of [0,10]){
    const G=fresh(),b=hut(G),c=worker(G,b);forest(G);c.educated=educated;b.doPlant=doPlant;G.game.res.tools=tools;
    const t=G.makeTask(b,c);assert.equal(t.kind,'chop');assert.equal(t.replant,doPlant);
    assert.equal(t.work,G.taskWork(c,(G.PROD.forester.cutWorkH || 8)+(doPlant?G.PROD.forester.plantH:0)));assert.equal(t.logs,G.taskYield(educated?3:2));
    const total=G.world.trees.length,wood=G.game.res.wood;c.task=t;c.x=t.tx;c.y=t.ty;G.completeTask(c);
    assert.equal(G.world.trees.length,total-(doPlant?0:1));assert.equal(G.game.res.wood-wood,t.logs);
    assert.notEqual(G.makeTask(b,c)?.kind,'chop'); // only 15 mature trees remain
  }
});
test('reachable batch targets use current-worker distance with bounded random tie variation',()=>{
  const G=fresh(),b=hut(G),c=worker(G,b,12,11);forest(G);
  const trees=G.treesInRadius(G.world,b.x,b.y,16,true);
  let calls=0;const values=trees.map((_,i)=>(i*7%13)/13);
  G.rng=()=>values[calls++];
  const expected=trees.map((tree,i)=>({tree,d:G.d2(c.x,c.y,tree.x,tree.y)+values[i]*8})).sort((a,z)=>a.d-z.d)[0].tree;
  const hutNearest=trees.map((tree,i)=>({tree,d:G.d2(b.x,b.y,tree.x,tree.y)+values[i]*8})).sort((a,z)=>a.d-z.d)[0].tree;
  assert.notEqual(expected,hutNearest,'fixture separates hut-origin and worker-origin selection');
  assert.equal(G.makeTask(b,c).tree,expected);assert.equal(calls,trees.length);
});
test('read/load replaces the world and recomputes target accessibility',()=>{
  const {G,b,citizens}=thinForest(root,1),c=citizens[0];G.game.h=12;
  G.makeTask(b,c);const data=JSON.parse(JSON.stringify(G.serializeGame())),old=G.world;
  G.applySaveData(data);assert.notEqual(G.world,old);
  const bb=G.world.bmap[b.id],cc=G.world.cmap[c.id];
  for(const [x,y]of [[59,57],[58,58]]){G.removeTree(G.world,x,y);G.addTree(G.world,x,y);}
  G.requestTask(cc);assert.ok(cc.task);assert.ok(route(G,cc,cc.task));assert.notEqual(cc.task.tx+','+cc.task.ty,'72,63');
});
test('task-local connectivity agrees with A* on generated maps and blocked starts/targets',()=>{
  const G=fresh();assert.equal(typeof G.foresterReachability,'function');
  for(const seed of [1,2,41]){
    G.world=G.genWorld(seed);const w=G.world;
    const c={x:w.start.x+.2,y:w.start.y+.2},reachable=G.foresterReachability(w,c);
    // Compare repeated queries sharing one task-local scan against real A*.
    for(let i=0;i<w.N*w.N;i+=31){const x=i%w.N,y=Math.floor(i/w.N);assert.equal(reachable(x,y),!!G.findPath(w,Math.round(c.x),Math.round(c.y),x,y),`seed ${seed} @ ${x},${y}`);}
  }
  const H=fresh(),w=H.world;w.water.fill(1);w.water[2*40+2]=0;w.water[3*40+3]=0;
  let reach=H.foresterReachability(w,{x:2,y:2});assert.equal(reach(3,3),false); // diagonal cannot cut the corner
  w.water[2*40+3]=0;reach=H.foresterReachability(w,{x:2,y:2});assert.equal(reach(3,3),true);
  w.water[2*40+2]=1;reach=H.foresterReachability(w,{x:2,y:2});
  for(const [x,y]of [[30,30],[3,3],[2,2]])assert.equal(reach(x,y),!!H.findPath(w,2,2,x,y));
});
test('unreachable planting candidates use one bounded scan and no A*, never per frame',()=>{
  const G=fresh(),b=hut(G),c=worker(G,b,1,16);river(G,10);b.doCut=false;
  // All legal planting sites are east of the river; west is occupied by roads.
  for(let y=0;y<40;y++)for(let x=0;x<10;x++)G.world.road[y*40+x]=1;
  let paths=0,tiles=0;const find=G.findPath,blocked=G.tileBlocked;
  G.findPath=(...args)=>{paths++;return find(...args);};G.tileBlocked=(...args)=>{tiles++;return blocked(...args);};
  G.requestTask(c);assert.equal(c.task,null);assert.equal(paths,0);assert.ok(tiles<40*40*5);
  const before=paths;for(let n=0;n<30;n++)G.stepCitizen(c,1/60);assert.equal(paths,before);
});
console.log(`${passed} forester reachability scenarios passed; ${failed} failed`);
if(failed)process.exitCode=1;
