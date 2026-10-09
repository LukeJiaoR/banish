'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadGame } = require('./helpers/playability');
const G = loadGame(path.resolve(process.argv[2] || path.join(__dirname, '..')));
let passed = 0;
function fresh() {
  const N = 20;
  G.world = { seed: 1, N, water:new Uint8Array(N*N), rock:new Uint8Array(N*N), road:new Uint8Array(N*N), bgrid:new Int32Array(N*N).fill(-1), treeIdx:new Int32Array(N*N).fill(-1), trees:[], marked:new Set(), markedRocks:new Set(), buildings:[], bmap:{}, citizens:[], cmap:{}, families:[], start:{x:3,y:3} };
  G.game = G.newGameState(); G.game.h=12;
}
function test(name, fn) { fresh(); fn(); passed++; console.log('ok '+name); }
function river() { for(let y=0;y<20;y++) G.world.water[y*20+10]=1; }
function adult(x=2,y=2) { return G.spawnCitizen({x,y,age:30,sex:'m'}); }
function tree(x,y) { G.addTree(G.world,x,y,-200); G.markFellAt(G.world,x,y); }
function dock() { const b={id:G.nextId(),type:'dock',x:2,y:4,w:2,h:2,state:'ok',workers:[]}; G.world.buildings.push(b);G.world.bmap[b.id]=b;return b; }
test('unreachable marks cannot strand the only worker away from food',()=>{
  river(); adult(); tree(14,2); tree(15,2); tree(16,2); const b=dock();
  G.scheduleJobs(); assert.equal(b.workers.length,1);
});
test('reachable mark still reserves labor without deleting inaccessible orders',()=>{
  river(); adult(); tree(3,2); tree(14,2); const b=dock();
  G.scheduleJobs(); assert.equal(b.workers.length,0); assert.equal(G.world.marked.size,2);
  assert.equal(G.world.markReachability.count,1);assert.equal(G.world.markReachability.unreachable,1);
});
test('connectivity follows all adult islands and ignores children/dead workers',()=>{
  river(); adult(); const child=G.spawnCitizen({x:14,y:2,age:5,sex:'f'}); tree(14,3);
  assert.equal(G.reachableMarks(G.world).count,0);
  child.adult=true; assert.equal(G.reachableMarks(G.world).count,1);
  child.dead=true; assert.equal(G.reachableMarks(G.world).count,0);
});
test('diagonal corner cutting is not accepted and topology changes are recomputed',()=>{
  const c=adult(2,2); for(let y=0;y<20;y++) for(let x=0;x<20;x++) G.world.water[y*20+x]=1;
  G.world.water[42]=0;G.world.water[63]=0;tree(3,3);
  assert.equal(G.reachableMarks(G.world).count,0);
  G.world.water[43]=0;assert.equal(G.reachableMarks(G.world).count,1);
  assert.ok(G.findPath(G.world,c.x,c.y,3,3));
});
test('minerals, deleted marks, and blocked-target path fallback match task pathfinding',()=>{
  adult(); G.world.marked.add(0); G.world.markedRocks.add(1);
  assert.equal(G.reachableMarks(G.world).count,0);
  G.world.rock[64]=2;G.markRockAt(G.world,4,3);tree(4,4);
  assert.equal(G.reachableMarks(G.world).count,2);
  G.world.water[84]=1;
  assert.ok(G.findPath(G.world,2,2,4,4)); assert.equal(G.reachableMarks(G.world).count,2);
});
test('reachable counts agree with actual pathfinding on generated maps',()=>{
  for (const seed of [5, 23, 41, 44, 53, 61]) {
    G.newGame(seed); const w=G.world, adults=w.citizens.filter(c=>c.adult);
    for (let n=0;n<w.trees.length;n+=97) { const t=w.trees[n];G.markFellAt(w,t.x,t.y); }
    for (let i=0;i<w.rock.length;i+=13) if(w.rock[i]) G.markRockAt(w,i%w.N,Math.floor(i/w.N));
    const expected=[...w.marked,...w.markedRocks].filter(i=>adults.some(c=>G.findPath(w,Math.round(c.x),Math.round(c.y),i%w.N,Math.floor(i/w.N)))).length;
    assert.equal(G.reachableMarks(w).count,expected,`seed ${seed}`);
  }
});
console.log(`${passed} marked reachability scenarios passed`);
