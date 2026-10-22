'use strict';
/* Lifecycle regression tests use the real citizen path/work loop. Fixtures may
 * seed a private store only by moving the same quantities out of public stock.
 * No completed-task callback is used to stand in for a delivery or fire rescue. */
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadGame } = require('./helpers/playability');
const root = path.resolve(__dirname, '..');
const results = [];
const near = (actual, expected, label = '') => assert(Math.abs(actual - expected) < 1e-7, `${label}: ${actual} != ${expected}`);

function fresh({ legacy = false } = {}) {
  const G = loadGame(root); G.newGame(1);
  // Fixed-calendar historical cases intentionally use the pre-climate format.
  // Other supply cases keep the real new-game Fair/v6 default.
  if (legacy) { G.game.climate = null; G.game.heatRules = null; delete G.game.startConfig.climate; assertLegacy(G); }
  const w = G.world;
  for (const k of ['water', 'rock', 'road']) w[k].fill(0);
  w.bgrid.fill(-1); w.treeIdx.fill(-1);
  for (const k of ['trees', 'citizens', 'buildings', 'families']) w[k] = [];
  w.bmap = {}; w.cmap = {}; w.supplyCaches = [];
  w.marked.clear(); w.markedRocks.clear(); G.bumpNavigation(w);
  G.rng = () => .5; G.game.h = 8;
  for (const k of G.RES_KEYS) G.game.res[k] = 0;
  Object.assign(G.game.res, { wood: 300, stone: 300, iron: 100, tools: 30,
    grain: 150, vegetables: 150, meat: 150, food: 450, firewood: 100, coal: 80 });
  build(G, 'storage', 2, 10);
  // Save reconstruction derives terrain from seed; retain this suite's flat fixture.
  const generate = G.genWorld, water = new Uint8Array(w.water), rock = new Uint8Array(w.rock);
  G.genWorld = (seed, options) => { const next = generate(seed, options); next.water.set(water); next.rock.set(rock); return next; };
  return G;
}
function build(G, type, x, y) {
  const result = G.addBuilding(type, x, y, { instant: true, free: true });
  assert(result.ok, `${type}@${x},${y}: ${result.reason}`); return result.b;
}
function family(G, home, ages = [30], x = home ? home.x - 1 : 20, y = home ? home.y : 20) {
  const f = { id: G.nextId(), members: [], coupleIds: [], houseId: home?.id ?? null };
  G.world.families.push(f); if (home && home.type !== 'boarding') home.family = f.id;
  const people = ages.map((age, i) => {
    const c = G.spawnCitizen({ x, y: y + i, age, sex: 'm', familyId: f.id });
    f.members.push(c.id); return c;
  });
  return { f, people, c: people[0], home };
}
function seedStore(G, b, items) {
  const stock = G.supplyStock(b);
  for (const [k, q] of Object.entries(items)) {
    near(G.withdrawResource(k, q), q, `seed ${k}`); stock[k] = (stock[k] || 0) + q;
  }
}
function inventory(G) {
  const out = Object.fromEntries(G.SUPPLY.types.map(k => [k, G.game.res[k] || 0]));
  const add = stock => { for (const k of G.SUPPLY.types) out[k] += stock?.[k] || 0; };
  G.world.buildings.forEach(b => add(b.supplyStock));
  (G.world.supplyCaches || []).forEach(b => add(b.supplyStock));
  G.world.families.forEach(f => add(f.supplyCamp?.supplyStock));
  G.world.citizens.forEach(c => { if (c.carry) add({ [c.carry.type]: c.carry.qty, ...c.carry.extra }); });
  add(G.game.supplyUsed); add(G.game.supplyLost);
  return out;
}
function conserved(G, initial, label) {
  const actual = inventory(G);
  for (const k of G.SUPPLY.types) near(actual[k], initial[k], `${label} conservation ${k}`);
  near(G.game.res.food, G.FOOD_KEYS.reduce((n, k) => n + G.game.res[k], 0), `${label} public food aggregate`);
  for (const b of [...G.world.buildings, ...(G.world.supplyCaches || []), ...G.world.families.map(f => f.supplyCamp).filter(Boolean)]) {
    for (const [k, q] of Object.entries(b.supplyStock || {})) assert(Number.isFinite(q) && q >= -1e-8, `${label} negative/nonfinite ${b.type}.${k}`);
  }
}
function runUntil(G, done, { citizen, initial = inventory(G), max = 5000, label = 'task' } = {}) {
  let steps = 0, distance = 0;
  for (; steps < max && !done(); steps++) {
    const before = G.world.citizens.map(c => ({ c, x: c.x, y: c.y, speed: G.moveSpeed(c) }));
    if (citizen) G.stepCitizen(citizen, .1); else G.advanceSim(.1);
    for (const p of before) if (!p.c.dead) {
      const moved = Math.hypot(p.c.x - p.x, p.c.y - p.y);
      assert(moved <= Math.max(p.speed, G.moveSpeed(p.c)) * .1 + 1e-7, `${label} teleport`); distance += moved;
    }
    conserved(G, initial, `${label} step ${steps}`);
  }
  assert(done(), `${label} did not complete after ${steps} steps: ${JSON.stringify(G.world.citizens.map(c => ({ id: c.id, state: c.state, kind: c.task?.kind, phase: c.task?.phase, x: c.x, y: c.y })))}`);
  return { hours: +(steps / 10).toFixed(1), distance: +distance.toFixed(3) };
}
function pickup(G, c, target, initial = inventory(G), vendor = false) {
  assert(G.beginSupplyTrip(c, target, vendor));
  const journey = runUntil(G, () => !!G.supplyCargo(c), { citizen: c, initial, label: 'pickup' });
  assert(G.atMedicalDoor(c, c.task.source) || ['supplycache', 'supplycamp'].includes(c.task.source.type));
  return { items: { ...G.supplyCargoItems(c.carry) }, journey };
}
function deliver(G, c, initial = inventory(G)) {
  return runUntil(G, () => !c.carry && !G.supplyTaskOf(c), { citizen: c, initial, label: 'delivery' });
}
const save = G => JSON.parse(JSON.stringify(G.serializeGame()));
function assertLegacy(G) {
  assert.equal(G.game.climate, null); assert.equal(G.game.heatRules, null);
  const snapshot = save(G); assert.equal(snapshot.v, 4);
  assert.equal(Object.hasOwn(snapshot.game, 'climate'), false);
  assert.equal(Object.hasOwn(snapshot.game, 'heatRules'), false);
  assert.equal(Object.hasOwn(snapshot.game.startConfig, 'climate'), false);
}
function roundtrip(G, initial, times = 3) {
  for (let i = 0; i < times; i++) { const legacy = !G.game.climate; G.applySaveData(save(G)); if (legacy) assertLegacy(G); else { assert.equal(save(G).v, 6); assert.equal(G.game.climate.type, 'fair'); } conserved(G, initial, `reload ${i + 1}`); }
}
function ignite(G, b) {
  assert(G.setFireDisasters(true, G.fireToggleQuote(true).key)); assert(G.igniteHouse(b));
}
function test(name, fn) {
  const start = Date.now();
  try { const detail = fn() || {}; results.push({ name, passed: true, ms: Date.now() - start, ...detail }); console.log('ok ' + name + ' ' + JSON.stringify(detail)); }
  catch (error) { results.push({ name, passed: false, error: error.message }); console.error('FAIL ' + name); throw error; }
}

