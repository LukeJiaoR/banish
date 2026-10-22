'use strict';
// Controlled ownership/lifecycle regression, not a survival or balance test.
// Only fixture setup seeds stock/buildings. Every pickup, return and delivery
// below uses the real stepCitizen movement/work loop; no completion mocks.
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
function walkUntil(f, c, done, initial, label) {
  const {G} = f; let steps=0,distance=0; const pickups=[];
  while(!done() && steps<2000) {
    const x=c.x,y=c.y,speed=G.moveSpeed(c),t=G.supplyTaskOf(c);
    const source=t?.source,phase=t?.phase,beforePublic=copy(G.game.res);
    let expected=null;
    if(phase==='fetch' && c.state==='work' && t.workLeft<=.1 && G.atMedicalDoor(c,source)) {
      const src=G.supplySourceStock(source,t.to,t.vendor);
      assert(src && src.publicStock, `${label}: expected real public source`);
      expected=copy(G.supplyBasket(src.stock,G.supplyNeeds(t.to),G.SUPPLY.homeCarry,true));
    }
    G.stepCitizen(c,.1); steps++;
    const moved=Math.hypot(c.x-x,c.y-y);distance+=moved;
    assert(moved<=Math.max(speed,G.moveSpeed(c))*.1+1e-7,`${label}: teleport`);
    if(expected!==null) {
      if(Object.keys(expected).length) {
        assert(G.supplyCargo(c),`${label}: eligible nonempty basket canceled`);
        const actual=G.supplyCargoItems(c.carry);
        for(const k of G.SUPPLY.types) {
          near(actual[k]||0,expected[k]||0,`${label}: exact pickup ${k}`);
          near(beforePublic[k]-G.game.res[k],expected[k]||0,`${label}: debit once ${k}`);
        }
        assert.equal(G.supplyTaskOf(c).phase,'deliver');
      } else {
        assert.equal(G.supplyTaskOf(c),null,`${label}: empty fetch not canceled`);
        assert.equal(c.carry,null);assert.deepEqual(copy(G.game.res),beforePublic);
      }
      pickups.push({basket:expected,x:c.x,y:c.y,atSource:G.atMedicalDoor(c,source)});
      assert(pickups.at(-1).atSource);
    }
    conserved(G,initial);
  }
  assert(done(),`${label}: did not complete in ${steps} steps`);
  return {steps,hours:steps*.1,distance,pickups};
}
function depletionAndRetry() {
  const f=fixture({vegetables:10/3}),{G,homes:[a,b],buyers:[ca,cb]}=f;
  const initial=inventory(G),homeBefore=copy(b.supplyStock);
  assert(G.beginSupplyTrip(ca,a));assert(G.beginSupplyTrip(cb,b));
  assert(G.supplyClaimed(a)&&G.supplyClaimed(b));
  const first=walkUntil(f,ca,()=>!!G.supplyCargo(ca),initial,'winner pickup');
  near(G.game.res.food,0,'winner exhausts source');assert(first.distance>0);assert.equal(first.pickups.length,1);
  const outbound=walkUntil(f,ca,()=>ca.x>=9,initial,'winner begins homeward travel');
  assert(outbound.distance>0);assert(G.supplyCargo(ca));near(G.supplyFood(a.supplyStock),0,'no remote winner delivery');
  const empty=walkUntil(f,cb,()=>!G.supplyTaskOf(cb),initial,'depleted pickup');
  assert(empty.distance>0);assert.equal(empty.pickups.length,1);assert.deepEqual(empty.pickups[0].basket,{});
  assert.equal(cb.task,null);assert.equal(cb.pausedTask,null);assert.equal(cb.carry,null);
  assert.equal(G.supplyClaimed(b),false);assert(G.supplyRestockWanted(b));
  assert.deepEqual(copy(b.supplyStock),homeBefore);
  assert.equal(G.beginSupplyTrip(cb,b),false,'no fabricated pickup from exhausted source');
  // Return the winner's existing goods through the real public-store unload.
  assert(G.returnSupplyCargo(ca));
  const returned=walkUntil(f,ca,()=>!ca.carry&&!G.supplyTaskOf(ca),initial,'conserved replenishment');
  assert(returned.distance>0,'return travels physically back to storage');
  near(G.game.res.food,10/3,'exact replenishment');assert.equal(G.supplyClaimed(a),false);
  assert(G.beginSupplyTrip(cb,b),'released claim allows fresh shopping');
  const retry=walkUntil(f,cb,()=>!!G.supplyCargo(cb),initial,'retry pickup');
  assert.equal(retry.pickups.length,1);near(G.supplyFood(G.supplyCargoItems(cb.carry)),10/3,'retry cargo');
  assert.deepEqual(copy(b.supplyStock),homeBefore,'pickup does not deliver remotely');
  const delivery=walkUntil(f,cb,()=>!cb.carry&&!G.supplyTaskOf(cb),initial,'retry home delivery');
  assert(delivery.distance>0);near(G.supplyFood(b.supplyStock),10/3,'actual home delivery');
  assert.equal(G.supplyClaimed(b),false);assert.equal(G.supplyClaimed(a),false);conserved(G,initial);
  return {name:'depletion_cancel_return_retry',sourceHash:G.testSourceHash,saveVersion:G.serializeGame().v,first,outbound,empty,returned,retry,delivery,finalPublicFood:G.game.res.food,finalHomeFood:G.supplyFood(b.supplyStock)};
}
function stockedPickups() {
  const f=fixture({grain:20,vegetables:20}),{G,homes,buyers}=f,initial=inventory(G);
  for(let i=0;i<2;i++) assert(G.beginSupplyTrip(buyers[i],homes[i]));
  const pickups=buyers.map((c,i)=>walkUntil(f,c,()=>!!G.supplyCargo(c),initial,`stocked pickup ${i}`));
  for(const p of pickups) {assert(p.distance>0);assert.equal(p.pickups.length,1);assert(Object.keys(p.pickups[0].basket).length>0);}
  const deliveries=buyers.map((c,i)=>walkUntil(f,c,()=>!c.carry&&!G.supplyTaskOf(c),initial,`stocked delivery ${i}`));
  for(let i=0;i<2;i++){assert(deliveries[i].distance>0);assert(G.supplyFood(homes[i].supplyStock)>0);assert(!G.supplyClaimed(homes[i]));}
  conserved(G,initial);
  return {name:'positive_stock_both_buyers',sourceHash:G.testSourceHash,saveVersion:G.serializeGame().v,pickups,deliveries,finalPublicFood:G.game.res.food,finalHomeFood:homes.map(b=>G.supplyFood(b.supplyStock))};
}
const results=[depletionAndRetry(),stockedPickups()];
const report={scope:'Controlled food pickup lifecycle only; not survival/balance acceptance',root,passed:results.length,results};
if(process.argv[2])fs.writeFileSync(process.argv[2],JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
