#!/usr/bin/env node
'use strict';
// Provisioned fixed-plot comparison: real seasons, work and hauling after setup.
// This is an agricultural productivity fixture, not a from-scratch survival test.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadGame } = require('./helpers/playability');
const args = process.argv.slice(2);
const arg = (key, fallback) => args.includes(key) ? args[args.indexOf(key) + 1] : fallback;
const root = path.resolve(arg('--root', path.join(__dirname, '..')));
const near = (a, b) => assert(Math.abs(a - b) < 1e-6, `${a} != ${b}`);

// Independent event observations: never derive loss as the remainder of the
// equation that the test then asserts. This also observes runs longer than the
// town ledger's 48-day display retention window.
function observeLedger(G, output, result) {
  const ledger = G.ledgerRecord;
  G.ledgerRecord = (metric, type, qty) => {
    if (type === output && Number.isFinite(qty) && qty > 0) {
      if (metric === 'discarded') result.discarded += qty;
      if (metric === 'received') result.ledgerReceived += qty;
    }
    return ledger(metric, type, qty);
  };
}

function fixture({ type, workers = 2, distance = 'near', young = false }) {
  const G = loadGame(root);
  G.newGame(5);
  const w = G.world;
  for (const key of ['water', 'rock', 'road']) w[key].fill(0);
  w.bgrid.fill(-1); w.treeIdx.fill(-1);
  w.trees = []; w.buildings = []; w.bmap = {}; w.citizens = []; w.cmap = {}; w.families = [];
  w.marked.clear(); w.markedRocks.clear(); G.bumpNavigation(w);
  for (const key of G.RES_KEYS) G.game.res[key] = 0;
  Object.assign(G.game.res, { grain: young ? 1600 : 300, food: young ? 1600 : 300, firewood: 1000, tools: 1000 });
  G.game.unlocks.apple = G.game.unlocks.pear = true;
  const x = distance === 'near' ? 8 : 26;
  G.addBuilding('storage', x, 8, { instant: true, free: true });
  // Extra capacity is deliberately far away; the nearer warehouse is selected
  // by the normal path planner. No storage, speed or work parameter is changed.
  for (let i = 0; i < 3; i++) G.addBuilding('storage', 70 + i * 5, 8, { instant: true, free: true });
  const home = G.addBuilding('house', 9, 14, { instant: true, free: true }).b;
  const b = G.addBuilding(type, 13, 8, {
    instant: true, free: true, ...(type === 'farm' ? { farmSize: [8, 8] } : {}),
  }).b;
  assert(b);
  G.setWorkerLimit(b, workers);
  if (type === 'orchard') {
    G.setOrchardType(b, 'apple');
    if (!young) {
      for (const tree of b.orchardTrees) Object.assign(tree, { type: 'apple', planted: true, age: G.ORCHARD.matureDays, tendedDay: G.game.day });
      G.syncOrchardTotals(b);
    }
  }
  const members = [];
  for (let i = 0; i < 2; i++) {
    const c = G.spawnCitizen({ x: 10, y: 13, age: 30, sex: 'm' });
    members.push(c);
  }
  const family = { id: G.nextId(), members: members.map(c => c.id), houseId: home.id, coupleIds: [] };
  w.families.push(family); home.family = family.id;
  for (const c of members) c.familyId = family.id;
  return { G, b };
}

