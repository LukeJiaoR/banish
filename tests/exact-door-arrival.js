'use strict';
/* Regressions from real Fair/Harsh winter runs: a rounded start cell is not
 * physical arrival. Every completion below uses the real citizen step loop. */
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadGame } = require('./helpers/playability');
const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));
let passed = 0, failed = 0;
const near = (a, b) => assert(Math.abs(a - b) < 1e-9, `${a} != ${b}`);
function test(name, run) {
  try { run(); passed++; console.log('ok ' + name); }
  catch (error) { failed++; console.error('FAIL ' + name + '\n' + error.stack); }
}
function fresh() {
  const G = loadGame(root); G.newGame(1); const w = G.world;
  // These endpoint tests pin the existing winter rates, not climate balance.
  G.game.climate = null; G.game.heatRules = null; delete G.game.startConfig.climate;
  for (const k of ['water', 'rock', 'road', 'mountain']) if (w[k]) w[k].fill(0);
  w.bgrid.fill(-1); w.treeIdx.fill(-1);
  for (const k of ['trees', 'buildings', 'citizens', 'families']) w[k] = [];
  w.bmap = {}; w.cmap = {}; w.supplyCaches = [];
  w.marked.clear(); w.markedRocks.clear(); G.bumpNavigation(w);
  G.game.day = 36; G.game.season = 3; G.game.h = 12; G.rng = () => .5;
  Object.assign(G.game.res, { wood: 200, stone: 200, iron: 100, grain: 300, food: 300, firewood: 0, tools: 30 });
  const build = (type, x, y) => {
    const r = G.addBuilding(type, x, y, { instant: true, free: true });
    assert(r.ok, r.reason); return r.b;
  };
  const storage = build('storage', 75, 60), home = build('house', 78, 57);
  const f = { id: G.nextId(), members: [], coupleIds: [], houseId: home.id };
  w.families.push(f); home.family = f.id; home.unheated = false;
  const c = G.spawnCitizen({ x: 80, y: 56, age: 7, sex: 'm', familyId: f.id });
  f.members = [c.id]; c.cold = .5;
  return { G, w, c, home, f, storage, build };
}
function until(G, c, done, n = 2000) {
  for (let i = 0; i < n && !done(); i++) G.stepCitizen(c, .1);
  assert(done(), 'real path/work loop did not complete');
}
function surround(G, b, value = 1) {
  for (let y = b.y - 1; y <= b.y + b.h; y++)
    for (let x = b.x - 1; x <= b.x + b.w; x++)
      if (x < b.x || x >= b.x + b.w || y < b.y || y >= b.y + b.h) G.world.water[y * G.world.N + x] = value;
  G.bumpNavigation(G.world);
}
const stock = G => JSON.stringify([G.game.res, G.game.supplyUsed, G.world.buildings.map(b => b.supplyStock)]);

test('single and multi-goal planners preserve exact arrival and both signs of IEEE residue', () => {
  const { G, w } = fresh();
  for (const [dx, dy] of [[0, 0], [1e-14, 0], [-1e-14, 0], [0, 1e-14], [0, -1e-14]]) {
    const x = 80 + dx, y = 56 + dy;
    for (const multi of [false, true]) {
      const p = multi ? G.findPathToAny(w, x, y, [{ x: 80, y: 56 }]).path : G.findPath(w, x, y, 80, 56);
      assert.equal(p.length, dx || dy ? 1 : 0, `${multi ? 'multi' : 'single'} ${dx},${dy}`);
      if (p.length) assert.deepEqual({ ...p[0] }, { x: 80, y: 56 });
    }
  }
});

test('all four outside door edges converge exactly without widening the door predicate', () => {
  for (const edge of ['left', 'right', 'top', 'bottom']) {
    const { G, c, home } = fresh(), epsilon = 1e-14;
    const p = edge === 'left' ? { x: home.x - 1, y: home.y } : edge === 'right' ? { x: home.x + home.w, y: home.y }
      : edge === 'top' ? { x: home.x, y: home.y - 1 } : { x: home.x, y: home.y + home.h };
    c.x = p.x + (edge === 'left' ? -epsilon : edge === 'right' ? epsilon : 0);
    c.y = p.y + (edge === 'top' ? -epsilon : edge === 'bottom' ? epsilon : 0);
    assert(!G.atMedicalDoor(c, home), edge + ' remains outside the strict door');
    const before = stock(G), x = c.x, y = c.y;
    assert(G.tryWarmthJourney(c)); assert.equal(c.state, 'walk'); assert.equal(c.path.length, 1);
    assert.equal(c.x, x); assert.equal(c.y, y); // Planning never teleports.
    G.stepCitizen(c, 0); assert.equal(c.x, x); assert.equal(c.y, y);
    G.stepCitizen(c, .1); assert.equal(c.x, p.x); assert.equal(c.y, p.y);
    assert.equal(c.state, 'warmth'); assert(G.atWarmthHome(c, home));
    const cold = c.cold; G.stepCitizen(c, 1); near(c.cold, cold - G.LIFE.warmRecover / 24);
    assert.equal(stock(G), before);
  }
});

