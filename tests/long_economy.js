#!/usr/bin/env node
'use strict';
// Real-economy, normal-action 30-year integration probe. No parameter/resource/age overrides.
// The original sustainable helper is deliberately kept unchanged as the opening baseline.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { loadGame, sustainable } = require('./helpers/playability');
const args = process.argv.slice(2);
const arg = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const root = path.resolve(arg('--root', path.join(__dirname, '..')));
const years = Number(arg('--years', 30));
const seeds = arg('--seeds', '1,2,41').split(',').map(Number);
const mode = arg('--strategy', 'long');
if (!['long', 'opening', 'protected26', 'expanded-wood'].includes(mode)) throw Error('Invalid strategy');
if (!Number.isInteger(years) || years < 1 || years > 40 || seeds.some(s => !Number.isSafeInteger(s) || s < 1)) throw Error('Invalid years or seeds');

// Isolated player-decision probe. Production sees the original tree query at all times.
// protected26 and expanded-wood differ only when no reachable non-food tree remains locally.
function woodRangeOpening(G) {
  const opening = sustainable(G, 'adaptive-mining'), actions = [];
  if (mode === 'opening') return { ...opening, actions };
  return { buildLog: opening.buildLog, actions, tick() {
    const query = G.treesInRadius, markTree = G.markFellAt, w = G.world, s = w.start;
    let expanded = false;
    G.treesInRadius = function (world, x, y, radius, mature) {
      const local = query(world, x, y, radius, mature);
      if (world !== w || x !== s.x || y !== s.y || radius !== 26 || mature) return local;
      const food = w.buildings.filter(b => ['gatherer', 'hunting'].includes(b.type));
      const origin = G.nearestWalkable(w, s.x, s.y, 8);
      // Cardinal flood-fill has the same connectivity as the engine's no-corner-cut
      // eight-way paths; verify the few chosen targets with the actual pathfinder.
      const reachable = new Uint8Array(w.N * w.N), queue = origin ? [origin.y * w.N + origin.x] : [];
      if (origin) reachable[queue[0]] = 1;
      for (let k = 0; k < queue.length; k++) {
        const i = queue[k], cx = i % w.N, cy = Math.floor(i / w.N);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const xx = cx + dx, yy = cy + dy, ni = yy * w.N + xx;
          if (xx < 0 || yy < 0 || xx >= w.N || yy >= w.N || reachable[ni] || G.tileBlocked(w, xx, yy)) continue;
          reachable[ni] = 1; queue.push(ni);
        }
      }
      const usable = t => reachable[t.i] && food.every(b => Math.abs(t.x - b.x) > G.PROD[b.type].radius + 1 || Math.abs(t.y - b.y) > G.PROD[b.type].radius + 1);
      const select = (trees, limit) => {
        const candidates = trees.filter(usable).sort((a, b) => G.d2(a.x, a.y, s.x, s.y) - G.d2(b.x, b.y, s.x, s.y)), result = [];
        for (const t of candidates) if (G.findPath(w, origin.x, origin.y, t.x, t.y)) { result.push(t); if (result.length === limit) break; }
        return result;
      };
      const protectedLocal = select(local, w.buildings.filter(b => b.type === 'house').length >= 3 ? 2 : 4);
      if (protectedLocal.length || mode === 'protected26') return protectedLocal;
      expanded = true;
      return select(query(world, x, y, world.N, false), 2);
    };
    let marked = 0;
    G.markFellAt = function (world, x, y) {
      // The frozen opening already uses two-tree batches after its third home.
      // Also cap the extension itself at two, even if it activates unusually early.
      if (expanded && marked >= 2) return;
      markTree(world, x, y); marked++;
      if (expanded) actions.push({ day: G.game.day, action: 'mark reachable wood beyond exhausted local patch', x, y, distance: +G.dist(s.x, s.y, x, y).toFixed(2) });
    };
    try { opening.tick(); } finally { G.treesInRadius = query; G.markFellAt = markTree; }
  } };
}

