#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadGame } = require('./helpers/playability');
let passed = 0;
const save = G => JSON.parse(JSON.stringify(G.serializeGame()));
function test(name, fn) { fn(); passed++; console.log('ok ' + name); }
function fresh(type = 'cattle', area) {
  const G = loadGame(path.resolve(__dirname, '..')); G.newGame(5); const w = G.world;
  for (const k of ['water', 'rock', 'road']) w[k].fill(0);
  w.bgrid.fill(-1); w.treeIdx.fill(-1); w.trees = []; w.buildings = []; w.bmap = {};
  w.citizens = []; w.cmap = {}; w.families = []; w.marked.clear(); w.markedRocks.clear(); G.bumpNavigation(w);
  G.game.h = 12; G.rng = () => .5;
  G.addBuilding('storage', 2, 2, { instant: true, free: true });
  for (const k of G.RES_KEYS) G.game.res[k] = 0;
  G.game.res.tools = 100;
  const b = G.addBuilding('pasture', 10, 10, { instant: true, free: true, ...(area ? { pastureSize: area } : {}) }).b;
  assert(G.setPastureType(b, type)); const cap = G.pastureCapacity(b);
  G.game.livestock[type] = cap; assert(G.stockPasture(b, cap)); assert(G.setPastureTarget(b, cap));
  const c = G.spawnCitizen({ x: 8, y: 10, age: 30, sex: 'm' }); c.job = b.id; b.workers = [c.id];
  const generate = G.genWorld;
  G.genWorld = (seed, options) => { const nw = generate(seed, options); nw.water.set(w.water); nw.rock.set(w.rock); return nw; };
  return { G, b, c, cap };
}
function until(G, cs, done, limit = 10000) {
  for (let i = 0; i < limit && !done(); i++) for (const c of cs) G.stepCitizen(c, .05);
  assert(done(), 'Expected actual work/transport result missing');
}
function queue(f, type, qty) { f.b.pastureProducts[type] = qty; f.G.recordProduction(f.b, type, qty); }
function start(f) { f.G.requestTask(f.c); return f.c.task; }
function atWork(f) { until(f.G, [f.c], () => f.c.state === 'work'); }

