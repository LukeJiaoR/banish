/* Harvest cancellation regressions: synthetic state fixtures and save round trips.
 * Run: node tests/harvest-cancellation.js [checkout]
 * These are not browser or survival-economy acceptance tests.
 */
'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadGame } = require('./helpers/playability');
const G = loadGame(path.resolve(process.argv[2] || path.join(__dirname, '..')));
let passed = 0, failed = 0;
const plain = value => JSON.parse(JSON.stringify(value));
function fresh() {
  const N = 32;
  G.world = { seed: 1, N, water: new Uint8Array(N * N), rock: new Uint8Array(N * N), road: new Uint8Array(N * N),
    bgrid: new Int32Array(N * N).fill(-1), treeIdx: new Int32Array(N * N).fill(-1), trees: [], rockCleared: [],
    marked: new Set(), markedRocks: new Set(), buildings: [], bmap: {}, citizens: [], cmap: {}, families: [], start: { x: 3, y: 3 } };
  G.game = G.newGameState(); G.game.h = 12; G.rng = G.makeRng(19);
}
function test(name, fn) {
  fresh();
  try { fn(); passed++; console.log('ok ' + name); }
  catch (error) { failed++; console.error('FAIL ' + name + '\n' + error.stack); }
}
function adult(x = 2, y = 2, props = {}) { return Object.assign(G.spawnCitizen({ x, y, age: 30, sex: 'm' }), props); }
function target(kind, x = 4, y = 4, value = 1) {
  const w = G.world, i = y * w.N + x;
  if (kind === 'trees') { G.addTree(w, x, y, -200); G.markFellAt(w, x, y); }
  else { w.rock[i] = value; G.markRockAt(w, x, y); }
  return { x, y, i };
}
function marks(kind) { return kind === 'trees' ? G.world.marked : G.world.markedRocks; }
function claim(kind, p, b = null) {
  return { kind: kind === 'trees' ? 'chop' : 'clearrock', b, tx: p.x, ty: p.y, work: kind === 'trees' ? G.PROD.forester.workH : G.ROCK_WORK, workLeft: 2,
    ...(kind === 'trees' ? { tree: G.world.trees[G.world.treeIdx[p.i]], logs: 3 } : { rock: G.world.rock[p.i] }) };
}
function building(type = 'storage', x = 20, y = 20, state = 'ok') {
  const def = G.BDEF[type], b = { id: G.nextId(), type, x, y, w: def.w, h: def.h, state, workers: [], family: null };
  G.world.buildings.push(b); G.world.bmap[b.id] = b;
  for (let yy = y; yy < y + b.h; yy++) for (let xx = x; xx < x + b.w; xx++) G.world.bgrid[yy * G.world.N + xx] = b.id;
  return b;
}
function home(c) {
  const h = building('house', 1, 1), f = { id: G.nextId(), members: [c.id], houseId: h.id, coupleIds: [] };
  G.world.families.push(f); c.familyId = f.id; h.family = f.id;
}
function resourceSnapshot() { return plain({ res: G.game.res, trees: G.world.trees, rock: Array.from(G.world.rock), rockCleared: G.world.rockCleared }); }
function jobsValid() {
  const assigned = new Set();
  for (const b of G.world.buildings) for (const id of b.workers) {
    assert.ok(!assigned.has(id), 'worker belongs to only one building'); assigned.add(id);
    assert.equal(G.world.cmap[id].job, b.id);
  }
  for (const c of G.world.citizens) if (c.job != null) assert.ok(assigned.has(c.id));
}

