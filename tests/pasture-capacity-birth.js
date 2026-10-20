#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadGame } = require('./helpers/playability');
let passed = 0;
const save = G => JSON.parse(JSON.stringify(G.serializeGame()));
function test(name, fn) { fn(); passed++; console.log('ok ' + name); }
function fresh(type = 'cattle', size) {
  const G = loadGame(path.resolve(__dirname, '..')); G.newGame(5);
  const w = G.world;
  for (const k of ['water', 'rock', 'road']) w[k].fill(0);
  w.bgrid.fill(-1); w.treeIdx.fill(-1); w.trees = []; w.buildings = []; w.bmap = {};
  w.citizens = []; w.cmap = {}; w.families = []; w.marked.clear(); w.markedRocks.clear(); G.bumpNavigation(w);
  G.game.h = 12; G.rng = () => .5;
  G.addBuilding('storage', 2, 2, { instant: true, free: true });
  for (const k of G.RES_KEYS) G.game.res[k] = 0;
  G.game.res.tools = 100;
  const b = G.addBuilding('pasture', 10, 10, { instant: true, free: true, ...(size ? { pastureSize: size } : {}) }).b;
  assert(G.setPastureType(b, type)); const cap = G.pastureCapacity(b);
  G.game.livestock[type] = cap; assert(G.stockPasture(b, cap)); assert(G.setPastureTarget(b, cap));
  const c = G.spawnCitizen({ x: 8, y: 10, age: 30, sex: 'm' }); c.job = b.id; b.workers = [c.id];
  const generate = G.genWorld;
  G.genWorld = (seed, options) => { const nw = generate(seed, options); nw.water.set(w.water); nw.rock.set(w.rock); return nw; };
  return { G, b, c, cap };
}
function until(G, cs, done, limit = 20000) {
  for (let i = 0; i < limit && !done(); i++) for (const c of cs) G.stepCitizen(c, .1);
  assert(done(), 'Expected actual work/haul result missing');
}
function ready({ G, b, c }) { b.animalGrowth = 1; G.requestTask(c); }
function delivered(G, b, cs, count = 1) {
  const d = G.LIVESTOCK[G.pastureTypeOf(b)];
  until(G, cs, () => G.game.res.meat === count * d.meat && G.game.res.leather === count * d.leather);
}
function next(G) { G.closeTownLedgerDay(); G.game.day++; G.advanceTownEconomy(); }

