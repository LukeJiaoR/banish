'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadGame } = require('./helpers/playability');
let passed = 0;
function fresh() {
  const G = loadGame(path.resolve(__dirname, '..'));
  G.newGame(2685766889);
  const w = G.world;
  for (const k of ['water', 'rock', 'road']) w[k].fill(0);
  w.bgrid.fill(-1); w.treeIdx.fill(-1); w.trees = []; w.buildings = []; w.bmap = {};
  w.citizens = []; w.cmap = {}; w.families = []; w.marked.clear(); w.markedRocks.clear();
  G.bumpNavigation(w); G.game.h = 12; G.rng = () => .5;
  G.addBuilding('storage', 2, 2, { instant: true, free: true });
  for (const k of G.RES_KEYS) G.game.res[k] = 0;
  Object.assign(G.game.res, { tools: 30, grain: 500, food: 500 });
  return G;
}
const person = (G, x = 10, y = 10) => G.spawnCitizen({ x, y, age: 30, sex: 'm' });
const site = (G, x = 12, y = 10) => {
  // Plans require stock at placement but do not reserve it; another site may consume it.
  const stock = { ...G.game.res }, schedule = G.scheduleJobs;
  Object.assign(G.game.res, { wood: Math.max(16, stock.wood), stone: Math.max(8, stock.stone) });
  G.scheduleJobs = () => {};
  const r = G.addBuilding('house', x, y);
  G.scheduleJobs = schedule; Object.assign(G.game.res, stock);
  assert(r.ok, r.reason); G.scheduleJobs(); return r.b;
};
function until(G, done, limit = 10000) { for (let i = 0; i < limit && !done(); i++) for (const c of G.world.citizens) G.stepCitizen(c, .1); assert(done(), 'expected physical progress'); }
function test(name, fn) { fn(); passed++; console.log('ok ' + name); }

test('a material-starved site never captures free adults or repeatedly steals a productive forester', () => {
  const G = fresh();
  const f = G.addBuilding('forester', 25, 20, { instant: true, free: true }).b;
  for (let x = 23; x < 30; x++) G.addTree(G.world, x, 17, -100);
  const people = [person(G, 24, 20), person(G, 24, 21), person(G, 24, 22)];
  const b = site(G);
  for (let i = 0; i < 20; i++) G.scheduleJobs();
  assert.equal(b.workers.length, 0);
  assert(people.some(c => c.job === f.id), 'raw-log production remains staffed');
  assert.equal(b.sitePaused, undefined); assert.equal(b.progress, 0);
});

test('old idle assignments release while player priority and productive worker limits survive', () => {
  const G = fresh(), b = site(G), c = person(G);
  c.job = b.id; b.workers.push(c.id); c.task = null; c.pausedTask = null; c.carry = null; c.state = 'idle';
  G.setConstructionPriority(b, true);
  G.scheduleJobs();
  assert.equal(c.job, null); assert.equal(b.workers.length, 0); assert.equal(b.sitePriority, true);
  const f = G.addBuilding('forester', 25, 20, { instant: true, free: true }).b;
  G.releaseWorker(c); G.setWorkerLimit(f, 0); G.scheduleJobs(); assert.equal(f.workerLimit, 0); assert.equal(f.workers.length, 0);
});

test('partial material can be delivered, then empty workers release and automatically resume when logs arrive', () => {
  const G = fresh(), c = person(G), b = site(G);
  G.game.res.stone = 8; G.scheduleJobs();
  until(G, () => b.construction.onsite.stone === 8);
  G.scheduleJobs(); assert.equal(b.workers.length, 0); assert.equal(c.job, null);
  assert.equal(b.progress, 0); assert.equal(G.game.res.stone, 0);
  G.game.res.wood = 16; G.scheduleJobs();
  until(G, () => b.state === 'ok');
  assert.equal(G.game.res.wood, 0); assert.equal(b.construction.consumed, true);
});

test('a high-priority missing-material site cannot interrupt an active stocked site', () => {
  const G = fresh(); Object.assign(G.game.res, { wood: 16, stone: 8 });
  const c = person(G), a = site(G);
  until(G, () => c.task?.kind === 'build' && c.state === 'work');
  const task = c.task, b = site(G, 20, 10); G.setConstructionPriority(b, true);
  G.scheduleJobs(); assert.equal(c.task, task);
  until(G, () => a.state === 'ok');
  assert.equal(b.workers.length, 0); assert.equal(b.progress, 0); assert.equal(b.sitePriority, true);
});

