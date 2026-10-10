'use strict';
// Zero-dependency allocation/lifecycle checks. Native Canvas pixel checks are optional tooling.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { loadGame } = require('./helpers/playability');
const root = path.resolve(__dirname, '..');
const render = fs.readFileSync(path.join(root, 'js/render.js'), 'utf8');
const CAP = 16000000;

function harness(G = loadGame(root)) {
  const allocations = [], timers = new Map();
  let nextTimer = 1, tileDraws = 0, clears = 0;
  const context2d = new Proxy({}, { get(target, key) {
    if (key in target) return target[key];
    return key === 'clearRect' ? () => { clears++; } : () => {};
  } });
  const context = {
    G, performance,
    document: { createElement(name) {
      assert.equal(name, 'canvas');
      let width = 300, height = 150;
      function allocation() {
        allocations.push([width, height]);
        assert.ok(width * height <= CAP, `allocation ${width} x ${height} exceeds ${CAP}`);
      }
      return {
        get width() { return width; }, set width(v) { width = v; allocation(); },
        get height() { return height; }, set height(v) { height = v; allocation(); },
        getContext() { return context2d; },
      };
    } },
    setTimeout(fn, delay) { assert.equal(delay, 250); const id = nextTimer++; timers.set(id, fn); return id; },
    clearTimeout(id) { timers.delete(id); },
  };
  vm.runInNewContext(render, context, { filename: 'render.js' });
  G.ui.refreshPlacement = () => {};
  G.cv = { clientWidth: 390, clientHeight: 844 }; G.ctx = context2d; G.dpr = 1;
  G.drawGroundTile = () => { tileDraws++; };
  G.drawTree = G.drawBuilding = G.drawCitizen = () => {};
  G.game = G.newGameState(); G.game.h = 12;
  return {
    G, allocations, timers,
    reset() { tileDraws = 0; clears = 0; allocations.length = 0; },
    get tileDraws() { return tileDraws; }, get clears() { return clears; },
    fire() { for (const [id, fn] of [...timers]) { timers.delete(id); fn(); } },
  };
}
function world(N) {
  return { N, water: new Uint8Array(N * N), rock: new Uint8Array(N * N),
    treeIdx: new Int32Array(N * N).fill(-1), trees: [], buildings: [], citizens: [] };
}
function full(h, N) { assert.equal(h.tileDraws, N * N); assert.equal(h.clears, 1); }
function bounded(G) {
  assert.ok(G._gcv.width * G._gcv.height <= CAP);
  assert.equal(G._groundScale, G.groundScale);
  assert.equal(G._groundWorld, G.world);
}

// All requested map/zoom/DPR combinations, initial allocation and timer-settled cache.
for (const N of [128, 192, 256]) for (const z of [.25, .35, .55, 1, 2]) {
  const h = harness(), G = h.G;
  G.world = world(N); G.cam.z = z;
  G.frame(0); full(h, N); bounded(G);
  if (N === 128) assert.equal(G.groundScale, .5, 'keep the existing 128 initial quality');
  h.reset(); h.fire(); G.frame(0); bounded(G);
  assert.ok(h.tileDraws === 0 || h.tileDraws === N * N, 'scale change must fully repaint');
  for (const dpr of [1, 2, 3]) {
    h.reset(); G.dpr = dpr; G.frame(0);
    assert.equal(h.tileDraws, 0, 'warm frames must not rebuild ground');
    assert.equal(h.allocations.length, 0, 'DPR must not resize the whole-ground cache');
  }
  h.reset(); G.markGroundDirty(10, 10); G.frame(0);
  assert.equal(h.tileDraws, 5, 'one dirty tile only repaints itself and four neighbours');
  assert.equal(h.clears, 0); assert.equal(h.allocations.length, 0);
}

