/* #89: actual task/occupancy presentation; no simulation or save mutation. */
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


test('unstaffed, assigned idle, fetching, actual processing, stale cache and stopped work',()=>{
 const G=fresh(),b=build(G,'woodcutter');
 assert.equal(G.woodcutterArtName(b),'woodcutter-a-idle');
 const c=worker(G,b);assert.equal(G.woodcutterArtName(b),'woodcutter-a-idle');
 G.requestTask(c);assert.equal(c.task.phase,'fetch');assert.equal(G.woodcutterArtName(b),'woodcutter-a-idle');
 until(G,c,()=>c.task?.phase==='process'&&c.state==='work');
 assert.equal(G.woodcutterArtName(b),'woodcutter-a-processing-v2');
 const before=JSON.stringify(G.serializeGame());for(let i=0;i<20;i++)G.woodcutterArtName(b);assert.equal(JSON.stringify(G.serializeGame()),before);
 G.game.paused=true;assert.equal(G.woodcutterArtName(b),'woodcutter-a-processing-v2');G.game.paused=false;
 G.prepareBuildingActivities([b],1);c.state='idle';assert.equal(G.woodcutterArtName(b),'woodcutter-a-idle');
 c.state='work';c.task.workLeft=0;assert.equal(G.woodcutterArtName(b),'woodcutter-a-idle');
 b.houseFire={};assert.equal(G.woodcutterArtName(b),null);
});
test('resource shortage, disabled new batches, winter and missing asset fallback',()=>{
 const G=fresh(),b=build(G,'woodcutter'),c=worker(G,b);G.game.res.wood=0;
 assert.equal(G.buildingActivity(b).state,'blocked');assert.equal(G.woodcutterArtName(b),'woodcutter-a-idle');
 G.game.season=3;assert.equal(G.woodcutterArtName(b),'woodcutter-a-idle');
 assert.equal(G.drawCalibratedArt({drawImage(){}},G.woodcutterArtName(b),0,0,128),null);
 b.workerLimit=0;assert.equal(G.woodcutterArtName(b),'woodcutter-a-idle');
});
test('processing tool pose has no raw-log overlay; carrying/returning retains cargo art',()=>{
 const {G,b,c}=process('woodcutter'),cargo=c.carry,calls=[];
 const ctx=new Proxy({},{get:(o,k)=>o[k]||(()=>{}),set:(o,k,v)=>(o[k]=v,true)});
 G.sprDrawRim=(ctx,name)=>{calls.push(name);return true;};G.sprDraw=(ctx,name)=>{calls.push(name);return [10,10];};
 G.drawCitizen(ctx,c,1,new Map());assert(calls.includes('adult_work_0'));assert(!calls.includes('carry_wood'));assert.equal(c.carry,cargo);
 const target=G.citizenWorkTarget(c);assert.equal(target.x,b.x+(b.w-1)/2);assert.equal(target.y,b.y+(b.h-1)/2);
 calls.length=0;c.state='walk';G.drawCitizen(ctx,c,1,new Map());assert(calls.some(n=>n.startsWith('adult_carry_walk_')));assert(calls.includes('carry_wood'));assert.equal(c.carry,cargo);
});
console.log(`Woodcutter art: ${passed} suites passed`);
