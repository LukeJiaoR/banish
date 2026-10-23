/* #87: A-style tavern art follows actual brewing batches, never assignment alone. */
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
 const G=fresh(),b=build(G,'tavern');
 assert.equal(G.tavernArtName(b),'tavern');
 const c=worker(G,b);assert.equal(G.tavernArtName(b),'tavern');
 G.requestTask(c);assert.equal(c.task.kind,'brew');assert.equal(c.task.phase,'fetch');
 assert.equal(G.tavernArtName(b),'tavern');
 until(G,c,()=>c.task?.phase==='process'&&c.state==='work');
 assert.equal(G.tavernArtName(b),'tavern-a-processing');
});
test('selection is pure, does not use RNG, and pause preserves the actual batch',()=>{
 const {G,b,c}=process('tavern'),cargo=c.carry,task=c.task;
 const before=JSON.stringify(G.serializeGame());let rngCalls=0;G.rng=()=>{rngCalls++;throw Error('art must not draw RNG');};
 for(let i=0;i<20;i++)assert.equal(G.tavernArtName(b),'tavern-a-processing');
 assert.equal(rngCalls,0);assert.equal(JSON.stringify(G.serializeGame()),before);assert.equal(c.carry,cargo);assert.equal(c.task,task);
 G.game.paused=true;assert.equal(G.tavernArtName(b),'tavern-a-processing');
 const paused=JSON.stringify(G.serializeGame());G.tavernArtName(b);assert.equal(JSON.stringify(G.serializeGame()),paused);
});
test('live selection rejects stale activity cache, dead/remote/stopped work and missing/forged cargo',()=>{
 const {G,b,c}=process('tavern'),task=c.task,cargo=c.carry,x=c.x,job=c.job,left=task.workLeft;
 const cases=[()=>c.sickDays=1,()=>c.state='idle',()=>c.dead=true,()=>c.x=x+1,()=>c.job=-1,()=>c.carry=null,()=>task.completed=true,()=>task.workLeft=0,()=>c.task=null,()=>c.state='walk'];
 for(const mutate of cases){
  c.state='work';c.dead=false;c.sickDays=0;c.x=x;c.job=job;c.task=task;c.carry=cargo;task.completed=false;task.workLeft=left;
  G.prepareBuildingActivities([b],1);mutate();assert.equal(G.tavernArtName(b),'tavern');
 }
});
test('accepted grain and both fruit batches keep active art until actual hauling, not production totals',()=>{
 for(const recipe of ['grain','apples','pears']){
  const G=fresh(),b=build(G,'tavern');b.brewRecipe=recipe;G.game.res[recipe]=1000;G.reconcileFood();const c=worker(G,b);
  G.requestTask(c);until(G,c,()=>c.task?.phase==='process'&&c.state==='work');
  assert.equal(G.tavernArtName(b),'tavern-a-processing');
  const cargo=c.carry;b.workerLimit=0;G.setProductionGoal('ale',0);
  assert.equal(G.tavernArtName(b),'tavern-a-processing','already accepted real batch remains visible');
  until(G,c,()=>c.carry!==cargo);assert.equal(G.tavernArtName(b),'tavern');
  assert.equal(c.carry.type,'ale');assert(c.carry.qty>0);
 }
});
test('shortage, winter and no new staffing stay idle without altering economics',()=>{
 const G=fresh(),b=build(G,'tavern');worker(G,b);G.game.res.grain=0;G.game.res.food=0;
 assert.equal(G.buildingActivity(b).state,'blocked');
 for(const season of [1,3]){G.game.season=season;const before=JSON.stringify(G.serializeGame());assert.equal(G.tavernArtName(b),'tavern');assert.equal(JSON.stringify(G.serializeGame()),before);}
 b.workerLimit=0;assert.equal(G.tavernArtName(b),'tavern');
});
test('construction, burning, removed and stale objects cannot select new tavern art',()=>{
 const G=fresh(),b=build(G,'tavern');
 for(const state of ['site','clearing']){b.state=state;assert.equal(G.tavernArtName(b),null);}
 b.state='ok';b.houseFire={};assert.equal(G.tavernArtName(b),null);delete b.houseFire;
 assert.equal(G.tavernArtName({...b}),null);delete G.world.bmap[b.id];assert.equal(G.tavernArtName(b),null);
 assert.equal(G.tavernArtName(null),null);assert.equal(G.tavernArtName(G.world.buildings[0]),null);
});
test('both art states preserve calibration; optional brewing art falls back to original idle sprite',()=>{
 const {G,b,c}=process('tavern'),calls=[],legacy={width:448,height:320};G.SPR.map.set('tavern',legacy);
 const ctx=new Proxy({drawImage(...args){calls.push(args);}},{get:(o,k)=>k in o?o[k]:()=>{},set:(o,k,v)=>(o[k]=v,true)});
 for(const state of ['work','idle']){
  c.state=state;const name=G.tavernArtName(b),spec=G.A_ART[name];assert(spec,'calibration exists');
  const art={width:spec.source[0],height:spec.source[1]};G.SPR.map.set(name,art);calls.length=0;
  const before=JSON.stringify(G.serializeGame());G.drawBuilding(ctx,b,0);assert.equal(calls[0][0],art);assert.equal(JSON.stringify(G.serializeGame()),before);
  const [x,y]=G.T2S(b.x+b.w,b.y+b.h),k=(b.w+b.h)*32/spec.span,a=calls[0];
  assert(Math.abs(a[1]+spec.anchor[0]*k-x)<1e-9);assert(Math.abs(a[2]+spec.anchor[1]*k-y)<1e-9);assert(Math.abs(a[3]/a[4]-art.width/art.height)<1e-9);
  if(state==='work')for(const bad of [null,{width:1,height:1}]){
   if(bad)G.SPR.map.set(name,bad);else G.SPR.map.delete(name);
   calls.length=0;G.drawBuilding(ctx,b,0);assert.equal(calls[0][0],legacy);
  }else{
   G.SPR.map.set(name,{width:1,height:1});assert.equal(G.drawCalibratedArt(ctx,name,0,0,128),null);
   G.SPR.map.delete(name);calls.length=0;assert.doesNotThrow(()=>G.drawBuilding(ctx,b,0));assert.equal(calls.length,0,'missing original sprite uses procedural fallback');
  }
 }
});
test('real hosting is not brewing even with stock and an on-site healthy worker',()=>{
 const G=fresh(),b=build(G,'tavern'),c=worker(G,b);G.game.res.ale=5;G.game.res.grain=0;
 G.requestTask(c);assert.equal(c.task.kind,'host');until(G,c,()=>c.state==='work');
 assert(G.tavernStaff(b));assert.equal(G.buildingActivity(b).state,'hosting');assert.equal(G.tavernArtName(b),'tavern');
});
test('falling food reserve and illness stop brewing art immediately without consuming cargo',()=>{
 for(const mode of ['reserve','ill']){
  const {G,b,c}=process('tavern'),cargo=c.carry;
  if(mode==='reserve')G.game.res.food=0;else c.sickDays=1;
  const before=JSON.stringify(G.serializeGame());assert.equal(G.tavernArtName(b),'tavern');assert.equal(c.carry,cargo);assert.equal(JSON.stringify(G.serializeGame()),before);
 }
});
test('recipe changes cannot relabel the accepted physical batch; wrong type or quantity stays idle',()=>{
 const {G,b,c}=process('tavern'),task=c.task,cargo=c.carry,type=cargo.type,qty=cargo.qty;
 G.setTavernRecipe(b,'pears');assert.equal(task.recipe.key,'grain');assert.equal(G.tavernArtName(b),'tavern-a-processing');
 cargo.qty=qty-1;assert.equal(G.tavernArtName(b),'tavern');cargo.qty=qty;
 cargo.type='pears';assert.equal(G.tavernArtName(b),'tavern');cargo.type=type;
 cargo.brewIngredient=false;assert.equal(G.tavernArtName(b),'tavern');cargo.brewIngredient=true;
 assert.equal(G.tavernArtName(b),'tavern-a-processing');until(G,c,()=>c.carry!==cargo);assert.equal(c.carry.type,'ale');assert.equal(c.carry.qty,3);
});
test('calibrated idle and brewing preserve legacy effect dimensions and world footpoint for varied footprints',()=>{
 const G=fresh(),b=build(G,'tavern'),calls=[];
 const ctx=new Proxy({drawImage(){}},{get:(o,k)=>k in o?o[k]:()=>{},set:(o,k,v)=>(o[k]=v,true)});
 G.drawBuildingActivity=(context,building,sprite,x,y)=>calls.push({context,building,sprite:Array.from(sprite),x,y});
 for(const name of ['tavern','tavern-a-processing']){const spec=G.A_ART[name];G.SPR.map.set(name,{width:spec.source[0],height:spec.source[1]});}
 // Synthetic footprint variations isolate renderer geometry only; task semantics are covered above.
 for(const [w,h] of [[3,3],[2,3],[4,2]]){
  b.w=w;b.h=h;const width=(w+h)*32*G.BUILD_SPR_W.tavern,[x,y]=G.T2S(b.x+w,b.y+h);let previous;
  for(const name of ['tavern','tavern-a-processing']){
   G.tavernArtName=()=>name;calls.length=0;G.drawBuilding(ctx,b,0);assert.equal(calls.length,1);
   const actual=calls[0];assert.equal(actual.context,ctx);assert.equal(actual.building,b);
   assert(Math.abs(actual.sprite[0]-width)<1e-9);assert(Math.abs(actual.sprite[1]-width*320/448)<1e-9);
   assert.equal(actual.x,x);assert.equal(actual.y,y);
   const anchor=Array.from(G.buildingAnchor(b,actual.sprite,x,y,'work'));
   if(previous)assert.deepEqual(anchor,previous,'switching art cannot shift the established world work effect');previous=anchor;
  }
 }
});
console.log(`Tavern art: ${passed} suites passed`);
