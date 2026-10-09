'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const sourceCache = new Map();

function loadGame(root) {
  const context = {
    console, setTimeout, clearTimeout,
    addEventListener() {},
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    document: { getElementById: () => ({ classList: { add() {}, remove() {}, contains: () => true }, addEventListener() {}, querySelectorAll: () => [] }) },
  };
  context.window = context;
  vm.createContext(context);
  if (!sourceCache.has(root)) sourceCache.set(root, ['core', 'defs', 'map', 'sim', 'main'].map(name => [name, fs.readFileSync(path.join(root, 'js', name + '.js'), 'utf8')]));
  for (const [name, source] of sourceCache.get(root)) vm.runInContext(source, context, { filename: name + '.js' });
  const G = context.G;
  G.ui = { toast() {}, refreshHUD() {}, hideInfo() {}, setToolActive() {} };
  G.markGroundDirty = () => {};
  G.T2S = () => [0, 0];
  G.cam = { x: 0, y: 0, z: 1 };
  G.groundDirty = { clear() {} };
  G.autosave = () => {}; // Persistence has no economy effect; never contact a server in tests.
  G.testSourceHash = crypto.createHash('sha256').update(sourceCache.get(root).map(([name, text]) => name + '\n' + text).join('\n')).digest('hex');
  return G;
}