test('automatic is the new-game default and does not create private stores', () => {
  const actual = loadGame(root); assert(actual.newGame(1).ok);
  assert.equal(actual.game.supplyMode, 'automatic'); assert.equal(actual.game.climate.type, 'fair');
  assert.equal(actual.game.startConfig.climate, 'fair'); assert.equal(save(actual).v, 6);
  assert(actual.world.buildings.every(b => b.supplyStock === undefined));
  const G = fresh(), h = build(G, 'house', 15, 10), { c } = family(G, h);
  assert.equal(G.supplyEnabled(), false); assert.equal(G.tryHouseholdSupply(c), false);
  const before = G.game.res.food; G.game.h = 23.9; G.advanceSim(.2);
  near(G.game.res.food, before - G.LIFE.eatPerDay); assert.equal(h.supplyStock, undefined);
  return { supplyMode: G.game.supplyMode, mealsFromPublic: before - G.game.res.food };
});

test('public to market to home moves mixed goods only after real pickup and arrival', () => {
  const G = fresh({ legacy: true }), market = build(G, 'market', 20, 10), vendorHome = build(G, 'house', 28, 10), buyerHome = build(G, 'house', 28, 17);
  const vendor = family(G, vendorHome).c, buyer = family(G, buyerHome).c;
  G.game.day = 24; G.enablePhysicalSupplyPrototype(); G.game.season = 2; G.setHeatingPolicy(true, 20);
  seedStore(G, vendorHome, { grain: 20, vegetables: 20, meat: 20, firewood: 10 });
  const initial = inventory(G), publicBefore = { ...G.game.res };
  G.assignWorker(market, vendor); assert.equal(vendor.task?.kind, 'supply'); assert(vendor.task.vendor);
  assert.equal(G.supplySum(market.supplyStock), 0); near(G.game.res.food, publicBefore.food);
  const fetch = runUntil(G, () => !!G.supplyCargo(vendor), { citizen: vendor, initial, label: 'vendor pickup' });
  const vendorItems = { ...G.supplyCargoItems(vendor.carry) };
  assert.equal(Object.keys(vendorItems).length, 5); near(G.supplySum(market.supplyStock), 0);
  for (const k of G.SUPPLY.types) near(G.game.res[k], publicBefore[k] - (vendorItems[k] || 0));
  const unload = deliver(G, vendor, initial); for (const k of G.SUPPLY.types) near(market.supplyStock[k], vendorItems[k] || 0);
  const afterVendor = { ...G.game.res }; assert(G.beginSupplyTrip(buyer, buyerHome)); assert.equal(buyer.task.source, market);
  runUntil(G, () => !!G.supplyCargo(buyer), { citizen: buyer, initial, label: 'market shopping' });
  const homeItems = { ...G.supplyCargoItems(buyer.carry) }; assert(Object.keys(homeItems).length >= 4); near(G.supplySum(buyerHome.supplyStock), 0);
  for (const k of G.SUPPLY.types) near(G.game.res[k], afterVendor[k], 'market shopping never withdraws public stock');
  const homeTrip = deliver(G, buyer, initial); assert(homeTrip.distance > 0); assert(fetch.distance > 0 && unload.distance > 0);
  for (const k of G.SUPPLY.types) near(buyerHome.supplyStock[k], homeItems[k] || 0);
  conserved(G, initial, 'full supply chain'); return { vendorItems, homeItems, fetch, unload, homeTrip };
});

test('daily food and heat consume only home stock and preserve the public coal reserve', () => {
  const G = fresh({ legacy: true }), h = build(G, 'house', 17, 10), { c } = family(G, h);
  G.enablePhysicalSupplyPrototype(); G.setHeatingPolicy(true, 20);
  seedStore(G, h, { grain: 3, vegetables: 3, meat: 3, firewood: 1, coal: 2 });
  const initial = inventory(G), before = { ...G.game.res }; G.game.day = 35; G.game.season = 2; G.game.h = 23.9;
  G.game.townLedger = G.newTownLedger(G.game); c.lastMealDay=null;
  runUntil(G,()=>c.lastMealDay===G.game.day,{citizen:c,initial,label:'actual household meal'});
  G.advanceSim(.2); conserved(G, initial, 'daily meals and heat');
  assert.equal(c.hunger, 0); assert.equal(c.dietVariety, 3); near(G.supplyFood(G.game.supplyUsed), G.LIFE.eatPerDay);
  near(G.game.supplyUsed.firewood, 1); near(G.game.supplyUsed.coal, .75); assert(!h.unheated);
  for (const k of G.SUPPLY.types) near(G.game.res[k], before[k], 'private use leaves public stock unchanged');
  return { meal: G.supplyFood(G.game.supplyUsed), heating: { ...h.lastHeating } };
});

test('carrier death recovers every mixed cargo item in a physical cache then another adult collects it', () => {
  const G = fresh(), h = build(G, 'house', 30, 10), { people: [a, b] } = family(G, h, [30, 30]);
  G.enablePhysicalSupplyPrototype(); const initial = inventory(G), { items } = pickup(G, a, h, initial);
  runUntil(G, () => a.x >= 15, { citizen: a, initial, label: 'mid-route death position' });
  const publicBefore = { ...G.game.res }, at = { x: a.x, y: a.y }; G.killCitizen(a, 'fixture accident');
  assert.equal(a.carry, null); assert.equal(G.world.supplyCaches.length, 1); const cache = G.world.supplyCaches[0];
  near(cache.x, Math.round(at.x)); near(cache.y, Math.round(at.y));
  for (const k of G.SUPPLY.types) { near(cache.supplyStock[k] || 0, items[k] || 0); near(G.game.res[k], publicBefore[k]); }
  conserved(G, initial, 'death cache'); assert(G.beginSupplyTrip(b, h)); assert.equal(b.task.source, cache);
  const fetch = runUntil(G, () => !!b.carry, { citizen: b, initial, label: 'recover death cache' });
  const recovered = { ...G.supplyCargoItems(b.carry) }; deliver(G, b, initial);
  assert(fetch.distance > 0); assert(G.supplySum(cache.supplyStock) < G.supplySum(items));
  conserved(G, initial, 'recovered death cache'); return { deathAt: at, cached: items, recovered, fetch };
});

