/* #87: A-style smith art follows actual accepted batches, never assignment alone. */
'use strict';
const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs'),vm=require('node:vm');
const {loadGame}=require('./helpers/playability');const root=path.resolve(__dirname,'..');let passed=0;
function fresh(){const G=loadGame(root);const context={G,console,document:{},performance:{now:()=>1000},setTimeout(){},clearTimeout(){},matchMedia:()=>({matches:false})};for(const name of ['sprites','render'])vm.runInNewContext(fs.readFileSync(path.join(root,'js',name+'.js'),'utf8'),context);G.newGame(1);const w=G.world;for(const k of ['water','rock','road'])w[k].fill(0);w.bgrid.fill(-1);w.treeIdx.fill(-1);w.trees=[];w.buildings=[];w.bmap={};w.citizens=[];w.cmap={};w.families=[];G.bumpNavigation(w);G.game.h=12;G.rng=()=>.5;G.addBuilding('storage',2,2,{instant:true,free:true});for(const k of G.RES_KEYS)G.game.res[k]=0;Object.assign(G.game.res,{wood:200,iron:100,coal:100,tools:20,grain:1000,food:1000,leather:30,wool:30});return G;}
function build(G,type,x=12,y=10){const r=G.addBuilding(type,x,y,{instant:true,free:true});assert(r.ok,r.reason);return r.b;}
function worker(G,b){const c=G.spawnCitizen({x:8,y:10,age:30,sex:'m'});c.job=b.id;b.workers=[c.id];return c;}
function until(G,c,f){for(let i=0;i<3000&&!f();i++)G.stepCitizen(c,.05);assert(f(),'expected real work transition');}
function process(type){const G=fresh(),b=build(G,type),c=worker(G,b);G.requestTask(c);assert(c.task);assert.equal(G.buildingActivity(b).active,false);until(G,c,()=>c.task?.phase==='process'&&c.state==='work');assert(G.buildingActivity(b).active);return {G,b,c};}
function home(type='house'){const G=fresh(),b=build(G,type),c=G.spawnCitizen({x:8,y:10,age:30,sex:'m',familyId:100});const f={id:100,houseId:b.id,members:[c.id]};G.world.families=[f];b.family=f.id;return {G,b,c,f};}
const test=(n,f)=>{f();passed++;console.log('ok '+n);};


