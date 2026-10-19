'use strict';
const assert=require('node:assert/strict'),path=require('node:path');
const {loadGame}=require('./helpers/playability');
const G=loadGame(path.resolve(__dirname,'..'));G.newGame(1);const w=G.world;
for(const k of ['water','rock','road'])w[k].fill(0);
w.bgrid.fill(-1);w.treeIdx.fill(-1);w.trees=[];w.buildings=[];w.bmap={};w.citizens=[];w.cmap={};w.families=[];w.marked.clear();w.markedRocks.clear();
G.bumpNavigation(w);G.game.h=12;G.game.res.wood=1000;
const generate=G.genWorld;G.genWorld=(seed,opt)=>{const n=generate(seed,opt);n.water.set(w.water);n.rock.set(w.rock);return n;};
const fields=[['pasture',2,2,{}],['orchard',12,2,{}],['pasture',2,15,{pastureSize:[20,20],instant:true,free:true}],['orchard',30,15,{orchardSize:[15,15],instant:true,free:true}]];
for(const [type,x,y,opt]of fields){const r=G.addBuilding(type,x,y,opt);assert(r.ok,r.reason);}
for(const b of G.world.buildings)G.ensureEconomyBuilding(b);
const bigPen=G.world.buildings[2];bigPen.animals=20;bigPen.animalTarget=20;
const snapshot=()=>JSON.parse(JSON.stringify(G.serializeGame()));const saved=snapshot();G.applySaveData(saved);
for(let i=0;i<4;i++){
 const a=saved.buildings[i],b=G.world.buildings[i];assert.equal(b.w,a.w||6);assert.equal(b.h,a.h||6);
 assert.deepEqual(b.pastureSize&&Array.from(b.pastureSize),a.pastureSize);assert.deepEqual(b.orchardSize&&Array.from(b.orchardSize),a.orchardSize);
 assert.equal(b.totalWork,a.totalWork);assert.equal(b.state,a.state);
 if(b.type==='pasture'){assert.equal(b.animals,a.animals);assert.equal(b.animalTarget,a.animalTarget);}
 else assert.deepEqual(JSON.parse(JSON.stringify(b.orchardTrees)),a.orchardTrees);
}
assert.equal(G.pastureCapacity(G.world.buildings[0],'sheep'),12);assert.equal(G.orchardTreeCount(G.world.buildings[1]),9);
assert.equal(G.pastureCapacity(G.world.buildings[2],'sheep'),25);assert.equal(G.orchardTreeCount(G.world.buildings[3]),40);
G.applySaveData(snapshot());assert.equal(G.world.buildings[2].animals,20);
console.log('Fixed construction sites and existing 20×20 pasture / 15×15 orchard survive two save roundtrips without changing capacity, animals or tree state.');
