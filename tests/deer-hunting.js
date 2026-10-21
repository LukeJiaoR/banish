/* Encounter hunting: real walking/work, conservation and atomic snapshot migration.
 * Node simulation fixtures, not browser/visual acceptance. */
'use strict';
const assert=require('node:assert/strict'),path=require('node:path');
const {loadGame}=require('./helpers/playability');let passed=0;
const root=path.resolve(__dirname,'..'),base=process.argv[2]&&path.resolve(process.argv[2]);
const plain=x=>JSON.parse(JSON.stringify(x)),snap=G=>plain(G.serializeGame());
function fresh(){
 const G=loadGame(root);assert(G.newGame(1).ok);const w=G.world;
 for(const k of ['water','rock','road'])w[k].fill(0);w.bgrid.fill(-1);w.treeIdx.fill(-1);w.trees=[];w.buildings=[];w.bmap={};w.citizens=[];w.cmap={};w.families=[];w.marked.clear();w.markedRocks.clear();G.bumpNavigation(w);
 G.game.h=12;G.rng=()=>.5;G.addBuilding('storage',2,2,{instant:true,free:true});for(const k of G.RES_KEYS)G.game.res[k]=0;G.game.res.tools=20;
 for(let y=9;y<30;y+=2)for(let x=14;x<35;x+=2)G.addTree(w,x,y,-90);
 G.initializeDeer();for(const d of w.deer)d.returnDay=8.5;
 const original=G.genWorld;G.genWorld=(seed,opt)=>{const next=original(seed,opt);next.water.set(w.water);next.rock.set(w.rock);return next;};return G;
}
function cabin(G,x=10,y=10){const q=G.addBuilding('hunting',x,y,{instant:true,free:true});assert(q.ok);return q.b;}
function hunter(G,b,x=7,y=10){const c=G.spawnCitizen({x,y,age:30,sex:'f'});c.job=b.id;b.workers.push(c.id);return c;}
function deer(G,id=1,x=16,y=13){G.addTree(G.world,x,y,-90);Object.assign(G.world.deer[id-1],{x,y,homeX:x,homeY:y,returnDay:null,moveDay:1});return G.world.deer[id-1];}
function start(G,c){G.requestTask(c);assert.equal(c.task?.kind,'hunt');return c.task;}
function until(G,cs,cond,limit=4000){for(let i=0;i<limit&&!cond();i++)for(const c of cs)G.stepCitizen(c,.05);assert(cond(),'expected hunting progress missing');}
function kill(G,c){const t=start(G,c);until(G,[c],()=>!!c.carry);return t;}
function total(G,type){return G.game.res[type]+G.game.huntingLost[type]+G.world.citizens.reduce((sum,c)=>sum+(c.carry?.type===type?c.carry.qty:0)+(c.carry?.extra?.[type]||0),0);}
function test(name,fn){fn();passed++;console.log('ok '+name);}
test('new population is fixed, legal, deterministic and leaves original setup RNG unchanged',()=>{
 const G=loadGame(root),H=loadGame(root);G.newGame(731);H.newGame(731);assert.equal(G.world.deer.length,24);assert.deepEqual(plain(G.world.deer),plain(H.world.deer));assert(G.world.deer.every(d=>d.returnDay!==null||G.deerHabitat(G.world,d.x,d.y)));
 const old=G.rng;let calls=0;G.rng=()=>{calls++;return old();};const b={type:'hunting',state:'ok',x:G.world.start.x+5,y:G.world.start.y+5};const before=snap(G);for(let i=0;i<5;i++)G.huntingSummary(b);assert.equal(calls,0);assert.deepEqual(snap(G),before);
 if(base){const O=loadGame(base);O.newGame(731);assert.deepEqual(plain(G.world.citizens),plain(O.world.citizens));assert.equal(old(),O.rng());}
});
test('actual prey walking and complete onsite work create exactly one mixed cargo then physical delivery',()=>{
 const G=fresh(),b=cabin(G),c=hunter(G,b),d=deer(G),t=start(G,c);assert.equal(c.state,'walk');assert.equal(t.work,5);
 G.completeTask(c);assert.equal(c.carry,null);assert.equal(d.returnDay,null);assert.equal(G.game.res.meat,0);
 start(G,c);until(G,[c],()=>c.state==='work');const work=c.task.workLeft;G.stepCitizen(c,.05);assert(c.task.workLeft<work&&c.task.workLeft>0);assert.equal(c.carry,null);
 until(G,[c],()=>!!c.carry);assert.equal(c.carry.qty,160);assert.equal(c.carry.extra.leather,4);assert.equal(c.carry.huntingId,b.id);assert.equal(G.game.res.meat,0);assert.equal(d.returnDay,48);assert.equal(b.huntingReadyDay,8.5);
 until(G,[c],()=>!c.carry);assert.equal(G.game.res.meat,160);assert.equal(G.game.res.leather,4);assert.equal(b.produced.meat,160);assert.equal(b.produced.leather,4);
});
test('a fractional interrupted approach walks its final fraction before work or completion',()=>{
 const G=fresh(),b=cabin(G),c=hunter(G,b);deer(G);const t=start(G,c);c.x=t.tx-.3;c.y=t.ty;c.path=null;assert(G.sendTo(c,t.tx,t.ty));assert.equal(c.state,'walk');assert.equal(t.workLeft,t.work);until(G,[c],()=>!!c.carry);assert.equal(c.x,t.tx);assert.equal(c.y,t.ty);
});
test('one cabin reserves one deer; overlapping cabin may reserve a distinct deer',()=>{
 const G=fresh(),b=cabin(G),other=cabin(G,11,17),a=hunter(G,b),z=hunter(G,b),c=hunter(G,other);deer(G);deer(G,2,18,16);const t=start(G,a);assert.equal(G.makeTask(b,z),null);const t2=start(G,c);assert.notEqual(t.deerId,t2.deerId);until(G,[a,c],()=>!!a.carry&&!!c.carry);assert.equal(total(G,'meat'),320);assert.equal(total(G,'leather'),8);assert.equal(G.makeTask(b,z),null);
});
test('copied completions cannot duplicate a deer now or after it replenishes',()=>{
 const G=fresh(),b=cabin(G),c=hunter(G,b);deer(G);const task=start(G,c),copy={...task};until(G,[c],()=>!!c.carry);const count=total(G,'meat');G.completeHuntingTask(c,task);assert.equal(total(G,'meat'),count);until(G,[c],()=>!c.carry);G.game.day=9;G.advanceDeer();copy.workLeft=0;c.task=copy;c.x=copy.tx;c.y=copy.ty;assert(!G.completeHuntingTask(c,copy));assert.equal(total(G,'meat'),count);
});
test('paused claim does not freeze prey; reassignment, blocked targets and death release claims',()=>{
 const G=fresh(),b=cabin(G),c=hunter(G,b),other=cabin(G,11,17),z=hunter(G,other),d=deer(G);start(G,c);G.goHome(c);assert(c.pausedTask);const at=[d.x,d.y];G.game.day=1;G.advanceDeer();assert.notDeepEqual([d.x,d.y],at);d.x=at[0];d.y=at[1];d.route=[];d.progress=0;assert.equal(G.makeTask(other,z),null);G.releaseWorker(c);assert(G.makeTask(other,z));
 c.job=b.id;b.workers.push(c.id);c.state='idle';start(G,c);G.world.water[d.y*G.world.N+d.x]=1;G.stepCitizen(c,.05);assert.equal(c.task,null);assert.equal(G.huntingClaims().deer.size,0);G.world.water[d.y*G.world.N+d.x]=0;c.wanderT=0;start(G,c);G.killCitizen(c,'测试');assert.equal(G.huntingClaims().deer.size,0);assert.equal(G.game.res.meat,0);
});
test('no deer, fully claimed or unreachable prey yields no synthetic food',()=>{
 const G=fresh(),b=cabin(G),c=hunter(G,b);assert.equal(G.makeTask(b,c),null);deer(G);for(let y=0;y<G.world.N;y++)G.world.water[y*G.world.N+13]=1;G.bumpNavigation(G.world);assert.equal(G.makeTask(b,c),null);assert.equal(G.huntingSummary(b,{citizen:c}).reachable,0);assert.equal(G.game.res.meat,0);
});
test('shared cooldown lasts eight exact days independently of annual herd replenishment',()=>{
 const G=fresh(),b=cabin(G),c=hunter(G,b);deer(G);kill(G,c);until(G,[c],()=>!c.carry);G.game.day=8;G.game.h=11.9;G.advanceDeer();assert(G.huntingSummary(b).cooldownDays>0);assert.equal(G.world.deer[0].returnDay,48);G.game.h=12;G.advanceDeer();assert.equal(G.world.deer[0].returnDay,48);assert.equal(G.huntingSummary(b).cooldownDays,0);assert.equal(G.world.deer.length,24);const before=snap(G).deer;G.advanceDeer();assert.deepEqual(snap(G).deer,before);
});
test('partial meat delivery and full leather storage preserve both resources, marker and reload',()=>{
 const G=fresh(),b=cabin(G),c=hunter(G,b);deer(G);kill(G,c);G.game.res.food=G.game.res.grain=G.storageCap()-7;G.game.res.leather=G.storageCap();until(G,[c],()=>c.state==='waitStorage');assert.equal(c.carry.qty,153);assert.equal(c.carry.extra.leather,4);assert.equal(G.game.res.meat,7);
 G.applySaveData(snap(G));const cc=G.world.cmap[c.id],bb=G.world.bmap[b.id];assert.equal(cc.carry.qty,153);assert.equal(bb.huntingReadyDay,8.5);G.game.res.food-=200;G.game.res.grain-=200;G.startHaul(cc);until(G,[cc],()=>cc.carry?.type==='leather');assert.equal(cc.carry.qty,4);assert.equal(cc.carry.huntingId,b.id);assert.equal(cc.carry.staffingReturn,true);assert.equal(G.game.res.meat,160);
 G.applySaveData(snap(G));const loaded=G.world.cmap[c.id];assert.equal(loaded.carry.type,'leather');G.game.res.leather-=4;G.startHaul(loaded);until(G,[loaded],()=>!loaded.carry);assert.equal(G.game.res.leather,G.storageCap());assert.equal(G.game.huntingLost.meat,0);
});
test('no actual storage, inaccessible storage and reassignment retain cargo without fallback deposit',()=>{
 for(const mode of ['absent','blocked']){const G=fresh(),b=cabin(G),c=hunter(G,b);deer(G);kill(G,c);if(mode==='absent'){G.world.buildings.find(b=>b.type==='storage').state='site';}else{for(let y=0;y<G.world.N;y++)G.world.water[y*G.world.N+6]=1;G.bumpNavigation(G.world);}G.releaseWorker(c);assert.equal(c.state,'waitStorage');assert.equal(total(G,'meat'),160);assert.equal(total(G,'leather'),4);assert.equal(G.game.res.meat,0);G.startHaul(c);assert.equal(G.game.res.meat,0);}
});
test('death accounts exactly the remaining meat/leather once and persists the loss',()=>{
 const G=fresh(),b=cabin(G),c=hunter(G,b);deer(G);kill(G,c);G.game.res.food=G.game.res.grain=G.storageCap()-7;until(G,[c],()=>c.state==='waitStorage');G.killCitizen(c,'测试');G.killCitizen(c,'测试');assert.deepEqual(plain(G.game.huntingLost),{meat:153,leather:4});assert.equal(total(G,'meat'),160);assert.equal(total(G,'leather'),4);G.applySaveData(snap(G));assert.equal(G.game.huntingLost.meat,153);
});
test('education and pooled/individual tools use existing multipliers without dropping leather',()=>{
 for(const educated of [false,true])for(const tools of [false,true]){const G=fresh(),b=cabin(G),c=hunter(G,b);c.educated=educated;G.game.res.tools=tools?20:0;deer(G);kill(G,c);assert.equal(total(G,'meat'),Math.round((educated?200:160)*(tools?1:G.NO_TOOL_MULT)));assert.equal(total(G,'leather'),Math.round((educated?6:4)*(tools?1:G.NO_TOOL_MULT)));}
 const G=fresh(),b=cabin(G),c=hunter(G,b);deer(G);G.game.toolMode='individual';G.game.res.tools=0;c.toolType='tools';c.toolHours=100;kill(G,c);assert(c.toolHours<100);assert.equal(total(G,'meat'),160);
});
test('production and staffing pause block new hunts while already accepted work/cargo settle',()=>{
 const G=fresh(),b=cabin(G),c=hunter(G,b);deer(G);const t=start(G,c);assert(G.setWorkerLimit(b,0));assert.equal(c.staffingRelease,b.id);assert.equal(G.makeTask(b,c),null);until(G,[c],()=>!!c.carry);until(G,[c],()=>!c.carry);assert.equal(c.job,null);assert.equal(total(G,'meat'),160);
 G.setWorkerLimit(b,2);G.setProductionGoal('meat',0);G.game.day=9;G.advanceDeer();assert.equal(G.makeTask(b,c),null);assert(t.done);
});
test('square range matches existing overlay and preview excludes footprint without state/RNG edits',()=>{
 const G=fresh(),b=cabin(G),c=hunter(G,b);deer(G,1,22,22);assert.equal(G.huntingSummary(b).count,1);assert(G.makeTask(b,c));const before=snap(G),q=G.huntingSummary({type:'hunting',state:'ok',x:22,y:22});assert.equal(q.count,0);assert.deepEqual(snap(G),before);
});
test('saving a suspended hunt restarts work without refilling, moving or preserving stale claims',()=>{
 const G=fresh(),b=cabin(G),c=hunter(G,b);deer(G);start(G,c);G.goHome(c);assert(c.pausedTask);const saved=snap(G),deers=plain(G.world.deer);assert.deepEqual(saved.deer,deers);G.applySaveData(saved);const loaded=G.world.cmap[c.id];assert.equal(loaded.task,null);assert.equal(loaded.pausedTask,null);assert.equal(G.huntingClaims().deer.size,0);assert.deepEqual(plain(G.world.deer),deers);assert.equal(total(G,'meat'),0);assert.equal(G.world.bmap[b.id].huntingReadyDay,0);
});
test('clearing grazing habitat keeps living prey real; annual recovery requires habitat',()=>{
 const G=fresh(),b=cabin(G),c=hunter(G,b),d=deer(G);start(G,c);for(const t of [...G.world.trees])G.removeTree(G.world,t.x,t.y);assert.equal(d.returnDay,null);assert.equal(total(G,'meat'),0);
 G.game.day=48;G.advanceDeer();assert.equal(G.world.deer.filter(d=>d.returnDay===null).length,1);G.addTree(G.world,20,20,-90);G.game.day=96;G.advanceDeer();assert(G.world.deer.some(d=>d.returnDay===null));assert.equal(G.world.deer.length,24);assert.equal(total(G,'meat'),0);
});
test('full meat and a partially delivered leather batch record only remaining leather on death',()=>{
 const G=fresh(),b=cabin(G),c=hunter(G,b);deer(G);kill(G,c);G.game.res.leather=G.storageCap()-1;until(G,[c],()=>c.state==='waitStorage'&&c.carry?.type==='leather');assert.equal(c.carry.qty,3);assert.equal(G.game.res.meat,160);G.killCitizen(c,'测试');assert.deepEqual(plain(G.game.huntingLost),{meat:0,leather:3});
});
test('rounding near a warehouse door never remotely deposits hunting cargo',()=>{
 const G=fresh(),b=cabin(G),c=hunter(G,b);deer(G);kill(G,c);c.x=5.3;c.y=3;c.task=null;c.path=null;G.startHaul(c);assert.equal(c.state,'haul');assert.equal(G.game.res.meat,0);until(G,[c],()=>!c.carry);assert.equal(G.game.res.meat,160);assert.equal(G.game.res.leather,4);
});
test('serialization of a bare world builds detached wildlife without changing live RNG, IDs or data',()=>{
 const G=fresh();delete G.world.deer;const nextId=G._peekUid(),rng=G.rng,world=G.world;G.rng=()=>{throw new Error('wildlife snapshot consumed RNG');};const data=snap(G);assert.equal(data.deer.length,24);assert.equal(G.world,world);assert.equal(G.world.deer,undefined);assert.equal(G._peekUid(),nextId);G.rng=rng;G.applySaveData(data);assert.equal(G.world.deer.length,24);
});
test('cabin summary and legacy seeding use local doors even when the starting cart is disconnected',()=>{
 const G=fresh(),b=cabin(G),c=hunter(G,b,14,10);deer(G);for(let y=0;y<G.world.N;y++)G.world.water[y*G.world.N+7]=1;G.world.start={x:2,y:3};G.bumpNavigation(G.world);assert.equal(G.huntingSummary(b).reachable,1);assert.equal(G.huntingSummary(b,{citizen:c}).reachable,1);G.initializeDeer();assert(G.world.deer.some(d=>d.returnDay===null&&G.inHuntingRange(b,d)));assert(G.huntingSummary(b).reachable>0);
});
test('current snapshot keeps absent slots and cooldown exactly; malformed partial state rejects atomically',()=>{
 const G=fresh(),b=cabin(G),c=hunter(G,b);deer(G);kill(G,c);const saved=snap(G),deers=saved.deer;G.applySaveData(saved);assert.deepEqual(snap(G).deer,deers);assert.equal(G.world.bmap[b.id].huntingReadyDay,8.5);const current=G.world,state=snap(G);
 for(const edit of [d=>delete d.deer,d=>delete d.game.huntingLost,d=>delete d.buildings.find(x=>x.id===b.id).huntingReadyDay,d=>d.deer.pop(),d=>d.deer[1].id=d.deer[0].id,d=>d.deer[0].returnDay=999,d=>d.deer[0].generation=-1,d=>d.deer[0].moveDay=999,d=>d.deer[0].x=-1,d=>d.deer[0].returnDay='8',d=>d.deer[0].unused=true,d=>d.game.huntingLost.meat=-1,d=>d.citizens[0].carry.pastureId=b.id,d=>d.citizens[0].carry.staffingReturn=false,d=>d.citizens[0].carry.extra.wool=1]){
   const broken=plain(state);edit(broken);assert.throws(()=>G.applySaveData(broken));assert.equal(G.world,current);assert.deepEqual(snap(G),state);
 }
});
if(base)test('real pre-feature save migration preserves stocks, citizens, staffing, worker limits and old mixed cargo',()=>{
 const O=loadGame(base);O.newGame(731);const w=O.world;let b;
 for(let y=8;y<w.N-8&&!b;y++)for(let x=8;x<w.N-8&&!b;x++)if(O.canPlace(w,'hunting',x,y).ok){for(let yy=y;yy<y+2;yy++)for(let xx=x;xx<x+2;xx++)O.removeTree(w,xx,yy);b=O.addBuilding('hunting',x,y,{instant:true,free:true}).b;}
 assert(b);for(const c of w.citizens)O.releaseWorker(c);b.workerLimit=1;const c=w.citizens.find(c=>c.adult);c.job=b.id;b.workers=[c.id];c.carry={type:'meat',qty:417.5,extra:{leather:12.5}};O.game.res.grain=O.game.res.food=O.storageCap();
 const old=snap(O);assert(!Object.hasOwn(old,'deer'));const G=loadGame(root);G.newGame(1);G.applySaveData(old);assert.deepEqual(plain(G.game.res),old.game.res);assert.equal(G.world.citizens.length,old.citizens.length);assert.equal(G.world.bmap[b.id].workerLimit,1);assert.deepEqual(plain(G.world.bmap[b.id].workers),[c.id]);const got=G.world.cmap[c.id];assert.equal(got.carry.qty,417.5);assert.equal(got.carry.extra.leather,12.5);assert.equal(got.carry.staffingReturn,true);assert.equal(got.carry.huntingId,0);assert.equal(G.world.deer.length,24);assert.equal(G.world.bmap[b.id].huntingReadyDay,0);const again=snap(G);G.applySaveData(again);assert.equal(G.world.cmap[c.id].carry.qty,417.5);assert.deepEqual(snap(G).deer,again.deer);
 for(const cargo of [{type:'meat',qty:91},{type:'leather',qty:9,staffingReturn:true},{type:'meat',qty:23,extra:{leather:3}}]){
   const unassigned=plain(old);const row=unassigned.citizens.find(x=>x.id===c.id);row.job=cargo.extra?null:b.id;row.carry=cargo;unassigned.buildings.find(x=>x.id===b.id).workers=cargo.extra?[]:[c.id];unassigned.game.res.leather=G.storageCap();
   G.applySaveData(unassigned);const carried=G.world.cmap[c.id].carry;assert.equal(carried.huntingId,0);assert.equal(carried.qty,cargo.qty);if(cargo.extra)assert.deepEqual(plain(carried.extra),cargo.extra);
 }
});
if(base)test('actual old walking hunt with leather goal zero survives cabin demolition and full-storage migration',()=>{
 const O=loadGame(base);O.newGame(731);O.game.h=12;let b;
 for(let y=8;y<O.world.N-8&&!b;y++)for(let x=8;x<O.world.N-8&&!b;x++)if(O.canPlace(O.world,'hunting',x,y).ok&&O.treesInRadius(O.world,x,y,12,true).length>=20){
   for(let yy=y;yy<y+2;yy++)for(let xx=x;xx<x+2;xx++)O.removeTree(O.world,xx,yy);
   b=O.addBuilding('hunting',x,y,{instant:true,free:true}).b;
 }
 assert(b);for(const c of O.world.citizens)O.releaseWorker(c);const c=O.world.citizens.find(c=>c.adult);c.job=b.id;b.workers=[c.id];assert(O.setProductionGoal('leather',0));
 c.task=O.makeTask(b,c);assert(c.task);assert(O.sendTo(c,c.task.tx,c.task.ty));until(O,[c],()=>!!c.carry,20000);assert.deepEqual(plain(c.carry),{type:'meat',qty:10});
 O.removeBuilding(b);assert.equal(O.world.bmap[b.id],undefined);assert.equal(c.job,null);assert.deepEqual(plain(c.carry),{type:'meat',qty:10});
 O.game.res.grain=O.game.res.food=O.storageCap();const data=snap(O),G=loadGame(root);G.newGame(1);G.applySaveData(data);let loaded=G.world.cmap[c.id];
 assert.deepEqual(plain(loaded.carry),{type:'meat',qty:10,staffingReturn:true,huntingId:0});for(let i=0;i<2000;i++)G.stepCitizen(loaded,.05);
 assert.equal(loaded.carry.qty,10);assert.equal(G.game.res.meat,0);assert.equal(G.game.huntingLost.meat,0);assert.equal(loaded.state,'waitStorage');
 G.applySaveData(snap(G));loaded=G.world.cmap[c.id];assert.equal(loaded.carry.qty,10);G.game.res.grain-=10;G.game.res.food-=10;G.startHaul(loaded);until(G,[loaded],()=>!loaded.carry,20000);assert.equal(G.game.res.meat,10);assert.equal(G.game.huntingLost.meat,0);
 // The same old snapshot cannot infer provenance from a later non-meat job.
 const next=O.addBuilding('gatherer',b.x,b.y,{instant:true,free:true}).b;assert(next);c.job=next.id;next.workers=[c.id];c.task=null;c.pausedTask=null;c.carry={type:'meat',qty:10};
 G.applySaveData(snap(O));loaded=G.world.cmap[c.id];assert.equal(loaded.job,next.id);assert.equal(loaded.carry.huntingId,0);assert.equal(loaded.carry.qty,10);
});
if(base)test('unknown old pure leather remains carried through full storage, reload and explicitly counted loss',()=>{
 const O=loadGame(base);O.newGame(731);O.game.h=12;const c=O.world.citizens.find(c=>c.adult);O.releaseWorker(c);c.carry={type:'leather',qty:7.5};O.game.res.leather=O.storageCap();
 const G=loadGame(root);G.newGame(1);G.applySaveData(snap(O));let loaded=G.world.cmap[c.id];assert.equal(loaded.carry.huntingId,0);assert.equal(loaded.carry.staffingReturn,true);assert.equal(loaded.carry.qty,7.5);
 for(let i=0;i<2000;i++)G.stepCitizen(loaded,.05);assert.equal(loaded.carry.qty,7.5);assert.equal(G.game.res.leather,G.storageCap());G.applySaveData(snap(G));loaded=G.world.cmap[c.id];assert.equal(loaded.carry.qty,7.5);
 G.killCitizen(loaded,'测试');assert.equal(G.game.huntingLost.leather,7.5);assert.equal(G.game.huntingLost.meat,0);assert.equal(G.game.res.leather,G.storageCap());
});
test('legacy migration leaves explicitly marked pasture, tailor, household and other factory batches unchanged',()=>{
 const G=fresh(),b=cabin(G),c=hunter(G,b);G.enablePhysicalSupplyPrototype();
 const cargoes=[{type:'meat',qty:6,pastureId:999},{type:'leather',qty:4,pastureId:999},{type:'leather',qty:2,staffingReturn:true,coatInput:999},
   {type:'meat',qty:3,staffingReturn:true,supplyBatch:{kind:'return',to:null}},{type:'clothes',qty:1,tailorId:999},
   {type:'wood',qty:2,staffingReturn:true,fuelInput:true},{type:'grain',qty:4,brewIngredient:true}];
 for(const cargo of cargoes){const data=snap(G);delete data.deer;delete data.wildlife;delete data.game.huntingLost;for(const row of data.buildings)delete row.huntingReadyDay;
   data.citizens.find(row=>row.id===c.id).carry=cargo;const candidate=G.prepareSaveData(data),got=candidate.world.cmap[c.id].carry;assert.deepEqual(plain(got),cargo);assert.equal(got.huntingId,undefined);
 }
});
console.log(`Deer hunting: ${passed} passed`);
