'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadGame } = require('./helpers/playability');
const root = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const baseline = args.includes('--baseline') ? path.resolve(args[args.indexOf('--baseline') + 1]) : null;
const clone = x => JSON.parse(JSON.stringify(x));
const save = G => clone(G.serializeGame());
const near = (a, b) => assert(Math.abs(a - b) < 1e-7, `${a} != ${b}`);
let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log('ok ' + name); };

function fixture(source = root) {
  const G = loadGame(source); G.newGame(5);
  const w = G.world;
  for (const k of ['water', 'rock', 'road']) w[k].fill(0);
  w.bgrid.fill(-1); w.treeIdx.fill(-1);
  w.trees = []; w.buildings = []; w.bmap = {}; w.citizens = []; w.cmap = {}; w.families = [];
  w.marked.clear(); w.markedRocks.clear(); G.bumpNavigation(w);
  for (const k of G.RES_KEYS) G.game.res[k] = 0;
  G.game.res.tools = 100;
  G.game.unlocks.orchard = G.game.unlocks.apple = G.game.unlocks.pear = true;
  G.addBuilding('storage', 2, 2, { instant: true, free: true });
  const b = G.addBuilding('orchard', 10, 10, { instant: true, free: true }).b;
  const c = G.spawnCitizen({ x: 9, y: 10, age: 30, sex: 'm' });
  G.game.h = 12; G.rng = () => .5;
  const generate = G.genWorld;
  G.genWorld = (seed, options) => {
    const next = generate(seed, options); next.water.set(w.water); next.rock.set(w.rock); return next;
  };
  return { G, b, c };
}
function atDay(G, day) {
  Object.assign(G.game, { day, year: Math.floor(day / G.YEAR_DAYS) + 1,
    season: Math.floor(day / G.SEASON_DAYS) % 4, h: 12 });
  G.game.townLedger = G.newTownLedger(G.game);
  G.game.industryLedger = G.newIndustryLedger(G.game);
}
function mature(G, b, type = 'apple') {
  for (const t of b.orchardTrees) Object.assign(t, {
    type, planted: true, age: G.ORCHARD.matureDays, fruit: 0, season: 0, tendedDay: G.game.day,
  });
  G.syncOrchardTotals(b);
}
function until(G, c, done) {
  for (let i = 0; i < 10000 && !done(); i++) G.stepCitizen(c, .1);
  assert(done(), 'physical fruit transport did not complete');
}

test('fixed 6x6 nine-tree yield is 450, with unchanged maturity, work and farm parameters', () => {
  const { G, b } = fixture();
  assert.equal(G.ORCHARD.fruit, 50); assert.equal(G.LEGACY_ORCHARD_FRUIT, 20);
  assert.equal(G.ORCHARD.matureDays, 4 * G.YEAR_DAYS);
  assert.equal(G.ORCHARD.harvestHours, 6);
  assert.deepEqual([b.w, b.h, G.orchardTreeCount(b), G.workerMaximumOf(b)], [6, 6, 9, 2]);
  if (baseline) {
    const old = fixture(baseline).G;
    assert.equal(old.ORCHARD.fruit, 20);
    for (const k of ['matureDays', 'plantHours', 'tendHours', 'harvestHours']) assert.equal(G.ORCHARD[k], old.ORCHARD[k]);
    for (const k of ['LIFE', 'PROD', 'CROPS', 'LIVESTOCK', 'CHICKEN']) assert.deepEqual(clone(G[k]), clone(old[k]), k);
  }
});

test('all three tree identities get one future batch; no same-season top-up after harvest or reload', () => {
  for (const type of ['legacy', 'apple', 'pear']) {
    const { G, b } = fixture(); mature(G, b, type); atDay(G, 24); b.orchardDay = 23;
    G.advanceOrchard(b); assert.equal(b.orchardYield, 450);
    b.orchardTrees[0].fruit = 0; b.orchardTrees[1].fruit = 13; G.syncOrchardTotals(b);
    const snapshot = save(G);
    for (let i = 0; i < 3; i++) {
      G.applySaveData(snapshot); G.advanceOrchard(G.world.bmap[b.id]);
      assert.equal(G.world.bmap[b.id].orchardYield, 363);
    }
    atDay(G, 25); G.advanceOrchard(G.world.bmap[b.id]); assert.equal(G.world.bmap[b.id].orchardYield, 363);
    atDay(G, 36); G.advanceOrchard(G.world.bmap[b.id]); assert.equal(G.world.bmap[b.id].orchardYield, 0);
    atDay(G, 72); G.advanceOrchard(G.world.bmap[b.id]); assert.equal(G.world.bmap[b.id].orchardYield, 450);
  }
});

