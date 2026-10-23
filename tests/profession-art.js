'use strict';
// #87: two real task accessories, not new professions, inventory or identities.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {loadGame}=require('./helpers/playability');const root=path.resolve(__dirname,'..');let passed=0;
function fresh(){const G=loadGame(root),cx={G,console,document:{},performance:{now:()=>0},matchMedia:()=>({matches:false})};for(const n of ['sprites','render'])vm.runInNewContext(fs.readFileSync(path.join(root,'js',n+'.js'),'utf8'),cx);G.newGame(1);const w=G.world;for(const k of ['water','rock','road'])w[k].fill(0);w.bgrid.fill(-1);w.treeIdx.fill(-1);w.trees=[];w.buildings=[];w.bmap={};w.citizens=[];w.cmap={};w.families=[];G.bumpNavigation(w);G.game.h=12;G.game.season=0;G.rng=()=>.5;G.addBuilding('storage',2,2,{instant:true,free:true});Object.assign(G.game.res,{wood:200,iron:100,tools:20,food:1000});return G;}
function fixture(type){const G=fresh(),r=G.addBuilding(type,12,10,{instant:true,free:true});assert(r.ok,r.reason);const b=r.b,c=G.spawnCitizen({x:8,y:10,age:30,sex:'f'});c.job=b.id;b.workers=[c.id];return {G,b,c};}
function atWork(q){const {G,c}=q;G.requestTask(c);assert(c.task);for(let i=0;i<4000&&c.state!=='work';i++)G.stepCitizen(c,.05);assert.equal(c.state,'work');assert(c.task.workLeft>0);return q;}
function ctx(){const calls=[];return {calls,canvas:new Proxy({},{get:(o,k)=>k in o?o[k]:(...args)=>calls.push([k,...args]),set:(o,k,v)=>(o[k]=v,true)})};}
const test=(n,f)=>{f();passed++;console.log('ok '+n);};
test('real miner and quarry tasks acquire accessory only after actual arrival',()=>{
 for(const type of ['mine','stonequarry']){const q=fixture(type),{G,c}=q;assert.equal(G.citizenProfessionRole(c),null);G.requestTask(c);assert(c.task.mineral);assert.equal(G.citizenProfessionRole(c),null);for(let i=0;i<4000&&c.state!=='work';i++)G.stepCitizen(c,.05);assert.equal(G.citizenProfessionRole(c),'miner');}
});
test('real farmer sowing selects hat; completed/changed crop or remote cell does not',()=>{
 const {G,b,c}=atWork(fixture('farm')),t=c.task;assert.equal(t.kind,'sow');assert.equal(G.citizenProfessionRole(c),'farmer');
 const f=b.farm[t.ti];f.sown=true;assert.equal(G.citizenProfessionRole(c),null);f.sown=false;
 t.cropYear--;assert.equal(G.citizenProfessionRole(c),null);t.cropYear++;
 const x=c.x;c.x+=1;assert.equal(G.citizenProfessionRole(c),null);c.x=x;
 const tx=t.tx;t.tx++;assert.equal(G.citizenProfessionRole(c),null);t.tx=tx;
 assert.equal(G.citizenProfessionRole(c),'farmer');
});
test('real ripe-field harvesting retains hat with valid accumulated harvest cargo, then stops at haul',()=>{
 const q=fixture('farm'),{G,b,c}=q;G.game.season=2;b.sownAll=true;b.growth=1;b.harvestDone=false;for(const f of b.farm){f.sown=true;f.harvested=false;}
 atWork(q);assert.equal(c.task.kind,'harvest');assert.equal(G.citizenProfessionRole(c),'farmer');
 c.carry={type:'wood',qty:1};assert.equal(G.citizenProfessionRole(c),null);c.carry={type:G.farmOutput(b),qty:1,brewIngredient:true};assert.equal(G.citizenProfessionRole(c),null);c.carry={type:G.farmOutput(b),qty:1};assert.equal(G.citizenProfessionRole(c),'farmer');c.state='haul';assert.equal(G.citizenProfessionRole(c),null);
});
test('job assignment alone, stale people/buildings, child/student/dead and done work never select',()=>{
 const {G,b,c}=atWork(fixture('mine')),t=c.task;const initial={state:c.state,age:c.age,adult:c.adult,job:c.job,workLeft:t.workLeft};
 for(const mutate of [()=>c.state='idle',()=>c.state='walk',()=>c.state='haul',()=>c.dead=true,()=>c.age=5,()=>c.adult=false,()=>c.student=true,()=>c.job=-1,()=>t.workLeft=0,()=>t.completed=true,()=>b.state='site',()=>b.houseFire={},()=>b.workers=[]]){
  Object.assign(c,initial,{dead:false,student:false});t.workLeft=initial.workLeft;t.completed=false;b.state='ok';delete b.houseFire;b.workers=[c.id];mutate();assert.equal(G.citizenProfessionRole(c),null);
 }
 b.workers=[c.id];Object.assign(c,initial,{dead:false,student:false});t.workLeft=initial.workLeft;t.completed=false;b.state='ok';delete b.houseFire;
 assert.equal(G.citizenProfessionRole({...c}),null);G.world.bmap[b.id]={...b};assert.equal(G.citizenProfessionRole(c),null);assert.equal(G.citizenProfessionRole(null),null);
});
test('mineral cargo, exhausted reservation and changed work point suppress the pick',()=>{
 const {G,b,c}=atWork(fixture('mine')),t=c.task;assert.equal(G.citizenProfessionRole(c),'miner');c.carry={type:'iron',qty:1};assert.equal(G.citizenProfessionRole(c),null);c.carry=null;
 t.mineralDone=true;assert.equal(G.citizenProfessionRole(c),null);t.mineralDone=false;
 const old=b.mineralUnits;b.mineralUnits=0;assert.equal(G.citizenProfessionRole(c),null);b.mineralUnits=old;
 const x=c.x;c.x+=1;assert.equal(G.citizenProfessionRole(c),null);c.x=x;assert.equal(G.citizenProfessionRole(c),'miner');
});
test('selection preserves accepted work, serialization and RNG through pause',()=>{
 for(const type of ['mine','farm']){const {G,c}=atWork(fixture(type));const before=JSON.stringify(G.serializeGame());G.rng=()=>{throw Error('render must not consume RNG');};for(let i=0;i<20;i++)assert(G.citizenProfessionRole(c));assert.equal(JSON.stringify(G.serializeGame()),before);G.game.paused=true;const paused=JSON.stringify(G.serializeGame());assert(G.citizenProfessionRole(c));assert.equal(JSON.stringify(G.serializeGame()),paused);}
});
test('miner reuses original raised-pick body; loaded farmer hat uses original bent-work body',()=>{
 for(const type of ['mine','farm']){const {G,c}=atWork(fixture(type)),names=[],q=ctx();G.sprDrawRim=(_,name)=>{names.push(name);return true;};G.drawCitizen(q.canvas,c,0,new Map());assert.equal(names[0],'adult_work_1');
 G.SPR.map.set('farmer-hat-a',{width:128,height:65});G.SPR.map.set('adult_work_0',{width:45,height:67});names.length=0;const before=JSON.stringify(G.serializeGame());G.drawCitizen(q.canvas,c,0,new Map());assert.equal(names[0],type==='mine'?'adult_work_1':'adult_work_0');assert.equal(q.calls.some(x=>x[0]==='drawImage'),type==='farm');assert.equal(JSON.stringify(G.serializeGame()),before);
 }
});
test('missing original bent body or malformed hat retains original farmer fallback without floating hat',()=>{
 const {G,c}=atWork(fixture('farm')),names=[],q=ctx();G.sprDrawRim=(_,name)=>{names.push(name);return true;};
 G.SPR.map.set('farmer-hat-a',{width:128,height:65});G.drawCitizen(q.canvas,c,0,new Map());assert.equal(names[0],'adult_work_1');assert(!q.calls.some(a=>a[0]==='drawImage'));
 names.length=0;G.SPR.map.set('adult_work_0',{width:45,height:67});G.SPR.map.set('farmer-hat-a',{width:1,height:1});G.drawCitizen(q.canvas,c,0,new Map());assert.equal(names[0],'adult_work_1');assert(!q.calls.some(a=>a[0]==='drawImage'));
});
test('hat mirrors at bent-body head and does not introduce new tool animation',()=>{
 const G=fresh(),im={width:128,height:65};for(const facing of [-1,1]){
  const q=ctx();assert(G.drawCitizenProfession(q.canvas,'farmer-hat-a',im,100,200,facing,1));assert(q.calls.some(a=>a[0]==='scale'&&a[1]===facing&&a[2]===1));
  assert.deepEqual(q.calls.find(a=>a[0]==='translate').slice(1),[100+facing*2.4,184.5]);
  const draw=q.calls.find(a=>a[0]==='drawImage');assert.equal(draw[4],9);assert.equal(draw[5],9*65/128);assert.equal(q.calls.some(a=>a[0]==='rotate'),false);
 }
 assert.equal(G.drawCitizenProfession(ctx().canvas,'farmer-hat-a',null,0,0,1,0),false);
});
console.log(`Profession art: ${passed} suites passed`);
