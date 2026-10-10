'use strict';
// Deterministic construction regressions. Native-map cases use only paid game
// actions and normal time/hauling; geometry fixtures are labelled separately.
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadGame } = require('./helpers/playability');
const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));
let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('ok ' + name); }
  catch (error) { failed++; console.error('FAIL ' + name + '\n' + error.stack); }
}
function game(seed = 11) { const G = loadGame(root); G.newGame(seed); return G; }
function advance(G, hours) { for (let n = 0; n < hours * 4 && !G.game.over; n++) G.advanceSim(.25); }
function wall(G) {
  const before = {...G.game.res};
  const sites = [33, 35, 37, 39].map(x => {
    const result = G.addBuilding('house', x, 29);
    assert.equal(result.ok, true, result.reason); return result.b;
  });
  assert.equal(before.wood - G.game.res.wood, 64);
  assert.equal(before.stone - G.game.res.stone, 32);
  return sites;
}
function complete(sites) {
  for (const b of sites) {
    assert.equal(b.state, 'ok', `${b.type}@${b.x},${b.y}: ${b.workLeft} hours left`);
    assert.equal(b.progress, 1); assert.ok(b.workLeft <= 0);
  }
}

test('native seed 11: four paid houses finish via their reachable north edges', () => {
  const G = game(), sites = wall(G), w = G.world;
  const c = w.cmap[sites[0].workers[0]];
  const nearest = G.workSpot(w, sites[0], c.x, c.y);
  assert.equal(G.findPath(w, Math.round(c.x), Math.round(c.y), nearest.x, nearest.y), null,
    'the geometrically closest edge is cut off by natural water and paid sites');
  assert.ok(G.findPath(w, Math.round(c.x), Math.round(c.y), 33, 28), 'north edge is reachable');
  advance(G, 12 * 24); complete(sites);
  assert.equal(G.game.stats.died, 0);
});

test('native seed 11: a saved construction queue resumes building without extra materials', () => {
  const G = game(), sites = wall(G);
  // A normal saved site has no serialized active task. Do not invent a completed
  // state or give resources when restoring the construction queue.
  const save = JSON.parse(JSON.stringify(G.serializeGame()));
  G.applySaveData(save);
  assert.equal(G.game.res.wood, 16); assert.equal(G.game.res.stone, 16);
  advance(G, 12 * 24); complete(sites.map(b => G.world.bmap[b.id]));
  assert.equal(G.game.stats.died, 0);
});

test('native seed 11: canceling a paid wall site refunds and keeps remaining sites valid', () => {
  const G = game(), sites = wall(G), removed = sites.splice(1, 1)[0];
  const before = {...G.game.res}; G.removeBuilding(removed);
  assert.equal(G.game.res.wood, before.wood + 16);
  assert.equal(G.game.res.stone, before.stone + 8);
  assert.equal(G.world.bmap[removed.id], undefined);
  advance(G, 12 * 24); complete(sites);
  for (const c of G.world.citizens) {
    assert.notEqual(c.job, removed.id);
    assert.notEqual(c.task && c.task.b, removed);
    assert.notEqual(c.pausedTask && c.pausedTask.b, removed);
  }
});

test('native seed 1: clearing trees, hauling, overnight pauses, and construction all finish', () => {
  const G = game(1), w = G.world, s = w.start;
  let place;
  for (let y = s.y - 8; y <= s.y + 8 && !place; y++) for (let x = s.x - 8; x <= s.x + 8; x++) {
    if (G.canPlace(w, 'house', x, y).ok && G.siteTrees({x, y, w:2, h:2}).length >= 2) { place = {x, y}; break; }
  }
  assert.ok(place);
  const b = G.addBuilding('house', place.x, place.y).b, trees = G.siteTrees(b).length;
  const deposited = G.game.res.wood; let sawClear = false, sawHaul = false, sawBuild = false, sawPause = false;
  for (let n = 0; n < 12 * 24 * 4 && b.state !== 'ok'; n++) {
    for (const c of w.citizens) {
      sawClear ||= c.task?.b === b && c.task.kind === 'clearSite';
      sawHaul ||= c.job === b.id && c.state === 'haul' && c.carry?.type === 'wood';
      sawBuild ||= c.task?.b === b && c.task.kind === 'build';
      sawPause ||= c.pausedTask?.b === b;
    }
    G.advanceSim(.25);
  }
  complete([b]); assert.equal(G.siteTrees(b).length, 0);
  assert.ok(sawClear && sawHaul && sawBuild && sawPause);
  // Every cleared tree still produces and physically delivers the ordinary yield.
  advance(G, 24);
  assert.equal(G.game.res.wood, deposited + trees * G.TREE_LOGS);
});

