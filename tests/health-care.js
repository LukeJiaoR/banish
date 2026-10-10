'use strict';
const assert=require('node:assert/strict'),path=require('node:path');
const {loadGame}=require('./helpers/playability');let passed=0;
function fresh(){const G=loadGame(path.resolve(__dirname,'..'));G.newGame(1);const w=G.world;for(const k of ['water','rock','road'])w[k].fill(0);w.bgrid.fill(-1);w.treeIdx.fill(-1);for(const k of ['trees','citizens','buildings','families'])w[k]=[];w.cmap={};w.bmap={};w.marked.clear();w.markedRocks.clear();G.game.h=12;G.rng=()=>.5;G.addBuilding('storage',1,1,{instant:true,free:true});return G;}
function citizen(G,x=9,y=10){return G.spawnCitizen({x,y,age:25,sex:'m'});}
function clinic(G,type='hospital'){return G.addBuilding(type,10,10,{instant:true,free:true}).b;}
function staff(G,b){const c=citizen(G,9,10);c.job=b.id;b.workers=[c.id];c.task={kind:'clinic',b,tx:9,ty:10,work:4,workLeft:4};c.state='work';return c;}
function test(name,fn){fn();passed++;console.log('ok '+name);}
test('mature forest produces herbs at a reachable tree and real haul delivers them',()=>{
 const G=fresh(),b=clinic(G,'herbalist');for(let y=15;y<19;y++)for(let x=10;x<16;x++)G.addTree(G.world,x,y,-200);const c=staff(G,b);c.task=G.makeHerbalistTask(b,c);assert.equal(c.task.yield.type,'herbs');assert(!G.tileBlocked(G.world,c.task.tx,c.task.ty));const q=c.task.yield.qty;G.completeTask(c);assert.equal(G.game.res.herbs,0);assert.equal(c.carry.qty,q);for(let n=0;n<600&&G.game.res.herbs<q;n++)G.stepCitizen(c,.1);assert(G.game.res.herbs>=q);
});
test('herbs alone do not heal; staffed reachable hut consumes exactly one after arrival',()=>{
 const G=fresh(),b=clinic(G,'herbalist'),c=citizen(G);c.health=2;G.game.res.herbs=3;assert.equal(G.tryMedicalCare(c),false);c.careRetryH=0;const h=staff(G,b);assert(G.tryMedicalCare(c));assert.equal(c.state,'work');G.stepCitizen(c,2);assert.equal(c.health,2);G.stepCitizen(c,1);assert.equal(c.health,2.5);assert.equal(G.game.res.herbs,2);assert.equal(c.herbCooldown,4);assert.equal(G.tryMedicalCare(c),false);assert.equal(G.isSick(h),false);
});
test('hospital requires an actual healthy doctor on site and accelerates recovery without herbs',()=>{
 const G=fresh(),b=clinic(G),c=citizen(G);c.sickDays=1;const doc=staff(G,b);doc.state='walk';assert.equal(G.tryMedicalCare(c),false);c.careRetryH=0;doc.state='work';assert(G.tryMedicalCare(c));assert(G.inMedicalCare(c));G.stepCitizen(c,12);assert.equal(c.careHours,12);assert(G.isSick(c));G.stepCitizen(c,12);assert.equal(c.sickDays,0);assert.equal(c.immunityDays,12);assert.equal(G.game.res.herbs,0);
});
test('unreachable clinics and full beds are not reserved, and removing a clinic releases patients',()=>{
 const G=fresh(),b=clinic(G),doc=staff(G,b),c=citizen(G,20,10);c.sickDays=1;for(let y=0;y<G.world.N;y++)G.world.water[y*G.world.N+15]=1;G.bumpNavigation(G.world);assert.equal(G.tryMedicalCare(c),false);assert.equal(G.medicalPatients(b).length,0);c.x=9;c.careRetryH=0;G.HEALTH.hospitalBeds=1;assert(G.tryMedicalCare(c));const second=citizen(G,9,11);second.sickDays=1;assert.equal(G.tryMedicalCare(second),false);G.removeBuilding(b);assert.equal(c.task,null);assert.equal(c.sickDays,1);assert.equal(doc.job,null);
});
test('lost doctor pauses care and releases a waiting citizen without a false cure',()=>{
 const G=fresh(),b=clinic(G),c=citizen(G);c.sickDays=1;const doc=staff(G,b);assert(G.tryMedicalCare(c));G.stepCitizen(c,5);doc.sickDays=1;G.stepCitizen(c,11);assert.equal(c.careHours,5);assert(G.isSick(c));G.stepCitizen(c,1);assert.equal(c.task,null);assert.equal(c.sickDays,1);
});
test('new saves preserve health and partial treatment; legacy import gives a fresh grace year',()=>{
 const G=fresh(),b=clinic(G),c=citizen(G);staff(G,b);c.health=2.25;c.sickDays=3;c.careHours=7;c.immunityDays=0;G.game.res.herbs=6;G.game.day=200;G.game.year=5;G.game.season=0;const save=JSON.parse(JSON.stringify(G.serializeGame()));const next=G.prepareSaveData(save);assert.equal(next.world.cmap[c.id].careHours,7);assert.equal(next.world.cmap[c.id].health,2.25);assert.equal(next.game.res.herbs,6);assert.equal(next.world.cmap[c.id].task,null);delete save.game.res.herbs;delete save.game.healthStartDay;for(const ci of save.citizens)for(const key of ['health','sickDays','careHours','immunityDays','herbCooldown'])delete ci[key];const old=G.prepareSaveData(save);assert.equal(old.world.cmap[c.id].health,4);assert.equal(old.game.healthStartDay,200);assert.equal(old.game.res.herbs,0);save.citizens[0].health=-1;assert.throws(()=>G.prepareSaveData(save));
});
test('diet affects health and work, grace and bounded nonlethal illness protect the opening',()=>{
 const G=fresh(),a=citizen(G),b=citizen(G,10,9);a.dietScore=1;b.dietScore=3;G.advanceHealth();assert(a.health<4&&b.health>4);a.health=2;assert(G.healthWorkMul(a)>1);a.sickDays=1;assert(G.healthWorkMul(a)>1.5);G.rng=()=>0;for(let d=1;d<48;d++){G.game.day=d;G.advanceHealth();}assert.equal(G.world.citizens.filter(G.isSick).length,0);assert.equal(G.game.stats.died,0);G.game.day=49;G.advanceHealth();assert.equal(G.world.citizens.filter(G.isSick).length,1);G.advanceHealth();assert.equal(G.world.citizens.filter(G.isSick).length,1);
});
test('scheduler does not reassign patients and a sick physician can be replaced',()=>{
 const G=fresh(),b=clinic(G),c=citizen(G);c.sickDays=1;const doc=staff(G,b);assert(G.tryMedicalCare(c));G.scheduleJobs();assert.equal(c.task.kind,'care');assert.notEqual(c.job,b.id);doc.sickDays=1;const replacement=citizen(G,9,12);G.advanceHealth();G.scheduleJobs();assert.equal(doc.job,null);assert.equal(replacement.job,b.id);
});
test('a distant patient walks to the clinic before any care hours accrue',()=>{
 const G=fresh(),b=clinic(G),c=citizen(G,24,10);c.sickDays=1;staff(G,b);assert(G.tryMedicalCare(c));assert.equal(c.state,'walk');assert(c.path.length>0);G.stepCitizen(c,.1);assert.equal(c.careHours,0);assert(c.x>13);for(let n=0;n<400&&!G.inMedicalCare(c);n++)G.stepCitizen(c,.1);assert(G.inMedicalCare(c));assert(G.atMedicalDoor(c,b));G.stepCitizen(c,2);assert.equal(c.careHours,2);
});
test('medical UI reports absent staff, no herbs, forest shortage, patients and three-group nutrition',()=>{
 const fs=require('node:fs'),vm=require('node:vm'),G=fresh(),b=clinic(G,'herbalist');
 const context={G,console,window:{},document:{}};vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/ui.js'),'utf8'),context);
 let info=G.ui.medicalInfoData(b);assert(info.availability.includes('采药员'));staff(G,b);info=G.ui.medicalInfoData(b);assert(info.availability.includes('草药'));assert(info.production.includes('成熟林不足'));G.game.res.herbs=2;assert(G.ui.medicalInfoData(b).availability.includes('可接诊'));const c=citizen(G);c.health=2;c.sickDays=2;assert(G.ui.citizenHealthMarkup(c).includes('患病第 2 天'));assert(G.ui.healthSummaryMarkup().includes('患病 1'));assert.equal(G.FOOD_KEYS.length,3);
});
test('a sick nearby builder cannot block healthy workers from constructing a clinic',()=>{
 const G=fresh(),c=citizen(G,9,10);c.sickDays=1;for(let i=0;i<4;i++)citizen(G,20+i,10);const b=G.addBuilding('hospital',10,10,{free:true}).b;assert(b);assert.equal(b.state,'site');G.scheduleJobs();assert.equal(b.workers.length,4);assert(G.world.citizens.some(x=>x.task&&x.task.kind==='build'&&x.task.b===b));
});
test('a jobless sick person cannot block a healthy idle worker from staffing the hospital',()=>{
 const G=fresh(),hospital=clinic(G),herbalist=G.addBuilding('herbalist',20,10,{instant:true,free:true}).b;
 const sick=citizen(G);sick.sickDays=1;const healthy=citizen(G,19,10);healthy.job=herbalist.id;herbalist.workers=[healthy.id];healthy.task=null;healthy.state='idle';G.scheduleJobs();assert.equal(healthy.job,hospital.id);assert.equal(hospital.workers.length,1);assert.equal(sick.job,null);
});
test('blocking a medical route after dispatch releases the reservation instead of trapping the visitor',()=>{
 const G=fresh(),b=clinic(G,'herbalist'),c=citizen(G,24,10);staff(G,b);c.health=2;G.game.res.herbs=2;assert(G.tryMedicalCare(c));assert.equal(G.medicalPatients(b).length,1);for(let y=0;y<G.world.N;y++)G.world.water[y*G.world.N+15]=1;G.bumpNavigation(G.world);for(let n=0;n<200&&c.task?.kind==='care';n++)G.stepCitizen(c,.1);assert.notEqual(c.task?.kind,'care');assert.equal(G.medicalPatients(b).length,0);assert.equal(G.goalCommitment(c),false);assert.equal(G.game.res.herbs,2);assert.equal(c.health,2);
});
console.log(`Health care: ${passed} passed`);
