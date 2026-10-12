'use strict';
const assert = require('node:assert/strict');
const {loadGame} = require('./helpers/playability');
function setup() {
  const G = loadGame(require('node:path').resolve(__dirname, '..')); G.newGame(1);
  const w = G.world; w.water.fill(0); w.rock.fill(0); w.bgrid.fill(-1); w.treeIdx.fill(-1); w.road.fill(0); w.marked.clear();
  G.tool = {kind:'road'}; G.selectRoadEndpoint(3,3); G.selectRoadEndpoint(8,3);
  return {G,w};
}
const projects = G => G.world.buildings.filter(b => b.type === 'roadwork');
function assertQueued(G, w, result) {
  assert.equal(result.ok, true); assert.equal(result.queued, 6); assert.equal(result.placed, undefined);
  const b = w.bmap[result.projectId]; assert(b); assert.equal(b.type, 'roadwork'); assert.equal(b.state, 'site');
  assert.equal(b.roadWork.cells.length, 6);
  for (let x = 3; x <= 8; x++) { assert.equal(w.road[3*w.N+x], 0); assert.equal(w.bgrid[3*w.N+x], -1); assert.equal(G.roadWorkAt(w,x,3), b); }
}
let passed=0;
function test(name, fn) { fn(); passed++; console.log('ok '+name); }
test('endpoint preview does not pave, clear, mark or spend; explicit confirm queues connected work',()=>{
  const {G,w}=setup(),res=JSON.stringify(G.game.res);assert.equal(w.road.some(Boolean),false);assert.equal(projects(G).length,0);assert.equal(w.marked.size,0);
  const r=G.confirmRoadPlan();assertQueued(G,w,r);assert.equal(JSON.stringify(G.game.res),res);assert.equal(G.roadPlan,null);
  assert.equal(projects(G).length,1);
});
test('new obstruction rejects whole route with no partial paving',()=>{const{G,w}=setup();w.rock[3*w.N+6]=2;assert.equal(G.confirmRoadPlan().ok,false);assert.equal(w.road.some(Boolean),false);assert.equal(projects(G).length,0)});
test('tree confirmation only marks; repeated confirmation cannot remove it or create wood',()=>{
  const{G,w}=setup(),i=3*w.N+5;w.treeIdx[i]=7;const wood=G.game.res.wood;const r=G.confirmRoadPlan();assert.equal(r.clearing,true);assert.equal(w.marked.has(i),true);assert.equal(w.treeIdx[i],7);assert.equal(w.road.some(Boolean),false);assert.equal(projects(G).length,0);assert.equal(G.game.res.wood,wood);assert.equal(G.confirmRoadPlan().marked,0);
  w.treeIdx[i]=-1;w.marked.delete(i);const res=JSON.stringify(G.game.res);assertQueued(G,w,G.confirmRoadPlan());assert.equal(JSON.stringify(G.game.res),res);
});
test('preview cancellation preserves previously confirmed tree work',()=>{const{G,w}=setup(),i=3*w.N+5;w.treeIdx[i]=7;G.confirmRoadPlan();G.cancelRoadPlan();assert.equal(w.marked.has(i),true);assert.equal(w.road.some(Boolean),false);assert.equal(projects(G).length,0)});
test('300 mark cap refuses entire additional clearing batch',()=>{const{G,w}=setup();for(let i=0;i<300;i++)w.marked.add(i);w.treeIdx[3*w.N+5]=7;assert.equal(G.confirmRoadPlan().ok,false);assert.equal(w.marked.size,300);assert.equal(w.marked.has(3*w.N+5),false);assert.equal(projects(G).length,0)});
test('world swap and modal guard prevent stale plan changes',()=>{const{G,w}=setup();G.world={...w};assert.equal(G.confirmRoadPlan().ok,false);assert.equal(w.road.some(Boolean),false);assert.equal(projects(G).length,0);G.world=w;G.hasOpenModal=()=>true;assert.equal(G.confirmRoadPlan().ok,false);assert.equal(w.road.some(Boolean),false);assert.equal(projects(G).length,0)});
test('confirmed clearance uses real chopping and hauling with original log yield',()=>{
 const{G,w}=setup();G.addTree(w,5,3,-200);assert(w.treeIdx[3*w.N+5]>=0);const c=w.citizens.find(c=>c.adult);w.citizens=[c];w.cmap={[c.id]:c};w.families=[];c.familyId=null;c.job=null;c.task=null;c.pausedTask=null;c.state='idle';c.x=3;c.y=3;c.wanderT=0;const initial=G.game.res.wood;
 G.confirmRoadPlan();assert.equal(G.game.res.wood,initial);let steps=0;while((w.treeIdx[3*w.N+5]>=0||c.carry||G.game.res.wood===initial)&&steps++<4000)G.advanceSim(.05);
 assert(steps<4000,'real tree job and haul completed');assert.equal(G.game.res.wood,initial+G.TREE_LOGS);assert.equal(w.road.some(Boolean),false);assert.equal(projects(G).length,0);const res=JSON.stringify(G.game.res);assertQueued(G,w,G.confirmRoadPlan());assert.equal(JSON.stringify(G.game.res),res);
});
console.log(`Road plan actions: ${passed} passed`);
