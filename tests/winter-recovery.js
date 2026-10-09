#!/usr/bin/env node
'use strict';
// A seed-41 causal experiment, not a universal player policy or a balance change.
// Reuse the frozen long_economy policy verbatim. Only ordinary player actions differ.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { createRequire } = require('node:module');
const { loadGame } = require('./helpers/playability');
const args = process.argv.slice(2);
const arg = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const root = path.resolve(arg('--root', path.join(__dirname, '..')));
const years = Number(arg('--years', 30));
const scenarios = arg('--scenarios', 'baseline,early-warehouse,warehouse-without-pause,wrong-food-demolition').split(',');
const allowed = ['baseline', 'early-warehouse', 'warehouse-without-pause', 'wrong-food-demolition'];
if (!Number.isInteger(years) || years < 1 || years > 40 || scenarios.some(s => !allowed.includes(s))) throw Error('Invalid years or scenarios');
const policyPath = path.join(__dirname, 'long_economy.js');
const policySource = fs.readFileSync(policyPath, 'utf8');
const boundary = '\nconst results = seeds.map(run);';
if (policySource.split(boundary).length !== 2) throw Error('Frozen policy entry point changed; review this probe before updating it');
const policyContext = { require: createRequire(policyPath), __dirname, __filename: policyPath, console, process: { argv: ['node', policyPath] }, module: { exports: {} } };
vm.runInNewContext(policySource.split(boundary)[0] + '\nmodule.exports = { longStrategy, strategyHash };', policyContext, { filename: policyPath });
const { longStrategy, strategyHash } = policyContext.module.exports;