// Integer rounding, cap coverage, and idempotent sizing, including large legacy dimensions.
{
  const { G } = harness();
  for (let N = 1; N <= 4096; N++) {
    G.world = { N };
    for (const requested of [.25, .35, .5, .55, 1, 2]) {
      const a = G.groundCacheSize(requested), b = G.groundCacheSize(a.scale);
      assert.ok(Number.isInteger(a.width) && Number.isInteger(a.height));
      assert.ok(a.width * a.height <= CAP, `rounded budget N=${N}, scale=${requested}`);
      assert.ok(a.scale <= requested && a.scale <= 1);
      assert.ok(a.width >= (N * 64 + 80) * a.scale && a.height >= (N * 32 + 80) * a.scale);
      assert.deepEqual(a, b, 'a budgeted scale must be stable across partial repairs');
      if ((N * 64 + 80) * (N * 32 + 80) * Math.min(1, requested) ** 2 > CAP)
        assert.ok(a.width * a.height > CAP * .998, 'only trim pixels needed by the cap');
    }
  }
}

// Scale change with a dirty tile, even if rounding leaves canvas dimensions unchanged.
{
  const h = harness(), G = h.G;
  G.world = world(128); G.buildGround();
  h.reset(); G.groundScale = .6; G.markGroundDirty(10, 10); G.buildGround();
  full(h, 128); bounded(G);
  h.reset(); G.groundScale -= 1e-8; G.markGroundDirty(10, 10); G.buildGround();
  full(h, 128); assert.equal(h.allocations.length, 0);
  h.reset(); G.markGroundDirty(0, 0); G.buildGround(); assert.equal(h.tileDraws, 3);
  h.reset(); G.groundScale = .5; G.frame(0); full(h, 128);
  h.reset(); G._gcv.width = 1; G.markGroundDirty(10, 10); G.buildGround(); full(h, 128);
  h.reset(); G.game.season = 1; G.needGround = true; G.frame(0);
  full(h, 128); assert.equal(h.allocations.length, 0, 'season redraw reuses the bounded surface');
}

// New width times old height is over cap, though both final allocations fit.
{
  const h = harness(), G = h.G;
  G.world = world(128); G.groundScale = 1; G.buildGround();
  const oldHeight = G._gcv.height;
  G.world = world(256); G.groundScale = 1;
  assert.ok(G.groundCacheSize(1).width * oldHeight > CAP, 'exercise unsafe intermediate rectangle');
  h.reset(); G.needGround = false; G.markGroundDirty(10, 10); G.buildGround();
  full(h, 256); bounded(G); // Every width/height assignment was independently checked.
  h.reset(); G.world = world(256); G.needGround = false; G.frame(0);
  full(h, 256); assert.equal(h.allocations.length, 0, 'same-sized new world still needs repaint');
  h.reset(); G.world = world(192); G.needGround = false; G.frame(0); full(h, 192); bounded(G);
}

// Debounce cancellation, then a pending timer across world replacement and zoom changes.
{
  const h = harness(), G = h.G;
  G.world = world(128); G.cam.z = 2; G.frame(0); assert.equal(h.timers.size, 1);
  G.cam.z = .25; h.reset(); G.frame(0);
  assert.equal(h.timers.size, 0); assert.equal(G._gsTimer, null); assert.equal(h.tileDraws, 0);
  h.fire(); assert.equal(G.groundScale, .5);
  G.cam.z = 2; G.frame(0); assert.equal(h.timers.size, 1);
  G.world = world(256); G.cam.z = .25; h.reset(); h.fire();
  assert.equal(G.groundScale, G.maxGroundScale(), 'timer uses current world and current zoom');
  G.frame(0); full(h, 256); bounded(G); assert.equal(h.timers.size, 0);
  G.world = world(128); G.groundScale = .5; G.cam.z = 2; G.frame(0);
  assert.equal(h.timers.size, 1);
  G.world = world(256); h.reset(); G.frame(0);
  full(h, 256); assert.equal(h.timers.size, 0, 'world rebuild makes obsolete timer unnecessary');
}

// Actual new-game/save/import entrypoints, including the existing cross-size migration path.
{
  const h = harness(), G = h.G;
  G.MAP = 128; G.newGame(65); G.buildGround();
  const save = JSON.parse(JSON.stringify(G.serializeGame()));
  for (const N of [192, 256, 128]) {
    G.MAP = N; G.applySaveData(save); h.reset(); G.buildGround();
    assert.equal(G.world.N, N); full(h, N); bounded(G);
    h.reset(); G.markGroundDirty(2, 2); G.buildGround(); assert.equal(h.tileDraws, 5);
  }
}
console.log('Ground cache: allocation budget, scale/world invalidation, warm/partial frames, debounce, and save migration passed.');