test('site clearing and live material cargo remain real work even with no warehouse stock', () => {
  const G = fresh(); G.addTree(G.world, 12, 10, -100);
  const c = person(G), b = site(G); assert.equal(c.task.kind, 'clearSite');
  const task = c.task; G.scheduleJobs(); assert.equal(c.task, task); assert.equal(c.job, b.id);
  until(G, () => G.siteTrees(b).length === 0 && !c.carry);
  G.game.res.wood = 16; G.scheduleJobs(); until(G, () => G.constructionCargo(c));
  const cargo = c.carry, active = c.task; G.game.res.wood = 0; G.scheduleJobs();
  assert.equal(c.carry, cargo); assert.equal(c.task, active); assert.equal(c.job, b.id);
  until(G, () => !c.carry); G.scheduleJobs(); assert.equal(c.job, null);
});

test('unreachable materials cannot pull a worker off production and opening the route re-enables staffing', () => {
  const G = fresh(), c = person(G, 20, 10), b = site(G, 24, 10);
  Object.assign(G.game.res, { wood: 16, stone: 8 });
  for(let y = 0; y < G.world.N; y++) G.world.water[y * G.world.N + 15] = 1;
  G.bumpNavigation(G.world); G.scheduleJobs();
  assert.equal(c.job, null); assert.equal(b.workers.length, 0);
  G.world.water[10 * G.world.N + 15] = 0; G.bumpNavigation(G.world); G.scheduleJobs();
  assert.equal(c.job, b.id); assert.equal(c.task.kind, 'constructionMaterial');
});

test('in-transit materials do not capture extra workers; live and overnight carriers retain ownership', () => {
  const G = fresh(), c = person(G), b = site(G);
  G.game.res.wood = 16; G.scheduleJobs(); until(G, () => G.constructionCargo(c));
  const spare = person(G, 20, 10), cargo = c.carry;
  G.game.h = 23; G.goHome(c); const paused = c.pausedTask;
  G.scheduleJobs(); assert.equal(spare.job, null); assert.equal(c.job, b.id);
  assert.equal(c.carry, cargo); assert.equal(c.pausedTask, paused);
  G.game.h = 12; assert(G.resumeTask(c)); until(G, () => !c.carry);
  G.scheduleJobs(); assert.equal(b.workers.length, 0);
});

test('stone-road work releases when stone is absent while dirt roads remain actionable', () => {
  for(const surface of ['stone', 'dirt']) {
    const G = fresh(), c = person(G), schedule = G.scheduleJobs;
    G.game.res.stone = 20; G.scheduleJobs = () => {};
    const q = G.addRoadWork([12,13,14,15].map(x => ({x,y:10})),surface);
    G.scheduleJobs = schedule; G.game.res.stone = 0;
    assert(q.ok, q.reason); G.scheduleJobs();
    assert.equal(c.job, surface === 'dirt' ? q.b.id : null);
  }
});

test('dirt road cells remain actionable when their material staging point is blocked', () => {
  const G = fresh(), c = person(G), schedule = G.scheduleJobs;
  G.scheduleJobs = () => {};
  const q = G.addRoadWork([12,13,14].map(x => ({x,y:10})), 'dirt');
  G.scheduleJobs = schedule; assert(q.ok);
  G.world.water[10 * G.world.N + 12] = 1; G.bumpNavigation(G.world);
  G.scheduleJobs(); assert.equal(c.job, q.b.id); assert.equal(c.task.kind, 'roadPave');
  until(G, () => q.b.roadWork.cells[1].done && q.b.roadWork.cells[2].done);
  assert.equal(q.b.roadWork.cells[0].done, false);
});

test('a fully supplied in-transit site keeps its waiting crew instead of churning household assignments', () => {
  const G = fresh(), c = person(G), b = site(G);
  // Stone is already delivered; the only remaining requirement is owned by a carrier.
  b.construction.onsite.stone = 8; G.game.res.wood = 16; G.scheduleJobs();
  until(G, () => G.constructionCargo(c));
  const spare = person(G, 20, 10); G.scheduleJobs();
  assert.equal(spare.job, b.id); assert.equal(c.job, b.id);
  const workers = [...b.workers]; G.scheduleJobs(); assert.deepEqual([...b.workers], workers);
  until(G, () => b.state === 'ok'); assert.equal(b.construction.consumed, true);
});

console.log(`Construction staffing: ${passed} passed`);