test('all species fetch existing goods with nonzero handling, real approach and one bounded load', () => {
  for (const [species, resource, qty] of [['cattle', 'meat', 36], ['cattle', 'leather', 4], ['sheep', 'meat', 24], ['chicken', 'eggs', 24], ['chicken', 'meat', 6]]) {
    const f = fresh(species), { G, b, c } = f; queue(f, resource, qty); b.animalGrowth = 1;
    const t = start(f); assert.equal(t.phase, 'pickup'); assert.equal(t.work, .1); assert.equal(t.pastureProduct, resource);
    G.completeEconomyWork(c, t); assert(!c.carry); assert.equal(b.pastureProducts[resource], qty);
    atWork(f); assert(t.workLeft > 0); G.completeEconomyWork(c, t); assert(!c.carry);
    G.stepCitizen(c, .05); assert(!c.carry); assert(t.workLeft > 0);
    until(G, [c], () => !!c.carry); assert.equal(c.carry.qty, Math.min(20, qty)); assert.equal(G.game.res[resource], 0);
    assert.equal(b.pastureProducts[resource], Math.max(0, qty - 20)); assert.equal(b.tendedDay, undefined);
    assert.equal(b.animalGrowth, 1); assert.equal(b.produced[resource], qty);
    until(G, [c], () => G.game.res[resource] === qty); assert.equal(b.pastureProducts[resource], 0);
  }
});
test('care, slaughter and shearing keep full eight-hour work, including education factor', () => {
  for (const type of ['cattle', 'sheep', 'chicken']) for (const educated of [false, true]) {
    const f = fresh(type), { G, b, c } = f; c.educated = educated; b.animalGrowth = 1;
    const t = start(f); assert.equal(t.phase, 'care'); assert.equal(t.work, G.taskWork(c, 8));
    atWork(f); G.stepCitizen(c, .1); assert(!c.carry); assert.equal(b.animalGrowth, 1);
    until(G, [c], () => !!c.carry); assert.equal(b.produced.meat, G.LIVESTOCK[type].meat); assert.equal(b.animalGrowth, 0);
  }
  const f = fresh('sheep'); f.b.woolReady = 8; const t = start(f); assert.equal(t.phase, 'care'); assert.equal(t.work, 8);
  until(f.G, [f.c], () => f.c.carry?.type === 'wool'); assert.equal(f.b.produced.wool, 8);
});
test('an empty or changed pickup never becomes free care, slaughter or another resource', () => {
  const f = fresh(), { G, b, c } = f; queue(f, 'meat', 16); b.animalGrowth = 1; const t = start(f); atWork(f);
  b.pastureProducts.meat = 0; b.pastureProducts.leather = 4;
  until(G, [c], () => c.task !== t); assert(!c.carry); assert.equal(b.tendedDay, undefined); assert.equal(b.animalGrowth, 1); assert.equal(b.pastureProducts.leather, 4);
  assert.equal(c.task.phase, 'pickup'); assert.equal(c.task.pastureProduct, 'leather');
});
test('a running care task is not shortened by newly laid eggs, and queued pickup does not renew care', () => {
  const f = fresh('chicken'), { G, b, c } = f; const t = start(f); atWork(f); G.stepCitizen(c, 1);
  const remaining = t.workLeft; queue(f, 'eggs', 24); G.stepCitizen(c, .1);
  assert.equal(c.task, t); assert(t.workLeft > 6); assert(t.workLeft < remaining); assert(!c.carry);
  until(G, [c], () => !!c.carry); assert.equal(b.tendedDay, 0); assert.equal(c.carry.qty, 20);
  G.game.day = 1; until(G, [c], () => G.game.res.eggs === 24); assert.equal(b.tendedDay, 0);
});
test('pickup preserves partial progress across normal night suspension', () => {
  const f = fresh('chicken'), { G, c } = f; queue(f, 'eggs', 12); const t = start(f); atWork(f); G.stepCitizen(c, .05);
  const remaining = t.workLeft; G.game.h = 23; G.stepCitizen(c, .01); assert.equal(c.pausedTask, t); assert.equal(t.workLeft, remaining); assert(!c.carry);
  G.game.h = 6; until(G, [c], () => !!c.carry); assert.equal(c.carry.qty, 12); assert.equal(f.b.tendedDay, undefined);
});
test('downstaffing a running pickup settles one load then releases, without care or new slaughter', () => {
  const f = fresh(), { G, b, c } = f; queue(f, 'meat', 36); b.animalGrowth = 1; start(f); atWork(f);
  assert(G.setWorkerLimit(b, 0)); until(G, [c], () => c.job == null && !c.carry);
  assert.equal(G.game.res.meat, 20); assert.equal(b.pastureProducts.meat, 16); assert.equal(b.animalGrowth, 1); assert.equal(b.tendedDay, undefined);
});
test('two workers compete atomically and a completed pickup cannot replay', () => {
  const f = fresh('chicken', [20, 20]), { G, b, c } = f; queue(f, 'eggs', 12); b.animalGrowth = 1;
  const c2 = G.spawnCitizen({ x: 8, y: 11, age: 30, sex: 'm' }); c2.job = b.id; b.workers.push(c2.id);
  const first = start(f); G.requestTask(c2); const second = c2.task;
  until(G, [c, c2], () => first.completed && second.completed);
  assert.equal([c, c2].reduce((n, v) => n + (v.carry?.qty || 0), 0), 12); assert.equal(b.pastureProducts.eggs, 0); assert.equal(b.animalGrowth, 1); assert.equal(b.tendedDay, undefined);
  const holder = c.carry ? c : c2, task = c.carry ? first : second; const original = holder.carry; holder.carry = null;
  b.pastureProducts.eggs = 7; G.completeEconomyWork(holder, task); assert(!holder.carry); assert.equal(b.pastureProducts.eggs, 7); holder.carry = original;
});
test('goals pause new production but never strand existing goods', () => {
  const f = fresh('chicken'), { G, b, c } = f; queue(f, 'eggs', 12); b.animalGrowth = 1;
  assert(G.setProductionGoal('eggs', 0)); assert(G.setProductionGoal('meat', 0)); start(f);
  until(G, [c], () => G.game.res.eggs === 12); assert.equal(b.animalGrowth, 1); assert.equal(b.produced.meat || 0, 0);
});
test('full storage at dispatch or arrival never consumes products or loses partial cargo', () => {
  const f = fresh('chicken'), { G, b, c } = f; queue(f, 'eggs', 24); G.game.res.food = G.game.res.grain = G.storageCap();
  assert.equal(G.makeTask(b, c).phase, 'care'); G.game.res.food = G.game.res.grain = 0;
  const t = start(f); atWork(f); G.game.res.food = G.game.res.grain = G.storageCap(); until(G, [c], () => t.completed);
  assert(!c.carry); assert.equal(b.pastureProducts.eggs, 24); assert.equal(b.tendedDay, undefined);
  G.game.res.food -= 7; G.game.res.grain -= 7; c.task = null; c.state = 'idle'; start(f);
  until(G, [c], () => c.state === 'waitStorage'); assert.equal(G.game.res.eggs, 7); assert.equal(c.carry.qty, 13); assert.equal(b.pastureProducts.eggs, 4);
  G.applySaveData(save(G)); const loaded = G.world.cmap[c.id]; assert.equal(loaded.carry.qty, 13);
  G.game.res.food -= 30; G.game.res.grain -= 30; loaded.job = b.id; G.world.bmap[b.id].workers = [loaded.id]; G.startHaul(loaded);
  until(G, [loaded], () => G.game.res.eggs === 24); assert.equal(G.world.bmap[b.id].pastureProducts.eggs, 0);
});
test('cancelled, removed and remotely completed pickup tasks cannot touch stored goods', () => {
  for (const mode of ['release', 'remove', 'remote']) {
    const f = fresh('chicken'), { G, b, c } = f; queue(f, 'eggs', 12); const t = start(f); atWork(f);
    if (mode === 'release') G.releaseWorker(c);
    if (mode === 'remove') { assert.equal(G.removeBuilding(b), false); delete G.world.bmap[b.id]; }
    if (mode === 'remote') { c.x = 1; c.y = 1; }
    t.workLeft = 0; G.completeEconomyWork(c, t); assert(!c.carry); assert.equal(b.pastureProducts.eggs, 12); assert.equal(b.tendedDay, undefined);
  }
});
test('blocked final approach keeps pickup work and goods until physical arrival', () => {
  const f = fresh(), { G, b, c } = f; queue(f, 'meat', 16); const t = start(f); atWork(f); const remaining = t.workLeft;
  assert(G.addBuilding('house', 8, 10, { instant: true, free: true }).b); assert(!G.atPastureWork(c, t));
  G.stepCitizen(c, .05); assert.equal(t.workLeft, remaining); assert.equal(b.pastureProducts.meat, 16);
  until(G, [c], () => !!c.carry); assert(G.atMedicalDoor(c, b)); assert.equal(c.carry.qty, 16);
});
test('repeated saves preserve goods, cargo and pending birth without replay or free care', () => {
  const f = fresh(), { G, b, c } = f; queue(f, 'meat', 36); b.pastureProducts.leather = 4; b.animalGrowth = 1; G.closeTownLedgerDay(); G.game.day = 1; b.tendedDay = 0;
  start(f); atWork(f); G.stepCitizen(c, .05);
  for (let i = 0; i < 3; i++) G.applySaveData(save(G));
  let pen = G.world.bmap[b.id], worker = G.world.cmap[c.id]; assert.equal(pen.pastureProducts.meat, 36); assert.equal(pen.animalGrowth, 1); assert.equal(pen.tendedDay, 0); assert(!worker.task); assert(!worker.carry);
  worker.job = pen.id; pen.workers = [worker.id]; G.requestTask(worker); until(G, [worker], () => !!worker.carry);
  for (let i = 0; i < 3; i++) G.applySaveData(save(G));
  pen = G.world.bmap[b.id]; worker = G.world.cmap[c.id]; assert.equal(pen.pastureProducts.meat, 16); assert.equal(worker.carry.qty, 20); assert.equal(pen.pastureProducts.leather, 4); assert.equal(pen.animalGrowth, 1); assert.equal(pen.tendedDay, 0);
});
test('hungry or sick chicken worker may carry old eggs without renewed care', () => {
  for (const mode of ['hunger', 'sickDays']) {
    const f = fresh('chicken'), { G, b, c } = f; queue(f, 'eggs', 12); start(f); atWork(f); c[mode] = 1;
    until(G, [c], () => !!c.carry); assert.equal(c.carry.qty, 12); assert.equal(b.tendedDay, undefined); assert.equal(b.animalGrowth, 0);
  }
});
test('phase-less accepted legacy work retains full care behavior', () => {
  const f = fresh(), { G, b, c } = f; b.animalGrowth = 1; const t = start(f); delete t.phase; delete t.pastureProduct;
  until(G, [c], () => !!c.carry); assert.equal(b.animalGrowth, 0); assert.equal(b.tendedDay, 0); assert.equal(b.produced.meat, 36); assert.equal(c.carry.qty, 20);
});
console.log(`Pasture work phases: ${passed} passed`);