function run(options) {
  const { G, b } = fixture(options), g = G.game;
  const output = options.type === 'farm' ? 'grain' : 'apples';
  const result = { ...options, sourceHash: G.testSourceHash, fruitPerTree: G.ORCHARD.fruit,
    produced: 0, received: 0, ledgerReceived: 0, discarded: 0, unpickedFruitLost: 0,
    workingHours: 0, staffedWalkOrHaulStateHours: 0, staffedHours: 0,
    trips: 0, firstFruitDay: null, deaths: [], years: [] };
  observeLedger(G, output, result);
  const record = G.recordProduction;
  G.recordProduction = (building, type, qty) => {
    if (building === b && type === output) result.produced += qty;
    return record(building, type, qty);
  };
  const deposit = G.deposit;
  G.deposit = (type, qty, ...rest) => {
    const accepted = deposit(type, qty, ...rest);
    if (type === output) { result.received += accepted; if (accepted > 0) result.trips++; }
    return accepted;
  };
  const kill = G.killCitizen;
  G.killCitizen = (c, reason) => { result.deaths.push({ day: g.day, reason }); return kill(c, reason); };
  const step = G.stepCitizen;
  G.stepCitizen = (c, dt) => {
    const task = c.task, work = task?.workLeft;
    if (c.job === b.id) {
      result.staffedHours += dt;
      // Sampled state while assigned to this plot, including commuting/home
      // walks. It is not exact movement time or a hauling-only measurement.
      if (c.state === 'walk' || c.state === 'haul') result.staffedWalkOrHaulStateHours += dt;
    }
    step(c, dt);
    if (task?.b === b && Number.isFinite(work)) result.workingHours += Math.max(0, work - Math.max(0, task.workLeft));
  };
  const advanceOrchard = G.advanceOrchard;
  G.advanceOrchard = building => {
    const before = building === b ? building.orchardTrees.map(t => t.fruit) : [];
    advanceOrchard(building);
    if (building === b) for (let i = 0; i < before.length; i++) {
      result.unpickedFruitLost += Math.max(0, before[i] - building.orchardTrees[i].fruit);
    }
  };
  const years = options.young ? 6 : 1, dt = .1;
  let lastYear = 0, lastReceived = 0, lastProduced = 0;
  for (let i = 0; i < years * G.YEAR_DAYS * G.DAY_H / dt && !g.over; i++) {
    G.advanceSim(dt);
    if (b.orchardYield > 0 && result.firstFruitDay === null) result.firstFruitDay = g.day;
    const year = Math.floor(g.day / G.YEAR_DAYS);
    if (year > lastYear) {
      result.years.push({ year, produced: result.produced - lastProduced, received: result.received - lastReceived });
      lastYear = year; lastReceived = result.received; lastProduced = result.produced;
    }
  }
  result.carried = G.world.citizens.reduce((n, c) => n + (c.carry?.type === output ? c.carry.qty : 0), 0);
  result.final = { day: g.day, population: G.world.citizens.length, stock: g.res[output], trees: b.orchardTrees?.length, cells: b.farm?.length };
  for (const key of ['produced', 'received', 'ledgerReceived', 'discarded', 'unpickedFruitLost',
    'workingHours', 'staffedWalkOrHaulStateHours', 'staffedHours']) result[key] = +result[key].toFixed(6);
  assert.equal(result.final.day, years * G.YEAR_DAYS);
  assert.equal(result.deaths.length, 0, 'Provisioned fixture should isolate production from starvation');
  near(result.produced, result.received + result.carried + result.discarded);
  near(result.received, result.ledgerReceived);
  if (options.type === 'orchard' && options.workers > 0) {
    near(result.received, 9 * G.ORCHARD.fruit * (options.young ? 2 : 1));
    near(result.unpickedFruitLost, 0);
    near(result.workingHours, options.young ? 994 : 54);
    assert.equal(result.trips, options.young ? 18 : 9);
    assert.equal(result.firstFruitDay, options.young ? 216 : 24);
  }
  if (options.type === 'orchard' && options.workers === 0) {
    near(result.produced, 0);
    near(result.received, 0);
    near(result.discarded, 0);
    near(result.unpickedFruitLost, 9 * G.ORCHARD.fruit);
  }
  console.log(JSON.stringify(result));
  return result;
}

const results = [];
// Positive control: the observer must see real discarded events and must not
// mistake a retained fruit remainder for a loss.
{
  const { G } = fixture({ type: 'orchard' });
  const observed = { discarded: 0, ledgerReceived: 0 };
  observeLedger(G, 'apples', observed);
  G.game.res.grain = G.game.res.food = G.storageCap() - 3;
  near(G.deposit('apples', 7), 3);
  near(observed.ledgerReceived, 3);
  near(observed.discarded, 4);
  near(G.deposit('apples', 5, true), 0);
  near(observed.discarded, 4);
}
for (const type of ['farm', 'orchard']) for (const workers of [1, 2]) for (const distance of ['near', 'far']) {
  results.push(run({ type, workers, distance }));
}
results.push(run({ type: 'orchard', workers: 2, distance: 'near', young: true }));
results.push(run({ type: 'orchard', workers: 0, distance: 'near' }));
const output = arg('--json', null);
if (output) fs.writeFileSync(output, JSON.stringify({ root, fixture: 'Provisioned fixed plots, two adult residents; ordinary simulation after setup', results }, null, 2) + '\n');
