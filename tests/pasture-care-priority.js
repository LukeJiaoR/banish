#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadGame } = require('./helpers/playability');
let passed = 0;
const save = G => JSON.parse(JSON.stringify(G.serializeGame()));
function test(name, fn) { fn(); passed++; console.log('ok ' + name); }
function fresh(area) {
  const G = loadGame(path.resolve(__dirname, '..')); G.newGame(5); const w = G.world;
  for (const k of ['water', 'rock', 'road']) w[k].fill(0);
  w.bgrid.fill(-1); w.treeIdx.fill(-1); w.trees = []; w.buildings = []; w.bmap = {};
  w.citizens = []; w.cmap = {}; w.families = []; w.marked.clear(); w.markedRocks.clear(); G.bumpNavigation(w);
  G.game.h = 12; G.rng = () => .5;
  G.addBuilding('storage', 2, 2, { instant: true, free: true });
  for (const k of G.RES_KEYS) G.game.res[k] = 0;
  G.game.res.tools = 100;
  const b = G.addBuilding('pasture', 10, 10, { instant: true, free: true, ...(area ? { pastureSize: area } : {}) }).b;
  assert(G.setPastureType(b, 'chicken')); const cap = G.pastureCapacity(b);
  G.game.livestock.chicken = cap; assert(G.stockPasture(b, cap)); assert(G.setPastureTarget(b, cap));
  const c = G.spawnCitizen({ x: 8, y: 10, age: 30, sex: 'm' }); c.job = b.id; b.workers = [c.id];
  const generate = G.genWorld;
  G.genWorld = (seed, options) => { const nw = generate(seed, options); nw.water.set(w.water); nw.rock.set(w.rock); return nw; };
  return { G, b, c, cap };
}
function until(G, cs, done, limit = 10000) {
  for (let i = 0; i < limit && !done(); i++) for (const c of cs) G.stepCitizen(c, .05);
  assert(done(), 'Expected actual pasture work/transport result missing');
}
function eggs(f, qty = 12) { f.b.pastureProducts.eggs += qty; f.G.recordProduction(f.b, 'eggs', qty); }
function start(f) { f.G.requestTask(f.c); return f.c.task; }
function atWork(f) { until(f.G, [f.c], () => f.c.state === 'work'); }

