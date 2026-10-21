#!/usr/bin/env node
'use strict';
/* Real labour/transport survival matrix for climate heating v1. The survival
 * runs use only newGame stock and sustainable's ordinary paid construction,
 * marking and automatic staffing. No terrain edits, seeded goods, instant
 * structures, forced deliveries, shortened work or temperature overrides.
 * The separately labelled conservation fixtures intentionally control stock
 * and buildings; they are not evidence of a surviving village economy. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadGame, sustainable } = require('./helpers/playability');
const args = process.argv.slice(2);
const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const root = path.resolve(option('--root', path.join(__dirname, '..')));
// Explicit opt-in is required for a paired historical-engine benchmark. The
// normal suite must still reject an accidental old-v5 new-game regression.
const legacyBaseline = args.includes('--legacy-baseline');
const seeds = option('--seeds', '1,7,17').split(',').map(Number);
const climates = option('--climates', 'mild,fair,harsh').split(',');
const modes = option('--modes', 'automatic,physical').split(',');
const years = Number(option('--years', '3'));
const only = option('--only', 'all');
assert(Number.isInteger(years) && years >= 1 && years <= 10);
assert(seeds.every(s => Number.isInteger(s) && s >= 0));
assert(climates.every(c => ['mild', 'fair', 'harsh'].includes(c)));
assert(modes.every(m => ['automatic', 'physical'].includes(m)));
assert(['all', 'survival', 'conservation'].includes(only));
assert(!legacyBaseline || only === 'survival', '--legacy-baseline requires --only survival');
const near = (a, b, label) => assert(Math.abs(a - b) < 1e-6, `${label}: ${a} != ${b}`);
const copy = value => JSON.parse(JSON.stringify(value));
const save = G => copy(G.serializeGame());
const checks = [], results = [], conservation = [];
const check = (name, pass) => { checks.push({ name, pass: !!pass }); };
const needFor = (G, b, day) => legacyBaseline ? (G.seasonOf(day) === 3 ? G.BDEF[b.type].warmWoodPerYear / 12 : 0) : G.homeHeatingNeed(b, day);

function held(G, type) {
  let total = G.game.res[type] || 0;
  for (const b of [...G.world.buildings, ...(G.world.supplyCaches || []), ...G.world.families.map(f => f.supplyCamp).filter(Boolean)]) total += b.supplyStock?.[type] || 0;
  for (const c of G.world.citizens) {
    total += c.carry?.type === type ? c.carry.qty : 0;
    total += c.carry?.extra?.[type] || 0;
  }
  return total;
}

function observe(G) {
  const out = { bills: [], fuelPickups: 0, woodFetched: 0, fuelBatches: 0, woodProcessed: 0,
    firewoodProduced: 0, firewoodReceived: 0, supplyPickups: 0, supplyDeliveries: 0,
    householdFirewoodDelivered: 0, householdCoalDelivered: 0, householdFoodDelivered: 0, householdTravel: 0,
    householdErrandHours: 0, firewoodBurned: 0, coalBurned: 0, industryWoodProcessed: 0, buildingCompletions: [] };
  const finish = G.finishBuilding;
  G.finishBuilding = function (b) {
    const state = b.state, result = finish(b);
    if (state === 'site' && b.state === 'ok') out.buildingCompletions.push({ id: b.id, type: b.type, day: G.game.day, h: G.game.h, x: b.x, y: b.y });
    return result;
  };
  const industry = G.industryRecord;
  G.industryRecord = function (metric, type, quantity) {
    if (metric === 'processed' && type === 'wood') out.industryWoodProcessed += quantity;
    return industry(metric, type, quantity);
  };
  const heat = G.heatHome;
  const billed = new Set();
  G.heatHome = function (b, demand) {
    const previous = b.lastHeating, publicCoal = G.game.res.coal;
    const before = { publicFirewood: G.game.res.firewood, publicCoal, publicFood: G.game.res.food,
      homeFirewood: b.supplyStock?.firewood || 0, homeCoal: b.supplyStock?.coal || 0,
      homeFood: G.supplyFood(b.supplyStock), incoming: G.supplyEnabled() ? copy(G.supplyIncoming(b)) : null,
      needs: G.supplyEnabled() ? copy(G.supplyNeeds(b)) : null, restockWanted: G.supplyEnabled() ? G.supplyRestockWanted(b) : false };
    heat(b, demand);
    if (b.lastHeating === previous) return;
    const row = { home: b.id, type: b.type, ...b.lastHeating, unheated: b.unheated, before };
    const key = `${row.home}:${row.day}`;
    assert(!billed.has(key), 'each occupied home is billed at most once per day'); billed.add(key);
    near(row.need, needFor(G, b, row.day), 'daily helper and actual heating receipt');
    const factor = Math.max(.5, Math.min(1.5, 1 - (G.temperatureFor(G.world.seed, row.day, G.game.climate.type) + 2.4) / 20));
    near(row.need, ({ house: 30, stonehouse: 20, boarding: 75 })[b.type] / 12 * (legacyBaseline ? 1 : factor), 'independent frozen heating formula');
    assert.equal(G.seasonOf(row.day), 3);
    assert(row.wood >= 0 && row.coal >= 0 && row.wood + row.coal * 2 <= row.need + 1e-7);
    assert.equal(row.unheated, row.wood + row.coal * 2 + 1e-8 < row.need);
    if (G.supplyEnabled()) near(G.game.res.coal, publicCoal, 'private heat never directly withdraws public coal');
    else assert(G.game.res.coal >= Math.min(publicCoal, G.heatingPolicy().coalReserve) - 1e-7);
    out.bills.push(row); out.firewoodBurned += row.wood; out.coalBurned += row.coal;
  };
  const advanceHeat = G.advanceHomeHeating;
  if (advanceHeat) G.advanceHomeHeating = function () {
    const homes = G.world.buildings.filter(b => G.isOccupiedHome(G.world, b));
    const due = G.game.heatRules.lastDay < G.game.day, before = out.bills.length;
    const result = advanceHeat();
    assert.equal(out.bills.length - before, due && G.game.season === 3 ? homes.filter(b => b.lastHeating?.day === G.game.day).length : 0);
    if (due && G.game.season === 3) for (const b of homes) assert.equal(b.lastHeating?.day, G.game.day, 'every occupied home gets its actual daily bill');
    return result;
  };
  const fuel = G.completeFuelTask;
  G.completeFuelTask = function (c, task) {
    const phase = task?.phase, completed = task?.completed, beforeCarry = c.carry, beforeWood = G.game.res.wood;
    const atSource = phase === 'fetch' && G.atStorageDoor(c, 'wood');
    const atWorkshop = phase === 'process' && G.atMedicalDoor(c, task.b);
    fuel(c, task);
    if (phase === 'fetch' && c.carry?.fuelInput && c.carry !== beforeCarry) {
      assert(atSource, 'raw wood pickup must happen at storage');
      near(beforeWood - G.game.res.wood, c.carry.qty, 'raw wood charged once at actual pickup');
      out.fuelPickups++; out.woodFetched += c.carry.qty;
    }
    if (phase === 'process' && beforeCarry?.fuelInput && !completed && task.completed) {
      assert(atWorkshop, 'firewood processing must happen at its workshop');
      near(beforeWood, G.game.res.wood, 'processing cannot charge raw wood twice');
      out.fuelBatches++; out.woodProcessed += beforeCarry.qty; out.firewoodProduced += task.yield.qty;
    }
  };
  const deposit = G.deposit;
  G.deposit = function (type, amount, retain) {
    const received = deposit(type, amount, retain);
    if (type === 'firewood') out.firewoodReceived += received;
    return received;
  };
  const supply = G.stepSupply;
  G.stepSupply = function (c, dt) {
    const task = G.supplyTaskOf(c), phase = task?.phase, target = task?.to;
    const beforeCargo = c.carry, before = target ? { ...(target.supplyStock || {}) } : {};
    const atSource = task?.source && (['supplycache', 'supplycamp'].includes(task.source.type) || G.atMedicalDoor(c, task.source));
    const atTarget = target && (['supplycache', 'supplycamp'].includes(target.type) || G.atMedicalDoor(c, target));
    const answer = supply(c, dt);
    if (phase === 'fetch' && c.carry?.supplyBatch && c.carry !== beforeCargo) {
      assert(atSource, 'household pickup must reach its actual source'); out.supplyPickups++;
    }
    if (phase === 'deliver' && target) {
      const moved = G.SUPPLY.types.reduce((n, k) => n + (target.supplyStock?.[k] || 0) - (before[k] || 0), 0);
      if (moved > 1e-7) {
        assert(atTarget, 'household stock changes only after actual arrival'); out.supplyDeliveries++;
        out.householdFirewoodDelivered += (target.supplyStock?.firewood || 0) - (before.firewood || 0);
        out.householdCoalDelivered += (target.supplyStock?.coal || 0) - (before.coal || 0);
        out.householdFoodDelivered += G.supplyFood(target.supplyStock) - G.supplyFood(before);
      }
    }
    return answer;
  };
  return out;
}

function runSurvival(seed, climate, mode) {
  const started = Date.now(), G = loadGame(root);
  assert(G.newGame(seed, { climate }).ok); assert.equal(G.serializeGame().v, legacyBaseline ? 5 : 6);
  let bootstrap = null;
  if (mode === 'physical') {
    const quote = G.supplyModeQuote(); bootstrap = copy(quote.cost);
    const before = Object.fromEntries(G.SUPPLY.types.map(k => [k, held(G, k)]));
    assert(G.enableHouseholdSupply(quote.key));
    for (const k of G.SUPPLY.types) near(held(G, k), before[k], 'confirmed mode transition conserves ' + k);
  }
  const strategy = sustainable(G, 'normal'), evidence = observe(G), initialFuel = held(G, 'firewood');
  const daily = [], boundaries = [], deaths = [];
  let hungerCitizenDays = 0, coldCitizenDays = 0, unheatedHomeDays = 0, saveChecks = 0, lastDay = 0;
  const kill = G.killCitizen;
  G.killCitizen = function (c, reason) { deaths.push({ day: G.game.day, reason, hunger: c.hunger, cold: c.cold, age: c.age }); return kill(c, reason); };
  G.autosave = function () {
    const snapshot = save(G); G.prepareSaveData(snapshot);
    if (!legacyBaseline) assert.equal(snapshot.game.heatRules.lastDay, G.game.day - 1, 'season autosave stays before new-day heat');
    boundaries.push({ day: G.game.day, lastHeatingDay: snapshot.game.heatRules?.lastDay ?? null,
      publicFirewood: G.game.res.firewood, privateFirewood: held(G, 'firewood') - G.game.res.firewood,
      latestBill: Math.max(-1, ...snapshot.buildings.map(b => b.lastHeating?.day ?? -1)) });
  };
  while (G.game.day < years * 48 && !G.game.over) {
    if (G.game.h % 12 === 0) strategy.tick();
    const errands = G.world.citizens.filter(c => G.supplyTaskOf(c)).map(c => ({ c, x: c.x, y: c.y }));
    evidence.householdErrandHours += errands.length * .5;
    G.advanceSim(.5);
    for (const { c, x, y } of errands) if (!c.dead) evidence.householdTravel += Math.hypot(c.x - x, c.y - y);
    if (G.game.day === lastDay) continue;
    lastDay = G.game.day;
    const snapshot = save(G); G.prepareSaveData(snapshot); saveChecks++;
    if (!legacyBaseline) assert.equal(snapshot.game.heatRules.lastDay, G.game.day);
    const homes = G.world.buildings.filter(b => G.isOccupiedHome(G.world, b));
    if (G.game.season === 3) for (const b of homes) {
      // New housing/families can change at the end of the same midnight. Only
      // houses present at the heating callback owe that callback's bill.
      if (b.lastHeating?.day === G.game.day) near(b.lastHeating.need, needFor(G, b, G.game.day), 'saved daily demand');
    }
    const hungry = G.world.citizens.filter(c => c.hunger > 0).length;
    const cold = G.world.citizens.filter(c => c.cold > 0).length;
    const unheated = homes.filter(b => b.unheated).length;
    hungerCitizenDays += hungry; coldCitizenDays += cold; unheatedHomeDays += unheated;
    // No trade, fuel exports or fires are enabled in this strategy. Production,
    // public/private/cargo stock and actual receipts close the firewood balance.
    near(initialFuel + evidence.firewoodProduced, held(G, 'firewood') + evidence.firewoodBurned + (G.game.supplyLost?.firewood || 0), 'daily actual firewood conservation');
    daily.push({ day: G.game.day, population: G.world.citizens.length, hungry, cold, unheated,
      food: G.supplyEconomyStock('food'), firewood: held(G, 'firewood'), publicFirewood: G.game.res.firewood,
      wood: G.game.res.wood, produced: evidence.firewoodProduced, received: evidence.firewoodReceived,
      processedWood: evidence.woodProcessed, burned: evidence.firewoodBurned, deaths: G.game.stats.died,
      births: G.game.stats.born, publicFood: G.game.res.food,
      foodProduced: G.FOOD_KEYS.reduce((n, k) => n + G.game.industryLedger.totals[k].produced, 0),
      foodReceived: G.FOOD_KEYS.reduce((n, k) => n + G.game.industryLedger.totals[k].received, 0),
      householdFoodDelivered: evidence.householdFoodDelivered, householdFirewoodDelivered: evidence.householdFirewoodDelivered,
      supplyPickups: evidence.supplyPickups, supplyDeliveries: evidence.supplyDeliveries,
      homes: homes.map(b => ({ id: b.id, type: b.type, residents: G.supplyResidents(b).length,
        food: G.supplyFood(b.supplyStock), firewood: b.supplyStock?.firewood || 0, coal: b.supplyStock?.coal || 0, unheated: !!b.unheated })) });
  }
  const id = `${climate}/${seed}/${mode}`;
  const result = { id, seed, climate, mode, years, strategy: 'unmodified sustainable(normal)',
    sourceHash: G.testSourceHash, saveVersion: G.serializeGame().v, ms: Date.now() - started, day: G.game.day, population: G.world.citizens.length,
    born: G.game.stats.born, died: G.game.stats.died, causes: copy(G.game.stats.deadReasons),
    bootstrap, hungerCitizenDays, coldCitizenDays, unheatedHomeDays, saveChecks,
    buildLog: strategy.buildLog, deaths, daily, boundaries, ...evidence,
    industry: copy(G.game.industryLedger.totals), finalResources: copy(G.game.res) };
  check(id + ': complete requested horizon', result.day === years * 48 && result.population >= 15);
  check(id + ': no first-winter death', !deaths.some(d => d.day <= 48));
  check(id + ': no starvation death', !(result.causes['饿死'] > 0));
  check(id + ': no cold death', !(result.causes['冻死'] > 0));
  check(id + ': no unheated home-days', unheatedHomeDays === 0);
  check(id + ': each day and season-boundary validates', saveChecks === years * 48 && boundaries.length === years * 4);
  check(id + ': real fuel input, processing and storage receipt', evidence.fuelPickups > 0 && evidence.fuelBatches > 0 && evidence.firewoodReceived > 0);
  near(evidence.industryWoodProcessed, G.game.industryLedger.totals.wood.processed, 'all actual wood processing agrees with ledger');
  assert(evidence.woodProcessed <= evidence.industryWoodProcessed, 'fuel input is a subset of actual industry processing');
  near(evidence.firewoodProduced, G.game.industryLedger.totals.firewood.produced, 'production ledger agrees with real batches');
  near(evidence.firewoodReceived, G.game.industryLedger.totals.firewood.received, 'receipt ledger agrees with deposits');
  if (mode === 'physical') check(id + ': real household pickup, hauling and arrival', evidence.supplyPickups > 0 && evidence.supplyDeliveries > 0 && evidence.householdTravel > 0 && evidence.householdFirewoodDelivered > 0);
  results.push(result);
  saveProgress();
  console.log(JSON.stringify({ id, day: result.day, population: result.population, deaths: result.causes,
    hungerCitizenDays, coldCitizenDays, unheatedHomeDays, firewoodProduced: evidence.firewoodProduced,
    firewoodBurned: evidence.firewoodBurned, saveChecks, boundaries: boundaries.length,
    failures: checks.filter(c => !c.pass && c.name.startsWith(id)).map(c => c.name), ms: result.ms }));
}

function fixture(seed, climate, mode) {
  const G = loadGame(root); assert(G.newGame(seed, { climate }).ok);
  const w = G.world;
  for (const k of ['water', 'rock', 'road']) w[k].fill(0);
  w.bgrid.fill(-1); w.treeIdx.fill(-1); w.trees = []; w.buildings = []; w.bmap = {};
  w.citizens = []; w.cmap = {}; w.families = []; w.marked.clear(); w.markedRocks.clear(); G.bumpNavigation(w);
  const build = (type, x, y) => { const q = G.addBuilding(type, x, y, { instant: true, free: true }); assert(q.ok); return q.b; };
  build('storage', 2, 10);
  const homes = ['house', 'stonehouse', 'boarding'].map((type, i) => {
    const b = build(type, 10, 5 + i * 7), c = G.spawnCitizen({ x: 9, y: 5 + i * 7, age: 30, sex: 'm' });
    const f = { id: G.nextId(), members: [c.id], houseId: b.id, coupleIds: [] }; w.families.push(f); c.familyId = f.id;
    if (type !== 'boarding') b.family = f.id;
    return b;
  });
  for (const k of G.RES_KEYS) G.game.res[k] = 0;
  Object.assign(G.game.res, { grain: 500, food: 500, tools: 30, firewood: 3, coal: 180 });
  if (mode === 'physical') assert(G.enablePhysicalSupplyPrototype());
  assert(G.setHeatingPolicy(true, 20));
  // This controlled fixture begins in autumn; all physical stock still starts
  // in public storage and reaches homes only through normal movement/work.
  Object.assign(G.game, { day: 24, h: 8, season: 2, year: 1 });
  G.advanceCropClimate(); G.advanceHomeHeating();
  G.game.townLedger = G.newTownLedger(G.game); G.game.industryLedger = G.newIndustryLedger(G.game);
  return { G, homes };
}

function runConservation(seed, climate, mode) {
  const { G, homes } = fixture(seed, climate, mode), evidence = observe(G);
  const initial = { firewood: held(G, 'firewood'), coal: held(G, 'coal') }, daily = [], boundaries = [];
  let lastDay = G.game.day;
  G.autosave = function () {
    const data = save(G); G.prepareSaveData(data); boundaries.push(data);
  };
  while (G.game.day < 48 && !G.game.over) {
    G.advanceSim(.25);
    for (const type of ['firewood', 'coal']) near(initial[type], held(G, type) + evidence[type === 'firewood' ? 'firewoodBurned' : 'coalBurned'], 'controlled exact ' + type + ' conservation');
    if (G.game.day === lastDay) continue;
    lastDay = G.game.day; G.prepareSaveData(save(G));
    daily.push({ day: lastDay, publicCoal: G.game.res.coal, heldCoal: held(G, 'coal'), heldFirewood: held(G, 'firewood') });
    assert(G.game.res.coal >= 20 - 1e-7, 'public industrial reserve survives household pickup and heat');
  }
  assert.equal(G.game.day, 48); assert.equal(G.game.stats.died, 0);
  assert.equal(evidence.bills.length, 12 * homes.length);
  assert(evidence.coalBurned > 0);
  assert(evidence.bills.every(b => !b.unheated), 'controlled available fuel must arrive and cover every real winter bill');
  if (mode === 'physical') assert(evidence.householdCoalDelivered > 0 && evidence.supplyDeliveries > 0);
  // Replay a genuine season autosave in a separate game. Loading preserves
  // pre-burn stock and receipts; time before midnight cannot catch up day 36.
  const boundary = boundaries.find(d => d.game.day === 36); assert(boundary);
  const replay = loadGame(root); replay.applySaveData(copy(boundary));
  const replayEvidence = observe(replay), before = { firewood: held(replay, 'firewood'), coal: held(replay, 'coal') };
  for (let i = 0; i < 3; i++) {
    replay.applySaveData(copy(boundary));
    near(held(replay, 'firewood'), before.firewood, 'boundary reload firewood');
    near(held(replay, 'coal'), before.coal, 'boundary reload coal');
    assert.equal(replay.game.heatRules.lastDay, 35);
  }
  while (replay.game.day === 36 && replay.game.h < 23.75) replay.advanceSim(.25);
  assert.equal(replayEvidence.bills.length, 0, 'loading never catches up the skipped midnight bill');
  near(held(replay, 'firewood'), before.firewood, 'no catch-up firewood burn');
  near(held(replay, 'coal'), before.coal, 'no catch-up coal burn');
  replay.advanceSim(.25);
  assert.equal(replay.game.day, 37); assert.equal(replayEvidence.bills.length, homes.length);
  assert(replayEvidence.bills.every(b => b.day === 37)); replay.prepareSaveData(save(replay));
  conservation.push({ label: 'controlled stock and building fixture; not a survival benchmark', seed, climate, mode,
    initial, daily, ...evidence, replayBills: replayEvidence.bills });
  saveProgress();
  console.log(`ok controlled conservation and actual coal transport ${climate}/${seed}/${mode}`);
}

function saveProgress() {
  const output = option('--json', null);
  if (output) fs.writeFileSync(output, JSON.stringify({ scope: { root, legacyBaseline, seeds, climates, modes, years },
    sourceHash: loadGame(root).testSourceHash, incomplete: true, checks, results, conservation, fatal: null }, null, 2) + '\n');
}

let fatal = null;
try {
  if (only !== 'survival') for (const climate of climates) for (const mode of modes) runConservation(seeds[0], climate, mode);
  if (only !== 'conservation') for (const climate of climates) for (const seed of seeds) for (const mode of modes) runSurvival(seed, climate, mode);
} catch (error) { fatal = error.stack; console.error(error.stack); }
const report = { scope: { root, legacyBaseline, seeds, climates, modes, years }, sourceHash: loadGame(root).testSourceHash,
  incomplete: !!fatal,
  survivalMethod: 'Real new-village labour, pathfinding, construction, household errands and population, dt=0.5h; daily save validation and real season pre-burn autosave validation',
  checks, results, conservation, fatal };
const output = option('--json', null); if (output) fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
const failures = checks.filter(c => !c.pass);
console.log(`Winter heating seasons: ${checks.length - failures.length}/${checks.length} survival checks; ${conservation.length} controlled conservation cases${fatal ? '; fatal invariant failure' : ''}`);
if (fatal || failures.length) process.exitCode = 1;