for (const kind of ['trees', 'rocks']) {
  const other = kind === 'trees' ? 'rocks' : 'trees';
  test(kind + ': queued and stale marks clear without changing resources or the other class', () => {
    target(kind); target(kind, 5, 5); target(other, 7, 7); marks(kind).add(0);
    const before = resourceSnapshot(); G.world.markReachability = { count: 3, unreachable: 1, total: 4 };
    assert.deepEqual(plain(G.cancelResourceMarks(kind)), { marks: 3, active: 0, paused: 0 });
    assert.equal(marks(kind).size, 0); assert.equal(marks(other).size, 1);
    assert.deepEqual(resourceSnapshot(), before); assert.equal(G.world.markReachability, null);
    assert.deepEqual(plain(G.cancelResourceMarks(kind)), { marks: 0, active: 0, paused: 0 });
  });
  test(kind + ': work and en-route claims stop in place with no refund or completion', () => {
    const a = adult(2.25, 2.5), b = adult(6, 6);
    a.task = claim(kind, target(kind)); b.task = claim(kind, target(kind, 6, 6));
    a.path = [{ x: 3, y: 3 }, { x: 4, y: 4 }]; a.pi = 1; a.walkKind = 'task'; a.state = 'walk'; b.state = 'work';
    const tasks = [a.task, b.task], before = resourceSnapshot(); G.game.paused = true;
    assert.deepEqual(plain(G.cancelResourceMarks(kind)), { marks: 2, active: 2, paused: 0 });
    for (const c of [a, b]) { assert.equal(c.task, null); assert.equal(c.state, 'idle'); assert.equal(c.path, null); assert.equal(c.pi, 0); assert.equal(c.walkKind, ''); assert.equal(c.carry, null); }
    assert.deepEqual([a.x, a.y, b.x, b.y], [2.25, 2.5, 6, 6]);
    assert.deepEqual(tasks.map(t => t.workLeft), [2, 2]); assert.deepEqual(resourceSnapshot(), before); assert.equal(G.game.paused, true);
    G.stepCitizen(a, 0.1); G.stepCitizen(b, 0.1); assert.deepEqual(resourceSnapshot(), before);
  });
  test(kind + ': clearing paused claims preserves sleeping and nighttime home routes', () => {
    const sleeper = adult(10, 10), walker = adult(6, 4); home(walker);
    sleeper.task = claim(kind, target(kind, 10, 10)); walker.task = claim(kind, target(kind, 6, 4));
    G.game.h = 23; G.goHome(sleeper); G.goHome(walker);
    assert.equal(sleeper.state, 'rest'); assert.equal(walker.walkKind, 'home'); assert.equal(walker.state, 'walk');
    const state = plain([sleeper, walker]), route = walker.path;
    assert.deepEqual(plain(G.cancelResourceMarks(kind)), { marks: 2, active: 0, paused: 2 });
    assert.equal(sleeper.pausedTask, null); assert.equal(walker.pausedTask, null);
    assert.equal(sleeper.state, state[0].state); assert.equal(sleeper.camped, state[0].camped);
    assert.equal(walker.state, state[1].state); assert.equal(walker.walkKind, 'home'); assert.equal(walker.path, route); assert.equal(walker.pi, state[1].pi);
    G.stepCitizen(sleeper, 1); assert.equal(sleeper.state, 'rest'); assert.equal(sleeper.task, null);
    G.game.h = 7; G.stepCitizen(sleeper, 0.1); assert.equal(sleeper.task, null); assert.equal(sleeper.pausedTask, null);
  });
  test(kind + ': same-class orphan claims clear even without markers and repeated calls are inert', () => {
    const p = target(kind), c = adult(); c.task = claim(kind, p); c.pausedTask = c.task; c.state = 'work'; marks(kind).clear();
    assert.deepEqual(plain(G.cancelResourceMarks(kind)), { marks: 0, active: 1, paused: 0 });
    assert.equal(c.task, null); assert.equal(c.pausedTask, null);
    const before = plain(c); assert.deepEqual(plain(G.cancelResourceMarks(kind)), { marks: 0, active: 0, paused: 0 }); assert.deepEqual(plain(c), before);
  });
  test(kind + ': another resource and building-owned jobs keep their claims and routes', () => {
    const p = target(kind), q = target(other, 8, 8), forester = building('forester'), site = building('house', 24, 24, 'site');
    const own = adult(), elsewhere = adult(), independent = adult(), clearing = adult();
    own.task = claim(kind, p); own.state = 'work'; elsewhere.task = claim(other, q); elsewhere.state = 'work';
    independent.task = claim(kind, p, forester); independent.pausedTask = independent.task; independent.job = forester.id; forester.workers.push(independent.id);
    const t = target('trees', 25, 27); clearing.task = { kind: 'clearSite', b: site, tree: G.world.trees[G.world.treeIdx[t.i]], workLeft: 11 }; clearing.job = site.id; site.workers.push(clearing.id);
    const before = plain([elsewhere, independent, clearing]);
    G.cancelResourceMarks(kind); assert.equal(own.task, null); assert.deepEqual(plain([elsewhere, independent, clearing]), before); jobsValid();
  });
  test(kind + ': harvested cargo finishes its existing trip exactly once', () => {
    building(); const p = target(kind, 3, 3, 2), c = adult(3, 3); c.task = claim(kind, p); c.state = 'work';
    G.completeTask(c); assert.equal(c.state, 'haul'); assert.ok(c.carry);
    const cargo = c.carry, route = c.path, type = cargo.type, qty = cargo.qty, before = G.game.res[type];
    target(kind, 5, 5); assert.deepEqual(plain(G.cancelResourceMarks(kind)), { marks: 1, active: 0, paused: 0 });
    assert.equal(c.carry, cargo); assert.equal(c.path, route); assert.equal(c.state, 'haul'); assert.equal(G.game.res[type], before);
    for (let n = 0; n < 200 && c.carry; n++) G.stepCitizen(c, 0.5);
    assert.equal(c.carry, null); assert.equal(G.game.res[type], before + qty);
    G.cancelResourceMarks(kind); for (let n = 0; n < 20; n++) G.stepCitizen(c, 0.5);
    assert.equal(G.game.res[type], before + qty);
  });
  test(kind + ': carry is preserved in rest, home, haul and idle when a paused claim is cancelled', () => {
    const p = target(kind), people = [];
    for (const [state, walkKind] of [['rest', ''], ['walk', 'home'], ['haul', ''], ['idle', '']]) {
      const c = adult(5, 5, { state, walkKind, carry: { type: 'wood', qty: 3 }, pausedTask: claim(kind, p), path: [{ x: 4, y: 4 }], pi: 0, haulTo: 77 });
      people.push(c);
    }
    const before = plain(people), resources = plain(G.game.res);
    G.cancelResourceMarks(kind);
    assert.deepEqual(plain(people), before.map(c => ({ ...c, pausedTask: null }))); assert.deepEqual(plain(G.game.res), resources);
  });
  test(kind + ': a removed mark cannot resume after sleep; a still-marked target can', () => {
    const p = target(kind), c = adult(); c.pausedTask = claim(kind, p); c.state = 'rest'; marks(kind).clear();
    assert.equal(G.resumeTask(c), false); assert.equal(c.task, null); assert.equal(c.pausedTask, null); assert.equal(c.state, 'rest');
    marks(kind).add(p.i); c.pausedTask = claim(kind, p); assert.equal(G.resumeTask(c), true); assert.equal(c.task.workLeft, 2);
  });
  test(kind + ': re-marking starts new work and never creates duplicate claims', () => {
    const p = target(kind), a = adult(), b = adult(); a.task = claim(kind, p); a.state = 'work'; G.cancelResourceMarks(kind);
    marks(kind).add(p.i); G.requestTask(a); G.requestTask(b);
    assert.ok(a.task); assert.equal(a.task.workLeft, 0); assert.ok(a.task.work > 2); assert.equal(b.task, null);
    a.x = a.task.tx; a.y = a.task.ty; G.arrive(a); assert.equal(a.task.workLeft, a.task.work); jobsValid();
  });
}

