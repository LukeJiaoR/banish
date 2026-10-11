/* Focused simulation/compatibility checks; no browser acceptance claimed. */
'use strict';
const assert=require('node:assert/strict'),path=require('node:path');
const {loadGame}=require('./helpers/playability');let passed=0;
function fresh(){const G=loadGame(path.resolve(__dirname,'..'));G.newGame(1);const w=G.world;for(const k of ['water','rock','road'])w[k].fill(0);w.bgrid.fill(-1);w.treeIdx.fill(-1);for(const k of ['trees','citizens','buildings','families'])w[k]=[];w.cmap={};w.bmap={};w.marked.clear();w.markedRocks.clear();G.game.h=12;G.rng=()=>.5;G.addBuilding('storage',1,1,{instant:true,free:true});return G;}
function building(G,type,x=10){return G.addBuilding(type,x,10,{instant:true,free:true}).b;}
function citizen(G){return G.spawnCitizen({x:9,y:10,age:25,sex:'m'});}
function save(G){return JSON.parse(JSON.stringify(G.serializeGame()));}
function test(name,fn){fn();passed++;console.log('ok '+name);}
function deliver(G,c){for(let n=0;n<1000&&c.carry;n++)G.stepCitizen(c,.1);assert.equal(c.carry,null);}
test('new mines default to iron, select coal, and keep an accepted batch unchanged',()=>{
 const G=fresh(),b=building(G,'mine'),c=citizen(G);assert.equal(b.mineMode,'iron');assert.equal(b.legacyMine,false);const iron=G.makeTask(b,c);assert.equal(iron.yield.type,'iron');assert(G.setMineMode(b,'coal'));assert.equal(iron.yield.type,'iron');assert.equal(G.makeTask(b,c).yield.type,'coal');assert.equal(G.setMineMode(b,'legacy'),false);assert.equal(G.setMineMode({...b},'iron'),false);b.state='site';assert.equal(G.setMineMode(b,'iron'),false);
});
test('switching to a paused product preserves the previous task and cargo through scheduling',()=>{
 for(const kind of ['mine','blacksmith']){const G=fresh(),b=building(G,kind),c=citizen(G);G.game.res.iron=10;c.job=b.id;b.workers=[c.id];c.task=G.makeTask(b,c);c.state='work';const task=c.task;assert(task);if(kind==='mine'){G.setProductionGoal('coal',0);G.setMineMode(b,'coal')}else{G.setProductionGoal('steelTools',0);G.setToolRecipe(b,'steel')}assert(G.goalCommitment(c));G.scheduleJobs();assert.equal(c.task,task);assert.equal(c.job,b.id);c.task=null;c.carry={type:kind==='mine'?'iron':'tools',qty:2};assert(G.goalCommitment(c));}
});
test('legacy mines retain their four-stone one-iron cycle and can return to it',()=>{
 const G=fresh(),b=building(G,'mine'),c=citizen(G),s=save(G),m=s.buildings.find(x=>x.id===b.id);for(const k of ['mineMode','legacyMine','mineTick'])delete m[k];const loaded=G.prepareSaveData(s);G.world=loaded.world;G.game=loaded.game;const old=G.world.bmap[b.id],worker=G.world.cmap[c.id];assert.equal(old.mineMode,'legacy');assert(old.legacyMine);assert.deepEqual(Array.from({length:5},()=>G.makeTask(old,worker).yield.type),['stone','stone','stone','stone','iron']);assert(G.setMineMode(old,'coal'));assert(G.setMineMode(old,'legacy'));
});
test('quarry and coal batches require real delivery and coal overflow remains carried',()=>{
 for(const type of ['stonequarry','mine']){const G=fresh(),b=building(G,type),c=citizen(G);if(type==='mine')G.setMineMode(b,'coal');const resource=type==='mine'?'coal':'stone';G.game.res[resource]=0;c.task=G.makeTask(b,c);const qty=c.task.yield.qty;G.completeTask(c);assert.equal(G.game.res[resource],0);assert.equal(c.carry.type,resource);deliver(G,c);assert.equal(G.game.res[resource],qty);}
 const G=fresh(),c=citizen(G);G.game.res.coal=G.storageCap()-1;c.carry={type:'coal',qty:8};G.startHaul(c);for(let n=0;n<1000&&G.game.res.coal<G.storageCap();n++)G.stepCitizen(c,.1);assert.equal(c.carry.qty,7);assert(G.mineralDeliveryBlocked(c));G.game.res.coal-=10;deliver(G,c);assert.equal(G.game.res.coal,G.storageCap()-3);
});
test('pure mineral output respects its own stock and target; quarry does not emit iron',()=>{
 const G=fresh(),b=building(G,'mine'),q=building(G,'stonequarry',20),c=citizen(G);G.setMineMode(b,'coal');G.game.res.iron=G.storageCap();G.game.res.stone=G.storageCap();assert(G.makeTask(b,c));assert.equal(G.makeTask(q,c),null);G.game.res.stone=0;assert.equal(G.makeTask(q,c).yield.type,'stone');G.setProductionGoal('coal',0);assert.equal(G.makeTask(b,c),null);assert.equal(b.noWork,true);assert.equal(G.jobCanProduce(b),false);
});
test('steel recipe withdraws one batch on real fetch, then carries the unchanged recipe output',()=>{
 const G=fresh(),b=building(G,'blacksmith'),c=citizen(G);G.game.res.tools=0;G.game.res.iron=10;G.game.res.wood=10;G.game.res.coal=10;G.setToolRecipe(b,'steel');c.task=G.makeTask(b,c);assert.equal(c.task.yield.type,'steelTools');assert.equal(c.task.yield.qty,2);assert.equal(G.game.res.coal,10);G.setToolRecipe(b,'iron');c.job=b.id;b.workers=[c.id];G.sendTo(c,c.task.tx,c.task.ty);for(let n=0;n<2000&&!c.carry?.smithInput;n++)G.stepCitizen(c,.1);assert(c.carry?.smithInput);assert.equal(G.game.res.iron,9);assert.equal(G.game.res.wood,8);assert.equal(G.game.res.coal,8);assert.equal(G.game.res.steelTools,0);for(let n=0;n<2000&&c.carry?.smithInput;n++)G.stepCitizen(c,.1);assert.equal(c.carry.type,'steelTools');G.setWorkerLimit(b,0);deliver(G,c);G.setWorkerLimit(b,1);assert.equal(G.game.res.steelTools,2);G.setToolRecipe(b,'steel');c.educated=true;assert.equal(G.makeTask(b,c).yield.qty,3);G.game.res.coal=0;assert.equal(G.makeTask(b,c),null);assert.match(b.warnText,/煤/);assert.equal(G.jobCanProduce(b),false);
});
test('iron and steel have separate global targets and the local target follows the recipe',()=>{
 const G=fresh(),b=building(G,'blacksmith');G.game.res.tools=30;assert(G.toolLimited(b));G.setToolRecipe(b,'steel');assert.equal(G.toolLimited(b),false);G.setProductionGoal('steelTools',5);G.game.res.steelTools=5;G.updateProductionGoals();assert(G.toolLimited(b));G.setToolRecipe(b,'iron');assert(G.toolLimited(b));G.game.res.tools=0;G.updateProductionGoals();assert.equal(G.toolLimited(b),false);assert.equal(G.goalPaused('steelTools'),true);
});
test('steel-only stock removes the no-tool penalty without granting extra productivity',()=>{
 const G=fresh();G.game.res.tools=0;G.game.res.steelTools=0;assert.equal(G.taskYield(6),3);G.game.res.steelTools=1;assert(G.hasTools());assert.equal(G.taskYield(6),6);assert.equal(G.toolStock(),1);
});
test('steel lasts twice as long and does not charge the iron pool for the same labor',()=>{
 const G=fresh();G.game.res.tools=2;G.game.res.steelTools=2;for(let i=0;i<120;i++)G.wearTools(1);assert.equal(G.game.res.tools,2);assert.equal(G.game.toolWear,0);assert.equal(G.game.res.steelTools,2);assert(Math.abs(G.game.steelToolWear-.5)<1e-9);for(let i=0;i<120;i++)G.wearTools(1);assert.equal(G.game.res.steelTools,1);assert.equal(G.game.steelToolWear,0);assert.equal(G.toolDaysLeft(1),480);G.game.res.steelTools=0;G.game.res.tools=1;for(let i=0;i<120;i++)G.wearTools(1);assert.equal(G.game.res.tools,0);assert.equal(G.game.toolWear,0);
});
test('final steel wear spills only remaining labor into iron and handles fractional imported stock',()=>{
 const G=fresh();G.game.res.tools=1;G.game.res.steelTools=1;G.game.steelToolWear=.99;G.wearTools(12);assert.equal(G.game.res.steelTools,0);assert.equal(G.game.steelToolWear,0);assert(Math.abs(G.game.toolWear-.08)<1e-9);G.game.res.steelTools=.5;G.game.steelToolWear=0;G.game.toolWear=0;G.wearTools(120);assert.equal(G.game.res.steelTools,0);assert.equal(G.game.toolWear,0);assert.equal(G.game.res.tools,1);
});
test('new state round trips, while old saves default missing stock recipe and wear safely',()=>{
 const G=fresh(),b=building(G,'mine'),s=building(G,'blacksmith',20);G.setMineMode(b,'coal');G.setToolRecipe(s,'steel');G.game.res.coal=7;G.game.res.steelTools=4;G.game.steelToolWear=.3;const data=save(G),next=G.prepareSaveData(data);assert.equal(next.game.res.coal,7);assert.equal(next.game.res.steelTools,4);assert.equal(next.game.steelToolWear,.3);assert.equal(next.world.bmap[b.id].mineMode,'coal');assert.equal(next.world.bmap[s.id].toolRecipe,'steel');delete data.game.res.coal;delete data.game.res.steelTools;delete data.game.steelToolWear;delete data.buildings.find(x=>x.id===s.id).toolRecipe;const old=G.prepareSaveData(data);assert.equal(old.game.res.coal,0);assert.equal(old.game.res.steelTools,0);assert.equal(old.game.steelToolWear,0);assert.equal(old.world.bmap[s.id].toolRecipe,'iron');
});
test('invalid specialization saves reject without mutating the live world',()=>{
 const G=fresh(),b=building(G,'mine'),smith=building(G,'blacksmith',20),before=save(G);for(const corrupt of [d=>d.game.res.coal=-1,d=>d.game.steelToolWear=2,d=>d.buildings.find(x=>x.id===b.id).mineMode='gold',d=>d.buildings.find(x=>x.id===b.id).legacyMine='yes',d=>d.buildings.find(x=>x.id===smith.id).toolRecipe='gold']){const data=save(G);corrupt(data);assert.throws(()=>G.prepareSaveData(data));assert.deepEqual(save(G),before);}
});
console.log(`Resource chain: ${passed} passed`);