for (const action of ['demolition', 'upgrade']) test(`stocked house ${action} creates one cache and relocated household really retrieves it`, () => {
  const G = fresh(), old = build(G, 'house', 18, 10), backup = build(G, 'house', 24, 10), { c, f } = family(G, old);
  G.enablePhysicalSupplyPrototype(); const items = { grain: 6, vegetables: 7, meat: 8, firewood: 4, coal: 3 }; seedStore(G, old, items);
  const initial = inventory(G), before = { ...G.game.res };
  if (action === 'upgrade') { assert(G.upgradeHouse(old, G.houseUpgradeQuote(old).key).ok); G.setConstructionPaused(old, true); }
  else { assert(G.removeBuilding(old)); G.assignHousing(); }
  assert.equal(f.houseId, backup.id); assert.equal(old.supplyStock, undefined); assert.equal(G.world.supplyCaches.length, 1);
  const cache = G.world.supplyCaches[0]; for (const k of G.SUPPLY.types) { near(cache.supplyStock[k], items[k] || 0); near(G.game.res[k], before[k]); }
  conserved(G, initial, action); if (!G.supplyTaskOf(c)) assert(G.beginSupplyTrip(c, backup)); assert.equal(c.task.to, backup); assert.equal(c.task.source, cache);
  const fetch = runUntil(G, () => !!c.carry, { citizen: c, initial, label: `${action} cache pickup` });
  const picked = { ...G.supplyCargoItems(c.carry) }; const onward = deliver(G, c, initial); assert(fetch.hours > 0 && onward.distance > 0);
  if (action === 'demolition') assert.equal(G.removeBuilding(old), false);
  else assert.equal(G.upgradeHouse(old, G.houseUpgradeQuote(old).key).ok, false);
  assert.equal(G.world.supplyCaches.length, 1); conserved(G, initial, 'no duplicate cache'); return { cached: items, picked, fetch };
});

test('home delivery follows family relocation while mixed cargo stays intact in transit', () => {
  const G = fresh(), old = build(G, 'house', 25, 10), next = build(G, 'house', 33, 17), { c, f } = family(G, old);
  G.enablePhysicalSupplyPrototype(); const initial = inventory(G), { items } = pickup(G, c, old, initial), publicBefore = { ...G.game.res };
  assert(G.removeBuilding(old)); G.assignHousing(); assert.equal(f.houseId, next.id);
  assert.deepEqual({ ...G.supplyCargoItems(c.carry) }, items); const trip = deliver(G, c, initial);
  for (const k of G.SUPPLY.types) { near(next.supplyStock[k], items[k] || 0); near(G.game.res[k], publicBefore[k]); }
  assert(trip.distance > 0); return { items, newHome: next.id, trip };
});

test('homeless family receives a physical camp delivery and camp stock becomes a cache after rehousing', () => {
  const G = fresh(), { c, f } = family(G, null, [30], 23, 10);
  G.enablePhysicalSupplyPrototype(); const camp = f.supplyCamp, initial = inventory(G); assert(camp);
  const { items } = pickup(G, c, camp, initial); const trip = deliver(G, c, initial); assert(trip.distance > 0);
  for (const k of G.SUPPLY.types) near(camp.supplyStock[k], items[k] || 0);
  const home = build(G, 'house', 28, 10); G.assignHousing(); G.reconcileSupplyHomes(); assert.equal(f.houseId, home.id); assert.equal(f.supplyCamp, undefined);
  const cache = G.world.supplyCaches[0]; assert(cache); near(G.supplySum(home.supplyStock), 0); conserved(G, initial, 'camp relocation');
  assert(G.beginSupplyTrip(c, home)); assert.equal(c.task.source, cache);
  runUntil(G, () => !!c.carry, { citizen: c, initial, label: 'rehoused camp cache pickup' }); deliver(G, c, initial);
  assert(G.supplyFood(home.supplyStock) > 0); return { campItems: items, campToHomeCache: cache.id, trip };
});

test('idle adult provisions an orphan household without pulling a teacher from work', () => {
  const G = fresh(), orphanHome = build(G, 'house', 24, 10), helperHome = build(G, 'house', 18, 17), school = build(G, 'school', 26, 20);
  const orphan = family(G, orphanHome, [8]), helpers = family(G, helperHome, [30, 30]), [teacher, helper] = helpers.people;
  G.enablePhysicalSupplyPrototype(); seedStore(G, helperHome, { grain: 40, firewood: 10 });
  G.assignWorker(school, teacher); assert.equal(teacher.job, school.id); const teacherTask = teacher.task;
  assert.equal(G.tryHouseholdSupply(teacher), false); assert.equal(teacher.task, teacherTask);
  const initial = inventory(G); G.requestTask(helper); assert.equal(helper.task?.kind, 'supply'); assert.equal(helper.task.familyId, orphan.f.id);
  runUntil(G, () => !!helper.carry, { citizen: helper, initial, label: 'orphan helper pickup' }); deliver(G, helper, initial);
  assert(G.supplyFood(orphanHome.supplyStock) > 0); assert.equal(orphan.c.carry, null); assert.equal(teacher.job, school.id);
  G.game.h = 23.9; G.advanceSim(.2); conserved(G, initial, 'orphan meal'); assert.equal(orphan.c.hunger, 0);
  return { helperId: helper.id, orphanFamilyId: orphan.f.id, teacherStillAssigned: teacher.job === school.id };
});

test('real well rescue quenches fire while evacuated goods stay in the original house', () => {
  const G = fresh(), h = build(G, 'house', 18, 10); build(G, 'well', 22, 10);
  const { c, f } = family(G, h, [30, 30]); G.enablePhysicalSupplyPrototype();
  const stock = { grain: 6, vegetables: 7, meat: 8, firewood: 4, coal: 3 }; seedStore(G, h, stock);
  const initial = inventory(G); ignite(G, h); assert.equal(f.houseId, null); assert(h.houseFire);
  for (const k of G.SUPPLY.types) near(h.supplyStock[k], (stock[k] || 0), 'evacuation does not teleport household stock');
  let sawWater = false, buckets = 0, oldNeed = h.houseFire.need;
  const trip = runUntil(G, () => {
    for (const citizen of G.world.citizens) if (G.fireTaskOf(citizen)?.water) sawWater = true;
    const need = h.houseFire?.need || 0; if (need < oldNeed) buckets += oldNeed - need; oldNeed = need;
    return !h.houseFire;
  }, { initial, label: 'well rescue' });
  assert.equal(h.type, 'house'); assert.equal(f.houseId, h.id); assert(sawWater); assert.equal(buckets, 3);
  for (const k of G.SUPPLY.types) { near(h.supplyStock[k], (stock[k] || 0)); near(G.game.supplyLost[k], 0); }
  assert.equal(c.carry, null); return { sawWater, buckets, originalStockPreserved: stock, trip };
});