test('invalid kind and missing world do not touch anything', () => {
  target('trees'); target('rocks', 6, 6); const w = G.world, before = resourceSnapshot();
  for (const kind of ['all', '', null, undefined]) assert.deepEqual(plain(G.cancelResourceMarks(kind)), { marks: 0, active: 0, paused: 0 });
  assert.equal(w.marked.size, 1); assert.equal(w.markedRocks.size, 1); assert.deepEqual(resourceSnapshot(), before);
  G.world = null; try { assert.deepEqual(plain(G.cancelResourceMarks('trees')), { marks: 0, active: 0, paused: 0 }); } finally { G.world = w; }
});
test('cancellation preserves both resource classes when old fixtures lack marker sets', () => {
  delete G.world.marked; delete G.world.markedRocks;
  assert.deepEqual(plain(G.cancelResourceMarks('trees')), { marks: 0, active: 0, paused: 0 });
  assert.deepEqual(plain(G.cancelResourceMarks('rocks')), { marks: 0, active: 0, paused: 0 });
});
test('independent forester resumes without a player mark but invalid trees and rocks cannot', () => {
  const p = target('trees'), b = building('forester'), c = adult(); b.workers.push(c.id); c.job = b.id;
  c.pausedTask = claim('trees', p, b); G.world.marked.clear(); assert.equal(G.resumeTask(c), true); assert.equal(c.task.workLeft, 2);
  c.task = null; c.pausedTask = claim('trees', p, b); G.removeTree(G.world, p.x, p.y); assert.equal(G.resumeTask(c), false);
  const r = target('rocks', 7, 7); c.job = null; c.pausedTask = claim('rocks', r); G.world.rock[r.i] = 0; assert.equal(G.resumeTask(c), false);
});
test('cancelling a paused tree claim does not interrupt a different active rock route', () => {
  const t = target('trees'), r = target('rocks', 8, 8), c = adult();
  c.pausedTask = claim('trees', t); c.task = claim('rocks', r); G.sendTo(c, r.x, r.y);
  const task = c.task, route = c.path, before = plain(c);
  assert.deepEqual(plain(G.cancelResourceMarks('trees')), { marks: 1, active: 0, paused: 1 });
  assert.equal(c.task, task); assert.equal(c.path, route); assert.deepEqual(plain(c), { ...before, pausedTask: null });
});
test('task origin controls cancellation without changing any existing job ownership', () => {
  const p = target('trees'), c = adult(), dock = building('dock', 8, 8);
  dock.workers.push(c.id); c.job = dock.id; c.task = claim('trees', p); delete c.task.b; c.state = 'work';
  G.cancelResourceMarks('trees'); assert.equal(c.task, null); assert.equal(c.job, dock.id); jobsValid();
});
test('cancelling an active night worker waits for the normal sleep transition', () => {
  const p = target('trees'), c = adult(); c.task = claim('trees', p); c.state = 'work'; G.game.h = 23;
  G.cancelResourceMarks('trees'); assert.equal(c.task, null); assert.equal(c.state, 'idle');
  G.stepCitizen(c, 0.5); assert.equal(c.state, 'rest'); assert.equal(c.task, null); assert.equal(c.pausedTask, null);
});
test('cancelled labor is available at the next normal scheduler pass without forced reassignment', () => {
  const c = adult(), dock = building('dock', 4, 6); const p = target('trees', 5, 4); c.task = claim('trees', p); c.state = 'work';
  G.scheduleJobs(); assert.equal(c.job, null); assert.equal(dock.workers.length, 0);
  const timer = G.game.schedT; G.cancelResourceMarks('trees'); assert.equal(c.job, null); assert.equal(G.game.schedT, timer); assert.equal(dock.workers.length, 0);
  G.scheduleJobs(); assert.equal(c.job, dock.id); assert.deepEqual(Array.from(dock.workers), [c.id]); jobsValid();
  for (let n = 0; n < 3; n++) { G.scheduleJobs(); jobsValid(); }
});
test('save/load retains cancelled intent, remaining marks, unfinished resources and existing cargo', () => {
  G.newGame(44); const w = G.world; G.game.h = 12; const t = w.trees[0], i = w.rock.findIndex(value => value > 0);
  G.markFellAt(w, t.x, t.y); G.markRockAt(w, i % w.N, Math.floor(i / w.N));
  const c = w.citizens.find(c => c.adult); c.job = null; c.task = claim('trees', { x: t.x, y: t.y, i: t.i }); c.state = 'work';
  c.carry = { type: 'wood', qty: 3 }; const totalWood = G.game.res.wood + c.carry.qty;
  G.cancelResourceMarks('trees'); const save = plain(G.serializeGame());
  assert.deepEqual(save.marked, []); assert.ok(save.markedRocks.includes(i)); assert.ok(save.trees.some(row => row[0] === t.i));
  G.applySaveData(save); const loaded = G.world.cmap[c.id];
  assert.equal(G.world.marked.size, 0); assert.ok(G.world.markedRocks.has(i)); assert.ok(G.world.treeIdx[t.i] >= 0);
  assert.ok(!loaded.task || loaded.task.kind === 'clearrock', 'load may finish delivery and pick remaining rock work, never the cancelled tree'); assert.equal(loaded.pausedTask, null);
  assert.equal(G.game.res.wood + (loaded.carry ? loaded.carry.qty : 0), totalWood);
  G.cancelResourceMarks('rocks'); G.applySaveData(plain(G.serializeGame()));
  assert.equal(G.world.marked.size, 0); assert.equal(G.world.markedRocks.size, 0); assert.ok(G.world.rock[i]);
});
console.log(`Harvest cancellation: ${passed} passed, ${failed} failed (headless state/save fixtures).`);
process.exitCode = failed ? 1 : 0;
