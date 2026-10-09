'use strict';
// Deterministic household / land-clearing regressions. No economy tuning.
const assert = require('node:assert/strict');
const path = require('node:path');
const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));
global.window = global;
for (const file of ['core', 'defs', 'map', 'sim']) require(path.join(root, 'js', file + '.js'));
let passed = 0, failed = 0;
function fresh() {
  const N = 50;
  G.world = { seed: 1, N, water: new Uint8Array(N*N), rock: new Uint8Array(N*N), road: new Uint8Array(N*N), bgrid: new Int32Array(N*N).fill(-1), treeIdx: new Int32Array(N*N).fill(-1), trees: [], rockCleared: [], marked: new Set(), markedRocks: new Set(), buildings: [], bmap: {}, citizens: [], cmap: {}, families: [], start: { x: 25, y: 25 } };
  G.game = G.newGameState(); G.game.h = 12; G.rng = G.makeRng(917);
  G.ui = { toast() {}, refreshHUD() {}, hideInfo() {}, setToolActive() {} };
  G.markGroundDirty = () => {};
}
function test(name, fn) {
  fresh();
  try { fn(); passed++; console.log('ok ' + name); }
  catch (error) { failed++; console.error('FAIL ' + name + '\n' + error.stack); }
}
function house(x=2,y=2) {
  const b = { id:G.nextId(), type:'house', x,y,w:2,h:2,state:'ok',workers:[],family:null };
  G.world.buildings.push(b); G.world.bmap[b.id]=b;
  for(let yy=y;yy<y+2;yy++) for(let xx=x;xx<x+2;xx++) G.world.bgrid[yy*50+xx]=b.id;
  return b;
}
function citizen(sex, age, props={}) { return Object.assign(G.spawnCitizen({sex,age,x:20,y:20}),props); }
function family(members, home, couple=members.slice(0,2)) {
  const f={id:G.nextId(),members:members.map(c=>c.id),houseId:home?home.id:null,coupleIds:couple.map(c=>c.id)};
  G.world.families.push(f);
  for(const c of members) c.familyId=f.id;
  if(home) home.family=f.id;
  if(couple.length===2) {couple[0].partnerId=couple[1].id;couple[1].partnerId=couple[0].id;}
  return f;
}
function pairWithChild(sex, x) {
  const a=citizen('m',40),b=citizen('f',39),c=citizen(sex,18,{parentIds:[a.id,b.id],ancestorIds:[a.id,b.id]});
  const f=family([a,b,c],house(x,2));c.birthFamilyId=f.id;
  return {a,b,c,f};
}
function assertRelations() {
  const ids=[];
  for(const f of G.world.families) for(const id of f.members) {ids.push(id);assert.equal(G.world.cmap[id].familyId,f.id);}
  assert.equal(new Set(ids).size,ids.length,'a citizen belongs to at most one family');
  for(const c of G.world.citizens) if(c.partnerId!=null) {
    const p=G.world.cmap[c.partnerId]; assert.ok(p);assert.equal(p.partnerId,c.id);assert.equal(p.familyId,c.familyId);assert.equal(G.areCloseKin(c,p),false);
  }
}
test('grown children leave their parents and fill an empty home',()=>{
  const a=pairWithChild('m',2),b=pairWithChild('f',8),empty=house(14,2);
  G.formFamilies();G.assignHousing();
  assert.equal(a.c.partnerId,b.c.id);assert.equal(b.c.partnerId,a.c.id);
  assert.notEqual(a.c.familyId,a.f.id);assert.notEqual(b.c.familyId,b.f.id);
  assert.equal(G.homeOf(a.c),empty);assert.equal(G.homeOf(a.a).id,a.f.houseId);
  assert.deepEqual(a.f.members,[a.a.id,a.b.id]);assertRelations();
});
test('two unassigned adults receive the newly created family id',()=>{
  const a=citizen('m',25),b=citizen('f',24);assert.equal(G.joinFamilies(a,b),true);
  assert.ok(a.familyId!=null);assert.equal(a.familyId,b.familyId);assertRelations();
  assert.equal(G.joinFamilies(a,b),false);assert.equal(G.world.families.length,1);
});
test('students and already partnered adults cannot form another couple',()=>{
  const a=citizen('m',18,{student:true}),b=citizen('f',18);assert.equal(G.joinFamilies(a,b),false);
  a.student=false;assert.equal(G.joinFamilies(a,b),true);
  const c=citizen('f',30);assert.equal(G.joinFamilies(a,c),false);
});
test('working children under eighteen cannot form families',()=>{
  const a=citizen('m',17),b=citizen('f',17);assert.equal(a.adult,true);assert.equal(G.joinFamilies(a,b),false);
});
test('unspecified citizen sex is randomized instead of always male',()=>{
  const chance=G.chance;G.chance=()=>false;
  try {const c=G.spawnCitizen({x:20,y:20,age:5});assert.equal(c.sex,'f');}finally{G.chance=chance;}
});
test('parents siblings half-siblings and cousins remain ineligible after ancestors die',()=>{
  const a=citizen('m',30,{parentIds:[700,701],grandparentIds:[800,801],ancestorIds:[700,701,800,801]}), b=citizen('f',25,{parentIds:[702,703],grandparentIds:[800,801],ancestorIds:[702,703,800,801]});
  assert.equal(G.joinFamilies(a,b),false,'cousins share recorded grandparents');
  b.parentIds=[700,704];b.ancestorIds=[700,704];assert.equal(G.joinFamilies(a,b),false,'half siblings');
  b.parentIds=[a.id,705];b.ancestorIds=[a.id,705];assert.equal(G.joinFamilies(a,b),false,'parent and child');
});
test('young adults wait for housing rather than evicting their parents',()=>{
  const a=pairWithChild('m',2),b=pairWithChild('f',8);G.formFamilies();
  assert.equal(a.c.familyId,a.f.id);assert.equal(b.c.familyId,b.f.id);assert.equal(a.c.partnerId,null);
});
test('births require a living reciprocal couple and record both parents',()=>{
  const a=citizen('m',30),b=citizen('f',29),older=citizen('f',65);
  const f=family([older,a,b],house(),[a,b]);G.game.res.food=10000;
  const chance=G.chance;G.chance=()=>true;
  try {G.tryBirths();assert.equal(G.game.stats.born,1);const baby=G.world.citizens.at(-1);assert.deepEqual(baby.parentIds,[b.id,a.id]);assert.ok(baby.ancestorIds.includes(a.id));assert.equal(baby.birthFamilyId,f.id);
    G.killCitizen(a,'测试');G.tryBirths();assert.equal(G.game.stats.born,1);assert.equal(b.partnerId,null);
  } finally {G.chance=chance;}
});
test('an adult daughter and widowed father never produce a child',()=>{
  const father=citizen('m',50),daughter=citizen('f',22,{parentIds:[father.id,999],ancestorIds:[father.id,999]});family([father,daughter],house(),[]);
  G.game.res.food=10000;const chance=G.chance;G.chance=()=>true;
  try {G.tryBirths();assert.equal(G.game.stats.born,0);assert.equal(G.joinFamilies(father,daughter),false);} finally {G.chance=chance;}
});
test('widowed parents can remarry with dependent children without duplicates',()=>{
  const mom=citizen('f',35),kid=citizen('m',8,{parentIds:[mom.id,999],ancestorIds:[mom.id,999]});const f=family([mom,kid],house(),[]);
  const man=citizen('m',37);assert.equal(G.joinFamilies(mom,man),true);
  assert.equal(kid.familyId,mom.familyId);assert.equal(G.homeOf(man).id,f.houseId);assertRelations();
});
test('legacy co-residents cannot be mistaken for a reproductive couple',()=>{
  const a=citizen('m',23),b=citizen('f',21);const f=family([a,b],house(),[]);f.id+=1000;a.familyId=b.familyId=f.id;G.world.bmap[f.houseId].family=f.id;delete f.coupleIds;
  for(const c of [a,b]) for(const k of ['partnerId','parentIds','ancestorIds','birthFamilyId']) delete c[k];
  G.normalizeFamilyRelations();assert.equal(G.joinFamilies(a,b),false);assert.deepEqual(f.coupleIds,[]);
  G.game.res.food=10000;const chance=G.chance;G.chance=()=>true;try{G.tryBirths();assert.equal(G.game.stats.born,0);}finally{G.chance=chance;}
});
test('legacy founding couples recover from exact creation ids, without guessing cohabitation',()=>{
  const m=citizen('m',42),f=citizen('f',39),fam=family([m,f],null,[]),home=house();
  fam.houseId=home.id;home.family=fam.id;
  const child=citizen('m',22);child.familyId=fam.id;fam.members.push(child.id);delete fam.coupleIds;m.partnerId=f.partnerId=null;
  G.normalizeFamilyRelations();assert.deepEqual(fam.coupleIds,[m.id,f.id]);assert.deepEqual(child.parentIds,[m.id,f.id]);assert.equal(m.partnerId,f.id);assertRelations();
});
test('distant cousins may marry but any direct ancestor remains forbidden',()=>{
  const m=citizen('m',25,{parentIds:[10,11],grandparentIds:[20,21],ancestorIds:[10,11,20,21,900]}),f=citizen('f',23,{parentIds:[12,13],grandparentIds:[22,23],ancestorIds:[12,13,22,23,900]});
  assert.equal(G.areCloseKin(m,f),false);f.ancestorIds.push(m.id);assert.equal(G.areCloseKin(m,f),true);
});
test('normalization is idempotent and accepts a detached world',()=>{
  const a=pairWithChild('m',2);const detached=G.world;G.normalizeFamilyRelations(detached);const before=JSON.stringify(detached.families)+JSON.stringify(detached.citizens);
  G.world={};G.normalizeFamilyRelations(detached);assert.equal(JSON.stringify(detached.families)+JSON.stringify(detached.citizens),before);G.world=detached;
});
for(const type of ['farm','house']) test(type+' orders retain trees and cancel without resource loss',()=>{
  G.addTree(G.world,6,6,-200);const tree=G.world.trees[0],before={...G.game.res};
  const check=G.canPlace(G.world,type,6,6),result=G.addBuilding(type,6,6);
  assert.equal(check.ok,true);assert.equal(result.ok,true);assert.equal(G.siteTrees(result.b).length,1);
  assert.equal(G.world.trees[0],tree);assert.equal(G.game.res.wood,before.wood-(G.BDEF[type].cost.wood||0));
  G.removeBuilding(result.b);assert.equal(G.world.trees[0],tree);assert.deepEqual(G.game.res,before);assert.equal(G.world.buildings.length,0);
});
test('worksite trees take normal felling time and must be hauled',()=>{
  const store=house(2,2);store.type='storage';
  G.addTree(G.world,12,12,-200);const result=G.addBuilding('house',12,12),b=result.b;
  const c=citizen('m',30);c.x=11;c.y=12;c.job=b.id;b.workers=[c.id];G.requestTask(c);
  assert.equal(c.task.kind,'clearSite');assert.equal(c.task.work,G.PROD.forester.workH);
  assert.equal(G.tileBlocked(G.world,c.task.tx,c.task.ty),false);
  const wood=G.game.res.wood;G.stepCitizen(c,0.1);
  assert.equal(G.siteTrees(b).length,1);assert.equal(b.progress,0);assert.equal(G.game.res.wood,wood);
  for(let step=0;step<2000&&G.siteTrees(b).length;step++)G.stepCitizen(c,0.1);
  assert.equal(G.siteTrees(b).length,0);assert.equal(G.game.res.wood,wood);assert.ok(c.carry);
  for(let step=0;step<2000&&c.carry;step++)G.stepCitizen(c,0.1);
  assert.equal(G.game.res.wood,wood+G.TREE_LOGS);assert.equal(b.constructionStarted,true);
});
test('canceling a partially cleared site leaves untouched trees and refunds half',()=>{
  const store=house(2,2);store.type='storage';
  G.addTree(G.world,12,12,-200);G.addTree(G.world,13,12,-200);
  const b=G.addBuilding('house',12,12).b,c=citizen('m',30);c.x=11;c.y=12;c.job=b.id;b.workers=[c.id];G.requestTask(c);
  for(let step=0;step<20&&!b.constructionStarted;step++)G.stepCitizen(c,0.1);assert.equal(b.constructionStarted,true);const wood=G.game.res.wood;
  G.removeBuilding(b);assert.equal(G.world.trees.length,2);assert.equal(c.task,null);assert.equal(c.pausedTask,null);assert.equal(G.game.res.wood,wood+8);
  for(let step=0;step<100;step++)G.stepCitizen(c,0.1);assert.equal(G.world.trees.length,2);
});
test('free internal buildings cannot generate refunds',()=>{
  const b=G.addBuilding('house',12,12,{free:true}).b,before={...G.game.res};G.removeBuilding(b);assert.deepEqual(G.game.res,before);
});
test('site felling claims survive overnight and prevent duplicate output',()=>{
  G.addTree(G.world,12,12,-200);const b=G.addBuilding('farm',12,12).b;
  const a=citizen('m',30),z=citizen('f',30);a.x=z.x=12;a.y=z.y=12;a.job=z.job=b.id;b.workers=[a.id,z.id];
  G.requestTask(a);a.task.workLeft=2;G.goHome(a);G.requestTask(z);
  assert.equal(z.task,null);assert.equal(G.resumeTask(a),true);assert.equal(a.task.workLeft,2);
  assert.equal(b.progress,0);assert.equal(G.siteTrees(b).length,1);
});
test('an unreachable site checks its shared perimeter only once',()=>{
  for(let y=12;y<14;y++)for(let x=12;x<14;x++)G.addTree(G.world,x,y,-200);
  const b=G.addBuilding('house',12,12).b,c=citizen('m',30);c.job=b.id;b.workers=[c.id];
  const find=G.findPath;let calls=0;G.findPath=()=>{calls++;return null;};
  try{G.requestTask(c);assert.equal(c.task,null);assert.ok(calls<=12,`${calls} redundant path searches`);}finally{G.findPath=find;}
});
test('clear land requires timed felling and physical delivery before construction',()=>{
  const store=house(2,2);store.type='storage';store.w=store.h=3;
  G.addTree(G.world,12,12,-200);G.markFellAt(G.world,12,12);
  const c=citizen('m',30);c.x=c.y=12;const before=G.game.res.wood;G.requestTask(c);
  assert.equal(c.task.kind,'chop');assert.ok(c.task.workLeft>0);G.stepCitizen(c,0.1);assert.equal(G.world.trees.length,1);assert.equal(G.game.res.wood,before);
  for(let step=0;step<2000&&G.world.trees.length;step++) G.stepCitizen(c,0.1);
  assert.equal(G.world.trees.length,0);assert.equal(G.game.res.wood,before);assert.ok(c.carry);
  for(let step=0;step<2000&&c.carry;step++) G.stepCitizen(c,0.1);
  assert.equal(G.game.res.wood,before+G.TREE_LOGS);assert.equal(G.addBuilding('farm',12,12).ok,true);
});
test('30-year household lifecycle produces a new generation without kin pairings',()=>{
  // Relationship fixture: food, fuel and empty homes are deliberately supplied each day.
  // This does not claim a 30-year economy/survival acceptance result.
  const origins=[];
  for(let i=0;i<6;i++) {
    const m=citizen('m',28+i),f=citizen('f',27+i),child=citizen(i%2?'f':'m',5+i%3);
    child.parentIds=[m.id,f.id];const fam=family([m,f,child],house(2+i*6,2));child.birthFamilyId=fam.id;origins.push(child);
  }
  for(let y=8;y<44;y+=6)for(let x=2;x<44;x+=6)house(x,y);
  G.normalizeFamilyRelations();
  const birth=G.tryBirths;let newGenerationBirths=0;
  G.tryBirths=function(){const before=G.world.citizens.length;birth();for(const baby of G.world.citizens.slice(before))if(baby.parentIds.some(id=>origins.some(c=>c.id===id)))newGenerationBirths++;};
  try {
    for(let day=0;day<30*G.YEAR_DAYS;day++) {
      G.game.res.food=100000;G.game.res.firewood=100000;G.game.res.tools=100000;
      G.endDay();assertRelations();
      for(const f of G.world.families)if(f.houseId!=null)assert.ok(G.world.bmap[f.houseId]);
    }
  }finally{G.tryBirths=birth;}
  assert.ok(G.game.stats.born>20);assert.ok(origins.some(c=>c.partnerId!=null));assert.ok(newGenerationBirths>0);
  console.log(`  lifecycle fixture: 30 years, ${G.game.stats.born} births, ${newGenerationBirths} births to initial children, ${G.world.families.length} households`);
});
test('25-year aging fixture retains kinship after founding parents die',()=>{
  const initialChildren=[];
  for(let i=0;i<6;i++) {
    const m=citizen('m',55),f=citizen('f',54),child=citizen(i%2?'f':'m',18);
    child.parentIds=[m.id,f.id];const fam=family([m,f,child],house(2+i*6,2));child.birthFamilyId=fam.id;initialChildren.push(child);
  }
  for(let y=8;y<44;y+=6)for(let x=2;x<44;x+=6)house(x,y);
  G.normalizeFamilyRelations();
  for(let day=0;day<25*G.YEAR_DAYS;day++) {
    G.game.res.food=100000;G.game.res.firewood=100000;G.game.res.tools=100000;
    G.endDay();assertRelations();
  }
  assert.ok(G.game.stats.deadReasons['寿终正寝']>=10);assert.ok(G.game.stats.born>0);
  for(const c of initialChildren)assert.equal(c.parentIds.length,2);
  const babies=G.world.citizens.filter(c=>c.parentIds.some(id=>initialChildren.some(p=>p.id===id)));
  assert.ok(babies.length);assert.ok(babies.every(c=>c.grandparentIds.length===4));
  console.log(`  aging fixture: 25 years, ${G.game.stats.born} births, ${G.game.stats.deadReasons['寿终正寝']} old-age deaths; deceased grandparent ids retained`);
});
console.log(`${passed} family and clearing scenarios passed; ${failed} failed`);if(failed)process.exitCode=1;
