'use strict';
const assert=require('node:assert/strict'),path=require('node:path');
const {loadGame}=require('./helpers/playability');let passed=0;
function fresh(){const G=loadGame(path.resolve(__dirname,'..'));G.newGame(1);const w=G.world;for(const k of ['water','rock','road'])w[k].fill(0);w.roadCount=0;w.roadBounds=null;w.bgrid.fill(-1);w.treeIdx.fill(-1);for(const k of ['trees','citizens','buildings','families'])w[k]=[];w.cmap={};w.bmap={};w.marked.clear();w.markedRocks.clear();G.game.h=12;return G;}
function test(name,f){f();passed++;console.log('ok '+name);}
function actual(G,p,x,y){const c=G.spawnCitizen({x,y,age:25,sex:'m'});c.state='walk';c.path=p;c.pi=0;c.walkKind='task';const arrive=G.arrive;G.arrive=c=>{c.state='idle';};let h=0;while(c.state==='walk'&&h<50){G.stepCitizen(c,.001);h+=.001;}G.arrive=arrive;return h;}
test('delivery chooses a farther road-served warehouse with lower real travel time',()=>{
 const G=fresh(),w=G.world,A=G.addBuilding('storage',14,14,{instant:true,free:true}).b,B=G.addBuilding('storage',4,2,{instant:true,free:true}).b;
 for(let y=5;y<=15;y++)G.setRoad(w,5,y,true);
 const route=G.storageRoute(5,15);assert.equal(route.storage,B);assert.notEqual(route.storage,A);assert(actual(G,route.path,5,15)<3.9);
});
test('default building work entry is reachable rather than an enclosed nearest pocket',()=>{
 const G=fresh(),w=G.world,b=G.addBuilding('blacksmith',10,9,{instant:true,free:true}).b;
 for(const[x,y]of[[8,9],[8,10],[8,11],[9,9],[9,11]])w.water[y*w.N+x]=1;
 const spot=G.workSpot(w,b,3,10);assert(spot);assert(G.findPath(w,3,10,spot.x,spot.y));assert.notDeepEqual({x:spot.x,y:spot.y},{x:9,y:10});
});
function oracle(G,start,goals){
 const w=G.world,N=w.N,d=Array(N*N).fill(Infinity),open=new Set([start.y*N+start.x]),closed=new Set(),ends=new Set(goals.filter(p=>!G.tileBlocked(w,p.x,p.y)).map(p=>p.y*N+p.x));d[start.y*N+start.x]=0;
 while(open.size){let k=-1;for(const i of open)if(k<0||d[i]<d[k])k=i;open.delete(k);if(ends.has(k))return d[k];closed.add(k);const x=k%N,y=Math.floor(k/N);
  for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){if(!dx&&!dy)continue;const nx=x+dx,ny=y+dy;if(G.tileBlocked(w,nx,ny)||dx&&dy&&(G.tileBlocked(w,nx,y)||G.tileBlocked(w,x,ny)))continue;const j=ny*N+nx;if(closed.has(j))continue;const n=d[k]+Math.hypot(dx,dy)*.5*(1/(w.road[k]?2.6:1.6)+1/(w.road[j]?2.6:1.6));if(n<d[j]){d[j]=n;open.add(j);}}
 }return Infinity;
}
test('multi-target envelope matches independent Dijkstra and remains consistent on edited sparse roads',()=>{
 let checked=0;
 for(let seed=1;seed<=60;seed++){
  const G=fresh(),w=G.world,N=12;w.N=N;for(const k of ['water','road','rock'])w[k]=new Uint8Array(N*N);w.bgrid=new Int32Array(N*N).fill(-1);delete w._pf;w.roadCount=0;w.roadBounds=null;
  let rnd=seed;const r=()=>((rnd=(Math.imul(rnd,1664525)+1013904223)>>>0)/4294967296);
  for(let y=0;y<N;y++)for(let x=0;x<N;x++){w.water[y*N+x]=r()<.17?1:0;if(r()<.12)G.setRoad(w,x,y,true);}
  const start={x:1,y:1},goals=Array.from({length:seed%5+1},()=>({x:Math.floor(r()*N),y:Math.floor(r()*N)}));w.water[start.y*N+start.x]=0;for(const p of goals)w.water[p.y*N+p.x]=0;
  for(let edit=0;edit<3;edit++){
   if(edit===1)for(let x=0;x<N;x++)G.setRoad(w,x,5,false);if(edit===2)for(let x=0;x<N;x++)G.setRoad(w,x,10,true);
   const route=G.findPathToAny(w,start.x,start.y,goals),want=oracle(G,start,goals);assert.equal(!!route,Number.isFinite(want));if(route)assert(Math.abs(route.eta-want)<1e-5,JSON.stringify({seed,edit,eta:route.eta,want,goals,path:route.path}));
   const box={minX:Math.min(...goals.map(p=>p.x)),maxX:Math.max(...goals.map(p=>p.x)),minY:Math.min(...goals.map(p=>p.y)),maxY:Math.max(...goals.map(p=>p.y))},fast=w.roadCount===0?1.6:2.6,tail=G.destinationFieldTail(w,box),h=(x,y)=>G.destinationLowerBound(x,y,box,fast,tail);
   for(let y=0;y<N;y++)for(let x=0;x<N;x++)if(!G.tileBlocked(w,x,y))for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){if(!dx&&!dy)continue;const nx=x+dx,ny=y+dy;if(G.tileBlocked(w,nx,ny)||dx&&dy&&(G.tileBlocked(w,nx,y)||G.tileBlocked(w,x,ny)))continue;assert(h(x,y)<=G.travelEdgeHours(w,x,y,nx,ny)+h(nx,ny)+1e-9);checked++;}
  }
 }
 console.log(JSON.stringify({consistentMultiTargetEdges:checked,editedMaps:180}));
});
test('one destination agrees with the single-goal path; blocked/empty sets never use a substitute',()=>{
 const G=fresh(),w=G.world;for(let x=2;x<12;x++)G.setRoad(w,x,8,true);
 const one=G.findPathToAny(w,2,3,[{x:12,y:9}]),p=G.findPath(w,2,3,12,9);assert.deepEqual(one.path,p);
 assert.equal(G.findPathToAny(w,2,3,[]),null);w.water[9*w.N+12]=1;assert.equal(G.findPathToAny(w,2,3,[{x:12,y:9}]),null);
 const here=G.findPathToAny(w,2,3,[{x:2,y:3},{x:5,y:5}]);assert.equal(here.path.length,0);assert.equal(here.eta,0);
});
test('production dispatch reuses one fresh target search and never serializes a world reference',()=>{
 const G=fresh(),w=G.world,b=G.addBuilding('blacksmith',10,9,{instant:true,free:true}).b,c=G.spawnCitizen({x:3,y:10,age:25,sex:'m'});G.game.res.tools=0;G.game.res.iron=10;c.job=b.id;b.workers=[c.id];
 let calls=0;const find=G.findPath;G.findPath=(...a)=>{calls++;return find(...a);};G.requestTask(c);assert.equal(calls,1);assert.equal(c.state,'walk');assert(c.task);assert(!Object.hasOwn(c.task,'dispatchRoute'));assert.doesNotThrow(()=>JSON.stringify(c.task));
});
test('road edits invalidate dispatch hints and reselect a current real entry',()=>{
 const G=fresh(),w=G.world,b=G.addBuilding('blacksmith',10,9,{instant:true,free:true}).b,c=G.spawnCitizen({x:3,y:10,age:25,sex:'m'});G.game.res.tools=0;G.game.res.iron=10;c.job=b.id;b.workers=[c.id];const t=G.makeTask(b,c),old=t.dispatchRoute;
 assert(old);assert(!JSON.stringify(t).includes('dispatchRoute'));G.setRoad(w,4,10,true);c.task=t;let calls=0;const find=G.findPath;G.findPath=(...a)=>{calls++;return find(...a);};assert(G.sendTo(c,t.tx,t.ty));assert.equal(calls,1);assert.notEqual(c.path,old.path);
});
test('removed task owner and changed world reject old dispatch hints without work or cargo loss',()=>{
 const G=fresh(),w=G.world,b=G.addBuilding('blacksmith',10,9,{instant:true,free:true}).b,c=G.spawnCitizen({x:3,y:10,age:25,sex:'m'});G.game.res.tools=0;G.game.res.iron=10;c.job=b.id;b.workers=[c.id];const t=G.makeTask(b,c);G.removeBuilding(b);c.task=t;c.carry={type:'iron',qty:3};assert.equal(G.sendTo(c,t.tx,t.ty),false);assert.equal(c.task,null);assert.equal(c.carry.qty,3);
 const H=fresh(),v=H.world,h=H.addBuilding('blacksmith',10,9,{instant:true,free:true}).b,d=H.spawnCitizen({x:3,y:10,age:25,sex:'m'});H.game.res.tools=0;H.game.res.iron=10;d.job=h.id;h.workers=[d.id];const task=H.makeTask(h,d);H.world=fresh().world;d.task=task;assert.equal(H.sendTo(d,task.tx,task.ty),false);assert.notEqual(d.state,'work');
});
test('full mineral capacity waits without search; partial delivery respects capacity and preserves cargo',()=>{
 const G=fresh(),w=G.world;G.addBuilding('storage',14,14,{instant:true,free:true});const fast=G.addBuilding('storage',4,2,{instant:true,free:true}).b;for(let y=5;y<=15;y++)G.setRoad(w,5,y,true);
 const c=G.spawnCitizen({x:5,y:15,age:25,sex:'m'});c.carry={type:'stone',qty:10};const cap=G.storageCap();G.game.res.stone=cap;let calls=0;const find=G.findPath;G.findPath=(...a)=>{calls++;return find(...a);};G.startHaul(c);assert.equal(calls,0);assert.equal(c.state,'waitStorage');assert.equal(c.carry.qty,10);
 G.game.res.stone=cap-3;G.startHaul(c);assert.equal(calls,1);assert.equal(c.haulTo,fast.id);assert.equal(G.game.res.stone,cap-3);
 for(let i=0;i<10000&&c.state==='haul';i++)G.stepCitizen(c,.001);assert.equal(G.game.res.stone,cap);assert.equal(c.carry.qty,7);assert.equal(c.state,'waitStorage');
});
test('unfinished or disconnected warehouses never become fake delivery points',()=>{
 const G=fresh(),w=G.world;w.N=24;delete w._pf;const store=G.addBuilding('storage',14,14,{instant:true,free:true}).b;
 for(let y=12;y<=18;y++)for(let x=12;x<=18;x++)if(x===12||x===18||y===12||y===18)w.water[y*w.N+x]=1;
 assert.equal(G.storageRoute(2,2),null);const c=G.spawnCitizen({x:2,y:2,age:25,sex:'m'});c.carry={type:'iron',qty:9};const before=G.game.res.iron;G.startHaul(c);assert.equal(c.state,'waitStorage');assert.equal(c.haulWait,'route');assert.equal(c.carry.qty,9);assert.equal(G.game.res.iron,before);
 store.state='site';assert.equal(G.storageRoute(13,14),null);
});
test('save reload rebuilds roads and rejects prior-world route hints',()=>{
 const G=loadGame(path.resolve(__dirname,'..'));G.newGame(1);const c=G.world.citizens.find(x=>x.adult),route=G.storageRoute(c.x,c.y);assert(route);const old=route.spot.route;
 const saved=JSON.parse(JSON.stringify(G.serializeGame()));assert(!JSON.stringify(saved).includes('dispatchRoute'));G.applySaveData(saved);const restored=G.world.cmap[c.id];assert.equal(G.routeCanReuse(old,restored,route.spot.x,route.spot.y),false);assert(G.storageRoute(restored.x,restored.y));
});
test('resuming building work chooses the fastest entry from the new position without resetting work',()=>{
 const G=fresh(),w=G.world,b=G.addBuilding('blacksmith',10,9,{instant:true,free:true}).b,c=G.spawnCitizen({x:3,y:10,age:25,sex:'m'});G.game.res.tools=0;G.game.res.iron=10;c.job=b.id;b.workers=[c.id];const t=G.makeTask(b,c);t.workLeft=2;delete t.dispatchRoute;c.pausedTask=t;c.task=null;c.x=20;c.y=10;
 let calls=0;const find=G.findPath;G.findPath=(...a)=>{calls++;return find(...a);};assert(G.resumeTask(c));assert.equal(calls,1);assert.equal(t.workLeft,2);assert(t.tx>=b.x+b.w);
});
test('a finished construction owner cannot reuse or replan an obsolete build dispatch',()=>{
 const G=fresh(),w=G.world,b=G.addBuilding('blacksmith',10,9,{free:true}).b,c=G.spawnCitizen({x:3,y:10,age:25,sex:'m'}),spot=G.workSpot(w,b,c.x,c.y);const t=G.withTaskRoute({kind:'build',b,tx:spot.x,ty:spot.y,work:2,workLeft:2},spot.route);
 b.state='ok';G.bumpNavigation(w);c.task=t;assert.equal(G.sendTo(c,t.tx,t.ty),false);assert.equal(c.task,null);assert.notEqual(c.state,'work');
});
test('woodcutter plans only one search for each real fetch and return leg',()=>{
 const G=fresh(),w=G.world;G.addBuilding('storage',4,2,{instant:true,free:true});const b=G.addBuilding('woodcutter',16,12,{instant:true,free:true}).b,c=G.spawnCitizen({x:5,y:15,age:25,sex:'m'});G.game.res.wood=100;G.game.res.firewood=0;c.job=b.id;b.workers=[c.id];
 let calls=0;const find=G.findPath;G.findPath=(...a)=>{calls++;return find(...a);};G.requestTask(c);assert.equal(calls,1);assert.equal(c.task.phase,'fetch');const t=c.task,wood=G.game.res.wood,end=c.path[c.path.length-1];c.x=end.x;c.y=end.y;calls=0;
 assert(G.firewoodFetchDone(c,t));assert.equal(calls,1);assert.equal(c.task.phase,'work');assert.equal(G.game.res.wood,wood);assert.equal(G.game.res.firewood,0);assert.equal(c.state,'walk');
});
test('wide warehouse search does not mistake stale heap entries for an unreachable route',()=>{
 const G=fresh(),w=G.world,a=G.addBuilding('storage',1,1,{instant:true,free:true}).b,b=G.addBuilding('storage',124,124,{instant:true,free:true}).b,r=G.makeRng(1);
 for(let y=0;y<w.N;y++)for(let x=0;x<w.N;x++)if(r()<.03&&!G.tileBlocked(w,x,y))G.setRoad(w,x,y,true);
 const left=G.workSpot(w,a,64,64),right=G.workSpot(w,b,64,64),route=G.storageRoute(64,64);assert(route);assert.equal(route.storage,b);assert(Math.abs(route.eta-Math.min(left.route.eta,right.route.eta))<1e-5);
 const c=G.spawnCitizen({x:64,y:64,age:25,sex:'m'});c.carry={type:'iron',qty:9};const before=G.game.res.iron;G.startHaul(c);assert.equal(c.state,'haul');assert.equal(c.haulTo,b.id);assert.equal(c.carry.qty,9);assert.equal(G.game.res.iron,before);
 console.log(JSON.stringify({roads:w.roadCount,left:left.route.eta,right:right.route.eta,chosen:route.eta,state:c.state,carry:c.carry.qty}));
});
console.log(`Fastest destination: ${passed} passed`);