function longStrategy(G) {
  const w = G.world, g = G.game, s = w.start;
  const opening = sustainable(G, 'adaptive-mining');
  const buildLog = opening.buildLog, actions = [];
  const count = type => w.buildings.filter(b => b.type === type).length;
  const affordable = (type, reserve = 0) => Object.entries(G.BDEF[type].cost).every(([k, qty]) => g.res[k] >= qty + (k === 'wood' ? reserve : 0));
  let lastBuildDay = -1, lastHomeDay = 60;
  const forest = b => ['gatherer', 'hunting'].includes(b.type);
  const distanceToStore = (x, y) => Math.min(...w.buildings.filter(b => b.type === 'storage' && b.state === 'ok').map(b => G.dist(x, y, b.x, b.y)));
  function place(type, radius = 22, anchor = s) {
    if (!affordable(type)) return false;
    const d = G.BDEF[type], choices = [];
    for (let y = Math.max(1, anchor.y - radius); y <= Math.min(w.N - d.h - 1, anchor.y + radius); y++) for (let x = Math.max(1, anchor.x - radius); x <= Math.min(w.N - d.w - 1, anchor.x + radius); x++) {
      if (!G.canPlace(w, type, x, y).ok) continue;
      let removed = 0, foodTrees = 0;
      for (let yy = y; yy < y + d.h; yy++) for (let xx = x; xx < x + d.w; xx++) if (w.treeIdx[yy * w.N + xx] >= 0) {
        removed++;
        if (w.buildings.some(b => forest(b) && G.d2(xx, yy, b.x, b.y) <= G.PROD[b.type].radius ** 2)) foodTrees++;
      }
      let score = -G.dist(x, y, anchor.x, anchor.y) - removed * 0.7 - foodTrees * 20;
      if (type === 'gatherer') {
        const trees = G.treesInRadius(w, x, y, G.PROD.gatherer.radius, false).filter(t => !(t.x >= x && t.x < x + d.w && t.y >= y && t.y < y + d.h));
        if (trees.length < 20) continue;
        score = Math.min(32, trees.filter(t => G.treeStage(t) >= 2).length) * 1.5 + Math.min(12, trees.length) * 0.2 - distanceToStore(x, y) * 2 - foodTrees * 12;
        if (w.buildings.some(b => b.type === 'forester' && G.d2(x, y, b.x, b.y) < 18 ** 2)) score -= 35;
      } else if (type === 'forester') {
        const mature = G.treesInRadius(w, x, y, G.PROD.forester.radius, true).length;
        if (mature < 35) continue;
        score += Math.min(80, mature) * 0.5;
        const close = w.buildings.filter(forest).reduce((n, b) => n + Math.max(0, 20 - G.dist(x, y, b.x, b.y)), 0);
        score -= close * 4;
      } else if (type === 'farm') {
        if (removed > 4 || foodTrees) continue;
        score -= distanceToStore(x, y) * 2;
      }
      choices.push({ x, y, score });
    }
    choices.sort((a, b) => b.score - a.score || a.y - b.y || a.x - b.x);
    const origin = G.nearestWalkable(w, s.x, s.y, 8);
    for (const p of choices.slice(0, 24)) {
      const entry = G.nearestWalkable(w, p.x - 1, p.y - 1, 3);
      if (!origin || !entry || !G.findPath(w, origin.x, origin.y, entry.x, entry.y)) continue;
      const result = G.addBuilding(type, p.x, p.y);
      if (result.ok) { buildLog.push(`d${g.day}:${type}@${p.x},${p.y}`); lastBuildDay = g.day; if (type === 'house') lastHomeDay = g.day; return true; }
    }
    return false;
  }
  function mark() {
    if (count('mine') && g.res.iron < 10 && g.res.wood >= 20) return;
    const originNow = G.nearestWalkable(w, s.x, s.y, 8);
    const pending = [...w.marked, ...w.markedRocks];
    if (originNow && pending.some(i => G.findPath(w, originNow.x, originNow.y, i % w.N, Math.floor(i / w.N)))) return;
    const r = g.res;
    // Reachability, not Euclidean radius, decides whether a surface deposit is usable.
    const needIron = r.iron < 25, needStone = r.stone < 60;
    if (r.wood >= 25 && (needIron || needStone)) {
      const rocks = [];
      for (let i = 0; i < w.rock.length; i++) if ((w.rock[i] === 2 && needIron) || (w.rock[i] === 1 && needStone)) rocks.push({ x: i % w.N, y: Math.floor(i / w.N), urgent: w.rock[i] === 2 && r.iron < 10 ? 1 : 0 });
      rocks.sort((a, b) => b.urgent - a.urgent || G.d2(a.x, a.y, s.x, s.y) - G.d2(b.x, b.y, s.x, s.y));
      const origin = G.nearestWalkable(w, s.x, s.y, 8);
      let selected = 0;
      for (const p of rocks) {
        if (origin && G.findPath(w, origin.x, origin.y, p.x, p.y)) { G.markRockAt(w, p.x, p.y); if (++selected >= 2) break; }
      }
      if (selected) return;
    }
    if (r.wood < 200) {
      const trees = G.treesInRadius(w, s.x, s.y, 38, false).filter(t => w.buildings.filter(forest).every(b => G.d2(t.x, t.y, b.x, b.y) > (G.PROD[b.type].radius + 1) ** 2));
      trees.sort((a, b) => G.d2(a.x, a.y, s.x, s.y) - G.d2(b.x, b.y, s.x, s.y));
      const origin = G.nearestWalkable(w, s.x, s.y, 8);
      let marked = 0;
      for (const t of trees.slice(0, 30)) if (origin && G.findPath(w, origin.x, origin.y, t.x, t.y)) { G.markFellAt(w, t.x, t.y); if (++marked === 2) break; }
    }
  }
  function tick() {
    if (g.day < 192) { opening.tick(); if (g.res.wood < 8) mark(); return; }
    const r = g.res, pop = w.citizens.length, adults = w.citizens.filter(c => c.adult).length;
    const foodDays = r.food / Math.max(1, pop * G.LIFE.eatPerDay);
    const warmNeed = w.buildings.reduce((n, b) => n + (G.isOccupiedHome(w, b) ? G.BDEF[b.type].warmWoodPerYear : 0), 0);
    for (const b of w.buildings) {
      if (b.type === 'woodcutter') b.fuelLimit = Math.min(G.PROD.woodcutter.fuelMax, Math.max(100, Math.ceil(warmNeed / 50) * 50));
      if (b.type === 'blacksmith') b.toolLimit = !count('mine') && r.iron <= 12 ? 0 : Math.min(G.PROD.blacksmith.toolMax, Math.max(30, Math.ceil(adults / 10) * 10));
      if (b.type === 'forester') {
        const active = !(count('mine') && r.iron < 10 && r.wood >= 20) && r.wood < (b.doCut ? 260 : 180);
        b.doCut = active; b.doPlant = active;
      }
    }
    mark();
    if (w.buildings.some(b => b.state === 'site') || lastBuildDay === g.day) return;
    // Expand productive and storage capacity before enabling more households.
    const foodTarget = Math.max(3, Math.ceil(pop / 8));
    if (count('gatherer') < foodTarget && (foodDays < 12 || adults >= count('gatherer') * 4 + 5) && affordable('gatherer', 16)) { if (place('gatherer', 28)) return; }
    if (!count('mine') && affordable('mine', 10) && foodDays > 8 && adults >= 14) { if (place('mine', 12)) return; }
    if (G.storageCap() < pop * G.LIFE.eatPerDay * 20 && affordable('storage', 30) && foodDays > 6) {
      const huts = w.buildings.filter(forest).sort((a, b) => distanceToStore(b.x, b.y) - distanceToStore(a.x, a.y));
      if (place('storage', 6, huts[0] || s)) return;
    }
    if (!count('blacksmith') && affordable('blacksmith', 20)) { if (place('blacksmith', 10)) return; }
    if (count('house') < 5 && count('forester') && count('mine') && foodDays > 12 && affordable('house', 40)) { if (place('house', 10)) return; }
    if (!count('mine') && affordable('mine', 30) && foodDays > 8 && adults >= 14) { if (place('mine', 12)) return; }
    if (!count('school') && affordable('school', 40) && foodDays > 12 && adults >= 18) { if (place('school', 12)) return; }
    if (count('forester') < Math.max(1, Math.floor(pop / 40)) && affordable('forester', 20) && foodDays > 10 && adults >= 14) { if (place('forester', 22)) return; }
    if (count('woodcutter') < Math.ceil(warmNeed / 350) && affordable('woodcutter', 40) && foodDays > 8) { if (place('woodcutter', 10)) return; }
    const freeHouse = w.buildings.some(b => b.type === 'house' && b.state === 'ok' && b.family == null);
    const unpaired = w.citizens.filter(c => c.adult && !c.student && c.age >= 18 && c.age <= 45 && c.partnerId == null);
    const possiblePair = unpaired.some(a => unpaired.some(b => a.sex !== b.sex && !G.areCloseKin(a, b)));
    const homeless = w.families.some(f => f.houseId == null);
    if (count('forester') && count('mine') && !freeHouse && (homeless || possiblePair) && g.day - lastHomeDay >= 48 && foodDays > 12 && affordable('house', 80) && r.firewood >= warmNeed) { place('house', 13); return; }
  }
  return { tick, buildLog, actions };
}