function run(scenario) {
  const G = loadGame(root); G.newGame(41);
  const w = G.world, g = G.game, strategy = longStrategy(G), initial = new Set(w.citizens.map(c => c.id));
  const births = [], deaths = [], actions = [], annual = [], completed = [];
  const shortages = { hungryCitizenDays: 0, toolDays: 0, unheatedHomeDays: 0 };
  const minima = { food: Infinity, firewood: Infinity, wood: Infinity, tools: Infinity };
  const snapshot = () => ({ day: g.day, hour: g.h, population: w.citizens.length, adults: w.citizens.filter(c => c.adult).length,
    resources: Object.fromEntries(G.RES_KEYS.map(k => [k, +g.res[k].toFixed(3)])), foodCapacity: G.storageCap(),
    foodDays: +(g.res.food / Math.max(1, w.citizens.length * G.LIFE.eatPerDay)).toFixed(3),
    completedHomes: w.buildings.filter(b => b.type === 'house' && b.state === 'ok').length,
    emptyHomes: w.buildings.filter(b => b.type === 'house' && b.state === 'ok' && b.family == null).length,
    homelessFamilies: w.families.filter(f => f.members.length && f.houseId == null).length });
  const spawn = G.spawnCitizen;
  G.spawnCitizen = opt => { const c = spawn(opt); births.push({ day: g.day, id: c.id, parentIds: c.parentIds.slice(), secondGeneration: c.parentIds.some(id => !initial.has(id)) }); return c; };
  const kill = G.killCitizen;
  G.killCitizen = (c, reason) => { deaths.push({ day: g.day, id: c.id, age: +c.age.toFixed(3), reason, food: +g.res.food.toFixed(3), firewood: +g.res.firewood.toFixed(3), homeId: G.homeOf(c)?.id || null }); return kill(c, reason); };
  const finish = G.finishBuilding;
  G.finishBuilding = b => { completed.push({ day: g.day, type: b.type, id: b.id, x: b.x, y: b.y }); return finish(b); };
  function placeWarehouse() {
    const type = 'storage', d = G.BDEF[type], s = w.start;
    if (!Object.entries(d.cost).every(([k, qty]) => g.res[k] >= qty)) return false;
    const origin = G.nearestWalkable(w, s.x, s.y, 8), choices = [];
    for (let y = s.y - 13; y < s.y + 13; y++) for (let x = s.x - 13; x < s.x + 13; x++) {
      if (!G.canPlace(w, type, x, y).ok) continue;
      let trees = 0;
      for (let yy = y; yy < y + d.h; yy++) for (let xx = x; xx < x + d.w; xx++) if (w.treeIdx[yy * w.N + xx] >= 0) trees++;
      choices.push({ x, y, score: G.dist(x, y, s.x, s.y) + trees * 5 });
    }
    choices.sort((a, b) => a.score - b.score || a.y - b.y || a.x - b.x);
    for (const p of choices) {
      const entry = G.nearestWalkable(w, p.x - 1, p.y - 1, 3);
      if (!origin || !entry || !G.findPath(w, origin.x, origin.y, entry.x, entry.y)) continue;
      const before = snapshot(), result = G.addBuilding(type, p.x, p.y);
      if (result.ok) actions.push({ action: 'order warehouse', x: p.x, y: p.y, cost: { ...result.b.paidCost }, before, after: snapshot() });
      return result.ok;
    }
    return false;
  }
  let pausedFuel = false, restoredFuel = false, demolished = false, previousDay = -1;
  // Negative interventions are observed through the original failure winter only.
  const endDay = Math.min(years * G.YEAR_DAYS, ['warehouse-without-pause', 'wrong-food-demolition'].includes(scenario) ? 600 : Infinity);
  for (let step = 0; step < endDay * G.DAY_H / 0.5 && !g.over && w.citizens.length; step++) {
    G.advanceSim(0.5);
    if (step % 24 === 0) {
      strategy.tick();
      if (g.day >= 192 && ['early-warehouse', 'warehouse-without-pause'].includes(scenario)) {
        const ordered = w.buildings.filter(b => b.type === 'storage').length > 1;
        if (scenario === 'early-warehouse' && !ordered) {
          for (const b of w.buildings) if (b.type === 'woodcutter') {
            if (!pausedFuel) actions.push({ action: 'set fuel target to 0', previousTarget: b.fuelLimit, state: snapshot() });
            b.fuelLimit = 0;
          }
          pausedFuel = true;
        }
        if (scenario === 'early-warehouse' && ordered && pausedFuel && !restoredFuel) {
          // The unchanged policy has restored its ordinary target above this line.
          actions.push({ action: 'restore ordinary fuel target', targets: w.buildings.filter(b => b.type === 'woodcutter').map(b => b.fuelLimit), state: snapshot() });
          restoredFuel = true;
        }
        if (!ordered && !w.buildings.some(b => b.state === 'site')) placeWarehouse();
      }
      if (scenario === 'wrong-food-demolition' && g.day >= 480 && !demolished) {
        const b = w.buildings.filter(b => b.type === 'gatherer').at(-1), before = snapshot();
        if (b) { G.removeBuilding(b); actions.push({ action: 'demolish latest gatherer (negative control)', id: b.id, x: b.x, y: b.y, before, after: snapshot() }); }
        demolished = true;
      }
    }
    for (const k of Object.keys(minima)) minima[k] = Math.min(minima[k], g.res[k]);
    if (g.day === previousDay) continue;
    previousDay = g.day;
    shortages.hungryCitizenDays += w.citizens.filter(c => c.hunger > 0).length;
    shortages.toolDays += g.res.tools <= 0 ? 1 : 0;
    shortages.unheatedHomeDays += w.buildings.filter(b => G.isOccupiedHome(w, b) && b.unheated).length;
    if (g.day > 0 && g.day % G.YEAR_DAYS === 0) annual.push({ ...snapshot(), births: g.stats.born, deaths: g.stats.died });
  }
  const result = { scenario, seed: 41, requestedEndDay: endDay, sourceHash: G.testSourceHash, final: snapshot(),
    births: g.stats.born, secondGenerationBorn: births.filter(b => b.secondGeneration).length, deaths: g.stats.died, causes: { ...g.stats.deadReasons },
    shortages, minima, actions, completed, birthLog: births, deathLog: deaths, annual, ordinaryBuildLog: strategy.buildLog,
    buildings: w.buildings.map(b => ({ type: b.type, state: b.state, x: b.x, y: b.y, workers: b.workers.length })) };
  console.log(`${scenario}: day=${g.day} pop=${w.citizens.length} born=${result.births} gen2=${result.secondGenerationBorn} died=${result.deaths} causes=${JSON.stringify(result.causes)} shortages=${JSON.stringify(shortages)}`);
  return result;
}
const results = scenarios.map(run);
const checks = [];
const rescue = results.find(r => r.scenario === 'early-warehouse');
if (rescue && years >= 30) {
  checks.push({ name: 'seed41 intervention reaches 30 years with descendant births and school/mine', pass: rescue.final.day >= 1440 && rescue.secondGenerationBorn > 0 && ['mine', 'school'].every(type => rescue.buildings.some(b => b.type === type && b.state === 'ok')) });
  checks.push({ name: 'seed41 intervention has no preventable deaths, hunger or tool exhaustion', pass: !rescue.causes['冻死'] && !rescue.causes['饿死'] && rescue.shortages.hungryCitizenDays === 0 && rescue.shortages.toolDays === 0 });
}
const report = { root, years, strategyHash, testSourceHash: crypto.createHash('sha256').update(fs.readFileSync(__filename)).digest('hex'),
  purpose: 'Seed41 day192 causal intervention. Does not establish a universal strategy, a balanced scheduler, zero cold homes, or browser/visual acceptance.',
  actions: 'Unchanged frozen long policy, plus temporary fuel target 0 from day192 until a second warehouse is ordered using real resources, ordinary construction and reachable placement; restore ordinary fuel target next half-day. No resource, age, worker-assignment, time or economic-constant overrides.',
  rationale: 'At the intervention, compare current food/storage capacity and logs committed to fuel. General lesson: budget logs and warehouse capacity before food-day requirements exceed capacity. Day192 and this temporary production pause were tested on seed41 only; do not copy the pause blindly into an unprepared winter.',
  results, checks };
const fullOutput = arg('--full-json', null);
if (fullOutput) fs.writeFileSync(fullOutput, JSON.stringify(report, null, 2) + '\n');
const compact = { ...report, results: report.results.map(r => {
  const { annual, birthLog, deathLog, ordinaryBuildLog, buildings, ...summary } = r;
  const deathEvents = [];
  for (const d of deathLog) {
    let event = deathEvents.find(e => e.day === d.day && e.reason === d.reason);
    if (!event) { event = { day: d.day, reason: d.reason, count: 0 }; deathEvents.push(event); }
    event.count++;
  }
  return { ...summary, descendantBirthDays: birthLog.filter(b => b.secondGeneration).map(b => b.day), deathEvents };
}) };
const output = arg('--json', null); if (output) fs.writeFileSync(output, JSON.stringify(compact, null, 2) + '\n');
for (const c of checks) console.log(`${c.pass ? 'PASS' : 'FAIL'} ${c.name}`);
if (args.includes('--assert') && checks.some(c => !c.pass)) process.exitCode = 1;