test('unquenched fire loses exactly stored goods after real elapsed time and preserves evacuated family', () => {
  const G = fresh(), h = build(G, 'house', 18, 10), backup = build(G, 'house', 27, 10), { f } = family(G, h, [30, 8]);
  G.enablePhysicalSupplyPrototype(); const burned = { grain: 6, vegetables: 7, meat: 8, firewood: 4, coal: 3 };
  seedStore(G, h, burned); seedStore(G, backup, { grain: 25, vegetables: 25, meat: 25, firewood: 10 });
  const initial = inventory(G); ignite(G, h); assert.equal(f.houseId, backup.id);
  const wait = runUntil(G, () => h.type === 'burntruins', { initial, label: 'natural burnout' });
  assert(wait.hours >= G.FIRE.warningHours + G.FIRE.burnHours); assert.equal(h.supplyStock, undefined);
  for (const k of G.SUPPLY.types) near(G.game.supplyLost[k], (burned[k] || 0), `burned ${k}`);
  assert.equal(G.world.supplyCaches.length, 0); assert.equal(G.game.stats.died, 0); assert.equal(f.houseId, backup.id);
  const loss = { ...G.game.supplyLost }; assert(G.removeBuilding(h)); assert.deepEqual({ ...G.game.supplyLost }, loss);
  conserved(G, initial, 'ruin removal'); return { burned, wait, deaths: G.game.stats.died };
});

test('five-type vendor cargo retains all items through destination loss and physical return', () => {
  const G = fresh({ legacy: true }), market = build(G, 'market', 20, 10), h = build(G, 'house', 27, 10), { c } = family(G, h);
  G.game.day = 24; G.enablePhysicalSupplyPrototype(); G.game.season = 2; G.setHeatingPolicy(true, 20);
  seedStore(G, h, { grain: 30, vegetables: 30, meat: 30, firewood: 10 });
  const initial = inventory(G), before = { ...G.game.res }; G.assignWorker(market, c);
  runUntil(G, () => !!G.supplyCargo(c), { citizen: c, initial, label: 'five-type vendor pickup' });
  const cargo = { ...G.supplyCargoItems(c.carry) }; assert.equal(Object.keys(cargo).length, 5);
  runUntil(G, () => c.x >= 12, { citizen: c, initial, label: 'walk vendor cargo before closure' });
  assert(G.removeBuilding(market)); assert(c.carry); const trip = deliver(G, c, initial);
  for (const k of G.SUPPLY.types) near(G.game.res[k], before[k], `returned ${k}`);
  assert.equal(G.world.supplyCaches.length, 0); assert(trip.distance > 0); return { cargo, trip };
});

test('repeated reload of a fractional in-flight mixed basket preserves destination and rejects stale task execution', () => {
  const G = fresh(), h = build(G, 'house', 27, 10), { c, f } = family(G, h);
  G.enablePhysicalSupplyPrototype(); const initial = inventory(G), { items } = pickup(G, c, h, initial);
  runUntil(G, () => c.x > 12.05, { citizen: c, initial, label: 'fractional cargo position' });
  const at = { x: c.x, y: c.y }, stale = c.task, stockBefore = { ...G.game.res }; assert(Math.abs(c.x - Math.round(c.x)) > .01);
  roundtrip(G, initial); const loaded = G.world.cmap[c.id];
  assert.equal(loaded.carry.supplyBatch.familyId, f.id); assert.equal(loaded.carry.supplyBatch.kind, 'home');
  assert.deepEqual({ ...G.supplyCargoItems(loaded.carry) }, items); near(loaded.x, at.x); near(loaded.y, at.y);
  assert.equal(G.supplyTaskCurrent(c, stale), false); assert.equal(G.stepSupply(c, 1000), false); conserved(G, initial, 'stale supply callback');
  const trip = deliver(G, loaded, initial); assert(trip.distance > 0);
  for (const k of G.SUPPLY.types) { near(G.world.bmap[h.id].supplyStock[k], items[k] || 0); near(G.game.res[k], stockBefore[k]); }
  return { reloads: 3, at, items, trip };
});

test('five-type vendor cargo survives three reloads then reaches its market without public redeposit', () => {
  const G = fresh({ legacy: true }), market = build(G, 'market', 20, 10), h = build(G, 'house', 27, 10), { c } = family(G, h);
  G.enablePhysicalSupplyPrototype(); G.game.day = 24; G.game.season = 2; G.game.townLedger = G.newTownLedger(G.game); G.setHeatingPolicy(true, 20);
  seedStore(G, h, { grain: 30, vegetables: 30, meat: 30, firewood: 10 }); const initial = inventory(G);
  G.assignWorker(market, c); runUntil(G, () => !!c.carry, { citizen: c, initial, label: 'reload vendor pickup' });
  const items = { ...G.supplyCargoItems(c.carry) }, publicAfterPickup = { ...G.game.res }; assert.equal(Object.keys(items).length, 5);
  G.stepCitizen(c, .1); roundtrip(G, initial); const loaded = G.world.cmap[c.id];
  assert.equal(loaded.carry.supplyBatch.kind, 'vendor'); assert.equal(loaded.carry.supplyBatch.to, market.id);
  const trip = deliver(G, loaded, initial); assert(trip.distance > 0);
  for (const k of G.SUPPLY.types) { near(G.world.bmap[market.id].supplyStock[k], items[k] || 0); near(G.game.res[k], publicAfterPickup[k]); }
  return { reloads: 3, items, trip };
});

test('camp and death-cache stocks survive repeated reload and are still real reachable sources', () => {
  const G = fresh(), old = build(G, 'house', 18, 17), doomed = family(G, old, [30]), homeless = family(G, null, [30, 30], 23, 10);
  G.enablePhysicalSupplyPrototype(); const camp = homeless.f.supplyCamp; seedStore(G, camp, { grain: 2, vegetables: 2, meat: 2 });
  const initial = inventory(G); pickup(G, doomed.c, old, initial);
  runUntil(G, () => doomed.c.x >= 14, { citizen: doomed.c, initial, label: 'cache source position' }); G.killCitizen(doomed.c, 'fixture accident');
  const cache = G.world.supplyCaches[0], cached = { ...cache.supplyStock }; assert(cache);
  roundtrip(G, initial); const f = G.world.families.find(x => x.id === homeless.f.id), c = G.world.cmap[homeless.c.id];
  assert.equal(f.houseId, null); near(G.supplyFood(f.supplyCamp.supplyStock), 6);
  const loadedCache = G.world.supplyCaches.find(x => x.id === cache.id); assert.deepEqual({ ...loadedCache.supplyStock }, cached);
  assert(G.beginSupplyTrip(c, f.supplyCamp)); assert.equal(c.task.source, loadedCache);
  runUntil(G, () => !!c.carry, { citizen: c, initial, label: 'loaded cache pickup' }); const trip = deliver(G, c, initial);
  assert(G.supplyFood(f.supplyCamp.supplyStock) > 6); assert(trip.distance > 0);
  return { reloads: 3, cached, trip };
});