function run(seed) {
  const G = loadGame(root); G.newGame(seed);
  const w = G.world, g = G.game, initial = new Set(w.citizens.map(c => c.id));
  const generations = new Map(w.citizens.map(c => [c.id, (c.parentIds || []).length ? 1 : 0]));
  const birthLog = [], deaths = [], snapshots = [], production = {}, annual = [];
  const shortages = { hungryCitizenDays: 0, hungryDays: 0, foodEmptyDays: 0, toolDays: 0, unheatedHomeDays: 0 };
  const shortageLog = [];
  const minima = { food: Infinity, tools: Infinity, firewood: Infinity, wood: Infinity };
  const spawn = G.spawnCitizen;
  G.spawnCitizen = function (opt) {
    const c = spawn(opt);
    const parents = (c.parentIds || []).map(id => ({ id, bornInRun: !initial.has(id), generation: generations.get(id) ?? null, age: w.cmap[id] ? +w.cmap[id].age.toFixed(2) : null }));
    const generation = 1 + Math.max(0, ...parents.map(p => p.generation || 0));
    generations.set(c.id, generation);
    birthLog.push({ day: g.day, id: c.id, generation, parents, secondGeneration: parents.some(p => p.bornInRun) });
    return c;
  };
  const kill = G.killCitizen;
  G.killCitizen = function (c, reason) {
    deaths.push({ day: g.day, id: c.id, age: +c.age.toFixed(2), reason, food: +g.res.food.toFixed(1), fuel: +g.res.firewood.toFixed(1), tools: g.res.tools, hunger: c.hunger, cold: +c.cold.toFixed(2), job: w.bmap[c.job]?.type || null });
    return kill(c, reason);
  };
  const complete = G.completeTask;
  G.completeTask = function (c) {
    const t = c.task;
    const resource = t && (t.yield ? t.yield.type : t.kind === 'chop' ? 'wood' : t.kind === 'clearrock' ? (t.rock === 2 ? 'iron' : 'stone') : t.kind === 'harvest' ? 'food' : null);
    const before = resource ? g.res[resource] + (c.carry?.type === resource ? c.carry.qty : 0) : 0;
    const source = t?.b?.type || 'laborer';
    complete(c);
    if (resource) {
      const qty = Math.max(0, g.res[resource] + (c.carry?.type === resource ? c.carry.qty : 0) - before);
      const key = `${source}.${resource}`; production[key] = (production[key] || 0) + qty;
    }
  };
  const strategy = mode === 'long' ? longStrategy(G) : woodRangeOpening(G);
  let previousDay = -1;
  for (let step = 0; step < years * G.YEAR_DAYS * G.DAY_H / 0.5 && !g.over && w.citizens.length; step++) {
    G.advanceSim(0.5);
    if (step % 24 === 0) strategy.tick();
    for (const k of Object.keys(minima)) minima[k] = Math.min(minima[k], g.res[k]);
    if (g.day === previousDay) continue;
    previousDay = g.day;
    const hungry = w.citizens.filter(c => c.hunger > 0).length;
    shortages.hungryCitizenDays += hungry;
    shortages.hungryDays += hungry > 0 ? 1 : 0;
    shortages.foodEmptyDays += g.res.food <= 0 ? 1 : 0;
    shortages.toolDays += g.res.tools <= 0 ? 1 : 0;
    const unheated = w.buildings.filter(b => G.isOccupiedHome(w, b) && b.unheated).length;
    shortages.unheatedHomeDays += unheated;
    if (hungry || !g.res.tools || unheated) shortageLog.push({ day: g.day, hungry, tools: g.res.tools, unheated, wood: g.res.wood, food: +g.res.food.toFixed(1), firewood: +g.res.firewood.toFixed(1) });
    if (g.day % G.SEASON_DAYS === 0) snapshots.push({ day: g.day, pop: w.citizens.length, adults: w.citizens.filter(c => c.adult).length, students: w.citizens.filter(c => c.student).length, educated: w.citizens.filter(c => c.educated).length, born: g.stats.born, died: g.stats.died, foodDays: +(g.res.food / Math.max(1, w.citizens.length * G.LIFE.eatPerDay)).toFixed(2), resources: Object.fromEntries(G.RES_KEYS.map(k => [k, +g.res[k].toFixed(1)])), buildings: w.buildings.map(b => `${b.type}:${b.state}:${b.workers.length}:${b.x},${b.y}`).join(';'), marks: [w.marked.size, w.markedRocks.size], production: { ...production } });
    if (g.day > 0 && g.day % G.YEAR_DAYS === 0) {
      const line = { seed, year: g.day / G.YEAR_DAYS, pop: w.citizens.length, born: g.stats.born, gen2: birthLog.filter(b => b.secondGeneration).length, died: g.stats.died, food: Math.round(g.res.food), tools: g.res.tools, buildings: w.buildings.length };
      annual.push(line); if (args.includes('--progress')) console.log(JSON.stringify(line));
    }
  }
  const result = { seed, years, strategy: mode, sourceHash: G.testSourceHash, day: g.day, population: w.citizens.length, born: g.stats.born, secondGenerationBorn: birthLog.filter(b => b.secondGeneration).length, descendantBorn: birthLog.filter(b => b.generation >= 2).length, died: g.stats.died, causes: g.stats.deadReasons, resources: { ...g.res }, shortages, shortageLog, finalCitizens: w.citizens.map(c => ({ id: c.id, sex: c.sex, age: +c.age.toFixed(2), generation: generations.get(c.id), familyId: c.familyId, partnerId: c.partnerId, homeId: G.homeOf(c)?.id || null, parentIds: c.parentIds, student: c.student, educated: c.educated })), finalFamilies: w.families.map(f => ({ ...f })), minima, production, births: birthLog, deaths, snapshots, annual, buildLog: strategy.buildLog, actions: strategy.actions, buildings: w.buildings.map(b => ({ type: b.type, state: b.state, workers: b.workers.length, x: b.x, y: b.y })) };
  console.log(`seed=${seed} day=${result.day} pop=${result.population} born=${result.born} secondGenerationBorn=${result.secondGenerationBorn} died=${result.died} causes=${JSON.stringify(result.causes)} shortages=${JSON.stringify(shortages)}`);
  return result;
}
// Separate player-policy provenance from instrumentation: reporting may evolve without tuning a holdout policy.
const strategyHash = crypto.createHash('sha256').update(mode).update((mode === 'long' ? longStrategy : woodRangeOpening).toString()).update(fs.readFileSync(path.join(__dirname, 'helpers/playability.js'))).digest('hex');
const testSourceHash = crypto.createHash('sha256').update(fs.readFileSync(__filename)).digest('hex');
const results = seeds.map(run);
const checks = results.flatMap(r => [
  { name: `seed${r.seed}: reaches ${years} years`, pass: r.day === years * 48 && r.population > 0 },
  ...(years >= 25 ? [{ name: `seed${r.seed}: births with an in-run-born parent`, pass: r.secondGenerationBorn > 0 }] : []),
  { name: `seed${r.seed}: no tool exhaustion`, pass: r.shortages.toolDays === 0 },
  ...(years >= 25 ? [{ name: `seed${r.seed}: school and mine completed`, pass: ['school', 'mine'].every(type => r.buildings.some(b => b.type === type && b.state === 'ok')) }] : []),
  { name: `seed${r.seed}: no starvation`, pass: !(r.causes['饿死'] > 0) },
  { name: `seed${r.seed}: no preventable deaths`, pass: !(r.causes['饿死'] > 0 || r.causes['冻死'] > 0) },
]);
const report = { root, years, seeds, strategy: mode, strategyHash, testSourceHash, sourceHash: results[0]?.sourceHash, rules: mode !== 'long' ? 'Frozen adaptive-mining opening. protected26 excludes the full square food-production footprint and unreachable targets; expanded-wood differs only by looking beyond the local patch when no usable local trees remain. Expansion uses normal two-tree marking and real felling/hauling. Production queries unchanged.' : 'Opening helper through day 191; then population-scaled food/storage, resource deposits selected by reachable paths, real construction, tool/fuel limits, forester switches and one-home/year maximum with food/fuel reserves. No free resources, instant buildings, labor assignments, altered ages, time or economic parameters.', checks, results };
const output = arg('--json', null); if (output) fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
for (const c of checks) console.log(`${c.pass ? 'PASS' : 'FAIL'} ${c.name}`);
if (args.includes('--assert') && checks.some(c => !c.pass)) process.exitCode = 1;
