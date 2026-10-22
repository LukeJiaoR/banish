'use strict';
// Running-clock scheduler integration, not a survival or production test.
// Fixture setup and one labeled deposit seed stock. Every pickup and delivery
// below uses advanceSim; no direct task requests or completion mocks.
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { loadGame } = require('./helpers/playability');
const root = path.resolve(__dirname, '..');
const near = (a, b, label) => assert(Math.abs(a - b) < 1e-7, `${label}: ${a} != ${b}`);
const copy = x => JSON.parse(JSON.stringify(x));
function fixture(food) {
  const G = loadGame(root); assert(G.newGame(1).ok);
  const w = G.world;
  for (const k of ['water', 'rock', 'road']) w[k].fill(0);
  w.bgrid.fill(-1); w.treeIdx.fill(-1);
  for (const k of ['trees', 'citizens', 'buildings', 'families']) w[k] = [];
  w.bmap = {}; w.cmap = {}; w.supplyCaches = [];
  w.marked.clear(); w.markedRocks.clear(); G.bumpNavigation(w);
  G.game.h = 8;
  for (const k of G.RES_KEYS) G.game.res[k] = 0;
  Object.assign(G.game.res, food);
  G.game.res.food = G.FOOD_KEYS.reduce((n, k) => n + (G.game.res[k] || 0), 0);
  const build = (type, x, y) => { const result = G.addBuilding(type, x, y, {instant:true,free:true}); assert(result.ok, result.reason); return result.b; };
  const storage = build('storage', 2, 10);
  const homes = [build('house', 18, 10), build('house', 18, 18)];
  const buyers = homes.map(home => {
    const f = {id:G.nextId(),members:[],coupleIds:[],houseId:home.id}; w.families.push(f); home.family = f.id;
    const c = G.spawnCitizen({x:home.x-1,y:home.y,age:30,sex:'m',familyId:f.id}); f.members.push(c.id); return c;
  });
  assert(G.enablePhysicalSupplyPrototype());
  return {G,storage,homes,buyers};
}
function inventory(G) {
  const total = Object.fromEntries(G.SUPPLY.types.map(k => [k, G.game.res[k] || 0]));
  const add = s => { for (const k of G.SUPPLY.types) total[k] += s?.[k] || 0; };
  G.world.buildings.forEach(b => add(b.supplyStock));
  G.world.supplyCaches.forEach(b => add(b.supplyStock));
  G.world.families.forEach(f => add(f.supplyCamp?.supplyStock));
  G.world.citizens.forEach(c => { if(c.carry) add({[c.carry.type]:c.carry.qty,...c.carry.extra}); });
  add(G.game.supplyUsed); add(G.game.supplyLost); return total;
}
function conserved(G, initial) {
  const now = inventory(G); for(const k of G.SUPPLY.types) near(now[k],initial[k],`conservation ${k}`);
  near(G.game.res.food,G.FOOD_KEYS.reduce((n,k)=>n+(G.game.res[k]||0),0),'public food aggregate');
  for(const k of G.SUPPLY.types) assert(G.game.res[k] >= -1e-8, `negative public ${k}`);
}


