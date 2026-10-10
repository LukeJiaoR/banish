// Forester claims must remain unique across nights and overlapping work areas.
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

test('chop claims survive overnight and resume unchanged work',()=>{
  const G=fresh(),b=hut(G),a=worker(G,b),z=worker(G,b);forest(G);
  G.requestTask(a);const t=a.task;t.workLeft=4;G.goHome(a);
  G.requestTask(z);assert.ok(z.task);assert.notEqual(z.task.tree,t.tree);
  assert.equal(G.resumeTask(a),true);assert.equal(a.task,t);assert.equal(t.workLeft,4);
});
test('plant claims survive overnight, including overlapping hut circles',()=>{
  for(const separateHuts of [false,true]){
    const G=fresh(),b=hut(G),other=separateHuts?hut(G,24,16):b;
    b.doCut=other.doCut=false;const a=worker(G,b),z=worker(G,other);
    G.world.road.fill(1);G.world.road[15*40+19]=0;G.world.road[14*40+19]=0;
    G.requestTask(a);assert.ok(a.task);const t=a.task;G.goHome(a);G.requestTask(z);
    assert.ok(z.task);assert.notEqual(z.task.tx+','+z.task.ty,t.tx+','+t.ty);
  }
});
test('all claimed mature trees do not create duplicate jobs',()=>{
  const G=fresh(),b=hut(G),c=worker(G,b);b.doPlant=false;forest(G);
  for(const tree of G.world.trees){const z=worker(G,b);z.task={kind:'chop',b,tree,tx:tree.x,ty:tree.y};}
  assert.equal(G.makeTask(b,c),null);
});
test('waiting for a claimed last planting site does not release its active worker',()=>{
  const G=fresh(),b=hut(G),a=worker(G,b),z=worker(G,b);b.doCut=false;
  G.world.road.fill(1);G.world.road[15*40+19]=0;
  G.requestTask(a);const t=a.task;assert.ok(t);G.requestTask(z);assert.equal(z.task,null);
  G.endDay();assert.equal(a.job,b.id);assert.equal(a.task,t);
  b.doPlant=false;G.makeTask(b,z);assert.equal(b.noWork,true);assert.equal(b.warnText,'已停用（砍伐/补种均关）');
});
console.log(`${passed} claim scenarios passed; ${failed} known failures`);
if(failed)process.exitCode=1;

if(failed)process.exitCode=1;