function sustainable(G, variant = 'normal') {
  const w = G.world, g = G.game, s = w.start;
  const buildLog = [];
  const count = type => w.buildings.filter(b => b.type === type).length;
  function place(type, radius = 9, score) {
    const def = G.BDEF[type];
    let best = null, bestScore = -Infinity;
    for (let r = 2; r <= radius; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      const x = s.x + dx - ((def.w - 1) >> 1), y = s.y + dy - ((def.h - 1) >> 1);
      if (!G.canPlace(w, type, x, y).ok) continue;
      let clearedFoodTrees = 0;
      for (let yy = y; yy < y + def.h; yy++) for (let xx = x; xx < x + def.w; xx++) {
        if (w.treeIdx[yy * w.N + xx] >= 0 && w.buildings.some(b => b.type === 'gatherer' && G.d2(xx, yy, b.x, b.y) <= G.PROD.gatherer.radius ** 2)) clearedFoodTrees++;
      }
      const value = (score ? score(x + (def.w >> 1), y + (def.h >> 1)) : -G.dist(x, y, s.x, s.y)) - clearedFoodTrees * 12;
      if (value > bestScore) { bestScore = value; best = { x, y }; }
    }
    if (!best) return false;
    const result = G.addBuilding(type, best.x, best.y);
    if (result.ok) buildLog.push(`d${g.day}:${type}@${best.x},${best.y}`);
    return result.ok;
  }
  const forest = type => (cx, cy) => {
    // Production circles use the building origin, not its visual center. Count trees
    // after its footprint is cleared, so a legal but barren hut is never selected.
    const d = G.BDEF[type], x = cx - (d.w >> 1), y = cy - (d.h >> 1);
    const trees = G.treesInRadius(w, x, y, G.PROD[type].radius, false).filter(t => !(t.x >= x && t.x < x + d.w && t.y >= y && t.y < y + d.h));
    if (trees.length < G.PROD[type].needTrees + 4) return -Infinity;
    const mature = trees.filter(t => G.treeStage(t) >= 2).length;
    return Math.min(32, mature) + Math.min(12, trees.length - mature) * 0.4 - G.dist(x, y, s.x, s.y) * 2;
  };
  function mark() {
    // Do not queue competing resources: the engine executes marked trees before rocks.
    // Gatherer forests are food infrastructure, so fell trees outside their work circles.
    if (w.marked.size || w.markedRocks.size) return;
    const batch = count('house') >= 3 ? 2 : 4;
    if (g.res.wood >= 25 && (g.res.stone < 32 || (g.res.tools < 12 && g.res.iron < 10))) {
      const rocks = [];
      for (let i = 0; i < w.rock.length; i++) if (w.rock[i]) {
        const x = i % w.N, y = Math.floor(i / w.N);
        const wanted = w.rock[i] === 2 ? (g.res.tools < 12 && g.res.iron < 10) : g.res.stone < 32;
        if (wanted && (variant === 'adaptive-mining' || G.d2(x, y, s.x, s.y) <= 40 * 40)) rocks.push({ x, y });
      }
      rocks.sort((a, b) => G.d2(a.x, a.y, s.x, s.y) - G.d2(b.x, b.y, s.x, s.y));
      let selected = rocks.slice(0, 2);
      if (variant === 'adaptive-mining') {
        const origin = G.nearestWalkable(w, s.x, s.y, 8);
        const reachable = list => {
          const ranked = [];
          for (const r of list) {
            const route = G.findPath(w, origin.x, origin.y, r.x, r.y);
            if (!route) continue;
            let cost = 0, prev = origin;
            for (const p of route) { cost += G.dist(prev.x, prev.y, p.x, p.y); prev = p; }
            ranked.push({ ...r, cost });
          }
          return ranked.sort((a, b) => a.cost - b.cost || G.d2(a.x, a.y, s.x, s.y) - G.d2(b.x, b.y, s.x, s.y)).slice(0, 2);
        };
        selected = origin ? rocks.filter(r => G.d2(r.x, r.y, s.x, s.y) <= 40 * 40 && G.findPath(w, origin.x, origin.y, r.x, r.y)).slice(0, 2) : [];
        // A real player's recovery: search farther when the required local mineral is exhausted.
        if (!selected.length && origin) selected = reachable(rocks);
      }
      if (selected.length) {
        for (const r of selected) G.markRockAt(w, r.x, r.y);
        return;
      }
    }
    if (g.res.wood < 150) {
      const gatherers = w.buildings.filter(b => b.type === 'gatherer');
      const trees = G.treesInRadius(w, s.x, s.y, 26, false).filter(t => gatherers.every(b => G.d2(t.x, t.y, b.x, b.y) > (G.PROD.gatherer.radius + 1) ** 2));
      trees.sort((a, b) => G.d2(a.x, a.y, s.x, s.y) - G.d2(b.x, b.y, s.x, s.y));
      for (const t of trees.slice(0, batch)) G.markFellAt(w, t.x, t.y);
    }
  }
  function tick() {
    if (variant === 'neglect') return;
    const r = g.res, pop = w.citizens.length;
    const foodDays = r.food / Math.max(1, pop * G.LIFE.eatPerDay);
    const warmNeed = w.buildings.reduce((n, b) => n + (G.isOccupiedHome(w, b) ? G.BDEF[b.type].warmWoodPerYear : 0), 0);
    for (const b of w.buildings) if (b.type === 'woodcutter') b.fuelLimit = Math.min(G.PROD.woodcutter.fuelMax, Math.max(variant === 'fuel200' ? 200 : 100, Math.ceil(warmNeed / 50) * 50));
    mark();
    // A human-scale decision each half day; no free buildings, resources, or manual worker edits.
    if (w.buildings.some(b => b.state === 'site')) return;
    if (variant === 'overexpand' && g.day >= 48 && r.wood >= 16 && r.stone >= 8 && count('house') < 16) { place('house', 12); return; }
    if (!count('gatherer') && r.wood >= 30 && r.stone >= 12) { place('gatherer', 10, forest('gatherer')); return; }
    if (variant !== 'no-fuel' && !count('woodcutter') && r.wood >= 30 && r.stone >= 8) { place('woodcutter', 5); return; }
    if (count('house') >= 3 && !count('blacksmith') && r.tools < 10 && foodDays > 4 && r.wood >= 42 && r.stone >= 24 && r.iron >= 4) { place('blacksmith', 6); return; }
    if (count('gatherer') < 2 || (count('gatherer') < 3 && foodDays < 8)) {
      if (r.wood >= 30 && r.stone >= 12) place('gatherer', 12, forest('gatherer'));
      return;
    }
    if (count('house') < 3 && r.wood >= 22 && r.stone >= 8) { place('house', 7); return; }
    if (count('house') < 3) return;
    const winterSafe = g.season < 2 || r.firewood >= warmNeed + 20;
    if (!winterSafe && variant !== 'no-fuel') return;
    if (!count('forester') && w.citizens.filter(c => c.adult).length >= 14 && foodDays >= 12 && r.wood >= 62 && r.stone >= 12) {
      // Keep the main felling area on the opposite side of the village from food forests.
      place('forester', 10, (x, y) => Math.min(70, G.treesInRadius(w, x, y, G.PROD.forester.radius, true).length) - G.dist(x, y, s.x, s.y) * 2 + Math.min(...w.buildings.filter(b => b.type === 'gatherer').map(b => G.dist(x, y, b.x, b.y))) * 4);
      return;
    }
    if (g.day >= 36 && count('storage') < 2 && r.wood >= 88 && r.stone >= 16 && r.food > G.storageCap() - 100) { place('storage', 8); return; }
    if (g.day >= 48 && !count('farm') && g.season === 0 && foodDays >= 8) {
      place('farm', 14, (x, y) => {
        let removed = 0;
        for (let yy = y - 4; yy < y + 4; yy++) for (let xx = x - 4; xx < x + 4; xx++) if (w.treeIdx[yy * w.N + xx] >= 0) removed++;
        return -removed * 4 - G.dist(x, y, s.x, s.y);
      });
      return;
    }
    if (g.day >= 60 && count('house') < 5 && r.wood >= 70 && r.stone >= 18 && foodDays >= 10) { place('house', 8); return; }
  }
  return { tick, buildLog };
}