test('unstaffed, assigned and fetching remain idle; real processing selects active art',()=>{
 const G=fresh(),b=build(G,'blacksmith');
 assert.equal(G.blacksmithArtName(b),'blacksmith-a-idle');
 const c=worker(G,b);assert.equal(G.blacksmithArtName(b),'blacksmith-a-idle');
 G.requestTask(c);assert.equal(c.task.kind,'smith');assert.equal(c.task.phase,'fetch');
 assert.equal(G.blacksmithArtName(b),'blacksmith-a-idle');
 until(G,c,()=>c.task?.phase==='process'&&c.state==='work');
 assert.equal(G.blacksmithArtName(b),'blacksmith');
});
test('selection is pure, does not use RNG, and pause preserves the actual batch',()=>{
 const {G,b,c}=process('blacksmith'),cargo=c.carry,task=c.task;
 const before=JSON.stringify(G.serializeGame());let rngCalls=0;G.rng=()=>{rngCalls++;throw Error('art must not draw RNG');};
 for(let i=0;i<20;i++)assert.equal(G.blacksmithArtName(b),'blacksmith');
 assert.equal(rngCalls,0);assert.equal(JSON.stringify(G.serializeGame()),before);assert.equal(c.carry,cargo);assert.equal(c.task,task);
 G.game.paused=true;assert.equal(G.blacksmithArtName(b),'blacksmith');
 const paused=JSON.stringify(G.serializeGame());G.blacksmithArtName(b);assert.equal(JSON.stringify(G.serializeGame()),paused);
});
test('live selection rejects stale activity cache, dead/remote/stopped work and missing/forged cargo',()=>{
 const {G,b,c}=process('blacksmith'),task=c.task,cargo=c.carry,x=c.x,job=c.job,left=task.workLeft;
 const cases=[()=>c.state='idle',()=>c.dead=true,()=>c.x=x+1,()=>c.job=-1,()=>c.carry=null,()=>c.carry={...cargo},()=>task.completed=true,()=>task.workLeft=0,()=>c.task=null,()=>c.state='walk'];
 for(const mutate of cases){
  c.state='work';c.dead=false;c.x=x;c.job=job;c.task=task;c.carry=cargo;task.completed=false;task.workLeft=left;
  G.prepareBuildingActivities([b],1);mutate();assert.equal(G.blacksmithArtName(b),'blacksmith-a-idle');
 }
});
test('accepted iron and steel batches keep active art until actual hauling, not production totals',()=>{
 for(const recipe of ['iron','steel']){
  const G=fresh(),b=build(G,'blacksmith');b.toolRecipe=recipe;const c=worker(G,b);
  G.requestTask(c);until(G,c,()=>c.task?.phase==='process'&&c.state==='work');
  assert.equal(G.blacksmithArtName(b),'blacksmith');
  const cargo=c.carry;b.workerLimit=0;G.setProductionGoal(recipe==='steel'?'steelTools':'tools',0);
  assert.equal(G.blacksmithArtName(b),'blacksmith','already accepted real batch remains visible');
  until(G,c,()=>c.carry!==cargo);assert.equal(G.blacksmithArtName(b),'blacksmith-a-idle');
  assert.equal(c.carry.type,recipe==='steel'?'steelTools':'tools');assert(c.carry.qty>0);
 }
});
test('shortage, winter and no new staffing stay idle without altering economics',()=>{
 const G=fresh(),b=build(G,'blacksmith');worker(G,b);G.game.res.iron=0;
 assert.equal(G.buildingActivity(b).state,'blocked');
 for(const season of [1,3]){G.game.season=season;const before=JSON.stringify(G.serializeGame());assert.equal(G.blacksmithArtName(b),'blacksmith-a-idle');assert.equal(JSON.stringify(G.serializeGame()),before);}
 b.workerLimit=0;assert.equal(G.blacksmithArtName(b),'blacksmith-a-idle');
});
test('construction, burning, removed and stale objects cannot select new smith art',()=>{
 const G=fresh(),b=build(G,'blacksmith');
 for(const state of ['site','clearing']){b.state=state;assert.equal(G.blacksmithArtName(b),null);}
 b.state='ok';b.houseFire={};assert.equal(G.blacksmithArtName(b),null);delete b.houseFire;
 assert.equal(G.blacksmithArtName({...b}),null);delete G.world.bmap[b.id];assert.equal(G.blacksmithArtName(b),null);
 assert.equal(G.blacksmithArtName(null),null);assert.equal(G.blacksmithArtName(G.world.buildings[0]),null);
});
test('both art states preserve calibration; optional idle art falls back to original working sprite',()=>{
 const {G,b,c}=process('blacksmith'),calls=[],legacy={width:512,height:469};G.SPR.map.set('blacksmith',legacy);
 const ctx=new Proxy({drawImage(...args){calls.push(args);}},{get:(o,k)=>k in o?o[k]:()=>{},set:(o,k,v)=>(o[k]=v,true)});
 for(const state of ['idle','work']){
  c.state=state;const name=G.blacksmithArtName(b),spec=G.A_ART[name];assert(spec,'calibration exists');
  const art={width:spec.source[0],height:spec.source[1]};G.SPR.map.set(name,art);calls.length=0;
  const before=JSON.stringify(G.serializeGame());G.drawBuilding(ctx,b,0);assert.equal(calls[0][0],art);assert.equal(JSON.stringify(G.serializeGame()),before);
  const [x,y]=G.T2S(b.x+b.w,b.y+b.h),k=(b.w+b.h)*32/spec.span,a=calls[0];
  assert(Math.abs(a[1]+spec.anchor[0]*k-x)<1e-9);assert(Math.abs(a[2]+spec.anchor[1]*k-y)<1e-9);assert(Math.abs(a[3]/a[4]-art.width/art.height)<1e-9);
  if(state==='idle')for(const bad of [null,{width:1,height:1}]){
   if(bad)G.SPR.map.set(name,bad);else G.SPR.map.delete(name);
   calls.length=0;G.drawBuilding(ctx,b,0);assert.equal(calls[0][0],legacy);
  }else{
   G.SPR.map.set(name,{width:1,height:1});assert.equal(G.drawCalibratedArt(ctx,name,0,0,128),null);
   G.SPR.map.delete(name);calls.length=0;assert.doesNotThrow(()=>G.drawBuilding(ctx,b,0));assert.equal(calls.length,0,'missing original sprite uses procedural fallback');
  }
 }
});
console.log(`Blacksmith art: ${passed} suites passed`);