test('legacy snapshot without supply fields remains automatic and preserves original stock', () => {
  const G = fresh({ legacy: true }), h = build(G, 'house', 18, 10); family(G, h);
  const snapshot = save(G), before = { ...G.game.res };
  for (const key of ['supplyMode', 'supplyStartedDay', 'supplyUsed', 'supplyLost']) delete snapshot.game[key];
  delete snapshot.supplyCaches; G.applySaveData(snapshot);
  assert.equal(G.game.supplyMode, 'automatic'); assert.equal(G.game.supplyStartedDay, null);
  assert.equal(G.world.bmap[h.id].supplyStock, undefined); assert.equal(G.world.supplyCaches.length, 0);
  for (const k of G.SUPPLY.types) near(G.game.res[k], before[k]);
  return { supplyMode: G.game.supplyMode, preservedPublicFood: G.game.res.food };
});

test('malformed supply stores, mixed cargo and caches reject atomically without changing current deliveries', () => {
  const G = fresh(), h = build(G, 'house', 27, 10), empty = build(G, 'house', 18, 17), { c } = family(G, h);
  G.enablePhysicalSupplyPrototype(); seedStore(G, empty, { grain: 2, firewood: 2 }); assert(G.removeBuilding(empty));
  const initial = inventory(G); pickup(G, c, h, initial); const valid = save(G), world = G.world, game = G.game;
  const carrier = d => d.citizens.find(x => x.id === c.id), home = d => d.buildings.find(x => x.id === h.id);
  const mutations = [
    d => { d.game.supplyMode = 'bogus'; },
    d => { d.game.supplyUsed.grain = -1; },
    d => { home(d).supplyStock.tools = 1; },
    d => { home(d).supplyStock.grain = G.SUPPLY.homeCap + 1; },
    d => { carrier(d).carry.extra[carrier(d).carry.type] = 1; },
    d => { carrier(d).carry.extra.tools = 1; },
    d => { carrier(d).carry.qty = 1000; },
    d => { carrier(d).carry.supplyBatch.kind = 'bogus'; },
    d => { carrier(d).carry.supplyBatch.familyId = -1; },
    d => { carrier(d).carry.staffingReturn = false; },
    d => { d.supplyCaches[0].id = c.id; },
    d => { d.supplyCaches[0].supplyStock.coal = -1; },
    d => { d.supplyCaches[0].w = 0; },
    d => { d.supplyCaches[0].x = -1; },
  ];
  for (const [i, mutate] of mutations.entries()) {
    const bad = JSON.parse(JSON.stringify(valid)); mutate(bad); assert.throws(() => G.applySaveData(bad), `mutation ${i} accepted`);
    assert.equal(G.world, world); assert.equal(G.game, game); conserved(G, initial, `malformed mutation ${i}`);
    assert.equal(JSON.stringify(save(G)), JSON.stringify(valid), `mutation ${i} changed live state`);
  }
  deliver(G, c, initial); return { rejectedMutations: mutations.length };
});

test('an empty household cannot eat or heat remotely from abundant public stores', () => {
  const G = fresh({ legacy: true }), h = build(G, 'house', 25, 10), { c } = family(G, h, [8]);
  G.enablePhysicalSupplyPrototype(); G.game.day = 35; G.game.season = 2; G.game.h = 23.9; G.game.townLedger = G.newTownLedger(G.game);
  const initial = inventory(G), before = { ...G.game.res }; G.advanceSim(.2); conserved(G, initial, 'empty winter household');
  assert.equal(c.hunger, 1); assert(h.unheated); near(h.lastHeating.wood, 0); near(h.lastHeating.coal, 0);
  near(G.supplySum(G.game.supplyUsed), 0); for (const k of G.SUPPLY.types) near(G.game.res[k], before[k]);
  return { publicFood: G.game.res.food, publicFirewood: G.game.res.firewood, hunger: c.hunger, unheated: h.unheated };
});

test('blocked delivery waits with its exact cargo then crosses the reopened route without teleporting', () => {
  const G = fresh(), h = build(G, 'house', 25, 10), { c } = family(G, h);
  for (let y = 0; y < G.world.N; y++) G.world.water[y * G.world.N + 15] = 1;
  G.world.water[10 * G.world.N + 15] = 0; G.bumpNavigation(G.world);
  G.enablePhysicalSupplyPrototype(); const initial = inventory(G), { items } = pickup(G, c, h, initial), publicBefore = { ...G.game.res };
  G.world.water[10 * G.world.N + 15] = 1; G.bumpNavigation(G.world);
  runUntil(G, () => c.state === 'supplyWait', { citizen: c, initial, label: 'closed crossing' });
  const at = { x: c.x, y: c.y }, task = c.task;
  for (let i = 0; i < 50; i++) { G.stepCitizen(c, .1); conserved(G, initial, 'blocked waiting'); }
  near(c.x, at.x); near(c.y, at.y); assert.equal(c.task, task); assert.deepEqual({ ...G.supplyCargoItems(c.carry) }, items); near(G.supplySum(h.supplyStock), 0);
  G.world.water[10 * G.world.N + 15] = 0; G.bumpNavigation(G.world); const trip = deliver(G, c, initial);
  for (const k of G.SUPPLY.types) { near(h.supplyStock[k], items[k] || 0); near(G.game.res[k], publicBefore[k]); }
  return { waitHours: 5, at, items, trip };
});

test('active fire and evacuated camp survive reload without duplicating or losing household stock', () => {
  const G = fresh(), h = build(G, 'house', 18, 10); build(G, 'well', 22, 10); const { f } = family(G, h, [30, 30]);
  G.enablePhysicalSupplyPrototype(); seedStore(G, h, { grain: 6, vegetables: 7, meat: 8, firewood: 4, coal: 3 }); const initial = inventory(G);
  ignite(G, h); G.reconcileSupplyHomes(); assert(f.supplyCamp);
  runUntil(G, () => G.world.citizens.some(c => G.fireTaskOf(c)?.water), { initial, label: 'pre-reload rescue water' });
  const before = { ...h.supplyStock }, need = h.houseFire.need, elapsed = h.houseFire.elapsed;
  roundtrip(G, initial); const loadedHome = G.world.bmap[h.id], loadedFamily = G.world.families.find(x => x.id === f.id);
  assert.equal(loadedHome.houseFire.need, need); near(loadedHome.houseFire.elapsed, elapsed); assert(loadedFamily.supplyCamp);
  assert.deepEqual({ ...loadedHome.supplyStock }, before);
  const trip = runUntil(G, () => !loadedHome.houseFire, { initial, label: 'loaded real rescue' });
  assert.equal(loadedHome.type, 'house'); assert.equal(loadedFamily.houseId, loadedHome.id); near(G.supplySum(G.game.supplyLost), 0);
  assert.deepEqual({ ...loadedHome.supplyStock }, before); return { reloads: 3, preservedFireNeed: need, preservedElapsed: elapsed, trip };
});