test('new daily eggs cannot preempt full care begun empty, but meat and eggs still require separate real hauls', () => {
  const f = fresh(), { G, b, c, cap } = f; b.animalGrowth = .5; b.tendedDay = 0;
  const t = start(f); assert.equal(t.phase, 'care'); assert.equal(t.work, 8); assert.equal(t.pastureStartedEmpty, true);
  G.completeEconomyWork(c, t); assert(!c.carry); atWork(f); G.stepCitizen(c, 1);
  G.closeTownLedgerDay(); G.game.day = 1; G.advanceTownEconomy();
  assert.equal(b.animalGrowth, 1); assert.equal(b.pastureProducts.eggs, 12);
  assert(t.workLeft > 6); G.completeEconomyWork(c, t); assert(!c.carry);
  until(G, [c], () => !!c.carry);
  assert.equal(c.carry.type, 'meat'); assert.equal(c.carry.qty, 6); assert.equal(G.game.res.meat, 0);
  assert.equal(b.animals, cap); assert.equal(b.animalGrowth, 0); assert.equal(b.pastureProducts.eggs, 12);
  until(G, [c], () => G.game.res.meat === 6);
  assert.equal(c.task.phase, 'pickup'); assert.equal(c.task.work, .1); assert.equal(c.task.pastureStartedEmpty, false);
  const tended = b.tendedDay;
  until(G, [c], () => G.game.res.eggs === 12);
  assert.equal(b.tendedDay, tended); assert.equal(b.produced.meat, 6); assert.equal(b.produced.eggs, 12);
  assert.equal(G.ensureTownLedger().current.flows.meat.received, 6);
  assert.equal(G.ensureTownLedger().current.flows.eggs.received, 12);
});
test('preexisting eggs get short pickup first and cannot consume a birth or renew care', () => {
  const f = fresh(), { G, b, c } = f; b.animalGrowth = 1; eggs(f, 24);
  const t = start(f); assert.equal(t.phase, 'pickup'); assert.equal(t.pastureStartedEmpty, false);
  until(G, [c], () => !!c.carry);
  assert.equal(c.carry.type, 'eggs'); assert.equal(c.carry.qty, 20); assert.equal(b.pastureProducts.eggs, 4);
  assert.equal(b.animalGrowth, 1); assert.equal(b.tendedDay, undefined); assert.equal(b.produced.meat || 0, 0);
});
test('unavailable storage is not an empty pen: old eggs still block after storage reopens mid-care', () => {
  const f = fresh(), { G, b, c } = f; b.animalGrowth = 1; eggs(f);
  G.game.res.food = G.game.res.grain = G.storageCap(); const t = start(f);
  assert.equal(t.phase, 'care'); assert.equal(t.pastureStartedEmpty, false); atWork(f);
  G.game.res.food = G.game.res.grain = 0;
  until(G, [c], () => !!c.carry); assert.equal(c.carry.type, 'eggs'); assert.equal(c.carry.qty, 12);
  assert.equal(b.animalGrowth, 1); assert.equal(b.produced.meat || 0, 0);
});
test('new eggs never bypass current meat/food goals, full storage, hunger or sickness', () => {
  for (const blocker of ['meat', 'food', 'storage', 'hunger', 'sickDays']) {
    const f = fresh(), { G, b, c } = f; b.animalGrowth = 1; const t = start(f); atWork(f); eggs(f);
    if (blocker === 'meat' || blocker === 'food') assert(G.setProductionGoal(blocker, 0));
    else if (blocker === 'storage') G.game.res.food = G.game.res.grain = G.storageCap();
    else c[blocker] = 1;
    until(G, [c], () => t.completed);
    assert.equal(b.animalGrowth, 1); assert.equal(b.produced.meat || 0, 0);
    assert.equal(b.pastureProducts.eggs + (c.carry?.type === 'eggs' ? c.carry.qty : 0), 12);
    if (blocker === 'hunger' || blocker === 'sickDays') assert.equal(b.tendedDay, undefined);
  }
});
test('egg-only goal does not block eligible meat and old eggs are retained', () => {
  const f = fresh(), { G, b, c } = f; b.animalGrowth = 1; start(f); atWork(f); eggs(f);
  assert(G.setProductionGoal('eggs', 0)); until(G, [c], () => !!c.carry);
  assert.equal(c.carry.type, 'meat'); assert.equal(b.pastureProducts.eggs, 12); assert.equal(b.produced.meat, 6);
});
test('current herd and target are rechecked; the start flag never reserves an animal', () => {
  for (const mode of ['lower', 'raise', 'fractional']) {
    const f = fresh(), { G, b, c, cap } = f;
    if (mode === 'raise') b.animalTarget = cap - 1;
    b.animalGrowth = mode === 'fractional' ? .999 : 0;
    const t = start(f); atWork(f); eggs(f);
    if (mode === 'lower') assert(G.setPastureTarget(b, cap - 1));
    if (mode === 'raise') assert(G.setPastureTarget(b, cap));
    until(G, [c], () => t.completed);
    assert.equal(b.produced.meat || 0, mode === 'lower' ? 6 : 0);
    assert.equal(b.animals, mode === 'lower' ? cap - 1 : cap);
  }
});
test('disease death before completion cannot become meat or consume replacement growth', () => {
  const f = fresh(), { G, b, c, cap } = f; b.animalGrowth = 1; const t = start(f); atWork(f); eggs(f);
  const q = G.pasturePestsToggleQuote(true); assert(G.setPasturePests(true, q.key));
  G.game.day = 14; G.game.pasturePests.lastDay = 13;
  b.pastureInfestation = { animalType: 'chicken', startedDay: 12, lost: 0 }; G.advancePasturePests();
  assert.equal(b.animals, cap - 1); until(G, [c], () => t.completed);
  assert.equal(b.animals, cap - 1); assert.equal(b.animalGrowth, 1); assert.equal(b.produced.meat || 0, 0);
});
test('two real area workers consume one pending birth once and preserve eggs', () => {
  const f = fresh([20, 20]), { G, b, c, cap } = f; b.animalGrowth = 1;
  const c2 = G.spawnCitizen({ x: 8, y: 11, age: 30, sex: 'm' }); c2.job = b.id; b.workers.push(c2.id);
  const t = start(f); G.requestTask(c2); const t2 = c2.task; eggs(f, 24);
  until(G, [c, c2], () => t.completed && t2.completed);
  assert.equal(b.animals, cap); assert.equal(b.animalGrowth, 0); assert.equal(b.produced.meat, 6);
  assert.equal([c, c2].reduce((n, worker) => n + (worker.carry?.type === 'meat' ? worker.carry.qty : 0), 0), 6);
  assert.equal(b.pastureProducts.eggs + [c, c2].reduce((n, worker) => n + (worker.carry?.type === 'eggs' ? worker.carry.qty : 0), 0), 24);
});
test('slaughter products appearing during care still block another slaughter', () => {
  const f = fresh(), { G, b, c } = f; b.animalGrowth = 1; start(f); atWork(f); eggs(f); b.pastureProducts.meat = 6;
  until(G, [c], () => !!c.carry); assert.equal(c.carry.type, 'meat'); assert.equal(c.carry.qty, 6);
  assert.equal(b.animalGrowth, 1); assert.equal(b.produced.meat || 0, 0); assert.equal(b.pastureProducts.eggs, 12);
});
test('legacy tasks lacking the new fact or care phase keep conservative egg-first behavior', () => {
  for (const missing of ['pastureStartedEmpty', 'phase']) {
    const f = fresh(), { G, b, c } = f; b.animalGrowth = 1; const t = start(f); delete t[missing]; atWork(f); eggs(f);
    until(G, [c], () => !!c.carry); assert.equal(c.carry.type, 'eggs'); assert.equal(b.animalGrowth, 1);
    assert.equal(b.produced.meat || 0, 0);
  }
});
test('reload during care loses task credit and selects old eggs without replay', () => {
  const f = fresh(), { G, b, c } = f; b.animalGrowth = 1; start(f); atWork(f); G.stepCitizen(c, 1); eggs(f);
  const snapshot = save(G); assert(!JSON.stringify(snapshot).includes('pastureStartedEmpty'));
  for (let i = 0; i < 3; i++) G.applySaveData(save(G));
  const pen = G.world.bmap[b.id], worker = G.world.cmap[c.id]; assert(!worker.task);
  assert.equal(pen.animalGrowth, 1); assert.equal(pen.pastureProducts.eggs, 12); assert.equal(pen.produced?.meat || 0, 0);
  worker.job = pen.id; pen.workers = [worker.id]; G.requestTask(worker); assert.equal(worker.task.phase, 'pickup');
  until(G, [worker], () => G.game.res.eggs === 12); assert.equal(pen.animalGrowth, 1); assert.equal(pen.produced?.meat || 0, 0);
});
test('partial meat delivery and repeated loads conserve new meat, old eggs and birth without duplication', () => {
  const f = fresh(), { G, b, c, cap } = f; b.animalGrowth = 1; const t = start(f); atWork(f); eggs(f);
  until(G, [c], () => !!c.carry); const cargo = c.carry; c.carry = null;
  G.completeEconomyWork(c, t); assert(!c.carry); assert.equal(b.produced.meat, 6); c.carry = cargo;
  G.game.res.food = G.game.res.grain = G.storageCap() - 2;
  until(G, [c], () => c.state === 'waitStorage'); assert.equal(G.game.res.meat, 2); assert.equal(c.carry.qty, 4);
  for (let i = 0; i < 3; i++) G.applySaveData(save(G));
  const pen = G.world.bmap[b.id], worker = G.world.cmap[c.id];
  assert.equal(pen.animals, cap); assert.equal(pen.animalGrowth, 0); assert.equal(pen.pastureProducts.eggs, 12); assert.equal(worker.carry.qty, 4);
  G.game.res.food -= 20; G.game.res.grain -= 20; G.startHaul(worker);
  until(G, [worker], () => G.game.res.meat === 6);
  worker.job = pen.id; pen.workers = [worker.id]; G.requestTask(worker);
  until(G, [worker], () => G.game.res.eggs === 12);
  assert.equal(G.ensureTownLedger().current.flows.meat.produced, 6); assert.equal(G.ensureTownLedger().current.flows.eggs.produced, 12);
});
test('cancelled, removed and remote tasks cannot use the empty-start exception', () => {
  for (const mode of ['release', 'remove', 'remote']) {
    const f = fresh(), { G, b, c } = f; b.animalGrowth = 1; const t = start(f); atWork(f); eggs(f);
    if (mode === 'release') G.releaseWorker(c);
    if (mode === 'remove') delete G.world.bmap[b.id];
    if (mode === 'remote') { c.x = 1; c.y = 1; }
    t.workLeft = 0; G.completeEconomyWork(c, t);
    assert(!c.carry); assert.equal(b.animalGrowth, 1); assert.equal(b.pastureProducts.eggs, 12); assert.equal(b.produced.meat || 0, 0);
  }
});
test('downstaffing permits only the already accepted care batch, leaving new eggs for a future worker', () => {
  const f = fresh(), { G, b, c } = f; b.animalGrowth = 1; start(f); atWork(f); eggs(f);
  assert(G.setWorkerLimit(b, 0)); until(G, [c], () => c.job == null && !c.carry);
  assert.equal(G.game.res.meat, 6); assert.equal(b.produced.meat, 6); assert.equal(b.pastureProducts.eggs, 12);
  assert.equal(G.game.res.eggs, 0); assert.equal(b.animalGrowth, 0);
});
test('night suspension preserves full remaining labor and the original empty-start fact', () => {
  const f = fresh(), { G, b, c } = f; b.animalGrowth = 1; const t = start(f); atWork(f); G.stepCitizen(c, 1); eggs(f);
  const remaining = t.workLeft; G.game.h = 23; G.stepCitizen(c, .01);
  assert.equal(c.pausedTask, t); assert.equal(t.workLeft, remaining); assert.equal(b.animalGrowth, 1); assert(!c.carry);
  G.game.h = 6; until(G, [c], () => !!c.carry);
  assert.equal(c.carry.type, 'meat'); assert.equal(b.produced.meat, 6); assert.equal(b.pastureProducts.eggs, 12);
});
test('a blocked endpoint reroutes before full care can consume the eligible birth', () => {
  const f = fresh(), { G, b, c } = f; b.animalGrowth = 1; const t = start(f); atWork(f); eggs(f);
  const remaining = t.workLeft; assert(G.addBuilding('house', 8, 10, { instant: true, free: true }).b);
  assert(!G.atPastureWork(c, t)); G.stepCitizen(c, .05);
  assert.equal(t.workLeft, remaining); assert.equal(b.animalGrowth, 1); assert(!c.carry);
  until(G, [c], () => !!c.carry); assert(G.atMedicalDoor(c, b));
  assert.equal(c.carry.type, 'meat'); assert.equal(b.produced.meat, 6); assert.equal(b.pastureProducts.eggs, 12);
});
test('a second worker clearing the old backlog cannot upgrade an already running care task', () => {
  const f = fresh([20, 20]), { G, b, c } = f; b.animalGrowth = 1; eggs(f);
  G.game.res.food = G.game.res.grain = G.storageCap(); const t = start(f); atWork(f);
  assert.equal(t.pastureStartedEmpty, false); G.game.res.food = G.game.res.grain = 0;
  const c2 = G.spawnCitizen({ x: 8, y: 11, age: 30, sex: 'm' }); c2.job = b.id; b.workers.push(c2.id);
  G.requestTask(c2); assert.equal(c2.task.phase, 'pickup');
  until(G, [c2], () => !!c2.carry); assert.equal(c2.carry.qty, 12); assert.equal(b.pastureProducts.eggs, 0);
  eggs(f); until(G, [c], () => t.completed);
  assert.equal(c.carry.type, 'eggs'); assert.equal(b.animalGrowth, 1); assert.equal(b.produced.meat || 0, 0);
  assert.equal(c.carry.qty + c2.carry.qty + b.pastureProducts.eggs, 24);
});
console.log(`Pasture care priority: ${passed} passed`);