test('genuine full herd plus user maximum target still accumulates births, requiring actual work and hauling', () => {
  for (const type of ['cattle', 'sheep', 'chicken']) {
    const f = fresh(type), { G, b, c, cap } = f;
    G.requestTask(c); until(G, [c], () => b.tendedDay === G.game.day);
    while (b.animalGrowth < 1) {
      next(G);
      if (b.animalGrowth < 1) until(G, [c], () => b.tendedDay === G.game.day);
    }
    assert.equal(b.animals, cap); assert.equal(G.game.res.meat, 0); assert.equal(b.produced?.meat || 0, 0);
    // Remove already-laid eggs only in this isolated source test by actually
    // hauling them; the annual experiment covers continuing daily egg traffic.
    delivered(G, b, [c]); assert.equal(b.animals, cap); assert.equal(b.animalGrowth, 0);
    assert.equal(b.produced.meat, G.LIVESTOCK[type].meat);
    const ledger = G.ensureTownLedger().current.flows.meat;
    assert.equal(ledger.produced, G.LIVESTOCK[type].meat); assert.equal(ledger.received, G.LIVESTOCK[type].meat);
  }
});
test('fractional progress cannot create meat; ordinary below-cap retention still removes one excess animal', () => {
  const { G, b, c, cap } = fresh(); b.animalGrowth = .999;
  G.requestTask(c); until(G, [c], () => b.tendedDay === G.game.day);
  assert.equal(b.animals, cap); assert.equal(b.animalGrowth, .999); assert(!c.carry); assert.equal(G.game.res.meat, 0);
  assert(G.setPastureTarget(b, cap - 1)); delivered(G, b, [c]);
  assert.equal(b.animals, cap - 1); assert.equal(b.animalGrowth, .999);
});
test('absence and zero jobs cannot consume a capacity birth or remotely produce meat', () => {
  const { G, b, c, cap } = fresh(); b.animalGrowth = 1; c.job = null; b.workers = []; assert(G.setWorkerLimit(b, 0));
  for (let i = 0; i < 10; i++) next(G);
  assert.equal(b.animals, cap); assert.equal(b.animalGrowth, 1); assert.equal(b.produced?.meat || 0, 0);
  assert.equal(G.game.res.meat, 0); assert.equal(G.game.res.leather, 0);
});
test('remote, cancelled and removed-pen tasks cannot commit an accumulated birth', () => {
  for (const action of ['remote', 'release', 'remove']) {
    const f = fresh(), { G, b, c, cap } = f; ready(f); const task = c.task;
    if (action === 'release') G.releaseWorker(c);
    if (action === 'remove') G.removeBuilding(b);
    G.completeEconomyWork(c, task);
    assert.equal(b.produced?.meat || 0, 0); assert.equal(b.animalGrowth, 1);
    assert.equal(G.game.res.meat, 0); assert(!c.carry);
    if (action === 'remove') assert.equal(G.game.livestock.cattle, cap); else assert.equal(b.animals, cap);
  }
});
test('downstaffing an active task finishes its one accepted batch then stops, preserving remaining cattle products', () => {
  for (const type of ['cattle', 'sheep', 'chicken']) {
    const f = fresh(type), { G, b, c, cap } = f; ready(f); until(G, [c], () => c.state === 'work');
    assert(G.setWorkerLimit(b, 0));
    until(G, [c], () => c.job == null && !c.carry);
    assert.equal(b.animals, cap); assert.equal(b.animalGrowth, 0); assert.equal(b.produced.meat, G.LIVESTOCK[type].meat);
    assert.equal(G.game.res.meat, type === 'cattle' ? 20 : G.LIVESTOCK[type].meat);
    if (type === 'cattle') { assert.equal(b.pastureProducts.meat, 16); assert.equal(b.pastureProducts.leather, 4); }
    b.animalGrowth = 1;
    for (let i = 0; i < 500; i++) G.stepCitizen(c, .1);
    assert.equal(b.animalGrowth, 1); assert.equal(b.produced.meat, G.LIVESTOCK[type].meat);
  }
});
test('full storage and either output goal keep one pending birth without duplication or catch-up', () => {
  for (const blocked of ['meat', 'leather', 'storage']) {
    const f = fresh(), { G, b, c, cap } = f; ready(f);
    if (blocked === 'storage') G.game.res.food = G.game.res.grain = G.storageCap(); else assert(G.setProductionGoal(blocked, 0));
    until(G, [c], () => b.tendedDay === G.game.day);
    for (let i = 0; i < 20; i++) { next(G); for (let h = 0; h < 160; h++) G.stepCitizen(c, .1); }
    assert.equal(b.animals, cap); assert.equal(b.animalGrowth, 1); assert.equal(b.produced?.meat || 0, 0);
    if (blocked === 'storage') G.game.res.food = G.game.res.grain = 0; else assert(G.setProductionGoal(blocked, null));
    delivered(G, b, [c]); assert.equal(b.animals, cap); assert.equal(b.animalGrowth, 0); assert.equal(b.produced.meat, 36);
  }
});
test('repeated loads before and after capacity slaughter preserve growth, live animals, both outputs and ledger', () => {
  const f = fresh(); let { G, b, c, cap } = f; ready(f);
  for (let i = 0; i < 3; i++) G.applySaveData(save(G));
  b = G.world.bmap[b.id]; c = G.world.cmap[c.id]; assert.equal(b.animalGrowth, 1); assert.equal(b.animals, cap); assert.equal(b.produced?.meat || 0, 0);
  c.job = b.id; b.workers = [c.id]; G.requestTask(c); until(G, [c], () => !!c.carry);
  assert.equal(c.carry.qty, 20); assert.equal(b.pastureProducts.meat, 16); assert.equal(b.pastureProducts.leather, 4); assert.equal(b.animalGrowth, 0);
  for (let i = 0; i < 3; i++) G.applySaveData(save(G));
  b = G.world.bmap[b.id]; c = G.world.cmap[c.id]; c.job = b.id; b.workers = [c.id];
  delivered(G, b, [c]); assert.equal(G.ensureTownLedger().current.flows.meat.produced, 36); assert.equal(b.animals, cap); assert.equal(b.animalGrowth, 0);
});
test('partial real delivery retains exact remainder through goal changes, reload and worker release', () => {
  const f = fresh(); let { G, b, c, cap } = f; ready(f); until(G, [c], () => !!c.carry);
  G.game.res.food = G.game.res.grain = G.storageCap() - 7;
  until(G, [c], () => c.state === 'waitStorage'); assert.equal(G.game.res.meat, 7); assert.equal(c.carry.qty, 13);
  assert(G.setProductionGoal('meat', 0)); assert(G.setWorkerLimit(b, 0));
  G.applySaveData(save(G)); b = G.world.bmap[b.id]; c = G.world.cmap[c.id];
  assert.equal(b.animals, cap); assert.equal(b.animalGrowth, 0); assert.equal(c.carry.qty, 13);
  G.game.res.food -= 29; G.game.res.grain -= 29; G.startHaul(c);
  until(G, [c], () => G.game.res.meat === 20); assert.equal(b.pastureProducts.meat, 16);
  assert(G.setWorkerLimit(b, 1)); c.job = b.id; delete c.staffingRelease; b.workers = [c.id]; G.requestTask(c);
  delivered(G, b, [c]); assert.equal(b.animals, cap); assert.equal(G.ensureTownLedger().current.flows.meat.produced, 36);
});
test('two real area workers cannot slaughter the same accumulated birth twice', () => {
  const f = fresh('cattle', [20, 20]), { G, b, c, cap } = f;
  const second = G.spawnCitizen({ x: 8, y: 11, age: 30, sex: 'm' }); second.job = b.id; b.workers.push(second.id);
  ready(f); G.requestTask(second); delivered(G, b, [c, second]);
  assert.equal(b.animals, cap); assert.equal(b.animalGrowth, 0); assert.equal(b.produced.meat, 36); assert.equal(b.produced.leather, 4);
});
test('legacy small area capacity2 can use a birth without removing its breeding pair', () => {
  const f = fresh('cattle', [7, 7]), { G, b, c, cap } = f; assert.equal(cap, 2);
  ready(f); delivered(G, b, [c]); assert.equal(b.animals, 2); assert.equal(b.animalGrowth, 0);
  G.applySaveData(save(G)); assert.equal(G.world.bmap[b.id].animals, 2); assert.deepEqual(Array.from(G.world.bmap[b.id].pastureSize), [7, 7]);
});
test('mortality before commitment leaves growth to replace a lost animal instead of awarding meat', () => {
  const f = fresh(), { G, b, c, cap } = f; ready(f);
  const q = G.pasturePestsToggleQuote(true); assert(G.setPasturePests(true, q.key));
  G.game.day = 14; G.game.pasturePests.lastDay = 13;
  b.pastureInfestation = { animalType: 'cattle', startedDay: 12, lost: 0 };
  G.advancePasturePests(); assert.equal(b.animals, cap - 1);
  until(G, [c], () => b.tendedDay === G.game.day); assert.equal(b.produced?.meat || 0, 0); assert.equal(b.animalGrowth, 1);
  next(G); assert.equal(b.animals, cap); assert(b.animalGrowth < 1); assert.equal(G.game.res.meat, 0);
});
test('existing chicken hunger and sickness safeguards also block capacity slaughter', () => {
  for (const kind of ['hungry', 'sick']) {
    const f = fresh('chicken'), { G, b, c, cap } = f; ready(f); until(G, [c], () => c.state === 'work');
    if (kind === 'hungry') c.hunger = 1; else c.sickDays = 2;
    G.completeEconomyWork(c, c.task); assert.equal(b.animals, cap); assert.equal(b.animalGrowth, 1); assert.equal(b.produced?.meat || 0, 0); assert(!c.carry);
  }
});
test('existing old products and cargo remain exact; impossible capacity/progress saves stay rejected atomically', () => {
  const f = fresh(), { G, b, c, cap } = f; b.animalGrowth = .75; b.pastureProducts.meat = 16; b.pastureProducts.leather = 4; c.carry = { type: 'meat', qty: 20, pastureId: b.id };
  const old = save(G); G.applySaveData(old); const loaded = G.world.bmap[b.id];
  assert.equal(loaded.animals, cap); assert.equal(loaded.animalGrowth, .75); assert.equal(loaded.pastureProducts.meat, 16); assert.equal(G.world.cmap[c.id].carry.qty, 20);
  const world = G.world;
  for (const change of [d => d.buildings.find(x => x.id === b.id).animals = cap + 1, d => d.buildings.find(x => x.id === b.id).animalGrowth = 1.01]) {
    const bad = save(G); change(bad); assert.throws(() => G.applySaveData(bad)); assert.equal(G.world, world);
  }
});
console.log(`Pasture capacity birth: ${passed} passed`);