test('real household baskets substitute permitted coal for missing firewood without touching the industrial reserve', () => {
  const G = fresh({ legacy: true }), h = build(G, 'house', 25, 10), { c } = family(G, h);
  G.game.res.firewood = 1; G.game.res.coal = 24.5; G.game.day = 24; G.game.season = 2; G.game.townLedger = G.newTownLedger(G.game);
  G.setHeatingPolicy(true, 20); G.enablePhysicalSupplyPrototype(); const initial = inventory(G), { items } = pickup(G, c, h, initial);
  assert.equal(Object.keys(items).length, 5); near(items.firewood, 1); near(items.coal, 4.5); near(G.game.res.coal, 20);
  const trip = deliver(G, c, initial); near(h.supplyStock.coal, 4.5); assert(G.supplyFood(h.supplyStock) > 0);
  G.game.day = 35; G.game.season = 2; G.game.h = 23.9; G.game.townLedger = G.newTownLedger(G.game); G.advanceSim(.2);
  conserved(G, initial, 'delivered coal heating'); near(h.lastHeating.wood, 1); near(h.lastHeating.coal, .75); assert(!h.unheated); near(G.game.res.coal, 20);
  return { items, publicCoalReserve: G.game.res.coal, heating: { ...h.lastHeating }, trip };
});

test('demolishing the only home reroutes an already-carried family basket to its physical camp', () => {
  const G = fresh(), h = build(G, 'house', 25, 10), { c, f } = family(G, h);
  G.enablePhysicalSupplyPrototype(); const initial = inventory(G), { items } = pickup(G, c, h, initial), afterPickup = { ...G.game.res };
  assert(G.removeBuilding(h)); const trip = deliver(G, c, initial);
  assert(f.supplyCamp); assert.equal(f.houseId, null);
  for (const k of G.SUPPLY.types) { near(f.supplyCamp.supplyStock[k], items[k] || 0, 'family camp delivery'); near(G.game.res[k], afterPickup[k], 'cargo not silently returned'); }
  return { items, trip };
});

test('formal opt-in quote is read-only and grants a conserved two-day starting allocation exactly once across reload', () => {
  const G = fresh({ legacy: true }), h = build(G, 'house', 18, 10), boarding = build(G, 'boarding', 25, 10);
  family(G, h, [30, 8]); family(G, boarding, [30, 8]); family(G, boarding, [30]); family(G, null, [30], 33, 10);
  G.game.day = 24; G.game.season = 2; G.game.townLedger = G.newTownLedger(G.game);
  G.game.res.firewood = 1; G.game.res.coal = 24.5; G.setHeatingPolicy(true, 20);
  const original = JSON.stringify(save(G)), initial = inventory(G), before = { ...G.game.res }; let quote;
  for (let i = 0; i < 10; i++) { quote = G.supplyModeQuote(); assert(quote.ok); assert.equal(JSON.stringify(save(G)), original); }
  assert.equal(quote.rows.length, 3); assert.equal(quote.population, 6); near(quote.foodDays, 2); near(quote.cost.firewood, 1); near(quote.cost.coal, 4.5); assert(quote.fuelShortfall > 0);
  assert(G.enableHouseholdSupply(quote.key)); conserved(G, initial, 'formal allocation');
  for (const k of G.SUPPLY.types) near(G.game.res[k], before[k] - quote.cost[k]);
  for (const row of quote.rows) {
    const target = row.target === 'building' ? G.world.bmap[row.id] : G.world.families.find(f => f.id === row.id).supplyCamp;
    for (const k of G.SUPPLY.types) near(target.supplyStock[k], row.stock[k]);
  }
  const enabled = JSON.stringify(save(G)); assert.equal(G.enableHouseholdSupply(quote.key), false); assert.equal(JSON.stringify(save(G)), enabled);
  roundtrip(G, initial); const reloaded = JSON.stringify(save(G)); assert.equal(G.supplyModeQuote().ok, false); assert.equal(G.enableHouseholdSupply(quote.key), false); assert.equal(JSON.stringify(save(G)), reloaded);
  return { households: quote.rows.length, population: quote.population, foodDays: quote.foodDays, allocation: { ...quote.cost }, fuelShortfall: quote.fuelShortfall, reloads: 3 };
});

test('scarce startup food is prorated by household members with no fabricated allocation', () => {
  const G = fresh(), a = build(G, 'house', 18, 10), b = build(G, 'house', 25, 10);
  family(G, a, [30, 8]); family(G, b, [30]); family(G, null, [30], 33, 10);
  Object.assign(G.game.res, { grain: 1, vegetables: 2, meat: 3, food: 6 }); const initial = inventory(G), quote = G.supplyModeQuote();
  assert(quote.foodDays < 2); assert(quote.foodShortfall > 0); near(G.supplyFood(quote.cost), 6); assert(G.enableHouseholdSupply(quote.key));
  conserved(G, initial, 'prorated startup'); near(G.game.res.food, 0);
  for (const row of quote.rows) { near(G.supplyFood(row.stock), 6 * row.people / 4); near(row.foodDays, quote.foodDays); }
  return { population: quote.population, allocatedFood: G.supplyFood(quote.cost), foodDays: quote.foodDays, shortfall: quote.foodShortfall };
});

test('startup allocation rejects stale stock, family and prior-world quotes without partial opt-in', () => {
  const G = fresh(), h = build(G, 'house', 18, 10), { f } = family(G, h);
  let quote = G.supplyModeQuote(); G.withdrawResource('grain', 1); let before = JSON.stringify(save(G));
  assert.equal(G.enableHouseholdSupply(quote.key), false); assert.equal(JSON.stringify(save(G)), before); assert.equal(G.supplyEnabled(), false);
  quote = G.supplyModeQuote(); const child = G.spawnCitizen({ x: 17, y: 11, age: 8, sex: 'm', familyId: f.id }); f.members.push(child.id); before = JSON.stringify(save(G));
  assert.equal(G.enableHouseholdSupply(quote.key), false); assert.equal(JSON.stringify(save(G)), before);
  quote = G.supplyModeQuote(); const oldGame = G.game; G.applySaveData(save(G)); before = JSON.stringify(save(G));
  assert.equal(G.enableHouseholdSupply(quote.key, oldGame), false); assert.equal(JSON.stringify(save(G)), before);
  const initial = inventory(G); assert(G.enableHouseholdSupply(G.supplyModeQuote().key)); conserved(G, initial, 'fresh confirmed quote');
  return { rejectedStaleQuotes: ['stock', 'family', 'prior world'], enabledOnlyWithFreshQuote: G.supplyEnabled() };
});