function run(name, initialFood, replenishDelay=null) {
  const {G,homes,buyers}=fixture(initialFood), initial=inventory(G);
  const events=[],distance=buyers.map(()=>0),fetches=buyers.map(()=>0),deliveries=buyers.map(()=>0);
  let canceled=null,replenished=null,overlap=false;
  const stamp=()=>({day:G.game.day,h:G.game.h,elapsed:G.game.day*G.DAY_H+G.game.h-8});
  for(let step=0;step<720;step++) {
    // A bounded external stock-arrival fixture, through the real public deposit
    // API. This is intentionally not a claim about autonomous production.
    if(canceled && !replenished && stamp().elapsed-canceled.elapsed>=replenishDelay-1e-7) {
      const accepted=G.deposit('vegetables',20);near(accepted,20,'replenishment accepted');
      initial.vegetables+=accepted;replenished={...stamp(),kind:'replenishment',quantity:accepted};events.push(replenished);
    }
    const publicBefore=G.game.res.vegetables;
    const snapshots=buyers.map((c,j)=>({x:c.x,y:c.y,speed:G.moveSpeed(c),task:G.supplyTaskOf(c),phase:G.supplyTaskOf(c)?.phase,homeFood:G.supplyFood(homes[j].supplyStock)}));
    G.advanceSim(.1);
    assert(!G.game.over,'unexpected game over');assert(buyers.every(c=>!c.dead),'unexpected death');
    let pickupTotal=0;
    buyers.forEach((c,j)=>{
      const before=snapshots[j],t=G.supplyTaskOf(c),phase=t?.phase;
      const moved=Math.hypot(c.x-before.x,c.y-before.y);distance[j]+=moved;
      assert(moved<=Math.max(before.speed,G.moveSpeed(c))*.1+1e-7,'teleport');
      if(before.phase!==phase)events.push({...stamp(),buyer:j,from:before.phase||null,to:phase||null,state:c.state,restTime:G.isRestTime()});
      if(phase==='fetch'&&before.phase!=='fetch'){
        fetches[j]++;assert(G.supplyClaimed(homes[j]));
        if(canceled&&j===canceled.buyer){assert(replenished,'retry began without replenishment');assert(fetches[j]===2,'unexpected extra retry');}
      }
      if(before.phase==='fetch'&&phase==='deliver'){
        assert(G.atMedicalDoor(c,before.task.source),'pickup away from source');
        const q=G.supplyFood(G.supplyCargoItems(c.carry));assert(q>0);pickupTotal+=q;
        near(G.supplyFood(homes[j].supplyStock),before.homeFood,'no remote delivery at pickup');
      }
      if(before.phase==='fetch'&&!phase){
        assert(replenishDelay!==null,'stocked control canceled');assert(!canceled,'multiple cancellations');
        near(G.game.res.food,0,'depleted public source');assert.equal(c.carry,null);assert.equal(c.pausedTask,null);assert.equal(c.task,null);
        assert(!G.supplyClaimed(homes[j]));assert(G.supplyRestockWanted(homes[j]));assert(G.atMedicalDoor(c,before.task.source));
        near(G.supplyFood(homes[j].supplyStock),0,'empty fetch leaves home empty');
        canceled={...stamp(),buyer:j,kind:'empty-fetch-canceled'};events.push(canceled);
      }
      if(before.phase==='deliver'&&!phase){
        assert(G.atMedicalDoor(c,homes[j]),'delivery away from home');assert(!c.carry);assert(!G.supplyClaimed(homes[j]));
        assert(G.supplyFood(homes[j].supplyStock)>before.homeFood,'actual unload required');deliveries[j]++;
      }
    });
    near(publicBefore-G.game.res.vegetables,pickupTotal,'exact public pickup debit');
    overlap ||= buyers.every(c=>G.supplyTaskOf(c)?.phase==='fetch');
    conserved(G,initial);
    if(replenishDelay===null ? deliveries.every(n=>n>0) : canceled&&replenished&&deliveries[canceled.buyer]>0){
      assert(overlap,'race must overlap two autonomous fetches');
      if(canceled){
        assert.equal(fetches[canceled.buyer],2);assert(G.supplyFood(homes[canceled.buyer].supplyStock)>0);
        const retry=events.find(e=>e.buyer===canceled.buyer&&e.to==='fetch'&&e.elapsed>canceled.elapsed);
        if(name==='overnight_retry'){assert(retry.day>canceled.day,'retry must cross midnight');assert.equal(retry.restTime,false);}
      } else assert.deepEqual(fetches,[1,1]);
      assert(distance.every(d=>d>0));
      return {name,steps:step+1,...stamp(),sourceHash:G.testSourceHash,saveVersion:G.serializeGame().v,fetches,deliveries,distance,canceled,replenished,events,inventory:inventory(G),finalPublicFood:G.game.res.food,finalHomeFood:homes.map(h=>G.supplyFood(h.supplyStock))};
    }
  }
  throw new Error(name+': did not finish within 72 simulated hours; events='+JSON.stringify(events));
}
const results=[run('daytime_retry',{vegetables:10/3},.5),run('overnight_retry',{vegetables:10/3},3),run('stocked_control',{vegetables:40})];
const report={scope:'Running-clock autonomous household retry; externally replenished fixture, not autonomous production or survival acceptance',passed:results.length,results};
if(process.argv[2])fs.writeFileSync(process.argv[2],JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