function run(root, seed, strategyName, years, observe, tuning = {}) {
  const G = loadGame(root);
  if (tuning.gathererYield != null) G.PROD.gatherer.yield.qty = tuning.gathererYield;
  G.newGame(seed);
  const w = G.world, g = G.game;
  const strategy = strategyName === 'original' ? require('./original-opening')(G) : sustainable(G, strategyName);
  const production = {}, deaths = [], snapshots = [], minima = { food: Infinity, firewood: Infinity, tools: Infinity, wood: Infinity };
  const winterMinima = {};
  const shortages = { hungryCitizenDays: 0, toolDays: 0, unheatedHomeDays: 0 };
  const staffingHours = {}, assignments = {}, interruptions = {};
  const assign = G.assignWorker, release = G.releaseWorker;
  G.assignWorker = function (b, c) { assignments[b.type] = (assignments[b.type] || 0) + 1; return assign(b, c); };
  G.releaseWorker = function (c) {
    const b = w.bmap[c.job];
    if (b && (c.task || c.pausedTask)) { const key = b.type + '.' + (c.task || c.pausedTask).kind; interruptions[key] = (interruptions[key] || 0) + 1; }
    return release(c);
  };
  const complete = G.completeTask;
  G.completeTask = function (c) {
    const t = c.task;
    const resource = t && (t.yield ? t.yield.type : t.kind === 'chop' ? 'wood' : t.kind === 'clearrock' ? (t.rock === 2 ? 'iron' : 'stone') : t.kind === 'harvest' ? 'food' : null);
    const before = resource ? g.res[resource] + (c.carry && c.carry.type === resource ? c.carry.qty : 0) : 0;
    const source = t && t.b ? t.b.type : 'laborer';
    complete(c);
    if (resource) {
      const after = g.res[resource] + (c.carry && c.carry.type === resource ? c.carry.qty : 0);
      const qty = Math.max(0, after - before);
      if (qty) { const key = `${source}.${resource}`; production[key] = (production[key] || 0) + qty; }
    }
  };
  const kill = G.killCitizen;
  G.killCitizen = function (c, reason) {
    const family = w.families.find(f => f.id === c.familyId);
    deaths.push({ day: g.day, age: +c.age.toFixed(1), reason, hunger: c.hunger, cold: +c.cold.toFixed(2), home: family && family.houseId, food: +g.res.food.toFixed(1), fuel: +g.res.firewood.toFixed(1), wood: g.res.wood });
    kill(c, reason);
  };
  let previousDay = -1;
  const dt = 0.5;
  for (let step = 0; step < years * G.YEAR_DAYS * G.DAY_H / dt && !g.over && w.citizens.length; step++) {
    G.advanceSim(dt);
    for (const b of w.buildings) staffingHours[b.type] = (staffingHours[b.type] || 0) + b.workers.length * dt;
    // The historical opening runs at its original half-hour cadence, frozen for exact reproduction.
    if (strategyName === 'original' || step % 24 === 0) strategy.tick();
    if (g.season === 3) {
      const m = winterMinima[g.year] || (winterMinima[g.year] = { food: Infinity, firewood: Infinity });
      m.food = Math.min(m.food, g.res.food); m.firewood = Math.min(m.firewood, g.res.firewood);
    }
    for (const key of Object.keys(minima)) minima[key] = Math.min(minima[key], g.res[key]);
    if (g.day !== previousDay) {
      previousDay = g.day;
      if (observe) observe(G);
      shortages.hungryCitizenDays += w.citizens.filter(c => c.hunger > 0).length;
      shortages.toolDays += g.res.tools <= 0 ? 1 : 0;
      shortages.unheatedHomeDays += w.buildings.filter(b => G.isOccupiedHome(w, b) && b.unheated).length;
      if (g.day % G.SEASON_DAYS === 0) snapshots.push({ day: g.day, pop: w.citizens.length, ...Object.fromEntries(G.RES_KEYS.map(k => [k, Math.round(g.res[k])])), deaths: g.stats.died, buildings: w.buildings.map(b => `${b.type}:${b.state}:${b.workers.length}`).join(',') });
    }
  }
  return { seed, strategy: strategyName, sourceHash: G.testSourceHash, tuning, years, day: g.day, population: w.citizens.length, born: g.stats.born, died: g.stats.died, causes: g.stats.deadReasons, resources: Object.fromEntries(G.RES_KEYS.map(k => [k, +g.res[k].toFixed(1)])), minima, winterMinima, shortages, production, staffingHours, assignments, interruptions, deaths, snapshots, buildLog: strategy.buildLog, buildings: w.buildings.map(b => ({ type: b.type, state: b.state, workers: b.workers.length })) };
}
module.exports = { loadGame, sustainable, run };