test('disabling household coal recovers existing home and market coal through real pickup and public delivery', () => {
  const G = fresh(), h = build(G, 'house', 20, 10), market = build(G, 'market', 27, 10), { c } = family(G, h);
  G.enablePhysicalSupplyPrototype(); G.setHeatingPolicy(true, 20); seedStore(G, h, { grain: 30, firewood: 10, coal: 6 }); seedStore(G, market, { coal: 7 });
  const initial = inventory(G), publicBefore = G.game.res.coal; assert(G.setHeatingPolicy(false, 20));
  near(G.game.res.coal, publicBefore); near(h.supplyStock.coal, 6); near(market.supplyStock.coal, 7);
  const trips = [];
  for (const source of [h, market]) {
    const qty = source.supplyStock.coal; G.requestTask(c); assert.equal(c.task?.phase, 'recover'); assert.equal(c.task.source, source);
    runUntil(G, () => !!c.carry, { citizen: c, initial, label: 'disabled coal recovery pickup' });
    assert.equal(c.carry.type, 'coal'); near(c.carry.qty, qty); assert.equal(c.carry.supplyBatch.kind, 'return'); near(source.supplyStock.coal, 0);
    const trip = deliver(G, c, initial); assert(trip.distance > 0); trips.push(trip);
  }
  near(G.game.res.coal, publicBefore + 13); near(h.supplyStock.grain, 30); near(h.supplyStock.firewood, 10); near(G.game.supplyUsed.coal, 0);
  return { physicallyRecoveredCoal: 13, trips };
});

test('actual boarding delivery then demolition preserves its legal 4x3 recovery footprint across reload', () => {
  const G=fresh(), b=build(G,'boarding',15,10), {c}=family(G,b);G.enablePhysicalSupplyPrototype();
  const initial=inventory(G);G.requestTask(c);runUntil(G,()=>G.supplyFood(b.supplyStock)>0&&!c.carry,{initial,label:'actual boarding delivery'});
  G.prepareSaveData(save(G));const before={...b.supplyStock};assert(G.removeBuilding(b));
  const cache=G.world.supplyCaches.find(x=>x.x===b.x&&x.y===b.y);assert.equal(cache.w,4);assert.equal(cache.h,3);
  roundtrip(G,initial);const loaded=G.world.supplyCaches.find(x=>x.id===cache.id);assert.equal(loaded.w,4);assert.equal(loaded.h,3);
  for(const k of G.SUPPLY.types)near(loaded.supplyStock[k],before[k]);
  return {width:loaded.w,height:loaded.h,reloads:3,stock:before};
});

test('enabling during actual market construction creates no site inventory and is loadable', () => {
  const G=fresh(), h=build(G,'house',15,10);family(G,h);const planned=G.addBuilding('market',22,10);assert(planned.ok);
  assert(G.enableHouseholdSupply(G.supplyModeQuote().key));assert.equal(planned.b.state,'site');assert.equal(planned.b.supplyStock,undefined);
  const initial=inventory(G);roundtrip(G,initial);assert.equal(G.world.bmap[planned.b.id].supplyStock,undefined);
  return {reloads:3,siteStock:'absent'};
});

test('continuous school duty yields to real household shopping before hunger and keeps the one teacher role', () => {
  const G=fresh(), h=build(G,'house',15,10), {c}=family(G,h), school=build(G,'school',20,10);c.educated=true;
  assert(G.enableHouseholdSupply(G.supplyModeQuote().key));G.assignWorker(school,c);
  let supplyTicks=0,hunger=0,away=false;const initial=inventory(G);
  for(let i=0;i<840;i++){G.advanceSim(.1);conserved(G,initial,'teacher actual '+i);hunger=Math.max(hunger,c.hunger);if(G.supplyTaskOf(c)){supplyTicks++;away=true;assert.equal(G.inSchool(c),false);assert.equal(c.job,school.id);}assert(school.workers.length<=1);}
  assert(supplyTicks>0);assert(away);assert.equal(hunger,0);assert.equal(c.job,school.id);
  return {hours:84,supplyTicks,hunger,job:c.job};
});

function clothingMode(G) { assert(G.enableClothingSupply(G.clothingSupplyQuote().key)); }

test('clothing adoption is explicit, allocates nothing and migrates five-item physical saves without changing worn life', () => {
  const G=fresh(),h=build(G,'house',18,10),{c}=family(G,h);G.enablePhysicalSupplyPrototype();c.clothingType='basic';c.clothingLeft=9;
  G.game.res.clothes=3;G.game.res.warmCoats=2;const old=save(G);delete old.game.clothingSupply;
  // Build the historical five-item schema explicitly; deleting only clothing
  // from a current save would leave later eggs/fruit in an invented old shape.
  const legacyTypes=['grain','vegetables','meat','firewood','coal'];
  for(const stock of [old.game.supplyUsed,old.game.supplyLost,...old.buildings.map(b=>b.supplyStock).filter(Boolean)]){
    for(const k of Object.keys(stock))if(!legacyTypes.includes(k)){assert.equal(stock[k],0);delete stock[k];}
    assert.equal(Object.keys(stock).length,5);
  }
  G.applySaveData(old);assert.equal(G.clothingSupplyEnabled(),false);assert.equal(G.world.cmap[c.id].clothingLeft,9);
  const before=inventory(G),q=G.clothingSupplyQuote();clothingMode(G);conserved(G,before,'enable no gift');assert.equal(G.world.cmap[c.id].clothingLeft,9);
  assert.equal(G.enableClothingSupply(q.key),false);roundtrip(G,before);assert(G.clothingSupplyEnabled());
  return {legacyItems:5,oldWear:9,allocated:0,reloads:3};
});

test('market vendor and family carry whole warm coats before actual home replacement, preserving the child old coat', () => {
  const G=fresh(),market=build(G,'market',18,10),vh=build(G,'house',24,10),home=build(G,'house',24,17);
  const vendor=family(G,vh).c,{c,people}=family(G,home,[30,8]);vendor.clothingLeft=40;vendor.clothingType='basic';people[1].clothingLeft=5;people[1].clothingType='basic';
  G.game.res.warmCoats=2;G.game.res.clothes=3;G.enablePhysicalSupplyPrototype();clothingMode(G);
  seedStore(G,vh,{grain:40,firewood:10});const initial=inventory(G);G.assignWorker(market,vendor);
  runUntil(G,()=>!!vendor.carry,{citizen:vendor,initial,label:'coat vendor pickup'});const basket=G.supplyCargoItems(vendor.carry);assert.equal(basket.warmCoats,2);assert.equal(basket.clothes,1);
  deliver(G,vendor,initial);assert.equal(market.supplyStock.warmCoats,2);assert.equal(c.clothingLeft,0);
  pickup(G,c,home,initial);assert.equal(c.task.source,market);assert.equal(G.supplyCargoItems(c.carry).warmCoats,2);
  deliver(G,c,initial);assert.equal(home.supplyStock.warmCoats,2);assert.equal(c.clothingLeft,0);
  G.game.h=23.9;G.advanceSim(.2);conserved(G,initial,'wear actual midnight');assert.equal(c.clothingType,'warm');assert.equal(c.clothingLeft,G.YEAR_DAYS);assert.equal(people[1].clothingLeft,4);assert.equal(people[1].clothingType,'basic');assert.equal(home.supplyStock.warmCoats,1);
  assert.equal(G.game.supplyUsed.warmCoats,1);roundtrip(G,initial);assert.equal(G.world.cmap[c.id].clothingLeft,G.YEAR_DAYS);
  return {vendorCoats:3,homeCoats:2,actuallyWorn:1,childOldDays:4};
});

