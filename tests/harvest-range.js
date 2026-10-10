'use strict';
const assert = require('node:assert/strict');
const {loadGame} = require('./helpers/playability');
function setup(kind='quarry') {
 const G=loadGame(require('node:path').resolve(__dirname,'..'));G.newGame(44);const w=G.world;
 w.water.fill(0);w.rock.fill(0);w.treeIdx.fill(-1);w.bgrid.fill(-1);w.marked.clear();w.markedRocks.clear();
 G.tool={kind};return {G,w};
}
function range(G,x0,y0,x1,y1){G.beginHarvestRange(x0,y0);G.finishHarvestRange(x1,y1);return G.harvestRangeStatus()}
let passed=0;function test(n,f){f();passed++;console.log('ok '+n)}
test('reversed rectangle captures stone and iron only; preview is read-only and counts targets not yield',()=>{
 const{G,w}=setup(),a=3*w.N+3,b=4*w.N+5;w.rock[a]=1;w.rock[b]=2;G.addTree(w,4,3,-100);
 const before=JSON.stringify(G.game.res),s=range(G,5,4,3,3);assert.equal(s.counts.stone,1);assert.equal(s.counts.iron,1);assert.equal(s.counts.wood,0);assert.equal(s.added.length,2);assert.equal(w.markedRocks.size,0);
 assert.equal(G.confirmHarvestRange().marked,2);assert.equal(JSON.stringify(G.game.res),before);assert.equal(w.rock[a],1);assert(w.treeIdx[3*w.N+4]>=0);assert.equal(w.marked.size,0);
});
test('removed and replaced tree identities do not include freshly planted trees',()=>{
 const{G,w}=setup('fell');G.addTree(w,3,3,-100);G.addTree(w,4,3,-100);range(G,3,3,5,3);
 G.removeTree(w,3,3);G.addTree(w,3,3,-99);G.addTree(w,5,3,-100);
 assert.equal(G.confirmHarvestRange().marked,1);assert.deepEqual([...w.marked],[3*w.N+4]);
});
test('removed mineral and changed mineral type are omitted; new mineral outside snapshot stays unmarked',()=>{
 const{G,w}=setup();w.rock[3*w.N+3]=1;w.rock[3*w.N+4]=2;w.rock[3*w.N+5]=1;range(G,3,3,6,3);
 w.rock[3*w.N+3]=0;w.rock[3*w.N+4]=1;w.rock[3*w.N+6]=2;assert.equal(G.confirmHarvestRange().marked,1);assert.deepEqual([...w.markedRocks],[3*w.N+5]);
});
test('queue cap refuses whole batch; existing marks count once; waiting for capacity permits explicit retry',()=>{
 const{G,w}=setup();for(let i=0;i<299;i++)w.markedRocks.add(i);w.rock[5*w.N+3]=1;w.rock[5*w.N+4]=2;range(G,3,5,4,5);
 assert.equal(G.confirmHarvestRange().ok,false);assert.equal(w.markedRocks.size,299);w.markedRocks.delete(0);assert.equal(G.confirmHarvestRange().marked,2);assert.equal(w.markedRocks.size,300);
 const s=range(G,3,5,4,5);assert.equal(s.existing,2);assert.equal(s.added.length,0);assert.equal(G.confirmHarvestRange().marked,0);
});
test('preview cancel leaves previous work and active/paused tasks/cargo untouched',()=>{
 const{G,w}=setup();w.rock[3*w.N+3]=1;w.markedRocks.add(3*w.N+3);const c=w.citizens[0];c.task={k:'mineRock',tx:3,ty:3};c.pausedTask={k:'mineRock',tx:3,ty:3};c.carry={type:'stone',amt:4};const before=JSON.stringify(c);
 range(G,3,3,3,3);G.cancelHarvestPlan();assert.equal(w.markedRocks.size,1);assert.equal(JSON.stringify(c),before);
});
test('press intent cannot confirm a replaced plan or changed live target list',()=>{
 const{G,w}=setup();w.rock[3*w.N+3]=1;w.rock[3*w.N+4]=2;let s=range(G,3,3,4,3);const intent={plan:s.plan,signature:s.signature};w.rock[3*w.N+3]=0;
 assert.equal(G.confirmHarvestRange(intent).ok,false);assert.equal(w.markedRocks.size,0);s=G.harvestRangeStatus();assert.equal(G.confirmHarvestRange({plan:s.plan,signature:s.signature}).marked,1);
 s=range(G,4,3,4,3);range(G,4,3,4,3);assert.equal(G.confirmHarvestRange({plan:s.plan,signature:s.signature}).ok,false);
});
test('world/tool/modal guards and empty rectangles are read-only',()=>{
 const{G,w}=setup();assert.equal(range(G,3,3,4,4).ok,false);w.rock[3*w.N+3]=1;range(G,3,3,3,3);G.hasOpenModal=()=>true;assert.equal(G.confirmHarvestRange().ok,false);G.hasOpenModal=()=>false;G.tool={kind:'fell'};assert.equal(G.confirmHarvestRange().ok,false);G.tool={kind:'quarry'};G.world={...w};assert.equal(G.confirmHarvestRange().ok,false);assert.equal(w.markedRocks.size,0);
});
test('bounds clamp and huge range retains at most 601 targets and refuses truncation',()=>{
 const{G,w}=setup();w.rock.fill(1);range(G,-100,-100,w.N+100,w.N+100);assert.equal(G.harvestPlan.total,w.N*w.N);assert.equal(G.harvestPlan.targets.length,601);assert.equal(G.confirmHarvestRange().ok,false);assert.equal(w.markedRocks.size,0);
});
test('touch first corner supports single-cell confirm or a second corner',()=>{
 const{G,w}=setup();w.rock[3*w.N+3]=1;w.rock[3*w.N+4]=2;G.selectHarvestCorner(3,3);assert.equal(G.harvestRangeStatus().added.length,1);assert.equal(G.harvestPlan.awaitingSecond,true);G.selectHarvestCorner(4,3);assert.equal(G.harvestRangeStatus().added.length,2);assert.equal(G.harvestPlan.awaitingSecond,false);assert.equal(G.confirmHarvestRange().marked,2);
});
console.log(`Harvest range: ${passed} passed`);