test('observed Fair child corner 80.00000000000001,56 reaches warmth then exits the journey', () => {
  const { G, c, home } = fresh(); c.x = 80.00000000000001;
  assert(!G.atWarmthHome(c, home)); assert(G.tryWarmthJourney(c));
  until(G, c, () => G.atWarmthHome(c, home), 4);
  assert.equal(c.x, 80); assert.equal(c.y, 56);
  until(G, c, () => !c.warmthJourney);
  assert(c.cold <= G.WARMTH.stopCold); assert.equal(c.dead, false);
});

test('ordinary .2 and sub-threshold .00001 fractions walk at real speed, never snap', () => {
  for (const distance of [.2, .00001]) for (const sign of [-1, 1]) {
    const { G, c, home } = fresh(); c.x = 80 + sign * distance;
    const x = c.x, before = stock(G);
    assert(G.tryWarmthJourney(c)); assert.equal(c.state, 'walk'); assert.equal(c.x, x);
    const dt = distance / (G.moveSpeed(c) * 4), cold = c.cold;
    G.stepCitizen(c, dt);
    assert(Math.abs(c.x - 80) > distance / 2, 'cannot finish a fraction without travel time');
    near(Math.abs(c.x - x), G.moveSpeed(c) * dt);
    assert(!G.atWarmthHome(c, home) || distance < .0001); // Existing warmth threshold is unchanged.
    assert(c.cold >= cold); assert.equal(stock(G), before);
    until(G, c, () => c.state === 'warmth'); assert.equal(c.x, 80); assert.equal(c.y, 56);
  }
});

test('blocked same-cell endpoints never authorize a route, heating, or resource changes', () => {
  const { G, w, c, home } = fresh(); c.x = 80.00000000000001; surround(G, home);
  assert.equal(G.findPathToAny(w, c.x, c.y, [{ x: 80, y: 56 }]), null);
  const before = stock(G), cold = c.cold; c.state = 'rest'; c.camped = false;
  assert(!G.tryWarmthJourney(c)); G.stepCitizen(c, .1);
  assert(!G.atWarmthHome(c, home)); assert(c.cold > cold); assert.equal(stock(G), before);
});

test('a route becoming water after dispatch cannot complete the tiny last segment', () => {
  const { G, c, home } = fresh(); c.x = 80.00000000000001;
  assert(G.tryWarmthJourney(c)); const x = c.x, before = stock(G), cold = c.cold;
  surround(G, home); G.stepCitizen(c, .1);
  assert.equal(c.x, x); assert(!G.atWarmthHome(c, home)); assert(!c.warmthJourney);
  assert(c.cold > cold); assert.equal(stock(G), before);
});

test('wrong or replaced home identity grants no heat or household meal consumption', () => {
  for (const replaced of [false, true]) {
    const { G, w, c, home, f, build } = fresh();
    G.enablePhysicalSupplyPrototype(); c.lastMealDay = G.game.day;
    const own = build('house', 90, 57); own.family = f.id; own.unheated = false;
    G.withdrawResource('grain', 4); G.supplyStock(home).grain = 4;
    if (replaced) w.bmap[home.id] = { ...home }; else { home.family = null; f.houseId = own.id; }
    surround(G, replaced ? home : own); c.state = 'rest'; c.camped = false;
    const before = stock(G), cold = c.cold;
    assert(!G.atWarmthHome(c, home)); assert(!G.atMealTarget(c, home));
    assert(!G.tryWarmthJourney(c)); G.stepCitizen(c, .1);
    assert(c.cold > cold); assert.equal(stock(G), before);
  }
});