test('unreachable public clothes do not equip remotely; reopening the crossing enables real delivery and winter protection', () => {
  const G=fresh({ legacy: true }),h=build(G,'house',25,10),{c}=family(G,h);G.game.res.warmCoats=2;G.enablePhysicalSupplyPrototype();clothingMode(G);seedStore(G,h,{grain:80,firewood:30});
  for(let y=0;y<G.world.N;y++)G.world.water[y*G.world.N+15]=1;G.bumpNavigation(G.world);G.game.day=36;G.game.season=3;G.game.h=8;G.game.townLedger=G.newTownLedger(G.game);
  const initial=inventory(G);for(let n=0;n<240;n++){G.advanceSim(.1);conserved(G,initial,'blocked coat '+n);assert.equal(c.clothingLeft,0);}
  assert.equal(G.game.res.warmCoats,2);const before=c.cold;G.world.water[10*G.world.N+15]=0;G.bumpNavigation(G.world);
  const trip=runUntil(G,()=>c.clothingType==='warm',{initial,label:'reopened clothing'});assert(trip.distance>0);assert.equal(G.clothingColdMul(c),.3);assert.equal(G.game.supplyUsed.warmCoats,1);
  return {blockedHours:24,trip,beforeCold:before,protection:.3};
});

test('mixed clothing carrier death leaves exact real garments recoverable once', () => {
  const G=fresh(),h=build(G,'house',25,10),{c}=family(G,h,[30,8]);G.game.res.clothes=2;G.game.res.warmCoats=1;G.enablePhysicalSupplyPrototype();clothingMode(G);
  const initial=inventory(G),{items}=pickup(G,c,h,initial);assert.equal(items.warmCoats,1);assert.equal(items.clothes,1);G.killCitizen(c,'测试');conserved(G,initial,'death coat cache');
  const cache=G.world.supplyCaches[0];assert.equal(cache.supplyStock.warmCoats,1);assert.equal(cache.supplyStock.clothes,1);roundtrip(G,initial);
  const helper=family(G,null).c;helper.clothingLeft=30;helper.clothingType='basic';const next=inventory(G);assert(G.beginSupplyRecovery(helper));
  runUntil(G,()=>!!helper.carry,{citizen:helper,initial:next,label:'recover clothing'});deliver(G,helper,next);assert.equal(G.game.res.warmCoats,1);assert.equal(G.game.res.clothes,2);
  return {cacheCoats:2,reloads:3,recoveredWarm:1};
});

test('canceled clothing delivery survives fractional full public room and reload without splitting a garment', () => {
  const G=fresh(),h=build(G,'house',25,10),{c}=family(G,h);G.game.res.warmCoats=1;G.enablePhysicalSupplyPrototype();clothingMode(G);seedStore(G,h,{grain:50,firewood:10});
  pickup(G,c,h);assert.equal(G.supplyCargoItems(c.carry).warmCoats,1);G.game.res.warmCoats=G.storageCap('warmCoats')-.5;
  const initial=inventory(G);G.returnSupplyCargo(c);runUntil(G,()=>c.state==='supplyWait',{citizen:c,initial,label:'fractional clothing room'});
  assert.equal(G.supplyCargoItems(c.carry).warmCoats,1);roundtrip(G,initial);let loaded=G.world.cmap[c.id];
  for(let i=0;i<50;i++){G.stepCitizen(loaded,.1);conserved(G,initial,'full coats');}assert.equal(G.supplyCargoItems(loaded.carry).warmCoats,1);
  G.withdrawResource('warmCoats',.5);const next=inventory(G);deliver(G,loaded,next);assert.equal(G.game.res.warmCoats,G.storageCap('warmCoats'));assert.equal(G.game.supplyUsed.warmCoats,0);
  return {heldCoats:1,partialRoom:.5,reloads:3,deliveredOnce:1};
});

test('clothing pickup races recheck stock and stockpiles never supply clothes', () => {
  const G=fresh(),a=build(G,'house',18,10),b=build(G,'house',18,18),ca=family(G,a).c,cb=family(G,b).c;G.game.res.warmCoats=1;G.enablePhysicalSupplyPrototype();clothingMode(G);
  const pile=build(G,'stockpile',13,10);assert.equal(G.supplySourceStock(pile,a,false).stock.warmCoats,0);assert.equal(G.supplySourceStock(pile,a,false).stock.clothes,0);
  assert(G.beginSupplyTrip(ca,a));assert(G.beginSupplyTrip(cb,b));const initial=inventory(G);
  runUntil(G,()=>!!ca.carry&&!!cb.carry,{initial,label:'last warm coat race'});
  near((G.supplyCargoItems(ca.carry).warmCoats||0)+(G.supplyCargoItems(cb.carry).warmCoats||0),1);assert.equal(G.game.res.warmCoats,0);
  return {lastCoat:1,carriers:2};
});

test('malformed fractional, disabled and incomplete clothing supply saves reject atomically', () => {
  const G=fresh(),h=build(G,'house',18,10);family(G,h);G.game.res.warmCoats=1;G.enablePhysicalSupplyPrototype();clothingMode(G);seedStore(G,h,{warmCoats:1});
  const valid=save(G),world=G.world,game=G.game;
  for(const mutate of [d=>{d.buildings.find(b=>b.id===h.id).supplyStock.warmCoats=.5;},d=>{d.game.clothingSupply=false;},d=>{delete d.buildings.find(b=>b.id===h.id).supplyStock.clothes;},d=>{d.game.supplyMode='automatic';}]){
    const bad=JSON.parse(JSON.stringify(valid));mutate(bad);assert.throws(()=>G.applySaveData(bad));assert.equal(G.world,world);assert.equal(G.game,game);
  }
  return {atomicRejects:4};
});

console.log(JSON.stringify({ suite: 'household-supply-lifecycles', sourceHash: loadGame(root).testSourceHash, passed: results.length, results }, null, 2));