function geometry() {
  const G = game(), N = 30;
  G.world = { seed:11, N, water:new Uint8Array(N*N), rock:new Uint8Array(N*N),
    road:new Uint8Array(N*N), bgrid:new Int32Array(N*N).fill(-1), treeIdx:new Int32Array(N*N).fill(-1),
    trees:[], rockCleared:[], marked:new Set(), markedRocks:new Set(), buildings:[], bmap:{}, citizens:[], cmap:{}, families:[], start:{x:5,y:10} };
  G.game = G.newGameState();
  const c = G.spawnCitizen({x:5,y:10,age:30,sex:'m'});
  const b = G.addBuilding('house',12,12).b;
  return {G, c, b};
}

test('geometry fixture: completely blocked perimeter does not build from a fallback tile', () => {
  const {G,c,b} = geometry(), w = G.world;
  for (let y=11;y<=14;y++) for (let x=11;x<=14;x++)
    if (x===11 || x===14 || y===11 || y===14) w.water[y*w.N+x]=1;
  G.requestTask(c);
  assert.equal(c.task, null); assert.equal(c.state, 'idle');
  advance(G, 48); assert.equal(b.workLeft, b.totalWork); assert.equal(b.progress, 0);
  // Reopen a real perimeter entry. There is no stale reachability cache.
  w.water[11*w.N+12]=0; G.paintRoad(12,11,12,11); G.requestTask(c);
  assert.equal(c.task.kind, 'build'); assert.equal(c.task.tx,12); assert.equal(c.task.ty,11);
  advance(G, 8*24); complete([b]);
});

test('geometry fixture: unreachable near perimeter yields to a farther reachable entry', () => {
  const {G,c,b} = geometry(), w=G.world;
  c.x=10;c.y=10;
  for (const [x,y] of [[10,11],[11,10],[12,11],[11,12]]) w.water[y*w.N+x]=1;
  const near = G.workSpot(w,b,c.x,c.y);
  assert.equal(near.x,11); assert.equal(near.y,11);
  assert.equal(G.findPath(w,10,10,near.x,near.y),null);
  G.requestTask(c); assert.equal(c.task.kind,'build');
  assert.ok(G.findPath(w,10,10,c.task.tx,c.task.ty));
  advance(G, 8*24); complete([b]);
});

test('geometry fixture: night and job reassignment preserve completed building work', () => {
  const {G,c,b} = geometry();
  for(let i=0;i<200 && b.workLeft===b.totalWork;i++) G.advanceSim(.25);
  assert.ok(b.workLeft < b.totalWork);
  const left = b.workLeft, task = c.task;
  task.workLeft = 1.5; G.goHome(c);
  assert.equal(c.pausedTask, task); assert.equal(G.resumeTask(c), true);
  assert.equal(c.task.workLeft, 1.5); assert.equal(b.workLeft, left);
  G.releaseWorker(c); assert.equal(c.job,null); assert.equal(c.task,null); assert.equal(c.pausedTask,null);
  G.scheduleJobs(); assert.equal(c.job,b.id); assert.equal(b.workLeft,left);
  advance(G,8*24);complete([b]);
});

test('native seed 11: completed construction updates the ordinary selected building panel', () => {
  const G = game(), sites = wall(G), b=sites[0];
  global.window=global;global.G=G;
  global.document={getElementById(){return {addEventListener(){}};}};
  require(path.join(root,'js/ui.js'));
  const info={innerHTML:'',querySelectorAll(){return [];}};
  G.ui.el.info=info;G.ui.toast=()=>{};G.ui.refreshHUD=()=>{};
  G.sel={kind:'b',id:b.id};G.ui.renderInfo();
  assert.match(info.innerHTML,/建造中 0%/);assert.match(info.innerHTML,/取消工地/);
  advance(G,12*24);complete(sites);G.ui.renderInfo();
  assert.doesNotMatch(info.innerHTML,/建造中|取消工地/);
  assert.match(info.innerHTML,/有人居住|空置/);assert.match(info.innerHTML,/>拆除<\/button>/);
});

console.log(`Building completion: ${passed} passed, ${failed} failed`);
if (failed) process.exitCode = 1;