test('old aggregate 137 keeps six 20-fruit trips and one 17, with no inflation in either migration path', () => {
  const { G, b, c } = fixture(); atDay(G, 24); mature(G, b, 'legacy');
  c.carry = { type: 'vegetables', qty: 7, orchardId: b.id };
  const snapshot = save(G), row = snapshot.buildings.find(x => x.id === b.id);
  for (const k of ['orchardTrees', 'orchardDay', 'orchardReplant', 'orchardWarnYear', 'orchardType']) delete row[k];
  Object.assign(row, { orchardAge: 192, orchardYield: 137, orchardSeason: 1, tendedDay: 23 });
  G.applySaveData(snapshot);
  const expected = [20, 20, 20, 20, 20, 20, 17, 0, 0];
  for (let i = 0; i < 3; i++) {
    const loaded = G.world.bmap[b.id];
    assert.deepEqual(clone(loaded.orchardTrees.map(t => t.fruit)), expected);
    assert.equal(G.orchardSummary(loaded).nextDeath, 8 * G.YEAR_DAYS);
    assert.deepEqual(clone(G.world.cmap[c.id].carry), { type: 'vegetables', qty: 7, orchardId: b.id });
    G.applySaveData(save(G));
  }
  const direct = { ...b, orchardTrees: undefined, orchardYield: 137, orchardAge: 192, orchardSeason: 1, tendedDay: 23 };
  G.ensureOrchard(direct);
  assert.deepEqual(clone(direct.orchardTrees.map(t => t.fruit)), expected);
  const world = G.world, game = G.game;
  for (const invalid of [180.01, 181, 450]) {
    const bad = clone(snapshot); bad.buildings.find(x => x.id === b.id).orchardYield = invalid;
    assert.throws(() => G.applySaveData(bad)); assert.equal(G.world, world); assert.equal(G.game, game);
  }
});

test('valid 50-fruit saves and cargo survive while above-cap records still reject atomically', () => {
  const { G, b, c } = fixture(); atDay(G, 24); mature(G, b); b.orchardDay = 23; G.advanceOrchard(b);
  c.carry = { type: 'apples', qty: 50, orchardId: b.id };
  const valid = save(G); G.applySaveData(valid);
  const world = G.world, game = G.game;
  for (const corrupt of [
    d => { const row = d.buildings.find(x => x.id === b.id); row.orchardTrees[0].fruit = 51; row.orchardYield = 451; },
    d => { d.citizens[0].carry.qty = 51; },
  ]) {
    const bad = clone(valid); corrupt(bad); assert.throws(() => G.applySaveData(bad));
    assert.equal(G.world, world); assert.equal(G.game, game);
  }
});

test('50 actual picked fruit retains 43 after partial delivery, demolition and repeated loads', () => {
  const { G, b, c } = fixture(); atDay(G, 24); mature(G, b); b.orchardDay = 23; G.advanceOrchard(b);
  G.assignWorker(b, c); until(G, c, () => !!c.carry); assert.equal(c.carry.qty, 50);
  G.setWorkerLimit(b, 0); G.game.res.grain = G.game.res.food = G.storageCap() - 7;
  until(G, c, () => c.state === 'waitStorage'); near(c.carry.qty, 43);
  G.removeBuilding(b);
  for (let i = 0; i < 3; i++) {
    G.applySaveData(save(G)); near(G.world.cmap[c.id].carry.qty, 43);
    assert.equal(G.world.cmap[c.id].carry.orchardId, b.id);
  }
  G.game.res.grain -= 43; G.game.res.food -= 43; G.reconcileFood();
  until(G, G.world.cmap[c.id], () => !G.world.cmap[c.id].carry);
  near(G.game.res.apples, 50);
  const totals = G.townLedgerSummary().current.totals.apples;
  near(totals.produced, 50); near(totals.received, 50); near(totals.discarded, 0);
});

test('education changes harvest work time without multiplying the 50-fruit batch', () => {
  const hours = [];
  for (const educated of [false, true]) {
    const { G, b, c } = fixture(); atDay(G, 24); mature(G, b); b.orchardDay = 23; G.advanceOrchard(b);
    c.educated = educated; G.assignWorker(b, c); hours.push(c.task.work);
    until(G, c, () => !!c.carry); assert.equal(c.carry.qty, 50);
  }
  assert(hours[1] < hours[0]);
});

if (baseline) test('actual main serializer preserves already-set 20-fruit trees and in-flight cargo exactly', () => {
  const old = fixture(baseline); atDay(old.G, 24); mature(old.G, old.b); old.b.orchardDay = 23;
  old.G.advanceOrchard(old.b); assert.equal(old.b.orchardYield, 180);
  old.G.assignWorker(old.b, old.c); until(old.G, old.c, () => !!old.c.carry);
  const snapshot = save(old.G), row = snapshot.buildings.find(x => x.id === old.b.id);
  const { G } = fixture();
  for (let i = 0; i < 3; i++) {
    G.applySaveData(i ? save(G) : snapshot);
    assert.deepEqual(clone(G.world.bmap[old.b.id].orchardTrees), row.orchardTrees);
    assert.deepEqual(clone(G.world.cmap[old.c.id].carry), clone(old.c.carry));
    assert.deepEqual(clone(G.game.res), snapshot.game.res);
  }
  atDay(G, 25); G.advanceOrchard(G.world.bmap[old.b.id]);
  assert.equal(G.world.bmap[old.b.id].orchardYield, 160);
  G.setWorkerLimit(G.world.bmap[old.b.id], 0);
  until(G, G.world.cmap[old.c.id], () => !G.world.cmap[old.c.id].carry);
  near(G.game.res.apples, 20);
});

console.log(`Orchard yield balance: ${passed} contract groups passed${baseline ? ' (including actual baseline save)' : ''}`);