test('observed Harsh cutter 73.99999999999996,63 fetches only after exact physical arrival', () => {
  const { G, c, f, build } = fresh();
  c.age = 30; c.adult = true; c.cold = 0; f.houseId = null;
  c.x = 73.99999999999996; c.y = 63;
  const b = build('woodcutter', 70, 65); c.job = b.id; b.workers = [c.id];
  G.requestTask(c); const t = c.task;
  assert.equal(t.kind, 'fuel'); assert.equal(t.phase, 'fetch'); assert.equal(t.tx, 74); assert.equal(t.ty, 63);
  assert.equal(c.state, 'walk'); assert.equal(c.path.length, 1); assert.equal(G.game.res.wood, 200);
  const x = c.x; G.stepCitizen(c, 0); assert.equal(c.x, x); assert.equal(G.game.res.wood, 200);
  G.stepCitizen(c, .1); assert.equal(c.x, 74); assert.equal(G.game.res.wood, 200);
  assert.equal(t.workLeft, t.work);
  until(G, c, () => !!c.carry?.fuelInput); const cargo = c.carry;
  assert.equal(cargo.qty, 2); assert.equal(G.game.res.wood, 198); G.setWorkerLimit(b, 0);
  until(G, c, () => !c.carry && !c.job); assert.equal(G.game.res.firewood, 6); assert.equal(G.game.res.wood, 198);
});

test('real input cargo and paused work survive an epsilon warmth stop and resume once', () => {
  const { G, c, build } = fresh(); c.age = 30; c.adult = true; c.cold = 0;
  const b = build('woodcutter', 70, 65); c.job = b.id; b.workers = [c.id]; G.requestTask(c);
  until(G, c, () => c.task?.phase === 'process' && c.state === 'work');
  const t = c.task, cargo = c.carry, left = t.workLeft, before = stock(G);
  c.x = 80.00000000000001; c.y = 56; c.cold = .5;
  assert(G.tryWarmthJourney(c)); until(G, c, () => !c.warmthJourney);
  assert.equal(c.task, t); assert.equal(c.pausedTask, null); assert.equal(c.carry, cargo);
  assert.equal(t.workLeft, left); assert.equal(stock(G), before);
  G.setWorkerLimit(b, 0); until(G, c, () => !c.carry && !c.job);
  assert.equal(G.game.res.firewood, 6); assert.equal(G.game.res.wood, 198);
});

test('haul at an epsilon storage edge waits for physical arrival and deposits exactly once', () => {
  const { G, c, f } = fresh(); c.cold = 0; f.houseId = null; c.x = 73.99999999999996; c.y = 63;
  const cargo = { type: 'stone', qty: 3, staffingReturn: true }; c.carry = cargo;
  const stone = G.game.res.stone; G.startHaul(c);
  assert.equal(c.state, 'haul'); assert.equal(c.carry, cargo); assert.equal(G.game.res.stone, stone);
  G.stepCitizen(c, 0); assert.equal(c.carry, cargo);
  G.stepCitizen(c, .1); assert.equal(c.x, 74); assert.equal(c.carry, null); assert.equal(G.game.res.stone, stone + 3);
  for (let i = 0; i < 4; i++) G.stepCitizen(c, .1);
  assert.equal(G.game.res.stone, stone + 3);
});

test('physical meal at the epsilon home corner waits for arrival and full eating duration', () => {
  const { G, c, home } = fresh(); G.enablePhysicalSupplyPrototype(); c.x = 80.00000000000001;
  G.withdrawResource('grain', 4); G.supplyStock(home).grain = 4;
  c.cold = 0; c.lastMealDay = null;
  assert(G.tryMealJourney(c, true)); assert.equal(c.state, 'walk');
  const grain = home.supplyStock.grain; G.stepCitizen(c, .1);
  assert.equal(c.x, 80); assert.equal(home.supplyStock.grain, grain); assert.equal(c.mealJourney.remaining, G.MEAL_HOURS);
  until(G, c, () => !c.mealJourney);
  assert.equal(c.lastMealDay, G.game.day); near(home.supplyStock.grain, grain - G.LIFE.eatPerDay);
  const after = home.supplyStock.grain; G.stepCitizen(c, .1); assert.equal(home.supplyStock.grain, after);
});
console.log(`Exact door arrival: ${passed} passed, ${failed} failed; source ${loadGame(root).testSourceHash}`);
if (failed) process.exitCode = 1;
