'use strict';
/* Candidate river-bay rendering contracts. This test loads the lab explicitly;
 * the shipped entrypoint and production render sources remain unchanged.
 * Zero-dependency recording checks are mandatory. Optional native pixel checks
 * run with `node --expose-gc tests/riverbay-lab.js --pixels` when
 * @napi-rs/canvas is available. Explicit GC keeps native pixel buffers bounded. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const CAP = 16000000;

function recordingContext(limit = Infinity) {
  const calls = [];
  const record = entry => { if (calls.length < limit) calls.push(entry); };
  const target = { calls, canvas: null };
  const context = new Proxy(target, {
    get(object, key) {
      if (key in object) return object[key];
      if (key === 'createImageData') return (width, height) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) });
      if (key === 'createPattern') return (image, repeat) => {
        record([key, image, repeat]);
        return { image, repeat };
      };
      if (key === 'createLinearGradient' || key === 'createRadialGradient') return (...args) => {
        const gradient = { addColorStop(...stop) { record(['addColorStop', ...stop]); } };
        record([key, ...args]);
        return gradient;
      };
      return (...args) => record([key, ...args]);
    },
    set(object, key, value) {
      object[key] = value;
      if (key !== 'canvas') record(['set', key, value]);
      return true;
    },
  });
  return context;
}

function harness(options = {}) {
  const canvases = [], allocations = [], timers = new Map();
  let nextTimer = 1;
  const context = {
    console, performance,
    document: {
      createElement(name) {
        assert.equal(name, 'canvas', 'terrain may only allocate canvas elements');
        let width = 300, height = 150;
        const canvas = options.createCanvas ? options.createCanvas(width, height) : {};
        const draw = options.createCanvas ? canvas.getContext('2d') : recordingContext(options.recordLimit);
        if (!options.createCanvas) {
          Object.defineProperties(canvas, {
            width: { get: () => width, set(value) { width = value; track(); } },
            height: { get: () => height, set(value) { height = value; track(); } },
          });
          canvas.getContext = () => draw;
          draw.canvas = canvas;
        }
        function track() {
          allocations.push([width, height]);
          assert.ok(width * height <= CAP, `unsafe canvas allocation ${width} × ${height}`);
        }
        canvases.push(canvas);
        return canvas;
      },
    },
    addEventListener() {},
    setTimeout(fn, delay) { const id = nextTimer++; timers.set(id, { fn, delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
  };
  context.window = context;
  vm.createContext(context);
  function load(relative) {
    vm.runInContext(fs.readFileSync(path.join(root, relative), 'utf8'), context, { filename: relative });
  }
  for (const name of ['core', 'defs', 'map', 'sim', 'sprites', 'render']) load(`js/${name}.js`);
  const G = context.G;
  G.game = G.newGameState();
  G.game.season = 1;
  G.game.h = 12;
  G.game.paused = true;
  G.ui = { refreshPlacement() {} };
  G.cv = { clientWidth: 390, clientHeight: 844 };
  G.ctx = recordingContext();
  G.dpr = 1;
  G.world = fixture(G, options.N || 24, options.seed === undefined ? 65 : options.seed);
  const production = { drawGroundTile: G.drawGroundTile, buildGround: G.buildGround,
    markGroundDirty: G.markGroundDirty, tileBlocked: G.tileBlocked, findPath: G.findPath,
    genWorld: G.genWorld, setRoad: G.setRoad };
  return { G, context, production, load, canvases, allocations, timers, native: !!options.createCanvas };
}

function install(h, options = h.native ? {} : { waterImage: { width: 512, height: 512 } }) {
  h.load('tools/riverbay-lab/terrain.js');
  assert.equal(typeof h.context.RiverbayTerrain.install, 'function');
  const lab = h.context.RiverbayTerrain.install(h.G, options);
  for (const name of ['setOptions', 'getOptions', 'invalidateTopology', 'getCoastlines'])
    assert.equal(typeof lab[name], 'function', `${name} is public`);
  assert.ok(lab.metrics && typeof lab.metrics === 'object');
  return lab;
}

function fixture(G, N = 24, seed = 65) {
  const world = G.emptyWorld(seed, 1, N);
  for (let y = 0; y < N; y++) {
    const bank = Math.floor(N * .5 + Math.sin(y * .48) * 2);
    for (let x = 0; x < N; x++) {
      const i = y * N + x;
      world.water[i] = x >= bank ? 1 : x === bank - 1 ? 2 : 0;
    }
  }
  world.rock[2 * N + 2] = 1;
  world.rock[3 * N + 2] = 2;
  world.road[5 * N + 3] = 1;
  world.road[5 * N + 4] = 2;
  world.roadCount = 2;
  return world;
}

function plain(value) { return JSON.parse(JSON.stringify(value)); }
function stateSnapshot(G) {
  return JSON.stringify({ world: G.world, game: G.game }, (_key, value) => {
    if (ArrayBuffer.isView(value)) return Array.from(value);
    if (Object.prototype.toString.call(value) === '[object Set]') return Array.from(value);
    if (Object.prototype.toString.call(value) === '[object Map]') return Array.from(value.entries());
    return value;
  });
}
function collisionSnapshot(G) {
  const out = [];
  for (let y = -1; y <= G.world.N; y++) for (let x = -1; x <= G.world.N; x++)
    out.push(!!G.tileBlocked(G.world, x, y));
  return out;
}
function digest(buffer) { return crypto.createHash('sha256').update(buffer).digest('hex'); }

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log('ok ' + name);
}

const allOptions = { waterV2: true, shore: true, lowFrequency: true, clutter: true };
const noOptions = { waterV2: false, shore: false, lowFrequency: false, clutter: false };

function expectedShoreEdges(world) {
  const edges = new Set();
  function edge(a, b) { return [a.join(','), b.join(',')].sort().join('|'); }
  for (let y = 0; y < world.N; y++) for (let x = 0; x < world.N; x++) {
    if (world.water[y * world.N + x] !== 1) continue;
    const neighbors = [[x, y - 1, [x, y], [x + 1, y]],
      [x + 1, y, [x + 1, y], [x + 1, y + 1]],
      [x, y + 1, [x, y + 1], [x + 1, y + 1]],
      [x - 1, y, [x, y], [x, y + 1]]];
    for (const [nx, ny, a, b] of neighbors) {
      if (nx < 0 || ny < 0 || nx >= world.N || ny >= world.N) continue;
      if (world.water[ny * world.N + nx] !== 1) edges.add(edge(a, b));
    }
  }
  return edges;
}

function actualShoreEdges(lines) {
  const edges = new Set();
  for (const line of lines) {
    const points = plain(line.points);
    assert.ok(points.length >= 2, 'coastline has at least two points');
    for (const p of points) assert.ok(p.length === 2 && p.every(Number.isFinite), 'finite tile-space points');
    const chain = points.slice();
    if (line.closed && JSON.stringify(chain[0]) !== JSON.stringify(chain.at(-1))) chain.push(chain[0]);
    for (let i = 1; i < chain.length; i++) {
      const a = chain[i - 1], b = chain[i];
      const dx = b[0] - a[0], dy = b[1] - a[1];
      assert.ok((dx === 0) !== (dy === 0), 'each source coast segment is an unbroken cardinal boundary');
      const length = Math.abs(dx || dy);
      assert.ok(Number.isInteger(length), 'source coast vertices lie on exact tile boundaries');
      for (let step = 0; step < length; step++) {
        const p = [a[0] + Math.sign(dx) * step, a[1] + Math.sign(dy) * step];
        const q = [p[0] + Math.sign(dx), p[1] + Math.sign(dy)];
        const key = [p.join(','), q.join(',')].sort().join('|');
        assert.ok(!edges.has(key), 'coast boundary must not be drawn twice');
        edges.add(key);
      }
    }
  }
  return edges;
}

function contracts() {
  test('production entrypoint does not load the river-bay candidate', () => {
    const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    assert.ok(!index.includes('riverbay-lab'), 'lab is opt-in through its own page');
    for (const name of ['core', 'map', 'sim', 'sprites', 'render', 'main'])
      assert.ok(!fs.readFileSync(path.join(root, `js/${name}.js`), 'utf8').includes('RiverbayTerrain'));
  });

  test('installation is opt-in and preserves simulation, collision, and navigation functions', () => {
    const h = harness(), G = h.G;
    const before = stateSnapshot(G), blocked = collisionSnapshot(G);
    const lab = install(h);
    assert.deepEqual(plain(lab.getOptions()), noOptions);
    assert.equal(stateSnapshot(G), before);
    assert.deepEqual(collisionSnapshot(G), blocked);
    for (const name of ['tileBlocked', 'findPath', 'genWorld', 'setRoad'])
      assert.equal(G[name], h.production[name], `${name} is unchanged`);
  });

  test('repeated switches never edit the world, consume RNG, or alter paths', () => {
    const h = harness(), G = h.G, lab = install(h);
    const blocked = collisionSnapshot(G), route = JSON.stringify(G.findPath(G.world, 1, 1, 3, 14));
    const before = stateSnapshot(G);
    G.rng = () => { throw new Error('candidate must not consume simulation RNG'); };
    vm.runInContext('Math.random = () => { throw new Error("candidate must not consume ambient RNG"); };', h.context);
    for (let turn = 0; turn < 3; turn++) {
      lab.setOptions(allOptions); G.buildGround();
      lab.getCoastlines();
      lab.setOptions(noOptions); G.buildGround();
    }
    assert.equal(stateSnapshot(G), before);
    assert.deepEqual(collisionSnapshot(G), blocked);
    assert.equal(JSON.stringify(G.findPath(G.world, 1, 1, 3, 14)), route);
  });

  test('unchanged options and warm camera frames do not rebuild cached ground', () => {
    const h = harness({ recordLimit: 0 }), G = h.G, lab = install(h);
    lab.setOptions(allOptions); G.buildGround();
    const builds = lab.metrics.fullBuilds + lab.metrics.partialBuilds;
    const cache = G._gcv, canvases = h.canvases.length;
    lab.setOptions(allOptions);
    assert.equal(G.needGround, false, 'no-op settings do not dirty the cache');
    for (const z of [.25, .5, .55, 1, 2]) for (const dpr of [1, 2, 3]) {
      G.cam.z = z; G.cam.x += 11; G.cam.y -= 5; G.dpr = dpr; G.frame(0);
    }
    assert.equal(lab.metrics.fullBuilds + lab.metrics.partialBuilds, builds);
    assert.equal(G._gcv, cache);
    assert.equal(h.canvases.length, canvases, 'camera movement allocates no surfaces');
  });

  test('interior shoreline, islands, diagonal contacts, and edge-open banks retain every boundary once', () => {
    const h = harness(), G = h.G, lab = install(h);
    const shapes = [
      (x, y) => x >= 5 && x <= 11 && y >= 4 && y <= 13,
      (x, y) => x >= 3 && x <= 17 && y >= 3 && y <= 18 && !(x >= 7 && x <= 10 && y >= 8 && y <= 11),
      (x, y) => (x === 6 && y === 6) || (x === 7 && y === 7),
      (x, y) => x >= 11 + Math.floor(Math.sin(y * .5) * 2),
    ];
    for (const shape of shapes) {
      for (let y = 0; y < G.world.N; y++) for (let x = 0; x < G.world.N; x++)
        G.world.water[y * G.world.N + x] = shape(x, y) ? 1 : 0;
      lab.invalidateTopology();
      const lines = lab.getCoastlines();
      assert.deepEqual([...actualShoreEdges(lines)].sort(), [...expectedShoreEdges(G.world)].sort());
      if (shape !== shapes.at(-1)) assert.ok(lines.every(line => line.closed), 'interior shorelines close without gaps');
      assert.equal(lines.length, shape === shapes[0] || shape === shapes[3] ? 1 : 2,
        'an island or diagonal-only contact remains a separate contour');
      for (const line of lines) assert.deepEqual(plain(line.bounds), {
        x0: Math.min(...line.points.map(point => point[0])), y0: Math.min(...line.points.map(point => point[1])),
        x1: Math.max(...line.points.map(point => point[0])), y1: Math.max(...line.points.map(point => point[1])),
      }, 'coast bounds accurately support local filtering');
    }
  });

  test('coastline caching is deterministic and invalidates only when requested', () => {
    const h = harness(), lab = install(h);
    const first = JSON.stringify(lab.getCoastlines()), builds = lab.metrics.topologyBuilds;
    assert.equal(JSON.stringify(lab.getCoastlines()), first);
    assert.equal(lab.metrics.topologyBuilds, builds);
    lab.setOptions(allOptions); h.G.buildGround();
    assert.equal(JSON.stringify(lab.getCoastlines()), first);
    lab.invalidateTopology();
    assert.equal(h.G.needGround, true);
    assert.equal(JSON.stringify(lab.getCoastlines()), first);
    assert.equal(lab.metrics.topologyBuilds, builds + 1);
  });

  test('settings and topology snapshots cannot leak mutable internal state', () => {
    const h = harness(), lab = install(h);
    const options = lab.getOptions(); options.shore = true;
    assert.equal(lab.getOptions().shore, false);
    const initial = JSON.stringify(lab.getCoastlines()), copy = lab.getCoastlines();
    copy[0].points[0][0] += 100;
    assert.equal(JSON.stringify(lab.getCoastlines()), initial);
    for (const invalid of [{ shore: 1 }, { unexpected: true }])
      assert.throws(() => lab.setOptions(invalid), /Invalid riverbay option/);
    assert.deepEqual(plain(lab.getOptions()), noOptions);
  });

  test('same seed and same options produce identical drawing commands', () => {
    function render() {
      const h = harness({ N: 16 }), lab = install(h);
      lab.setOptions(allOptions); h.G.buildGround();
      return JSON.stringify(h.G._gcv.getContext('2d').calls, (key, value) => key === 'canvas' ? undefined : value);
    }
    assert.equal(digest(render()), digest(render()));
  });

  test('dirty repairs remain local and reuse the full-world cache', () => {
    const h = harness({ N: 128, recordLimit: 0 }), G = h.G, lab = install(h);
    lab.setOptions(allOptions); G.buildGround();
    const cache = G._gcv, builds = lab.metrics.fullBuilds, partials = lab.metrics.partialBuilds;
    const allocations = h.allocations.length;
    G.world.road[64 * 128 + 20] = 1; G.markGroundDirty(20, 64); G.buildGround();
    assert.equal(G._gcv, cache);
    assert.equal(lab.metrics.fullBuilds, builds, 'dirty road does not trigger a full rebuild');
    assert.equal(lab.metrics.partialBuilds, partials + 1);
    assert.ok(lab.metrics.lastTileDraws > 0 && lab.metrics.lastTileDraws < 128 * 128 / 10,
      `dirty repair must be bounded, got ${lab.metrics.lastTileDraws} tiles`);
    assert.equal(h.allocations.length, allocations, 'local repairs never resize the cache');
    assert.equal(G.groundDirty.size, 0);
  });

  test('new worlds, scale changes, and explicit topology edits force safe full rebuilds', () => {
    const h = harness({ recordLimit: 0 }), G = h.G, lab = install(h);
    lab.setOptions(allOptions); G.buildGround();
    const cache = G._gcv;
    const assertFull = (action, reason) => {
      const full = lab.metrics.fullBuilds;
      action(); G.markGroundDirty(4, 4); G.buildGround();
      assert.equal(lab.metrics.fullBuilds, full + 1, reason);
      assert.equal(lab.metrics.lastTileDraws, G.world.N ** 2);
      assert.equal(G._gcv, cache, 'full invalidations reuse the allocated ground surface');
      assert.equal(G._groundWorld, G.world);
      assert.equal(G._groundScale, G.groundScale);
    };
    const topology = lab.metrics.topologyBuilds, material = lab.metrics.materialBuilds;
    assertFull(() => { G.world = fixture(G, 24, 66); }, 'a same-sized replacement world cannot use stale terrain');
    assert.equal(lab.metrics.topologyBuilds, topology + 1);
    assert.equal(lab.metrics.materialBuilds, material + 1);
    assertFull(() => { G.groundScale += 1e-8; }, 'fractional scale changes repaint even when dimensions round identically');
    assertFull(() => {
      G.world.water[8 * G.world.N + 4] = 1;
      lab.invalidateTopology();
    }, 'explicit mask edits rebuild the shoreline and cache');
    assert.deepEqual([...actualShoreEdges(lab.getCoastlines())].sort(), [...expectedShoreEdges(G.world)].sort());
  });

  test('128/192/256 candidates preserve the 16-million-pixel ground budget and one large cache', () => {
    for (const N of [128, 192, 256]) {
      const h = harness({ N, recordLimit: 0 }), G = h.G, lab = install(h);
      lab.setOptions(allOptions); G.groundScale = 1; G.buildGround();
      assert.ok(G._gcv.width * G._gcv.height <= CAP);
      assert.equal(G._groundWorld, G.world);
      assert.equal(G._groundScale, G.groundScale);
      assert.equal(h.canvases.filter(canvas => canvas.width * canvas.height > 512 * 512).length, 1,
        'materials may be small but a second full-world cache is prohibited');
      const cache = G._gcv;
      lab.setOptions(noOptions); G.buildGround();
      assert.equal(G._gcv, cache, 'switching off reuses the same ground cache');
    }
  });
}

async function pixels() {
  let createCanvas, loadImage;
  try { ({ createCanvas, loadImage } = require('@napi-rs/canvas')); }
  catch (error) { throw new Error('--pixels requires optional @napi-rs/canvas', { cause: error }); }
  const waterImage = await loadImage(path.join(root, 'tools/riverbay-lab/water-open-candidate-v2.png'));
  const bitmap = G => Buffer.from(G._gcv.getContext('2d').getImageData(0, 0, G._gcv.width, G._gcv.height).data);
  test('all-off full-cache pixels exactly match the production renderer', () => {
    const h = harness({ createCanvas, N: 16 }), G = h.G;
    G.buildGround(); const baseline = bitmap(G);
    install(h); G.needGround = true; G.buildGround();
    assert.equal(digest(bitmap(G)), digest(baseline));
    for (const canvas of h.canvases) { canvas.width = 1; canvas.height = 1; }
  });
  global.gc?.();
  test('candidate dirty road/rock repairs stay within raster tolerance and never accumulate alpha', () => {
    for (const scale of [.25, .5, 1]) {
      const h = harness({ createCanvas, N: 16 }), G = h.G, lab = install(h, { waterImage });
      lab.setOptions(allOptions); G.groundScale = scale; G.buildGround();
      const changes = [
        [3, 8, 'road', 1], [3, 8, 'road', 2], [3, 8, 'road', 0],
        [2, 2, 'rock', 0], [2, 3, 'rock', 0],
        [5, 11, 'road', 1], [5, 11, 'road', 0],
        [0, 0, 'road', 1], [0, 0, 'road', 0],
        [1, 15, 'road', 1], [1, 15, 'road', 0],
      ];
      for (const [x, y, property, value] of changes) {
        G.world[property][y * G.world.N + x] = value;
        G.markGroundDirty(x, y); G.buildGround();
        const partial = bitmap(G);
        // Clearing the integer pixel repair rectangle must make a second repair
        // exactly idempotent, even though Skia's clipped/unclipped raster paths
        // can differ by a few channels at anti-aliased edges.
        for (let repeat = 0; repeat < 3; repeat++) {
          G.markGroundDirty(x, y); G.buildGround();
          assert.equal(digest(bitmap(G)), digest(partial), 'repeated repair must not darken or grow an alpha halo');
        }
        G.needGround = true; G.buildGround();
        const complete = bitmap(G), W = G._gcv.width;
        const [sx, sy] = G.T2S(x, y);
        const r = { x0: Math.max(0, Math.floor((sx - 80 + G.groundOX) * scale)),
          x1: Math.min(W, Math.ceil((sx + 80 + G.groundOX) * scale)),
          y0: Math.max(0, Math.floor((sy - 48 + G.groundOY) * scale)),
          y1: Math.min(G._gcv.height, Math.ceil((sy + 80 + G.groundOY) * scale)) };
        let changed = 0, max = 0, total = 0;
        for (let i = 0; i < partial.length; i += 4) {
          let delta = 0;
          for (let channel = 0; channel < 4; channel++) delta = Math.max(delta, Math.abs(partial[i + channel] - complete[i + channel]));
          if (!delta) continue;
          const px = i / 4 % W, py = Math.floor(i / 4 / W);
          assert.ok(px >= r.x0 && px < r.x1 && py >= r.y0 && py < r.y1, 'repair differs outside its cleared rectangle');
          changed++; max = Math.max(max, delta); total += delta;
        }
        const area = (r.x1 - r.x0) * (r.y1 - r.y0);
        const diagnostic = `scale=${scale}, ${property}(${x},${y})=${value}: ${changed} pixels, max=${max}, mean=${total / area}`;
        assert.ok(max <= 32 && changed <= area * .12 && total / area <= .25, diagnostic);
        global.gc?.();
      }
      for (const canvas of h.canvases) { canvas.width = 1; canvas.height = 1; }
      global.gc?.();
    }
  });
}

if (require.main === module) {
  (async () => {
    contracts();
    if (process.argv.includes('--pixels')) await pixels();
    console.log(`River-bay lab: ${passed} contract groups passed${process.argv.includes('--pixels') ? ' (including native pixels)' : ''}.`);
  })().catch(error => { console.error(error); process.exitCode = 1; });
}
module.exports = { harness, install, fixture, recordingContext, stateSnapshot, collisionSnapshot, plain, digest };
