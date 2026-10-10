'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(process.argv[2]||path.join(__dirname,'..'));let passed=0;
function fresh(N=40){
 const ctx={console};ctx.window=ctx;vm.createContext(ctx);
 for(const f of ['core','defs','map','sim']){
  let s=fs.readFileSync(path.join(root,'js',f+'.js'),'utf8');
  if(f==='map')s=s.replace('let iter = 0, found = false;','let iter = 0, found = false; G.testExpanded = 0;').replace('pf.closed[cur] = gen;','pf.closed[cur] = gen; G.testExpanded++;');
  vm.runInContext(s,ctx,{filename:f+'.js'});
 }
 const G=ctx.G;
 G.world={N,water:new Uint8Array(N*N),road:new Uint8Array(N*N),rock:new Uint8Array(N*N),bgrid:new Int32Array(N*N).fill(-1),treeIdx:new Int32Array(N*N).fill(-1),bmap:{},buildings:[],trees:[],marked:new Set(),markedRocks:new Set(),citizens:[],cmap:{},families:[],start:{x:2,y:2}};
 G.game=G.newGameState();G.game.h=12;G.ui={toast(){}};return G;
}
function citizen(G,s,p){const c=G.spawnCitizen({...s,age:30,sex:'m'});Object.assign(c,{path:p,pi:0,state:'walk',walkKind:'task',task:{kind:'work',work:7,workLeft:3}});return c;}
function cost(w,s,p){if(!p)return Infinity;let n=0,a=s;for(const b of p){n+=Math.hypot(b.x-a.x,b.y-a.y)*.5*(1/(w.road[a.y*w.N+a.x]?2.6:1.6)+1/(w.road[b.y*w.N+b.x]?2.6:1.6));a=b;}return n;}
function oracle(G,s,t){
 const w=G.world,N=w.N,d=Array(N*N).fill(Infinity),seen=new Set(),open=new Set([s.y*N+s.x]);d[s.y*N+s.x]=0;
 while(open.size){
  let k=-1;for(const i of open)if(k<0||d[i]<d[k])k=i;open.delete(k);if(k===t.y*N+t.x)return d[k];seen.add(k);
  const x=k%N,y=Math.floor(k/N);
  for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
   if(!dx&&!dy)continue;const nx=x+dx,ny=y+dy;
   if(G.tileBlocked(w,nx,ny)||dx&&dy&&(G.tileBlocked(w,nx,y)||G.tileBlocked(w,x,ny)))continue;
   const j=ny*N+nx;if(seen.has(j))continue;
   const v=d[k]+Math.hypot(dx,dy)*.5*(1/(w.road[k]?2.6:1.6)+1/(w.road[j]?2.6:1.6));
   if(v<d[j]){d[j]=v;open.add(j);}
  }
 }
 return Infinity;
}
function actual(G,s,p,dt=.001,carry=false,winter=false){G.game.season=winter?3:0;const c=citizen(G,s,p.map(p=>({...p})));if(carry)c.carry={type:'wood',qty:2};let h=0;for(let n=0;n<100000&&c.state==='walk';n++){G.stepCitizen(c,dt);h+=dt;}assert.notEqual(c.state,'walk');return h;}
function uRoad(w){for(let x=3;x<=23;x++)w.road[9*w.N+x]=1;for(let y=9;y<=12;y++)for(const x of [3,23])w.road[y*w.N+x]=1;}
function building(G,x,y,w=1,h=1){const b={id:G.nextId(),type:'house',state:'ok',x,y,w,h,workers:[]};G.world.bmap[b.id]=b;G.world.buildings.push(b);for(let yy=y;yy<y+h;yy++)for(let xx=x;xx<x+w;xx++)G.world.bgrid[yy*G.world.N+xx]=b.id;return b;}
function test(n,f){f();passed++;console.log('ok '+n);}
test('longer road route minimizes travel time, agrees with Dijkstra and actual movement',()=>{
 const G=fresh(),w=G.world,s={x:3,y:12},t={x:23,y:12};uRoad(w);
 const p=G.findPath(w,s.x,s.y,t.x,t.y),eta=cost(w,s,p),nodes=G.testExpanded;
 assert(p.length>20);assert(Math.abs(eta-oracle(G,s,t))<1e-5);assert(Math.abs(actual(G,s,p)-eta)<.004);assert(eta<10);assert(nodes<200);
 console.log(JSON.stringify({eta,expanded:nodes,steps:p.length}));
});
test('both halves of a road transition and exact diagonal length match the movement model',()=>{
 const G=fresh(),w=G.world;
 for(const reverse of [false,true]){w.road.fill(0);w.road[4*w.N+(reverse?4:5)]=1;const s={x:4,y:4},p=G.findPath(w,4,4,5,4),eta=G.travelEdgeHours(w,4,4,5,4);assert(Math.abs(eta-.5048076923)<1e-9);assert(Math.abs(actual(G,s,p,.0001)-eta)<.0003);}
 w.road.fill(0);assert(Math.abs(G.travelEdgeHours(w,4,4,5,5)-Math.SQRT2/1.6)<1e-12);
});
test('winter and carried goods scale actual travel without changing the optimal route',()=>{
 const G=fresh(),s={x:3,y:12},t={x:23,y:12};uRoad(G.world);const p=G.findPath(G.world,s.x,s.y,t.x,t.y),eta=cost(G.world,s,p);
 for(const carry of [false,true])for(const winter of [false,true])assert(Math.abs(actual(G,s,p,.001,carry,winter)-eta/(carry?.9:1)/(winter?.75:1))<.012);
});
test('60 fixed random maps match independent Dijkstra including disconnected and corner cases',()=>{
 for(let seed=1;seed<=60;seed++){const G=fresh(12),w=G.world,r=G.makeRng(seed);for(let i=0;i<144;i++){w.water[i]=r()<.18?1:0;w.road[i]=r()<.25?1:0;}const s={x:1,y:1},t={x:10,y:10};w.water[13]=w.water[130]=0;const p=G.findPath(w,1,1,10,10),a=cost(w,s,p),b=oracle(G,s,t);assert(a===b||Math.abs(a-b)<1e-5,'seed '+seed);}
});
test('road edits affect new routes; no route cache returns the old field path',()=>{const G=fresh(),w=G.world,s={x:3,y:12};const a=G.findPath(w,3,12,23,12);assert.equal(a.length,20);uRoad(w);const b=G.findPath(w,3,12,23,12);assert(cost(w,s,b)<cost(w,s,a));w.road.fill(0);assert.equal(G.findPath(w,3,12,23,12).length,20);});
test('new building blocks an in-flight segment: physical detour preserves task progress',()=>{
 const G=fresh(),p=G.findPath(G.world,2,5,10,5),c=citizen(G,{x:2,y:5},p),t=c.task;building(G,4,5);
 for(let n=0;n<300&&c.state==='walk';n++){G.stepCitizen(c,.05);assert(!(Math.round(c.x)===4&&Math.round(c.y)===5));}
 assert.equal(c.state,'work');assert.equal(c.task,t);assert.equal(c.task.workLeft,3);assert.equal(c.x,10);assert.equal(c.y,5);
});
test('new diagonal corner is not cut, including a fractional starting position',()=>{
 const G=fresh(),c=citizen(G,{x:2.1,y:2.1},[{x:3,y:3},{x:4,y:4}]);building(G,3,2);assert(G.pathStepBlocked(G.world,c,c.path[0]));const before={x:c.x,y:c.y};G.stepCitizen(c,.01);assert.equal(c.x,before.x);assert.equal(c.y,before.y);assert(!G.pathStepBlocked(G.world,c,c.path[0]));
});
test('unreachable new wall retains cargo and task with bounded retry; opening it resumes',()=>{
 const G=fresh(12),w=G.world,store=building(G,10,4,2,2);store.type='storage';const c=citizen(G,{x:2,y:5},G.findPath(w,2,5,9,5));c.state='haul';c.task=null;c.haulTo=store.id;c.carry={type:'stone',qty:9};for(let y=0;y<12;y++)building(G,3,y);
 let calls=0;const path=G.findPath;G.findPath=(...args)=>{calls++;return path(...args);};for(let n=0;n<100;n++)G.stepCitizen(c,.01);
 assert(calls<=1);assert.equal(c.x,2);assert.equal(c.carry.qty,9);assert.equal(c.task,null);assert.equal(c.state,'waitStorage');assert.equal(G.mineralDeliveryBlocked(c),true);w.bgrid[5*12+3]=-1;
 for(let n=0;n<30&&c.x===2;n++)G.stepCitizen(c,.1);assert(c.x>2);assert.equal(c.carry.qty,9);
});
test('ordinary path execution does not start per-frame searches',()=>{const G=fresh(),c=citizen(G,{x:2,y:5},G.findPath(G.world,2,5,10,5));let calls=0;G.findPath=()=>{calls++;throw Error('unexpected path search');};for(let n=0;n<10;n++)G.stepCitizen(c,.01);assert.equal(calls,0);});
test('fractional reroute first leg stays in its rounded column, not a false diagonal corner',()=>{
 const G=fresh(),c=citizen(G,{x:2.2,y:5.3},[{x:2,y:6},{x:2,y:7}]);building(G,3,6);
 assert.equal(G.pathStepBlocked(G.world,c,c.path[0]),false);
 for(let n=0;n<100&&c.state==='walk';n++)G.stepCitizen(c,.05);
 assert.equal(c.state,'work');assert.equal(c.x,2);assert.equal(c.y,7);
});
test('blocked physical task endpoint cannot arrive at an arbitrary nearby substitute',()=>{
 const G=fresh(),c=citizen(G,{x:2,y:5},G.findPath(G.world,2,5,5,5));c.task.kind='chop';building(G,5,5);
 for(let n=0;n<200;n++)G.stepCitizen(c,.02);
 assert.notEqual(c.state,'work');assert.equal(c.task,null);assert(G.tileBlocked(G.world,5,5));
});
test('blocked warehouse doorway reroutes to a real storage edge and does not deposit early',()=>{
 const G=fresh(),b=building(G,10,4,2,2);b.type='storage';const c=citizen(G,{x:2,y:5},G.findPath(G.world,2,5,9,5));c.state='haul';c.task=null;c.haulTo=b.id;c.carry={type:'stone',qty:9};c.haulPending=true;G.game.res.stone=0;
 building(G,9,5);for(let n=0;n<100&&c.x<8;n++)G.stepCitizen(c,.05);assert.equal(G.game.res.stone,0);assert.equal(c.carry.qty,9);
 for(let n=0;n<500&&c.carry;n++)G.stepCitizen(c,.05);assert.equal(G.game.res.stone,9);assert.equal(c.carry,null);assert(!G.tileBlocked(G.world,Math.round(c.x),Math.round(c.y)));
});
test('blocked home doorstep uses another real doorway, not a nearby arbitrary rest spot',()=>{
 const G=fresh(),home=building(G,10,4,2,2),c=citizen(G,{x:2,y:5},G.findPath(G.world,2,5,9,5));c.task=null;c.walkKind='home';G.homeOf=()=>home;building(G,9,5);
 for(let n=0;n<500&&c.state==='walk';n++)G.stepCitizen(c,.02);assert.equal(c.state,'rest');assert.equal(c.camped,false);
 assert(c.x>=9&&c.x<=12&&c.y>=3&&c.y<=6);assert(c.x<10||c.x>=12||c.y<4||c.y>=6);assert(!G.tileBlocked(G.world,c.x,c.y));
});
test('known road counts survive all supported writes/load; unknown maps use safe lower bound',()=>{
 const {loadGame}=require('./helpers/playability'),G=loadGame(root);G.newGame(1);const w=G.world;assert.equal(w.roadCount,0);
 const spots=[];for(let y=2;y<w.N-2&&spots.length<3;y++)for(let x=2;x<w.N-2&&spots.length<3;x++)if(G.canPlaceRoad(w,x,y)&&w.treeIdx[y*w.N+x]<0)spots.push({x,y});assert.equal(spots.length,3);
 const [a,b,c]=spots;G.paintRoad(a.x,a.y,a.x,a.y);assert.equal(w.roadCount,1);G.paintRoad(a.x,a.y,a.x,a.y);assert.equal(w.roadCount,1);
 G.tool={kind:'road'};G.hasOpenModal=()=>false;G.roadPlan={world:w,start:b,end:c,result:{ok:true,path:[b,c]},message:''};assert.equal(G.confirmRoadPlan().placed,2);assert.equal(w.roadCount,3);
 G.demolishAt(a.x,a.y);assert.equal(w.roadCount,2);const save=JSON.parse(JSON.stringify(G.serializeGame())),loaded=G.prepareSaveData(save);assert.equal(loaded.world.roadCount,2);assert.equal(loaded.world.road.reduce((n,x)=>n+x,0),2);
 G.newGame(2);assert.equal(G.world.roadCount,0);
 const H=fresh(),hw=H.world;uRoad(hw);assert.equal(hw.roadCount,undefined);assert(Math.abs(cost(hw,{x:3,y:12},H.findPath(hw,3,12,23,12))-oracle(H,{x:3,y:12},{x:23,y:12}))<1e-5);
});
test('sparse-road endpoint bound remains consistent and Dijkstra-optimal across edits',()=>{
 let edges=0;
 for(let seed=1;seed<=80;seed++){
  const G=fresh(12),w=G.world,r=G.makeRng(seed);w.roadCount=0;
  for(let i=0;i<9;i++)G.setRoad(w,2+Math.floor(r()*3),2+Math.floor(r()*3),true);
  const goal={x:Math.floor(r()*12),y:Math.floor(r()*12)},start={x:Math.floor(r()*12),y:Math.floor(r()*12)};
  for(const mode of ['initial','removed','added']){
   if(mode==='removed')G.setRoad(w,2,2,false);if(mode==='added')G.setRoad(w,10,10,true);
   const tail=G.roadExitDistance(w,goal.x,goal.y),H=(x,y)=>G.travelLowerBound(goal.x-x,goal.y-y,2.6,tail);
   assert.equal(H(goal.x,goal.y),0);
   for(let y=0;y<12;y++)for(let x=0;x<12;x++)for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
    if(!dx&&!dy||x+dx<0||y+dy<0||x+dx>=12||y+dy>=12)continue;
    assert(H(x,y)<=G.travelEdgeHours(w,x,y,x+dx,y+dy)+H(x+dx,y+dy)+1e-10);edges++;
   }
   const p=G.findPath(w,start.x,start.y,goal.x,goal.y);assert(Math.abs(cost(w,start,p)-oracle(G,start,goal))<1e-5);
  }
 }
 console.log(JSON.stringify({consistentEdges:edges,editedSparseMaps:240}));
});
console.log(`Travel time: ${passed} passed; continuous-limit ETA, not exact finite-step integration or mobile timings.`);
