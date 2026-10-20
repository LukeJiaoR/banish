#!/usr/bin/env node
'use strict';
// Provisioned fixed-pen productivity experiment. All work, daily production,
// care, births, slaughter and hauling after setup use the unmodified simulation.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadGame } = require('./helpers/playability');
const args = process.argv.slice(2);
const arg = (key, fallback) => args.includes(key) ? args[args.indexOf(key) + 1] : fallback;
const root = path.resolve(arg('--root', path.join(__dirname, '..')));
const initialFood = Number(arg('--initial-food', '1600'));
const stores = Number(arg('--stores', '4'));
assert(Number.isInteger(stores) && stores >= 4 && stores <= 10);
assert(Number.isFinite(initialFood) && initialFood >= 300);
const outputs = ['meat', 'leather', 'wool', 'eggs'];
const basket = () => Object.fromEntries(outputs.map(k => [k, 0]));
const near = (a, b, message) => assert(Math.abs(a - b) < 1e-6, `${message}: ${a} != ${b}`);
function fixture(options) {
  const G = loadGame(root); G.newGame(options.seed);
  const w = G.world;
  for (const key of ['water', 'rock', 'road']) w[key].fill(0);
  w.bgrid.fill(-1); w.treeIdx.fill(-1);
  w.trees = []; w.buildings = []; w.bmap = {}; w.citizens = []; w.cmap = {}; w.families = [];
  w.marked.clear(); w.markedRocks.clear(); G.bumpNavigation(w);
  for (const key of G.RES_KEYS) G.game.res[key] = 0;
  Object.assign(G.game.res, { grain: initialFood, food: initialFood, firewood: 1000, tools: 1000 });
  // Match the orchard experiment's home, plot and near/far store. Optional
  // additional real distant stores isolate transport from capacity saturation.
  G.addBuilding('storage', options.distance === 'near' ? 8 : 26, 8, { instant: true, free: true });
  for (let i = 0; i < stores - 1; i++) G.addBuilding('storage', 70 + i * 5, 8, { instant: true, free: true });
  const home = G.addBuilding('house', 9, 14, { instant: true, free: true }).b;
  const b = G.addBuilding('pasture', 13, 8, { instant: true, free: true }).b;
  assert(b); assert(G.setPastureType(b, options.species));
  G.game.livestock[options.species] = options.initialAnimals;
  assert(G.stockPasture(b, options.initialAnimals));
  assert(G.setPastureTarget(b, options.target));
  assert(G.setWorkerLimit(b, options.workers));
  const members = [];
  for (let i = 0; i < 2; i++) members.push(G.spawnCitizen({ x: 10, y: 13, age: 30, sex: 'm' }));
  const family = { id: G.nextId(), members: members.map(c => c.id), houseId: home.id, coupleIds: [] };
  w.families.push(family); home.family = family.id;
  for (const c of members) c.familyId = family.id;
  return { G, b };
}
function run(options) {
  const { G, b } = fixture(options), g = G.game;
  const result = { ...options, initialFood, stores, sourceHash: G.testSourceHash,
    constants: { eatPerYear: G.LIFE.eatPerYear, yearDays: G.YEAR_DAYS,
      cap: G.pastureCapacity(b), meatPerAnimal: G.LIVESTOCK[options.species].meat },
    produced: basket(), received: basket(), ledgerReceived: basket(), discarded: basket(), trips: basket(),
    durationYears: options.years, careCompletions: 0, caredDays: 0, births: 0, overflowBirths: 0, slaughters: 0, workingHours: 0,
    staffedHours: 0, staffedWalkOrHaulStateHours: 0, firstMeatDay: null,
    deaths: [], years: [] };
  const record = G.recordProduction;
  G.recordProduction = (building, type, qty) => {
    if (building === b && outputs.includes(type)) {
      result.produced[type] += qty;
      if (type === 'meat' && result.firstMeatDay === null) result.firstMeatDay = g.day;
    }
    return record(building, type, qty);
  };
  const deposit = G.deposit;
  G.deposit = (type, qty, ...rest) => {
    const accepted = deposit(type, qty, ...rest);
    if (outputs.includes(type)) { result.received[type] += accepted; if (accepted > 0) result.trips[type]++; }
    return accepted;
  };
  const ledger = G.ledgerRecord;
  G.ledgerRecord = (metric, type, qty) => {
    if (outputs.includes(type) && qty > 0) {
      if (metric === 'discarded') result.discarded[type] += qty;
      if (metric === 'received') result.ledgerReceived[type] += qty;
    }
    return ledger(metric, type, qty);
  };
  const economy = G.advanceTownEconomy;
  G.advanceTownEconomy = () => {
    const animals = b.animals;
    if (b.tendedDay >= g.day - 2) result.caredDays++;
    economy(); result.births += Math.max(0, b.animals - animals);
  };
  const complete = G.completeEconomyWork;
  G.completeEconomyWork = (c, task) => {
    const animals = b.animals, growth = b.animalGrowth, meat = result.produced.meat;
    const atWork = task.b === b && G.atPastureWork(c, task);
    complete(c, task);
    if (atWork && b.tendedDay === g.day) result.careCompletions++;
    const slaughters = (result.produced.meat - meat) / G.LIVESTOCK[options.species].meat;
    result.slaughters += slaughters;
    if (slaughters && b.animals === animals && growth - b.animalGrowth >= 1) result.overflowBirths += slaughters;
  };
  const step = G.stepCitizen;
  G.stepCitizen = (c, dt) => {
    const task = c.task, work = task?.workLeft;
    if (c.job === b.id) {
      result.staffedHours += dt;
      if (c.state === 'walk' || c.state === 'haul') result.staffedWalkOrHaulStateHours += dt;
    }
    step(c, dt);
    if (task?.b === b && Number.isFinite(work)) result.workingHours += Math.max(0, work - Math.max(0, task.workLeft));
  };
  const kill = G.killCitizen;
  G.killCitizen = (c, reason) => { result.deaths.push({ day: g.day, reason }); return kill(c, reason); };
  let year = 0, previousProduced = basket(), previousReceived = basket();
  const dt = .1;
  for (let i = 0; i < options.years * G.YEAR_DAYS * G.DAY_H / dt && !g.over; i++) {
    G.advanceSim(dt);
    const next = Math.floor(g.day / G.YEAR_DAYS);
    if (next > year) {
      result.years.push({ year: next, animals: b.animals,
        produced: Object.fromEntries(outputs.map(k => [k, result.produced[k] - previousProduced[k]])),
        received: Object.fromEntries(outputs.map(k => [k, result.received[k] - previousReceived[k]])) });
      year = next; previousProduced = { ...result.produced }; previousReceived = { ...result.received };
    }
  }
  result.carried = Object.fromEntries(outputs.map(k => [k, G.world.citizens.reduce((n, c) => n + (c.carry?.type === k ? c.carry.qty : 0), 0)]));
  result.pending = Object.fromEntries(outputs.map(k => [k, b.pastureProducts?.[k] || 0]));
  result.final = { day: g.day, population: G.world.citizens.length, animals: b.animals,
    growth: b.animalGrowth, unshornWool: b.woolReady, stock: Object.fromEntries(G.RES_KEYS.map(k => [k, g.res[k]])) };
  for (const key of ['workingHours', 'staffedHours', 'staffedWalkOrHaulStateHours']) result[key] = +result[key].toFixed(6);
  assert.equal(result.final.day, options.years * G.YEAR_DAYS);
  assert.equal(result.deaths.length, 0, 'Provisioned fixture should isolate productivity');
  assert.equal(options.initialAnimals + result.births + result.overflowBirths - result.slaughters, b.animals, 'Herd balance');
  for (const k of outputs) {
    near(result.produced[k], result.received[k] + result.carried[k] + result.pending[k] + result.discarded[k], 'Product conservation '+k);
    near(result.received[k], result.ledgerReceived[k], 'Receipt events '+k);
  }
  if (!options.workers) {
    assert.equal(result.births, 0); assert.equal(result.slaughters, 0);
    for (const k of outputs) near(result.produced[k], 0, 'Unattended production');
  }
  console.log(JSON.stringify(result)); return result;
}
const results = [];
const suite = arg('--suite', 'all');
for (const species of ['sheep', 'cattle', 'chicken']) {
  if (['all', 'mature'].includes(suite)) for (const seed of [5, 49]) for (const distance of ['near', 'far'])
    results.push(run({ species, seed, distance, initialAnimals: 8, target: 8, workers: 1, years: 1 }));
  if (['all', 'capacity'].includes(suite)) for (const distance of ['near', 'far']) {
    const cap = fixture({ species, seed: 5, distance, initialAnimals: 2, target: 2, workers: 1 }).G.LIVESTOCK[species].cap;
    results.push(run({ species, seed: 5, distance, initialAnimals: cap, target: cap, workers: 1, years: 1 }));
  }
  if (['all', 'pair'].includes(suite)) for (const distance of ['near', 'far'])
    results.push(run({ species, seed: 5, distance, initialAnimals: 2, target: 8, workers: 1, years: 6 }));
  if (['all', 'zero'].includes(suite)) results.push(run({ species, seed: 5, distance: 'near', initialAnimals: 8, target: 8, workers: 0, years: 1 }));
}
const output = arg('--json', null);
if (output) fs.writeFileSync(output, JSON.stringify({ fixture: 'Provisioned fixed6x6 pens with two adult residents, no animal feed cost; ordinary simulation after setup. Not a survival or purchase-payback test.', results }, null, 2) + '\n');
