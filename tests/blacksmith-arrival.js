'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const {loadGame} = require('./helpers/playability');
const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));
let passed = 0;

function fresh(withStorage = true) {
  const G = loadGame(root); G.newGame(1);
  const w = G.world;
  for (const key of ['water', 'rock', 'road']) w[key].fill(0);
  w.bgrid.fill(-1); w.treeIdx.fill(-1);
  for (const key of ['trees', 'buildings', 'citizens', 'families']) w[key] = [];
  w.bmap = {}; w.cmap = {}; w.marked.clear(); w.markedRocks.clear();
  G.bumpNavigation(w); G.game.h = 12; G.rng = () => .5;
  const storage = withStorage ? G.addBuilding('storage', 2, 2, {instant:true, free:true}).b : null;
  const forge = G.addBuilding('blacksmith', 22, 10, {instant:true, free:true}).b;
  assert(forge && (!withStorage || storage));
  Object.assign(G.game.res, {wood:200, iron:100, coal:40, tools:0, steelTools:0});
  return {G, w, storage, forge};
}
function assign(G, forge, x, y) {
  const c = G.spawnCitizen({x, y, age:30, sex:'m'});
  c.job = forge.id; forge.workers = [c.id]; G.requestTask(c);
  assert.equal(c.task?.kind, 'smith');
  return c;
}
function until(G, c, done, limit = 10000) {
  for (let i = 0; i < limit && !done(); i++) G.stepCitizen(c, .02);
  assert(done(), 'real blacksmith task failed to progress');
}
function near(a, b) { assert(Math.abs(a - b) < 1e-7, `${a} != ${b}`); }
function test(name, run) { run(); passed++; console.log('ok ' + name); }

test('fractional warehouse arrivals walk the last segment for both recipes and eight directions', () => {
  const offsets = [[.4,0],[-.4,0],[0,.4],[0,-.4],[.35,.35],[.35,-.35],[-.35,.35],[-.35,-.35]];
  for (const recipe of ['iron', 'steel']) for (const [dx, dy] of offsets) {
    const {G, forge} = fresh(); G.setToolRecipe(forge, recipe);
    const c = assign(G, forge, 1 + dx, 3 + dy), task = c.task;
    assert.equal(task.phase, 'fetch'); assert.equal(c.state, 'walk');
    assert.equal(c.path.length, 1); assert.equal(c.path[0].x, 1); assert.equal(c.path[0].y, 3);
    assert.equal(G.game.res.wood, 200); assert.equal(G.game.res.iron, 100);
    const initial = {x:c.x, y:c.y}, left = task.workLeft;
    let searches = 0; const find = G.findPath;
    G.findPath = (...args) => { searches++; return find(...args); };
    G.stepCitizen(c, .01);
    assert(G.dist(initial.x, initial.y, c.x, c.y) > 0);
    assert(G.dist(initial.x, initial.y, c.x, c.y) <= G.moveSpeed(c) * .01 + 1e-9);
    assert.equal(task.workLeft, left); assert.equal(c.carry, null);
    assert.equal(G.game.res.wood, 200); assert.equal(G.game.res.iron, 100);
    until(G, c, () => c.state === 'work');
    near(c.x, 1); near(c.y, 3); assert.equal(searches, 0);
    assert.equal(c.carry, null); assert.equal(task.workLeft, left);
    until(G, c, () => c.carry?.smithInput);
    assert.equal(G.game.res.wood, 198); assert.equal(G.game.res.iron, 99);
    assert.equal(G.game.res.coal, recipe === 'steel' ? 38 : 40);
    assert.equal(searches, 1, 'one return route after actual pickup');
    G.setWorkerLimit(forge, 0);
    until(G, c, () => !c.carry && c.job === null);
    assert.equal(G.game.res[recipe === 'steel' ? 'steelTools' : 'tools'], 2);
    assert.equal(G.game.res.wood, 198); assert.equal(G.game.res.iron, 99);
  }
});

for (const phase of ['fetch', 'process']) test(`night interruption in the final ${phase} segment resumes the same task and cargo`, () => {
  const {G, forge} = fresh(), c = assign(G, forge, 10, 8);
  until(G, c, () => c.task?.phase === phase && c.state === 'walk' &&
    G.d2(c.x, c.y, c.task.tx, c.task.ty) > .04 && G.d2(c.x, c.y, c.task.tx, c.task.ty) < .20);
  const task = c.task, cargo = c.carry, left = task.workLeft, stock = {...G.game.res}, position = {x:c.x, y:c.y};
  G.game.h = 22; G.stepCitizen(c, .02);
  assert.equal(c.state, 'rest'); assert.equal(c.pausedTask, task); assert.equal(c.carry, cargo);
  near(c.x, position.x); near(c.y, position.y);
  G.game.h = 6; G.stepCitizen(c, .02);
  assert.equal(c.task, task); assert.equal(c.state, 'walk'); assert.equal(c.path.length, 1);
  assert.equal(c.carry, cargo); assert.equal(task.workLeft, left);
  assert.deepEqual({...G.game.res}, stock);
  until(G, c, () => c.state === 'work');
  near(c.x, task.tx); near(c.y, task.ty); assert.equal(task.workLeft, left);
  if (phase === 'process') assert.equal(c.carry, cargo);
  G.setWorkerLimit(forge, 0);
  until(G, c, () => c.job === null && !c.carry);
  assert.equal(G.game.res.tools, 2); assert.equal(G.game.res.wood, 198); assert.equal(G.game.res.iron, 99);
});

test('an already-stalled smith recovers by moving, without remote pickup or a per-frame search loop', () => {
  const {G, forge} = fresh(), c = assign(G, forge, 1.4, 3), task = c.task;
  // State produced by the old dispatcher: same rounded cell, empty path, not at the door.
  c.state = 'work'; c.path = []; c.pi = 0;
  let searches = 0; const find = G.findPath;
  G.findPath = (...args) => { searches++; return find(...args); };
  G.stepCitizen(c, .01);
  assert.equal(c.state, 'walk'); assert.equal(c.task, task); near(c.x, 1.4);
  assert.equal(G.game.res.wood, 200); assert.equal(c.carry, null);
  until(G, c, () => c.state === 'work');
  assert.equal(searches, 1); near(c.x, 1); near(c.y, 3);
  until(G, c, () => c.carry?.smithInput);
  assert.equal(searches, 2); assert.equal(G.game.res.wood, 198); assert.equal(G.game.res.iron, 99);
});

test('legacy no-storage fallback also reaches its forge door before taking a batch', () => {
  const {G, forge} = fresh(false); // Historical saves may contain no warehouse.
  assert.equal(G.hasStorageBuilding(), false);
  const c = assign(G, forge, 21.4, 11);
  assert.equal(c.state, 'walk'); assert.equal(c.path.length, 1); assert.equal(c.task.phase, 'fetch');
  const wood = G.game.res.wood, iron = G.game.res.iron;
  until(G, c, () => c.state === 'work');
  near(c.x, 21); near(c.y, 11); assert.equal(G.game.res.wood, wood); assert.equal(G.game.res.iron, iron);
  until(G, c, () => c.carry?.smithInput); G.setWorkerLimit(forge, 0);
  until(G, c, () => c.job === null && !c.carry);
  assert.equal(G.game.res.tools, 2); assert.equal(G.game.res.wood, wood - 2); assert.equal(G.game.res.iron, iron - 1);
});

console.log(`Blacksmith arrival: ${passed} passed`);
