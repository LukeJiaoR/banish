/* Focused stone road / bridge contracts. Synthetic river, no browser claims. */
'use strict';
const assert=require('node:assert/strict'),path=require('node:path');const {loadGame}=require('./helpers/playability');let passed=0;
function fresh(){const G=loadGame(path.resolve(__dirname,'..'));G.newGame(1);const w=G.world;w.water.fill(0);w.rock.fill(0);w.road.fill(0);w.roadCount=0;delete w.roadBounds;w.bgrid.fill(-1);w.treeIdx.fill(-1);w.trees=[];w.buildings=[];w.bmap={};w.citizens=[];w.cmap={};w.families=[];w.marked.clear();w.markedRocks.clear();for(let y=0;y<w.N;y++)for(let x=10;x<=12;x++)w.water[y*w.N+x]=1;G.addBuilding('storage',1,20,{instant:true,free:true});G.rng=()=>.5;G.game.h=12;for(let i=0;i<5;i++)G.spawnCitizen({x:8,y:8+i,age:30,sex:'m'});return G;}
function test(name,fn){fn();passed++;console.log('ok '+name)}
function endpoints(G,surface,a={x:9,y:10},z={x:13,y:10}){G.tool={kind:'road',surface};G.selectRoadEndpoint(a.x,a.y);G.selectRoadEndpoint(z.x,z.y)}
test('stone upgrades cost only changed tiles and cannot downgrade or charge twice',()=>{
 const G=fresh(),w=G.world;G.setRoad(w,4,4,true);G.setRoad(w,5,4,2);const before=G.game.res.stone;endpoints(G,'stone',{x:3,y:4},{x:6,y:4});assert.equal(G.roadPlanStatus().materials.stone,3);assert.equal(G.game.res.stone,before);assert.equal(G.confirmRoadPlan().placed,3);assert.equal(G.game.res.stone,before-3);for(let x=3;x<=6;x++)assert.equal(w.road[4*w.N+x],2);assert.equal(w.roadCount,4);endpoints(G,'stone',{x:3,y:4},{x:6,y:4});assert.equal(G.confirmRoadPlan().placed,0);assert.equal(G.game.res.stone,before-3);endpoints(G,'dirt',{x:3,y:4},{x:6,y:4});assert.equal(G.confirmRoadPlan().placed,0);assert.equal(w.road[4*w.N+4],2);
});
test('insufficient stone rejects atomically and road plans never pave water',()=>{
 const G=fresh();G.game.res.stone=1;endpoints(G,'stone',{x:3,y:4},{x:6,y:4});assert.equal(G.confirmRoadPlan().ok,false);assert.equal(G.world.road.some(Boolean),false);assert.equal(G.game.res.stone,1);G.cancelRoadPlan();endpoints(G,'stone');assert.equal(G.roadPlan.result.ok,false);
});
test('stone speed is shared by movement and weighted A star and changes invalidate routes',()=>{
 const G=fresh(),w=G.world,c=w.citizens[0];G.setRoad(w,4,4,2);G.setRoad(w,5,4,2);c.x=4;c.y=4;assert.equal(G.moveSpeed(c),3.2);assert.equal(G.travelEdgeHours(w,4,4,5,4),1/3.2);const rev=w.navigationRevision;G.setRoad(w,5,4,false);assert(w.navigationRevision>rev);assert.equal(G.travelEdgeHours(w,4,4,5,4),.5*(1/3.2+1/1.6));
});
test('bridge preview snaps its major axis, validates clear two-bank geometry and spends nothing',()=>{
 const G=fresh(),before=JSON.stringify(G.game.res);endpoints(G,'bridge',{x:9,y:10},{x:13,y:11});assert.equal(G.roadPlan.end.y,10);assert(G.roadPlanStatus().ok);assert.equal(G.roadPlanStatus().materials.wood,20);assert.equal(G.roadPlanStatus().materials.stone,5);assert.equal(JSON.stringify(G.game.res),before);assert.equal(G.planBridge(G.world,{x:9,y:10},{x:13,y:11}).ok,false);assert.equal(G.planBridge(G.world,{x:10,y:10},{x:13,y:10}).ok,false);G.world.rock[10*G.world.N+13]=1;assert.equal(G.confirmRoadPlan().ok,false);assert.equal(JSON.stringify(G.game.res),before);
});
test('real reachable builders finish from shore; unfinished water remains blocked',()=>{
 const G=fresh(),w=G.world;assert.equal(G.findPath(w,8,10,14,10),null);endpoints(G,'bridge');const before=G.game.res.wood,r=G.confirmRoadPlan();assert(r.ok);const b=r.b;assert.equal(b.state,'site');assert.equal(G.game.res.wood,before-20);assert.equal(G.tileBlocked(w,11,10),true);assert.equal(G.findPath(w,8,10,14,10),null);assert(b.workers.length>0);for(let n=0;n<300&&b.state==='site';n++)G.advanceSim(.1);assert.equal(b.state,'ok');assert.equal(G.tileBlocked(w,11,10),false);const route=G.findPath(w,8,10,14,10);assert(route.some(p=>p.x===11&&p.y===10));assert.equal(G.world.water[10*w.N+11],1);assert.equal(G.surfaceSpeed(w,11,10),2.6);const c=w.citizens[0];c.x=14;c.y=10;c.job=null;c.task=null;c.carry={type:'stone',qty:6};const stock=G.game.res.stone;G.startHaul(c);for(let n=0;n<1000&&c.carry;n++)G.stepCitizen(c,.1);assert.equal(c.carry,null);assert.equal(G.game.res.stone,stock+6);
});
test('unreachable construction and insufficient material cannot create a half-bridge',()=>{
 const G=fresh(),w=G.world;w.citizens=[];const before=G.game.res.wood;assert.equal(G.addBridge({x:9,y:10},{x:13,y:10}).ok,false);assert.equal(G.game.res.wood,before);assert.equal(w.buildings.some(b=>b.type==='bridge'),false);G.spawnCitizen({x:8,y:10,age:30,sex:'m'});G.game.res.wood=0;assert.equal(G.addBridge({x:9,y:10},{x:13,y:10}).ok,false);assert.equal(w.bgrid[10*w.N+11],-1);
});
test('occupied and sole-crossing bridges reject demolition; alternate completed bridge allows it',()=>{
 const G=fresh(),w=G.world,b=G.addBridge({x:9,y:10},{x:13,y:10}).b;G.finishBuilding(b);assert.match(G.bridgeRemovalStatus(w,b).reason,/唯一跨岸/);G.removeBuilding(b);assert.equal(w.bmap[b.id],b);const other=G.addBridge({x:9,y:18},{x:13,y:18}).b;assert(other);assert.equal(G.bridgeRemovalStatus(w,b).ok,false);G.finishBuilding(other);const c=w.citizens[0];c.x=11;c.y=10;assert.match(G.bridgeRemovalStatus(w,b).reason,/桥上有人/);c.x=8;c.y=10;assert(G.bridgeRemovalStatus(w,b).ok);G.removeBuilding(b);assert.equal(w.bmap[b.id],undefined);assert.equal(G.tileBlocked(w,11,10),true);assert(G.findPath(w,8,10,14,10));
});
test('an alternative endpoint bridge cannot authorize stranding a lateral island',()=>{
 const G=fresh(),w=G.world,a=G.addBridge({x:9,y:10},{x:13,y:10}).b;G.finishBuilding(a);const b=G.addBridge({x:9,y:18},{x:13,y:18}).b;G.finishBuilding(b);w.water[11*w.N+11]=0;w.water[12*w.N+11]=0;const c=w.citizens[0];c.x=11;c.y=12;assert(G.findPath(w,11,12,8,10));assert.match(G.bridgeRemovalStatus(w,a).reason,/岛屿/);G.removeBuilding(a);assert.equal(w.bmap[a.id],a);assert(G.findPath(w,11,12,8,10));
});
test('stone grades and pending bridge geometry survive saves; legacy roads remain dirt',()=>{
 const G=fresh(),w=G.world,b=G.addBridge({x:9,y:10},{x:13,y:10}).b;G.setRoad(w,4,4,2);G.setRoad(w,5,4,true);const generate=G.genWorld;G.genWorld=(seed,options)=>{const nw=generate(seed,options);nw.water.set(w.water);nw.rock.set(w.rock);return nw;};const data=JSON.parse(JSON.stringify(G.serializeGame())),next=G.prepareSaveData(data);assert.equal(next.world.road[4*w.N+4],2);assert.equal(next.world.road[4*w.N+5],1);assert.equal(next.world.bmap[b.id].w,5);assert.equal(next.world.bmap[b.id].h,1);assert.equal(next.world.bmap[b.id].state,'site');assert(G.tileBlocked(next.world,11,10));delete data.stoneRoads;assert.equal(G.prepareSaveData(data).world.road[4*w.N+4],1);data.buildings.find(x=>x.id===b.id).bridgeLength=25;assert.throws(()=>G.prepareSaveData(data));assert.equal(G.world,w);
});
console.log(`Transport expansion: ${passed} passed`);
